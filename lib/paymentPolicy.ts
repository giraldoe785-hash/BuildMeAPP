// Utilidades puras y deterministas de política de pagos Wompi Colombia — Step 2A.
//
// ALCANCE ESTRICTO DE STEP 2A:
//  1. Validación de importes cobrables con enteros y BigInt.
//  2. Validación de configuración de credenciales sin exponer secretos.
//  3. Utilidades SHA-256 puras (firma de integridad y cálculo/verificación dinámica de checksum).
//  4. Generación determinista de referencias con UUIDv4 (122 bits aleatorios).
//  5. Sanitización de snapshots de transacciones y redacción de datos sensibles.
//  6. Combinación determinista y pura de observaciones de transacciones.
//
// NO implementa matrices de transición de estados, persistencia, transacciones Prisma,
// endpoints HTTP, workers, leases, fencing tokens ni reembolsos.

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  MAX_WOMPI_AMOUNT_IN_CENTS,
  WOMPI_CENTS_PER_COP_PESO,
} from "./pricing";

export const WOMPI_CURRENCY_COP = "COP" as const;

export const WOMPI_SANDBOX_API_BASE_URL = "https://sandbox.wompi.co/v1" as const;
export const WOMPI_WEB_CHECKOUT_URL = "https://checkout.wompi.co/p/" as const;

/**
 * Umbral mínimo cobrable interno configurable por defecto:
 * 1.500 COP = 150.000 centavos.
 */
export const DEFAULT_MIN_CHARGEABLE_COP_CENTS = 150_000n;

export const MAX_WOMPI_REFERENCE_LENGTH = 100;

const UUID_V4_OR_RFC_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;

const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const SAFE_PROPERTY_SEGMENT_REGEX = /^[a-zA-Z0-9_]+$/;

export type WompiEnvironment = "test" | "production";

export class PaymentPolicyError extends Error {
  code: string;

  constructor(message: string, code = "PAYMENT_POLICY_ERROR") {
    super(message);
    this.name = "PaymentPolicyError";
    this.code = code;
  }
}

// ============================================================================
// 5.1 VALIDACIÓN MONETARIA PARA WOMPI (BIGINT / ENTEROS)
// ============================================================================

export function validateChargeableWompiAmount(
  amountInCents: unknown,
  options?: {
    minAmountInCents?: bigint;
    maxAmountInCents?: bigint;
  }
): bigint {
  const minCents = options?.minAmountInCents ?? DEFAULT_MIN_CHARGEABLE_COP_CENTS;
  const maxCents = options?.maxAmountInCents ?? MAX_WOMPI_AMOUNT_IN_CENTS;

  if (minCents <= 0n || maxCents < minCents) {
    throw new PaymentPolicyError(
      "Los límites configurados para validación monetaria son inválidos.",
      "INVALID_AMOUNT_BOUNDS"
    );
  }

  let cents: bigint;

  if (typeof amountInCents === "bigint") {
    cents = amountInCents;
  } else if (typeof amountInCents === "number") {
    if (!Number.isFinite(amountInCents) || !Number.isSafeInteger(amountInCents)) {
      throw new PaymentPolicyError(
        "El monto en centavos debe ser un entero seguro o BigInt.",
        "UNSAFE_AMOUNT_NUMBER"
      );
    }
    if (Object.is(amountInCents, -0)) {
      throw new PaymentPolicyError(
        "El monto en centavos no puede ser -0.",
        "NEGATIVE_AMOUNT"
      );
    }
    cents = BigInt(amountInCents);
  } else if (typeof amountInCents === "string") {
    const clean = amountInCents.trim();
    if (!/^\d+$/.test(clean)) {
      throw new PaymentPolicyError(
        "El monto en centavos debe ser una cadena de dígitos enteros positivos.",
        "INVALID_AMOUNT_STRING"
      );
    }
    cents = BigInt(clean);
  } else {
    throw new PaymentPolicyError(
      "El tipo del monto en centavos es inválido.",
      "INVALID_AMOUNT_TYPE"
    );
  }

  if (cents <= 0n) {
    throw new PaymentPolicyError(
      "El monto en centavos debe ser estrictamente mayor que cero.",
      "NON_POSITIVE_AMOUNT"
    );
  }

  if (cents % WOMPI_CENTS_PER_COP_PESO !== 0n) {
    throw new PaymentPolicyError(
      "El monto en centavos para COP debe ser múltiplo exacto de 100.",
      "INEXACT_COP_CENTS"
    );
  }

  if (cents < minCents) {
    throw new PaymentPolicyError(
      `El monto en centavos es inferior al mínimo cobrable configurado (${minCents.toString()}).`,
      "AMOUNT_BELOW_MINIMUM"
    );
  }

  if (cents > maxCents) {
    throw new PaymentPolicyError(
      `El monto en centavos excede el límite máximo permitido (${maxCents.toString()}).`,
      "AMOUNT_OVERFLOW"
    );
  }

  return cents;
}

// ============================================================================
// 5.2 VALIDACIÓN DE CONFIGURACIÓN SIN EXPONER SECRETOS
// ============================================================================

export type WompiConfigIssueReason =
  | "MISSING"
  | "INVALID_FORMAT"
  | "ENVIRONMENT_MISMATCH"
  | "PUBLIC_EXPOSURE_RISK";

export interface WompiConfigIssue {
  variable: string;
  reason: WompiConfigIssueReason;
  message: string;
}

export interface ValidatedWompiConfigMeta {
  environment: WompiEnvironment;
  baseUrl: string;
  minChargeableCopCents: bigint;
}

export type WompiConfigValidationResult =
  | {
      ok: true;
      status: "VALID";
      config: ValidatedWompiConfigMeta;
      issues: readonly [];
    }
  | {
      ok: false;
      status: "MISSING_CONFIG" | "INVALID_CONFIG";
      config: null;
      issues: readonly WompiConfigIssue[];
    };

const PUBLIC_KEY_REGEX = /^pub_(test|prod)_[A-Za-z0-9]{8,128}$/;
const PRIVATE_KEY_REGEX = /^prv_(test|prod)_[A-Za-z0-9]{8,128}$/;
const EVENTS_SECRET_REGEX = /^(test|prod)_events_[A-Za-z0-9]{8,128}$/;
const INTEGRITY_SECRET_REGEX = /^(test|prod)_integrity_[A-Za-z0-9]{8,128}$/;

const SENSITIVE_VALUE_PREFIX_REGEX =
  /^(prv_(test|prod)_|(test|prod)_events_|(test|prod)_integrity_)/i;

/**
 * Valida las variables de configuración de Wompi sin incluir jamás el valor de
 * las llaves o secretos en los errores ni en el resultado devuelto.
 */
export function validateWompiConfig(
  env: Readonly<Record<string, string | undefined>>,
  options?: {
    expectedEnvironment?: WompiEnvironment;
  }
): WompiConfigValidationResult {
  const issues: WompiConfigIssue[] = [];

  // 1. Verificar que ninguna variable NEXT_PUBLIC_* exponga llaves privadas o secretos
  for (const [key, rawVal] of Object.entries(env)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    const trimmed = typeof rawVal === "string" ? rawVal.trim() : "";
    if (!trimmed) continue;

    if (
      key !== "NEXT_PUBLIC_WOMPI_PUBLIC_KEY" &&
      (key.toUpperCase().includes("PRIVATE") ||
        key.toUpperCase().includes("SECRET") ||
        key.toUpperCase().includes("INTEGRITY") ||
        key.toUpperCase().includes("EVENTS")) &&
      key.toUpperCase().includes("WOMPI")
    ) {
      issues.push({
        variable: key,
        reason: "PUBLIC_EXPOSURE_RISK",
        message: `La variable pública ${key} no debe utilizarse para almacenar secretos de Wompi.`,
      });
      continue;
    }

    if (SENSITIVE_VALUE_PREFIX_REGEX.test(trimmed)) {
      issues.push({
        variable: key,
        reason: "PUBLIC_EXPOSURE_RISK",
        message: `La variable pública ${key} contiene un prefijo de credencial privada o secreto de servidor.`,
      });
    }
  }

  const requiredSpecs: ReadonlyArray<{
    name: string;
    regex: RegExp;
    label: string;
  }> = [
    {
      name: "NEXT_PUBLIC_WOMPI_PUBLIC_KEY",
      regex: PUBLIC_KEY_REGEX,
      label: "llave pública de Wompi",
    },
    {
      name: "WOMPI_PRIVATE_KEY",
      regex: PRIVATE_KEY_REGEX,
      label: "llave privada de Wompi",
    },
    {
      name: "WOMPI_EVENTS_SECRET",
      regex: EVENTS_SECRET_REGEX,
      label: "secreto de eventos de Wompi",
    },
    {
      name: "WOMPI_INTEGRITY_SECRET",
      regex: INTEGRITY_SECRET_REGEX,
      label: "secreto de integridad de Wompi",
    },
  ];

  const detectedEnvs = new Map<string, WompiEnvironment>();

  for (const spec of requiredSpecs) {
    const raw = env[spec.name];
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) {
      issues.push({
        variable: spec.name,
        reason: "MISSING",
        message: `Falta configurar la variable obligatoria ${spec.name} (${spec.label}).`,
      });
      continue;
    }

    const match = spec.regex.exec(trimmed);
    if (!match) {
      issues.push({
        variable: spec.name,
        reason: "INVALID_FORMAT",
        message: `El formato de la variable ${spec.name} (${spec.label}) no es válido.`,
      });
      continue;
    }

    const mode: WompiEnvironment = match[1] === "prod" ? "production" : "test";
    detectedEnvs.set(spec.name, mode);
  }

  let resolvedEnv: WompiEnvironment | null = null;
  const uniqueEnvs = new Set(detectedEnvs.values());

  if (uniqueEnvs.size > 1) {
    issues.push({
      variable: "WOMPI_ENVIRONMENT",
      reason: "ENVIRONMENT_MISMATCH",
      message:
        "Las credenciales configuradas mezclan ambientes de prueba (test) y producción (prod).",
    });
  } else if (uniqueEnvs.size === 1) {
    resolvedEnv = [...uniqueEnvs][0];
    if (
      options?.expectedEnvironment &&
      resolvedEnv !== options.expectedEnvironment
    ) {
      issues.push({
        variable: "WOMPI_ENVIRONMENT",
        reason: "ENVIRONMENT_MISMATCH",
        message: `Las credenciales corresponden al ambiente "${resolvedEnv}", pero se esperaba "${options.expectedEnvironment}".`,
      });
    }
  }

  let minChargeableCopCents = DEFAULT_MIN_CHARGEABLE_COP_CENTS;
  const rawMinCents = env.MINIMUM_CHARGEABLE_COP_CENTS?.trim();
  if (rawMinCents) {
    if (!/^\d+$/.test(rawMinCents)) {
      issues.push({
        variable: "MINIMUM_CHARGEABLE_COP_CENTS",
        reason: "INVALID_FORMAT",
        message:
          "MINIMUM_CHARGEABLE_COP_CENTS debe ser un entero positivo en centavos.",
      });
    } else {
      const parsedMin = BigInt(rawMinCents);
      if (
        parsedMin <= 0n ||
        parsedMin > MAX_WOMPI_AMOUNT_IN_CENTS ||
        parsedMin % WOMPI_CENTS_PER_COP_PESO !== 0n
      ) {
        issues.push({
          variable: "MINIMUM_CHARGEABLE_COP_CENTS",
          reason: "INVALID_FORMAT",
          message:
            "MINIMUM_CHARGEABLE_COP_CENTS debe ser múltiplo positivo de 100 dentro del rango permitido.",
        });
      } else {
        minChargeableCopCents = parsedMin;
      }
    }
  }

  const defaultBaseUrl =
    resolvedEnv === "production"
      ? "https://production.wompi.co/v1"
      : "https://sandbox.wompi.co/v1";

  let baseUrl = defaultBaseUrl;
  const rawBaseUrl = env.WOMPI_API_BASE_URL?.trim();
  if (rawBaseUrl) {
    try {
      const parsedUrl = new URL(rawBaseUrl);
      if (parsedUrl.protocol !== "https:") {
        issues.push({
          variable: "WOMPI_API_BASE_URL",
          reason: "INVALID_FORMAT",
          message: "WOMPI_API_BASE_URL debe utilizar el protocolo https://.",
        });
      } else if (
        resolvedEnv === "test" &&
        parsedUrl.hostname.toLowerCase().includes("production.wompi.co")
      ) {
        issues.push({
          variable: "WOMPI_API_BASE_URL",
          reason: "ENVIRONMENT_MISMATCH",
          message:
            "No se permite apuntar WOMPI_API_BASE_URL a producción con credenciales de prueba.",
        });
      } else if (
        resolvedEnv === "production" &&
        parsedUrl.hostname.toLowerCase().includes("sandbox.wompi.co")
      ) {
        issues.push({
          variable: "WOMPI_API_BASE_URL",
          reason: "ENVIRONMENT_MISMATCH",
          message:
            "No se permite apuntar WOMPI_API_BASE_URL a sandbox con credenciales de producción.",
        });
      } else {
        baseUrl = rawBaseUrl.replace(/\/+$/, "");
      }
    } catch {
      issues.push({
        variable: "WOMPI_API_BASE_URL",
        reason: "INVALID_FORMAT",
        message: "WOMPI_API_BASE_URL no es una URL válida.",
      });
    }
  }

  if (issues.length > 0 || !resolvedEnv) {
    const allMissing =
      issues.length > 0 && issues.every((i) => i.reason === "MISSING");
    return {
      ok: false,
      status: allMissing ? "MISSING_CONFIG" : "INVALID_CONFIG",
      config: null,
      issues,
    };
  }

  return {
    ok: true,
    status: "VALID",
    config: {
      environment: resolvedEnv,
      baseUrl,
      minChargeableCopCents,
    },
    issues: [],
  };
}

export interface ValidatedSandboxRuntimeConfig {
  environment: "test";
  apiBaseUrl: typeof WOMPI_SANDBOX_API_BASE_URL;
  checkoutUrl: typeof WOMPI_WEB_CHECKOUT_URL;
  publicKey: string;
  privateKey: string;
  eventsSecret: string;
  integritySecret: string;
  minChargeableCopCents: bigint;
}

const SANDBOX_PUBLIC_KEY_REGEX = /^pub_test_[A-Za-z0-9]{8,128}$/;
const SANDBOX_PRIVATE_KEY_REGEX = /^prv_test_[A-Za-z0-9]{8,128}$/;
const SANDBOX_EVENTS_SECRET_REGEX = /^test_events_[A-Za-z0-9]{8,128}$/;
const SANDBOX_INTEGRITY_SECRET_REGEX = /^test_integrity_[A-Za-z0-9]{8,128}$/;

