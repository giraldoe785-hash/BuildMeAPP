import {
  constantTimeHexEquals,
  redactSensitivePaymentStrings,
} from "@/lib/paymentPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import {
  WompiNetworkError,
  WompiServiceError,
  processWompiWebhook,
} from "@/lib/wompiService";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_WEBHOOK_BYTES = 64 * 1024;

// Protección básica contra inundación por origen IP: 120 eventos por minuto
const webhookIpLimiter = createRateLimiter({
  max: 120,
  windowMs: 60 * 1000,
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function resolveClientIpKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return `ip:${realIp}`;
  return "ip:global";
}

export async function POST(request: Request) {
  try {
    const ipKey = resolveClientIpKey(request);
    if (!webhookIpLimiter.consume(ipKey)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Demasiadas notificaciones recibidas en poco tiempo.",
          retryable: true,
        },
        429
      );
    }

    // Extraer cabecera antes de readBoundedBody (que reconstruye headers esenciales)
    const rawHeaderChecksum = request.headers.get("x-event-checksum");

    const bounded = await readBoundedBody(request, MAX_WEBHOOK_BYTES);
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
          message: "El cuerpo del webhook no contiene JSON válido.",
        },
        400
      );
    }

    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return jsonResponse(
        {
          success: false,
          code: "INVALID_WEBHOOK_PAYLOAD",
          message: "El cuerpo del webhook debe ser un objeto JSON.",
        },
        400
      );
    }

    // Validación explícita en tiempo constante si se incluye X-Event-Checksum
    if (rawHeaderChecksum !== null) {
      const cleanHeader = rawHeaderChecksum.trim();
      const sigObj = (rawBody as Record<string, unknown>).signature;
      const rawBodyChecksum =
        sigObj &&
        typeof sigObj === "object" &&
        !Array.isArray(sigObj) &&
        typeof (sigObj as Record<string, unknown>).checksum === "string"
          ? ((sigObj as Record<string, unknown>).checksum as string).trim()
          : "";

      if (!cleanHeader || !constantTimeHexEquals(cleanHeader, rawBodyChecksum)) {
        return jsonResponse(
          {
            success: false,
            code: "HEADER_BODY_CHECKSUM_MISMATCH",
            message:
              "El encabezado X-Event-Checksum no coincide con signature.checksum.",
          },
          401
        );
      }
    }

    const outcome = await processWompiWebhook(
      prisma,
      rawBody,
      rawHeaderChecksum
    );

    // HTTP 200 únicamente tras el commit exitoso o replay idempotente verificado
    return jsonResponse(
      {
        success: true,
        received: true,
        idempotentReplay: outcome.idempotentReplay,
        kind: "kind" in outcome ? outcome.kind : "ORDER",
        orderPaymentStatus: "kind" in outcome ? null : outcome.orderPaymentStatus,
        recargaEstado: "kind" in outcome ? outcome.recargaEstado : null,
        intentStatus: outcome.intentStatus,
        providerStatus: outcome.providerStatus,
      },
      200
    );
  } catch (error) {
    if (error instanceof WompiNetworkError) {
      return jsonResponse(
        {
          success: false,
          code: error.code,
          message: error.message,
          retryable: true,
        },
        503
      );
    }

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
    console.error("[WompiWebhookAPI][POST] Error en procesamiento:", safeDetail);

    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_WEBHOOK_ERROR",
        message: "Error transitorio al consolidar el evento de pago.",
        retryable: true,
      },
      500
    );
  }
}
