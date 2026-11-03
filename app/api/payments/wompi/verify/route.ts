import { getCurrentUser } from "@/lib/auth";
import { redactSensitivePaymentStrings } from "@/lib/paymentPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import {
  VERIFY_TRANSACTION_ID_REGEX,
  WompiNetworkError,
  WompiServiceError,
  verifyWompiTransactionForClient,
} from "@/lib/wompiService";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_JSON_BYTES = 16 * 1024;

// Límite estricto del Plan Maestro: 15 solicitudes cada 5 minutos por cliente
const verifyLimiter = createRateLimiter({
  max: 15,
  windowMs: 5 * 60 * 1000,
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function handleVerifyError(error: unknown) {
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
  console.error("[WompiVerifyAPI] Error inesperado:", safeDetail);

  return jsonResponse(
    {
      success: false,
      code: "INTERNAL_ERROR",
      message: "No fue posible verificar el estado de tu pago en este momento.",
      retryable: true,
    },
    500
  );
}

async function handleVerification(user: any, cleanTxId: string) {
  if (!VERIFY_TRANSACTION_ID_REGEX.test(cleanTxId)) {
    return jsonResponse(
      {
        success: false,
        code: "INVALID_TRANSACTION_ID",
        message:
          "El identificador de la transacción no cumple con el formato requerido.",
      },
      400
    );
  }

  const outcome = await verifyWompiTransactionForClient(
    prisma,
    user,
    cleanTxId
  );

  return jsonResponse(
    {
      success: true,
      outcome,
    },
    200
  );
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión para verificar el resultado de tu pago.",
        },
        401
      );
    }

    if (!verifyLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message:
            "Has realizado demasiadas consultas de verificación. Espera unos minutos antes de reintentar.",
          retryable: true,
        },
        429
      );
    }

    const url = new URL(request.url);
    const rawTxId = url.searchParams.get("id") || url.searchParams.get("transactionId") || "";
    const cleanTxId = rawTxId.trim();

    if (!VERIFY_TRANSACTION_ID_REGEX.test(cleanTxId)) {
      return jsonResponse(
        {
          success: false,
          code: "INVALID_TRANSACTION_ID",
          message:
            "El identificador de la transacción no cumple con el formato requerido.",
        },
        400
      );
    }

    // Consulta PURAMENTE de solo lectura: NO ejecuta mutaciones financieras ni acredita saldos en GET
    const localAttempt = await prisma.intentoPagoWompi.findUnique({
      where: { wompiTransactionId: cleanTxId },
      select: {
        id: true,
        referenciaWompi: true,
        montoEnCentavos: true,
        moneda: true,
        estado: true,
        estadoProveedor: true,
        creadoEn: true,
        orden: {
          select: {
            id: true,
            numeroOrden: true,
            clienteId: true,
            estadoPago: true,
          },
        },
        recarga: {
          select: {
            id: true,
            usuarioId: true,
            estado: true,
          },
        },
      },
    });

    if (!localAttempt) {
      return jsonResponse(
        {
          success: false,
          code: "TRANSACTION_NOT_FOUND",
          message: "No se encontró la transacción solicitada.",
        },
        404
      );
    }

    if (localAttempt.orden && localAttempt.orden.clienteId !== user.id) {
      return jsonResponse(
        {
          success: false,
          code: "TRANSACTION_NOT_FOUND",
          message: "No se encontró la transacción solicitada.",
        },
        404
      );
    }

    if (localAttempt.recarga && localAttempt.recarga.usuarioId !== user.id) {
      return jsonResponse(
        {
          success: false,
          code: "TRANSACTION_NOT_FOUND",
          message: "No se encontró la transacción solicitada.",
        },
        404
      );
    }

    return jsonResponse(
      {
        success: true,
        readOnly: true,
        status: localAttempt.estado,
        providerStatus: localAttempt.estadoProveedor,
        reference: localAttempt.referenciaWompi,
        amountInCents: localAttempt.montoEnCentavos.toString(),
        currency: localAttempt.moneda,
        orderNumber: localAttempt.orden?.numeroOrden ?? null,
        orderPaymentStatus: localAttempt.orden?.estadoPago ?? null,
        recargaEstado: localAttempt.recarga?.estado ?? null,
      },
      200
    );
  } catch (error) {
    return handleVerifyError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión para verificar el resultado de tu pago.",
        },
        401
      );
    }

    if (!verifyLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message:
            "Has realizado demasiadas consultas de verificación. Espera unos minutos antes de reintentar.",
          retryable: true,
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
          message:
            "El cuerpo de la solicitud debe ser un objeto JSON con transactionId.",
        },
        400
      );
    }

    const rawTxId = (rawBody as Record<string, unknown>).transactionId;
    const cleanTxId = typeof rawTxId === "string" ? rawTxId.trim() : "";
    return await handleVerification(user, cleanTxId);
  } catch (error) {
    return handleVerifyError(error);
  }
}
