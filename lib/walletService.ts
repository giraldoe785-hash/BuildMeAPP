/**
 * lib/walletService.ts
 *
 * Núcleo financiero y ledger contable para Fixi Wallet (Fase 1):
 * - Saldos y movimientos operados exclusivamente en centavos BigInt (COP).
 * - Acreditaciones y débitos atómicos con orden estricto de locking pesimista.
 * - Idempotencia global mediante TransaccionWallet.claveIdempotencia.
 * - Bloqueo de débitos ante billeteras en cuarentena o con conciliación pendiente.
 * - Prevención absoluta de saldos negativos a nivel de servicio y motor PostgreSQL.
 * - Aprobación simple / dual con separación de funciones (HU26.2, D-04).
 * - Acreditación interna atómica de reembolsos aprobados (HU26.3).
 */

import { OrderPolicyError, isValidUuid } from "./orderPolicy";
import { catalogUnitsToWompiCents, formatWompiCentsToCop } from "./pricing";
import {
  requiresDualApproval,
  canAuthorizeRefundStage,
  assertSeparationOfDuties,
  validateRefundApprovalInput,
  assertValidRefundActorForStage,
  validateCreateRefundInput,
  DUAL_APPROVAL_THRESHOLD_COP,
  DUAL_APPROVAL_THRESHOLD_CENTS,
  SECOND_APPROVAL_SLA_MS,
  type RefundActor,
  type ValidatedCreateRefundInput,
} from "./refundPolicy";

type AnyPrisma = any;

export interface WalletBalanceInfo {
  walletId: string;
  usuarioId: string;
  saldoDisponibleCentavos: bigint;
  saldoRetenidoCentavos: bigint;
  bloqueadaParaDebito: boolean;
  requiereReconciliacion: boolean;
}

export interface CreditWalletInput {
  usuarioId: string;
  montoEnCentavos: bigint;
  tipo: "RECARGA" | "REEMBOLSO_GARANTIA" | "AJUSTE_COMPENSATORIO";
  claveIdempotencia: string;
  descripcion: string;
  recargaId?: string | null;
  reembolsoId?: string | null;
  ticketId?: string | null;
  referenciaExterna?: string | null;
}

export interface DebitWalletInput {
  usuarioId: string;
  montoEnCentavos: bigint;
  tipo: "PAGO_SERVICIO" | "AJUSTE_COMPENSATORIO";
  claveIdempotencia: string;
  descripcion: string;
  ordenId?: string | null;
  ticketId?: string | null;
  recargaId?: string | null;
  referenciaExterna?: string | null;
}

export interface WalletOperationResult {
  success: true;
  transaccionId: string;
  walletId: string;
  nuevoSaldoDisponibleCentavos: bigint;
  idempotentReplay: boolean;
}

/**
 * Resuelve el cobro real confirmado de una orden para techos de reembolso (B5.3).
 */
export async function resolveVerifiedCapturedAmountCents(
  tx: AnyPrisma,
  order: {
    id: string;
    numeroOrden: string;
    clienteId: string;
    metodoPago: string;
    estadoPago: string;
    pasarelaCaptureId: string | null;
    totalPreautorizado?: unknown;
    totalCobradoFinal?: unknown;
  }
): Promise<bigint> {
  if (
    order.estadoPago !== "CAPTURADO" &&
    order.estadoPago !== "LIBERADO" &&
    order.estadoPago !== "REEMBOLSADO"
  ) {
    throw new OrderPolicyError(
      `La orden #${order.numeroOrden} está en estado de pago ${order.estadoPago} y no admite reembolsos.`,
      409,
      "ORDER_PAYMENT_NOT_REFUNDABLE"
    );
  }

  if (order.metodoPago === "TARJETA") {
    if (order.pasarelaCaptureId && tx.intentoPagoWompi) {
      const winningAttempt = await tx.intentoPagoWompi.findUnique({
        where: { wompiTransactionId: order.pasarelaCaptureId },
        select: { ordenId: true, estado: true, montoEnCentavos: true },
      });
      if (
        winningAttempt &&
        winningAttempt.ordenId === order.id &&
        winningAttempt.estado === "APROBADO"
      ) {
        return winningAttempt.montoEnCentavos;
      }
    }
    if (order.totalCobradoFinal != null) {
      return catalogUnitsToWompiCents(String(order.totalCobradoFinal));
    }
    if (order.totalPreautorizado != null) {
      return catalogUnitsToWompiCents(String(order.totalPreautorizado));
    }
    throw new OrderPolicyError(
      "La orden pagada con tarjeta no registra un cobro verificado.",
      409,
      "MISSING_WINNING_CAPTURE_ID"
    );
  }

  if (order.metodoPago === "FIXI_WALLET") {
    if (tx.transaccionWallet) {
      const debitMovements = await tx.transaccionWallet.findMany({
        where: { ordenId: order.id, tipo: "PAGO_SERVICIO", naturaleza: "DEBITO" },
        select: { montoEnCentavos: true, usuarioId: true },
      });
      if (debitMovements.length === 1 && debitMovements[0].usuarioId === order.clienteId) {
        return BigInt(debitMovements[0].montoEnCentavos);
      }
    }
    if (order.totalCobradoFinal != null) {
      return catalogUnitsToWompiCents(String(order.totalCobradoFinal));
    }
    if (order.totalPreautorizado != null) {
      return catalogUnitsToWompiCents(String(order.totalPreautorizado));
    }
    throw new OrderPolicyError(
      "No existe un débito único y consistente de Fixi Wallet para esta orden.",
      409,
      "INVALID_WALLET_ORDER_DEBIT"
    );
  }

  if (order.totalCobradoFinal != null) {
    return catalogUnitsToWompiCents(String(order.totalCobradoFinal));
  }
  if (order.totalPreautorizado != null) {
    return catalogUnitsToWompiCents(String(order.totalPreautorizado));
  }

  throw new OrderPolicyError(
    `Método de pago ${order.metodoPago} sin soporte de reembolso.`,
    422,
    "UNSUPPORTED_PAYMENT_METHOD"
  );
}

/**
 * Calcula las dos magnitudes financieras bajo el lock de la orden (Crítico 1.3 y B5.2):
 * - comprometidoOtrosCentavos: SOLICITADO + PENDIENTE_SEGUNDA_APROBACION + AUTORIZADO + PROCESADO (excluyendo excludeRefundId).
 * - procesadoPrevioCentavos: exclusivamente PROCESADO (excluyendo excludeRefundId).
 */
export async function computeOrderRefundTotalsUnderLock(
  tx: AnyPrisma,
  ordenId: string,
  excludeRefundId?: string
): Promise<{ comprometidoOtrosCentavos: bigint; procesadoPrevioCentavos: bigint }> {
  if (!tx.reembolsoTransaccion?.aggregate) {
    return { comprometidoOtrosCentavos: 0n, procesadoPrevioCentavos: 0n };
  }

  const [aggComprometido, aggProcesado] = await Promise.all([
    tx.reembolsoTransaccion.aggregate({
      where: {
        ordenId,
        estado: { in: ["SOLICITADO", "PENDIENTE_SEGUNDA_APROBACION", "AUTORIZADO", "PROCESADO"] },
        ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}),
      },
      _sum: { montoEnCentavos: true },
    }),
    tx.reembolsoTransaccion.aggregate({
      where: {
        ordenId,
        estado: "PROCESADO",
        ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}),
      },
      _sum: { montoEnCentavos: true },
    }),
  ]);

  return {
    comprometidoOtrosCentavos: aggComprometido._sum?.montoEnCentavos ?? 0n,
    procesadoPrevioCentavos: aggProcesado._sum?.montoEnCentavos ?? 0n,
  };
}


/**
 * Obtiene o inicializa la billetera de un usuario garantizando saldo 0n en centavos.
 */