/**
 * Validación centralizada y estricta de entorno Wompi Sandbox (Etapa 1).
 * Debe invocarse exclusivamente en tiempo de ejecución de peticiones/servicios,
 * jamás en el nivel raíz del módulo. Nunca expone valores de llaves o secretos.
 */
export function validateWompiEnvironmentConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): ValidatedSandboxRuntimeConfig {
  for (const [key, rawVal] of Object.entries(env)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    const trimmed = typeof rawVal === "string" ? rawVal.trim() : "";
    if (!trimmed) continue;

    if (
      key !== "NEXT_PUBLIC_WOMPI_PUBLIC_KEY" &&
      (key.toUpperCase().includes("PRIVATE") ||
        key.toUpperCase().includes("SECRET") ||
        key.toUpperCase().includes("INTEGRITY") ||
        key.toUpperCase().includes("EVENTS")) &&
      key.toUpperCase().includes("WOMPI")
    ) {
      throw new PaymentPolicyError(
        `Riesgo de exposición pública: la variable ${key} no debe almacenar secretos de Wompi.`,
        "PUBLIC_EXPOSURE_RISK"
      );
    }

    if (SENSITIVE_VALUE_PREFIX_REGEX.test(trimmed)) {
      throw new PaymentPolicyError(
        `Riesgo de exposición pública: la variable ${key} contiene un prefijo de credencial privada o secreto de servidor.`,
        "PUBLIC_EXPOSURE_RISK"
      );
    }
  }

  const rawEnvironment =
    typeof env.WOMPI_ENVIRONMENT === "string" ? env.WOMPI_ENVIRONMENT.trim() : "";
  if (!rawEnvironment) {
    throw new PaymentPolicyError(
      "Falta configurar WOMPI_ENVIRONMENT='test'. No se permite fallback implícito.",
      "MISSING_WOMPI_ENVIRONMENT"
    );
  }
  if (rawEnvironment !== "test") {
    throw new PaymentPolicyError(
      "Configuración rechazada: WOMPI_ENVIRONMENT debe ser exclusivamente 'test' (Sandbox).",
      "NON_SANDBOX_ENVIRONMENT"
    );
  }

  const publicKey =
    typeof env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY === "string"
      ? env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY.trim()
      : "";
  if (!publicKey) {
    throw new PaymentPolicyError(
      "Falta configurar NEXT_PUBLIC_WOMPI_PUBLIC_KEY.",
      "MISSING_WOMPI_PUBLIC_KEY"
    );
  }
  if (publicKey.startsWith("pub_prod_")) {
    throw new PaymentPolicyError(
      "Credencial de producción rechazada en NEXT_PUBLIC_WOMPI_PUBLIC_KEY.",
      "PRODUCTION_CREDENTIAL_REJECTED"
    );
  }
  if (!SANDBOX_PUBLIC_KEY_REGEX.test(publicKey)) {
    throw new PaymentPolicyError(
      "NEXT_PUBLIC_WOMPI_PUBLIC_KEY debe tener prefijo Sandbox 'pub_test_' válido.",
      "INVALID_WOMPI_PUBLIC_KEY"
    );
  }

  const privateKey =
    typeof env.WOMPI_PRIVATE_KEY === "string" ? env.WOMPI_PRIVATE_KEY.trim() : "";
  if (!privateKey) {
    throw new PaymentPolicyError(
      "Falta configurar WOMPI_PRIVATE_KEY.",
      "MISSING_WOMPI_PRIVATE_KEY"
    );
  }
  if (privateKey.startsWith("prv_prod_")) {
    throw new PaymentPolicyError(
      "Credencial de producción rechazada en WOMPI_PRIVATE_KEY.",
      "PRODUCTION_CREDENTIAL_REJECTED"
    );
  }
  if (!SANDBOX_PRIVATE_KEY_REGEX.test(privateKey)) {
    throw new PaymentPolicyError(
      "WOMPI_PRIVATE_KEY debe tener prefijo Sandbox 'prv_test_' válido.",
      "INVALID_WOMPI_PRIVATE_KEY"
    );
  }

  const integritySecret =
    typeof env.WOMPI_INTEGRITY_SECRET === "string"
      ? env.WOMPI_INTEGRITY_SECRET.trim()
      : "";
  if (!integritySecret) {
    throw new PaymentPolicyError(
      "Falta configurar WOMPI_INTEGRITY_SECRET.",
      "MISSING_WOMPI_INTEGRITY_SECRET"
    );
  }
  if (integritySecret.startsWith("prod_integrity_")) {
    throw new PaymentPolicyError(
      "Secreto de integridad de producción rechazado en WOMPI_INTEGRITY_SECRET.",
      "PRODUCTION_CREDENTIAL_REJECTED"
    );
  }
  if (!SANDBOX_INTEGRITY_SECRET_REGEX.test(integritySecret)) {
    throw new PaymentPolicyError(
      "WOMPI_INTEGRITY_SECRET debe tener prefijo Sandbox 'test_integrity_' válido.",
      "INVALID_WOMPI_INTEGRITY_SECRET"
    );
  }

  const eventsSecret =
    typeof env.WOMPI_EVENTS_SECRET === "string"
      ? env.WOMPI_EVENTS_SECRET.trim()
      : "";
  if (!eventsSecret) {
    throw new PaymentPolicyError(
      "Falta configurar WOMPI_EVENTS_SECRET.",
      "MISSING_WOMPI_EVENTS_SECRET"
    );
  }
  if (eventsSecret.startsWith("prod_events_")) {
    throw new PaymentPolicyError(
      "Secreto de eventos de producción rechazado en WOMPI_EVENTS_SECRET.",
      "PRODUCTION_CREDENTIAL_REJECTED"
    );
  }
  if (!SANDBOX_EVENTS_SECRET_REGEX.test(eventsSecret)) {
    throw new PaymentPolicyError(
      "WOMPI_EVENTS_SECRET debe tener prefijo Sandbox 'test_events_' válido.",
      "INVALID_WOMPI_EVENTS_SECRET"
    );
  }

  const rawApiBaseUrl =
    typeof env.WOMPI_API_BASE_URL === "string"
      ? env.WOMPI_API_BASE_URL.trim()
      : "";
  const rawApiUrl =
    typeof env.WOMPI_API_URL === "string" ? env.WOMPI_API_URL.trim() : "";

  if (!rawApiBaseUrl && !rawApiUrl) {
    throw new PaymentPolicyError(
      "Debe configurarse explícitamente WOMPI_API_BASE_URL o WOMPI_API_URL apuntando a https://sandbox.wompi.co/v1 (sin fallback silencioso).",
      "MISSING_WOMPI_API_URL"
    );
  }

  const normalizeTrailingSlashes = (value: string) => value.replace(/\/+$/, "");
  const normalizedBaseUrl = rawApiBaseUrl
    ? normalizeTrailingSlashes(rawApiBaseUrl)
    : "";
  const normalizedApiUrl = rawApiUrl
    ? normalizeTrailingSlashes(rawApiUrl)
    : "";

  if (
    normalizedBaseUrl &&
    normalizedApiUrl &&
    normalizedBaseUrl !== normalizedApiUrl
  ) {
    throw new PaymentPolicyError(
      "Configuración contradictoria entre WOMPI_API_BASE_URL y WOMPI_API_URL.",
      "CONTRADICTORY_WOMPI_API_URL"
    );
  }

  const resolvedApiUrl = normalizedBaseUrl || normalizedApiUrl;
  if (resolvedApiUrl !== WOMPI_SANDBOX_API_BASE_URL) {
    throw new PaymentPolicyError(
      "El host de API de Wompi debe ser exclusivamente https://sandbox.wompi.co/v1.",
      "NON_SANDBOX_API_HOST"
    );
  }

  let minChargeableCopCents = DEFAULT_MIN_CHARGEABLE_COP_CENTS;
  const rawMinCents =
    typeof env.MINIMUM_CHARGEABLE_COP_CENTS === "string"
      ? env.MINIMUM_CHARGEABLE_COP_CENTS.trim()
      : "";
  if (rawMinCents) {
    if (!/^\d+$/.test(rawMinCents)) {
      throw new PaymentPolicyError(
        "MINIMUM_CHARGEABLE_COP_CENTS debe ser un entero positivo en centavos.",
        "INVALID_MIN_CHARGEABLE_AMOUNT"
      );
    }
    const parsedMin = BigInt(rawMinCents);
    if (
      parsedMin <= 0n ||
      parsedMin > MAX_WOMPI_AMOUNT_IN_CENTS ||
      parsedMin % WOMPI_CENTS_PER_COP_PESO !== 0n
    ) {
      throw new PaymentPolicyError(
        "MINIMUM_CHARGEABLE_COP_CENTS debe ser múltiplo positivo de 100 dentro del rango permitido.",
        "INVALID_MIN_CHARGEABLE_AMOUNT"
      );
    }
    minChargeableCopCents = parsedMin;
  }

  return {
    environment: "test",
    apiBaseUrl: WOMPI_SANDBOX_API_BASE_URL,
    checkoutUrl: WOMPI_WEB_CHECKOUT_URL,
    publicKey,
    privateKey,
    eventsSecret,
    integritySecret,
    minChargeableCopCents,
  };
}

// ============================================================================
// 5.3 UTILIDADES SHA-256 PURAS Y CÁLCULO DE CHECKSUM DE WOMPI
// ============================================================================

