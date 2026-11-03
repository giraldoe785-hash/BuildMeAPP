/**
 * lib/walletTopUpService.ts
 *
 * Fase 2 Fixi Wallet: recargas vía Wompi Sandbox con acreditación idempotente.
 *
 * Reglas:
 *  - El saldo SOLO se acredita tras confirmación canónica APPROVED consultada a Wompi
 *    (webhook o verify). Una simple redirección del navegador jamás acredita.
 *  - Orden de locks determinista: recargas_wallet -> intentos_pago_wompi -> fixi_wallets.
 *  - Una (usuario, clave de idempotencia) genera exactamente 1 RecargaWallet.
 *  - Un único CREDITO por recarga (clave `topup-credit-{recargaId}` + lock de fila).
 *  - Prohibido saldo negativo: la anulación post-gasto abre disputa y bloquea débitos.
 */

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { formatWompiCentsToCop } from "./pricing";
import {
  WOMPI_CURRENCY_COP,
  buildWompiIntegritySignature,
  resolveCanonicalProviderStatus,
  validateChargeableWompiAmount,
  validateWompiEnvironmentConfig,
  type LocalPaymentIntentStatus,
  type WompiRemoteTransactionStatus,
} from "./paymentPolicy";
import {
  WOMPI_CHECKOUT_EXPIRATION_MS,
  WompiServiceError,
  assertVerifiedClientActor,
  mapPolicyErrorToServiceError,
  parseAttemptMetadata,
  resolveValidatedRedirectUrl,
  toBigIntCents,
  type ApplyCanonicalTransitionInput,
  type WompiAttemptMetadataV1,
  type WompiRuntimeOptions,
  type WompiWebCheckoutFormParams,
} from "./wompiService";
import type { OrderActor } from "./orderService";
import { creditWalletAtomic, debitWalletAtomic, getOrCreateWallet } from "./walletService";
import { calculateSlaDeadline, generateTicketNumber } from "./supportPolicy";
import {
  TopUpPolicyError,
  assertTopUpWithinLimits,
  buildScopedTopUpKey,
  buildTopUpCreditKey,
  buildTopUpVoidKey,
  evaluateTopUpTransition,
  parseTopUpAmountCents,
  resolveTopUpLimits,
  validateTopUpIdempotencyKey,
  type TopUpAction,
  type TopUpIncidentCode,
  type TopUpRecargaState,
} from "./walletTopUpPolicy";

const TOPUP_RETURN_PATH = "/pagos/resultado";
const CHECKOUT_REUSE_SAFETY_MARGIN_MS = 60 * 1000;

export interface PreparedTopUpCheckout {
  kind: "TOPUP";
  recargaId: string;
  intentId: string;
  recargaEstado: TopUpRecargaState;
  amountInCents: string;
  formattedAmountCop: string;
  expirationTime: string;
  reusedExistingAttempt: boolean;
  idempotentReplay: boolean;
  checkoutUrl: "https://checkout.wompi.co/p/";
  method: "GET";
  params: WompiWebCheckoutFormParams;
}

export interface CanonicalTopUpOutcome {
  kind: "TOPUP";
  recargaId: string;
  intentId: string;
  reference: string;
  transactionId: string;
  providerStatus: WompiRemoteTransactionStatus;
  intentStatus: LocalPaymentIntentStatus;
  recargaEstado: TopUpRecargaState;
  amountInCents: string;
  formattedAmountCop: string;
  creditedCents: string;
  idempotentReplay: boolean;
  effectiveFinancialMutation: boolean;
  incidentCode: TopUpIncidentCode | null;
  supportTicketCreated: boolean;
  walletBlockedForDebit: boolean;
}

interface LockedRecargaRow {
  id: string;
  walletId: string;
  usuarioId: string;
  montoEnCentavos: bigint | string | number;
  montoEnDisputaCentavos: bigint | string | number;
  estado: string;
  ticketSoporteId: string | null;
  claveIdempotencia: string;
}