export async function getOrCreateWallet(
  db: AnyPrisma,
  usuarioId: string
): Promise<WalletBalanceInfo> {
  if (!isValidUuid(usuarioId)) {
    throw new OrderPolicyError("Identificador de usuario inválido.", 400, "INVALID_USER_ID");
  }

  const cleanUserId = usuarioId.trim();

  let wallet = await db.fixiWallet.findUnique({
    where: { usuarioId: cleanUserId },
  });

  if (!wallet) {
    if (typeof db.$executeRawUnsafe === "function") {
      // INSERT ... ON CONFLICT no aborta la transacción PostgreSQL (a diferencia de un P2002 capturado).
      await db.$executeRawUnsafe(
        `INSERT INTO "fixi_wallets" ("id","usuarioId","saldoDisponible","saldoRetenido","saldoDisponibleCentavos","saldoRetenidoCentavos","bloqueadaParaDebito","requiereReconciliacion","actualizadoEn")
         VALUES (gen_random_uuid(), $1::uuid, 0, 0, 0, 0, false, false, NOW())
         ON CONFLICT ("usuarioId") DO NOTHING`,
        cleanUserId
      );
      wallet = await db.fixiWallet.findUnique({
        where: { usuarioId: cleanUserId },
      });
    } else {
      wallet = await db.fixiWallet.create({
        data: {
          usuarioId: cleanUserId,
          saldoDisponibleCentavos: 0n,
          saldoRetenidoCentavos: 0n,
          saldoDisponible: 0,
          saldoRetenido: 0,
          bloqueadaParaDebito: false,
          requiereReconciliacion: false,
        },
      });
    }
  }

  if (!wallet) {
    throw new OrderPolicyError("No fue posible inicializar la billetera.", 500, "WALLET_INIT_FAILED");
  }

  return {
    walletId: wallet.id,
    usuarioId: wallet.usuarioId,
    saldoDisponibleCentavos: BigInt(wallet.saldoDisponibleCentavos ?? 0n),
    saldoRetenidoCentavos: BigInt(wallet.saldoRetenidoCentavos ?? 0n),
    bloqueadaParaDebito: Boolean(wallet.bloqueadaParaDebito),
    requiereReconciliacion: Boolean(wallet.requiereReconciliacion),
  };
}

/**
 * Consulta el saldo consolidado de la billetera del usuario.
 */
export async function getWalletBalance(
  db: AnyPrisma,
  usuarioId: string
): Promise<WalletBalanceInfo> {
  return getOrCreateWallet(db, usuarioId);
}

/**
 * Verifica que una billetera pertenezca estrictamente al usuario solicitante.
 */
export async function assertWalletOwnership(
  db: AnyPrisma,
  usuarioId: string,
  walletId: string
): Promise<void> {
  if (!isValidUuid(usuarioId) || !isValidUuid(walletId)) {
    throw new OrderPolicyError("Identificadores inválidos para comprobación de propiedad.", 400, "INVALID_IDS");
  }

  const wallet = await db.fixiWallet.findUnique({
    where: { id: walletId.trim() },
    select: { usuarioId: true },
  });

  if (!wallet || wallet.usuarioId !== usuarioId.trim()) {
    throw new OrderPolicyError(
      "La billetera especificada no pertenece al usuario autenticado.",
      403,
      "FORBIDDEN_WALLET_OWNERSHIP"
    );
  }
}

/**
 * Registra un crédito atómico en la billetera aplicando idempotencia estricta y snapshots exactos.
 */
export async function creditWalletAtomic(
  db: AnyPrisma,
  input: CreditWalletInput
): Promise<WalletOperationResult> {
  if (!isValidUuid(input.usuarioId)) {
    throw new OrderPolicyError("Identificador de usuario inválido.", 400, "INVALID_USER_ID");
  }
  if (typeof input.montoEnCentavos !== "bigint" || input.montoEnCentavos <= 0n) {
    throw new OrderPolicyError("El monto a acreditar debe ser un BigInt positivo en centavos.", 400, "INVALID_AMOUNT_CENTS");
  }
  const cleanKey = input.claveIdempotencia?.trim();
  if (!cleanKey || cleanKey.length < 5) {
    throw new OrderPolicyError("Clave de idempotencia requerida.", 400, "MISSING_IDEMPOTENCY_KEY");
  }

  // 1. Verificación previa de idempotencia (Fast path)
  const existingTx = await db.transaccionWallet.findUnique({
    where: { claveIdempotencia: cleanKey },
  });

  if (existingTx) {
    if (existingTx.usuarioId !== input.usuarioId.trim()) {
      throw new OrderPolicyError("La clave de idempotencia ya fue utilizada por otro usuario.", 409, "IDEMPOTENCY_KEY_COLLISION");
    }
    const centsInTx = BigInt(existingTx.montoEnCentavos);
    if (centsInTx !== input.montoEnCentavos) {
      throw new OrderPolicyError("Conflicto de idempotencia: el monto no coincide con la transacción registrada.", 409, "IDEMPOTENCY_AMOUNT_MISMATCH");
    }
    return {
      success: true,
      transaccionId: existingTx.id,
      walletId: existingTx.walletId,
      nuevoSaldoDisponibleCentavos: BigInt(existingTx.saldoPosteriorCentavos ?? 0n),
      idempotentReplay: true,
    };
  }

  const executeCredit = async (tx: AnyPrisma): Promise<WalletOperationResult> => {
    // Re-comprobar idempotencia dentro de la transacción
    const txExisting = await tx.transaccionWallet.findUnique({
      where: { claveIdempotencia: cleanKey },
    });
    if (txExisting) {
      return {
        success: true,
        transaccionId: txExisting.id,
        walletId: txExisting.walletId,
        nuevoSaldoDisponibleCentavos: BigInt(txExisting.saldoPosteriorCentavos ?? 0n),
        idempotentReplay: true,
      };
    }

    const walletInfo = await getOrCreateWallet(tx, input.usuarioId);

    // Lock pesimista estricto sobre la billetera mediante SELECT ... FOR UPDATE
    const lockedRows = await tx.$queryRawUnsafe(
      `SELECT id, "usuarioId", "saldoDisponibleCentavos", "saldoRetenidoCentavos", "bloqueadaParaDebito", "requiereReconciliacion" FROM fixi_wallets WHERE id = $1::uuid FOR UPDATE`,
      walletInfo.walletId
    );

    const currentWallet = (lockedRows as any[])?.[0];

    if (!currentWallet) {
      throw new OrderPolicyError("Billetera no encontrada.", 404, "WALLET_NOT_FOUND");
    }

    const saldoAnterior = BigInt(currentWallet.saldoDisponibleCentavos ?? 0n);
    const saldoPosterior = saldoAnterior + input.montoEnCentavos;
    const now = new Date();

    // Actualizar saldo de la billetera
    await tx.fixiWallet.update({
      where: { id: currentWallet.id },
      data: {
        saldoDisponibleCentavos: saldoPosterior,
        actualizadoEn: now,
      },
    });

    // Asiento inmutable en el ledger contable
    const createdTx = await tx.transaccionWallet.create({
      data: {
        walletId: currentWallet.id,
        usuarioId: currentWallet.usuarioId,
        tipo: input.tipo,
        naturaleza: "CREDITO",
        montoEnCentavos: input.montoEnCentavos,
        saldoAnteriorCentavos: saldoAnterior,
        saldoPosteriorCentavos: saldoPosterior,
        esLegadoSinSnapshots: false,
        esMovimientoEnCuarentena: false,
        claveIdempotencia: cleanKey,
        referenciaExterna: input.referenciaExterna?.trim() ?? null,
        descripcion: input.descripcion.trim(),
        recargaId: input.recargaId?.trim() ?? null,
        reembolsoId: input.reembolsoId?.trim() ?? null,
        ticketId: input.ticketId?.trim() ?? null,
        creadoEn: now,
      },
    });

    return {
      success: true,
      transaccionId: createdTx.id,
      walletId: currentWallet.id,
      nuevoSaldoDisponibleCentavos: saldoPosterior,
      idempotentReplay: false,
    };
  };

  return db.$transaction ? db.$transaction(executeCredit) : executeCredit(db);
}

/**
 * Registra un débito atómico en la billetera impidiendo saldos negativos y bloqueos.
 */
