/**
 * Script seguro de provisión de cuenta ADMINISTRADOR para pruebas de HU22 / HU23.
 *
 * Reglas de seguridad:
 * - NO contiene contraseñas ni credenciales fijas en el código.
 * - Exige variables de entorno explícitas: ADMIN_USERNAME y ADMIN_PASSWORD.
 * - Opcionales: ADMIN_EMAIL, ADMIN_PROMOTE_EXISTING ("true").
 * - Valida la política de contraseñas y formato de usuario reutilizando lib/registrationValidation.ts.
 * - Utiliza la implementación pura de scrypt (hashPassword de lib/passwordCrypto.ts).
 * - NUNCA promueve usuarios existentes salvo que se indique explícitamente
 *   ADMIN_PROMOTE_EXISTING=true junto con ADMIN_USERNAME.
 * - Comprueba previamente colisiones de nombreUsuario y email antes de cualquier escritura.
 * - Maneja de forma controlada errores de unicidad de Prisma (P2002) sin filtrar datos sensibles.
 * - No imprime contraseñas ni hashes por consola.
 * - Alineado exactamente con el modelo Usuario y enum RolUsuario de Prisma.
 * - No crea PerfilCliente para cuentas con rol ADMINISTRADOR.
 * - Protege el punto de entrada para no ejecutar main() al ser importado.
 *
 * Uso recomendado (PowerShell):
 *   # Asegurar que no haya variables de entorno previas en el proceso
 *   Remove-Item env:DATABASE_URL -ErrorAction SilentlyContinue
 *   $env:ADMIN_USERNAME="admin_qa_audit"
 *   $env:ADMIN_PASSWORD="<contraseña_segura>"
 *   node --env-file=.env scripts/seed-admin.mjs
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = path.join(rootDir, specifier.slice(2) + ".ts");
      return nextResolve(pathToFileURL(target).href, context);
    }
    if (specifier === "../generated/prisma/client") {
      const target = path.join(rootDir, "generated", "prisma", "client.ts");
      return nextResolve(pathToFileURL(target).href, context);
    }
    if (specifier === "./registrationValidation") {
      return nextResolve("./registrationValidation.ts", context);
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !path.extname(specifier) &&
      context.parentURL?.includes("/generated/prisma/")
    ) {
      return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
});

export async function main() {
  const rawUsername = process.env.ADMIN_USERNAME;
  const rawPassword = process.env.ADMIN_PASSWORD;
  const rawEmail = process.env.ADMIN_EMAIL;
  const promoteExisting = process.env.ADMIN_PROMOTE_EXISTING === "true";

  if (!rawUsername || !rawPassword) {
    console.error(
      "[seed-admin] Error: Faltan variables de entorno obligatorias (ADMIN_USERNAME y ADMIN_PASSWORD)."
    );
    console.error(
      "[seed-admin] Por seguridad, este script no incluye credenciales por defecto."
    );
    process.exit(1);
  }

  // Importaciones puras y desacopladas de Next.js
  const { validateAdminInput, provisionAdminAccount } = await import(
    "../lib/adminProvisioning.ts"
  );
  const { hashPassword } = await import("../lib/passwordCrypto.ts");

  const validation = validateAdminInput({
    rawUsername,
    rawPassword,
    rawEmail,
  });

  if (!validation.ok) {
    console.error(`[seed-admin] Validación fallida: ${validation.error}`);
    process.exit(1);
  }

  const { username, password, email } = validation.data;
  const { prisma } = await import("../lib/prisma.ts");

  try {
    const result = await provisionAdminAccount(prisma, {
      username,
      password,
      email,
      promoteExisting,
      hashFn: hashPassword,
    });

    if (!result.ok) {
      console.error(`[seed-admin] ${result.error}`);
      process.exit(1);
    }

    if (result.action === "promoted") {
      console.log(
        `[seed-admin] Cuenta existente promovida a ADMINISTRADOR: @${result.user.nombreUsuario} (id: ${result.user.id}, estado: ${result.user.estado}).`
      );
    } else {
      console.log(
        `[seed-admin] Usuario ADMINISTRADOR creado exitosamente: @${result.user.nombreUsuario} (id: ${result.user.id}, rol: ${result.user.rol}, estado: ${result.user.estado}).`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Punto de entrada seguro: no ejecuta main() al ser importado desde suites de prueba
export const isDirectExecution =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isDirectExecution) {
  main().catch((err) => {
    console.error("[seed-admin] Fallo inesperado:", err?.message || err);
    process.exit(1);
  });
}
