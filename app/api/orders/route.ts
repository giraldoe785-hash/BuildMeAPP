import { getCurrentUser } from "@/lib/auth";
import { createOrder, OrderPolicyError } from "@/lib/orderService";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 32 * 1024;

// Límite por usuario: máx. 12 intentos de creación de orden cada 15 minutos
const createOrderLimiter = createRateLimiter({
  max: 12,
  windowMs: 15 * 60 * 1000,
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
          message: "Debes iniciar sesión para confirmar una solicitud de servicio.",
        },
        401
      );
    }

    if (!createOrderLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Has enviado demasiadas solicitudes en poco tiempo. Espera unos minutos.",
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

    const result = await createOrder(prisma, user, rawBody);

    return jsonResponse(
      {
        success: true,
        order: result.order,
        idempotentReplay: result.idempotentReplay,
      },
      result.idempotentReplay ? 200 : 201
    );
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

    console.error("[OrdersAPI][POST] Error al crear orden:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible registrar tu solicitud de servicio en este momento.",
      },
      500
    );
  }
}