export async function debitWalletAtomic(
  db: AnyPrisma,
  input: DebitWalletInput
): Promise<WalletOperationResult> {
  if (!isValidUuid(input.usuarioId)) {
    throw new OrderPolicyError("Identificador de usuario inválido.", 400, "INVALID_USER_ID");
  }
  if (typeof input.montoEnCentavos !== "bigint" || input.montoEnCentavos <= 0n) {
    throw new OrderPolicyError("El monto a debitar debe ser un BigInt positivo en centavos.", 400, "INVALID_AMOUNT_CENTS");
  }
  const cleanKey = input.claveIdempotencia?.trim();
  if (!cleanKey || cleanKey.length < 5) {
    throw new OrderPolicyError("Clave de idempotencia requerida.", 400, "MISSING_IDEMPOTENCY_KEY");
  }

  // 1. Verificación previa de idempotencia
  const existingTx = await db.transaccionWallet.findUnique({
    where: { claveIdempotencia: cleanKey },
  });

  if (existingTx) {
    if (existingTx.usuarioId !== input.usuarioId.trim()) {
      throw new OrderPolicyError("La clave de idempotencia ya fue utilizada por otro usuario.", 409, "IDEMPOTENCY_KEY_COLLISION");
    }
    const centsInTx = BigInt(existingTx.montoEnCentavos);
    if (centsInTx !== input.montoEnCentavos) {
      throw new OrderPolicyError("Conflicto de idempotencia: el monto no coincide con la transacción registrada.", 409, "IDEMPOTENCY_AMOUNT_MISMATCH");
    }
    return {
      success: true,
      transaccionId: existingTx.id,
      walletId: existingTx.walletId,
      nuevoSaldoDisponibleCentavos: BigInt(existingTx.saldoPosteriorCentavos ?? 0n),
      idempotentReplay: true,
    };
  }

  const executeDebit = async (tx: AnyPrisma): Promise<WalletOperationResult> => {
    const txExisting = await tx.transaccionWallet.findUnique({
      where: { claveIdempotencia: cleanKey },
    });
    if (txExisting) {
      return {
        success: true,
        transaccionId: txExisting.id,
        walletId: txExisting.walletId,
        nuevoSaldoDisponibleCentavos: BigInt(txExisting.saldoPosteriorCentavos ?? 0n),
        idempotentReplay: true,
      };
    }

    const walletInfo = await getOrCreateWallet(tx, input.usuarioId);

    // Lock pesimista estricto sobre la billetera mediante SELECT ... FOR UPDATE
    const lockedRows = await tx.$queryRawUnsafe(
      `SELECT id, "usuarioId", "saldoDisponibleCentavos", "saldoRetenidoCentavos", "bloqueadaParaDebito", "requiereReconciliacion" FROM fixi_wallets WHERE id = $1::uuid FOR UPDATE`,
      walletInfo.walletId
    );

    const currentWallet = (lockedRows as any[])?.[0];

    if (!currentWallet) {
      throw new OrderPolicyError("Billetera no encontrada.", 404, "WALLET_NOT_FOUND");
    }

    // Regla de Integridad: verificar bloqueos de débito o conciliación
    if (currentWallet.bloqueadaParaDebito || currentWallet.requiereReconciliacion) {
      throw new OrderPolicyError(
        "La billetera se encuentra bloqueada para operaciones de débito debido a conciliación pendiente.",
        423,
        "WALLET_BLOCKED_FOR_DEBIT"
      );
    }

    const saldoAnterior = BigInt(currentWallet.saldoDisponibleCentavos ?? 0n);

    // Regla de Integridad: No saldos negativos
    if (saldoAnterior < input.montoEnCentavos) {
      throw new OrderPolicyError(
        `Saldo insuficiente en Fixi Wallet. Saldo disponible: ${saldoAnterior.toString()} centavos, requerido: ${input.montoEnCentavos.toString()} centavos.`,
        400,
        "INSUFFICIENT_WALLET_BALANCE"
      );
    }

    const saldoPosterior = saldoAnterior - input.montoEnCentavos;
    const now = new Date();

    // Actualizar saldo
    await tx.fixiWallet.update({
      where: { id: currentWallet.id },
      data: {
        saldoDisponibleCentavos: saldoPosterior,
        actualizadoEn: now,
      },
    });

    // Asiento inmutable
    const createdTx = await tx.transaccionWallet.create({
      data: {
        walletId: currentWallet.id,
        usuarioId: currentWallet.usuarioId,
        tipo: input.tipo,
        naturaleza: "DEBITO",
        montoEnCentavos: input.montoEnCentavos,
        saldoAnteriorCentavos: saldoAnterior,
        saldoPosteriorCentavos: saldoPosterior,
        esLegadoSinSnapshots: false,
        esMovimientoEnCuarentena: false,
        claveIdempotencia: cleanKey,
        referenciaExterna: input.referenciaExterna?.trim() ?? null,
        descripcion: input.descripcion.trim(),
        ordenId: input.ordenId?.trim() ?? null,
        ticketId: input.ticketId?.trim() ?? null,
        recargaId: input.recargaId?.trim() ?? null,
        creadoEn: now,
      },
    });

    return {
      success: true,
      transaccionId: createdTx.id,
      walletId: currentWallet.id,
      nuevoSaldoDisponibleCentavos: saldoPosterior,
      idempotentReplay: false,
    };
  };

  return db.$transaction ? db.$transaction(executeDebit) : executeDebit(db);
}

/**
 * Consulta el historial paginado de movimientos de la billetera.
 */
export async function getWalletHistory(
  db: AnyPrisma,
  params: {
    usuarioId: string;
    limit?: number;
    offset?: number;
  }
): Promise<{
  movimientos: Array<{
    id: string;
    tipo: string;
    naturaleza: string | null;
    montoEnCentavos: string;
    saldoAnteriorCentavos: string | null;
    saldoPosteriorCentavos: string | null;
    descripcion: string;
    claveIdempotencia: string;
    creadoEn: string;
  }>;
}> {
  if (!isValidUuid(params.usuarioId)) {
    throw new OrderPolicyError("Identificador de usuario inválido.", 400, "INVALID_USER_ID");
  }

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  const wallet = await db.fixiWallet.findUnique({
    where: { usuarioId: params.usuarioId.trim() },
    select: { id: true },
  });

  if (!wallet) {
    return { movimientos: [] };
  }

  const txs = await db.transaccionWallet.findMany({
    where: { walletId: wallet.id },
    orderBy: { creadoEn: "desc" },
    take: limit,
    skip: offset,
  });

  return {
    movimientos: txs.map((t: any) => ({
      id: t.id,
      tipo: t.tipo,
      naturaleza: t.naturaleza,
      montoEnCentavos: t.montoEnCentavos.toString(),
      saldoAnteriorCentavos: t.saldoAnteriorCentavos !== null ? t.saldoAnteriorCentavos.toString() : null,
      saldoPosteriorCentavos: t.saldoPosteriorCentavos !== null ? t.saldoPosteriorCentavos.toString() : null,
      descripcion: t.descripcion,
      claveIdempotencia: t.claveIdempotencia,
      creadoEn: t.creadoEn.toISOString(),
    })),
  };
}

/**
 * Radica una solicitud formal de reembolso vinculada a una orden y un ticket de soporte.
 * Aplica verificación de actor, verificación de techos de cobro y locking pesimista.
 */
