import {
  deleteCurrentSession,
  hashPassword,
  hashPasswordResetToken,
} from "@/lib/auth";
import {
  evaluateResetTokenRecord,
  validatePasswordResetSubmission,
} from "@/lib/passwordResetPolicy";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Referrer-Policy": "no-referrer",
};

const resetIpLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json(
    { success: false, message, ...extra },
    { status, headers: NO_STORE_HEADERS }
  );
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
    if (resetIpLimiter.isLimited(ip)) {
      return fail(
        "Demasiados intentos. Intenta nuevamente en unos minutos.",
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
    const rawToken = typeof data.token === "string" ? data.token : "";
    const password = typeof data.password === "string" ? data.password : "";
    const confirmPassword =
      typeof data.confirmPassword === "string" ? data.confirmPassword : "";

    const inputCheck = validatePasswordResetSubmission({
      token: rawToken,
      password,
      confirmPassword,
    });

    if (!inputCheck.ok) {
      return fail(
        inputCheck.message,
        inputCheck.status,
        inputCheck.reason ? { reason: inputCheck.reason } : undefined
      );
    }

    const token = inputCheck.token;
    resetIpLimiter.record(ip);

    const tokenHash = hashPasswordResetToken(token);
    const registroToken = await prisma.tokenRecuperacionPassword.findUnique({
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

    const now = new Date();
    const evaluation = evaluateResetTokenRecord(registroToken, now);

    if (!evaluation.valid || !registroToken) {
      if (
        !evaluation.valid &&
        evaluation.reason === "expired" &&
        registroToken &&
        !registroToken.invalidadoEn
      ) {
        await prisma.tokenRecuperacionPassword.updateMany({
          where: { id: registroToken.id, invalidadoEn: null },
          data: { invalidadoEn: now },
        });
      }

      const errEval = !evaluation.valid
        ? evaluation
        : {
            status: 400 as const,
            reason: "invalid" as const,
            message: "El enlace de recuperación no es válido.",
          };

      return fail(errEval.message, errEval.status, {
        reason: errEval.reason,
      });
    }

    const nuevoPasswordHash = await hashPassword(password);

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Consumir el token de manera atómica para impedir reutilizaciones o condiciones de carrera
        const consumido = await tx.tokenRecuperacionPassword.updateMany({
          where: {
            id: registroToken.id,
            consumidoEn: null,
            invalidadoEn: null,
            fechaExpira: { gt: now },
          },
          data: {
            consumidoEn: now,
          },
        });

        if (consumido.count !== 1) {
          throw new Error("RESET_TOKEN_ALREADY_USED");
        }

        // 2. Invalidar cualquier otro token de recuperación activo del mismo usuario
        await tx.tokenRecuperacionPassword.updateMany({
          where: {
            usuarioId: registroToken.usuarioId,
            id: { not: registroToken.id },
            consumidoEn: null,
            invalidadoEn: null,
          },
          data: {
            invalidadoEn: now,
          },
        });

        // 3. Actualizar Usuario.passwordHash y limpiar bloqueos por intentos fallidos
        await tx.usuario.update({
          where: { id: registroToken.usuarioId },
          data: {
            passwordHash: nuevoPasswordHash,
            intentosFallidosLogin: 0,
            bloqueadoHasta: null,
          },
        });

        // 4. Revocar todas las sesiones activas del usuario en SesionUsuario
        await tx.sesionUsuario.updateMany({
          where: {
            usuarioId: registroToken.usuarioId,
            revocado: false,
          },
          data: {
            revocado: true,
          },
        });
      });
    } catch (txError) {
      if ((txError as Error).message === "RESET_TOKEN_ALREADY_USED") {
        return fail(
          "Este enlace de recuperación ya fue utilizado.",
          410,
          { reason: "consumed" }
        );
      }
      throw txError;
    }

    // Asegurar que no quede ninguna cookie de sesión activa en este navegador
    try {
      await deleteCurrentSession();
    } catch {
      /* continuar si no había cookie */
    }

    return Response.json(
      {
        success: true,
        message:
          "Tu contraseña ha sido actualizada correctamente. Ahora puedes iniciar sesión con tu nueva contraseña.",
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Error al restablecer la contraseña:", error);
    return fail("No fue posible actualizar la contraseña.", 500);
  }
}
