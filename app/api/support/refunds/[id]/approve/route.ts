/**
 * app/api/support/refunds/[id]/approve/route.ts
 *
 * Route handler para HU26.2:
 * - POST: Aprobación simple / dual de solicitudes de reembolso con separación de funciones (D-04).
 */

import { getCurrentUser } from "@/lib/auth";
import { OrderPolicyError } from "@/lib/orderPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import { approveRefundStage } from "@/lib/walletService";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 16 * 1024;

const refundApproveLimiter = createRateLimiter({
  max: 20,
  windowMs: 5 * 60 * 1000,
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión para autorizar reembolsos.",
        },
        401
      );
    }

    if (!refundApproveLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiadas solicitudes de autorización. Espera un momento.",
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

    const { id } = await context.params;
    const result = await approveRefundStage(prisma, actor as any, id, rawBody);

    return jsonResponse(result);
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

    console.error("[SupportRefundApproveAPI][POST] Error al autorizar reembolso:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible procesar la autorización del reembolso.",
      },
      500
    );
  }
}
