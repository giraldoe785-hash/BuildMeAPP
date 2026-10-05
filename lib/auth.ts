import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";

const scrypt = promisify(scryptCallback);

const SESSION_COOKIE_NAME = "buildmeapp_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_KEY_LENGTH = 64;

// Prefijo de versión del algoritmo. Si en el futuro cambias los parámetros
// de scrypt, puedes agregar "scrypt2" sin romper los hashes ya guardados.
const HASH_ALGO_TAG = "scrypt1";

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

// --- Hash y verificación de contraseñas ---

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");

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

export async function verifyPassword(
  password: string,
  storedPasswordHash: string
): Promise<boolean> {
  const partes = storedPasswordHash.split(":");

  // Soporta tanto el formato nuevo ("scrypt1:salt:hash") como el formato
  // viejo sin tag de versión ("salt:hash"), para no romper cuentas ya
  // existentes si migras este archivo sobre una BD en uso.
  let salt: string | undefined;
  let storedKeyHex: string | undefined;

  if (partes.length === 3 && partes[0] === HASH_ALGO_TAG) {
    [, salt, storedKeyHex] = partes;
  } else if (partes.length === 2) {
    [salt, storedKeyHex] = partes;
  } else {
    return false;
  }

  if (!salt || !storedKeyHex) {
    return false;
  }

  try {
    const storedKey = Buffer.from(storedKeyHex, "hex");

    const derivedKey = (await scrypt(
      password,
      salt,
      PASSWORD_KEY_LENGTH
    )) as Buffer;

    if (storedKey.length !== derivedKey.length) {
      return false;
    }

    return timingSafeEqual(storedKey, derivedKey);
  } catch (error) {
    // Falla "cerrado": cualquier error en la verificación se trata como
    // contraseña inválida, nunca como autenticación exitosa.
    console.error("Error verificando contraseña:", error);
    return false;
  }
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
        include: {
          perfilCliente: true,
          perfilReparador: true,
        },
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