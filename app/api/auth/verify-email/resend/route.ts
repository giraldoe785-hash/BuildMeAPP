import {
  isPendingTraditionalAccount,
  issueEmailVerificationCode,
} from "@/lib/emailVerification";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";

const USERNAME_MAX_LENGTH = 50;
const EMAIL_MAX_LENGTH = 150;

// Límite adicional por IP (en memoria). El enfriamiento y el tope por hora de cada
// cuenta se aplican en base de datos dentro de issueEmailVerificationCode().
const resendIpLimiter = createRateLimiter({ max: 10, windowMs: 30 * 60 * 1000 });

function fail(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
) {
  return Response.json({ success: false, message, ...extra }, { status });
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "desconocida"
  );
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (resendIpLimiter.isLimited(ip)) {
      return fail(
        "Demasiadas solicitudes de reenvío desde esta conexión. Intenta más tarde.",
        429
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("El cuerpo de la solicitud no es un JSON válido.");
    }

    if (typeof body !== "object" || body === null) {
      return fail("Solicitud inválida.");
    }

    const data = body as Record<string, unknown>;
    const username =
      typeof data.username === "string"
        ? data.username.trim().toLowerCase()
        : "";
    const email =
      typeof data.email === "string" ? data.email.trim().toLowerCase() : "";

    if (!username && !email) {
      return fail("Indica el usuario o correo electrónico para reenviar el código.");
    }

    if (
      username.length > USERNAME_MAX_LENGTH ||
      email.length > EMAIL_MAX_LENGTH
    ) {
      return fail("Solicitud inválida.");
    }

    const usuario = await prisma.usuario.findFirst({
      where: {
        ...(username ? { nombreUsuario: username } : {}),
        ...(email ? { email } : {}),
      },
      include: {
        perfilCliente: true,
        identidadesOAuth: { select: { id: true } },
      },
    });

    // Respuesta idéntica para "no existe", "ya verificada", "Google" o "sin correo":
    // no se filtran estados internos de la cuenta.
    if (!usuario || !usuario.email || !isPendingTraditionalAccount(usuario)) {
      return fail(
        "No se encontró una solicitud de verificación pendiente para esta cuenta."
      );
    }

    resendIpLimiter.record(ip);

    const issued = await issueEmailVerificationCode({
      usuarioId: usuario.id,
      correoDestino: usuario.email,
      nombre: usuario.perfilCliente?.nombres || usuario.nombreUsuario,
      mode: "resend",
    });

    switch (issued.status) {
      case "sent":
        return Response.json({
          success: true,
          codeStatus: "sent",
          cooldownSeconds: issued.cooldownSeconds,
          expiresInSeconds: issued.expiresInSeconds,
          message:
            "Hemos enviado un nuevo código de 6 dígitos a tu correo electrónico.",
        });

      case "existing":
        // Solo ocurre con mode "login"/"register"; se contempla por exhaustividad.
        return Response.json({
          success: true,
          codeStatus: "existing",
          cooldownSeconds: issued.cooldownSeconds,
          expiresInSeconds: issued.expiresInSeconds,
          message:
            "Ya tienes un código vigente. Revisa tu correo e ingrésalo para continuar.",
        });

      case "cooldown":
        return fail(
          `Por favor espera ${issued.retryAfterSeconds} segundos antes de solicitar un nuevo código.`,
          429,
          { retryAfterSeconds: issued.retryAfterSeconds }
        );

      case "rate_limited":
        return fail(
          "Alcanzaste el límite de códigos de verificación por hora. Intenta nuevamente más tarde.",
          429,
          { retryAfterSeconds: issued.retryAfterSeconds }
        );

      case "failed":
        return fail(issued.userMessage, 503);
    }
  } catch (error) {
    console.error(
      `[ResendCode] Error al reenviar código de verificación | tipo=${
        error instanceof Error ? error.name : "desconocido"
      } | codigo=${(error as { code?: string }).code ?? "n/d"}`
    );
    return fail("No fue posible reenviar el código.", 500);
  }
}
