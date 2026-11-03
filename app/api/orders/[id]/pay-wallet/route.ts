import { getCurrentUser } from "@/lib/auth";
import { OrderPolicyError } from "@/lib/orderPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { payOrderWithFixiWallet } from "@/lib/walletService";

const NO_STORE = { "Cache-Control": "no-store" };

const payOrderWalletLimiter = createRateLimiter({
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
          message: "Debes iniciar sesión como cliente para pagar la orden con Fixi Wallet.",
        },
        401
      );
    }

    if (!payOrderWalletLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiados intentos de pago con billetera. Espera unos minutos.",
        },
        429
      );
    }

    let rawBody: unknown = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        rawBody = JSON.parse(text);
      }
    } catch {
      return jsonResponse(
        {
          success: false,
          code: "INVALID_JSON",
          message: "El cuerpo de la solicitud no es un JSON válido.",
        },
        400
      );
    }

    const { id } = await context.params;
    const result = await payOrderWithFixiWallet(prisma, user, id, rawBody);

    return jsonResponse({ ...result }, result.idempotentReplay ? 200 : 200);
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

    console.error("[OrdersPayWalletAPI][POST] Error al pagar orden con Fixi Wallet:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible procesar el pago con Fixi Wallet.",
      },
      500
    );
  }
}
