/**
 * app/api/orders/[id]/telemetry/route.ts
 *
 * Route handler para HU25.1:
 * - POST: Registrar muestra de telemetría del técnico para una orden asignada.
 * - GET: Consultar última telemetría / estado de arribo según permisos.
 */

import { getCurrentUser } from "@/lib/auth";
import { OrderPolicyError } from "@/lib/orderPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import {
  recordRepairerTelemetry,
  getLatestOrderTelemetry,
} from "@/lib/telemetryService";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 16 * 1024;

const telemetryRateLimiter = createRateLimiter({
  max: 60,
  windowMs: 60 * 1000, // 60 muestras por minuto máximo por usuario
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
          message: "Debes iniciar sesión para transmitir telemetría.",
        },
        401
      );
    }

    if (!telemetryRateLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiadas solicitudes de telemetría. Reduce la frecuencia.",
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
    const result = await recordRepairerTelemetry(prisma, user as any, id, rawBody);

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

    console.error("[OrdersTelemetryAPI][POST] Error al registrar telemetría:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible registrar la telemetría.",
      },
      500
    );
  }
}

export async function GET(
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
          message: "Debes iniciar sesión para consultar telemetría.",
        },
        401
      );
    }

    const { id } = await context.params;
    const result = await getLatestOrderTelemetry(prisma, user as any, id);

    return jsonResponse({
      success: true,
      ...result,
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

    console.error("[OrdersTelemetryAPI][GET] Error al consultar telemetría:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible consultar la telemetría.",
      },
      500
    );
  }
}
