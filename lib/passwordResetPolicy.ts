// Política y validaciones puras del flujo de recuperación de contraseña.
// Módulo sin dependencias de Next.js ni de red para permitir pruebas unitarias directas.

import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const RESET_TOKEN_EXPIRY_MINUTES = 15;
export const RESET_TOKEN_EXPIRY_MS = RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000;
export const RESET_PER_USER_COOLDOWN_MS = 60 * 1000;

export const TOKEN_HEX_REGEX = /^[a-f0-9]{64}$/i;
export const PASSWORD_MIN_LENGTH = 7;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RESET_POLICY_ERROR =
  "La contraseña debe tener mínimo 7 caracteres y contener al menos 2 números.";

export const GENERIC_PASSWORD_RESET_REQUEST_MESSAGE =
  "Si existe una cuenta compatible con esa dirección, recibirás un enlace para recuperar tu contraseña.";

export function isValidResetPassword(password: string): boolean {
  const numbersCount = (password.match(/\d/g) || []).length;
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    numbersCount >= 2
  );
}

/**
 * Genera un token criptográficamente seguro de 32 bytes (64 caracteres hex)
 * y su correspondiente hash SHA-256 para almacenar en TokenRecuperacionPassword.
 */
export function generateResetTokenPair(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetTokenValue(token);
  return { token, tokenHash };
}

/**
 * Calcula el hash SHA-256 con prefijo de dominio para un token de recuperación.
 */
export function hashResetTokenValue(token: string): string {
  return createHash("sha256")
    .update(`pwd-reset:v1:${token}`)
    .digest("hex");
}

/**
 * Determina si una cuenta puede recibir un enlace de recuperación de contraseña.
 * - Las cuentas inexistentes, sin correo, suspendidas o exclusivas de Google OAuth
 *   (passwordHash === null) NO son elegibles, preservando su método de acceso.
 */
export function isAccountEligibleForPasswordReset(
  usuario:
    | {
        email: string | null;
        estado: string;
        passwordHash: string | null;
      }
    | null
    | undefined
): boolean {
  return Boolean(
    usuario &&
      usuario.email &&
      usuario.estado !== "SUSPENDIDO" &&
      usuario.passwordHash
  );
}

export type ResetTokenEvaluation =
  | { valid: true }
  | {
      valid: false;
      reason: "invalid" | "consumed" | "expired";
      status: 400 | 410;
      message: string;
    };

/**
 * Evalúa el estado de un registro de TokenRecuperacionPassword.
 */
export function evaluateResetTokenRecord(
  registro:
    | {
        fechaExpira: Date;
        consumidoEn: Date | null;
        invalidadoEn: Date | null;
        usuario?: {
          id: string;
          estado: string;
          passwordHash: string | null;
        } | null;
      }
    | null
    | undefined,
  now: Date = new Date()
): ResetTokenEvaluation {
  if (
    !registro ||
    !registro.usuario ||
    registro.usuario.estado === "SUSPENDIDO" ||
    !registro.usuario.passwordHash
  ) {
    return {
      valid: false,
      reason: "invalid",
      status: 400,
      message: "El enlace de recuperación no es válido.",
    };
  }

  if (registro.consumidoEn || registro.invalidadoEn) {
    return {
      valid: false,
      reason: "consumed",
      status: 410,
      message:
        "Este enlace de recuperación ya fue utilizado o reemplazado por uno más reciente.",
    };
  }

  if (registro.fechaExpira.getTime() <= now.getTime()) {
    return {
      valid: false,
      reason: "expired",
      status: 410,
      message:
        "Este enlace de recuperación ha caducado. Solicita uno nuevo desde el inicio de sesión.",
    };
  }

  return { valid: true };
}

export type PasswordResetInputValidation =
  | { ok: true; token: string }
  | {
      ok: false;
      status: 400;
      reason?: "invalid";
      message: string;
    };

/**
 * Valida los datos enviados a POST /api/auth/password/reset antes de consultar la BD.
 */
export function validatePasswordResetSubmission(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): PasswordResetInputValidation {
  const cleanToken = input.token.trim();

  if (!cleanToken || !TOKEN_HEX_REGEX.test(cleanToken)) {
    return {
      ok: false,
      status: 400,
      reason: "invalid",
      message: "El enlace de recuperación no es válido o está incompleto.",
    };
  }

  if (!input.password || !input.confirmPassword) {
    return {
      ok: false,
      status: 400,
      message: "Debes ingresar y confirmar tu nueva contraseña.",
    };
  }

  if (!isValidResetPassword(input.password)) {
    return {
      ok: false,
      status: 400,
      message: PASSWORD_RESET_POLICY_ERROR,
    };
  }

  if (input.password !== input.confirmPassword) {
    return {
      ok: false,
      status: 400,
      message: "La confirmación no coincide con la nueva contraseña.",
    };
  }

  return { ok: true, token: cleanToken };
}

// Funciones compatibles con el algoritmo scrypt de lib/auth.ts (16 bytes salt, 64 bytes key)
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashPasswordScrypt(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_BYTES)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPasswordScrypt(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const [salt, keyHex] = storedHash.split(":");
    if (!salt || !keyHex) return false;
    const storedKey = Buffer.from(keyHex, "hex");
    if (storedKey.length !== KEY_BYTES) return false;
    const derivedKey = (await scrypt(password, salt, KEY_BYTES)) as Buffer;
    return timingSafeEqual(storedKey, derivedKey);
  } catch {
    return false;
  }
}
