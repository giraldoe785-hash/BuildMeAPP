import { getCurrentUser } from "@/lib/auth";
import { OrderPolicyError, verifyOrderOtp } from "@/lib/orderService";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 16 * 1024;

// Límite contra ataques de fuerza bruta al código OTP por usuario
const verifyOtpLimiter = createRateLimiter({
  max: 15,
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
          message: "Debes iniciar sesión como reparador para validar el código.",
        },
        401
      );
    }

    if (!verifyOtpLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiados intentos de validación. Espera unos instantes.",
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

    const { id } = await context.params;
    const result = await verifyOrderOtp(prisma, user, id, rawBody);

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

    console.error("[OrdersVerifyOtpAPI][POST] Error al validar código OTP:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible procesar la validación del código.",
      },
      500
    );
  }
}