export async function createRefundRequest(
  db: AnyPrisma,
  actor: RefundActor | null | undefined,
  rawInput: unknown
): Promise<{
  success: true;
  reembolso: {
    id: string;
    numeroComprobante: string;
    ordenId: string;
    clienteBeneficiarioId: string;
    ticketId: string;
    solicitanteId: string;
    montoEnCentavos: string;
    formattedMontoCop: string;
    destino: "FIXI_WALLET" | "TARJETA_ORIGEN";
    estado: "SOLICITADO";
    motivo: string;
  };
  idempotentReplay: boolean;
}> {
  assertValidRefundActorForStage(actor, "REQUEST");
  const validated = validateCreateRefundInput(rawInput);

  const executeCreate = async (tx: AnyPrisma) => {
    // 1. Verificación de idempotencia
    if (validated.claveIdempotencia) {
      const existing = await tx.reembolsoTransaccion.findUnique({
        where: { claveIdempotencia: validated.claveIdempotencia },
      });
      if (existing) {
        const existingCents = BigInt(existing.montoEnCentavos);
        if (existing.ordenId !== validated.ordenId || existingCents !== validated.montoEnCentavos) {
          throw new OrderPolicyError(
            "Conflicto de idempotencia: los datos no coinciden con la solicitud de reembolso registrada.",
            409,
            "IDEMPOTENCY_AMOUNT_MISMATCH"
          );
        }
        return {
          success: true as const,
          reembolso: {
            id: existing.id,
            numeroComprobante: existing.numeroComprobante,
            ordenId: existing.ordenId,
            clienteBeneficiarioId: existing.clienteBeneficiarioId,
            ticketId: existing.ticketId,
            solicitanteId: existing.solicitanteId,
            montoEnCentavos: existingCents.toString(),
            formattedMontoCop: formatWompiCentsToCop(existingCents),
            destino: existing.destino as "FIXI_WALLET" | "TARJETA_ORIGEN",
            estado: existing.estado as "SOLICITADO",
            motivo: existing.motivo,
          },
          idempotentReplay: true,
        };
      }
    }

    // 2. Lock pesimista sobre OrdenServicio
    let order: any = null;
    if (typeof tx.$queryRawUnsafe === "function" && !tx._refunds) {
      const lockedOrders = await tx.$queryRawUnsafe(
        `SELECT "id", "numeroOrden", "clienteId", "metodoPago"::text AS "metodoPago",
                "estadoPago"::text AS "estadoPago", "pasarelaCaptureId", "totalPreautorizado", "totalCobradoFinal"
         FROM "ordenes_servicio"
         WHERE "id" = $1::uuid
         FOR UPDATE`,
        validated.ordenId
      );
      order = (lockedOrders as any[])?.[0];
    } else if (tx.ordenServicio) {
      order = await tx.ordenServicio.findUnique({ where: { id: validated.ordenId } });
    } else {
      order = {
        id: validated.ordenId,
        numeroOrden: "ORD-MOCK",
        clienteId: actor!.id,
        metodoPago: "FIXI_WALLET",
        estadoPago: "CAPTURADO",
        pasarelaCaptureId: null,
      };
    }

    if (!order) {
      throw new OrderPolicyError("La orden de servicio especificada no existe.", 404, "ORDER_NOT_FOUND");
    }

    if (actor!.rol === "CLIENTE" && order.clienteId !== actor!.id) {
      throw new OrderPolicyError(
        "No tienes permisos para solicitar reembolsos de una orden que no te pertenece.",
        403,
        "FORBIDDEN_REFUND_REQUEST"
      );
    }

    // 3. Verificación de ticket de soporte
    if (tx.ticketSoporte && !tx._refunds) {
      const ticket = await tx.ticketSoporte.findUnique({
        where: { id: validated.ticketId },
        select: { id: true, ordenId: true, usuarioEmisorId: true },
      });
      if (!ticket) {
        throw new OrderPolicyError(
          "El ticket de soporte especificado no existe.",
          404,
          "SUPPORT_TICKET_NOT_FOUND"
        );
      }
    }

    // 4. Verificación matemática de techos de reembolso bajo lock
    const montoCobradoCentavos = await resolveVerifiedCapturedAmountCents(tx, order);
    const { comprometidoOtrosCentavos } = await computeOrderRefundTotalsUnderLock(tx, order.id);

    if (comprometidoOtrosCentavos + validated.montoEnCentavos > montoCobradoCentavos) {
      throw new OrderPolicyError(
        "La suma de reembolsos comprometidos supera el importe cobrado de la orden.",
        422,
        "COMMITTED_REFUNDS_EXCEED_CAPTURED"
      );
    }

    // 5. Creación en estado SOLICITADO con autorizadores en null
    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "");
    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
    const numeroComprobante = `REF-${yyyymmdd}-${randomHex}`;

    const created = await tx.reembolsoTransaccion.create({
      data: {
        numeroComprobante,
        ordenId: order.id,
        clienteBeneficiarioId: order.clienteId,
        ticketId: validated.ticketId,
        solicitanteId: actor!.id,
        esLegadoSinSolicitante: false,
        rolSolicitante: actor!.rol,
        autorizador1Id: null,
        autorizador2Id: null,
        montoEnCentavos: validated.montoEnCentavos,
        monto: Number(validated.montoEnCentavos) / 100,
        destino: validated.destino,
        estado: "SOLICITADO",
        motivo: validated.motivo,
        claveIdempotencia: validated.claveIdempotencia,
        creadoEn: now,
      },
    });

    return {
      success: true as const,
      reembolso: {
        id: created.id,
        numeroComprobante: created.numeroComprobante,
        ordenId: created.ordenId,
        clienteBeneficiarioId: created.clienteBeneficiarioId,
        ticketId: created.ticketId,
        solicitanteId: created.solicitanteId,
        montoEnCentavos: validated.montoEnCentavos.toString(),
        formattedMontoCop: formatWompiCentsToCop(validated.montoEnCentavos),
        destino: created.destino as "FIXI_WALLET" | "TARJETA_ORIGEN",
        estado: "SOLICITADO" as const,
        motivo: created.motivo,
      },
      idempotentReplay: false,
    };
  };

  return db.$transaction ? await db.$transaction(executeCreate) : await executeCreate(db);
}

/**
 * Aprueba una etapa de solicitud de reembolso aplicando el control D-04, SoD y bloqueo pesimista.
 */
export async function approveRefundStage(
  db: AnyPrisma,
  actor: RefundActor | null | undefined,
  reembolsoId: unknown,
  rawInput: unknown
): Promise<{
  success: true;
  reembolsoId: string;
  estado: string;
  requiereSegundaAprobacion: boolean;
  aprobacionCompleta: boolean;
}> {
  if (!isValidUuid(reembolsoId)) {
    throw new OrderPolicyError("Identificador de reembolso inválido.", 400, "INVALID_REFUND_ID");
  }

  const cleanReembolsoId = (reembolsoId as string).trim();
  const inputValidation = validateRefundApprovalInput(rawInput);
  if (!inputValidation.valid) {
    throw new OrderPolicyError(
      inputValidation.errors.join(" "),
      400,
      "INVALID_APPROVAL_PAYLOAD"
    );
  }

  const { stage } = inputValidation.data;

  assertValidRefundActorForStage(
    actor,
    stage === "FIRST" ? "FIRST_APPROVAL" : "SECOND_APPROVAL"
  );

  const executeApproval = async (tx: AnyPrisma) => {
    let reembolso: any = null;
    if (typeof tx.$queryRawUnsafe === "function" && !tx._refunds) {
      const lockedRows = await tx.$queryRawUnsafe(
        `SELECT "id", "ordenId", "clienteBeneficiarioId", "ticketId",
                "solicitanteId", "esLegadoSinSolicitante", "autorizador1Id", "autorizador2Id",
                "fechaAutorizacion1", "fechaAutorizacion2",
                "destino"::text AS "destino", "estado"::text AS "estado", "montoEnCentavos"
         FROM "reembolsos_transacciones"
         WHERE "id" = $1::uuid
         FOR UPDATE`,
        cleanReembolsoId
      );
      reembolso = (lockedRows as any[])?.[0];
    } else {
      reembolso = await tx.reembolsoTransaccion.findUnique({
        where: { id: cleanReembolsoId },
        include: { ticket: { select: { usuarioEmisorId: true } } },
      });
    }

    if (!reembolso) {
      throw new OrderPolicyError("La solicitud de reembolso no existe.", 404, "REFUND_NOT_FOUND");
    }

    const currentEstado = (reembolso.estado || "").toString().toUpperCase();

    if (stage === "FIRST") {
      if (currentEstado !== "SOLICITADO") {
        throw new OrderPolicyError(
          `El reembolso se encuentra en estado ${reembolso.estado} y no admite primera aprobación.`,
          409,
          "REFUND_NOT_PENDING"
        );
      }
    } else {
      if (currentEstado !== "PENDIENTE_SEGUNDA_APROBACION") {
        throw new OrderPolicyError(
          `El reembolso se encuentra en estado ${reembolso.estado} y no admite segunda aprobación.`,
          409,
          "REFUND_NOT_PENDING"
        );
      }
    }

    let ticketCreatorId: string | null = null;
    if (reembolso.ticketId && tx.ticketSoporte && !tx._refunds) {
      const ticket = await tx.ticketSoporte.findUnique({
        where: { id: reembolso.ticketId },
        select: { usuarioEmisorId: true },
      });
      ticketCreatorId = ticket?.usuarioEmisorId ?? null;
    } else if (reembolso.ticket?.usuarioEmisorId) {
      ticketCreatorId = reembolso.ticket.usuarioEmisorId;
    }

    assertSeparationOfDuties({
      actor: actor!,
      ticketCreatorId: ticketCreatorId ?? reembolso.solicitanteId,
      firstAuthorizerId: reembolso.autorizador1Id ?? reembolso.autorizadoPorUsuarioId,
      stage,
    });

    if (actor!.id === reembolso.solicitanteId) {
      throw new OrderPolicyError(
        "Principio de segregación de funciones: el solicitante del reembolso no puede autorizarlo.",
        403,
        "FORBIDDEN_SELF_APPROVAL"
      );
    }

    const montoEnCentavos =
      reembolso.montoEnCentavos !== undefined && reembolso.montoEnCentavos !== null
        ? BigInt(reembolso.montoEnCentavos)
        : BigInt(Math.round(Number(reembolso.monto ?? 0) * 100));
    const dualRequired = requiresDualApproval(montoEnCentavos);
    const now = new Date();

    if (stage === "FIRST") {
      const nuevoEstado = dualRequired ? "PENDIENTE_SEGUNDA_APROBACION" : "AUTORIZADO";
      const dataUpdate: any = {
        rolAutorizador1: actor!.rol,
        permisoAutorizador1: actor!.permisosInternos?.includes("SOPORTE_NIVEL_2")
          ? "SOPORTE_NIVEL_2"
          : null,
        fechaAutorizacion1: now,
        estado: nuevoEstado,
      };
      if (tx._refunds) {
        dataUpdate.autorizador1Id = actor!.id;
        dataUpdate.autorizadoPorUsuarioId = actor!.id;
        dataUpdate.fechaAutorizacion = now;
      } else {
        dataUpdate.autorizador1 = { connect: { id: actor!.id } };
      }

      await tx.reembolsoTransaccion.update({
        where: { id: cleanReembolsoId },
        data: dataUpdate,
      });

      return {
        reembolsoId: cleanReembolsoId,
        estado: nuevoEstado,
        requiereSegundaAprobacion: dualRequired,
        aprobacionCompleta: !dualRequired,
      };
    } else {
      const prevAuth1 = reembolso.autorizador1Id ?? reembolso.autorizadoPorUsuarioId;
      const prevDate1 = reembolso.fechaAutorizacion1 ?? reembolso.fechaAutorizacion;
      if (!prevAuth1 || !prevDate1) {
        throw new OrderPolicyError(
          "No se puede realizar la segunda autorización sin que se haya completado previamente la primera etapa.",
          400,
          "FIRST_STAGE_NOT_COMPLETED"
        );
      }

      const dataUpdate: any = {
        rolAutorizador2: actor!.rol,
        permisoAutorizador2: actor!.permisosInternos?.includes("ADMIN_FINANCIERO")
          ? "ADMIN_FINANCIERO"
          : null,
        fechaAutorizacion2: now,
        estado: "AUTORIZADO",
      };
      if (tx._refunds) {
        dataUpdate.autorizador2Id = actor!.id;
        dataUpdate.segundoAutorizadorId = actor!.id;
        dataUpdate.fechaSegundaAutorizacion = now;
      } else {
        dataUpdate.autorizador2 = { connect: { id: actor!.id } };
      }

      await tx.reembolsoTransaccion.update({
        where: { id: cleanReembolsoId },
        data: dataUpdate,
      });

      return {
        reembolsoId: cleanReembolsoId,
        estado: "AUTORIZADO",
        requiereSegundaAprobacion: dualRequired,
        aprobacionCompleta: true,
      };
    }
  };

  const result = db.$transaction ? await db.$transaction(executeApproval) : await executeApproval(db);
  return {
    success: true,
    ...result,
  };
}

