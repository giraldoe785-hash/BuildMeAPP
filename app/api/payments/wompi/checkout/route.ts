import { getCurrentUser } from "@/lib/auth";
import { redactSensitivePaymentStrings } from "@/lib/paymentPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import {
  WompiServiceError,
  prepareWompiWebCheckout,
} from "@/lib/wompiService";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 16 * 1024;

// Límite por usuario: máx. 15 preparaciones de checkout cada 5 minutos
const checkoutLimiter = createRateLimiter({
  max: 15,
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
          message: "Debes iniciar sesión para preparar el pago de tu orden.",
        },
        401
      );
    }

    if (!checkoutLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message:
            "Has solicitado demasiados intentos de checkout en poco tiempo. Espera unos minutos.",
        },
        429
      );
    }

    const bounded = await readBoundedBody(request, MAX_JSON_BYTES);
    if (!bounded.ok) {
      return jsonResponse(
        {
          success: false,
          code: "PAYLOAD_TOO_LARGE",
          message: bounded.message,
        },
        bounded.status
      );
    }

    let rawBody: unknown;
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

    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return jsonResponse(
        {
          success: false,
          code: "INVALID_BODY",
          message: "El cuerpo de la solicitud debe ser un objeto JSON con orderId.",
        },
        400
      );
    }

    const { orderId } = rawBody as Record<string, unknown>;
    let requestOrigin: string | null = null;
    try {
      requestOrigin = new URL(request.url).origin;
    } catch {
      requestOrigin = null;
    }

    const checkout = await prepareWompiWebCheckout(prisma, user, orderId, {
      requestOrigin,
    });

    return jsonResponse(
      {
        success: true,
        checkout,
      },
      200
    );
  } catch (error) {
    if (error instanceof WompiServiceError) {
      return jsonResponse(
        {
          success: false,
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
        error.status
      );
    }

    const safeDetail =
      error instanceof Error
        ? redactSensitivePaymentStrings(error.message)
        : "Error desconocido";
    console.error("[WompiCheckoutAPI][POST] Error inesperado:", safeDetail);

    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible preparar el checkout de pago en este momento.",
      },
      500
    );
  }
}
