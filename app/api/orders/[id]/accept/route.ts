import { getCurrentUser } from "@/lib/auth";
import { acceptOrder, OrderPolicyError } from "@/lib/orderService";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";

const NO_STORE = { "Cache-Control": "no-store" };

// Límite contra intentos masivos de aceptación por reparador
const acceptOrderLimiter = createRateLimiter({
  max: 25,
  windowMs: 5 * 60 * 1000,
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión como reparador para aceptar una solicitud.",
        },
        401
      );
    }

    if (!acceptOrderLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiados intentos de aceptación. Espera unos instantes.",
        },
        429
      );
    }

    const { id } = await context.params;
    const result = await acceptOrder(prisma, user, id);

    return jsonResponse({
      success: true,
      order: result.order,
      idempotentReplay: result.idempotentReplay,
    });
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

    console.error("[OrdersAcceptAPI][POST] Error al aceptar orden:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible procesar la aceptación de la solicitud.",
      },
      500
    );
  }
}
