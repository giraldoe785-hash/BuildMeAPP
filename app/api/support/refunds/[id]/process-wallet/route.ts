/**
 * app/api/support/refunds/[id]/process-wallet/route.ts
 *
 * Route handler para HU26.3:
 * - POST: Acreditación atómica e idempotente del reembolso aprobado a la Fixi Wallet del cliente.
 */

import { getCurrentUser } from "@/lib/auth";
import { OrderPolicyError } from "@/lib/orderPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { processInternalWalletRefund } from "@/lib/walletService";

const NO_STORE = { "Cache-Control": "no-store" };

const walletRefundLimiter = createRateLimiter({
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
          message: "Debes iniciar sesión para procesar créditos a Fixi Wallet.",
        },
        401
      );
    }

    if (!walletRefundLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiadas operaciones financieras en poco tiempo. Espera un momento.",
        },
        429
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
    const result = await processInternalWalletRefund(prisma, actor as any, id);

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

    console.error("[SupportWalletRefundAPI][POST] Error al acreditar a Fixi Wallet:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible acreditar el saldo a la Fixi Wallet.",
      },
      500
    );
  }
}
