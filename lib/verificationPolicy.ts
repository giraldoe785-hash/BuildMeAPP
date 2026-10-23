// Política del código de verificación de correo.
// Módulo PURO (sin Prisma ni Next): lo usan las rutas y las pruebas.

export const VERIFICATION_CODE_EXPIRY_MINUTES = 10;
export const VERIFICATION_CODE_EXPIRY_MS =
  VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000;
export const VERIFICATION_MAX_ATTEMPTS = 5;

/** Tiempo mínimo entre dos envíos de código a la misma cuenta. */
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
export const VERIFICATION_RESEND_COOLDOWN_SECONDS =
  VERIFICATION_RESEND_COOLDOWN_MS / 1000;

/** Máximo de códigos emitidos (incluidos los que fallaron al enviarse) por cuenta y hora. */
export const VERIFICATION_MAX_CODES_PER_HOUR = 6;
export const VERIFICATION_HOURLY_WINDOW_MS = 60 * 60 * 1000;

export interface VerificationRowState {
  fechaExpira: Date;
  intentos: number;
  maxIntentos: number;
  consumidoEn: Date | null;
  invalidadoEn: Date | null;
}

/** ¿El código sigue pudiendo ser introducido por el usuario? */
export function isCodeUsable(row: VerificationRowState, now: Date): boolean {
  return (
    row.consumidoEn === null &&
    row.invalidadoEn === null &&
    row.fechaExpira.getTime() > now.getTime() &&
    row.intentos < row.maxIntentos
  );
}

/** Segundos que faltan para poder solicitar otro envío (0 si ya se puede). */
export function cooldownSecondsRemaining(ultimoEnvioEn: Date, now: Date): number {
  const elapsed = now.getTime() - ultimoEnvioEn.getTime();
  const remainingMs = VERIFICATION_RESEND_COOLDOWN_MS - elapsed;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/** Segundos de vigencia que le quedan al código (mínimo 0). */
export function secondsUntilExpiry(fechaExpira: Date, now: Date): number {
  const remainingMs = fechaExpira.getTime() - now.getTime();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * Si ya se alcanzó el tope por hora, indica en cuántos segundos se libera un
 * cupo (cuando el código emitido más antiguo salga de la ventana).
 * Devuelve 0 si todavía hay cupo.
 */
export function hourlyLimitRetryAfterSeconds(
  creadosEn: Date[],
  now: Date
): number {
  const inWindow = creadosEn
    .filter((d) => now.getTime() - d.getTime() < VERIFICATION_HOURLY_WINDOW_MS)
    .sort((a, b) => a.getTime() - b.getTime());

  if (inWindow.length < VERIFICATION_MAX_CODES_PER_HOUR) return 0;

  // El cupo se libera cuando sale de la ventana el código que deja de contar
  // para quedar por debajo del tope.
  const blocking = inWindow[inWindow.length - VERIFICATION_MAX_CODES_PER_HOUR];
  const releaseAt = blocking.getTime() + VERIFICATION_HOURLY_WINDOW_MS;
  return Math.max(1, Math.ceil((releaseAt - now.getTime()) / 1000));
}
