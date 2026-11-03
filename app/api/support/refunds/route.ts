import { getCurrentUser } from "@/lib/auth";
import { OrderPolicyError } from "@/lib/orderPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import { createRefundRequest } from "@/lib/walletService";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 16 * 1024;

const refundCreateLimiter = createRateLimiter({
  max: 20,
  windowMs: 5 * 60 * 1000,
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión para radicar solicitudes de reembolso.",
        },
        401
      );
    }

    if (!refundCreateLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiadas solicitudes de reembolso. Espera un momento.",
        },
        429
      );
    }

    const bounded = await readBoundedBody(request, MAX_JSON_BYTES);
    if (!bounded.ok) {
      return jsonResponse(
        { success: false, code: "PAYLOAD_TOO_LARGE", message: bounded.message },
        bounded.status
      );
    }

    let rawBody: unknown = {};
    try {
      rawBody = await bounded.request.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          code: "INVALID_JSON",
          message: "El formato JSON de la solicitud no es válido.",
        },
        400
      );
    }

    const permisosRows = await prisma.usuarioPermisoInterno.findMany({
      where: { usuarioId: user.id },
      select: { permiso: true },
    });
    const permisosInternos = permisosRows.map((p) => p.permiso);

    const actor = {
      id: user.id,
      rol: user.rol,
      estado: user.estado,
      permisosInternos,
    };

    const result = await createRefundRequest(prisma, actor as any, rawBody);
    return jsonResponse(result, result.idempotentReplay ? 200 : 201);
  } catch (error) {
    if (error instanceof OrderPolicyError) {
      return jsonResponse(
        {
          success: false,
          code: error.code ?? "ORDER_POLICY_ERROR",
          message: error.message,
        },
        error.status
      );
    }

    console.error("[SupportRefundsAPI][POST] Error al crear solicitud de reembolso:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible radicar la solicitud de reembolso.",
      },
      500
    );
  }
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        { success: false, code: "UNAUTHENTICATED", message: "Inicia sesión para consultar reembolsos." },
        401
      );
    }

    const url = new URL(request.url);
    const ordenId = url.searchParams.get("ordenId");

    const whereClause: Record<string, unknown> = {};
    if (ordenId) {
      whereClause.ordenId = ordenId;
    }

    if (user.rol === "CLIENTE") {
      whereClause.clienteBeneficiarioId = user.id;
    }

    const refunds = await prisma.reembolsoTransaccion.findMany({
      where: whereClause,
      orderBy: { creadoEn: "desc" },
      take: 50,
      include: {
        orden: {
          select: { numeroOrden: true, estadoPago: true, totalPreautorizado: true },
        },
      },
    });

    return jsonResponse({
      success: true,
      reembolsos: refunds.map((r) => ({
        id: r.id,
        numeroComprobante: r.numeroComprobante,
        ordenId: r.ordenId,
        numeroOrden: r.orden?.numeroOrden,
        clienteBeneficiarioId: r.clienteBeneficiarioId,
        ticketId: r.ticketId,
        solicitanteId: r.solicitanteId,
        autorizador1Id: r.autorizador1Id,
        autorizador2Id: r.autorizador2Id,
        destino: r.destino,
        estado: r.estado,
        montoEnCentavos: r.montoEnCentavos.toString(),
        motivo: r.motivo,
        creadoEn: r.creadoEn.toISOString(),
        procesadoEn: r.procesadoEn?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("[SupportRefundsAPI][GET] Error al listar reembolsos:", error);
    return jsonResponse(
      { success: false, code: "INTERNAL_ERROR", message: "Error al listar reembolsos." },
      500
    );
  }
}