export function sha256Hex(input: string): string {
  if (typeof input !== "string") {
    throw new PaymentPolicyError(
      "La entrada para SHA-256 debe ser una cadena de texto.",
      "INVALID_HASH_INPUT"
    );
  }
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Calcula la firma de integridad SHA-256 requerida por el Widget/Checkout de Wompi:
 * SHA256("<Referencia><MontoEnCentavos><Moneda>[<FechaExpiracion>]<SecretoIntegridad>")
 */
export function buildWompiIntegritySignature(params: {
  reference: string;
  amountInCents: bigint | number | string;
  currency?: string;
  integritySecret: string;
  expirationTime?: string | null;
}): string {
  const cleanRef =
    typeof params.reference === "string" ? params.reference.trim() : "";
  if (
    !cleanRef ||
    cleanRef.length > MAX_WOMPI_REFERENCE_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(cleanRef)
  ) {
    throw new PaymentPolicyError(
      "La referencia para la firma de integridad es inválida.",
      "INVALID_REFERENCE"
    );
  }

  const validatedCents = validateChargeableWompiAmount(params.amountInCents);
  const currency = (params.currency ?? WOMPI_CURRENCY_COP).trim().toUpperCase();
  if (currency !== WOMPI_CURRENCY_COP) {
    throw new PaymentPolicyError(
      `Moneda no soportada para firma de integridad: "${currency}".`,
      "UNSUPPORTED_CURRENCY"
    );
  }

  const secret =
    typeof params.integritySecret === "string"
      ? params.integritySecret.trim()
      : "";
  if (!INTEGRITY_SECRET_REGEX.test(secret)) {
    throw new PaymentPolicyError(
      "El formato del secreto de integridad de Wompi no es válido.",
      "INVALID_INTEGRITY_SECRET"
    );
  }

  let expirationPart = "";
  if (params.expirationTime !== undefined && params.expirationTime !== null) {
    const cleanExp = String(params.expirationTime).trim();
    if (!cleanExp) {
      throw new PaymentPolicyError(
        "La fecha de expiración proporcionada está vacía.",
        "INVALID_EXPIRATION_TIME"
      );
    }
    expirationPart = cleanExp;
  }

  const concatenated = `${cleanRef}${validatedCents.toString()}${currency}${expirationPart}${secret}`;
  return sha256Hex(concatenated);
}

/**
 * Resuelve de forma segura una ruta de propiedad como "transaction.id" dentro de `data`,
 * respetando exactamente la ruta provista en `signature.properties` y bloqueando acceso
 * a prototipos.
 */
export function resolveSignedPropertyValue(
  data: unknown,
  propertyPath: string
): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PaymentPolicyError(
      "El objeto data del evento es inválido.",
      "INVALID_EVENT_DATA"
    );
  }

  if (typeof propertyPath !== "string" || propertyPath.trim() !== propertyPath) {
    throw new PaymentPolicyError(
      "La ruta de propiedad en signature.properties es inválida.",
      "INVALID_SIGNATURE_PROPERTY_PATH"
    );
  }

  const segments = propertyPath.split(".");
  if (segments.length < 1 || segments.length > 5) {
    throw new PaymentPolicyError(
      "La ruta en signature.properties tiene una profundidad inválida.",
      "INVALID_SIGNATURE_PROPERTY_PATH"
    );
  }

  let cursor: unknown = data;
  for (const segment of segments) {
    if (
      !segment ||
      FORBIDDEN_PATH_SEGMENTS.has(segment) ||
      !SAFE_PROPERTY_SEGMENT_REGEX.test(segment)
    ) {
      throw new PaymentPolicyError(
        "La ruta en signature.properties contiene un segmento no permitido.",
        "INVALID_SIGNATURE_PROPERTY_PATH"
      );
    }

    if (
      cursor === null ||
      typeof cursor !== "object" ||
      Array.isArray(cursor) ||
      !Object.prototype.hasOwnProperty.call(cursor, segment)
    ) {
      throw new PaymentPolicyError(
        `La propiedad firmada "${propertyPath}" no existe en data.`,
        "MISSING_SIGNED_PROPERTY"
      );
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (
    typeof cursor !== "string" &&
    typeof cursor !== "number" &&
    typeof cursor !== "boolean"
  ) {
    throw new PaymentPolicyError(
      `El valor de la propiedad firmada "${propertyPath}" no es un primitivo escalar válido.`,
      "INVALID_SIGNED_PROPERTY_VALUE"
    );
  }

  if (typeof cursor === "number" && !Number.isFinite(cursor)) {
    throw new PaymentPolicyError(
      `El valor numérico de "${propertyPath}" no es finito.`,
      "INVALID_SIGNED_PROPERTY_VALUE"
    );
  }

  return String(cursor);
}

/**
 * Calcula el checksum SHA-256 de un evento de Wompi siguiendo el orden exacto de
 * `signature.properties` + `timestamp` + `eventsSecret`.
 *
 * NOTA DE SEGURIDAD: El protocolo de Wompi solo incluye en este hash los valores de
 * `data` referenciados por `signature.properties` y el `timestamp`. No autentica los
 * campos raíz `event` ni `environment`.
 */
export function computeWompiEventChecksum(params: {
  data: unknown;
  signatureProperties: readonly string[];
  timestamp: number | string;
  eventsSecret: string;
}): {
  checksum: string;
  signedPropertyValues: Readonly<Record<string, string>>;
} {
  if (
    !Array.isArray(params.signatureProperties) ||
    params.signatureProperties.length === 0 ||
    params.signatureProperties.length > 32
  ) {
    throw new PaymentPolicyError(
      "signature.properties debe ser un arreglo no vacío de propiedades.",
      "INVALID_SIGNATURE_PROPERTIES"
    );
  }

  const secret =
    typeof params.eventsSecret === "string" ? params.eventsSecret.trim() : "";
  if (!EVENTS_SECRET_REGEX.test(secret)) {
    throw new PaymentPolicyError(
      "El secreto de eventos de Wompi no tiene un formato válido.",
      "INVALID_EVENTS_SECRET"
    );
  }

  let timestampStr: string;
  if (typeof params.timestamp === "number") {
    if (!Number.isSafeInteger(params.timestamp) || params.timestamp <= 0) {
      throw new PaymentPolicyError(
        "El timestamp del evento debe ser un entero positivo.",
        "INVALID_EVENT_TIMESTAMP"
      );
    }
    timestampStr = String(params.timestamp);
  } else if (typeof params.timestamp === "string") {
    const cleanTs = params.timestamp.trim();
    if (!/^\d+$/.test(cleanTs) || BigInt(cleanTs) <= 0n) {
      throw new PaymentPolicyError(
        "El timestamp del evento debe ser un entero positivo.",
        "INVALID_EVENT_TIMESTAMP"
      );
    }
    timestampStr = cleanTs;
  } else {
    throw new PaymentPolicyError(
      "El timestamp del evento es obligatorio.",
      "INVALID_EVENT_TIMESTAMP"
    );
  }

  const signedPropertyValues: Record<string, string> = {};
  const valueParts: string[] = [];

  for (const propPath of params.signatureProperties) {
    const extracted = resolveSignedPropertyValue(params.data, propPath);
    signedPropertyValues[propPath] = extracted;
    valueParts.push(extracted);
  }

  const concatenated = `${valueParts.join("")}${timestampStr}${secret}`;
  return {
    checksum: sha256Hex(concatenated),
    signedPropertyValues,
  };
}

export type ChecksumVerificationFailureReason =
  | "INVALID_PAYLOAD_STRUCTURE"
  | "INVALID_SIGNATURE_PROPERTIES"
  | "MISSING_SIGNED_PROPERTY"
  | "INVALID_SIGNED_PROPERTY_VALUE"
  | "INVALID_EVENT_TIMESTAMP"
  | "INVALID_CHECKSUM_FORMAT"
  | "HEADER_BODY_CHECKSUM_MISMATCH"
  | "CHECKSUM_MISMATCH"
  | "INVALID_EVENTS_SECRET";

export type ChecksumVerificationResult =
  | {
      valid: true;
      computedChecksum: string;
      timestamp: number;
      signedProperties: readonly string[];
      signedPropertyValues: Readonly<Record<string, string>>;
    }
  | {
      valid: false;
      reason: ChecksumVerificationFailureReason;
      message: string;
    };

export function constantTimeHexEquals(hexA: string, hexB: string): boolean {
  if (!SHA256_HEX_REGEX.test(hexA) || !SHA256_HEX_REGEX.test(hexB)) {
    return false;
  }
  const bufA = Buffer.from(hexA.toLowerCase(), "hex");
  const bufB = Buffer.from(hexB.toLowerCase(), "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const MAX_CANONICAL_WEBHOOK_TIMESTAMP = 9_999_999_999_999_999_999n;

/**
 * Normaliza un timestamp de evento Wompi a representación decimal base-10 canónica
 * sin ceros a la izquierda usando BigInt (prohibido Math.floor o truncamiento flotante).
 */
export function normalizeCanonicalTimestamp(rawTimestamp: unknown): string {
  if (typeof rawTimestamp === "bigint") {
    if (rawTimestamp <= 0n || rawTimestamp > MAX_CANONICAL_WEBHOOK_TIMESTAMP) {
      throw new PaymentPolicyError(
        "El timestamp canónico debe ser un entero positivo dentro del rango permitido.",
        "INVALID_EVENT_TIMESTAMP"
      );
    }
    return rawTimestamp.toString(10);
  }

  if (typeof rawTimestamp === "number") {
    if (
      !Number.isFinite(rawTimestamp) ||
      Object.is(rawTimestamp, -0) ||
      !Number.isSafeInteger(rawTimestamp) ||
      rawTimestamp <= 0
    ) {
      throw new PaymentPolicyError(
        "El timestamp numérico debe ser un entero seguro estrictamente positivo.",
        "INVALID_EVENT_TIMESTAMP"
      );
    }
    return BigInt(rawTimestamp).toString(10);
  }

  if (typeof rawTimestamp === "string") {
    const trimmed = rawTimestamp.trim();
    if (!/^\d{1,20}$/.test(trimmed)) {
      throw new PaymentPolicyError(
        "El timestamp en cadena debe contener únicamente dígitos decimales positivos.",
        "INVALID_EVENT_TIMESTAMP"
      );
    }
    const asBigInt = BigInt(trimmed);
    if (asBigInt <= 0n || asBigInt > MAX_CANONICAL_WEBHOOK_TIMESTAMP) {
      throw new PaymentPolicyError(
        "El timestamp canónico debe ser estrictamente mayor que cero.",
        "INVALID_EVENT_TIMESTAMP"
      );
    }
    return asBigInt.toString(10);
  }

  throw new PaymentPolicyError(
    "El tipo del timestamp para normalización canónica es inválido.",
    "INVALID_EVENT_TIMESTAMP"
  );
}

/**
 * Calcula la clave determinista SHA-256 de deduplicación de eventos webhook Wompi
 * (`EventoWebhookWompi.claveDeduplicacion`) a partir del ambiente esperado, tipo de evento,
 * timestamp normalizado en base-10 y checksum previamente verificado.
 */
export function computeWompiEventDeduplicationKey(params: {
  environment: "test";
  eventType: string;
  canonicalTimestamp: string | number | bigint;
  verifiedChecksum: string;
}): string {
  if (params.environment !== "test") {
    throw new PaymentPolicyError(
      "El ambiente para deduplicación de eventos debe ser exclusivamente 'test'.",
      "NON_SANDBOX_ENVIRONMENT"
    );
  }

  const cleanEvent =
    typeof params.eventType === "string"
      ? params.eventType.trim().toLowerCase()
      : "";
  if (!cleanEvent || !/^[a-z0-9._-]{3,80}$/.test(cleanEvent)) {
    throw new PaymentPolicyError(
      "El tipo de evento para deduplicación es inválido.",
      "INVALID_EVENT_TYPE"
    );
  }

  const normalizedTs = normalizeCanonicalTimestamp(params.canonicalTimestamp);

  const cleanChecksum =
    typeof params.verifiedChecksum === "string"
      ? params.verifiedChecksum.trim().toLowerCase()
      : "";
  if (!SHA256_HEX_REGEX.test(cleanChecksum)) {
    throw new PaymentPolicyError(
      "El checksum verificado debe ser un hash SHA-256 hexadecimal válido.",
      "INVALID_CHECKSUM_FORMAT"
    );
  }

  return sha256Hex(
    `wompi-event-v1|${params.environment}|${cleanEvent}|${normalizedTs}|${cleanChecksum}`
  );
}

/**
 * Verifica criptográficamente el checksum de un payload de evento de Wompi usando
 * exclusivamente el `eventsSecret` del servidor (nunca seleccionado por `payload.environment`).
 *
 * Esta función acredita únicamente que los campos listados en `signature.properties` y
 * `timestamp` fueron firmados con `eventsSecret`. NO valida reglas de negocio ni acredita
 * los campos raíz no firmados `event` o `environment`.
 */
export function verifyWompiEventChecksum(params: {
  payload: unknown;
  eventsSecret: string;
  headerChecksum?: string | null;
}): ChecksumVerificationResult {
  if (
    !params.payload ||
    typeof params.payload !== "object" ||
    Array.isArray(params.payload)
  ) {
    return {
      valid: false,
      reason: "INVALID_PAYLOAD_STRUCTURE",
      message: "El cuerpo del evento no es un objeto válido.",
    };
  }

  const body = params.payload as Record<string, unknown>;
  const signatureObj = body.signature;
  if (
    !signatureObj ||
    typeof signatureObj !== "object" ||
    Array.isArray(signatureObj)
  ) {
    return {
      valid: false,
      reason: "INVALID_PAYLOAD_STRUCTURE",
      message: "El evento no contiene un bloque signature válido.",
    };
  }

  const sig = signatureObj as Record<string, unknown>;
  const rawBodyChecksum =
    typeof sig.checksum === "string" ? sig.checksum.trim() : "";
  if (!SHA256_HEX_REGEX.test(rawBodyChecksum)) {
    return {
      valid: false,
      reason: "INVALID_CHECKSUM_FORMAT",
      message: "signature.checksum no es un hash SHA-256 hexadecimal válido.",
    };
  }

  if (
    params.headerChecksum !== undefined &&
    params.headerChecksum !== null &&
    params.headerChecksum.trim() !== ""
  ) {
    const cleanHeader = params.headerChecksum.trim();
    if (!SHA256_HEX_REGEX.test(cleanHeader)) {
      return {
        valid: false,
        reason: "INVALID_CHECKSUM_FORMAT",
        message: "El encabezado X-Event-Checksum no tiene un formato SHA-256 válido.",
      };
    }
    if (!constantTimeHexEquals(cleanHeader, rawBodyChecksum)) {
      return {
        valid: false,
        reason: "HEADER_BODY_CHECKSUM_MISMATCH",
        message: "El encabezado X-Event-Checksum no coincide con signature.checksum.",
      };
    }
  }

  const rawProps = sig.properties;
  if (
    !Array.isArray(rawProps) ||
    rawProps.length === 0 ||
    !rawProps.every((p) => typeof p === "string")
  ) {
    return {
      valid: false,
      reason: "INVALID_SIGNATURE_PROPERTIES",
      message: "signature.properties debe ser una lista no vacía de cadenas.",
    };
  }

  const rawTs = body.timestamp;
  let parsedTimestamp: number;
  if (typeof rawTs === "number" && Number.isSafeInteger(rawTs) && rawTs > 0) {
    parsedTimestamp = rawTs;
  } else if (typeof rawTs === "string" && /^\d+$/.test(rawTs.trim())) {
    const num = Number(rawTs.trim());
    if (!Number.isSafeInteger(num) || num <= 0) {
      return {
        valid: false,
        reason: "INVALID_EVENT_TIMESTAMP",
        message: "El timestamp del evento no es un entero seguro positivo.",
      };
    }
    parsedTimestamp = num;
  } else {
    return {
      valid: false,
      reason: "INVALID_EVENT_TIMESTAMP",
      message: "El timestamp del evento es inválido o está ausente.",
    };
  }

  try {
    const { checksum, signedPropertyValues } = computeWompiEventChecksum({
      data: body.data,
      signatureProperties: rawProps as string[],
      timestamp: parsedTimestamp,
      eventsSecret: params.eventsSecret,
    });

    if (!constantTimeHexEquals(checksum, rawBodyChecksum)) {
      return {
        valid: false,
        reason: "CHECKSUM_MISMATCH",
        message: "El checksum calculado no coincide con la firma del evento.",
      };
    }

    return {
      valid: true,
      computedChecksum: checksum,
      timestamp: parsedTimestamp,
      signedProperties: [...(rawProps as string[])],
      signedPropertyValues,
    };
  } catch (err) {
    if (err instanceof PaymentPolicyError) {
      const mappedReason: ChecksumVerificationFailureReason =
        err.code === "MISSING_SIGNED_PROPERTY"
          ? "MISSING_SIGNED_PROPERTY"
          : err.code === "INVALID_SIGNED_PROPERTY_VALUE"
          ? "INVALID_SIGNED_PROPERTY_VALUE"
          : err.code === "INVALID_EVENTS_SECRET"
          ? "INVALID_EVENTS_SECRET"
          : err.code === "INVALID_EVENT_TIMESTAMP"
          ? "INVALID_EVENT_TIMESTAMP"
          : "INVALID_SIGNATURE_PROPERTIES";
      return {
        valid: false,
        reason: mappedReason,
        message: err.message,
      };
    }
    throw err;
  }
}

// ============================================================================
// 5.4 GENERACIÓN DE REFERENCIAS (UUIDv4 CON 122 BITS ALEATORIOS)
// ============================================================================

/**
 * Genera una referencia para un intento de pago en Wompi.
 *
 * NOTA TÉCNICA SOBRE ENTROPÍA Y UNICIDAD:
 * - Si se emplea un UUIDv4 estándar (RFC 9562 / RFC 4122), este contiene exactamente
 *   122 bits aleatorios (4 bits están fijos para la versión 4 y 2 bits para la variante).
 * - Por tanto, una colisión accidental es altamente improbable pero NO matemáticamente
 *   imposible. La garantía real de unicidad reside en la restricción `@unique` de
 *   PostgreSQL sobre `IntentoPagoWompi.referenciaWompi`.
 */
export function generateWompiReference(params: {
  orderNumber: string;
  attemptSequence: number;
  attemptId?: string;
}): string {
  const cleanOrder =
    typeof params.orderNumber === "string"
      ? params.orderNumber.trim().toUpperCase()
      : "";
  if (!cleanOrder || !/^[A-Z0-9-]{4,32}$/.test(cleanOrder)) {
    throw new PaymentPolicyError(
      "El número de orden para generar la referencia de Wompi es inválido.",
      "INVALID_ORDER_NUMBER"
    );
  }

  if (
    typeof params.attemptSequence !== "number" ||
    !Number.isSafeInteger(params.attemptSequence) ||
    params.attemptSequence < 1 ||
    params.attemptSequence > 9_999
  ) {
    throw new PaymentPolicyError(
      "El número de secuencia del intento debe ser un entero positivo entre 1 y 9999.",
      "INVALID_ATTEMPT_SEQUENCE"
    );
  }

  const rawUuid =
    params.attemptId !== undefined ? params.attemptId.trim() : randomUUID();
  if (!UUID_V4_OR_RFC_REGEX.test(rawUuid)) {
    throw new PaymentPolicyError(
      "El identificador del intento (attemptId) debe ser un UUID válido.",
      "INVALID_ATTEMPT_ID"
    );
  }

  const compactUuid = rawUuid.replace(/-/g, "").toUpperCase();
  const reference = `BMA-${cleanOrder}-A${params.attemptSequence}-${compactUuid}`;

  if (reference.length > MAX_WOMPI_REFERENCE_LENGTH) {
    throw new PaymentPolicyError(
      `La referencia generada supera el límite de ${MAX_WOMPI_REFERENCE_LENGTH} caracteres.`,
      "REFERENCE_TOO_LONG"
    );
  }

  return reference;
}

// ============================================================================
// 5.5 SANITIZACIÓN DE DATOS Y REDACCIÓN DE CREDENCIALES / PII
// ============================================================================

export interface SanitizedWompiTransactionSnapshot {
  id: string;
  reference: string;
  status: string;
  statusMessage: string | null;
  amountInCents: string;
  currency: string;
  paymentMethodType: string | null;
  createdAt: string | null;
  finalizedAt: string | null;
  observedAt: string;
}

/**
 * Redacta llaves privadas, secretos de Wompi, tokens Bearer, correos y secuencias
 * de dígitos de tarjeta que pudieran aparecer en cadenas de texto o mensajes de error.
 */
export function redactSensitivePaymentStrings(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  return input
    .replace(/\bprv_(test|prod)_[A-Za-z0-9_]+\b/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bpub_(test|prod)_[A-Za-z0-9_]+\b/gi, "[REDACTED_PUBLIC_KEY]")
    .replace(/\btok_(test|prod)_[A-Za-z0-9_]+\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b(test|prod)_events_[A-Za-z0-9_]+\b/gi, "[REDACTED_EVENTS_SECRET]")
    .replace(
      /\b(test|prod)_integrity_[A-Za-z0-9_]+\b/gi,
      "[REDACTED_INTEGRITY_SECRET]"
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      "[REDACTED_EMAIL]"
    )
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_PAN]")
    .replace(/\b(?:\+?57[\s-]?)?3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, "[REDACTED_PHONE]");
}

function normalizeIsoTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/**
 * Extrae exclusivamente los metadatos técnicos necesarios de una transacción de Wompi,
 * descartando cualquier credencial, token, PII del pagador (`customer_data`, `billing_data`,
 * `customer_email`, `phone_number`, `legal_id`), datos de tarjeta y objetos anidados no requeridos.
 */
export function sanitizeWompiTransactionSnapshot(
  raw: unknown,
  observedAtInput?: string | Date
): SanitizedWompiTransactionSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PaymentPolicyError(
      "El objeto de transacción a sanitizar es inválido.",
      "INVALID_TRANSACTION_SNAPSHOT"
    );
  }

  // Permite recibir tanto `{ data: { ... } }` como el objeto de transacción directo
  const root = raw as Record<string, unknown>;
  const txObj =
    root.data &&
    typeof root.data === "object" &&
    !Array.isArray(root.data) &&
    typeof (root.data as Record<string, unknown>).id === "string"
      ? (root.data as Record<string, unknown>)
      : root;

  const id = typeof txObj.id === "string" ? txObj.id.trim() : "";
  if (!id || id.length > 100 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new PaymentPolicyError(
      "El identificador de la transacción de Wompi es inválido o está ausente.",
      "INVALID_TRANSACTION_ID"
    );
  }

  const reference =
    typeof txObj.reference === "string" ? txObj.reference.trim() : "";
  if (!reference || reference.length > MAX_WOMPI_REFERENCE_LENGTH) {
    throw new PaymentPolicyError(
      "La referencia de la transacción de Wompi es inválida o está ausente.",
      "INVALID_TRANSACTION_REFERENCE"
    );
  }

  const status =
    typeof txObj.status === "string" ? txObj.status.trim().toUpperCase() : "";
  if (!status || !/^[A-Z_]{2,30}$/.test(status)) {
    throw new PaymentPolicyError(
      "El estado de la transacción de Wompi es inválido o está ausente.",
      "INVALID_TRANSACTION_STATUS"
    );
  }

  const rawAmount = txObj.amount_in_cents ?? txObj.amountInCents;
  let amountInCentsStr: string;
  if (typeof rawAmount === "bigint") {
    if (rawAmount < 0n) {
      throw new PaymentPolicyError(
        "amount_in_cents no puede ser negativo.",
        "INVALID_TRANSACTION_AMOUNT"
      );
    }
    amountInCentsStr = rawAmount.toString();
  } else if (typeof rawAmount === "number") {
    if (!Number.isSafeInteger(rawAmount) || rawAmount < 0) {
      throw new PaymentPolicyError(
        "amount_in_cents debe ser un entero seguro no negativo.",
        "INVALID_TRANSACTION_AMOUNT"
      );
    }
    amountInCentsStr = String(rawAmount);
  } else if (typeof rawAmount === "string" && /^\d+$/.test(rawAmount.trim())) {
    amountInCentsStr = BigInt(rawAmount.trim()).toString();
  } else {
    throw new PaymentPolicyError(
      "amount_in_cents es inválido o está ausente en la transacción.",
      "INVALID_TRANSACTION_AMOUNT"
    );
  }

  const currency =
    typeof txObj.currency === "string"
      ? txObj.currency.trim().toUpperCase()
      : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PaymentPolicyError(
      "La moneda de la transacción es inválida.",
      "INVALID_TRANSACTION_CURRENCY"
    );
  }

  const rawPaymentMethodType =
    txObj.payment_method_type ?? txObj.paymentMethodType;
  const paymentMethodType =
    typeof rawPaymentMethodType === "string" &&
    rawPaymentMethodType.trim().length > 0
      ? rawPaymentMethodType.trim().toUpperCase().slice(0, 50)
      : null;

  const rawStatusMessage = txObj.status_message ?? txObj.statusMessage;
  const statusMessage =
    typeof rawStatusMessage === "string" && rawStatusMessage.trim().length > 0
      ? redactSensitivePaymentStrings(rawStatusMessage.trim()).slice(0, 200)
      : null;

  const createdAt = normalizeIsoTimestampOrNull(
    txObj.created_at ?? txObj.createdAt
  );
  const finalizedAt = normalizeIsoTimestampOrNull(
    txObj.finalized_at ?? txObj.finalizedAt
  );

  let observedAt: string;
  if (observedAtInput instanceof Date) {
    if (Number.isNaN(observedAtInput.getTime())) {
      throw new PaymentPolicyError(
        "observedAt no es una fecha válida.",
        "INVALID_OBSERVED_AT"
      );
    }
    observedAt = observedAtInput.toISOString();
  } else if (typeof observedAtInput === "string") {
    const normalized = normalizeIsoTimestampOrNull(observedAtInput);
    if (!normalized) {
      throw new PaymentPolicyError(
        "observedAt no tiene un formato ISO-8601 válido.",
        "INVALID_OBSERVED_AT"
      );
    }
    observedAt = normalized;
  } else {
    observedAt = new Date().toISOString();
  }

  return {
    id,
    reference,
    status,
    statusMessage,
    amountInCents: amountInCentsStr,
    currency,
    paymentMethodType,
    createdAt,
    finalizedAt,
    observedAt,
  };
}

