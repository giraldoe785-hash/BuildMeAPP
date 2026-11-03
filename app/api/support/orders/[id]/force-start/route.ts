/**
 * app/api/support/orders/[id]/force-start/route.ts
 *
 * Route handler para HU25.2:
 * - POST: Desbloqueo auditado de servicio por soporte operativo (force start) sin falsificar OTP.
 */

import { getCurrentUser } from "@/lib/auth";
import { OrderPolicyError } from "@/lib/orderPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import { forceStartServiceBySupport } from "@/lib/telemetryService";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 16 * 1024;

const forceStartLimiter = createRateLimiter({
  max: 10,
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
          message: "Debes iniciar sesión para ejecutar intervenciones de soporte.",
        },
        401
      );
    }

    if (!forceStartLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiadas solicitudes de intervención. Espera unos momentos.",
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

    // Consultar permisos internos del usuario para la autorización
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
    const result = await forceStartServiceBySupport(prisma, actor as any, id, rawBody);

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

    console.error("[SupportForceStartAPI][POST] Error al forzar inicio de orden:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible procesar la intervención de soporte.",
      },
      500
    );
  }
}
