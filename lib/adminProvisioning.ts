/**
 * Módulo puro tipado para la preparación de cargas útiles (payloads) y lógica de
 * aprovisionamiento administrativo en BuildMeAPP, alineado estrictamente con el
 * modelo Usuario de Prisma y las políticas del sistema.
 *
 * Reglas de negocio y esquema:
 * - Un ADMINISTRADOR no requiere ni debe tener PerfilCliente (es una relación opcional 1:1 en Prisma).
 * - El rol es estrictamente "ADMINISTRADOR".
 * - El estado inicial es "VERIFICADO".
 * - Reutiliza las reglas oficiales de registro de lib/registrationValidation.ts sin duplicarlas.
 */

import type { Prisma } from "../generated/prisma";
import {
  EMAIL_MAX_LENGTH,
  EMAIL_REGEX,
  PASSWORD_MAX_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  USERNAME_REGEX,
  isValidPasswordPolicy,
  normalizeEmail,
  normalizeUsername,
} from "./registrationValidation";

export interface AdminCreationParams {
  username: string;
  email: string | null;
  passwordHash: string;
}

/**
 * Construye la carga útil para la creación de un nuevo usuario con rol ADMINISTRADOR.
 * Tipado estrictamente contra Prisma.UsuarioCreateInput.
 */
export function buildAdminCreationPayload(
  params: AdminCreationParams
): Prisma.UsuarioCreateInput {
  return {
    nombreUsuario: params.username,
    email: params.email,
    passwordHash: params.passwordHash,
    rol: "ADMINISTRADOR",
    estado: "VERIFICADO",
  };
}

/**
 * Construye la carga útil para la promoción de un usuario existente a rol ADMINISTRADOR.
 * Tipado estrictamente contra Prisma.UsuarioUpdateInput.
 */
export function buildAdminUpdatePayload(
  passwordHash: string,
  email: string | null
): Prisma.UsuarioUpdateInput {
  return {
    rol: "ADMINISTRADOR",
    estado: "VERIFICADO",
    passwordHash,
    ...(email ? { email } : {}),
  };
}

// ---------------------------------------------------------------------------
// Validación pura de entrada administrativa
// ---------------------------------------------------------------------------

export interface RawAdminInput {
  rawUsername?: unknown;
  rawPassword?: unknown;
  rawEmail?: unknown;
}

export interface ValidatedAdminInput {
  username: string;
  password: string;
  email: string | null;
}

export type AdminValidationResult =
  | { ok: true; data: ValidatedAdminInput }
  | { ok: false; error: string };

/**
 * Valida los parámetros de entrada para aprovisionamiento administrativo.
 * Aplica la normalización y las reglas oficiales del sistema sin debilitar la política de seguridad.
 */
export function validateAdminInput(input: RawAdminInput): AdminValidationResult {
  const { rawUsername, rawPassword, rawEmail } = input;

  if (typeof rawUsername !== "string" || !rawUsername.trim()) {
    return { ok: false, error: "ADMIN_USERNAME es obligatorio." };
  }
  if (typeof rawPassword !== "string" || !rawPassword) {
    return { ok: false, error: "ADMIN_PASSWORD es obligatorio." };
  }

  const username = normalizeUsername(rawUsername);
  if (!USERNAME_REGEX.test(username)) {
    return {
      ok: false,
      error:
        "El nombre de usuario debe tener entre 3 y 50 caracteres y solo puede contener letras, números, punto o guion bajo.",
    };
  }

  if (
    rawPassword.length > PASSWORD_MAX_LENGTH ||
    !isValidPasswordPolicy(rawPassword)
  ) {
    return {
      ok: false,
      error: PASSWORD_POLICY_MESSAGE,
    };
  }

  let email: string | null = null;
  if (typeof rawEmail === "string" && rawEmail.trim().length > 0) {
    email = normalizeEmail(rawEmail);
    if (email.length > EMAIL_MAX_LENGTH || !EMAIL_REGEX.test(email)) {
      return {
        ok: false,
        error: "Ingresa una dirección de correo electrónico válida.",
      };
    }
  }

  return { ok: true, data: { username, password: rawPassword, email } };
}

// ---------------------------------------------------------------------------
// Lógica de aprovisionamiento con detección de duplicados y errores P2002
// ---------------------------------------------------------------------------

// Tipo desacoplado para inyección de dependencias y dobles de prueba sin conexión real
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminDb = any;

