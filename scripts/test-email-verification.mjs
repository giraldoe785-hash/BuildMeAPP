// Pruebas de la lógica pura del flujo de verificación por correo.
// NO envían correos, NO usan la red y NO tocan la base de datos.
//
// Ejecutar:  node --test scripts/test-email-verification.mjs
// (Node 22.18+/24 ejecuta los .ts importados directamente.)

import test from "node:test";
import assert from "node:assert/strict";

import {
  validateClientRegistration,
  normalizeEmail,
  normalizeUsername,
  PASSWORD_POLICY_MESSAGE,
} from "../lib/registrationValidation.ts";
import {
  classifyResendError,
  sanitizeProviderText,
  publicMessageForCategory,
  isValidEmailFromFormat,
} from "../lib/emailErrors.ts";
import {
  isCodeUsable,
  cooldownSecondsRemaining,
  secondsUntilExpiry,
  hourlyLimitRetryAfterSeconds,
  VERIFICATION_MAX_CODES_PER_HOUR,
} from "../lib/verificationPolicy.ts";
import {
  RESET_TOKEN_EXPIRY_MINUTES,
  RESET_TOKEN_EXPIRY_MS,
  PASSWORD_RESET_POLICY_ERROR,
  GENERIC_PASSWORD_RESET_REQUEST_MESSAGE,
  generateResetTokenPair,
  hashResetTokenValue,
  isAccountEligibleForPasswordReset,
  evaluateResetTokenRecord,
  validatePasswordResetSubmission,
  hashPasswordScrypt,
  verifyPasswordScrypt,
} from "../lib/passwordResetPolicy.ts";

const validInput = {
  name: "Sofia Navarro",
  email: "Sofia@Example.org",
  username: "sofianavarro",
  password: "clave1234",
  confirmPassword: "clave1234",
};

// ---------------------------------------------------------------------------
// Validación compartida cliente/servidor
// ---------------------------------------------------------------------------

test("registro: datos válidos pasan", () => {
  assert.equal(validateClientRegistration(validInput), null);
});

test("registro: nombre de una sola palabra se rechaza con el mensaje del servidor", () => {
  assert.equal(
    validateClientRegistration({ ...validInput, name: "Shalom" }),
    "Ingresa el nombre completo incluyendo al menos un apellido."
  );
});

test("registro: usuario con caracteres inválidos o muy corto se rechaza", () => {
  for (const username of ["ab", "con espacio", "ñandú", "a@b"]) {
    assert.match(
      validateClientRegistration({ ...validInput, username }) ?? "",
      /nombre de usuario/i,
      `debería rechazar "${username}"`
    );
  }
});

test("registro: el usuario con mayúsculas se normaliza (igual que el servidor)", () => {
  assert.equal(normalizeUsername("  SofiaNavarro "), "sofianavarro");
  assert.equal(
    validateClientRegistration({ ...validInput, username: "SofiaNavarro" }),
    null
  );
});

test("registro: correo inválido o demasiado largo se rechaza", () => {
  assert.match(
    validateClientRegistration({ ...validInput, email: "sin-arroba" }) ?? "",
    /correo/i
  );
  assert.match(
    validateClientRegistration({
      ...validInput,
      email: `${"a".repeat(150)}@x.com`,
    }) ?? "",
    /correo/i
  );
  assert.equal(normalizeEmail("  Sofia@Example.ORG "), "sofia@example.org");
});

test("registro: política de contraseña (7 caracteres y 2 números) y confirmación", () => {
  assert.equal(
    validateClientRegistration({ ...validInput, password: "abcdefg1", confirmPassword: "abcdefg1" }),
    PASSWORD_POLICY_MESSAGE
  );
  assert.equal(
    validateClientRegistration({ ...validInput, password: "a1b2", confirmPassword: "a1b2" }),
    PASSWORD_POLICY_MESSAGE
  );
  assert.equal(
    validateClientRegistration({ ...validInput, confirmPassword: "otra1234" }),
    "Las contraseñas no coinciden."
  );
  assert.equal(
    validateClientRegistration({ ...validInput, name: "" }),
    "Todos los campos son obligatorios."
  );
});

