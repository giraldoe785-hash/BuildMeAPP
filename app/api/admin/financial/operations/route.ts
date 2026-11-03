import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatWompiCentsToCop } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export interface FinancialOperationDto {
  id: string;
  tipo: "RECARGA" | "PAGO_SERVICIO" | "REEMBOLSO" | "COMISION";
  tipoLabel: string;
  referencia: string;
  ordenId: string | null;
  numeroOrden: string | null;
  usuarioEmail: string | null;
  usuarioNombre: string | null;
  montoEnCentavos: string;
  montoFormateado: string;
  naturaleza: "CREDITO" | "DEBITO" | null;
  estado: string;
  creadoEn: string;
  descripcion: string;
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión para consultar operaciones financieras.",
        },
        401
      );
    }

    if (user.rol !== "ADMINISTRADOR") {
      return jsonResponse(
        {
          success: false,
          code: "FORBIDDEN",
          message: "No tienes permisos para auditar operaciones financieras.",
        },
        403
      );
    }

    const url = new URL(request.url);
    const searchQuery = (url.searchParams.get("search") || "").trim().toLowerCase();
    const tipoFilter = (url.searchParams.get("tipo") || "ALL").toUpperCase();
    const fechaDesde = url.searchParams.get("fechaDesde");
    const fechaHasta = url.searchParams.get("fechaHasta");

    // Construcción de filtros de fecha
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (fechaDesde) {
      const d = new Date(fechaDesde);
      if (!Number.isNaN(d.getTime())) {
        dateFilter.gte = d;
      }
    }
    if (fechaHasta) {
      const h = new Date(fechaHasta);
      if (!Number.isNaN(h.getTime())) {
        // Fin del día hasta las 23:59:59.999
        h.setHours(23, 59, 59, 999);
        dateFilter.lte = h;
      }
    }
    const hasDateFilter = Boolean(dateFilter.gte || dateFilter.lte);

    // 1. Consultar transacciones de billetera (Ledger real)
    const walletWhere: Record<string, unknown> = {};
    if (hasDateFilter) {
      walletWhere.creadoEn = dateFilter;
    }

    const walletTransactions = await prisma.transaccionWallet.findMany({
      where: walletWhere,
      orderBy: { creadoEn: "desc" },
      take: 100,
      include: {
        usuario: {
          select: { email: true, nombreUsuario: true },
        },
        orden: {
          select: { id: true, numeroOrden: true },
        },
        recarga: {
          include: {
            intentoGanador: {
              select: { referenciaWompi: true, wompiTransactionId: true },
            },
          },
        },
        reembolso: {
          select: { numeroComprobante: true },
        },
      },
    });

    // 2. Consultar solicitudes y radicaciones de reembolsos
    const refundWhere: Record<string, unknown> = {};
    if (hasDateFilter) {
      refundWhere.creadoEn = dateFilter;
    }

    const refunds = await prisma.reembolsoTransaccion.findMany({
      where: refundWhere,
      orderBy: { creadoEn: "desc" },
      take: 100,
      include: {
        orden: {
          select: { id: true, numeroOrden: true },
        },
        clienteBeneficiario: {
          select: { email: true, nombreUsuario: true },
        },
        intentoPagoWompi: {
          select: { referenciaWompi: true, wompiTransactionId: true },
        },
      },
    });

    // KPI Reembolsos Solicitados (en estado pendiente de auditoría)
    const reembolsosSolicitadosCount = await prisma.reembolsoTransaccion.count({
      where: {
        estado: {
          in: ["SOLICITADO", "PENDIENTE_SEGUNDA_APROBACION"],
        },
      },
    });

    // 3. Consolidación de operaciones
    const operaciones: FinancialOperationDto[] = [];

    // Mapear transacciones de wallet
    for (const tx of walletTransactions) {
      let tipo: FinancialOperationDto["tipo"] = "PAGO_SERVICIO";
      let tipoLabel = "Pago de Servicio";

      if (tx.tipo === "RECARGA") {
        tipo = "RECARGA";
        tipoLabel = "Recarga Wallet";
      } else if (tx.tipo === "REEMBOLSO_GARANTIA") {
        tipo = "REEMBOLSO";
        tipoLabel = "Reembolso";
      } else if (tx.tipo === "PAGO_SERVICIO") {
        tipo = "PAGO_SERVICIO";
        tipoLabel = "Pago de Servicio";
      }

      const referencia =
        tx.recarga?.intentoGanador?.referenciaWompi ||
        tx.recarga?.intentoGanador?.wompiTransactionId ||
        tx.reembolso?.numeroComprobante ||
        tx.referenciaExterna ||
        tx.claveIdempotencia.slice(0, 20) + "…";

      const cents = BigInt(tx.montoEnCentavos);
      const montoFormateado = formatWompiCentsToCop(cents);

      operaciones.push({
        id: tx.id,
        tipo,
        tipoLabel,
        referencia,
        ordenId: tx.ordenId,
        numeroOrden: tx.orden?.numeroOrden ?? null,
        usuarioEmail: tx.usuario?.email ?? null,
        usuarioNombre: tx.usuario?.nombreUsuario ?? null,
        montoEnCentavos: tx.montoEnCentavos.toString(),
        montoFormateado,
        naturaleza: tx.naturaleza ?? null,
        estado: "EJECUTADO",
        creadoEn: tx.creadoEn.toISOString(),
        descripcion: tx.descripcion,
      });
    }

    // Mapear reembolsos que no estén ya incluidos por TransaccionWallet
    const existingRefundIds = new Set(
      walletTransactions.map((w) => w.reembolsoId).filter(Boolean)
    );

    for (const ref of refunds) {
      if (existingRefundIds.has(ref.id)) continue;

      const cents = BigInt(ref.montoEnCentavos);
      const montoFormateado = formatWompiCentsToCop(cents);

      const refCode =
        ref.wompiTransactionId ||
        ref.intentoPagoWompi?.referenciaWompi ||
        ref.numeroComprobante;

      operaciones.push({
        id: ref.id,
        tipo: "REEMBOLSO",
        tipoLabel: "Reembolso",
        referencia: refCode,
        ordenId: ref.ordenId,
        numeroOrden: ref.orden?.numeroOrden ?? null,
        usuarioEmail: ref.clienteBeneficiario?.email ?? null,
        usuarioNombre: ref.clienteBeneficiario?.nombreUsuario ?? null,
        montoEnCentavos: ref.montoEnCentavos.toString(),
        montoFormateado,
        naturaleza: "DEBITO",
        estado: ref.estado,
        creadoEn: ref.creadoEn.toISOString(),
        descripcion: `Solicitud de reembolso: ${ref.motivo}`,
      });
    }

    // Ordenar todas las operaciones por fecha más reciente
    operaciones.sort(
      (a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime()
    );

    // Filtrado en memoria por búsqueda y tipo
    const filtered = operaciones.filter((op) => {
      if (tipoFilter !== "ALL" && op.tipo !== tipoFilter) {
        return false;
      }

      if (searchQuery) {
        const matchesOrder =
          op.numeroOrden?.toLowerCase().includes(searchQuery) ||
          op.ordenId?.toLowerCase().includes(searchQuery);
        const matchesRef = op.referencia.toLowerCase().includes(searchQuery);
        const matchesEmail = op.usuarioEmail?.toLowerCase().includes(searchQuery);
        const matchesUser = op.usuarioNombre?.toLowerCase().includes(searchQuery);
        const matchesDesc = op.descripcion.toLowerCase().includes(searchQuery);

        if (!matchesOrder && !matchesRef && !matchesEmail && !matchesUser && !matchesDesc) {
          return false;
        }
      }

      return true;
    });

    return jsonResponse({
      success: true,
      kpis: {
        saldoEnCustodia: null, // Dato no modelado; debe permanecer no disponible
        reembolsosSolicitados: reembolsosSolicitadosCount,
        dispersionesRealizadas: null, // Módulo bancario no modelado; debe permanecer no disponible
      },
      operaciones: filtered,
      total: filtered.length,
    });
  } catch (error) {
    console.error("[AdminFinancialOperationsAPI][GET] Error:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible consultar las operaciones financieras.",
      },
      500
    );
  }
}