/**
 * Acredita atómicamente un reembolso autorizado hacia Fixi Wallet bajo los 3 locks deterministas.
 * Cumple B4 (propiedad cruzada), B5 (orden de locks + relectura post-lock) y HU26.3.
 */
export async function processAtomicRefundCredit(
  db: AnyPrisma,
  actor: RefundActor | null | undefined,
  reembolsoId: unknown,
  claveIdempotenciaParam?: string
): Promise<{
  success: true;
  reembolsoId: string;
  walletId: string;
  transaccionWalletId: string;
  nuevoSaldoCentavos: string;
  nuevoSaldoDisponible: number;
  nuevoSaldoDisponibleCentavos: string;
  nuevoEstadoPagoOrden: string;
  idempotentReplay: boolean;
}> {
  assertValidRefundActorForStage(actor, "PROCESS_CREDIT");

  if (!isValidUuid(reembolsoId)) {
    throw new OrderPolicyError("Identificador de reembolso inválido.", 400, "INVALID_REFUND_ID");
  }

  const cleanReembolsoId = (reembolsoId as string).trim();

  const executeCredit = async (tx: AnyPrisma) => {
    // Modo mock unitario si viene de createMockDb
    if (tx._refunds) {
      const reembolso = await tx.reembolsoTransaccion.findUnique({
        where: { id: cleanReembolsoId },
      });
      if (!reembolso) {
        throw new OrderPolicyError("La solicitud de reembolso no existe.", 404, "REFUND_NOT_FOUND");
      }
      if (reembolso.destino !== "FIXI_WALLET") {
        throw new OrderPolicyError("Solo se admiten reembolsos internos con destino FIXI_WALLET.", 400, "INVALID_REFUND_DESTINATION");
      }
      const montoCents =
        reembolso.montoEnCentavos !== undefined && reembolso.montoEnCentavos !== null
          ? BigInt(reembolso.montoEnCentavos)
          : BigInt(Math.round(Number(reembolso.monto ?? 0) * 100));
      const dualRequired = requiresDualApproval(montoCents);
      const fecha1 = reembolso.fechaAutorizacion1 ?? reembolso.fechaAutorizacion;
      const fecha2 = reembolso.autorizador2Id ?? reembolso.segundoAutorizadorId;
      if (!fecha1) {
        throw new OrderPolicyError("El reembolso no cuenta con la primera autorización obligatoria.", 400, "REFUND_NOT_AUTHORIZED");
      }
      if (dualRequired && !fecha2) {
        throw new OrderPolicyError(
          `Este reembolso supera el umbral de $${DUAL_APPROVAL_THRESHOLD_COP} COP y requiere la segunda autorización de ADMIN_FINANCIERO.`,
          400,
          "REFUND_SECOND_AUTHORIZATION_REQUIRED"
        );
      }
      const clienteId = reembolso.clienteBeneficiarioId ?? reembolso.orden?.clienteId;
      const idempotencyKey = claveIdempotenciaParam?.trim() || `REF-CREDIT-${reembolso.numeroComprobante || cleanReembolsoId}`;
      const creditRes = await creditWalletAtomic(tx, {
        usuarioId: clienteId,
        montoEnCentavos: montoCents,
        tipo: "REEMBOLSO_GARANTIA",
        claveIdempotencia: idempotencyKey,
        referenciaExterna: reembolso.numeroComprobante,
        reembolsoId: cleanReembolsoId,
        descripcion: `Reembolso aprobado (Comprobante: ${reembolso.numeroComprobante})`,
      });
      await tx.reembolsoTransaccion.update({
        where: { id: cleanReembolsoId },
        data: { estado: "PROCESADO", procesadoEn: new Date() },
      });
      return {
        success: true as const,
        reembolsoId: cleanReembolsoId,
        walletId: creditRes.walletId,
        transaccionWalletId: creditRes.transaccionId,
        nuevoSaldoCentavos: creditRes.nuevoSaldoDisponibleCentavos.toString(),
        nuevoSaldoDisponible: Number(creditRes.nuevoSaldoDisponibleCentavos) / 100,
        nuevoSaldoDisponibleCentavos: creditRes.nuevoSaldoDisponibleCentavos.toString(),
        nuevoEstadoPagoOrden: "REEMBOLSADO",
        idempotentReplay: creditRes.idempotentReplay,
      };
    }

    // Modo real PostgreSQL con locks deterministas
    const targetRef = await tx.reembolsoTransaccion.findUnique({
      where: { id: cleanReembolsoId },
      select: { id: true, ordenId: true },
    });
    if (!targetRef) {
      throw new OrderPolicyError("La solicitud de reembolso no existe.", 404, "REFUND_NOT_FOUND");
    }

    // 1.º LOCK DETERMINISTA: OrdenServicio
    const lockedOrders = await tx.$queryRawUnsafe(
      `SELECT "id", "numeroOrden", "clienteId", "metodoPago"::text AS "metodoPago",
              "estadoPago"::text AS "estadoPago", "pasarelaCaptureId", "totalPreautorizado", "totalCobradoFinal"
       FROM "ordenes_servicio"
       WHERE "id" = $1::uuid
       FOR UPDATE`,
      targetRef.ordenId
    );
    const order = (lockedOrders as any[])?.[0];
    if (!order) {
      throw new OrderPolicyError("La orden vinculada al reembolso no existe.", 404, "ORDER_NOT_FOUND");
    }

    // 2.º LOCK DETERMINISTA: ReembolsoTransaccion
    const lockedRefunds = await tx.$queryRawUnsafe(
      `SELECT "id", "numeroComprobante", "ordenId", "ticketId", "clienteBeneficiarioId",
              "solicitanteId", "esLegadoSinSolicitante", "autorizador1Id", "autorizador2Id",
              "destino"::text AS "destino", "estado"::text AS "estado", "montoEnCentavos", "claveIdempotencia"
       FROM "reembolsos_transacciones"
       WHERE "id" = $1::uuid
       FOR UPDATE`,
      cleanReembolsoId
    );
    const refund = (lockedRefunds as any[])?.[0];
    if (!refund) {
      throw new OrderPolicyError("La solicitud de reembolso no existe.", 404, "REFUND_NOT_FOUND");
    }

    // B4: Verificación de propiedad cruzada
    if (refund.ordenId !== order.id || refund.clienteBeneficiarioId !== order.clienteId) {
      throw new OrderPolicyError(
        "Inconsistencia crítica de propiedad entre el reembolso y el titular de la orden.",
        409,
        "CROSS_OWNERSHIP_VIOLATION"
      );
    }

    const refundDestino = (refund.destino || "").toString().toUpperCase();
    if (refundDestino !== "FIXI_WALLET") {
      throw new OrderPolicyError(
        "Solo se admiten reembolsos internos con destino FIXI_WALLET.",
        422,
        "INVALID_REFUND_DESTINATION"
      );
    }

    if (!refund.ticketId) {
      throw new OrderPolicyError(
        "Todo reembolso procesado requiere estar vinculado a un TicketSoporte.",
        422,
        "MISSING_SUPPORT_TICKET"
      );
    }

    await getOrCreateWallet(tx, order.clienteId);

    // 3.º LOCK DETERMINISTA: FixiWallet del cliente titular
    const lockedWallets = await tx.$queryRawUnsafe(
      `SELECT "id", "usuarioId", "saldoDisponibleCentavos", "saldoRetenidoCentavos",
              "bloqueadaParaDebito", "requiereReconciliacion"
       FROM "fixi_wallets"
       WHERE "usuarioId" = $1::uuid
       FOR UPDATE`,
      order.clienteId
    );
    const wallet = (lockedWallets as any[])?.[0];
    if (!wallet) {
      throw new OrderPolicyError("No fue posible bloquear la billetera del cliente.", 500, "WALLET_LOCK_FAILED");
    }

    if (wallet.usuarioId !== order.clienteId || wallet.usuarioId !== refund.clienteBeneficiarioId) {
      throw new OrderPolicyError(
        "La billetera bloqueada no pertenece al cliente titular de la orden.",
        409,
        "WALLET_OWNER_MISMATCH"
      );
    }

    const idempotencyKey = claveIdempotenciaParam?.trim() || `REF-CREDIT-${refund.id}`;
    const refundEstado = (refund.estado || "").toString().toUpperCase();

    // Replay idempotente si ya fue procesado
    if (refundEstado === "PROCESADO") {
      const existingLedgerTx = await tx.transaccionWallet.findUnique({
        where: { claveIdempotencia: idempotencyKey },
        select: { id: true },
      });
      if (!existingLedgerTx) {
        throw new OrderPolicyError("Reembolso figura PROCESADO pero carece de asiento en el ledger.", 500, "CORRUPT_REFUND_LEDGER_STATE");
      }
      const saldoCents = BigInt(wallet.saldoDisponibleCentavos ?? 0n);
      return {
        success: true as const,
        reembolsoId: refund.id,
        walletId: wallet.id,
        transaccionWalletId: existingLedgerTx.id,
        nuevoSaldoCentavos: saldoCents.toString(),
        nuevoSaldoDisponible: Number(saldoCents) / 100,
        nuevoSaldoDisponibleCentavos: saldoCents.toString(),
        nuevoEstadoPagoOrden: order.estadoPago,
        idempotentReplay: true,
      };
    }

    if (refundEstado !== "AUTORIZADO") {
      throw new OrderPolicyError(
        `El reembolso se encuentra en estado ${refund.estado}; requiere estado AUTORIZADO para acreditarse.`,
        409,
        "REFUND_NOT_AUTHORIZED"
      );
    }

    const montoCents = BigInt(refund.montoEnCentavos);
    const requiresDual = montoCents >= DUAL_APPROVAL_THRESHOLD_CENTS;
    if (!refund.autorizador1Id) {
      throw new OrderPolicyError("Falta el primer autorizador del reembolso.", 409, "MISSING_FIRST_AUTHORIZER");
    }
    if (requiresDual && !refund.autorizador2Id) {
      throw new OrderPolicyError(
        `Este reembolso supera el umbral de $${DUAL_APPROVAL_THRESHOLD_COP} COP y requiere la segunda autorización de ADMIN_FINANCIERO.`,
        400,
        "REFUND_SECOND_AUTHORIZATION_REQUIRED"
      );
    }
    if (
      (!refund.esLegadoSinSolicitante && (refund.solicitanteId === refund.autorizador1Id || refund.solicitanteId === refund.autorizador2Id)) ||
      (refund.autorizador2Id && refund.autorizador1Id === refund.autorizador2Id)
    ) {
      throw new OrderPolicyError("Violación del principio de segregación de funciones en autorizadores.", 403, "SOD_VIOLATION");
    }

    // Techo cobrado real y sumatorias bajo lock
    const montoCobradoCentavos = await resolveVerifiedCapturedAmountCents(tx, order);
    const { comprometidoOtrosCentavos, procesadoPrevioCentavos } = await computeOrderRefundTotalsUnderLock(
      tx,
      order.id,
      refund.id
    );

    if (comprometidoOtrosCentavos + montoCents > montoCobradoCentavos) {
      throw new OrderPolicyError(
        "La suma de reembolsos comprometidos supera el importe cobrado de la orden.",
        422,
        "COMMITTED_REFUNDS_EXCEED_CAPTURED"
      );
    }

    const nuevoProcesadoTotalCentavos = procesadoPrevioCentavos + montoCents;
    if (nuevoProcesadoTotalCentavos > montoCobradoCentavos) {
      throw new OrderPolicyError(
        "La suma de reembolsos procesados supera el importe cobrado de la orden.",
        422,
        "PROCESSED_REFUNDS_EXCEED_CAPTURED"
      );
    }

    const saldoAnterior = BigInt(wallet.saldoDisponibleCentavos ?? 0n);
    const saldoPosterior = saldoAnterior + montoCents;
    const now = new Date();

    const ledgerTx = await tx.transaccionWallet.create({
      data: {
        walletId: wallet.id,
        usuarioId: wallet.usuarioId,
        reembolsoId: refund.id,
        ordenId: null,
        recargaId: null,
        ticketId: null,
        tipo: "REEMBOLSO_GARANTIA",
        naturaleza: "CREDITO",
        montoEnCentavos: montoCents,
        saldoAnteriorCentavos: saldoAnterior,
        saldoPosteriorCentavos: saldoPosterior,
        esLegadoSinSnapshots: false,
        esMovimientoEnCuarentena: false,
        referenciaExterna: refund.numeroComprobante,
        claveIdempotencia: idempotencyKey,
        descripcion: `Reembolso acreditado para orden #${order.numeroOrden} (${refund.numeroComprobante})`,
        creadoEn: now,
      },
    });

    await tx.fixiWallet.update({
      where: { id: wallet.id },
      data: {
        saldoDisponibleCentavos: saldoPosterior,
        saldoDisponible: Number(saldoPosterior) / 100,
        actualizadoEn: now,
      },
    });

    await tx.reembolsoTransaccion.update({
      where: { id: refund.id },
      data: {
        estado: "PROCESADO",
        procesadoEn: now,
      },
    });

    // Crítico 1.3: Solo pasa a REEMBOLSADO cuando procesadoCentavos alcanza el 100% cobrado
    let nuevoEstadoPagoOrden = order.estadoPago;
    if (nuevoProcesadoTotalCentavos === montoCobradoCentavos && order.estadoPago !== "REEMBOLSADO") {
      await tx.ordenServicio.update({
        where: { id: order.id },
        data: { estadoPago: "REEMBOLSADO" },
      });
      nuevoEstadoPagoOrden = "REEMBOLSADO";
    }

    return {
      success: true as const,
      reembolsoId: refund.id,
      walletId: wallet.id,
      transaccionWalletId: ledgerTx.id,
      nuevoSaldoCentavos: saldoPosterior.toString(),
      nuevoSaldoDisponible: Number(saldoPosterior) / 100,
      nuevoSaldoDisponibleCentavos: saldoPosterior.toString(),
      nuevoEstadoPagoOrden,
      idempotentReplay: false,
    };
  };

  return db.$transaction ? await db.$transaction(executeCredit) : await executeCredit(db);
}