export interface ProvisionAdminOptions {
  username: string;
  password: string;
  email: string | null;
  promoteExisting?: boolean;
  hashFn: (password: string) => Promise<string>;
}

export interface ProvisionAdminSuccess {
  ok: true;
  action: "created" | "promoted";
  user: {
    id: string;
    nombreUsuario: string;
    rol: string;
    estado: string;
  };
}

export interface ProvisionAdminFailure {
  ok: false;
  code:
    | "USER_NOT_FOUND"
    | "EMAIL_CONFLICT"
    | "USERNAME_EXISTS"
    | "EMAIL_EXISTS"
    | "P2002"
    | "UNEXPECTED_ERROR";
  error: string;
}

export type ProvisionAdminResult = ProvisionAdminSuccess | ProvisionAdminFailure;

/**
 * Ejecuta el aprovisionamiento de una cuenta administrativa contra el cliente de BD.
 * Realiza comprobaciones previas completas de unicidad (nombreUsuario y email) y
 * maneja de forma controlada errores P2002 de colisión concurrente.
 */
export async function provisionAdminAccount(
  db: AdminDb,
  options: ProvisionAdminOptions
): Promise<ProvisionAdminResult> {
  const { username, password, email, promoteExisting = false, hashFn } = options;

  // 1. Consultar usuario existente por username
  const existingByUsername = await db.usuario.findUnique({
    where: { nombreUsuario: username },
    select: { id: true, nombreUsuario: true, email: true, rol: true, estado: true },
  });

  // 2. Si se suministró email, consultar si ya pertenece a alguna cuenta
  const existingByEmail = email
    ? await db.usuario.findUnique({
        where: { email },
        select: { id: true, nombreUsuario: true, email: true, rol: true, estado: true },
      })
    : null;

  // 3. Caso: PROMOCIÓN EXPLÍCITA (promoteExisting = true)
  if (promoteExisting) {
    if (!existingByUsername) {
      return {
        ok: false,
        code: "USER_NOT_FOUND",
        error: `No se puede promover: El usuario @${username} no existe en la base de datos.`,
      };
    }

    if (existingByEmail && existingByEmail.id !== existingByUsername.id) {
      return {
        ok: false,
        code: "EMAIL_CONFLICT",
        error: `Conflicto de identidad: El correo indicado ya pertenece a otra cuenta (@${existingByEmail.nombreUsuario}). Operación abortada.`,
      };
    }

    const passwordHash = await hashFn(password);
    const updatePayload = buildAdminUpdatePayload(passwordHash, email);

    try {
      const updated = await db.usuario.update({
        where: { id: existingByUsername.id },
        data: updatePayload,
        select: { id: true, nombreUsuario: true, rol: true, estado: true },
      });

      return {
        ok: true,
        action: "promoted",
        user: updated,
      };
    } catch (err: any) {
      if (err?.code === "P2002") {
        return {
          ok: false,
          code: "P2002",
          error:
            "Error de unicidad (P2002): Conflicto de clave única al actualizar la cuenta en la base de datos.",
        };
      }
      throw err;
    }
  }

  // 4. Caso: CREACIÓN DE NUEVA CUENTA (promoteExisting = false o ausente)
  if (existingByUsername) {
    return {
      ok: false,
      code: "USERNAME_EXISTS",
      error: `El usuario @${existingByUsername.nombreUsuario} ya existe (rol actual: ${existingByUsername.rol}). Por seguridad no se modifican cuentas existentes automáticamente. Si deseas promover y actualizar esta cuenta explícitamente, define ADMIN_PROMOTE_EXISTING=true.`,
    };
  }

  if (existingByEmail) {
    return {
      ok: false,
      code: "EMAIL_EXISTS",
      error: `Conflicto de correo: El correo electrónico indicado ya pertenece a una cuenta existente (@${existingByEmail.nombreUsuario}). Operación abortada.`,
    };
  }

  const passwordHash = await hashFn(password);
  const creationPayload = buildAdminCreationPayload({
    username,
    email,
    passwordHash,
  });

  try {
    const created = await db.usuario.create({
      data: creationPayload,
      select: { id: true, nombreUsuario: true, rol: true, estado: true },
    });

    return {
      ok: true,
      action: "created",
      user: created,
    };
  } catch (err: any) {
    if (err?.code === "P2002") {
      return {
        ok: false,
        code: "P2002",
        error:
          "Error de unicidad (P2002): El nombre de usuario o correo colisionó con otra cuenta durante la inserción concurrente.",
      };
    }
    throw err;
  }
}
