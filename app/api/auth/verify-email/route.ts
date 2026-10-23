import {
  createSession,
  verifyVerificationCodeHash,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";

const CODE_REGEX = /^\d{6}$/;
const USERNAME_MAX_LENGTH = 50;
const EMAIL_MAX_LENGTH = 150;

const verifyIpLimiter = createRateLimiter({
  max: 20,
  windowMs: 15 * 60 * 1000,
});
const verifyTargetLimiter = createRateLimiter({
  max: 10,
  windowMs: 15 * 60 * 1000,
});

function fail(message: string, status = 400, extra?: Record<string, unknown>) {
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
    if (verifyIpLimiter.isLimited(ip)) {
      return fail(
        "Demasiados intentos de verificación. Intenta de nuevo en unos minutos.",
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
    const code = typeof data.code === "string" ? data.code.trim() : "";

    if ((!username && !email) || !code) {
      return fail("Ingresa el código de verificación de 6 dígitos.");
    }

    if (
      username.length > USERNAME_MAX_LENGTH ||
      email.length > EMAIL_MAX_LENGTH
    ) {
      return fail("Datos de verificación inválidos.");
    }

    if (!CODE_REGEX.test(code)) {
      return fail("El código debe contener exactamente 6 dígitos numéricos.");
    }

    const targetKey = username || email;
    if (verifyTargetLimiter.isLimited(targetKey)) {
      return fail(
        "Demasiados intentos para esta cuenta. Espera unos minutos o solicita un nuevo código.",
        429
      );
    }

    verifyIpLimiter.record(ip);
    verifyTargetLimiter.record(targetKey);

    const usuario = await prisma.usuario.findFirst({
      where: {
        ...(username ? { nombreUsuario: username } : {}),
        ...(email ? { email } : {}),
      },
      include: {
        perfilCliente: true,
        perfilReparador: true,
      },
    });

    if (!usuario || !usuario.email) {
      return fail(
        "El código es inválido o ha expirado. Verifica e intenta nuevamente."
      );
    }

    if (usuario.estado === "SUSPENDIDO") {
      return fail("Tu cuenta está suspendida. Contacta a soporte.", 403);
    }

    if (usuario.estado === "VERIFICADO") {
      return fail(
        "Este correo electrónico ya fue verificado. Ahora puedes iniciar sesión.",
        409
      );
    }

    const verificacion = await prisma.verificacionCorreo.findFirst({
      where: {
        usuarioId: usuario.id,
        consumidoEn: null,
        invalidadoEn: null,
      },
      orderBy: { creadoEn: "desc" },
    });

    const now = new Date();

    if (!verificacion) {
      return fail(
        "No hay un código de verificación activo. Solicita el reenvío de un nuevo código."
      );
    }

    if (verificacion.fechaExpira.getTime() <= now.getTime()) {
      await prisma.verificacionCorreo.updateMany({
        where: { id: verificacion.id, invalidadoEn: null },
        data: { invalidadoEn: now },
      });
      return fail(
        "El código de verificación ha expirado. Solicita un código nuevo."
      );
    }

    if (verificacion.intentos >= verificacion.maxIntentos) {
      await prisma.verificacionCorreo.updateMany({
        where: { id: verificacion.id, invalidadoEn: null },
        data: { invalidadoEn: now },
      });
      return fail(
        "Has superado el número máximo de intentos. Solicita un nuevo código de verificación.",
        429
      );
    }

    const esValido = verifyVerificationCodeHash(
      usuario.id,
      verificacion.correoDestino,
      code,
      verificacion.codigoHash
    );

    if (!esValido) {
      const nuevosIntentos = verificacion.intentos + 1;
      const agotado = nuevosIntentos >= verificacion.maxIntentos;

      await prisma.verificacionCorreo.update({
        where: { id: verificacion.id },
        data: {
          intentos: { increment: 1 },
          ...(agotado ? { invalidadoEn: now } : {}),
        },
      });

      if (agotado) {
        return fail(
          "Superaste el máximo de intentos permitidos. Solicita un nuevo código de verificación.",
          429
        );
      }

      const restantes = Math.max(0, verificacion.maxIntentos - nuevosIntentos);
      return fail(
        `Código incorrecto. Te ${restantes === 1 ? "queda 1 intento" : `quedan ${restantes} intentos`}.`
      );
    }

    // Consumir el código y activar la cuenta de forma atómica
    let usuarioActualizado;
    try {
      usuarioActualizado = await prisma.$transaction(async (tx) => {
        const consumido = await tx.verificacionCorreo.updateMany({
          where: {
            id: verificacion.id,
            consumidoEn: null,
            invalidadoEn: null,
            intentos: { lt: verificacion.maxIntentos },
            fechaExpira: { gt: now },
          },
          data: {
            consumidoEn: now,
          },
        });

        if (consumido.count !== 1) {
          throw new Error("VERIFICATION_ALREADY_CONSUMED");
        }

        await tx.verificacionCorreo.updateMany({
          where: {
            usuarioId: usuario.id,
            id: { not: verificacion.id },
            consumidoEn: null,
            invalidadoEn: null,
          },
          data: {
            invalidadoEn: now,
          },
        });

        return tx.usuario.update({
          where: { id: usuario.id },
          data: {
            estado: "VERIFICADO",
            codigoVerificacion: null,
            codigoVerificacionExpiraEn: null,
          },
          include: {
            perfilCliente: true,
            perfilReparador: true,
          },
        });
      });
    } catch (txErr) {
      if ((txErr as Error).message === "VERIFICATION_ALREADY_CONSUMED") {
        return fail(
          "Este código ya fue utilizado o expiró. Inicia sesión o solicita uno nuevo.",
          409
        );
      }
      throw txErr;
    }

    let sesionIniciada = true;
    try {
      await createSession(usuarioActualizado.id);
    } catch (sessionError) {
      sesionIniciada = false;
      console.error(
        "Correo verificado pero falló la creación de la sesión:",
        sessionError
      );
    }

    const {
      passwordHash: _hash,
      codigoVerificacion: _codigo,
      codigoVerificacionExpiraEn: _codigoExpira,
      intentosFallidosLogin: _intentos,
      bloqueadoHasta: _bloqueo,
      ...usuarioSeguro
    } = usuarioActualizado;

    return Response.json({
      success: true,
      sesionIniciada,
      message: sesionIniciada
        ? "Correo verificado correctamente. ¡Bienvenido a BuildMeAPP!"
        : "Correo verificado correctamente. Ahora puedes iniciar sesión.",
      user: usuarioSeguro,
    });
  } catch (error) {
    console.error(
      `[VerifyEmail] Error al verificar el código | tipo=${
        error instanceof Error ? error.name : "desconocido"
      } | codigo=${(error as { code?: string }).code ?? "n/d"}`
    );
    return fail("No fue posible verificar el código.", 500);
  }
}