// ============================================================================
// 5.6 COMBINACIÓN DETERMINISTA Y PURA DE OBSERVACIONES
// ============================================================================

export interface CombinedObservationsEnvelope {
  schemaVersion: 1;
  observations: readonly SanitizedWompiTransactionSnapshot[];
  latestByTransactionId: Readonly<
    Record<string, SanitizedWompiTransactionSnapshot>
  >;
}

function getEffectiveObservationTimestampMs(
  snap: SanitizedWompiTransactionSnapshot
): number {
  for (const candidate of [snap.finalizedAt, snap.createdAt, snap.observedAt]) {
    if (candidate) {
      const ms = Date.parse(candidate);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return 0;
}

function compareObservationsChronologically(
  a: SanitizedWompiTransactionSnapshot,
  b: SanitizedWompiTransactionSnapshot
): number {
  const timeA = getEffectiveObservationTimestampMs(a);
  const timeB = getEffectiveObservationTimestampMs(b);
  if (timeA !== timeB) return timeA - timeB;

  const obsA = Date.parse(a.observedAt) || 0;
  const obsB = Date.parse(b.observedAt) || 0;
  if (obsA !== obsB) return obsA - obsB;

  if (a.id !== b.id) return a.id.localeCompare(b.id);
  if (a.status !== b.status) return a.status.localeCompare(b.status);
  return a.amountInCents.localeCompare(b.amountInCents);
}

function isSameObservationContent(
  a: SanitizedWompiTransactionSnapshot,
  b: SanitizedWompiTransactionSnapshot
): boolean {
  return (
    a.id === b.id &&
    a.reference === b.reference &&
    a.status === b.status &&
    a.amountInCents === b.amountInCents &&
    a.currency === b.currency &&
    a.paymentMethodType === b.paymentMethodType &&
    a.createdAt === b.createdAt &&
    a.finalizedAt === b.finalizedAt &&
    a.statusMessage === b.statusMessage
  );
}

/**
 * Combina de forma determinista y pura un conjunto previo de observaciones con una
 * o más observaciones nuevas ya sanitizadas.
 *
 * Esta función:
 *  - NO implementa matrices de transición de estados.
 *  - NO decide si un pago está aprobado ni autoriza capturas.
 *  - NO modifica estados financieros locales ni ejecuta persistencia.
 */
export function combineTransactionObservations(
  existingEnvelope: unknown,
  newObservations:
    | SanitizedWompiTransactionSnapshot
    | readonly SanitizedWompiTransactionSnapshot[]
): CombinedObservationsEnvelope {
  const collected: SanitizedWompiTransactionSnapshot[] = [];

  if (existingEnvelope !== null && existingEnvelope !== undefined) {
    let parsed: unknown = existingEnvelope;
    if (typeof existingEnvelope === "string") {
      const trimmed = existingEnvelope.trim();
      if (trimmed.length > 0) {
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          throw new PaymentPolicyError(
            "El sobre de observaciones existente no es un JSON válido.",
            "INVALID_OBSERVATIONS_ENVELOPE"
          );
        }
      } else {
        parsed = null;
      }
    }

    if (parsed !== null && parsed !== undefined) {
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new PaymentPolicyError(
          "El sobre de observaciones existente debe ser un objeto.",
          "INVALID_OBSERVATIONS_ENVELOPE"
        );
      }
      const record = parsed as Record<string, unknown>;
      if (record.observations !== undefined) {
        if (!Array.isArray(record.observations)) {
          throw new PaymentPolicyError(
            "El campo observations del sobre existente debe ser un arreglo.",
            "INVALID_OBSERVATIONS_ENVELOPE"
          );
        }
        for (const item of record.observations) {
          const itemObj =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : null;
          collected.push(
            sanitizeWompiTransactionSnapshot(
              item,
              typeof itemObj?.observedAt === "string"
                ? itemObj.observedAt
                : undefined
            )
          );
        }
      }
    }
  }

  const incomingList = Array.isArray(newObservations)
    ? newObservations
    : [newObservations];

  for (const incoming of incomingList) {
    const incomingObj =
      incoming && typeof incoming === "object"
        ? (incoming as unknown as Record<string, unknown>)
        : null;
    const sanitized = sanitizeWompiTransactionSnapshot(
      incoming,
      typeof incomingObj?.observedAt === "string"
        ? incomingObj.observedAt
        : undefined
    );
    collected.push(sanitized);
  }

  const sorted = [...collected].sort(compareObservationsChronologically);
  const deduplicated: SanitizedWompiTransactionSnapshot[] = [];

  for (const item of sorted) {
    const duplicate = deduplicated.find((prev) =>
      isSameObservationContent(prev, item)
    );
    if (!duplicate) {
      deduplicated.push(item);
    }
  }

  const latestByTransactionId: Record<
    string,
    SanitizedWompiTransactionSnapshot
  > = {};
  for (const item of deduplicated) {
    latestByTransactionId[item.id] = item;
  }

  return {
    schemaVersion: 1,
    observations: deduplicated,
    latestByTransactionId,
  };
}

// ============================================================================
// 6. STEP 2B — SERIALIZACIÓN SEGURA, CONTROL ENVELOPE Y MATRICES DE TRANSICIÓN
// ============================================================================

export const NATIVE_RETRY_WINDOW_SECONDS = 180;
export const DEFAULT_RECONCILIATION_LEASE_TTL_MS = 120_000;

export type WompiRemoteTransactionStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "ERROR"
  | "VOIDED";

export type LocalPaymentIntentStatus =
  | "PENDIENTE"
  | "PENDIENTE_CONCILIACION"
  | "APROBADO"
  | "RECHAZADO"
  | "ANULADO"
  | "FALLIDO";

export type OrderPaymentStatus =
  | "PENDIENTE"
  | "PREAUTORIZADO"
  | "CAPTURADO"
  | "LIBERADO"
  | "REEMBOLSADO"
  | "ANULADO"
  | "FALLIDO";

export type OrderOperationalStatus =
  | "BUSCANDO"
  | "ASIGNADO"
  | "EN_CAMINO"
  | "EN_SITIO"
  | "EN_TRABAJO"
  | "EN_PROGRESO"
  | "ESPERANDO_APROBACION_COSTO_EXTRA"
  | "FINALIZADO"
  | "COMPLETADO"
  | "CANCELADO"
  | "DISPUTA";

export type RefundRecordStatus = "SOLICITADO" | "PROCESADO" | "FALLIDO";

export type FinancialIncidentStatus =
  | "REQUIERE_AUTORIZACION_HU26"
  | "RESUELTO_REEMBOLSO_COMPLETADO"
  | "RESUELTO_ANOMALIA_APROBADA_SIN_REEMBOLSO";

export type FinancialIncidentCode =
  | "COBRO_TARDIO_ORDEN_CANCELADA"
  | "ANULACION_PASARELA_PRE_ASIGNACION"
  | "ANULACION_PASARELA_POST_APROBACION"
  | "ANOMALIA_TRANSICION_PASARELA"
  | "ANOMALIA_REINTENTO_APROBADO_FUERA_DE_VENTANA_MISMA_REFERENCIA"
  | "ANOMALIA_REINTENTO_FUERA_DE_VENTANA_MISMA_REFERENCIA"
  | "ANOMALIA_REINTENTO_TRAS_ERROR_MISMA_REFERENCIA"
  | "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION"
  | "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION_MISMA_REFERENCIA"
  | "ANOMALIA_VOIDED_CON_TRANSACCION_PENDIENTE_MISMA_REFERENCIA"
  | "DOBLE_COBRO_PRE_CONSOLIDACION"
  | "DOBLE_COBRO_POST_CONSOLIDACION"
  | "DOBLE_COBRO_DISTINTOS_INTENTOS_MISMA_ORDEN"
  | "APROBACION_CON_TRANSACCION_PARALELA_PENDIENTE";

const SENSITIVE_OBJECT_KEY_REGEX =
  /^(cvc|cvv|card_number|pan|private_key|events_secret|integrity_secret|password|token|acceptance_token|authorization|authorization_header|customer_email|phone_number|legal_id)$/i;

/**
 * Serializa de forma defensiva cualquier valor `unknown`, soportando `BigInt`,
 * detectando únicamente referencias circulares reales mediante pila DFS (`ancestorStack`)
 * sin falsos positivos en grafos acíclicos con referencias compartidas (DAG),
 * redactando patrones sensibles y truncando por puntos de código Unicode a `maxLength`
 * (por defecto 255 para `ReembolsoTransaccion.errorDetalle VarChar(255)`).
 */
