import { generateSixDigitCode, hashVerificationCode } from "@/lib/auth";
import { sendVerificationCodeEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import {
  VERIFICATION_CODE_EXPIRY_MINUTES,
  VERIFICATION_CODE_EXPIRY_MS,
  VERIFICATION_HOURLY_WINDOW_MS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
  cooldownSecondsRemaining,
  hourlyLimitRetryAfterSeconds,
  isCodeUsable,
  secondsUntilExpiry,
} from "@/lib/verificationPolicy";

/**
 * - "register": el usuario envió el formulario de registro. Si hay un código vigente
 *   dentro del enfriamiento no se reenvía; fuera del enfriamiento se emite uno nuevo.
 * - "login": credenciales correctas de una cuenta pendiente. Si hay un código vigente
 *   se REUTILIZA (no se envía otro correo); si no hay, se emite y envía uno.
 * - "resend": el usuario pidió explícitamente otro código. Respeta el enfriamiento.
 */
export type IssueMode = "register" | "login" | "resend";

export type IssueResult =
  | { status: "sent"; cooldownSeconds: number; expiresInSeconds: number }
  | { status: "existing"; cooldownSeconds: number; expiresInSeconds: number }
  | { status: "cooldown"; retryAfterSeconds: number }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "failed"; userMessage: string };

interface PendingAccountShape {
  rol: string;
  estado: string;
  passwordHash: string | null;
  email: string | null;
  identidadesOAuth: unknown[];
}

/**
 * Cuenta de cliente con contraseña local, correo registrado, sin identidad de Google
 * y todavía sin verificar. Es la ÚNICA que puede recibir códigos de verificación.
 * Las cuentas antiguas sin correo y las de Google quedan fuera a propósito.
 */
export function isPendingTraditionalAccount(u: PendingAccountShape): boolean {
  return (
    u.rol === "CLIENTE" &&
    u.estado === "PENDIENTE_VERIFICACION" &&
    u.passwordHash !== null &&
    Boolean(u.email) &&
    u.identidadesOAuth.length === 0
  );
}

type Prepared =
  | { kind: "result"; result: IssueResult }
  | { kind: "created"; verificacionId: string; previousUsableIds: string[] };

/**
 * Emite (o reutiliza) un código de verificación para una cuenta pendiente.
 *
 * Garantías:
 * - Solicitudes concurrentes de la misma cuenta se serializan con un bloqueo de fila
 *   (UPDATE sobre `usuarios`), de modo que nunca quedan dos códigos válidos a la vez
 *   ni se envían correos duplicados.
 * - El código se guarda solo como HMAC; el texto plano únicamente viaja en el correo.
 * - Si Resend rechaza el envío, el código nuevo se invalida y se restauran los códigos
 *   anteriores que seguían vigentes, de modo que el usuario puede reintentar de inmediato.
 */
export async function issueEmailVerificationCode(params: {
  usuarioId: string;
  correoDestino: string;
  nombre: string;
  mode: IssueMode;
}): Promise<IssueResult> {
  const now = new Date();
  const codigo = generateSixDigitCode();
  const fechaExpira = new Date(now.getTime() + VERIFICATION_CODE_EXPIRY_MS);
  const codigoHash = hashVerificationCode(
    params.usuarioId,
    params.correoDestino,
    codigo
  );

  const prepared = await prisma.$transaction(async (tx): Promise<Prepared> => {
    // Bloqueo de fila: la siguiente solicitud del mismo usuario espera aquí hasta
    // que esta transacción confirme y luego ve el código recién creado.
    await tx.usuario.update({
      where: { id: params.usuarioId },
      data: { codigoVerificacion: null },
      select: { id: true },
    });

    const activeRows = await tx.verificacionCorreo.findMany({
      where: {
        usuarioId: params.usuarioId,
        consumidoEn: null,
        invalidadoEn: null,
      },
      orderBy: { creadoEn: "desc" },
    });

    const usableRows = activeRows.filter((row) => isCodeUsable(row, now));
    const latestUsable = usableRows[0];

    if (latestUsable) {
      const cooldownSeconds = cooldownSecondsRemaining(
        latestUsable.ultimoEnvioEn,
        now
      );
      const expiresInSeconds = secondsUntilExpiry(latestUsable.fechaExpira, now);

      if (params.mode === "login") {
        return {
          kind: "result",
          result: { status: "existing", cooldownSeconds, expiresInSeconds },
        };
      }

      if (cooldownSeconds > 0) {
        return {
          kind: "result",
          result:
            params.mode === "resend"
              ? { status: "cooldown", retryAfterSeconds: cooldownSeconds }
              : { status: "existing", cooldownSeconds, expiresInSeconds },
        };
      }
    }

    const recentRows = await tx.verificacionCorreo.findMany({
      where: {
        usuarioId: params.usuarioId,
        creadoEn: { gte: new Date(now.getTime() - VERIFICATION_HOURLY_WINDOW_MS) },
      },
      select: { creadoEn: true },
    });

    const retryAfterSeconds = hourlyLimitRetryAfterSeconds(
      recentRows.map((r) => r.creadoEn),
      now
    );
    if (retryAfterSeconds > 0) {
      return {
        kind: "result",
        result: { status: "rate_limited", retryAfterSeconds },
      };
    }

    // Invalida todo lo activo (vigente o no) y crea el nuevo código.
    if (activeRows.length > 0) {
      await tx.verificacionCorreo.updateMany({
        where: { id: { in: activeRows.map((r) => r.id) }, invalidadoEn: null },
        data: { invalidadoEn: now },
      });
    }

    const created = await tx.verificacionCorreo.create({
      data: {
        usuarioId: params.usuarioId,
        correoDestino: params.correoDestino,
        codigoHash,
        intentos: 0,
        maxIntentos: VERIFICATION_MAX_ATTEMPTS,
        reenvios: recentRows.length,
        ultimoEnvioEn: now,
        fechaExpira,
      },
      select: { id: true },
    });

    return {
      kind: "created",
      verificacionId: created.id,
      previousUsableIds: usableRows.map((r) => r.id),
    };
  });

  if (prepared.kind === "result") {
    return prepared.result;
  }

  const sendResult = await sendVerificationCodeEmail({
    to: params.correoDestino,
    nombre: params.nombre,
    codigo,
    expiraEnMinutos: VERIFICATION_CODE_EXPIRY_MINUTES,
  });

  if (!sendResult.success) {
    // El código no se entregó: se invalida y se restauran los anteriores que seguían
    // vigentes para no dejar al usuario sin ningún código utilizable.
    try {
      await prisma.$transaction([
        prisma.verificacionCorreo.updateMany({
          where: { id: prepared.verificacionId, invalidadoEn: null },
          data: { invalidadoEn: new Date() },
        }),
        ...(prepared.previousUsableIds.length > 0
          ? [
              prisma.verificacionCorreo.updateMany({
                where: {
                  id: { in: prepared.previousUsableIds },
                  consumidoEn: null,
                  fechaExpira: { gt: new Date() },
                },
                data: { invalidadoEn: null },
              }),
            ]
          : []),
      ]);
    } catch (cleanupError) {
      console.error(
        "[EmailVerification] No se pudo limpiar el código tras un envío fallido:",
        cleanupError instanceof Error ? cleanupError.name : "error"
      );
    }

    return { status: "failed", userMessage: sendResult.userMessage };
  }

  return {
    status: "sent",
    cooldownSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS,
    expiresInSeconds: Math.floor(VERIFICATION_CODE_EXPIRY_MS / 1000),
  };
}