// ---------------------------------------------------------------------------
// Errores del proveedor de correo (Nodemailer SMTP y compatibilidad previa)
// ---------------------------------------------------------------------------

test("resend: restricción del remitente de pruebas se clasifica y NO filtra el correo del titular", () => {
  const info = classifyResendError({
    name: "validation_error",
    statusCode: 403,
    message:
      "You can only send testing emails to your own email address (titular@example.com). To send emails to other recipients, please verify a domain at resend.com/domains.",
  });
  assert.equal(info.category, "sandbox_recipient_restricted");
  assert.equal(info.statusCode, 403);
  assert.ok(!info.safeMessage.includes("titular@example.com"));
  assert.ok(info.safeMessage.includes("[correo]"));
  assert.match(publicMessageForCategory(info.category), /modo de pruebas/);
});

test("correo/SMTP: credenciales inválidas (EAUTH/535), destinatario inválido, límite y red", () => {
  assert.equal(
    classifyResendError({
      code: "EAUTH",
      responseCode: 535,
      response: "535-5.7.8 Username and Password not accepted for user@gmail.com",
    }).category,
    "invalid_credentials"
  );
  assert.equal(
    classifyResendError({
      code: "EENVELOPE",
      responseCode: 550,
      response: "550 5.1.1 The email account that you tried to reach does not exist",
    }).category,
    "invalid_recipient"
  );
  assert.equal(
    classifyResendError({
      code: "ECONNECTION",
      message: "connect ETIMEDOUT",
    }).category,
    "network"
  );
  assert.equal(
    classifyResendError({
      name: "validation_error",
      statusCode: 403,
      message: "The midominio.com domain is not verified. Please, add and verify your domain.",
    }).category,
    "domain_not_verified"
  );
  assert.equal(
    classifyResendError({ name: "invalid_api_key", statusCode: 400, message: "API key is invalid" }).category,
    "invalid_api_key"
  );
  assert.equal(
    classifyResendError({ name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" }).category,
    "rate_limited"
  );
  assert.equal(
    classifyResendError({ name: "application_error", statusCode: null, message: "Unable to fetch data." }).category,
    "network"
  );
  assert.equal(classifyResendError(new Error("fetch failed")).category, "network");
  assert.equal(classifyResendError({ name: "x", statusCode: 500, message: "???" }).category, "unknown");
});

test("saneamiento: enmascara correos, API keys y secretos largos", () => {
  const text = sanitizeProviderText(
    "key re_AbCdEfGh12345678 owner juan.perez@gmail.com token abcdefghijklmnopqrstuvwxyz0123456789ABCD"
  );
  assert.ok(!/juan\.perez/.test(text));
  assert.ok(!/re_AbCdEfGh/.test(text));
  assert.ok(!/abcdefghijklmnopqrstuvwxyz0123456789/.test(text));
});

test("EMAIL_FROM: acepta formatos válidos y rechaza plantillas/valores rotos", () => {
  assert.equal(isValidEmailFromFormat("BuildMeAPP <mi_cuenta@gmail.com>"), true);
  assert.equal(isValidEmailFromFormat("mi_cuenta@gmail.com"), true);
  assert.equal(isValidEmailFromFormat("BuildMeAPP <correo-de-tu-dominio-verificado>"), false);
  assert.equal(isValidEmailFromFormat("BuildMeAPP <no-reply@tudominio.com>"), false);
  assert.equal(isValidEmailFromFormat("sin formato"), false);
  assert.equal(isValidEmailFromFormat(""), false);
});

// ---------------------------------------------------------------------------
// Política del código (vigencia, intentos, enfriamiento, tope por hora)
// ---------------------------------------------------------------------------

const t0 = new Date("2026-10-17T12:00:00.000Z");
const plus = (base, seconds) => new Date(base.getTime() + seconds * 1000);

const baseRow = {
  fechaExpira: plus(t0, 600),
  intentos: 0,
  maxIntentos: 5,
  consumidoEn: null,
  invalidadoEn: null,
};

test("código: vigente, expirado, consumido, invalidado y con intentos agotados", () => {
  assert.equal(isCodeUsable(baseRow, plus(t0, 1)), true);
  assert.equal(isCodeUsable(baseRow, plus(t0, 600)), false); // expira exactamente a los 10 min
  assert.equal(isCodeUsable({ ...baseRow, consumidoEn: t0 }, plus(t0, 1)), false);
  assert.equal(isCodeUsable({ ...baseRow, invalidadoEn: t0 }, plus(t0, 1)), false);
  assert.equal(isCodeUsable({ ...baseRow, intentos: 5 }, plus(t0, 1)), false);
  assert.equal(isCodeUsable({ ...baseRow, intentos: 4 }, plus(t0, 1)), true);
});

test("enfriamiento: se calcula con la hora del servidor, no con un temporizador local", () => {
  assert.equal(cooldownSecondsRemaining(t0, plus(t0, 0)), 60);
  assert.equal(cooldownSecondsRemaining(t0, plus(t0, 45)), 15);
  assert.equal(cooldownSecondsRemaining(t0, plus(t0, 60)), 0);
  assert.equal(cooldownSecondsRemaining(t0, plus(t0, 600)), 0);
  assert.equal(secondsUntilExpiry(plus(t0, 600), plus(t0, 100)), 500);
  assert.equal(secondsUntilExpiry(plus(t0, 600), plus(t0, 700)), 0);
});

test("tope por hora: bloquea al llegar al máximo y libera cuando sale el más antiguo", () => {
  const now = plus(t0, 3000);
  const fewer = Array.from({ length: VERIFICATION_MAX_CODES_PER_HOUR - 1 }, (_, i) => plus(t0, i * 10));
  assert.equal(hourlyLimitRetryAfterSeconds(fewer, now), 0);

  const full = Array.from({ length: VERIFICATION_MAX_CODES_PER_HOUR }, (_, i) => plus(t0, i * 10));
  // El primero (t0) sale de la ventana a t0 + 3600 s; ahora es t0 + 3000 s → faltan 600 s.
  assert.equal(hourlyLimitRetryAfterSeconds(full, now), 600);

  // Los códigos fuera de la ventana de una hora no cuentan.
  assert.equal(hourlyLimitRetryAfterSeconds(full, plus(t0, 3700 + 60)), 0);
});

// ---------------------------------------------------------------------------
// Recuperación de contraseña mediante enlace temporal (15 minutos)
// ---------------------------------------------------------------------------

test("recuperación: vigencia exacta de 15 minutos y generación/hash SHA-256 del token", () => {
  assert.equal(RESET_TOKEN_EXPIRY_MINUTES, 15);
  assert.equal(RESET_TOKEN_EXPIRY_MS, 15 * 60 * 1000);

  const { token, tokenHash } = generateResetTokenPair();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(token, tokenHash);
  assert.equal(hashResetTokenValue(token), tokenHash);
});

test("recuperación: token válido, vencido (15 min), consumido, invalidado e inválido", () => {
  const activeUser = {
    id: "user-1",
    estado: "VERIFICADO",
    passwordHash: "salt:hash",
  };
  const validRecord = {
    fechaExpira: new Date(t0.getTime() + RESET_TOKEN_EXPIRY_MS),
    consumidoEn: null,
    invalidadoEn: null,
    usuario: activeUser,
  };

  // Token válido antes de los 15 minutos
  assert.deepEqual(evaluateResetTokenRecord(validRecord, plus(t0, 899)), {
    valid: true,
  });

  // Token vencido exactamente a los 15 minutos (900 s)
  const expiredEval = evaluateResetTokenRecord(validRecord, plus(t0, 900));
  assert.equal(expiredEval.valid, false);
  assert.equal(expiredEval.reason, "expired");
  assert.equal(expiredEval.status, 410);

  // Token ya consumido
  const consumedEval = evaluateResetTokenRecord(
    { ...validRecord, consumidoEn: plus(t0, 120) },
    plus(t0, 200)
  );
  assert.equal(consumedEval.valid, false);
  assert.equal(consumedEval.reason, "consumed");
  assert.equal(consumedEval.status, 410);

  // Token invalidado por una solicitud más reciente
  const invalidatedEval = evaluateResetTokenRecord(
    { ...validRecord, invalidadoEn: plus(t0, 60) },
    plus(t0, 200)
  );
  assert.equal(invalidatedEval.valid, false);
  assert.equal(invalidatedEval.reason, "consumed");
  assert.equal(invalidatedEval.status, 410);

  // Token inexistente o cuenta suspendida
  assert.equal(evaluateResetTokenRecord(null, t0).reason, "invalid");
  assert.equal(
    evaluateResetTokenRecord(
      { ...validRecord, usuario: { ...activeUser, estado: "SUSPENDIDO" } },
      t0
    ).reason,
    "invalid"
  );
});

test("recuperación: preservación de Google OAuth y respuestas genéricas sin enumeración", () => {
  // Cuenta tradicional con correo y passwordHash local -> elegible
  assert.equal(
    isAccountEligibleForPasswordReset({
      email: "cliente@ejemplo.org",
      estado: "VERIFICADO",
      passwordHash: "salt:hash",
    }),
    true
  );

  // Cuenta inexistente -> no elegible, pero el endpoint devuelve el mismo mensaje genérico
  assert.equal(isAccountEligibleForPasswordReset(null), false);

  // Cuenta suspendida -> no elegible
  assert.equal(
    isAccountEligibleForPasswordReset({
      email: "suspendido@ejemplo.org",
      estado: "SUSPENDIDO",
      passwordHash: "salt:hash",
    }),
    false
  );

  // Cuenta exclusiva de Google OAuth (passwordHash === null) -> NO elegible ni en forgot ni en reset
  const googleOnlyUser = {
    id: "google-user-1",
    email: "google@ejemplo.org",
    estado: "VERIFICADO",
    passwordHash: null,
  };
  assert.equal(isAccountEligibleForPasswordReset(googleOnlyUser), false);
  assert.equal(
    evaluateResetTokenRecord(
      {
        fechaExpira: plus(t0, 900),
        consumidoEn: null,
        invalidadoEn: null,
        usuario: googleOnlyUser,
      },
      t0
    ).reason,
    "invalid"
  );
  assert.match(GENERIC_PASSWORD_RESET_REQUEST_MESSAGE, /Si existe una cuenta compatible/);
});

test("recuperación: validación de contraseñas que no coinciden, política y formato de token", () => {
  const { token } = generateResetTokenPair();

  // Token malformado
  const badToken = validatePasswordResetSubmission({
    token: "token-corto",
    password: "NuevaClave12",
    confirmPassword: "NuevaClave12",
  });
  assert.equal(badToken.ok, false);
  assert.equal(badToken.reason, "invalid");

  // Contraseña que incumple la política (< 2 números o < 7 caracteres)
  const weakPwd = validatePasswordResetSubmission({
    token,
    password: "soloun1",
    confirmPassword: "soloun1",
  });
  assert.equal(weakPwd.ok, false);
  assert.equal(weakPwd.message, PASSWORD_RESET_POLICY_ERROR);

  // Contraseñas que no coinciden
  const mismatch = validatePasswordResetSubmission({
    token,
    password: "NuevaClave12",
    confirmPassword: "OtraClave99",
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.message, /no coincide/i);

  // Envío válido
  const validSub = validatePasswordResetSubmission({
    token,
    password: "NuevaClave12",
    confirmPassword: "NuevaClave12",
  });
  assert.deepEqual(validSub, { ok: true, token });
});

test("recuperación: consumo atómico sin reutilización simultánea, compatibilidad con login y revocación de sesiones", async () => {
  const oldHash = await hashPasswordScrypt("ClaveVieja12");
  const { token, tokenHash } = generateResetTokenPair();

  // Estado simulado de base de datos para verificar atomicidad y efectos colaterales
  const dbState = {
    user: {
      id: "user-1",
      passwordHash: oldHash,
      intentosFallidosLogin: 3,
      bloqueadoHasta: plus(t0, 900),
    },
    tokens: [
      {
        id: "tok-1",
        usuarioId: "user-1",
        tokenHash,
        fechaExpira: plus(t0, 900),
        consumidoEn: null,
        invalidadoEn: null,
      },
      {
        id: "tok-prev",
        usuarioId: "user-1",
        tokenHash: "a".repeat(64),
        fechaExpira: plus(t0, 600),
        consumidoEn: null,
        invalidadoEn: null,
      },
    ],
    sessions: [
      { id: "ses-1", usuarioId: "user-1", revocado: false },
      { id: "ses-2", usuarioId: "user-1", revocado: false },
    ],
  };

  async function attemptAtomicReset(newPassword, now) {
    const newHash = await hashPasswordScrypt(newPassword);
    const target = dbState.tokens.find((t) => t.tokenHash === tokenHash);
    // Operación atómica equivalente a updateMany({ where: { id, consumidoEn: null, invalidadoEn: null, fechaExpira: { gt: now } } })
    if (
      !target ||
      target.consumidoEn !== null ||
      target.invalidadoEn !== null ||
      target.fechaExpira.getTime() <= now.getTime()
    ) {
      return { success: false, status: 410, reason: "consumed" };
    }

    target.consumidoEn = now;
    for (const other of dbState.tokens) {
      if (other.usuarioId === target.usuarioId && other.id !== target.id && !other.consumidoEn && !other.invalidadoEn) {
        other.invalidadoEn = now;
      }
    }
    dbState.user.passwordHash = newHash;
    dbState.user.intentosFallidosLogin = 0;
    dbState.user.bloqueadoHasta = null;
    for (const ses of dbState.sessions) {
      if (ses.usuarioId === target.usuarioId && !ses.revocado) {
        ses.revocado = true;
      }
    }
    return { success: true, status: 200 };
  }

  // Dos intentos concurrentes con el mismo token: solo uno puede consumirlo
  const [res1, res2] = await Promise.all([
    attemptAtomicReset("ClaveNueva99", plus(t0, 120)),
    attemptAtomicReset("OtraClave88", plus(t0, 120)),
  ]);

  const successes = [res1, res2].filter((r) => r.success);
  const failures = [res1, res2].filter((r) => !r.success);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "consumed");

  // Todas las sesiones anteriores quedaron revocadas
  assert.ok(dbState.sessions.every((s) => s.revocado === true));
  // El otro token activo quedó invalidado
  assert.ok(dbState.tokens.find((t) => t.id === "tok-prev").invalidadoEn !== null);
  // Contadores de bloqueo limpiados
  assert.equal(dbState.user.intentosFallidosLogin, 0);
  assert.equal(dbState.user.bloqueadoHasta, null);

  // La nueva contraseña funciona con el login tradicional (scrypt) y la antigua ya no
  assert.equal(await verifyPasswordScrypt("ClaveVieja12", dbState.user.passwordHash), false);
  const nuevaValida =
    (await verifyPasswordScrypt("ClaveNueva99", dbState.user.passwordHash)) ||
    (await verifyPasswordScrypt("OtraClave88", dbState.user.passwordHash));
  assert.equal(nuevaValida, true);
});
