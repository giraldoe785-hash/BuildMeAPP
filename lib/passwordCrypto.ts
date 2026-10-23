/**
 * Funciones puras de hash y verificación de contraseñas para BuildMeAPP.
 *
 * Contrato criptográfico:
 * - Algoritmo: node:crypto.scrypt (keylen: 64 bytes).
 * - Sal: 16 bytes aleatorios codificados en cadena hexadecimal de 32 caracteres.
 * - Nota crítica de compatibilidad: `scrypt` recibe la cadena hexadecimal como sal.
 * - Formato canónico versionado (3 partes): `scrypt1:<salt_hex_32>:<derived_key_hex_128>`.
 * - Formato heredado compatible (2 partes): `<salt_hex_32>:<derived_key_hex_128>`.
 * - Validación estricta previa con regex antes de Buffer.from y scrypt.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const PASSWORD_KEY_LENGTH = 64;
export const HASH_ALGO_TAG = "scrypt1";
export const SALT_BYTES = 16;

// Validaciones estrictas de formato hexadecimal exacto:
// - Sal: exactamente 32 caracteres hexadecimales [0-9a-fA-F]
// - Clave derivada: exactamente 128 caracteres hexadecimales [0-9a-fA-F]
export const HEX_32_REGEX = /^[0-9a-f]{32}$/i;
export const HEX_128_REGEX = /^[0-9a-f]{128}$/i;

/**
 * Genera un hash canónico `scrypt1` con sal criptográficamente aleatoria de 16 bytes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");

  try {
    const derivedKey = (await scrypt(
      password,
      salt,
      PASSWORD_KEY_LENGTH
    )) as Buffer;

    return `${HASH_ALGO_TAG}:${salt}:${derivedKey.toString("hex")}`;
  } catch (error) {
    console.error("Error generando hash de contraseña:", error);
    throw new Error("No se pudo procesar la contraseña. Intenta de nuevo.");
  }
}

/**
 * Verifica una contraseña en texto plano contra un hash almacenado.
 *
 * Realiza validación estricta de formato por expresión regular antes de
 * Buffer.from y scrypt, evitando derivaciones innecesarias ante datos malformados
 * y descartando sufijos o caracteres inválidos.
 */
export async function verifyPassword(
  password: string,
  storedPasswordHash: string
): Promise<boolean> {
  if (typeof storedPasswordHash !== "string" || !storedPasswordHash) {
    return false;
  }

  const partes = storedPasswordHash.split(":");
  let salt: string | undefined;
  let storedKeyHex: string | undefined;

  if (partes.length === 3 && partes[0] === HASH_ALGO_TAG) {
    [, salt, storedKeyHex] = partes;
  } else if (partes.length === 2) {
    [salt, storedKeyHex] = partes;
  } else {
    return false;
  }

  // Validación estricta previa:
  // Rechaza caracteres no-hex (al inicio, medio o final como sufijo), longitudes incorrectas y separadores extras.
  if (
    !salt ||
    !storedKeyHex ||
    !HEX_32_REGEX.test(salt) ||
    !HEX_128_REGEX.test(storedKeyHex)
  ) {
    return false;
  }

  try {
    const storedKey = Buffer.from(storedKeyHex, "hex");
    if (storedKey.length !== PASSWORD_KEY_LENGTH) {
      return false;
    }

    const derivedKey = (await scrypt(
      password,
      salt,
      PASSWORD_KEY_LENGTH
    )) as Buffer;

    if (storedKey.length !== derivedKey.length) {
      return false;
    }

    return timingSafeEqual(storedKey, derivedKey);
  } catch {
    return false;
  }
}