export function safeTruncateErrorDetail(
  input: unknown,
  maxLength = 255
): string | null {
  if (input === null || input === undefined) return null;
  if (!Number.isSafeInteger(maxLength) || maxLength <= 0) {
    throw new PaymentPolicyError(
      "maxLength debe ser un entero positivo.",
      "INVALID_MAX_LENGTH"
    );
  }

  let rawString: string;

  if (typeof input === "string") {
    rawString = input;
  } else if (input instanceof Error) {
    rawString = `${input.name}: ${input.message}`;
  } else {
    const ancestorStack: unknown[] = [];

    function sanitizeRecursive(value: unknown): unknown {
      if (value === null || value === undefined) return value;
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : String(value);
      }
      if (typeof value === "string") {
        return redactSensitivePaymentStrings(value);
      }
      if (typeof value !== "object") {
        return String(value);
      }

      if (ancestorStack.includes(value)) {
        return "[Circular]";
      }

      ancestorStack.push(value);
      try {
        if (Array.isArray(value)) {
          return value.map(sanitizeRecursive);
        }
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(
          value as Record<string, unknown>
        )) {
          if (SENSITIVE_OBJECT_KEY_REGEX.test(key)) {
            out[key] = "[REDACTED]";
          } else {
            out[key] = sanitizeRecursive(val);
          }
        }
        return out;
      } finally {
        ancestorStack.pop();
      }
    }

    try {
      const serialized = JSON.stringify(sanitizeRecursive(input));
      rawString =
        serialized && serialized !== "undefined" ? serialized : String(input);
    } catch {
      rawString = Object.prototype.toString.call(input);
    }
  }

  const withoutControlChars = rawString
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const redacted = redactSensitivePaymentStrings(withoutControlChars).trim();
  if (!redacted) return null;

  return Array.from(redacted).slice(0, maxLength).join("");
}

// ============================================================================
// 6.1 CONTROL ENVELOPE CANÓNICO Y PROTOCOLO DE LEASE / VERSIONADO (H-01, H-12, H-17..H-21)
// ============================================================================

export interface ReconciliationLease {
  workerRunId: string;
  fencingToken: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface PollingMetadata {
  pollCount: number;
  nextPollAfter: string | null;
  lastPolledAt: string | null;
}

export interface ApprovalSequenceEntry {
  transactionId: string;
  sequenceNumber: number;
  wompiReference: string;
  recordedAt: string;
}

export interface FinancialIncidentRecord {
  id: string;
  code: FinancialIncidentCode;
  status: FinancialIncidentStatus;
  primaryTransactionId: string | null;
  secondaryTransactionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ControlEnvelope {
  schemaVersion: 1;
  lastFencingToken: number;
  financialStateVersion: number;
  reconciliationLease: ReconciliationLease | null;
  pollingMetadata: PollingMetadata;
  latestStatusByTransactionId: Readonly<
    Record<string, WompiRemoteTransactionStatus>
  >;
  observations: readonly SanitizedWompiTransactionSnapshot[];
  approvalsSequence: readonly ApprovalSequenceEntry[];
  financialIncidents: readonly FinancialIncidentRecord[];
}

function parseCanonicalDbTimeMs(dbNow: Date | string): number {
  const ms = dbNow instanceof Date ? dbNow.getTime() : Date.parse(dbNow);
  if (Number.isNaN(ms)) {
    throw new PaymentPolicyError(
      "La marca de tiempo de referencia de base de datos (dbNow) es inválida.",
      "INVALID_DB_TIMESTAMP"
    );
  }
  return ms;
}

/**
 * Parsea o inicializa el `ControlEnvelope` canónico que reside exclusivamente en
 * el intento coordinador de la orden (`ORDER BY "creadoEn" ASC, "id" ASC LIMIT 1`).
 */
export function parseControlEnvelope(rawJson: unknown): ControlEnvelope {
  const empty: ControlEnvelope = {
    schemaVersion: 1,
    lastFencingToken: 0,
    financialStateVersion: 1,
    reconciliationLease: null,
    pollingMetadata: {
      pollCount: 0,
      nextPollAfter: null,
      lastPolledAt: null,
    },
    latestStatusByTransactionId: {},
    observations: [],
    approvalsSequence: [],
    financialIncidents: [],
  };

  if (rawJson === null || rawJson === undefined || rawJson === "") {
    return empty;
  }

  let parsed: unknown = rawJson;
  if (typeof rawJson === "string") {
    const trimmed = rawJson.trim();
    if (!trimmed) return empty;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new PaymentPolicyError(
        "El ControlEnvelope almacenado no es un JSON válido.",
        "INVALID_CONTROL_ENVELOPE"
      );
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PaymentPolicyError(
      "El ControlEnvelope debe ser un objeto JSON.",
      "INVALID_CONTROL_ENVELOPE"
    );
  }

  const obj = parsed as Record<string, unknown>;
  const combinedObs = combineTransactionObservations(
    obj.observations ? { observations: obj.observations } : null,
    []
  );

  const lastFencingToken =
    typeof obj.lastFencingToken === "number" &&
    Number.isSafeInteger(obj.lastFencingToken) &&
    obj.lastFencingToken >= 0
      ? obj.lastFencingToken
      : 0;

  const financialStateVersion =
    typeof obj.financialStateVersion === "number" &&
    Number.isSafeInteger(obj.financialStateVersion) &&
    obj.financialStateVersion >= 1
      ? obj.financialStateVersion
      : 1;

  let reconciliationLease: ReconciliationLease | null = null;
  if (
    obj.reconciliationLease &&
    typeof obj.reconciliationLease === "object" &&
    !Array.isArray(obj.reconciliationLease)
  ) {
    const l = obj.reconciliationLease as Record<string, unknown>;
    if (
      typeof l.workerRunId === "string" &&
      l.workerRunId.trim().length > 0 &&
      typeof l.fencingToken === "number" &&
      Number.isSafeInteger(l.fencingToken) &&
      l.fencingToken >= 1 &&
      typeof l.acquiredAt === "string" &&
      typeof l.expiresAt === "string" &&
      !Number.isNaN(Date.parse(l.expiresAt))
    ) {
      reconciliationLease = {
        workerRunId: l.workerRunId.trim(),
        fencingToken: l.fencingToken,
        acquiredAt: new Date(Date.parse(l.acquiredAt)).toISOString(),
        expiresAt: new Date(Date.parse(l.expiresAt)).toISOString(),
      };
    }
  }

  let pollingMetadata: PollingMetadata = {
    pollCount: 0,
    nextPollAfter: null,
    lastPolledAt: null,
  };
  if (
    obj.pollingMetadata &&
    typeof obj.pollingMetadata === "object" &&
    !Array.isArray(obj.pollingMetadata)
  ) {
    const pm = obj.pollingMetadata as Record<string, unknown>;
    const pollCount =
      typeof pm.pollCount === "number" &&
      Number.isSafeInteger(pm.pollCount) &&
      pm.pollCount >= 0
        ? pm.pollCount
        : 0;
    const nextPollAfter = normalizeIsoTimestampOrNull(pm.nextPollAfter);
    const lastPolledAt = normalizeIsoTimestampOrNull(pm.lastPolledAt);
    pollingMetadata = { pollCount, nextPollAfter, lastPolledAt };
  }

  const latestStatusByTransactionId: Record<
    string,
    WompiRemoteTransactionStatus
  > = {};
  for (const [txId, snap] of Object.entries(
    combinedObs.latestByTransactionId
  )) {
    if (
      snap.status === "PENDING" ||
      snap.status === "APPROVED" ||
      snap.status === "DECLINED" ||
      snap.status === "ERROR" ||
      snap.status === "VOIDED"
    ) {
      latestStatusByTransactionId[txId] = snap.status;
    }
  }
  if (
    obj.latestStatusByTransactionId &&
    typeof obj.latestStatusByTransactionId === "object" &&
    !Array.isArray(obj.latestStatusByTransactionId)
  ) {
    for (const [txId, st] of Object.entries(
      obj.latestStatusByTransactionId as Record<string, unknown>
    )) {
      if (
        st === "PENDING" ||
        st === "APPROVED" ||
        st === "DECLINED" ||
        st === "ERROR" ||
        st === "VOIDED"
      ) {
        latestStatusByTransactionId[txId] = st;
      }
    }
  }

  const approvalsSequence: ApprovalSequenceEntry[] = [];
  if (Array.isArray(obj.approvalsSequence)) {
    for (const entry of obj.approvalsSequence) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const e = entry as Record<string, unknown>;
        if (
          typeof e.transactionId === "string" &&
          typeof e.sequenceNumber === "number" &&
          Number.isSafeInteger(e.sequenceNumber) &&
          typeof e.wompiReference === "string" &&
          typeof e.recordedAt === "string"
        ) {
          approvalsSequence.push({
            transactionId: e.transactionId,
            sequenceNumber: e.sequenceNumber,
            wompiReference: e.wompiReference,
            recordedAt: e.recordedAt,
          });
        }
      }
    }
  }

  const financialIncidents: FinancialIncidentRecord[] = [];
  if (Array.isArray(obj.financialIncidents)) {
    for (const inc of obj.financialIncidents) {
      if (inc && typeof inc === "object" && !Array.isArray(inc)) {
        const i = inc as Record<string, unknown>;
        if (
          typeof i.id === "string" &&
          typeof i.code === "string" &&
          typeof i.status === "string" &&
          typeof i.createdAt === "string"
        ) {
          financialIncidents.push({
            id: i.id,
            code: i.code as FinancialIncidentCode,
            status: i.status as FinancialIncidentStatus,
            primaryTransactionId:
              typeof i.primaryTransactionId === "string"
                ? i.primaryTransactionId
                : null,
            secondaryTransactionId:
              typeof i.secondaryTransactionId === "string"
                ? i.secondaryTransactionId
                : null,
            createdAt: i.createdAt,
            resolvedAt: typeof i.resolvedAt === "string" ? i.resolvedAt : null,
          });
        }
      }
    }
  }

  return {
    schemaVersion: 1,
    lastFencingToken,
    financialStateVersion,
    reconciliationLease,
    pollingMetadata,
    latestStatusByTransactionId,
    observations: combinedObs.observations,
    approvalsSequence,
    financialIncidents,
  };
}

/**
 * Selecciona de forma determinista el intento coordinador de una orden entre los
 * intentos previamente bloqueados en orden `id ASC` (Jerarquía E.2), eligiendo
 * por `"creadoEn" ASC, "id" ASC`.
 */
export function selectCoordinatorAttempt<
  T extends { id: string; creadoEn: Date | string }
>(lockedAttempts: readonly T[]): T {
  if (!Array.isArray(lockedAttempts) || lockedAttempts.length === 0) {
    throw new PaymentPolicyError(
      "No existen intentos de pago para seleccionar el intento coordinador.",
      "EMPTY_PAYMENT_ATTEMPTS"
    );
  }
  return [...lockedAttempts].sort((a, b) => {
    const timeA =
      a.creadoEn instanceof Date ? a.creadoEn.getTime() : Date.parse(a.creadoEn);
    const timeB =
      b.creadoEn instanceof Date ? b.creadoEn.getTime() : Date.parse(b.creadoEn);
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
  })[0];
}

export type LeaseClaimResult =
  | {
      status: "CLAIMED";
      fencingToken: number;
      financialStateVersion: number;
      lease: ReconciliationLease;
      envelope: ControlEnvelope;
    }
  | {
      status: "ACTIVE_LEASE";
      activeLease: ReconciliationLease;
      envelope: ControlEnvelope;
    }
  | {
      status: "COOLDOWN";
      nextPollAfter: string;
      envelope: ControlEnvelope;
    };

/**
 * Evalúa y reclama atómicamente el lease de reconciliación sobre el `ControlEnvelope`
 * del intento coordinador utilizando exclusivamente el reloj de PostgreSQL (`dbNow`).
 *
 * - Si existe un lease vigente (`expiresAt > dbNow`), retorna `ACTIVE_LEASE` sin incrementar `lastFencingToken`.
 * - Si está en enfriamiento (`nextPollAfter > dbNow`), retorna `COOLDOWN` sin incrementar `lastFencingToken`.
 * - Si está libre o expirado, incrementa `lastFencingToken = lastFencingToken + 1` y asigna el nuevo lease.
 */
export function acquireCoordinatorLease(
  existingEnvelope: ControlEnvelope | unknown,
  params: {
    workerRunId: string;
    dbNow: Date | string;
    ttlMs?: number;
  }
): LeaseClaimResult {
  const cleanRunId =
    typeof params.workerRunId === "string" ? params.workerRunId.trim() : "";
  if (!cleanRunId) {
    throw new PaymentPolicyError(
      "workerRunId es obligatorio para reclamar el lease.",
      "INVALID_WORKER_RUN_ID"
    );
  }
  const nowMs = parseCanonicalDbTimeMs(params.dbNow);
  const ttlMs = params.ttlMs ?? DEFAULT_RECONCILIATION_LEASE_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new PaymentPolicyError(
      "ttlMs debe ser un entero positivo.",
      "INVALID_LEASE_TTL"
    );
  }

  const env = parseControlEnvelope(existingEnvelope);

  if (env.reconciliationLease) {
    const expiresMs = Date.parse(env.reconciliationLease.expiresAt);
    if (!Number.isNaN(expiresMs) && expiresMs > nowMs) {
      return {
        status: "ACTIVE_LEASE",
        activeLease: env.reconciliationLease,
        envelope: env,
      };
    }
  }

  if (env.pollingMetadata.nextPollAfter) {
    const nextPollMs = Date.parse(env.pollingMetadata.nextPollAfter);
    if (!Number.isNaN(nextPollMs) && nextPollMs > nowMs) {
      return {
        status: "COOLDOWN",
        nextPollAfter: env.pollingMetadata.nextPollAfter,
        envelope: env,
      };
    }
  }

  const nextToken = env.lastFencingToken + 1;
  const lease: ReconciliationLease = {
    workerRunId: cleanRunId,
    fencingToken: nextToken,
    acquiredAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };

  const updatedEnvelope: ControlEnvelope = {
    ...env,
    lastFencingToken: nextToken,
    reconciliationLease: lease,
  };

  return {
    status: "CLAIMED",
    fencingToken: nextToken,
    financialStateVersion: env.financialStateVersion,
    lease,
    envelope: updatedEnvelope,
  };
}

/**
 * Libera de forma limpia el lease del worker en Fase 3 cuando detecta un aborto por
 * `FINANCIAL_STATE_VERSION_MISMATCH`, preservando intactos los cambios financieros
 * del webhook (`financialStateVersion`, `latestStatusByTransactionId`, `observations`,
 * `approvalsSequence`, `financialIncidents`) y manteniendo `lastFencingToken` sin reiniciar.
 */
