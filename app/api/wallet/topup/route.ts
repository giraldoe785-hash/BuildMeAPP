import { getCurrentUser } from "@/lib/auth";
import { redactSensitivePaymentStrings } from "@/lib/paymentPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import { WompiServiceError } from "@/lib/wompiService";
import { createOrReplayTopUp } from "@/lib/walletTopUpService";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 16 * 1024;

const topUpLimiter = createRateLimiter({
  max: 10,
  windowMs: 5 * 60 * 1000,
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * POST /api/wallet/topup
 * Body: { amountInCents: "<dígitos>", idempotencyKey: "<8-60 [A-Za-z0-9_-]>" }
 * El importe viaja como string (BigInt centavos COP). El saldo NO se acredita aquí:
 * solo tras confirmación canónica APPROVED de Wompi (webhook/verify).
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión para recargar tu billetera.",
        },
        401
      );
    }

    if (!topUpLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiadas solicitudes de recarga. Espera unos minutos.",
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
          message: "El cuerpo debe ser un objeto JSON con amountInCents e idempotencyKey.",
        },
        400
      );
    }

    const { amountInCents, idempotencyKey } = rawBody as Record<string, unknown>;
    let requestOrigin: string | null = null;
    try {
      requestOrigin = new URL(request.url).origin;
    } catch {
      requestOrigin = null;
    }

    const checkout = await createOrReplayTopUp(
      prisma,
      user,
      { amountInCents, idempotencyKey },
      { requestOrigin }
    );

    return jsonResponse({ success: true, checkout }, 200);
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
      error instanceof Error ? redactSensitivePaymentStrings(error.message) : "Error desconocido";
    console.error("[WalletTopUpAPI][POST] Error inesperado:", safeDetail);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible preparar la recarga en este momento.",
      },
      500
    );
  }
}
