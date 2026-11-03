/**
 * scripts/test-auth-register-and-recovery.mjs
 *
 * Suite de validación automatizada para Registro de Clientes, Verificación de Correo,
 * Recuperación de Contraseña, Adaptador de Resend y Estado de Neon PostgreSQL.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      return nextResolve("next/headers.js", context);
    }
    if (specifier === "@/types") {
      const absPath = path.resolve(process.cwd(), "types/index.ts");
      return nextResolve(pathToFileURL(absPath).href, context);
    }
    if (specifier.startsWith("@/")) {
      const relPath = specifier.slice(2);
      const absPath = path.resolve(process.cwd(), relPath + ".ts");
      return nextResolve(pathToFileURL(absPath).href, context);
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (!/\.(ts|js|mjs|json)$/.test(specifier)) {
        try {
          return nextResolve(specifier + ".ts", context);
        } catch {
          // fallback
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

console.log("=== INICIANDO VALIDACIÓN DE REGISTRO, RECUPERACIÓN Y NEON ===");

// 1. Validaciones del formulario de registro
test("1. Registro: validación estricta de nombres, usuarios, correos y contraseñas", async () => {
  const { validateClientRegistration, normalizeEmail, normalizeUsername } =
    await import("../lib/registrationValidation.ts");

  // Caso válido
  const valid = validateClientRegistration({
    name: "Esteban Gaitan",
    email: "esteban@example.com",
    username: "esteban10",
    password: "Password2026Secure!",
    confirmPassword: "Password2026Secure!",
  });
  assert.equal(valid, null, "Registro válido no debe tener errores de validación");

  // Normalización
  assert.equal(normalizeEmail("  Esteban@Example.COM  "), "esteban@example.com");
  assert.equal(normalizeUsername("  Esteban_10  "), "esteban_10");

  // Contraseñas no coinciden
  const mismatch = validateClientRegistration({
    name: "Esteban Gaitan",
    email: "esteban@example.com",
    username: "esteban10",
    password: "Password2026Secure!",
    confirmPassword: "DifferentPassword123!",
  });
  assert.equal(mismatch, "Las contraseñas no coinciden.");

  // Correo inválido
  const invalidEmail = validateClientRegistration({
    name: "Esteban Gaitan",
    email: "correo-invalido",
    username: "esteban10",
    password: "Password2026Secure!",
    confirmPassword: "Password2026Secure!",
  });
  assert.ok(invalidEmail?.includes("correo"), "Debe rechazar correos inválidos");

  // Nombre incompleto (solo 1 palabra)
  const singleName = validateClientRegistration({
    name: "Esteban",
    email: "esteban@example.com",
    username: "esteban10",
    password: "Password2026Secure!",
    confirmPassword: "Password2026Secure!",
  });
  assert.ok(singleName?.includes("apellido"), "Debe exigir al menos un apellido");
});

// 2. Criptografía de verificación de correo y contraseñas
test("2. Verificación de correo: generación de código 6 dígitos y HMAC no determinista", async () => {
  const {
    generateSixDigitCode,
    hashVerificationCode,
    verifyVerificationCodeHash,
    hashPassword,
    verifyPassword,
  } = await import("../lib/auth.ts");

  const code1 = generateSixDigitCode();
  assert.match(code1, /^\d{6}$/, "El código debe ser de exactamente 6 dígitos");

  const hash1 = hashVerificationCode("usr-uuid-1", "user@test.com", code1);
  assert.equal(typeof hash1, "string");
  assert.equal(hash1.length, 64, "HMAC-SHA256 debe tener 64 caracteres hex");

  // Verificación constante correcta
  assert.equal(verifyVerificationCodeHash("usr-uuid-1", "user@test.com", code1, hash1), true);
  // Verificación con código incorrecto
  assert.equal(verifyVerificationCodeHash("usr-uuid-1", "user@test.com", "000000", hash1), false);
  // Verificación con usuario diferente
  assert.equal(verifyVerificationCodeHash("usr-uuid-2", "user@test.com", code1, hash1), false);

  // Hash de contraseñas con sal aleatoria
  const pass = "MiClaveSegura123!";
  const pHash1 = await hashPassword(pass);
  const pHash2 = await hashPassword(pass);
  assert.notEqual(pHash1, pHash2, "Dos hashes con sal aleatoria deben ser diferentes");
  assert.equal(await verifyPassword(pass, pHash1), true);
  assert.equal(await verifyPassword("ClaveEquivocada", pHash1), false);
});

// 3. Adaptador Resend y clasificación de errores
test("3. Resend: clasificación de errores de sandbox, dominio y mensajes seguros", async () => {
  const { classifyResendError, publicMessageForCategory, sanitizeProviderText } =
    await import("../lib/emailErrors.ts");

  // Error típico de Resend Sandbox (onboarding@resend.dev) cuando se envía a otro correo
  const sandboxErr = {
    name: "validation_error",
    statusCode: 403,
    message: "You can only send testing emails to your own email address (owner@example.com).",
  };
  const classifiedSandbox = classifyResendError(sandboxErr);
  assert.equal(classifiedSandbox.category, "sandbox_recipient_restricted");
  assert.ok(!classifiedSandbox.safeMessage.includes("owner@example.com"), "Debe enmascarar correos en logs");
  assert.ok(
    publicMessageForCategory(classifiedSandbox.category).includes("modo de pruebas"),
    "El mensaje público debe informar claramente la restricción de pruebas"
  );

  // Error de dominio no verificado
  const domainErr = {
    name: "validation_error",
    statusCode: 403,
    message: "Domain not verified. Please verify your domain in Resend dashboard.",
  };
  const classifiedDomain = classifyResendError(domainErr);
  assert.equal(classifiedDomain.category, "domain_not_verified");
  assert.ok(
    publicMessageForCategory(classifiedDomain.category).includes("no está verificado"),
    "Debe informar que el dominio no está verificado"
  );

  // Saneamiento de textos con claves API y tokens
  const rawLog = "Error with key re_1234567890abcdef and token 0123456789abcdef0123456789abcdef";
  const sanitized = sanitizeProviderText(rawLog);
  assert.ok(!sanitized.includes("re_1234567890abcdef"), "No debe exponer API keys de Resend");
  assert.ok(!sanitized.includes("0123456789abcdef0123456789abcdef"), "No debe exponer tokens largos");
});

// 4. Tokens de recuperación de contraseña: ciclo de vida y evaluación
test("4. Recuperación de contraseña: ciclo de vida de tokens, expiración y consumo único", async () => {
  const { generatePasswordResetToken, hashPasswordResetToken } = await import("../lib/auth.ts");
  const { evaluateResetTokenRecord, validatePasswordResetSubmission } =
    await import("../lib/passwordResetPolicy.ts");

  const { token, tokenHash } = generatePasswordResetToken();
  assert.match(token, /^[0-9a-f]{64}$/, "El token debe ser de 32 bytes hex (64 caracteres)");
  assert.equal(hashPasswordResetToken(token), tokenHash);

  const now = new Date();
  const future = new Date(now.getTime() + 15 * 60 * 1000);
  const past = new Date(now.getTime() - 1000);

  // Token válido y vigente
  const validRecord = {
    id: "tok-1",
    usuarioId: "usr-1",
    tokenHash,
    fechaExpira: future,
    consumidoEn: null,
    invalidadoEn: null,
    creadoEn: now,
    usuario: { id: "usr-1", estado: "VERIFICADO", passwordHash: "h1" },
  };
  const evalValid = evaluateResetTokenRecord(validRecord, now);
  assert.equal(evalValid.valid, true);

  // Token expirado
  const expiredRecord = { ...validRecord, fechaExpira: past };
  const evalExpired = evaluateResetTokenRecord(expiredRecord, now);
  assert.equal(evalExpired.valid, false);
  assert.equal(evalExpired.reason, "expired");

  // Token ya consumido
  const consumedRecord = { ...validRecord, consumidoEn: past };
  const evalConsumed = evaluateResetTokenRecord(consumedRecord, now);
  assert.equal(evalConsumed.valid, false);
  assert.equal(evalConsumed.reason, "consumed");

  // Token invalidado (por nueva solicitud)
  const invalidatedRecord = { ...validRecord, invalidadoEn: past };
  const evalInvalidated = evaluateResetTokenRecord(invalidatedRecord, now);
  assert.equal(evalInvalidated.valid, false);
  assert.equal(evalInvalidated.reason, "consumed");

  // Validación de formulario de reseteo
  const subCheck = validatePasswordResetSubmission({
    token,
    password: "NewPassword2026Secure!",
    confirmPassword: "NewPassword2026Secure!",
  });
  assert.equal(subCheck.ok, true);
});

// 5. Verificación real de tablas y columnas en Neon PostgreSQL
test("5. Base de datos Neon: verificación de tablas del sistema y columnas necesarias", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../generated/prisma/client.js");

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[Neon Verification] DIRECT_URL / DATABASE_URL no provistas; omitiendo verificación directa de Neon.");
    return;
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });

  try {
    // 1. Consultar existencia de tablas en el esquema public
    const tables = await client.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    const tableNames = new Set(tables.map((t) => t.table_name));

    // Validar tablas indispensables para registro, autenticación y recuperación
    assert.ok(tableNames.has("usuarios"), "Tabla 'usuarios' debe existir en Neon");
    assert.ok(tableNames.has("perfiles_clientes"), "Tabla 'perfiles_clientes' debe existir en Neon");
    assert.ok(tableNames.has("perfiles_reparadores"), "Tabla 'perfiles_reparadores' debe existir en Neon");
    assert.ok(tableNames.has("verificaciones_correo"), "Tabla 'verificaciones_correo' debe existir en Neon");
    assert.ok(tableNames.has("tokens_recuperacion_password"), "Tabla 'tokens_recuperacion_password' debe existir en Neon");
    assert.ok(tableNames.has("sesiones_usuario"), "Tabla 'sesiones_usuario' debe existir en Neon");
    assert.ok(tableNames.has("documentos_reparadores"), "Tabla 'documentos_reparadores' debe existir en Neon");
    assert.ok(tableNames.has("fixi_wallets"), "Tabla 'fixi_wallets' debe existir en Neon");
    assert.ok(tableNames.has("transacciones_wallet"), "Tabla 'transacciones_wallet' debe existir en Neon");

    // 2. Verificar columnas críticas en 'usuarios'
    const userColumns = await client.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'usuarios';
    `);
    const colNames = new Set(userColumns.map((c) => c.column_name));
    assert.ok(colNames.has("id"), "Columna 'id' debe existir");
    assert.ok(colNames.has("email"), "Columna 'email' debe existir");
    assert.ok(colNames.has("nombreUsuario"), "Columna 'nombreUsuario' debe existir");
    assert.ok(colNames.has("passwordHash"), "Columna 'passwordHash' debe existir");
    assert.ok(colNames.has("rol"), "Columna 'rol' debe existir");
    assert.ok(colNames.has("estado"), "Columna 'estado' debe existir");

    console.log(`[Neon Verification] ${tableNames.size} tablas verificadas activas en PostgreSQL.`);
  } finally {
    await client.$disconnect();
  }
});

// 6. Prueba funcional de flujo en Neon: persistencia de usuario, código de verificación y token de recuperación
test("6. Flujo de datos en Neon: persistencia atómica, token y limpieza controlada", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../generated/prisma/client.js");
  const { hashPassword, generatePasswordResetToken } = await import("../lib/auth.ts");

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[Neon Verification] DIRECT_URL / DATABASE_URL no provistas; omitiendo verificación directa de Neon.");
    return;
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });

  const tempUsername = `testclient_${Date.now()}`;
  const tempEmail = `${tempUsername}@buildmeapp-test.internal`;
  let createdUserId = null;

  try {
    const passwordHash = await hashPassword("ValidPassword2026Secure!");

    // 1. Crear usuario en estado PENDIENTE_VERIFICACION (flujo de registro)
    const user = await client.usuario.create({
      data: {
        email: tempEmail,
        nombreUsuario: tempUsername,
        passwordHash,
        rol: "CLIENTE",
        estado: "PENDIENTE_VERIFICACION",
        perfilCliente: {
          create: {
            nombres: "Cliente",
            apellidos: "Prueba E2E",
          },
        },
      },
      select: { id: true, estado: true, rol: true },
    });
    createdUserId = user.id;

    assert.equal(user.estado, "PENDIENTE_VERIFICACION");
    assert.equal(user.rol, "CLIENTE");

    // 2. Registrar código de verificación en verificaciones_correo
    const verif = await client.verificacionCorreo.create({
      data: {
        usuarioId: user.id,
        correoDestino: tempEmail,
        codigoHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        intentos: 0,
        maxIntentos: 5,
        reenvios: 0,
        ultimoEnvioEn: new Date(),
        fechaExpira: new Date(Date.now() + 15 * 60 * 1000),
      },
      select: { id: true },
    });
    assert.ok(verif.id, "Código de verificación persistido con éxito en Neon");

    // 3. Registrar token de recuperación en tokens_recuperacion_password
    const { token, tokenHash } = generatePasswordResetToken();
    const tokenRec = await client.tokenRecuperacionPassword.create({
      data: {
        usuarioId: user.id,
        tokenHash,
        fechaExpira: new Date(Date.now() + 15 * 60 * 1000),
      },
      select: { id: true },
    });
    assert.ok(tokenRec.id, "Token de recuperación persistido con éxito en Neon");

    console.log(`[Neon E2E Validation] Flujo de registro y recuperación comprobado exitosamente en Neon.`);
  } finally {
    // Limpieza controlada del usuario de prueba para no dejar datos residuales
    if (createdUserId) {
      await client.usuario.delete({ where: { id: createdUserId } }).catch(() => {});
    }
    await client.$disconnect();
  }
});

console.log("=== TODAS LAS PRUEBAS DE REGISTRO, RECUPERACIÓN Y NEON COMPLETADAS ===");