export function releaseCoordinatorLeaseOnVersionAbort(
  currentLiveEnvelope: ControlEnvelope | unknown,
  params: {
    workerRunId: string;
    fencingToken: number;
  }
): {
  released: boolean;
  reason: "LEASE_RELEASED_ON_VERSION_ABORT" | "NOT_LEASE_OWNER";
  envelope: ControlEnvelope;
} {
  const env = parseControlEnvelope(currentLiveEnvelope);
  const active = env.reconciliationLease;
  if (
    !active ||
    active.workerRunId !== params.workerRunId ||
    active.fencingToken !== params.fencingToken
  ) {
    return {
      released: false,
      reason: "NOT_LEASE_OWNER",
      envelope: env,
    };
  }

  return {
    released: true,
    reason: "LEASE_RELEASED_ON_VERSION_ABORT",
    envelope: {
      ...env,
      reconciliationLease: null,
    },
  };
}

/**
 * Calcula los metadatos de planificación (`pollingMetadata`) según el escalonamiento:
 * - Si la transacción sigue en `PENDING`:
 *   `pollCount <= 3 -> +2 min`; `4 <= pollCount <= 8 -> +10 min`; `pollCount > 8 -> +30 min`.
 * - Si alcanzó estado terminal o incidente: resetea `pollCount = 0` y `nextPollAfter = null`.
 */
export function computeNextPollingMetadata(
  current: PollingMetadata,
  dbNow: Date | string,
  outcome: "STILL_PENDING" | "RESOLVED"
): PollingMetadata {
  const nowMs = parseCanonicalDbTimeMs(dbNow);
  const nowIso = new Date(nowMs).toISOString();

  if (outcome === "RESOLVED") {
    return {
      pollCount: 0,
      nextPollAfter: null,
      lastPolledAt: nowIso,
    };
  }

  const nextCount = current.pollCount + 1;
  const delayMinutes = nextCount <= 3 ? 2 : nextCount <= 8 ? 10 : 30;
  return {
    pollCount: nextCount,
    nextPollAfter: new Date(nowMs + delayMinutes * 60_000).toISOString(),
    lastPolledAt: nowIso,
  };
}

/**
 *Registra de forma idempotente y monótona (1, 2, 3...) una transacción `APPROVED`
 * en la secuencia canónica de aprobaciones de la orden.
 */
export function recordCanonicalApprovalInSequence(
  existingSequence: readonly ApprovalSequenceEntry[],
  params: {
    transactionId: string;
    wompiReference: string;
    recordedAt: string;
  }
): {
  sequenceNumber: number;
  alreadyRecorded: boolean;
  approvalsSequence: readonly ApprovalSequenceEntry[];
} {
  const existing = existingSequence.find(
    (item) => item.transactionId === params.transactionId
  );
  if (existing) {
    return {
      sequenceNumber: existing.sequenceNumber,
      alreadyRecorded: true,
      approvalsSequence: [...existingSequence],
    };
  }

  const maxSeq = existingSequence.reduce(
    (max, item) => (item.sequenceNumber > max ? item.sequenceNumber : max),
    0
  );
  const nextSeq = maxSeq + 1;
  const updated: ApprovalSequenceEntry[] = [
    ...existingSequence,
    {
      transactionId: params.transactionId,
      sequenceNumber: nextSeq,
      wompiReference: params.wompiReference,
      recordedAt: params.recordedAt,
    },
  ];

  return {
    sequenceNumber: nextSeq,
    alreadyRecorded: false,
    approvalsSequence: updated,
  };
}

// ============================================================================
// 6.2 REGLA DE VENTANA TEMPORAL DE 3 MINUTOS (H-05 / PUNTO D)
// ============================================================================

export interface NativeRetryWindowEvaluation {
  validTimestamps: boolean;
  deltaSeconds: number | null;
  withinThreeMinuteWindow: boolean;
}

/**
 * Evalúa la regla técnica de diseño para reintento nativo bajo la misma referencia:
 * `0 <= (incomingCreatedAt - previousFinalizedAt) <= 180 segundos`.
 * Rechaza valores negativos (llegadas fuera de orden donde incoming fue creada antes
 * del fallo previo) y marcas ausentes o inválidas.
 */
export function evaluateNativeRetryWindow(
  previousFinalizedAt: string | Date | null | undefined,
  incomingCreatedAt: string | Date | null | undefined
): NativeRetryWindowEvaluation {
  if (!previousFinalizedAt || !incomingCreatedAt) {
    return {
      validTimestamps: false,
      deltaSeconds: null,
      withinThreeMinuteWindow: false,
    };
  }

  const prevMs =
    previousFinalizedAt instanceof Date
      ? previousFinalizedAt.getTime()
      : Date.parse(previousFinalizedAt);
  const incMs =
    incomingCreatedAt instanceof Date
      ? incomingCreatedAt.getTime()
      : Date.parse(incomingCreatedAt);

  if (Number.isNaN(prevMs) || Number.isNaN(incMs)) {
    return {
      validTimestamps: false,
      deltaSeconds: null,
      withinThreeMinuteWindow: false,
    };
  }

  const deltaSeconds = (incMs - prevMs) / 1000;
  return {
    validTimestamps: true,
    deltaSeconds,
    withinThreeMinuteWindow:
      deltaSeconds >= 0 && deltaSeconds <= NATIVE_RETRY_WINDOW_SECONDS,
  };
}

// ============================================================================
// 6.3 COMPUERTA DE CONSOLIDACIÓN G.2 Y MATRICES F.2, F.3 Y G.4
// ============================================================================

export interface ConsolidationGateInput {
  orderOperationalStatus: OrderOperationalStatus;
  orderPaymentStatus: OrderPaymentStatus;
  parallelTransactions: ReadonlyArray<{
    id: string;
    status: WompiRemoteTransactionStatus;
  }>;
  openFinancialIncidentsCount: number;
  secondaryApprovalsCount: number;
}

export interface ConsolidationGateDecision {
  canConsolidateCapture: boolean;
  nextIntentStatus: LocalPaymentIntentStatus;
  nextOrderPaymentStatus: OrderPaymentStatus;
  incidentToOpen: FinancialIncidentCode | null;
}

/**
 * Formaliza la compuerta G.2 armonizada con F.2:
 * - Si la orden está en `CANCELADO`, jamás se reactiva; registra `COBRO_TARDIO_ORDEN_CANCELADA`.
 * - Si existe cualquier transacción paralela en `PENDING`, retiene el intento en
 *   `PENDIENTE_CONCILIACION` y la orden en `PENDIENTE`, abriendo
 *   `APROBACION_CON_TRANSACCION_PARALELA_PENDIENTE`.
 * - Si existen aprobaciones secundarias o incidentes abiertos en HU26, bloquea la
 *   consolidación automática.
 * - Solo cuando hay 0 paralelas en `PENDING`, 0 aprobaciones secundarias y 0 incidentes
 *   abiertos, autoriza `IntentoPagoWompi.estado = "APROBADO"` y `OrdenServicio.estadoPago = "CAPTURADO"`.
 */
export function evaluateConsolidationGateG2(
  input: ConsolidationGateInput
): ConsolidationGateDecision {
  if (input.orderOperationalStatus === "CANCELADO") {
    return {
      canConsolidateCapture: false,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "CAPTURADO",
      incidentToOpen: "COBRO_TARDIO_ORDEN_CANCELADA",
    };
  }

  const hasParallelPending = input.parallelTransactions.some(
    (tx) => tx.status === "PENDING"
  );
  if (hasParallelPending) {
    return {
      canConsolidateCapture: false,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      incidentToOpen: "APROBACION_CON_TRANSACCION_PARALELA_PENDIENTE",
    };
  }

  const hasParallelApproved =
    input.secondaryApprovalsCount > 0 ||
    input.parallelTransactions.some((tx) => tx.status === "APPROVED");
  if (hasParallelApproved) {
    if (input.orderPaymentStatus === "CAPTURADO") {
      return {
        canConsolidateCapture: false,
        nextIntentStatus: "PENDIENTE_CONCILIACION",
        nextOrderPaymentStatus: "CAPTURADO",
        incidentToOpen: "DOBLE_COBRO_POST_CONSOLIDACION",
      };
    }
    return {
      canConsolidateCapture: false,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      incidentToOpen: "DOBLE_COBRO_PRE_CONSOLIDACION",
    };
  }

  if (input.openFinancialIncidentsCount > 0) {
    return {
      canConsolidateCapture: false,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus:
        input.orderPaymentStatus === "CAPTURADO" ? "CAPTURADO" : "PENDIENTE",
      incidentToOpen: null,
    };
  }

  return {
    canConsolidateCapture: true,
    nextIntentStatus: "APROBADO",
    nextOrderPaymentStatus: "CAPTURADO",
    incidentToOpen: null,
  };
}

export interface SameTransactionTransitionInput {
  localIntentStatus: LocalPaymentIntentStatus;
  remoteStatus: WompiRemoteTransactionStatus;
  alreadyObservedSameRemoteStatus?: boolean;
  orderOperationalStatus: OrderOperationalStatus;
  orderPaymentStatus: OrderPaymentStatus;
  reparadorId: string | null;
  parallelTransactions?: ReadonlyArray<{
    id: string;
    status: WompiRemoteTransactionStatus;
  }>;
  openFinancialIncidentsCount?: number;
  secondaryApprovalsCount?: number;
}

export interface SameTransactionTransitionResult {
  nextIntentStatus: LocalPaymentIntentStatus;
  nextOrderPaymentStatus: OrderPaymentStatus;
  effectiveFinancialMutation: boolean;
  idempotentReplay: boolean;
  incidentToOpen: FinancialIncidentCode | null;
  traceEvent: string;
}

/**
 * Matriz 1 (Sección F.2): Transición pura cuando `localIntent.wompiTransactionId === null`
 * o coincide con `remoteTx.id`.
 */
export function evaluateSameTransactionTransition(
  input: SameTransactionTransitionInput
): SameTransactionTransitionResult {
  const parallelTxs = input.parallelTransactions ?? [];
  const openIncidents = input.openFinancialIncidentsCount ?? 0;
  const secondaryApprovals = input.secondaryApprovalsCount ?? 0;

  // Caso 1: Estado local PENDIENTE o PENDIENTE_CONCILIACION
  if (
    input.localIntentStatus === "PENDIENTE" ||
    input.localIntentStatus === "PENDIENTE_CONCILIACION"
  ) {
    if (input.remoteStatus === "PENDING") {
      const idempotent = Boolean(input.alreadyObservedSameRemoteStatus);
      return {
        nextIntentStatus: input.localIntentStatus,
        nextOrderPaymentStatus: input.orderPaymentStatus,
        effectiveFinancialMutation: !idempotent,
        idempotentReplay: idempotent,
        incidentToOpen: null,
        traceEvent: idempotent
          ? "WOMPI_PENDING_IDEMPOTENT_REPLAY"
          : "WOMPI_PENDING_OBSERVED",
      };
    }

    if (input.remoteStatus === "APPROVED") {
      const gate = evaluateConsolidationGateG2({
        orderOperationalStatus: input.orderOperationalStatus,
        orderPaymentStatus: input.orderPaymentStatus,
        parallelTransactions: parallelTxs,
        openFinancialIncidentsCount: openIncidents,
        secondaryApprovalsCount: secondaryApprovals,
      });
      return {
        nextIntentStatus: gate.nextIntentStatus,
        nextOrderPaymentStatus: gate.nextOrderPaymentStatus,
        effectiveFinancialMutation: true,
        idempotentReplay: false,
        incidentToOpen: gate.incidentToOpen,
        traceEvent: gate.canConsolidateCapture
          ? "PAGO_CAPTURADO_CONSOLIDADO"
          : gate.incidentToOpen ?? "PAGO_APROBADO_RETENIDO_POR_CONCILIACION",
      };
    }

    if (input.remoteStatus === "DECLINED") {
      return {
        nextIntentStatus: "RECHAZADO",
        nextOrderPaymentStatus:
          input.orderPaymentStatus === "CAPTURADO" ? "CAPTURADO" : "FALLIDO",
        effectiveFinancialMutation: true,
        idempotentReplay: false,
        incidentToOpen: null,
        traceEvent: "INTENTO_PAGO_RECHAZADO",
      };
    }

    if (input.remoteStatus === "ERROR") {
      return {
        nextIntentStatus: "FALLIDO",
        nextOrderPaymentStatus:
          input.orderPaymentStatus === "CAPTURADO" ? "CAPTURADO" : "FALLIDO",
        effectiveFinancialMutation: true,
        idempotentReplay: false,
        incidentToOpen: null,
        traceEvent: "INTENTO_PAGO_ERROR_PASARELA",
      };
    }

    // VOIDED desde PENDIENTE
    return {
      nextIntentStatus: "ANULADO",
      nextOrderPaymentStatus:
        input.orderPaymentStatus === "CAPTURADO" ? "CAPTURADO" : "FALLIDO",
      effectiveFinancialMutation: true,
      idempotentReplay: false,
      incidentToOpen: null,
      traceEvent: "INTENTO_PAGO_ANULADO_SIN_CONSOLIDAR",
    };
  }

  // Caso 2: Estado local APROBADO
  if (input.localIntentStatus === "APROBADO") {
    if (input.remoteStatus === "APPROVED") {
      return {
        nextIntentStatus: "APROBADO",
        nextOrderPaymentStatus: input.orderPaymentStatus,
        effectiveFinancialMutation: false,
        idempotentReplay: true,
        incidentToOpen: null,
        traceEvent: "PAGO_APROBADO_IDEMPOTENTE",
      };
    }

    if (input.remoteStatus === "VOIDED") {
      if (input.reparadorId === null) {
        return {
          nextIntentStatus: "ANULADO",
          nextOrderPaymentStatus: "FALLIDO",
          effectiveFinancialMutation: true,
          idempotentReplay: false,
          incidentToOpen: "ANULACION_PASARELA_PRE_ASIGNACION",
          traceEvent: "ANULACION_PASARELA_PRE_ASIGNACION",
        };
      }
      return {
        nextIntentStatus: "ANULADO",
        nextOrderPaymentStatus: "FALLIDO",
        effectiveFinancialMutation: true,
        idempotentReplay: false,
        incidentToOpen: "ANULACION_PASARELA_POST_APROBACION",
        traceEvent: "ANULACION_PASARELA_POST_APROBACION",
      };
    }

    // Respuestas canónicas obsoletas/fuera de orden (PENDING, DECLINED, ERROR)
    // jamás revierten un intento ya APROBADO ni la captura ganadora.
    return {
      nextIntentStatus: "APROBADO",
      nextOrderPaymentStatus: input.orderPaymentStatus,
      effectiveFinancialMutation: false,
      idempotentReplay: true,
      incidentToOpen: null,
      traceEvent: "STALE_REMOTE_STATUS_IGNORED_AFTER_APPROVAL",
    };
  }

  // Caso 3: Estado local terminal no aprobado (RECHAZADO, FALLIDO, ANULADO)
  if (
    (input.localIntentStatus === "RECHAZADO" &&
      input.remoteStatus === "DECLINED") ||
    (input.localIntentStatus === "FALLIDO" && input.remoteStatus === "ERROR") ||
    (input.localIntentStatus === "ANULADO" && input.remoteStatus === "VOIDED")
  ) {
    return {
      nextIntentStatus: input.localIntentStatus,
      nextOrderPaymentStatus: input.orderPaymentStatus,
      effectiveFinancialMutation: false,
      idempotentReplay: true,
      incidentToOpen: null,
      traceEvent: "ESTADO_TERMINAL_IDEMPOTENTE",
    };
  }

  // Respuesta obsoleta PENDING posterior a estado terminal no aprobado
  if (
    (input.localIntentStatus === "RECHAZADO" ||
      input.localIntentStatus === "FALLIDO" ||
      input.localIntentStatus === "ANULADO") &&
    input.remoteStatus === "PENDING"
  ) {
    return {
      nextIntentStatus: input.localIntentStatus,
      nextOrderPaymentStatus: input.orderPaymentStatus,
      effectiveFinancialMutation: false,
      idempotentReplay: true,
      incidentToOpen: null,
      traceEvent: "STALE_PENDING_IGNORED_AFTER_TERMINAL",
    };
  }

  // Regla explícita VOIDED -> APPROVED sobre el mismo intento:
  // jamás reactiva automáticamente la captura; pasa a PENDIENTE_CONCILIACION,
  // conserva la captura ganadora existente (si la hay) y abre anomalía financiera.
  if (
    input.localIntentStatus === "ANULADO" &&
    input.remoteStatus === "APPROVED"
  ) {
    return {
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: input.orderPaymentStatus,
      effectiveFinancialMutation: true,
      idempotentReplay: false,
      incidentToOpen: "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION",
      traceEvent: "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION",
    };
  }

  if (
    (input.localIntentStatus === "RECHAZADO" ||
      input.localIntentStatus === "FALLIDO") &&
    input.remoteStatus === "APPROVED"
  ) {
    const gate = evaluateConsolidationGateG2({
      orderOperationalStatus: input.orderOperationalStatus,
      orderPaymentStatus: input.orderPaymentStatus,
      parallelTransactions: parallelTxs,
      openFinancialIncidentsCount: openIncidents,
      secondaryApprovalsCount: secondaryApprovals,
    });
    return {
      nextIntentStatus: gate.nextIntentStatus,
      nextOrderPaymentStatus: gate.nextOrderPaymentStatus,
      effectiveFinancialMutation: true,
      idempotentReplay: false,
      incidentToOpen: gate.incidentToOpen,
      traceEvent: gate.canConsolidateCapture
        ? "RECONCILIACION_REMOTA_APROBADA"
        : gate.incidentToOpen ?? "RECONCILIACION_REMOTA_RETENIDA",
    };
  }

  return {
    nextIntentStatus: input.localIntentStatus,
    nextOrderPaymentStatus: input.orderPaymentStatus,
    effectiveFinancialMutation: false,
    idempotentReplay: false,
    incidentToOpen: "ANOMALIA_TRANSICION_PASARELA",
    traceEvent: "ANOMALIA_TRANSICION_PASARELA",
  };
}

