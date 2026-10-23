import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import {
  HASH_ALGO_TAG,
  PASSWORD_KEY_LENGTH,
  hashPassword,
  verifyPassword,
} from "./passwordCrypto";

export {
  HASH_ALGO_TAG,
  PASSWORD_KEY_LENGTH,
  hashPassword,
  verifyPassword,
};

const SESSION_COOKIE_NAME = "buildmeapp_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

// --- Rate limiting básico para login (gratis, sin librerías externas) ---
// NOTA: esto vive en memoria, así que solo funciona si tu app corre en
// una sola instancia (típico en un proyecto universitario desplegado en
// un solo servidor/contenedor). Si en algún punto despliegas en varias
// instancias o serverless con múltiples cold starts, esto deja de ser
// confiable y habría que mover el conteo a una tabla en la BD.
const MAX_INTENTOS_FALLIDOS = 5;
const VENTANA_BLOQUEO_MS = 15 * 60 * 1000; // 15 minutos

type IntentoLogin = { fallos: number; bloqueadoHasta: number | null };
const intentosLogin = new Map<string, IntentoLogin>();

export function puedeIntentarLogin(identificador: string): boolean {
  const registro = intentosLogin.get(identificador);
  if (!registro) return true;
  if (registro.bloqueadoHasta && registro.bloqueadoHasta > Date.now()) {
    return false;
  }
  return true;
}

export function registrarIntentoFallido(identificador: string): void {
  const registro = intentosLogin.get(identificador) ?? {
    fallos: 0,
    bloqueadoHasta: null,
  };

  registro.fallos += 1;

  if (registro.fallos >= MAX_INTENTOS_FALLIDOS) {
    registro.bloqueadoHasta = Date.now() + VENTANA_BLOQUEO_MS;
    registro.fallos = 0;
  }

  intentosLogin.set(identificador, registro);
}

export function limpiarIntentosLogin(identificador: string): void {
  intentosLogin.delete(identificador);
}

// --- Códigos de verificación de correo (6 dígitos) y tokens de recuperación ---

function getServerHmacSecret(): string {
  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "buildmeapp-fallback-hmac-key";
  return secret;
}

/**
 * Genera un código numérico aleatorio criptográficamente seguro de 6 dígitos.
 */
export function generateSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Calcula un HMAC-SHA256 ligado al usuario y propósito para no almacenar el
 * código de 6 dígitos en texto plano.
 */
export function hashVerificationCode(
  usuarioId: string,
  correoDestino: string,
  codigo: string
): string {
  return createHmac("sha256", getServerHmacSecret())
    .update(`email-verify:v1:${usuarioId}:${correoDestino.toLowerCase()}:${codigo}`)
    .digest("hex");
}

/**
 * Compara en tiempo constante el código recibido con el hash almacenado.
 */
export function verifyVerificationCodeHash(
  usuarioId: string,
  correoDestino: string,
  codigo: string,
  storedHash: string
): boolean {
  try {
    const expectedHex = hashVerificationCode(usuarioId, correoDestino, codigo);
    const expectedBuf = Buffer.from(expectedHex, "hex");
    const storedBuf = Buffer.from(storedHash, "hex");
    if (expectedBuf.length !== storedBuf.length || expectedBuf.length === 0) {
      return false;
    }
    return timingSafeEqual(expectedBuf, storedBuf);
  } catch {
    return false;
  }
}

/**
 * Genera un token aleatorio de alta entropía (256 bits) para recuperación de contraseña.
 */
export function generatePasswordResetToken(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashPasswordResetToken(token);
  return { token, tokenHash };
}

/**
 * Calcula el hash SHA-256 de un token de recuperación de contraseña.
 */
export function hashPasswordResetToken(token: string): string {
  return createHash("sha256")
    .update(`pwd-reset:v1:${token}`)
    .digest("hex");
}

// --- Sesiones ---

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(usuarioId: string): Promise<Date> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);

  const fechaExpira = new Date(
    Date.now() + SESSION_DURATION_SECONDS * 1000
  );

  await prisma.sesionUsuario.create({
    data: {
      usuarioId,
      tokenHash,
      fechaExpira,
    },
  });

  const cookieStore = await cookies();

  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: fechaExpira,
  });

  return fechaExpira;
}

export const USUARIO_INCLUDE = {
  perfilCliente: true,
  perfilReparador: {
    include: {
      especialidades: {
        include: {
          categoria: true,
        },
      },
      documentos: {
        orderBy: { creadoEn: "desc" as const },
        take: 1,
      },
    },
  },
} as const;

export async function getCurrentUser() {
  const cookieStore = await cookies();

  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);

  const session = await prisma.sesionUsuario.findUnique({
    where: {
      tokenHash,
    },
    include: {
      usuario: {
        include: USUARIO_INCLUDE,
      },
    },
  });

  if (!session) {
    return null;
  }

  // Tu modelo sesionUsuario tiene el campo "revocado": una sesión revocada
  // no debe seguir siendo válida aunque no haya expirado.
  if (session.revocado) {
    return null;
  }

  if (session.fechaExpira.getTime() <= Date.now()) {
    await prisma.sesionUsuario.deleteMany({
      where: {
        id: session.id,
      },
    });

    return null;
  }

  const { passwordHash, ...usuarioSeguro } = session.usuario;

  return usuarioSeguro;
}

export async function deleteCurrentSession(): Promise<void> {
  const cookieStore = await cookies();

  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    const tokenHash = hashSessionToken(token);

    await prisma.sesionUsuario.deleteMany({
      where: {
        tokenHash,
      },
    });
  }

  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}