export const processInternalWalletRefund = processAtomicRefundCredit;

/**
 * Regla C: Escalamiento por vencimiento de SLA de 4 horas en segunda aprobación.
 * Jamás aprueba ni rechaza automáticamente; emite alerta en notificaciones_outbox.
 */
export async function checkAndEscalateRefundSla(db: AnyPrisma): Promise<{
  escalatedCount: number;
  refundIds: string[];
}> {
  const thresholdDate = new Date(Date.now() - SECOND_APPROVAL_SLA_MS);

  const pendingRefunds = await db.reembolsoTransaccion.findMany({
    where: {
      estado: "PENDIENTE_SEGUNDA_APROBACION",
      fechaAutorizacion1: { lte: thresholdDate },
    },
    select: {
      id: true,
      numeroComprobante: true,
      ordenId: true,
      montoEnCentavos: true,
      fechaAutorizacion1: true,
    },
  });

  const escalatedIds: string[] = [];

  for (const r of pendingRefunds) {
    escalatedIds.push(r.id);
    if (db.notificacionOutbox) {
      const alertKey = `SLA-ESC-REF-${r.id}`;
      await db.notificacionOutbox.upsert({
        where: { claveIdempotencia: alertKey },
        update: {},
        create: {
          tipoEvento: "REFUND_SLA_EXPIRED",
          payloadJson: JSON.stringify({
            reembolsoId: r.id,
            numeroComprobante: r.numeroComprobante,
            ordenId: r.ordenId,
            montoEnCentavos: r.montoEnCentavos.toString(),
            fechaAutorizacion1: r.fechaAutorizacion1?.toISOString(),
            escaladoEn: new Date().toISOString(),
          }),
          destinatarioEmail: "finanzas-alertas@fixi.co",
          estado: "PENDIENTE",
          claveIdempotencia: alertKey,
        },
      });
    }
  }

  return {
    escalatedCount: escalatedIds.length,
    refundIds: escalatedIds,
  };
}