/**
 * Separa estrictamente `estadoProveedor` (verdad remota de Wompi para el intento) del
 * estado interno (`IntentoPagoWompi.estado`) e impide que respuestas obsoletas fuera de orden
 * sobrescriban un estado remoto ya consolidado.
 */
export function resolveCanonicalProviderStatus(params: {
  previousProviderStatus: string | null | undefined;
  incomingRemoteStatus: WompiRemoteTransactionStatus;
  sameTransactionId: boolean;
}): {
  nextProviderStatus: WompiRemoteTransactionStatus;
  isStaleOutOfOrder: boolean;
} {
  const prev =
    typeof params.previousProviderStatus === "string"
      ? params.previousProviderStatus.trim().toUpperCase()
      : "";

  if (params.sameTransactionId) {
    if (
      prev === "APPROVED" &&
      (params.incomingRemoteStatus === "PENDING" ||
        params.incomingRemoteStatus === "DECLINED" ||
        params.incomingRemoteStatus === "ERROR")
    ) {
      return {
        nextProviderStatus: "APPROVED",
        isStaleOutOfOrder: true,
      };
    }

    if (
      (prev === "DECLINED" || prev === "ERROR" || prev === "VOIDED") &&
      params.incomingRemoteStatus === "PENDING"
    ) {
      return {
        nextProviderStatus: prev as WompiRemoteTransactionStatus,
        isStaleOutOfOrder: true,
      };
    }
  }

  return {
    nextProviderStatus: params.incomingRemoteStatus,
    isStaleOutOfOrder: false,
  };
}

export type MatrixF3RowCode =
  | "ROW_1A_NATIVE_RETRY_APPROVED_WITHIN_WINDOW"
  | "ROW_1B_NATIVE_RETRY_APPROVED_OUTSIDE_WINDOW"
  | "ROW_2_ERROR_PLUS_APPROVED_ANOMALY"
  | "ROW_3_VOIDED_PLUS_APPROVED_ANOMALY"
  | "ROW_4_APPROVED_PLUS_FAILED_OUT_OF_ORDER"
  | "ROW_5_APPROVED_PLUS_VOIDED_SAME_REF"
  | "ROW_6A_DOUBLE_CHARGE_PRE_CONSOLIDATION"
  | "ROW_6B_DOUBLE_CHARGE_POST_CONSOLIDATION"
  | "ROW_7_PENDING_PLUS_APPROVED_PARALLEL"
  | "ROW_8_APPROVED_PLUS_PENDING_PARALLEL"
  | "ROW_9_PENDING_PLUS_TERMINAL_UNPAID"
  | "ROW_10A_1_DECLINED_PLUS_PENDING_WITHIN_WINDOW"
  | "ROW_10A_2_DECLINED_PLUS_PENDING_OUTSIDE_WINDOW"
  | "ROW_10B_ERROR_PLUS_PENDING_SANDBOX_VALIDATION"
  | "ROW_10C_VOIDED_PLUS_PENDING_ANOMALY"
  | "ROW_11_BOTH_PENDING"
  | "ROW_12_BOTH_TERMINAL_UNPAID";

export interface DistinctTransactionsTransitionInput {
  currentTx: {
    id: string;
    status: WompiRemoteTransactionStatus;
    createdAt?: string | null;
    finalizedAt?: string | null;
  };
  incomingTx: {
    id: string;
    status: WompiRemoteTransactionStatus;
    createdAt?: string | null;
    finalizedAt?: string | null;
  };
  orderOperationalStatus: OrderOperationalStatus;
  orderPaymentStatus: OrderPaymentStatus;
  reparadorId: string | null;
  otherParallelTransactions?: ReadonlyArray<{
    id: string;
    status: WompiRemoteTransactionStatus;
  }>;
  openFinancialIncidentsCount?: number;
}

export interface DistinctTransactionsTransitionResult {
  rowCode: MatrixF3RowCode;
  linkedTransactionId: string;
  archivedTransactionId: string;
  nextIntentStatus: LocalPaymentIntentStatus;
  nextOrderPaymentStatus: OrderPaymentStatus;
  effectiveFinancialMutation: boolean;
  incidentToOpen: FinancialIncidentCode | null;
  traceEvent: string;
}

function mapUnpaidTerminalToIntentStatus(
  status: "DECLINED" | "ERROR" | "VOIDED"
): LocalPaymentIntentStatus {
  if (status === "DECLINED") return "RECHAZADO";
  if (status === "ERROR") return "FALLIDO";
  return "ANULADO";
}

/**
 * Matriz 2 (Sección F.3): Transición pura cuando existen dos transacciones remotas
 * con IDs distintos (`currentTx.id !== incomingTx.id`) bajo la misma referencia.
 */
export function evaluateDistinctTransactionsTransition(
  input: DistinctTransactionsTransitionInput
): DistinctTransactionsTransitionResult {
  const { currentTx, incomingTx } = input;
  if (currentTx.id === incomingTx.id) {
    throw new PaymentPolicyError(
      "evaluateDistinctTransactionsTransition exige dos transacciones con IDs distintos.",
      "SAME_TRANSACTION_ID_IN_F3"
    );
  }

  const otherParallel = input.otherParallelTransactions ?? [];
  const openIncidents = input.openFinancialIncidentsCount ?? 0;

  // Fila 1A / 1B: DECLINED + APPROVED
  if (currentTx.status === "DECLINED" && incomingTx.status === "APPROVED") {
    const windowCheck = evaluateNativeRetryWindow(
      currentTx.finalizedAt,
      incomingTx.createdAt
    );
    if (windowCheck.withinThreeMinuteWindow) {
      const gate = evaluateConsolidationGateG2({
        orderOperationalStatus: input.orderOperationalStatus,
        orderPaymentStatus: input.orderPaymentStatus,
        parallelTransactions: otherParallel,
        openFinancialIncidentsCount: openIncidents,
        secondaryApprovalsCount: 0,
      });
      return {
        rowCode: "ROW_1A_NATIVE_RETRY_APPROVED_WITHIN_WINDOW",
        linkedTransactionId: incomingTx.id,
        archivedTransactionId: currentTx.id,
        nextIntentStatus: gate.nextIntentStatus,
        nextOrderPaymentStatus: gate.nextOrderPaymentStatus,
        effectiveFinancialMutation: true,
        incidentToOpen: gate.incidentToOpen,
        traceEvent: "NATIVE_RETRY_APPROVED_WITHIN_WINDOW",
      };
    }

    return {
      rowCode: "ROW_1B_NATIVE_RETRY_APPROVED_OUTSIDE_WINDOW",
      linkedTransactionId: incomingTx.id,
      archivedTransactionId: currentTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      effectiveFinancialMutation: true,
      incidentToOpen:
        "ANOMALIA_REINTENTO_APROBADO_FUERA_DE_VENTANA_MISMA_REFERENCIA",
      traceEvent:
        "ANOMALIA_REINTENTO_APROBADO_FUERA_DE_VENTANA_MISMA_REFERENCIA",
    };
  }

  // Fila 2: ERROR + APPROVED (Anomalía retenida, prohibida captura automática)
  if (currentTx.status === "ERROR" && incomingTx.status === "APPROVED") {
    return {
      rowCode: "ROW_2_ERROR_PLUS_APPROVED_ANOMALY",
      linkedTransactionId: incomingTx.id,
      archivedTransactionId: currentTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      effectiveFinancialMutation: true,
      incidentToOpen: "ANOMALIA_REINTENTO_TRAS_ERROR_MISMA_REFERENCIA",
      traceEvent: "ANOMALIA_REINTENTO_TRAS_ERROR_MISMA_REFERENCIA",
    };
  }

  // Fila 3: VOIDED + APPROVED (Anomalía retenida, prohibido asumir reintento tras VOIDED)
  if (currentTx.status === "VOIDED" && incomingTx.status === "APPROVED") {
    return {
      rowCode: "ROW_3_VOIDED_PLUS_APPROVED_ANOMALY",
      linkedTransactionId: incomingTx.id,
      archivedTransactionId: currentTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      effectiveFinancialMutation: true,
      incidentToOpen: "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION_MISMA_REFERENCIA",
      traceEvent: "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION_MISMA_REFERENCIA",
    };
  }

  // Fila 4: APPROVED + (DECLINED | ERROR)
  if (
    currentTx.status === "APPROVED" &&
    (incomingTx.status === "DECLINED" || incomingTx.status === "ERROR")
  ) {
    return {
      rowCode: "ROW_4_APPROVED_PLUS_FAILED_OUT_OF_ORDER",
      linkedTransactionId: currentTx.id,
      archivedTransactionId: incomingTx.id,
      nextIntentStatus: "APROBADO",
      nextOrderPaymentStatus: input.orderPaymentStatus,
      effectiveFinancialMutation: true,
      incidentToOpen: null,
      traceEvent: "FAILED_TRANSACTION_ARRIVED_OUT_OF_ORDER_ARCHIVED",
    };
  }

  // Fila 5: APPROVED + VOIDED (distintos IDs bajo la misma referencia)
  if (currentTx.status === "APPROVED" && incomingTx.status === "VOIDED") {
    return {
      rowCode: "ROW_5_APPROVED_PLUS_VOIDED_SAME_REF",
      linkedTransactionId: currentTx.id,
      archivedTransactionId: incomingTx.id,
      nextIntentStatus: "APROBADO",
      nextOrderPaymentStatus: input.orderPaymentStatus,
      effectiveFinancialMutation: true,
      incidentToOpen: "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION_MISMA_REFERENCIA",
      traceEvent: "APPROVED_WITH_SECONDARY_VOIDED_SAME_REFERENCE",
    };
  }

  // Fila 6A y 6B: APPROVED + APPROVED (Doble cobro confirmado)
  if (currentTx.status === "APPROVED" && incomingTx.status === "APPROVED") {
    if (input.orderOperationalStatus === "CANCELADO") {
      return {
        rowCode: "ROW_6A_DOUBLE_CHARGE_PRE_CONSOLIDATION",
        linkedTransactionId: currentTx.id,
        archivedTransactionId: incomingTx.id,
        nextIntentStatus: "PENDIENTE_CONCILIACION",
        nextOrderPaymentStatus: "PENDIENTE",
        effectiveFinancialMutation: true,
        incidentToOpen: "COBRO_TARDIO_ORDEN_CANCELADA",
        traceEvent: "DOBLE_COBRO_EN_ORDEN_CANCELADA",
      };
    }

    // 6B: Segunda aprobación detectada DESPUÉS de haber consolidado la orden en CAPTURADO
    if (input.orderPaymentStatus === "CAPTURADO") {
      return {
        rowCode: "ROW_6B_DOUBLE_CHARGE_POST_CONSOLIDATION",
        linkedTransactionId: currentTx.id,
        archivedTransactionId: incomingTx.id,
        nextIntentStatus: "APROBADO",
        nextOrderPaymentStatus: "CAPTURADO",
        effectiveFinancialMutation: true,
        incidentToOpen: "DOBLE_COBRO_POST_CONSOLIDACION",
        traceEvent: "DOBLE_COBRO_POST_CONSOLIDACION",
      };
    }

    // 6A: Doble aprobación detectada ANTES de consolidar -> Retener orden e impedir captura automática
    return {
      rowCode: "ROW_6A_DOUBLE_CHARGE_PRE_CONSOLIDATION",
      linkedTransactionId: currentTx.id,
      archivedTransactionId: incomingTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      effectiveFinancialMutation: true,
      incidentToOpen: "DOBLE_COBRO_PRE_CONSOLIDACION",
      traceEvent: "DOBLE_COBRO_PRE_CONSOLIDACION",
    };
  }

  // Fila 7: PENDING + APPROVED
  if (currentTx.status === "PENDING" && incomingTx.status === "APPROVED") {
    return {
      rowCode: "ROW_7_PENDING_PLUS_APPROVED_PARALLEL",
      linkedTransactionId: incomingTx.id,
      archivedTransactionId: currentTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus:
        input.orderPaymentStatus === "CAPTURADO" ? "CAPTURADO" : "PENDIENTE",
      effectiveFinancialMutation: true,
      incidentToOpen: "APROBACION_CON_TRANSACCION_PARALELA_PENDIENTE",
      traceEvent: "APROBACION_CON_TRANSACCION_PARALELA_PENDIENTE",
    };
  }

  // Fila 8: APPROVED + PENDING
  if (currentTx.status === "APPROVED" && incomingTx.status === "PENDING") {
    const canHoldBackOrder =
      input.reparadorId === null && input.orderOperationalStatus === "BUSCANDO";
    return {
      rowCode: "ROW_8_APPROVED_PLUS_PENDING_PARALLEL",
      linkedTransactionId: currentTx.id,
      archivedTransactionId: incomingTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: canHoldBackOrder
        ? "PENDIENTE"
        : input.orderPaymentStatus,
      effectiveFinancialMutation: true,
      incidentToOpen: "APROBACION_CON_TRANSACCION_PARALELA_PENDIENTE",
      traceEvent: "APROBACION_CON_TRANSACCION_PARALELA_PENDIENTE",
    };
  }

  // Fila 9: PENDING + (DECLINED | ERROR | VOIDED)
  if (
    currentTx.status === "PENDING" &&
    (incomingTx.status === "DECLINED" ||
      incomingTx.status === "ERROR" ||
      incomingTx.status === "VOIDED")
  ) {
    return {
      rowCode: "ROW_9_PENDING_PLUS_TERMINAL_UNPAID",
      linkedTransactionId: currentTx.id,
      archivedTransactionId: incomingTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: input.orderPaymentStatus,
      effectiveFinancialMutation: true,
      incidentToOpen: null,
      traceEvent: "SECONDARY_UNPAID_ARCHIVED_PRIMARY_STILL_PENDING",
    };
  }

  // Fila 10A-1 / 10A-2: DECLINED + PENDING
  if (currentTx.status === "DECLINED" && incomingTx.status === "PENDING") {
    const windowCheck = evaluateNativeRetryWindow(
      currentTx.finalizedAt,
      incomingTx.createdAt
    );
    if (windowCheck.withinThreeMinuteWindow) {
      return {
        rowCode: "ROW_10A_1_DECLINED_PLUS_PENDING_WITHIN_WINDOW",
        linkedTransactionId: incomingTx.id,
        archivedTransactionId: currentTx.id,
        nextIntentStatus: "PENDIENTE_CONCILIACION",
        nextOrderPaymentStatus: "PENDIENTE",
        effectiveFinancialMutation: true,
        incidentToOpen: null,
        traceEvent: "NATIVE_RETRY_IN_FLIGHT_WITHIN_WINDOW",
      };
    }

    return {
      rowCode: "ROW_10A_2_DECLINED_PLUS_PENDING_OUTSIDE_WINDOW",
      linkedTransactionId: currentTx.id,
      archivedTransactionId: incomingTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      effectiveFinancialMutation: true,
      incidentToOpen: "ANOMALIA_REINTENTO_FUERA_DE_VENTANA_MISMA_REFERENCIA",
      traceEvent: "ANOMALIA_REINTENTO_FUERA_DE_VENTANA_MISMA_REFERENCIA",
    };
  }

  // Fila 10B: ERROR + PENDING
  if (currentTx.status === "ERROR" && incomingTx.status === "PENDING") {
    return {
      rowCode: "ROW_10B_ERROR_PLUS_PENDING_SANDBOX_VALIDATION",
      linkedTransactionId: incomingTx.id,
      archivedTransactionId: currentTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      effectiveFinancialMutation: true,
      incidentToOpen: null,
      traceEvent: "RETRY_AFTER_ERROR_SAME_REF_PENDING",
    };
  }

  // Fila 10C: VOIDED + PENDING
  if (currentTx.status === "VOIDED" && incomingTx.status === "PENDING") {
    return {
      rowCode: "ROW_10C_VOIDED_PLUS_PENDING_ANOMALY",
      linkedTransactionId: currentTx.id,
      archivedTransactionId: incomingTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: "PENDIENTE",
      effectiveFinancialMutation: true,
      incidentToOpen:
        "ANOMALIA_VOIDED_CON_TRANSACCION_PENDIENTE_MISMA_REFERENCIA",
      traceEvent: "ANOMALIA_VOIDED_CON_TRANSACCION_PENDIENTE_MISMA_REFERENCIA",
    };
  }

  // Fila 11: PENDING + PENDING
  if (currentTx.status === "PENDING" && incomingTx.status === "PENDING") {
    const curMs = currentTx.createdAt ? Date.parse(currentTx.createdAt) : 0;
    const incMs = incomingTx.createdAt ? Date.parse(incomingTx.createdAt) : 0;
    const incomingIsNewer = incMs >= curMs;
    return {
      rowCode: "ROW_11_BOTH_PENDING",
      linkedTransactionId: incomingIsNewer ? incomingTx.id : currentTx.id,
      archivedTransactionId: incomingIsNewer ? currentTx.id : incomingTx.id,
      nextIntentStatus: "PENDIENTE_CONCILIACION",
      nextOrderPaymentStatus: input.orderPaymentStatus,
      effectiveFinancialMutation: true,
      incidentToOpen: null,
      traceEvent: "MULTIPLE_PENDING_TRANSACTIONS_TRACKED",
    };
  }

  // Fila 12: Ambas terminadas sin cobro (DECLINED / ERROR / VOIDED)
  const curFinalMs = currentTx.finalizedAt
    ? Date.parse(currentTx.finalizedAt)
    : currentTx.createdAt
    ? Date.parse(currentTx.createdAt)
    : 0;
  const incFinalMs = incomingTx.finalizedAt
    ? Date.parse(incomingTx.finalizedAt)
    : incomingTx.createdAt
    ? Date.parse(incomingTx.createdAt)
    : 0;
  const incomingIsLatest = incFinalMs >= curFinalMs;
  const winningTx = incomingIsLatest ? incomingTx : currentTx;
  const losingTx = incomingIsLatest ? currentTx : incomingTx;

  return {
    rowCode: "ROW_12_BOTH_TERMINAL_UNPAID",
    linkedTransactionId: winningTx.id,
    archivedTransactionId: losingTx.id,
    nextIntentStatus: mapUnpaidTerminalToIntentStatus(
      winningTx.status as "DECLINED" | "ERROR" | "VOIDED"
    ),
    nextOrderPaymentStatus:
      input.orderPaymentStatus === "CAPTURADO" ? "CAPTURADO" : "PENDIENTE",
    effectiveFinancialMutation: true,
    incidentToOpen: null,
    traceEvent: "BOTH_TRANSACTIONS_TERMINAL_UNPAID",
  };
}

