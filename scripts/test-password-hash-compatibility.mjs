/**
 * Suite de pruebas de interoperabilidad y compatibilidad criptográfica de contraseñas
 * y lógica de aprovisionamiento administrativo para BuildMeAPP.
 *
 * Valida:
 * 1. Formato canónico versionado (scrypt1) y parámetros de derivación de claves.
 * 2. Aceptación de contraseña correcta y rechazo de contraseña incorrecta.
 * 3. Generación de sales aleatorias independientes por cada hash.
 * 4. Compatibilidad con el vector histórico determinista fijo (fixtures canónico y heredado).
 * 5. Validación estricta de formato previa: rechazo de caracteres no-hex, sufijos inválidos,
 *    longitudes incorrectas y prefijos no reconocidos sin lanzar excepciones.
 * 6. Importación segura de scripts/seed-admin.mjs sin ejecución de main() ni escrituras.
 * 7. Tipos y estructura de payloads de aprovisionamiento contra el esquema Prisma.
 * 8. Validación de entradas (username, password, email) según reglas y normalizadores oficiales.
 * 9. Detección previa de duplicados (username y email) y bloqueo de escrituras con dobles de prueba.
 * 10. Manejo controlado de colisiones concurrentes (código Prisma P2002).
 * 11. Creación y promoción administrativa con verificación de hash scrypt1.
 *
 * Ejecutar con:
 *   node --test scripts/test-password-hash-compatibility.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./registrationValidation") {
      return nextResolve("./registrationValidation.ts", context);
    }
    return nextResolve(specifier, context);
  },
});

// Importar la única fuente de verdad criptográfica pura
const {
  HASH_ALGO_TAG,
  PASSWORD_KEY_LENGTH,
  SALT_BYTES,
  HEX_32_REGEX,
  HEX_128_REGEX,
  hashPassword,
  verifyPassword,
} = await import("../lib/passwordCrypto.ts");

// Importar los constructores tipados y lógica de aprovisionamiento
const {
  buildAdminCreationPayload,
  buildAdminUpdatePayload,
  validateAdminInput,
  provisionAdminAccount,
} = await import("../lib/adminProvisioning.ts");

// Importar normalizadores y constantes del sistema de validación
const {
  normalizeUsername,
  normalizeEmail,
  isValidPasswordPolicy,
  PASSWORD_POLICY_MESSAGE,
} = await import("../lib/registrationValidation.ts");

// ---------------------------------------------------------------------------
// FIXTURE HISTÓRICO DETERMINISTA FIJO (Condición Obligatoria 1)
// Generado previamente con la implementación original de scrypt de lib/auth.ts
// utilizando sal fija conocida y contraseña sintética de prueba.
// NUNCA se recalcula durante las pruebas.
// ---------------------------------------------------------------------------
const FIXED_HISTORICAL_PASSWORD = "AdminPruebaSintetica2026";
const FIXED_SALT_HEX = "0123456789abcdef0123456789abcdef";
const FIXED_KEY_HEX =
  "266385f741ae117d45f7141e7b4a959b2538e8fc09de342815eb3314bebf269db92ab12f00f7db9fc37c6b30b4ae32856f252d06bb39da5b730a20e1ab5a2da1";

// Fixture canónico versionado (3 partes): scrypt1:<salt32>:<key128>
const FIXED_CANONICAL_HASH = `scrypt1:${FIXED_SALT_HEX}:${FIXED_KEY_HEX}`;

// Fixture heredado compatible (2 partes): <salt32>:<key128>
const FIXED_LEGACY_HASH = `${FIXED_SALT_HEX}:${FIXED_KEY_HEX}`;

// ===========================================================================
// 1. Pruebas de contrato criptográfico y generación canónica
// ===========================================================================

test("Cripto 1: hashPassword genera el formato canónico versionado scrypt1 con longitudes exactas", async () => {
  const dummyPassword = "ClaveDePruebaSegura12";
  const hash = await hashPassword(dummyPassword);

  assert.equal(typeof hash, "string");
  const partes = hash.split(":");
  assert.equal(partes.length, 3, "El hash canónico debe tener exactamente 3 partes");
  assert.equal(partes[0], HASH_ALGO_TAG, "El prefijo debe ser scrypt1");

  const salt = partes[1];
  const derivedKey = partes[2];

  assert.equal(salt.length, 32, "La sal debe tener exactamente 32 caracteres hexadecimales");
  assert.equal(HEX_32_REGEX.test(salt), true, "La sal debe contener únicamente caracteres hexadecimales");

  assert.equal(derivedKey.length, 128, "La clave derivada debe tener exactamente 128 caracteres hexadecimales");
  assert.equal(HEX_128_REGEX.test(derivedKey), true, "La clave debe contener únicamente caracteres hexadecimales");

  assert.equal(hash.length, 169, "Longitud total exacta: 7 + 1 + 32 + 1 + 128 = 169");
});

test("Cripto 2: verifyPassword acepta la contraseña correcta contra el hash generado", async () => {
  const password = "ContraseñaCorrecta123";
  const hash = await hashPassword(password);

  const isValid = await verifyPassword(password, hash);
  assert.equal(isValid, true, "verifyPassword debe retornar true con la contraseña correcta");
});

test("Cripto 3: verifyPassword rechaza contraseñas incorrectas contra el mismo hash", async () => {
  const password = "ContraseñaOriginal123";
  const hash = await hashPassword(password);

  const isInvalid = await verifyPassword("ContrasenaTotalmenteDiferente99", hash);
  assert.equal(isInvalid, false, "verifyPassword debe retornar false ante contraseña incorrecta");

  const isSimilarInvalid = await verifyPassword(password + "extra", hash);
  assert.equal(isSimilarInvalid, false, "verifyPassword debe rechazar contraseñas con caracteres adicionales");
});

test("Cripto 4: dos llamadas a hashPassword con la misma contraseña producen sales e imágenes distintas", async () => {
  const password = "MismaContraseñaParaAmbos123";
  const hash1 = await hashPassword(password);
  const hash2 = await hashPassword(password);

  assert.notEqual(hash1, hash2, "Dos hashes de la misma contraseña no deben coincidir jamás");

  const salt1 = hash1.split(":")[1];
  const salt2 = hash2.split(":")[1];
  assert.notEqual(salt1, salt2, "Las sales deben ser criptográficamente aleatorias y distintas");

  assert.equal(await verifyPassword(password, hash1), true);
  assert.equal(await verifyPassword(password, hash2), true);
});

// ===========================================================================
// 2. Compatibilidad con Fixture Histórico Fijo (Condición Obligatoria 1)
// ===========================================================================

test("Histórico 1: verifyPassword valida el fixture histórico canónico fijo (scrypt1) y rechaza clave errónea", async () => {
  assert.equal(FIXED_CANONICAL_HASH.length, 169);

  // Acepta la contraseña histórica exacta
  const valid = await verifyPassword(FIXED_HISTORICAL_PASSWORD, FIXED_CANONICAL_HASH);
  assert.equal(valid, true, "verifyPassword debe aceptar el fixture histórico canónico scrypt1");

  // Rechaza cualquier contraseña diferente
  const invalid = await verifyPassword("ContraseñaEquivocada123", FIXED_CANONICAL_HASH);
  assert.equal(invalid, false, "verifyPassword debe rechazar contraseñas incorrectas sobre el fixture histórico");
});

test("Histórico 2: verifyPassword valida el fixture histórico heredado fijo de 2 partes (salt:key) y rechaza clave errónea", async () => {
  assert.equal(FIXED_LEGACY_HASH.length, 161);

  // Acepta la contraseña histórica en formato heredado
  const valid = await verifyPassword(FIXED_HISTORICAL_PASSWORD, FIXED_LEGACY_HASH);
  assert.equal(valid, true, "verifyPassword debe aceptar el fixture histórico heredado de 2 partes");

  // Rechaza contraseña errónea
  const invalid = await verifyPassword("ContraseñaErroneaHeredada99", FIXED_LEGACY_HASH);
  assert.equal(invalid, false, "verifyPassword debe rechazar contraseñas incorrectas sobre el fixture heredado");
});

// ===========================================================================
// 3. Validación estricta previa del formato almacenado (Sección A)
// ===========================================================================

test("Validación estricta 1: rechazo de sufijos no hexadecimales añadidos al final de la clave derivada", async () => {
  const hashWithSuffixG = `${FIXED_CANONICAL_HASH}g`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, hashWithSuffixG), false);

  const hashWithSuffixXYZ = `${FIXED_CANONICAL_HASH}xyz`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, hashWithSuffixXYZ), false);

  const legacyWithSuffix = `${FIXED_LEGACY_HASH}g`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, legacyWithSuffix), false);
});

test("Validación estricta 2: rechazo de caracteres no hexadecimales al inicio o medio de la sal y clave", async () => {
  // Carácter no-hex al inicio de la sal
  const badSaltStart = `scrypt1:z${FIXED_SALT_HEX.slice(1)}:${FIXED_KEY_HEX}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, badSaltStart), false);

  // Carácter no-hex en medio de la sal
  const badSaltMid = `scrypt1:${FIXED_SALT_HEX.slice(0, 15)}z${FIXED_SALT_HEX.slice(16)}:${FIXED_KEY_HEX}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, badSaltMid), false);

  // Carácter no-hex al inicio de la clave derivada
  const badKeyStart = `scrypt1:${FIXED_SALT_HEX}:z${FIXED_KEY_HEX.slice(1)}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, badKeyStart), false);

  // Carácter no-hex en medio de la clave derivada
  const badKeyMid = `scrypt1:${FIXED_SALT_HEX}:${FIXED_KEY_HEX.slice(0, 60)}q${FIXED_KEY_HEX.slice(61)}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, badKeyMid), false);
});

test("Validación estricta 3: rechazo de longitudes alteradas en sal o clave", async () => {
  // Sal demasiado corta (31 caracteres)
  const shortSalt = `scrypt1:${FIXED_SALT_HEX.slice(0, 31)}:${FIXED_KEY_HEX}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, shortSalt), false);

  // Sal demasiado larga (33 caracteres)
  const longSalt = `scrypt1:${FIXED_SALT_HEX}a:${FIXED_KEY_HEX}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, longSalt), false);

  // Clave demasiado corta (127 caracteres)
  const shortKey = `scrypt1:${FIXED_SALT_HEX}:${FIXED_KEY_HEX.slice(0, 127)}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, shortKey), false);

  // Clave demasiado larga (129 caracteres)
  const longKey = `scrypt1:${FIXED_SALT_HEX}:${FIXED_KEY_HEX}a`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, longKey), false);
});

test("Validación estricta 4: rechazo de prefijos desconocidos, separadores adicionales y valores espurios", async () => {
  // Prefijo no soportado
  const unknownAlgo = `bcrypt:${FIXED_SALT_HEX}:${FIXED_KEY_HEX}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, unknownAlgo), false);

  const argonAlgo = `argon2id:${FIXED_SALT_HEX}:${FIXED_KEY_HEX}`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, argonAlgo), false);

  // Separadores adicionales (4 o más partes)
  const fourParts = `scrypt1:${FIXED_SALT_HEX}:${FIXED_KEY_HEX}:extra`;
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, fourParts), false);

  // Entradas vacías o con tipos inválidos
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, ""), false);
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, null), false);
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, undefined), false);
  assert.equal(await verifyPassword(FIXED_HISTORICAL_PASSWORD, "texto_arbitrario_sin_formato"), false);
});

// ===========================================================================
// 4. Importación segura del script administrativo
// ===========================================================================

test("Punto de entrada 1: scripts/seed-admin.mjs puede importarse sin ejecutar main ni conectar a Prisma", async () => {
  const seedModule = await import("./seed-admin.mjs");

  assert.equal(typeof seedModule.main, "function", "main debe ser una función exportada");
  assert.equal(
    seedModule.isDirectExecution,
    false,
    "isDirectExecution debe ser false al ser importado por un módulo de prueba"
  );
});

// ===========================================================================
// 5. Verificación estática de tipos de Prisma
// ===========================================================================

test("Tipos Prisma 1: buildAdminCreationPayload produce un objeto conforme a Prisma.UsuarioCreateInput sin PerfilCliente", () => {
  const creationData = buildAdminCreationPayload({
    username: "admin_soporte_prueba",
    email: "admin_prueba@buildmeapp.com",
    passwordHash: FIXED_CANONICAL_HASH,
  });

  // Verificación de campos exactos
  assert.equal(creationData.nombreUsuario, "admin_soporte_prueba");
  assert.equal(creationData.email, "admin_prueba@buildmeapp.com");
  assert.equal(creationData.passwordHash, FIXED_CANONICAL_HASH);
  assert.equal(creationData.rol, "ADMINISTRADOR");
  assert.equal(creationData.estado, "VERIFICADO");

  // Regla crítica: Cero creación de PerfilCliente para cuentas ADMINISTRADOR
  assert.equal(
    creationData.perfilCliente,
    undefined,
    "No debe incluir perfilCliente para un ADMINISTRADOR"
  );
  assert.equal(
    creationData.perfilReparador,
    undefined,
    "No debe incluir perfilReparador para un ADMINISTRADOR"
  );
});

test("Tipos Prisma 2: buildAdminUpdatePayload produce un objeto conforme a Prisma.UsuarioUpdateInput", () => {
  const updateData = buildAdminUpdatePayload(FIXED_CANONICAL_HASH, "admin_actualizado@buildmeapp.com");

  assert.equal(updateData.passwordHash, FIXED_CANONICAL_HASH);
  assert.equal(updateData.email, "admin_actualizado@buildmeapp.com");
  assert.equal(updateData.rol, "ADMINISTRADOR");
  assert.equal(updateData.estado, "VERIFICADO");
  assert.equal(updateData.perfilCliente, undefined);
});

// ===========================================================================
// 6. Validación de entradas administrativas (Requisitos 1 al 5 y 13)
// ===========================================================================

test("Validación entrada 1: nombre de usuario válido e inválido", () => {
  // Válido
  const resValid = validateAdminInput({
    rawUsername: "Admin_Qa_2026",
    rawPassword: "PasswordSegura12",
  });
  assert.equal(resValid.ok, true);
  if (resValid.ok) {
    assert.equal(resValid.data.username, "admin_qa_2026");
  }

  // Inválido por longitud (< 3)
  const resShort = validateAdminInput({
    rawUsername: "ab",
    rawPassword: "PasswordSegura12",
  });
  assert.equal(resShort.ok, false);
  if (!resShort.ok) {
    assert.match(resShort.error, /3 y 50 caracteres/);
  }

  // Inválido por caracteres especiales
  const resBadChars = validateAdminInput({
    rawUsername: "admin!soporte$",
    rawPassword: "PasswordSegura12",
  });
  assert.equal(resBadChars.ok, false);

  // Inválido por ausencia o vacío
  assert.equal(validateAdminInput({ rawUsername: "", rawPassword: "Password12" }).ok, false);
  assert.equal(validateAdminInput({ rawUsername: null, rawPassword: "Password12" }).ok, false);
  assert.equal(validateAdminInput({ rawUsername: undefined, rawPassword: "Password12" }).ok, false);
});

test("Validación entrada 2: contraseña aceptada y rechazada según política oficial", () => {
  // Aceptada (mínimo 7 caracteres y al menos 2 números)
  const resOk = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "AdminPassword99",
  });
  assert.equal(resOk.ok, true);

  // Rechazada: menos de 7 caracteres
  const resShort = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "Pass12",
  });
  assert.equal(resShort.ok, false);
  if (!resShort.ok) {
    assert.equal(resShort.error, PASSWORD_POLICY_MESSAGE);
  }

  // Rechazada: sin números
  const resNoNums = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "PasswordLargaSinNumeros",
  });
  assert.equal(resNoNums.ok, false);
  if (!resNoNums.ok) {
    assert.equal(resNoNums.error, PASSWORD_POLICY_MESSAGE);
  }

  // Rechazada: solo 1 número
  const resOneNum = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "PasswordConUn1Numero",
  });
  assert.equal(resOneNum.ok, false);
});

test("Validación entrada 3: correo válido e inválido cuando se suministra", () => {
  // Válido
  const resValid = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "Password99",
    rawEmail: "Admin.Audit@BuildMeApp.com",
  });
  assert.equal(resValid.ok, true);
  if (resValid.ok) {
    assert.equal(resValid.data.email, "admin.audit@buildmeapp.com");
  }

  // Inválido
  const resBadFormat = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "Password99",
    rawEmail: "correo_invalido_sin_arroba",
  });
  assert.equal(resBadFormat.ok, false);
  if (!resBadFormat.ok) {
    assert.match(resBadFormat.error, /correo electrónico válida/);
  }
});

test("Validación entrada 4: correo omitido (null, undefined o espacios) es aceptado como null", () => {
  const resUndefined = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "Password99",
    rawEmail: undefined,
  });
  assert.equal(resUndefined.ok, true);
  if (resUndefined.ok) {
    assert.equal(resUndefined.data.email, null);
  }

  const resNull = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "Password99",
    rawEmail: null,
  });
  assert.equal(resNull.ok, true);
  if (resNull.ok) {
    assert.equal(resNull.data.email, null);
  }

  const resWhitespace = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "Password99",
    rawEmail: "   ",
  });
  assert.equal(resWhitespace.ok, true);
  if (resWhitespace.ok) {
    assert.equal(resWhitespace.data.email, null);
  }
});

test("Validación entrada 5: uso correcto de normalizadores y protección contra fuga de credenciales", () => {
  const rawUser = "   Admin_MixeD_Case   ";
  const rawPass = "MiClaveSuperSecreta12";
  const rawMail = "   AdminMail@Dominio.COM   ";

  const res = validateAdminInput({
    rawUsername: rawUser,
    rawPassword: rawPass,
    rawEmail: rawMail,
  });

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.username, "admin_mixed_case");
    assert.equal(res.data.email, "adminmail@dominio.com");
  }

  // Ante fallo de contraseña, el mensaje no debe contener la contraseña suministrada
  const resFail = validateAdminInput({
    rawUsername: "admin_test",
    rawPassword: "clave_corta_1",
  });
  assert.equal(resFail.ok, false);
  if (!resFail.ok) {
    assert.equal(resFail.error.includes("clave_corta_1"), false);
  }
});

// ===========================================================================
// 7. Detección de duplicados, concurrencia y flujo de aprovisionamiento (Requisitos 6 al 10)
// ===========================================================================

test("Duplicados 1: nombre de usuario duplicado con promoción desactivada aborta sin escrituras", async () => {
  let createCalled = false;
  let updateCalled = false;

  const mockDb = {
    usuario: {
      findUnique: async ({ where }) => {
        if (where.nombreUsuario === "admin_existente") {
          return {
            id: "id-user-existente",
            nombreUsuario: "admin_existente",
            email: "otro@test.com",
            rol: "CLIENTE",
            estado: "VERIFICADO",
          };
        }
        return null;
      },
      create: async () => {
        createCalled = true;
      },
      update: async () => {
        updateCalled = true;
      },
    },
  };

  const result = await provisionAdminAccount(mockDb, {
    username: "admin_existente",
    password: "PasswordSegura12",
    email: null,
    promoteExisting: false,
    hashFn: async () => "fake_hash",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "USERNAME_EXISTS");
  assert.match(result.error, /ya existe/);
  assert.equal(createCalled, false, "create no debe ser invocado");
  assert.equal(updateCalled, false, "update no debe ser invocado");
});

test("Duplicados 2: correo duplicado con nombre de usuario nuevo aborta sin escrituras", async () => {
  let createCalled = false;
  let updateCalled = false;

  const mockDb = {
    usuario: {
      findUnique: async ({ where }) => {
        if (where.email === "correo_en_uso@test.com") {
          return {
            id: "id-cuenta-previa",
            nombreUsuario: "titular_correo",
            email: "correo_en_uso@test.com",
            rol: "REPARADOR",
            estado: "VERIFICADO",
          };
        }
        return null;
      },
      create: async () => {
        createCalled = true;
      },
      update: async () => {
        updateCalled = true;
      },
    },
  };

  const result = await provisionAdminAccount(mockDb, {
    username: "nuevo_admin_soporte",
    password: "PasswordSegura12",
    email: "correo_en_uso@test.com",
    promoteExisting: false,
    hashFn: async () => "fake_hash",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "EMAIL_EXISTS");
  assert.match(result.error, /ya pertenece a una cuenta existente/);
  assert.equal(createCalled, false, "create no debe ser invocado");
  assert.equal(updateCalled, false, "update no debe ser invocado");
});

test("Duplicados 3: usuario y correo asociados a cuentas diferentes durante promoción aborta sin cambios", async () => {
  let createCalled = false;
  let updateCalled = false;

  const mockDb = {
    usuario: {
      findUnique: async ({ where }) => {
        if (where.nombreUsuario === "cuenta_a_promover") {
          return {
            id: "id-cuenta-1",
            nombreUsuario: "cuenta_a_promover",
            email: "correo_original@test.com",
            rol: "CLIENTE",
            estado: "VERIFICADO",
          };
        }
        if (where.email === "correo_otra_cuenta@test.com") {
          return {
            id: "id-cuenta-2",
            nombreUsuario: "otro_usuario",
            email: "correo_otra_cuenta@test.com",
            rol: "REPARADOR",
            estado: "VERIFICADO",
          };
        }
        return null;
      },
      create: async () => {
        createCalled = true;
      },
      update: async () => {
        updateCalled = true;
      },
    },
  };

  const result = await provisionAdminAccount(mockDb, {
    username: "cuenta_a_promover",
    password: "PasswordSegura12",
    email: "correo_otra_cuenta@test.com",
    promoteExisting: true,
    hashFn: async () => "fake_hash",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "EMAIL_CONFLICT");
  assert.match(result.error, /Conflicto de identidad/);
  assert.equal(createCalled, false, "create no debe ser invocado");
  assert.equal(updateCalled, false, "update no debe ser invocado");
});

test("Duplicados 4: error simulado P2002 de Prisma se maneja de forma controlada como fallo", async () => {
  const p2002Error = new Error("Unique constraint failed on the fields: (nombreUsuario)");
  p2002Error.code = "P2002";

  const mockDb = {
    usuario: {
      findUnique: async () => null,
      create: async () => {
        throw p2002Error;
      },
    },
  };

  const result = await provisionAdminAccount(mockDb, {
    username: "admin_concurrente",
    password: "PasswordSegura12",
    email: null,
    promoteExisting: false,
    hashFn: async () => "fake_hash",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "P2002");
  assert.match(result.error, /Error de unicidad \(P2002\)/);
  // Verificar que el mensaje no expone datos sensibles
  assert.equal(result.error.includes("PasswordSegura12"), false);
});

test("Duplicados 5: creación válida produce payload administrativo conforme y hash verificable", async () => {
  let createdPayload = null;

  const mockDb = {
    usuario: {
      findUnique: async () => null,
      create: async ({ data }) => {
        createdPayload = data;
        return {
          id: "cm_generated_test_id",
          nombreUsuario: data.nombreUsuario,
          rol: data.rol,
          estado: data.estado,
        };
      },
    },
  };

  const plainPassword = "AdminPassword2026";
  const result = await provisionAdminAccount(mockDb, {
    username: "admin_valido_qa",
    password: plainPassword,
    email: "admin_valido@buildmeapp.com",
    promoteExisting: false,
    hashFn: hashPassword,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.action, "created");
    assert.equal(result.user.nombreUsuario, "admin_valido_qa");
    assert.equal(result.user.rol, "ADMINISTRADOR");
    assert.equal(result.user.estado, "VERIFICADO");
  }

  assert.notEqual(createdPayload, null);
  assert.equal(createdPayload.nombreUsuario, "admin_valido_qa");
  assert.equal(createdPayload.email, "admin_valido@buildmeapp.com");
  assert.equal(createdPayload.rol, "ADMINISTRADOR");
  assert.equal(createdPayload.estado, "VERIFICADO");
  assert.equal(createdPayload.perfilCliente, undefined, "PerfilCliente no debe ser creado");

  // El hash debe iniciar con scrypt1 y verificarse con verifyPassword
  assert.match(createdPayload.passwordHash, /^scrypt1:[0-9a-f]{32}:[0-9a-f]{128}$/i);
  const verifyOk = await verifyPassword(plainPassword, createdPayload.passwordHash);
  assert.equal(verifyOk, true, "El hash generado en el payload debe verificarse con la contraseña original");
});
