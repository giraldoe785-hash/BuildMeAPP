import { hashPasswordResetToken } from "@/lib/auth";
import {
  evaluateResetTokenRecord,
  TOKEN_HEX_REGEX,
} from "@/lib/passwordResetPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Referrer-Policy": "no-referrer",
};

const validateLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60 * 1000 });

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "desconocida"
  );
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (validateLimiter.isLimited(ip)) {
      return Response.json(
        {
          valid: false,
          reason: "rate_limited",
          message: "Demasiadas consultas. Intenta nuevamente en unos minutos.",
        },
        { status: 429, headers: NO_STORE_HEADERS }
      );
    }
    validateLimiter.record(ip);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        {
          valid: false,
          reason: "invalid",
          message: "El enlace de recuperación no es válido.",
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const token =
      typeof (body as Record<string, unknown>)?.token === "string"
        ? ((body as Record<string, unknown>).token as string).trim()
        : "";

    if (!token || !TOKEN_HEX_REGEX.test(token)) {
      return Response.json(
        {
          valid: false,
          reason: "invalid",
          message: "El enlace de recuperación no es válido o está incompleto.",
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const tokenHash = hashPasswordResetToken(token);
    const registro = await prisma.tokenRecuperacionPassword.findUnique({
      where: { tokenHash },
      include: {
        usuario: {
          select: {
            id: true,
            estado: true,
            passwordHash: true,
          },
        },
      },
    });

    const evaluation = evaluateResetTokenRecord(registro);
    if (!evaluation.valid) {
      return Response.json(
        {
          valid: false,
          reason: evaluation.reason,
          message: evaluation.message,
        },
        { status: evaluation.status, headers: NO_STORE_HEADERS }
      );
    }

    return Response.json(
      {
        valid: true,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Error al validar token de recuperación:", error);
    return Response.json(
      {
        valid: false,
        reason: "error",
        message: "No fue posible verificar el enlace de recuperación.",
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