// ============================================================================
// 6.4 POLÍTICA DE REINTENTOS ADMINISTRADOS EN 4 CAPAS (SECCIÓN H.2)
// ============================================================================

export interface ManagedRetryEligibilityInput {
  orderOperationalStatus: OrderOperationalStatus;
  orderPaymentStatus: OrderPaymentStatus;
  reparadorId: string | null;
  localAttemptStatuses: readonly LocalPaymentIntentStatus[];
  latestStatusByTransactionId: Readonly<
    Record<string, WompiRemoteTransactionStatus>
  >;
  openFinancialIncidentsCount: number;
}

export type ManagedRetryBlockReason =
  | "ORDER_NOT_IN_BUSCANDO"
  | "TECHNICIAN_ALREADY_ASSIGNED"
  | "ORDER_PAYMENT_ALREADY_CAPTURED"
  | "LOCAL_ATTEMPT_STILL_ACTIVE_OR_APPROVED"
  | "REMOTE_TRANSACTION_STILL_PENDING_OR_APPROVED"
  | "OPEN_FINANCIAL_INCIDENTS_EXIST";

export interface ManagedRetryEligibilityResult {
  allowed: boolean;
  blockReason: ManagedRetryBlockReason | null;
  nextAttemptSequence: number;
}

/**
 * Evalúa las 4 capas de elegibilidad para crear un nuevo reintento administrado
 * (`IntentoPagoWompi` con nueva referencia):
 * - Permite el reintento si una transacción histórica estuvo `APPROVED` en el pasado
 *   pero su estado actual verificado en `latestStatusByTransactionId` es `VOIDED`.
 * - Bloquea si cualquier transacción en `latestStatusByTransactionId` sigue en
 *   `PENDING` o `APPROVED`, si hay intentos locales activos, si la orden ya está
 *   capturada o si existen incidentes abiertos en HU26.
 */
export function evaluateManagedRetryEligibility(
  input: ManagedRetryEligibilityInput
): ManagedRetryEligibilityResult {
  const nextAttemptSequence = input.localAttemptStatuses.length + 1;

  if (input.orderOperationalStatus !== "BUSCANDO") {
    return {
      allowed: false,
      blockReason: "ORDER_NOT_IN_BUSCANDO",
      nextAttemptSequence,
    };
  }

  if (input.reparadorId !== null) {
    return {
      allowed: false,
      blockReason: "TECHNICIAN_ALREADY_ASSIGNED",
      nextAttemptSequence,
    };
  }

  if (input.orderPaymentStatus === "CAPTURADO") {
    return {
      allowed: false,
      blockReason: "ORDER_PAYMENT_ALREADY_CAPTURED",
      nextAttemptSequence,
    };
  }

  const hasNonTerminalOrApprovedLocal = input.localAttemptStatuses.some(
    (st) =>
      st !== "RECHAZADO" && st !== "FALLIDO" && st !== "ANULADO"
  );
  if (hasNonTerminalOrApprovedLocal) {
    return {
      allowed: false,
      blockReason: "LOCAL_ATTEMPT_STILL_ACTIVE_OR_APPROVED",
      nextAttemptSequence,
    };
  }

  for (const remoteStatus of Object.values(input.latestStatusByTransactionId)) {
    if (remoteStatus === "PENDING" || remoteStatus === "APPROVED") {
      return {
        allowed: false,
        blockReason: "REMOTE_TRANSACTION_STILL_PENDING_OR_APPROVED",
        nextAttemptSequence,
      };
    }
  }

  if (input.openFinancialIncidentsCount > 0) {
    return {
      allowed: false,
      blockReason: "OPEN_FINANCIAL_INCIDENTS_EXIST",
      nextAttemptSequence,
    };
  }

  return {
    allowed: true,
    blockReason: null,
    nextAttemptSequence,
  };
}

// ============================================================================
// 6.5 EVALUACIÓN DE RESPUESTAS DE REEMBOLSOS WOMPI V2 (HU26 / BLOQUE E / H-09)
// ============================================================================

export type WompiRefundOutcomeInput =
  | {
      kind: "HTTP_RESPONSE";
      httpStatus: number;
      refundId?: string | null;
      remoteStatus?: string | null;
      statusMessage?: unknown;
    }
  | {
      kind: "NETWORK_TIMEOUT_OR_SOCKET_ERROR";
      error: unknown;
    };

export interface WompiRefundEvaluationResult {
  nextRefundStatus: RefundRecordStatus;
  pasarelaRefundId: string | null;
  estadoProveedor: string;
  errorDetalle: string | null;
  canCloseDoubleChargeIncident: boolean;
  automaticRetryAllowed: boolean;
}

/**
 * Clasifica el resultado de `POST /v1/refunds` conforme al esquema real de
 * `ReembolsoTransaccion` (`SOLICITADO`, `PROCESADO`, `FALLIDO`) y la documentación
 * de Wompi Refunds V2 (donde HTTP 201 puede devolver `APPROVED`, `DECLINED`,
 * `ERROR` o `CANCELLED`, y HTTP 422 indica error de validación).
 */
export function evaluateWompiRefundResponse(
  input: WompiRefundOutcomeInput
): WompiRefundEvaluationResult {
  if (input.kind === "NETWORK_TIMEOUT_OR_SOCKET_ERROR") {
    return {
      nextRefundStatus: "SOLICITADO",
      pasarelaRefundId: null,
      estadoProveedor: "TIMEOUT_INCERTIDUMBRE_REMOTA",
      errorDetalle: safeTruncateErrorDetail(
        input.error ??
          "Timeout de red al invocar POST /v1/refunds. Verificar portal de comercios Wompi."
      ),
      canCloseDoubleChargeIncident: false,
      automaticRetryAllowed: false,
    };
  }

  const normalizedRemote =
    typeof input.remoteStatus === "string"
      ? input.remoteStatus.trim().toUpperCase()
      : "";
  const cleanRefundId =
    typeof input.refundId === "string" && input.refundId.trim().length > 0
      ? input.refundId.trim().slice(0, 100)
      : null;

  if (input.httpStatus === 422) {
    return {
      nextRefundStatus: "FALLIDO",
      pasarelaRefundId: cleanRefundId,
      estadoProveedor: "HTTP_422",
      errorDetalle:
        safeTruncateErrorDetail(input.statusMessage) ??
        "Error de validación HTTP 422 en solicitud de reembolso Wompi.",
      canCloseDoubleChargeIncident: false,
      automaticRetryAllowed: false,
    };
  }

  if (
    (input.httpStatus === 200 || input.httpStatus === 201) &&
    normalizedRemote === "APPROVED"
  ) {
    return {
      nextRefundStatus: "PROCESADO",
      pasarelaRefundId: cleanRefundId,
      estadoProveedor: "APPROVED",
      errorDetalle: null,
      canCloseDoubleChargeIncident: true,
      automaticRetryAllowed: false,
    };
  }

  if (
    normalizedRemote === "DECLINED" ||
    normalizedRemote === "ERROR" ||
    normalizedRemote === "CANCELLED"
  ) {
    return {
      nextRefundStatus: "FALLIDO",
      pasarelaRefundId: cleanRefundId,
      estadoProveedor: normalizedRemote,
      errorDetalle:
        safeTruncateErrorDetail(input.statusMessage) ??
        `Reembolso Wompi finalizado en estado ${normalizedRemote}.`,
      canCloseDoubleChargeIncident: false,
      automaticRetryAllowed: false,
    };
  }

  if (
    (input.httpStatus === 200 || input.httpStatus === 201) &&
    normalizedRemote === "PENDING"
  ) {
    return {
      nextRefundStatus: "SOLICITADO",
      pasarelaRefundId: cleanRefundId,
      estadoProveedor: "PENDING",
      errorDetalle: null,
      canCloseDoubleChargeIncident: false,
      automaticRetryAllowed: false,
    };
  }

  return {
    nextRefundStatus: "FALLIDO",
    pasarelaRefundId: cleanRefundId,
    estadoProveedor: normalizedRemote || `HTTP_${input.httpStatus}`,
    errorDetalle:
      safeTruncateErrorDetail(input.statusMessage) ??
      `Respuesta inesperada de reembolso Wompi (HTTP ${input.httpStatus}).`,
    canCloseDoubleChargeIncident: false,
    automaticRetryAllowed: false,
  };
}