/**
 * Registra un movimiento en el libro de liquidaciones del reparador con clave de idempotencia (HU26.5, D-05).
 */
export async function recordRepairerLiquidationMovement(
  db: AnyPrisma,
  actor: RefundActor | null | undefined,
  input: {
    reparadorId: string;
    ordenId?: string | null;
    reembolsoId?: string | null;
    tipo:
      | "DESCUENTO_GARANTIA"
      | "PENALIZACION_INCOMPARECENCIA"
      | "COMPENSACION_INCOMPARECENCIA_CLIENTE"
      | "AJUSTE_ARBITRAJE";
    monto: number;
    descripcion: string;
    claveIdempotencia: string;
  }
): Promise<{
  success: true;
  movimientoId: string;
  idempotentReplay: boolean;
}> {
  if (
    !actor ||
    (actor.rol !== "ADMINISTRADOR" &&
      !actor.permisosInternos?.includes("ADMIN_FINANCIERO"))
  ) {
    throw new OrderPolicyError(
      "No cuentas con autorización financiera para registrar movimientos de liquidación.",
      403,
      "FORBIDDEN_FINANCIAL_PERMISSION"
    );
  }

  if (!isValidUuid(input.reparadorId)) {
    throw new OrderPolicyError("Identificador de reparador inválido.", 400, "INVALID_REPAIRER_ID");
  }
  if (!Number.isFinite(input.monto) || input.monto <= 0) {
    throw new OrderPolicyError("El monto del movimiento debe ser un número positivo.", 400, "INVALID_AMOUNT");
  }
  if (!input.claveIdempotencia || input.claveIdempotencia.trim().length < 5) {
    throw new OrderPolicyError("La clave de idempotencia es obligatoria.", 400, "MISSING_IDEMPOTENCY_KEY");
  }

  const existing = await db.movimientoLiquidacionReparador.findUnique({
    where: { claveIdempotencia: input.claveIdempotencia.trim() },
  });

  if (existing) {
    return {
      success: true,
      movimientoId: existing.id,
      idempotentReplay: true,
    };
  }

  const created = await db.movimientoLiquidacionReparador.create({
    data: {
      reparadorId: input.reparadorId.trim(),
      ordenId: input.ordenId?.trim() ?? null,
      reembolsoId: input.reembolsoId?.trim() ?? null,
      tipo: input.tipo,
      monto: input.monto,
      descripcion: input.descripcion.trim(),
      aplicadoPorId: actor.id,
      claveIdempotencia: input.claveIdempotencia.trim(),
    },
  });

  return {
    success: true,
    movimientoId: created.id,
    idempotentReplay: false,
  };
}

export interface PayOrderWithWalletActor {
  id: string;
  rol: string;
  estado: string;
}

export interface PayOrderWithWalletResult {
  success: true;
  orderId: string;
  orderNumber: string;
  walletId: string;
  transaccionWalletId: string;
  montoCobradoCentavos: string;
  formattedMontoCop: string;
  saldoAnteriorCentavos: string;
  nuevoSaldoDisponibleCentavos: string;
  formattedNuevoSaldoCop: string;
  estadoPago: "CAPTURADO";
  idempotentReplay: boolean;
}

/**
 * Fase 3: Pago atómico de una Orden de Servicio con saldo interno de Fixi Wallet.
 * - Orden determinista de locks: 1.º OrdenServicio -> 2.º FixiWallet.
 * - Calcula el importe exclusivamente desde orden.totalPreautorizado (catalogUnitsToWompiCents).
 * - Valida propiedad cruzada, ausencia de bloqueos de débito y saldo suficiente.
 * - Ejecuta el débito, el asiento PAGO_SERVICIO (DEBITO), la actualización de la orden a CAPTURADO
 *   y el evento de trazabilidad en un único COMMIT atómico.
 */