interface LockedTopUpAttemptRow {
  id: string;
  recargaId: string | null;
  referenciaWompi: string;
  montoEnCentavos: bigint | string | number;
  moneda: string;
  estado: string;
  estadoProveedor: string | null;
  wompiTransactionId: string | null;
  firmaIntegridad: string;
  datosRespuestaJson: string | null;
  creadoEn: Date;
}

const PROVIDER_TO_INTENT: Record<WompiRemoteTransactionStatus, LocalPaymentIntentStatus> = {
  PENDING: "PENDIENTE",
  APPROVED: "APROBADO",
  DECLINED: "RECHAZADO",
  ERROR: "FALLIDO",
  VOIDED: "ANULADO",
};

function mapTopUpPolicyError(err: unknown): never {
  if (err instanceof TopUpPolicyError) {
    throw new WompiServiceError(err.message, err.status, err.code, false);
  }
  throw mapPolicyErrorToServiceError(err);
}

function buildTopUpReference(recargaId: string, attemptId: string, seq: number): string {
  const r = recargaId.replace(/-/g, "").toUpperCase();
  const a = attemptId.replace(/-/g, "").toUpperCase();
  return `FXW-${r}-A${seq}-${a}`;
}

async function generateUniqueTicketNumber(
  tx: Prisma.TransactionClient,
  now: Date
): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const candidate = generateTicketNumber(now);
    const exists = await tx.ticketSoporte.findUnique({
      where: { numeroTicket: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new WompiServiceError(
    "No fue posible generar un número de ticket único.",
    500,
    "TICKET_NUMBER_EXHAUSTED",
    true
  );
}

function buildReturnUrl(
  env: Readonly<Record<string, string | undefined>>,
  _requestOrigin?: string | null
): string | undefined {
  return resolveValidatedRedirectUrl(env, null, TOPUP_RETURN_PATH);
}

/**
 * Crea (o reproduce de forma idempotente) una recarga y su checkout Wompi Sandbox.
 * Misma (usuario, clave) + mismo monto => mismo checkout. Monto distinto => 409.
 */
export async function createOrReplayTopUp(
  db: PrismaClient,
  actor: OrderActor | null | undefined,
  input: { amountInCents: unknown; idempotencyKey: unknown },
  options?: WompiRuntimeOptions
): Promise<PreparedTopUpCheckout> {
  assertVerifiedClientActor(actor);

  const env = options?.env ?? process.env;
  const nowFn = options?.now ?? (() => new Date());

  let amountCents: bigint;
  let clientKey: string;
  let config;
  try {
    amountCents = parseTopUpAmountCents(input.amountInCents);
    clientKey = validateTopUpIdempotencyKey(input.idempotencyKey);
    assertTopUpWithinLimits(amountCents, resolveTopUpLimits(env));
    config = validateWompiEnvironmentConfig(env);
    validateChargeableWompiAmount(amountCents, {
      minAmountInCents: config.minChargeableCopCents,
    });
  } catch (err) {
    mapTopUpPolicyError(err);
  }

  const redirectUrl = buildReturnUrl(env, options?.requestOrigin);
  const scopedKey = buildScopedTopUpKey(actor.id, clientKey);

  return await db.$transaction(
    async (tx) => {
      const now = nowFn();
      const nowMs = now.getTime();
      const wallet = await getOrCreateWallet(tx, actor.id);

      const candidateId = randomUUID();
      const inserted = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          INSERT INTO "recargas_wallet" (
            "id","walletId","usuarioId","montoEnCentavos","montoEnDisputaCentavos",
            "estado","estadoConciliacion","claveIdempotencia","creadoEn","actualizadoEn"
          ) VALUES (
            ${candidateId}::uuid, ${wallet.walletId}::uuid, ${actor.id}::uuid, ${amountCents}, 0,
            'PENDIENTE'::"estado_recarga_wallet", 'CONCILIADO'::"estado_conciliacion_recarga",
            ${scopedKey}, ${now}, ${now}
          )
          ON CONFLICT ("claveIdempotencia") DO NOTHING
          RETURNING "id"
        `
      );

      const isReplay = inserted.length === 0;
      const rows = await tx.$queryRaw<LockedRecargaRow[]>(
        Prisma.sql`
          SELECT "id","walletId","usuarioId","montoEnCentavos","montoEnDisputaCentavos",
                 "estado"::text AS "estado","ticketSoporteId","claveIdempotencia"
          FROM "recargas_wallet"
          WHERE "claveIdempotencia" = ${scopedKey}
          FOR UPDATE
        `
      );
      const recarga = rows[0];
      if (!recarga || recarga.usuarioId !== actor.id) {
        throw new WompiServiceError(
          "No fue posible resolver la recarga solicitada.",
          500,
          "TOPUP_RESOLUTION_FAILED",
          true
        );
      }

      if (isReplay && toBigIntCents(recarga.montoEnCentavos) !== amountCents) {
        throw new WompiServiceError(
          "La clave de idempotencia ya fue utilizada con un monto distinto.",
          409,
          "IDEMPOTENCY_AMOUNT_MISMATCH",
          false
        );
      }

      const existingAttempts = await tx.$queryRaw<LockedTopUpAttemptRow[]>(
        Prisma.sql`
          SELECT "id","recargaId","referenciaWompi","montoEnCentavos","moneda",
                 "estado"::text AS "estado","estadoProveedor","wompiTransactionId",
                 "firmaIntegridad","datosRespuestaJson","creadoEn"
          FROM "intentos_pago_wompi"
          WHERE "recargaId" = ${recarga.id}::uuid
          ORDER BY "id" ASC
          FOR UPDATE
        `
      );

      if (recarga.estado !== "PENDIENTE") {
        throw new WompiServiceError(
          `La recarga ya no admite checkout (estado ${recarga.estado}). Usa una nueva clave de idempotencia.`,
          409,
          "TOPUP_NOT_PENDING",
          false
        );
      }

      const current = existingAttempts[existingAttempts.length - 1];
      if (current) {
        const meta = parseAttemptMetadata(current.datosRespuestaJson, current.creadoEn);
        const expMs = Date.parse(meta.expirationTime);
        const unexpired =
          !Number.isNaN(expMs) && nowMs + CHECKOUT_REUSE_SAFETY_MARGIN_MS < expMs;

        if (current.estado === "PENDIENTE" && unexpired) {
          const effectiveRedirect = meta.redirectUrl || redirectUrl;
          return {
            kind: "TOPUP" as const,
            recargaId: recarga.id,
            intentId: current.id,
            recargaEstado: "PENDIENTE" as TopUpRecargaState,
            amountInCents: amountCents.toString(),
            formattedAmountCop: formatWompiCentsToCop(amountCents),
            expirationTime: meta.expirationTime,
            reusedExistingAttempt: true,
            idempotentReplay: true,
            checkoutUrl: config.checkoutUrl,
            method: "GET" as const,
            params: {
              "public-key": config.publicKey,
              currency: WOMPI_CURRENCY_COP,
              "amount-in-cents": amountCents.toString(),
              reference: current.referenciaWompi,
              "signature:integrity": current.firmaIntegridad,
              "expiration-time": meta.expirationTime,
              ...(effectiveRedirect ? { "redirect-url": effectiveRedirect } : {}),
            },
          };
        }

        if (current.wompiTransactionId) {
          throw new WompiServiceError(
            "Existe una transacción de recarga en procesamiento. Espera su confirmación.",
            409,
            "TOPUP_IN_PROGRESS",
            false
          );
        }

        // Intento vencido sin transacción remota: cierre local seguro.
        await tx.intentoPagoWompi.update({
          where: { id: current.id },
          data: { estado: "ANULADO", estadoProveedor: "EXPIRED_UNUSED", actualizadoEn: now },
        });
        await tx.$executeRaw(
          Prisma.sql`
            UPDATE "recargas_wallet"
            SET "estado" = 'EXPIRADA_LOCALMENTE'::"estado_recarga_wallet",
                "actualizadoEn" = ${now}
            WHERE "id" = ${recarga.id}::uuid
          `
        );
        throw new WompiServiceError(
          "La recarga expiró sin pago. Inicia una nueva con otra clave de idempotencia.",
          409,
          "TOPUP_EXPIRED",
          false
        );
      }

      const attemptId = randomUUID();
      const attemptSequence = 1;
      const expirationTime = new Date(nowMs + WOMPI_CHECKOUT_EXPIRATION_MS).toISOString();

      let reference: string;
      let signature: string;
      try {
        reference = buildTopUpReference(recarga.id, attemptId, attemptSequence);
        signature = buildWompiIntegritySignature({
          reference,
          amountInCents: amountCents,
          currency: WOMPI_CURRENCY_COP,
          integritySecret: config.integritySecret,
          expirationTime,
        });
      } catch (err) {
        throw mapPolicyErrorToServiceError(err);
      }

      const metadata: WompiAttemptMetadataV1 = {
        version: 1,
        attemptSequence,
        createdAtIso: now.toISOString(),
        expirationTime,
        redirectUrl: redirectUrl ?? "",
        observations: [],
        archivedTransactionIds: [],
        lastAnomalyCode: null,
      };

      await tx.intentoPagoWompi.create({
        data: {
          id: attemptId,
          ordenId: null,
          recargaId: recarga.id,
          referenciaWompi: reference,
          montoEnCentavos: amountCents,
          moneda: WOMPI_CURRENCY_COP,
          estado: "PENDIENTE",
          estadoProveedor: null,
          ambiente: "test",
          wompiTransactionId: null,
          firmaIntegridad: signature,
          datosRespuestaJson: JSON.stringify(metadata),
          creadoEn: now,
          actualizadoEn: now,
        },
      });

      return {
        kind: "TOPUP" as const,
        recargaId: recarga.id,
        intentId: attemptId,
        recargaEstado: "PENDIENTE" as TopUpRecargaState,
        amountInCents: amountCents.toString(),
        formattedAmountCop: formatWompiCentsToCop(amountCents),
        expirationTime,
        reusedExistingAttempt: false,
        idempotentReplay: isReplay,
        checkoutUrl: config.checkoutUrl,
        method: "GET" as const,
        params: {
          "public-key": config.publicKey,
          currency: WOMPI_CURRENCY_COP,
          "amount-in-cents": amountCents.toString(),
          reference,
          "signature:integrity": signature,
          "expiration-time": expirationTime,
          ...(redirectUrl ? { "redirect-url": redirectUrl } : {}),
        },
      };
    },
    { maxWait: 10_000, timeout: 15_000 }
  );
}

function toOutcomeFromRows(params: {
  recarga: LockedRecargaRow;
  attempt: LockedTopUpAttemptRow;
  transactionId: string;
  providerStatus: WompiRemoteTransactionStatus;
  creditedCents: bigint;
  idempotentReplay: boolean;
  effectiveFinancialMutation: boolean;
  incidentCode: TopUpIncidentCode | null;
  supportTicketCreated: boolean;
  walletBlockedForDebit: boolean;
  recargaEstado?: string;
}): CanonicalTopUpOutcome {
  const cents = toBigIntCents(params.recarga.montoEnCentavos);
  return {
    kind: "TOPUP",
    recargaId: params.recarga.id,
    intentId: params.attempt.id,
    reference: params.attempt.referenciaWompi,
    transactionId: params.transactionId,
    providerStatus: params.providerStatus,
    intentStatus: PROVIDER_TO_INTENT[params.providerStatus],
    recargaEstado: (params.recargaEstado ?? params.recarga.estado) as TopUpRecargaState,
    amountInCents: cents.toString(),
    formattedAmountCop: formatWompiCentsToCop(cents),
    creditedCents: params.creditedCents.toString(),
    idempotentReplay: params.idempotentReplay,
    effectiveFinancialMutation: params.effectiveFinancialMutation,
    incidentCode: params.incidentCode,
    supportTicketCreated: params.supportTicketCreated,
    walletBlockedForDebit: params.walletBlockedForDebit,
  };
}

/**
 * Aplica de forma atómica e idempotente el estado canónico de Wompi a una recarga.
 */
export async function applyCanonicalTopUpTransition(
  db: PrismaClient,
  input: ApplyCanonicalTransitionInput
): Promise<CanonicalTopUpOutcome> {
  const { canonicalTx } = input;
  const now = input.now ?? new Date();

  if (canonicalTx.currency !== WOMPI_CURRENCY_COP) {
    throw new WompiServiceError(
      `Moneda no soportada en transacción canónica: "${canonicalTx.currency}".`,
      422,
      "UNSUPPORTED_CURRENCY",
      false
    );
  }

  return await db.$transaction(
    async (tx) => {
      let webhookEventRowId: string | null = null;
      let processedReplay = false;

      if (input.webhookEvent) {
        const wh = input.webhookEvent;
        const inserted = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            INSERT INTO "eventos_webhook_wompi" (
              "id","claveDeduplicacion","ambiente","tipoEvento","timestampEvento",
              "wompiTransactionId","checksumRecibido","resumenPayloadJson",
              "procesadoExitoso","errorProcesamiento","creadoEn"
            ) VALUES (
              ${randomUUID()}::uuid, ${wh.deduplicationKey}, ${wh.environment}, ${wh.eventType},
              ${wh.timestampEvento}, ${canonicalTx.id}, ${wh.checksumRecibido},
              ${wh.resumenPayloadJson}, false, NULL, ${now}
            )
            ON CONFLICT ("claveDeduplicacion") DO NOTHING
            RETURNING "id"
          `
        );
        if (inserted.length === 1) {
          webhookEventRowId = inserted[0].id;
        } else {
          const existing = await tx.$queryRaw<Array<{ id: string; procesadoExitoso: boolean }>>(
            Prisma.sql`
              SELECT "id","procesadoExitoso" FROM "eventos_webhook_wompi"
              WHERE "claveDeduplicacion" = ${wh.deduplicationKey}
              FOR UPDATE
            `
          );
          const locked = existing[0];
          if (!locked) {
            throw new WompiServiceError(
              "No fue posible bloquear el registro de deduplicación del webhook.",
              500,
              "WEBHOOK_DEDUP_LOCK_ERROR",
              true
            );
          }
          processedReplay = locked.procesadoExitoso;
          webhookEventRowId = locked.id;
        }
      }

      const lookup = await tx.intentoPagoWompi.findUnique({
        where: { referenciaWompi: canonicalTx.reference },
        select: { id: true, recargaId: true },
      });
      if (!lookup || !lookup.recargaId) {
        throw new WompiServiceError(
          input.expectedClientId
            ? "No se encontró la transacción solicitada."
            : "La referencia de la transacción no corresponde a ninguna recarga registrada.",
          404,
          input.expectedClientId ? "TRANSACTION_NOT_FOUND" : "ATTEMPT_REFERENCE_NOT_FOUND",
          false
        );
      }

      // LOCK 1: recarga
      const recargaRows = await tx.$queryRaw<LockedRecargaRow[]>(
        Prisma.sql`
          SELECT "id","walletId","usuarioId","montoEnCentavos","montoEnDisputaCentavos",
                 "estado"::text AS "estado","ticketSoporteId","claveIdempotencia"
          FROM "recargas_wallet"
          WHERE "id" = ${lookup.recargaId}::uuid
          FOR UPDATE
        `
      );
      const recarga = recargaRows[0];
      if (!recarga || (input.expectedClientId && recarga.usuarioId !== input.expectedClientId)) {
        throw new WompiServiceError(
          "No se encontró la transacción solicitada.",
          404,
          "TRANSACTION_NOT_FOUND",
          false
        );
      }

      // LOCK 2: intentos de la recarga (id ASC)
      const attempts = await tx.$queryRaw<LockedTopUpAttemptRow[]>(
        Prisma.sql`
          SELECT "id","recargaId","referenciaWompi","montoEnCentavos","moneda",
                 "estado"::text AS "estado","estadoProveedor","wompiTransactionId",
                 "firmaIntegridad","datosRespuestaJson","creadoEn"
          FROM "intentos_pago_wompi"
          WHERE "recargaId" = ${recarga.id}::uuid
          ORDER BY "id" ASC
          FOR UPDATE
        `
      );
      const attempt = attempts.find((a) => a.referenciaWompi === canonicalTx.reference);
      if (!attempt) {
        throw new WompiServiceError(
          "El intento de recarga asociado a la referencia no pudo ser bloqueado.",
          404,
          "ATTEMPT_REFERENCE_NOT_FOUND",
          false
        );
      }

      const recargaCents = toBigIntCents(recarga.montoEnCentavos);
      const attemptCents = toBigIntCents(attempt.montoEnCentavos);
      if (
        canonicalTx.amountInCents !== attemptCents ||
        canonicalTx.amountInCents !== recargaCents ||
        canonicalTx.currency !== attempt.moneda.trim().toUpperCase()
      ) {
        throw new WompiServiceError(
          "Inconsistencia crítica: el monto o la moneda de Wompi no coincide con la recarga firmada.",
          422,
          "AMOUNT_OR_CURRENCY_MISMATCH",
          false
        );
      }

      // Lectura de saldo del wallet bajo lock (LOCK 3) para decisiones de anulación.
      const walletRows = await tx.$queryRaw<
        Array<{ id: string; saldoDisponibleCentavos: bigint | string | number; bloqueadaParaDebito: boolean }>
      >(
        Prisma.sql`
          SELECT "id","saldoDisponibleCentavos","bloqueadaParaDebito"
          FROM "fixi_wallets" WHERE "id" = ${recarga.walletId}::uuid FOR UPDATE
        `
      );
      const wallet = walletRows[0];
      if (!wallet) {
        throw new WompiServiceError("Billetera de la recarga no encontrada.", 500, "WALLET_NOT_FOUND", false);
      }
      let walletBlocked = Boolean(wallet.bloqueadaParaDebito);

      const markWebhookProcessed = async () => {
        if (webhookEventRowId) {
          await tx.eventoWebhookWompi.update({
            where: { id: webhookEventRowId },
            data: { procesadoExitoso: true, errorProcesamiento: null },
          });
        }
      };

      if (processedReplay) {
        const prev = (attempt.estadoProveedor ?? "PENDING").toUpperCase() as WompiRemoteTransactionStatus;
        return toOutcomeFromRows({
          recarga,
          attempt,
          transactionId: attempt.wompiTransactionId ?? canonicalTx.id,
          providerStatus: prev,
          creditedCents: recarga.estado === "APROBADA" ? recargaCents : 0n,
          idempotentReplay: true,
          effectiveFinancialMutation: false,
          incidentCode: null,
          supportTicketCreated: false,
          walletBlockedForDebit: walletBlocked,
        });
      }

      // Identidad de la transacción remota dentro del intento
      const prevProvider = (attempt.estadoProveedor ?? "").trim().toUpperCase();
      const sameTx =
        attempt.wompiTransactionId === null || attempt.wompiTransactionId === canonicalTx.id;
      const prevTerminalFailure =
        prevProvider === "DECLINED" || prevProvider === "ERROR" || prevProvider === "VOIDED";

      let supportTicketCreated = false;
      let incidentCode: TopUpIncidentCode | null = null;
      let ticketIdToLink: string | null = recarga.ticketSoporteId;

      const openTicket = async (
        code: TopUpIncidentCode,
        prioridad: "ALTA" | "CRITICA",
        detalle: string
      ): Promise<void> => {
        if (ticketIdToLink) return; // un ticket por recarga (dedupe)
        const numero = await generateUniqueTicketNumber(tx, now);
        const ticket = await tx.ticketSoporte.create({
          data: {
            numeroTicket: numero,
            usuarioEmisorId: recarga.usuarioId,
            ordenId: null,
            categoria: "DISPUTA_COSTO",
            prioridad,
            estado: "ABIERTO",
            asunto: `[WALLET-TOPUP] ${code} recarga ${recarga.id}`.slice(0, 150),
            descripcion: `${detalle}\nrecargaId=${recarga.id}\ntransactionId=${canonicalTx.id}\nreference=${canonicalTx.reference}\nmontoCentavos=${recargaCents.toString()}`,
            creadoEn: now,
            fechaLimiteSla: calculateSlaDeadline(prioridad, now),
          },
        });
        ticketIdToLink = ticket.id;
        supportTicketCreated = true;
      };

      if (!sameTx && !prevTerminalFailure) {
        // Segunda transacción distinta mientras la primera sigue viva/aprobada: no mutar saldo.
        incidentCode = "DUPLICATE_TRANSACTION_FOR_ATTEMPT";
        await openTicket(
          incidentCode,
          "CRITICA",
          "Wompi reportó una transacción distinta para una referencia con otra transacción activa."
        );
        if (supportTicketCreated && ticketIdToLink) {
          await tx.$executeRaw(
            Prisma.sql`UPDATE "recargas_wallet" SET "ticketSoporteId" = ${ticketIdToLink}::uuid, "actualizadoEn" = ${now} WHERE "id" = ${recarga.id}::uuid`
          );
        }
        await markWebhookProcessed();
        return toOutcomeFromRows({
          recarga,
          attempt,
          transactionId: attempt.wompiTransactionId ?? canonicalTx.id,
          providerStatus: (prevProvider || "PENDING") as WompiRemoteTransactionStatus,
          creditedCents: 0n,
          idempotentReplay: false,
          effectiveFinancialMutation: false,
          incidentCode,
          supportTicketCreated,
          walletBlockedForDebit: walletBlocked,
        });
      }

      const providerRes = resolveCanonicalProviderStatus({
        previousProviderStatus: sameTx ? attempt.estadoProveedor : null,
        incomingRemoteStatus: canonicalTx.status,
        sameTransactionId: sameTx,
      });
      const effectiveStatus = providerRes.nextProviderStatus;

      const action: TopUpAction = evaluateTopUpTransition({
        recargaEstado: recarga.estado as TopUpRecargaState,
        incomingStatus: effectiveStatus,
        recargaAmountCents: recargaCents,
        walletBalanceCents: toBigIntCents(wallet.saldoDisponibleCentavos),
        walletBlockedForDebit: walletBlocked,
      });

      let nextRecargaEstado: string = recarga.estado;
      let creditedCents = recarga.estado === "APROBADA" ? recargaCents : 0n;
      let effectiveFinancialMutation = false;
      let disputeCents = toBigIntCents(recarga.montoEnDisputaCentavos);
      let conciliacion: "CONCILIADO" | "PENDIENTE_INVESTIGACION" | null = null;
      let winnerAttemptId: string | null = null;

      switch (action.kind) {
        case "CREDIT": {
          const res = await creditWalletAtomic(tx, {
            usuarioId: recarga.usuarioId,
            montoEnCentavos: recargaCents,
            tipo: "RECARGA",
            claveIdempotencia: buildTopUpCreditKey(recarga.id),
            descripcion: `Recarga Fixi Wallet (${canonicalTx.reference})`.slice(0, 250),
            recargaId: recarga.id,
            referenciaExterna: canonicalTx.id.slice(0, 100),
          });
          effectiveFinancialMutation = !res.idempotentReplay;
          nextRecargaEstado = action.nextState;
          creditedCents = recargaCents;
          winnerAttemptId = attempt.id;
          break;
        }
        case "REJECT":
        case "VOID_PENDING":
          nextRecargaEstado = action.nextState;
          break;
        case "VOID_COMPENSATE": {
          const res = await debitWalletAtomic(tx, {
            usuarioId: recarga.usuarioId,
            montoEnCentavos: recargaCents,
            tipo: "AJUSTE_COMPENSATORIO",
            claveIdempotencia: buildTopUpVoidKey(recarga.id),
            descripcion: `Reverso por anulación Wompi (${canonicalTx.reference})`.slice(0, 250),
            recargaId: recarga.id,
            referenciaExterna: canonicalTx.id.slice(0, 100),
          });
          effectiveFinancialMutation = !res.idempotentReplay;
          nextRecargaEstado = action.nextState;
          creditedCents = 0n;
          incidentCode = action.incident;
          await openTicket(
            action.incident,
            "ALTA",
            "Wompi anuló la recarga; el crédito fue revertido automáticamente (saldo suficiente)."
          );
          break;
        }
        case "VOID_DISPUTE": {
          await tx.fixiWallet.update({
            where: { id: recarga.walletId },
            data: { bloqueadaParaDebito: true, actualizadoEn: now },
          });
          walletBlocked = true;
          nextRecargaEstado = action.nextState;
          disputeCents = action.disputeCents;
          conciliacion = "PENDIENTE_INVESTIGACION";
          effectiveFinancialMutation = true;
          incidentCode = action.incident;
          await openTicket(
            action.incident,
            "CRITICA",
            "Wompi anuló la recarga pero el saldo ya fue gastado. Débitos bloqueados; sin saldo negativo."
          );
          break;
        }
        case "ANOMALY": {
          nextRecargaEstado = action.nextState;
          disputeCents = recargaCents;
          conciliacion = "PENDIENTE_INVESTIGACION";
          effectiveFinancialMutation = true;
          incidentCode = action.incident;
          await openTicket(
            action.incident,
            "CRITICA",
            "Confirmación APPROVED tardía tras una anulación. No se acredita automáticamente."
          );
          break;
        }
        case "NOOP":
          break;
      }

      // Persistencia del intento (estado remoto y vínculo de transacción)
      const nextIntentStatus = PROVIDER_TO_INTENT[effectiveStatus];
      await tx.intentoPagoWompi.update({
        where: { id: attempt.id },
        data: {
          wompiTransactionId: canonicalTx.id,
          estadoProveedor: effectiveStatus,
          estado: nextIntentStatus,
          metodoPagoReportado: canonicalTx.paymentMethodType
            ? canonicalTx.paymentMethodType.slice(0, 50)
            : undefined,
          actualizadoEn: now,
        },
      });

      if (
        nextRecargaEstado !== recarga.estado ||
        ticketIdToLink !== recarga.ticketSoporteId ||
        disputeCents !== toBigIntCents(recarga.montoEnDisputaCentavos)
      ) {
        await tx.$executeRaw(
          Prisma.sql`
            UPDATE "recargas_wallet"
            SET "estado" = ${nextRecargaEstado}::"estado_recarga_wallet",
                "estadoConciliacion" = COALESCE(${conciliacion}::"estado_conciliacion_recarga", "estadoConciliacion"),
                "montoEnDisputaCentavos" = ${disputeCents},
                "ticketSoporteId" = ${ticketIdToLink}::uuid,
                "intentoGanadorId" = COALESCE(${winnerAttemptId}::uuid, "intentoGanadorId"),
                "procesadoEn" = CASE WHEN ${nextRecargaEstado} <> 'PENDIENTE' THEN ${now}::timestamp ELSE "procesadoEn" END,
                "actualizadoEn" = ${now}
            WHERE "id" = ${recarga.id}::uuid
          `
        );
      }

      await markWebhookProcessed();

      return toOutcomeFromRows({
        recarga,
        attempt,
        transactionId: canonicalTx.id,
        providerStatus: effectiveStatus,
        creditedCents,
        idempotentReplay: action.kind === "NOOP" && !providerRes.isStaleOutOfOrder ? true : false,
        effectiveFinancialMutation,
        incidentCode,
        supportTicketCreated,
        walletBlockedForDebit: walletBlocked,
        recargaEstado: nextRecargaEstado,
      });
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
}