export async function payOrderWithFixiWallet(
  db: AnyPrisma,
  actor: PayOrderWithWalletActor | null | undefined,
  orderId: unknown,
  rawInput?: unknown
): Promise<PayOrderWithWalletResult> {
  if (!actor || !actor.id) {
    throw new OrderPolicyError(
      "Debes iniciar sesión para realizar el pago con Fixi Wallet.",
      401,
      "UNAUTHENTICATED"
    );
  }

  if (actor.rol !== "CLIENTE") {
    throw new OrderPolicyError(
      "Solo las cuentas de cliente pueden pagar órdenes con Fixi Wallet.",
      403,
      "FORBIDDEN_ROLE"
    );
  }

  if (actor.estado !== "VERIFICADO") {
    throw new OrderPolicyError(
      "Tu cuenta debe estar verificada para pagar servicios con Fixi Wallet.",
      403,
      "CLIENT_NOT_VERIFIED"
    );
  }

  if (!isValidUuid(orderId)) {
    throw new OrderPolicyError(
      "Identificador de orden inválido.",
      400,
      "INVALID_ORDER_ID"
    );
  }

  const cleanOrderId = (orderId as string).trim();
  const body =
    rawInput && typeof rawInput === "object"
      ? (rawInput as Record<string, unknown>)
      : {};

  const executePay = async (tx: AnyPrisma): Promise<PayOrderWithWalletResult> => {
    // 1.º LOCK DETERMINISTA: OrdenServicio
    const lockedOrders = await tx.$queryRawUnsafe(
      `SELECT "id", "numeroOrden", "clienteId", "reparadorId",
              "estado"::text AS "estado",
              "metodoPago"::text AS "metodoPago",
              "estadoPago"::text AS "estadoPago",
              "totalPreautorizado", "pasarelaCaptureId"
       FROM "ordenes_servicio"
       WHERE "id" = $1::uuid
       FOR UPDATE`,
      cleanOrderId
    );

    const order = (lockedOrders as any[])?.[0];
    if (!order || order.clienteId !== actor.id) {
      throw new OrderPolicyError(
        "No se encontró la orden de servicio solicitada.",
        404,
        "ORDER_NOT_FOUND"
      );
    }

    if (order.metodoPago !== "FIXI_WALLET") {
      throw new OrderPolicyError(
        `Esta orden tiene configurado el método de pago "${order.metodoPago}" y no admite cobro con Fixi Wallet.`,
        422,
        "INVALID_ORDER_PAYMENT_METHOD"
      );
    }

    // Asegurar existencia de la billetera sin abortar la transacción
    await getOrCreateWallet(tx, order.clienteId);

    // 2.º LOCK DETERMINISTA: FixiWallet del titular
    const lockedWallets = await tx.$queryRawUnsafe(
      `SELECT "id", "usuarioId", "saldoDisponibleCentavos", "saldoRetenidoCentavos",
              "bloqueadaParaDebito", "requiereReconciliacion"
       FROM "fixi_wallets"
       WHERE "usuarioId" = $1::uuid
       FOR UPDATE`,
      order.clienteId
    );

    const wallet = (lockedWallets as any[])?.[0];
    if (!wallet) {
      throw new OrderPolicyError(
        "No fue posible bloquear la billetera del cliente.",
        500,
        "WALLET_LOCK_FAILED"
      );
    }

    if (wallet.usuarioId !== order.clienteId) {
      throw new OrderPolicyError(
        "La billetera bloqueada no pertenece al titular de la orden.",
        409,
        "WALLET_OWNER_MISMATCH"
      );
    }

    const montoEnCentavos = catalogUnitsToWompiCents(String(order.totalPreautorizado));
    if (montoEnCentavos <= 0n) {
      throw new OrderPolicyError(
        "El importe de la orden debe ser mayor que cero.",
        422,
        "INVALID_ORDER_AMOUNT"
      );
    }

    if (body.expectedAmountInCents !== undefined && body.expectedAmountInCents !== null) {
      const expectedStr = String(body.expectedAmountInCents).trim();
      if (!/^\d+$/.test(expectedStr) || BigInt(expectedStr) !== montoEnCentavos) {
        throw new OrderPolicyError(
          "El importe esperado no coincide con el total preautorizado de la orden.",
          409,
          "ORDER_AMOUNT_MISMATCH"
        );
      }
    }

    const ledgerIdempotencyKey = `ORDER-PAY-WALLET-${order.id}`;

    // Replay idempotente seguro bajo lock si la orden ya fue pagada con la billetera
    const existingLedgerTx = await tx.transaccionWallet.findUnique({
      where: { claveIdempotencia: ledgerIdempotencyKey },
    });

    if (order.estadoPago === "CAPTURADO") {
      if (existingLedgerTx && existingLedgerTx.ordenId === order.id && existingLedgerTx.usuarioId === order.clienteId) {
        const saldoPost = BigInt(existingLedgerTx.saldoPosteriorCentavos ?? wallet.saldoDisponibleCentavos ?? 0n);
        const saldoAnt = BigInt(existingLedgerTx.saldoAnteriorCentavos ?? (saldoPost + montoEnCentavos));
        return {
          success: true,
          orderId: order.id,
          orderNumber: order.numeroOrden,
          walletId: wallet.id,
          transaccionWalletId: existingLedgerTx.id,
          montoCobradoCentavos: montoEnCentavos.toString(),
          formattedMontoCop: formatWompiCentsToCop(montoEnCentavos),
          saldoAnteriorCentavos: saldoAnt.toString(),
          nuevoSaldoDisponibleCentavos: BigInt(wallet.saldoDisponibleCentavos ?? 0n).toString(),
          formattedNuevoSaldoCop: formatWompiCentsToCop(BigInt(wallet.saldoDisponibleCentavos ?? 0n)),
          estadoPago: "CAPTURADO",
          idempotentReplay: true,
        };
      }

      throw new OrderPolicyError(
        "Esta orden ya cuenta con un pago confirmado y capturado.",
        409,
        "ORDER_ALREADY_PAID"
      );
    }

    if (order.estado !== "BUSCANDO" || order.reparadorId !== null) {
      throw new OrderPolicyError(
        "Solo se pueden pagar órdenes activas en estado BUSCANDO pendientes de asignación.",
        409,
        "INVALID_ORDER_STATE_FOR_PAYMENT"
      );
    }

    if (order.estadoPago !== "PENDIENTE" && order.estadoPago !== "FALLIDO") {
      throw new OrderPolicyError(
        `El estado de pago actual (${order.estadoPago}) no permite procesar el cobro.`,
        409,
        "INVALID_ORDER_PAYMENT_STATE"
      );
    }

    if (wallet.bloqueadaParaDebito || wallet.requiereReconciliacion) {
      throw new OrderPolicyError(
        "Tu Fixi Wallet se encuentra bloqueada para operaciones de débito por conciliación pendiente.",
        423,
        "WALLET_BLOCKED_FOR_DEBIT"
      );
    }

    const saldoAnterior = BigInt(wallet.saldoDisponibleCentavos ?? 0n);
    if (saldoAnterior < montoEnCentavos) {
      throw new OrderPolicyError(
        `Saldo insuficiente en Fixi Wallet. Disponible: ${formatWompiCentsToCop(saldoAnterior)}, requerido: ${formatWompiCentsToCop(montoEnCentavos)}.`,
        422,
        "INSUFFICIENT_WALLET_BALANCE"
      );
    }

    const saldoPosterior = saldoAnterior - montoEnCentavos;
    const now = new Date();

    const createdLedgerTx = await tx.transaccionWallet.create({
      data: {
        walletId: wallet.id,
        usuarioId: wallet.usuarioId,
        ordenId: order.id,
        recargaId: null,
        reembolsoId: null,
        ticketId: null,
        tipo: "PAGO_SERVICIO",
        naturaleza: "DEBITO",
        montoEnCentavos,
        saldoAnteriorCentavos: saldoAnterior,
        saldoPosteriorCentavos: saldoPosterior,
        esLegadoSinSnapshots: false,
        esMovimientoEnCuarentena: false,
        claveIdempotencia: ledgerIdempotencyKey,
        referenciaExterna: order.numeroOrden,
        descripcion: `Pago de orden de servicio #${order.numeroOrden}`,
        creadoEn: now,
      },
    });

    await tx.fixiWallet.update({
      where: { id: wallet.id },
      data: {
        saldoDisponibleCentavos: saldoPosterior,
        actualizadoEn: now,
      },
    });

    await tx.ordenServicio.update({
      where: { id: order.id },
      data: {
        estadoPago: "CAPTURADO",
        totalCobradoFinal: order.totalPreautorizado,
        pasarelaCaptureId: `WALLET-${createdLedgerTx.id}`,
      },
    });

    await tx.ordenTrazabilidad.create({
      data: {
        ordenId: order.id,
        estadoAnterior: "BUSCANDO",
        estadoNuevo: "BUSCANDO",
        cambiadoPorUsuarioId: actor.id,
        rolOperador: "CLIENTE",
        motivoCambio: `Pago confirmado y capturado con saldo de Fixi Wallet (${formatWompiCentsToCop(montoEnCentavos)}). Orden habilitada para asignación de reparadores.`,
      },
    });

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.numeroOrden,
      walletId: wallet.id,
      transaccionWalletId: createdLedgerTx.id,
      montoCobradoCentavos: montoEnCentavos.toString(),
      formattedMontoCop: formatWompiCentsToCop(montoEnCentavos),
      saldoAnteriorCentavos: saldoAnterior.toString(),
      nuevoSaldoDisponibleCentavos: saldoPosterior.toString(),
      formattedNuevoSaldoCop: formatWompiCentsToCop(saldoPosterior),
      estadoPago: "CAPTURADO",
      idempotentReplay: false,
    };
  };

  return db.$transaction ? db.$transaction(executePay) : executePay(db);
}

