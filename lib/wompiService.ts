import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import {
  catalogUnitsToWompiCents,
  formatWompiCentsToCop,
} from "./pricing";
import {
  assertImplementedPaymentMethod,
  isValidUuid,
  type DbOrderStatus,
  type DbPaymentMethod,
} from "./orderPolicy";
import type { OrderActor } from "./orderService";
import type { CanonicalTopUpOutcome } from "./walletTopUpService";
import {
  PaymentPolicyError,
  WOMPI_CURRENCY_COP,
  buildWompiIntegritySignature,
  combineTransactionObservations,
  computeWompiEventDeduplicationKey,
  constantTimeHexEquals,
  evaluateDistinctTransactionsTransition,
  evaluateManagedRetryEligibility,
  evaluateSameTransactionTransition,
  generateWompiReference,
  normalizeCanonicalTimestamp,
  redactSensitivePaymentStrings,
  resolveCanonicalProviderStatus,
  safeTruncateErrorDetail,
  sanitizeWompiTransactionSnapshot,
  validateChargeableWompiAmount,
  validateWompiEnvironmentConfig,
  verifyWompiEventChecksum,
  type FinancialIncidentCode,
  type LocalPaymentIntentStatus,
  type OrderOperationalStatus,
  type OrderPaymentStatus,
  type SanitizedWompiTransactionSnapshot,
  type WompiRemoteTransactionStatus,
} from "./paymentPolicy";
import {
  calculateSlaDeadline,
  generateTicketNumber,
} from "./supportPolicy";

export const WOMPI_CHECKOUT_EXPIRATION_MS = 30 * 60 * 1000;
const CHECKOUT_REUSE_SAFETY_MARGIN_MS = 60 * 1000;
const WOMPI_HTTP_TIMEOUT_MS = 10_000;
const MAX_PG_INT32 = 2_147_483_647;

export const VERIFY_TRANSACTION_ID_REGEX = /^[a-zA-Z0-9_-]{10,64}$/;
const CANONICAL_TRANSACTION_ID_REGEX = /^[a-zA-Z0-9_-]{6,64}$/;

export class WompiServiceError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(
    message: string,
    status = 400,
    code = "WOMPI_SERVICE_ERROR",
    retryable = false
  ) {
    super(redactSensitivePaymentStrings(message));
    this.name = "WompiServiceError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export class WompiNetworkError extends WompiServiceError {
  constructor(message: string, code = "WOMPI_UPSTREAM_UNAVAILABLE") {
    super(message, 503, code, true);
    this.name = "WompiNetworkError";
  }
}

export interface WompiRuntimeOptions {
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  requestOrigin?: string | null;
}

export interface WompiAttemptMetadataV1 {
  version: 1;
  attemptSequence: number;
  createdAtIso: string;
  expirationTime: string;
  redirectUrl: string;
  observations: readonly SanitizedWompiTransactionSnapshot[];
  archivedTransactionIds: readonly string[];
  lastAnomalyCode: string | null;
}

export interface WompiWebCheckoutFormParams {
  "public-key": string;
  currency: "COP";
  "amount-in-cents": string;
  reference: string;
  "signature:integrity": string;
  "expiration-time": string;
  "redirect-url"?: string;
}

export interface PreparedWompiWebCheckout {
  checkoutUrl: "https://checkout.wompi.co/p/";
  method: "GET";
  orderId: string;
  orderNumber: string;
  intentId: string;
  attemptSequence: number;
  amountInCents: string;
  formattedAmountCop: string;
  expirationTime: string;
  reusedExistingAttempt: boolean;
  params: WompiWebCheckoutFormParams;
}

export interface CanonicalWompiTransaction {
  id: string;
  reference: string;
  status: WompiRemoteTransactionStatus;
  amountInCents: bigint;
  currency: string;
  paymentMethodType: string | null;
  statusMessage: string | null;
  createdAt: string | null;
  finalizedAt: string | null;
  snapshot: SanitizedWompiTransactionSnapshot;
}

export interface CanonicalTransitionOutcome {
  orderId: string;
  orderNumber: string;
  intentId: string;
  reference: string;
  transactionId: string;
  providerStatus: WompiRemoteTransactionStatus;
  intentStatus: LocalPaymentIntentStatus;
  orderPaymentStatus: OrderPaymentStatus;
  orderOperationalStatus: DbOrderStatus;
  winningCaptureId: string | null;
  amountInCents: string;
  formattedAmountCop: string;
  idempotentReplay: boolean;
  effectiveFinancialMutation: boolean;
  isStaleOutOfOrder: boolean;
  incidentCode: FinancialIncidentCode | null;
  supportTicketCreated: boolean;
}

export interface ApplyCanonicalTransitionInput {
  canonicalTx: CanonicalWompiTransaction;
  source: "WEBHOOK" | "VERIFY" | "CHECKOUT_RECONCILIATION";
  expectedClientId?: string;
  webhookEvent?: {
    deduplicationKey: string;
    environment: "test";
    eventType: string;
    timestampEvento: number;
    checksumRecibido: string;
    resumenPayloadJson: string;
  };
  now?: Date;
}

interface LockedOrderRow {
  id: string;
  numeroOrden: string;
  estadoPago: string;
  pasarelaCaptureId: string | null;
  clienteId: string;
  reparadorId: string | null;
  estado: string;
  metodoPago: string;
  totalPreautorizado: Prisma.Decimal | string | number;
}

interface LockedAttemptRow {
  id: string;
  ordenId: string;
  referenciaWompi: string;
  montoEnCentavos: bigint | string | number;
  moneda: string;
  estado: string;
  estadoProveedor: string | null;
  wompiTransactionId: string | null;
  firmaIntegridad: string;
  metodoPagoReportado: string | null;
  datosRespuestaJson: string | null;
  creadoEn: Date;
}

export function assertVerifiedClientActor(
  actor: OrderActor | null | undefined
): asserts actor is OrderActor {
  if (!actor || !actor.id) {
    throw new WompiServiceError(
      "Debes iniciar sesión para gestionar pagos.",
      401,
      "UNAUTHENTICATED"
    );
  }
  if (actor.estado === "SUSPENDIDO" || actor.estado === "RECHAZADO") {
    throw new WompiServiceError(
      "Tu cuenta no se encuentra habilitada para operar.",
      403,
      "ACCOUNT_DISABLED"
    );
  }
  if (actor.rol !== "CLIENTE") {
    throw new WompiServiceError(
      "Solo el cliente titular puede iniciar o verificar pagos de órdenes.",
      403,
      "FORBIDDEN_ROLE"
    );
  }
  if (actor.estado !== "VERIFICADO") {
    throw new WompiServiceError(
      "Debes verificar tu correo electrónico antes de procesar un pago.",
      403,
      "CLIENT_NOT_VERIFIED"
    );
  }
}

/**
 * Detecta si un hostname corresponde a localhost, loopback, subdominios locales o rangos privados.
 */
export function isLocalOrPrivateHostname(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  if (
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  if (host.startsWith("::ffff:127.")) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [, a, b, c, d] = ipv4.map(Number);
    if (a > 255 || b > 255 || c > 255 || d > 255) return false;
    if (a === 0 && b === 0 && c === 0 && d === 0) return true;
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
  }
  return false;
}

/**
 * Función pura y centralizada para determinar si el Web Checkout de Wompi debe
 * incluir o no el parámetro `redirect-url`, cumpliendo las directivas de seguridad:
 * - Origen local o privado -> omitir el parámetro en test / error controlado en estricto.
 * - Origen público válido (https://) -> incluir la URL de retorno construida de forma segura.
 * - Origen inválido o ausente -> error en estricto / advertencia en test omitiendo el parámetro.
 */
export function resolveWompiCheckoutRedirectUrl(
  configuredBase: string | null | undefined,
  environment: string | null | undefined,
  pathSuffix = "/pagos/resultado"
): string | undefined {
  const isTest = environment === "test";
  const rawBase =
    typeof configuredBase === "string" ? configuredBase.trim() : "";

  if (!rawBase) {
    if (!isTest) {
      console.error(
        "[Wompi][CheckoutRedirect] Configuración de URL base ausente en modo estricto."
      );
      throw new WompiServiceError(
        "Error de configuración de la pasarela de pagos.",
        500,
        "INVALID_CHECKOUT_CONFIG",
        false
      );
    }
    console.warn(
      "[Wompi][WARN] APP_BASE_URL no configurado en entorno de pruebas; se omite redirect-url."
    );
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawBase);
  } catch {
    if (!isTest) {
      console.error(
        "[Wompi][CheckoutRedirect] Formato de URL base inválido en modo estricto."
      );
      throw new WompiServiceError(
        "Error de configuración de la pasarela de pagos.",
        500,
        "INVALID_CHECKOUT_CONFIG",
        false
      );
    }
    console.warn(
      "[Wompi][WARN] APP_BASE_URL malformado en pruebas; se omite redirect-url."
    );
    return undefined;
  }

  const hasCredentials = Boolean(parsed.username || parsed.password);
  const hasCustomPath = Boolean(parsed.pathname && parsed.pathname !== "/");
  const hasQuery = Boolean(parsed.search && parsed.search !== "");
  const hasHash = Boolean(parsed.hash && parsed.hash !== "");
  const isHttpOrHttps =
    parsed.protocol === "http:" || parsed.protocol === "https:";

  if (
    !isHttpOrHttps ||
    hasCredentials ||
    hasCustomPath ||
    hasQuery ||
    hasHash
  ) {
    if (!isTest) {
      console.error(
        "[Wompi][CheckoutRedirect] Origen base no cumple la estructura de origen puro sin path/credenciales/query."
      );
      throw new WompiServiceError(
        "Error de configuración de la pasarela de pagos.",
        500,
        "INVALID_CHECKOUT_CONFIG",
        false
      );
    }
    console.warn(
      "[Wompi][WARN] APP_BASE_URL no cumple los requisitos de origen seguro en pruebas; se omite redirect-url."
    );
    return undefined;
  }

  const isLocal = isLocalOrPrivateHostname(parsed.hostname);

  if (parsed.protocol === "http:" && !isLocal) {
    if (!isTest) {
      console.error(
        "[Wompi][CheckoutRedirect] Origen no local con HTTP no cifrado no permitido en producción."
      );
      throw new WompiServiceError(
        "Error de configuración de la pasarela de pagos.",
        500,
        "INVALID_CHECKOUT_CONFIG",
        false
      );
    }
    console.warn(
      "[Wompi][WARN] Protocolo http no seguro en host no local; se omite redirect-url."
    );
    return undefined;
  }

  if (isLocal) {
    if (!isTest) {
      console.error(
        "[Wompi][CheckoutRedirect] Origen local o privado no permitido en entorno de producción."
      );
      throw new WompiServiceError(
        "Error de configuración de la pasarela de pagos.",
        500,
        "INVALID_CHECKOUT_CONFIG",
        false
      );
    }
    return undefined;
  }

  if (parsed.protocol === "https:") {
    const cleanPath = pathSuffix.startsWith("/")
      ? pathSuffix
      : `/${pathSuffix}`;
    const returnUrl = new URL(cleanPath, parsed.origin);
    return returnUrl.toString();
  }

  if (!isTest) {
    throw new WompiServiceError(
      "Error de configuración de la pasarela de pagos.",
      500,
      "INVALID_CHECKOUT_CONFIG",
      false
    );
  }
  return undefined;
}

export function resolveValidatedRedirectUrl(
  env: Readonly<Record<string, string | undefined>>,
  _requestOrigin?: string | null,
  pathSuffix = "/pagos/resultado"
): string | undefined {
  const configuredBase =
    (typeof env.APP_BASE_URL === "string" && env.APP_BASE_URL.trim()) ||
    (typeof env.NEXT_PUBLIC_APP_URL === "string" &&
      env.NEXT_PUBLIC_APP_URL.trim()) ||
    "";
  const environment = env.WOMPI_ENVIRONMENT;
  return resolveWompiCheckoutRedirectUrl(configuredBase, environment, pathSuffix);
}

export function parseAttemptMetadata(
  rawJson: string | null | undefined,
  fallbackCreatedAt: Date
): WompiAttemptMetadataV1 {
  const defaultCreatedAtIso = fallbackCreatedAt.toISOString();
  const defaultExpirationTime = new Date(
    fallbackCreatedAt.getTime() + WOMPI_CHECKOUT_EXPIRATION_MS
  ).toISOString();

  const fallback: WompiAttemptMetadataV1 = {
    version: 1,
    attemptSequence: 1,
    createdAtIso: defaultCreatedAtIso,
    expirationTime: defaultExpirationTime,
    redirectUrl: "",
    observations: [],
    archivedTransactionIds: [],
    lastAnomalyCode: null,
  };

  if (!rawJson || typeof rawJson !== "string" || !rawJson.trim()) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback;
    }
    const obj = parsed as Record<string, unknown>;
    const combined = combineTransactionObservations(
      Array.isArray(obj.observations) ? { observations: obj.observations } : null,
      []
    );
    const attemptSequence =
      typeof obj.attemptSequence === "number" &&
      Number.isSafeInteger(obj.attemptSequence) &&
      obj.attemptSequence >= 1
        ? obj.attemptSequence
        : 1;
    const createdAtIso =
      typeof obj.createdAtIso === "string" && !Number.isNaN(Date.parse(obj.createdAtIso))
        ? new Date(Date.parse(obj.createdAtIso)).toISOString()
        : defaultCreatedAtIso;
    const expirationTime =
      typeof obj.expirationTime === "string" &&
      !Number.isNaN(Date.parse(obj.expirationTime))
        ? new Date(Date.parse(obj.expirationTime)).toISOString()
        : defaultExpirationTime;
    const redirectUrl =
      typeof obj.redirectUrl === "string" ? obj.redirectUrl.trim() : "";
    const archivedTransactionIds = Array.isArray(obj.archivedTransactionIds)
      ? obj.archivedTransactionIds.filter(
          (item): item is string => typeof item === "string" && item.length > 0
        )
      : [];
    const lastAnomalyCode =
      typeof obj.lastAnomalyCode === "string" && obj.lastAnomalyCode.trim()
        ? obj.lastAnomalyCode.trim()
        : null;

    return {
      version: 1,
      attemptSequence,
      createdAtIso,
      expirationTime,
      redirectUrl,
      observations: combined.observations,
      archivedTransactionIds,
      lastAnomalyCode,
    };
  } catch {
    return fallback;
  }
}

export function toBigIntCents(raw: bigint | string | number): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") return BigInt(Math.trunc(raw));
  return BigInt(raw.trim());
}

export function validateRemoteStatus(raw: string): WompiRemoteTransactionStatus {
  const upper = raw.trim().toUpperCase();
  if (
    upper === "PENDING" ||
    upper === "APPROVED" ||
    upper === "DECLINED" ||
    upper === "ERROR" ||
    upper === "VOIDED"
  ) {
    return upper;
  }
  throw new WompiServiceError(
    `Estado remoto de Wompi desconocido: "${upper}".`,
    502,
    "UNKNOWN_WOMPI_STATUS",
    false
  );
}

export function mapPolicyErrorToServiceError(err: unknown): WompiServiceError {
  if (err instanceof WompiServiceError) return err;
  if (err instanceof PaymentPolicyError) {
    const isConfigIssue =
      err.code.includes("WOMPI_") ||
      err.code === "PUBLIC_EXPOSURE_RISK" ||
      err.code === "PRODUCTION_CREDENTIAL_REJECTED" ||
      err.code === "NON_SANDBOX_ENVIRONMENT" ||
      err.code === "NON_SANDBOX_API_HOST" ||
      err.code === "CONTRADICTORY_WOMPI_API_URL";
    return new WompiServiceError(
      err.message,
      isConfigIssue ? 500 : 400,
      err.code,
      false
    );
  }
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "OrderPolicyError"
  ) {
    const orderErr = err as { message: string; status?: number; code?: string };
    return new WompiServiceError(
      orderErr.message,
      orderErr.status ?? 422,
      orderErr.code ?? "ORDER_POLICY_ERROR",
      false
    );
  }
  return new WompiServiceError(
    "Error interno al procesar la operación de pago.",
    500,
    "INTERNAL_PAYMENT_ERROR",
    false
  );
}

/**
 * Consulta la transacción canónica directamente en Wompi Sandbox (`GET /v1/transactions/{id}`)
 * utilizando `WOMPI_PRIVATE_KEY`.
 *
 * REGLA P0: Prohibido invocar esta función dentro de una transacción de base de datos.
 */
export async function fetchWompiCanonicalTransaction(
  transactionId: string,
  options?: WompiRuntimeOptions
): Promise<CanonicalWompiTransaction> {
  const env = options?.env ?? process.env;
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const nowFn = options?.now ?? (() => new Date());

  const cleanId = typeof transactionId === "string" ? transactionId.trim() : "";
  if (!CANONICAL_TRANSACTION_ID_REGEX.test(cleanId)) {
    throw new WompiServiceError(
      "El identificador de la transacción de Wompi no es válido.",
      400,
      "INVALID_TRANSACTION_ID",
      false
    );
  }

  let config;
  try {
    config = validateWompiEnvironmentConfig(env);
  } catch (err) {
    throw mapPolicyErrorToServiceError(err);
  }

  const endpoint = `${config.apiBaseUrl}/transactions/${encodeURIComponent(cleanId)}`;

  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.privateKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(WOMPI_HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = safeTruncateErrorDetail(err, 120);
    throw new WompiNetworkError(
      `No fue posible conectar con Wompi Sandbox para consultar la transacción${
        detail ? ` (${detail})` : ""
      }.`
    );
  }

  if (response.status === 404) {
    throw new WompiServiceError(
      "La transacción solicitada no existe en Wompi Sandbox.",
      404,
      "WOMPI_TRANSACTION_NOT_FOUND",
      false
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new WompiServiceError(
      "Wompi Sandbox rechazó la autenticación del servidor.",
      502,
      "WOMPI_UPSTREAM_AUTH_ERROR",
      false
    );
  }

  if (response.status === 429 || response.status >= 500) {
    throw new WompiNetworkError(
      `Wompi Sandbox respondió de forma transitoria con HTTP ${response.status}.`
    );
  }

  if (!response.ok) {
    throw new WompiServiceError(
      `Respuesta inesperada de Wompi Sandbox (HTTP ${response.status}).`,
      502,
      "WOMPI_UPSTREAM_BAD_RESPONSE",
      false
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    throw new WompiNetworkError(
      "Wompi Sandbox devolvió una respuesta JSON ilegible."
    );
  }

  if (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)) {
    const rootObj = rawBody as Record<string, unknown>;
    const dataObj =
      rootObj.data && typeof rootObj.data === "object" && !Array.isArray(rootObj.data)
        ? (rootObj.data as Record<string, unknown>)
        : rootObj;
    const reportedEnv =
      typeof dataObj.environment === "string"
        ? dataObj.environment.trim().toLowerCase()
        : typeof rootObj.environment === "string"
        ? rootObj.environment.trim().toLowerCase()
        : null;
    if (reportedEnv && reportedEnv !== "test") {
      throw new WompiServiceError(
        "La transacción consultada no pertenece al ambiente Sandbox ('test').",
        422,
        "NON_SANDBOX_TRANSACTION",
        false
      );
    }
  }

  let snapshot: SanitizedWompiTransactionSnapshot;
  try {
    snapshot = sanitizeWompiTransactionSnapshot(rawBody, nowFn());
  } catch (err) {
    throw mapPolicyErrorToServiceError(err);
  }

  const remoteStatus = validateRemoteStatus(snapshot.status);
  const amountInCents = BigInt(snapshot.amountInCents);

  return {
    id: snapshot.id,
    reference: snapshot.reference,
    status: remoteStatus,
    amountInCents,
    currency: snapshot.currency,
    paymentMethodType: snapshot.paymentMethodType,
    statusMessage: snapshot.statusMessage,
    createdAt: snapshot.createdAt,
    finalizedAt: snapshot.finalizedAt,
    snapshot,
  };
}

function buildAnomalyTicketSpec(params: {
  incidentCode: FinancialIncidentCode;
  orderId: string;
  orderNumber: string;
  transactionId: string;
  winningCaptureId: string | null;
}): {
  dedupSubjectMarker: string;
  asunto: string;
  descripcion: string;
} | null {
  const { incidentCode, orderId, orderNumber, transactionId, winningCaptureId } =
    params;

  if (
    incidentCode === "DOBLE_COBRO_POST_CONSOLIDACION" ||
    incidentCode === "DOBLE_COBRO_PRE_CONSOLIDACION" ||
    incidentCode === "DOBLE_COBRO_DISTINTOS_INTENTOS_MISMA_ORDEN"
  ) {
    return {
      dedupSubjectMarker: "Doble cobro",
      asunto: `ALERTA: Doble cobro detectado en Wompi (${transactionId})`.slice(
        0,
        150
      ),
      descripcion: `Segunda transacción aprobada (${transactionId}) para la orden ${orderNumber} (${orderId}). Código de anomalía: ${incidentCode}. Captura ganadora retenida: ${
        winningCaptureId ?? "N/A"
      }. Requiere conciliación financiera.`,
    };
  }

  if (
    incidentCode === "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION" ||
    incidentCode === "ANOMALIA_VOIDED_CON_SEGUNDA_APROBACION_MISMA_REFERENCIA"
  ) {
    return {
      dedupSubjectMarker: "VOIDED->APPROVED",
      asunto: `ALERTA: Anomalía VOIDED->APPROVED en Wompi (${transactionId})`.slice(
        0,
        150
      ),
      descripcion: `Se recibió estado canónico APPROVED para la transacción ${transactionId} en la orden ${orderNumber} (${orderId}) después de haber sido registrada como ANULADO (VOIDED). El intento quedó retenido en PENDIENTE_CONCILIACION sin reactivar automáticamente la captura. Captura ganadora actual: ${
        winningCaptureId ?? "ninguna"
      }.`,
    };
  }

  if (incidentCode === "ANULACION_PASARELA_POST_APROBACION") {
    return {
      dedupSubjectMarker: "Anulación post-asignación",
      asunto: `ALERTA: Anulación post-asignación en Wompi (${transactionId})`.slice(
        0,
        150
      ),
      descripcion: `La pasarela reportó VOIDED sobre la transacción ${transactionId} de la orden ${orderNumber} (${orderId}) cuando ya existía un reparador asignado. La orden pasó a estadoPago FALLIDO y se bloqueó el inicio por OTP.`,
    };
  }

  if (incidentCode === "COBRO_TARDIO_ORDEN_CANCELADA") {
    return {
      dedupSubjectMarker: "Cobro tardío",
      asunto: `ALERTA: Cobro tardío en orden cancelada (${transactionId})`.slice(
        0,
        150
      ),
      descripcion: `Se recibió aprobación tardía (${transactionId}) sobre la orden ya cancelada ${orderNumber} (${orderId}). Requiere revisión de reembolso manual.`,
    };
  }

  return null;
}

async function generateUniqueTicketNumberInTx(
  tx: Prisma.TransactionClient,
  now: Date
): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const candidate = generateTicketNumber(now);
    const exists = await tx.ticketSoporte.findUnique({
      where: { numeroTicket: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `TCK-${now.getTime().toString().slice(-8)}-${randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;
}

/**
 * Aplica de forma atómica, determinista e idempotente el estado canónico obtenido de Wompi
 * sobre PostgreSQL usando bloqueo pesimista `Prisma.sql` (`SELECT ... FOR UPDATE`).
 */
export async function applyCanonicalTransactionTransition(
  db: PrismaClient,
  input: ApplyCanonicalTransitionInput
): Promise<CanonicalTransitionOutcome> {
  const { canonicalTx } = input;
  const now = input.now ?? new Date();

  if (canonicalTx.currency !== WOMPI_CURRENCY_COP) {
    throw new WompiServiceError(
      `Moneda no soportada en transacción canónica: "${canonicalTx.currency}".`,
      422,
      "UNSUPPORTED_CURRENCY",
      false
    );
  }

  return await db.$transaction(
    async (tx) => {
      let webhookEventRowId: string | null = null;

      // 1. Deduplicación atómica de eventos Webhook dentro de la misma transacción interactiva
      if (input.webhookEvent) {
        const wh = input.webhookEvent;
        const candidateEventId = randomUUID();
        const inserted = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            INSERT INTO "eventos_webhook_wompi" (
              "id",
              "claveDeduplicacion",
              "ambiente",
              "tipoEvento",
              "timestampEvento",
              "wompiTransactionId",
              "checksumRecibido",
              "resumenPayloadJson",
              "procesadoExitoso",
              "errorProcesamiento",
              "creadoEn"
            ) VALUES (
              ${candidateEventId}::uuid,
              ${wh.deduplicationKey},
              ${wh.environment},
              ${wh.eventType},
              ${wh.timestampEvento},
              ${canonicalTx.id},
              ${wh.checksumRecibido},
              ${wh.resumenPayloadJson},
              false,
              NULL,
              ${now}
            )
            ON CONFLICT ("claveDeduplicacion") DO NOTHING
            RETURNING "id"
          `
        );

        if (inserted.length === 1) {
          webhookEventRowId = inserted[0].id;
        } else {
          const existingEvents = await tx.$queryRaw<
            Array<{ id: string; procesadoExitoso: boolean }>
          >(
            Prisma.sql`
              SELECT "id", "procesadoExitoso"
              FROM "eventos_webhook_wompi"
              WHERE "claveDeduplicacion" = ${wh.deduplicationKey}
              FOR UPDATE
            `
          );

          const lockedEvent = existingEvents[0];
          if (!lockedEvent) {
            throw new WompiServiceError(
              "No fue posible bloquear el registro de deduplicación del webhook.",
              500,
              "WEBHOOK_DEDUP_LOCK_ERROR",
              true
            );
          }

          if (lockedEvent.procesadoExitoso) {
            const existingAttempt = await tx.intentoPagoWompi.findUnique({
              where: { referenciaWompi: canonicalTx.reference },
              include: {
                orden: {
                  select: {
                    id: true,
                    numeroOrden: true,
                    estado: true,
                    estadoPago: true,
                    pasarelaCaptureId: true,
                  },
                },
              },
            });

            if (!existingAttempt) {
              throw new WompiServiceError(
                "Intento de pago no encontrado para evento previamente procesado.",
                404,
                "ATTEMPT_REFERENCE_NOT_FOUND",
                false
              );
            }

            if (!existingAttempt.orden) {
              throw new WompiServiceError(
                "El intento de pago no está asociado a una orden de servicio.",
                400,
                "ATTEMPT_NOT_ORDER_BOUND",
                false
              );
            }

            const cents = toBigIntCents(existingAttempt.montoEnCentavos);
            return {
              orderId: existingAttempt.orden.id,
              orderNumber: existingAttempt.orden.numeroOrden,
              intentId: existingAttempt.id,
              reference: existingAttempt.referenciaWompi,
              transactionId:
                existingAttempt.wompiTransactionId ?? canonicalTx.id,
              providerStatus: validateRemoteStatus(
                existingAttempt.estadoProveedor ?? canonicalTx.status
              ),
              intentStatus: existingAttempt.estado as LocalPaymentIntentStatus,
              orderPaymentStatus:
                existingAttempt.orden.estadoPago as OrderPaymentStatus,
              orderOperationalStatus:
                existingAttempt.orden.estado as DbOrderStatus,
              winningCaptureId: existingAttempt.orden.pasarelaCaptureId,
              amountInCents: cents.toString(),
              formattedAmountCop: formatWompiCentsToCop(cents),
              idempotentReplay: true,
              effectiveFinancialMutation: false,
              isStaleOutOfOrder: false,
              incidentCode: null,
              supportTicketCreated: false,
            };
          }

          // procesadoExitoso === false: recuperación limpia bajo bloqueo FOR UPDATE
          webhookEventRowId = lockedEvent.id;
        }
      }

      // 2. Localizar ordenId por referencia para adquirir bloqueos en orden jerárquico libre de deadlocks:
      //    1º ordenes_servicio FOR UPDATE -> 2º intentos_pago_wompi ORDER BY id ASC FOR UPDATE
      const attemptLookup = await tx.intentoPagoWompi.findUnique({
        where: { referenciaWompi: canonicalTx.reference },
        select: { id: true, ordenId: true },
      });

      if (!attemptLookup) {
        if (input.expectedClientId) {
          throw new WompiServiceError(
            "No se encontró la transacción solicitada.",
            404,
            "TRANSACTION_NOT_FOUND",
            false
          );
        }
        throw new WompiServiceError(
          "La referencia de la transacción no corresponde a ningún intento registrado.",
          404,
          "ATTEMPT_REFERENCE_NOT_FOUND",
          false
        );
      }

      const lockedOrders = await tx.$queryRaw<LockedOrderRow[]>(
        Prisma.sql`
          SELECT
            "id",
            "numeroOrden",
            "estadoPago"::text AS "estadoPago",
            "pasarelaCaptureId",
            "clienteId",
            "reparadorId",
            "estado"::text AS "estado",
            "metodoPago"::text AS "metodoPago",
            "totalPreautorizado"
          FROM "ordenes_servicio"
          WHERE "id" = ${attemptLookup.ordenId}::uuid
          FOR UPDATE
        `
      );

      const order = lockedOrders[0];
      if (!order) {
        throw new WompiServiceError(
          "No se encontró la transacción solicitada.",
          404,
          "TRANSACTION_NOT_FOUND",
          false
        );
      }

      // Protección anti-enumeración en VERIFY: respuesta 404 uniforme si pertenece a otro usuario
      if (input.expectedClientId && order.clienteId !== input.expectedClientId) {
        throw new WompiServiceError(
          "No se encontró la transacción solicitada.",
          404,
          "TRANSACTION_NOT_FOUND",
          false
        );
      }

      const lockedAttempts = await tx.$queryRaw<LockedAttemptRow[]>(
        Prisma.sql`
          SELECT
            "id",
            "ordenId",
            "referenciaWompi",
            "montoEnCentavos",
            "moneda",
            "estado"::text AS "estado",
            "estadoProveedor",
            "wompiTransactionId",
            "firmaIntegridad",
            "metodoPagoReportado",
            "datosRespuestaJson",
            "creadoEn"
          FROM "intentos_pago_wompi"
          WHERE "ordenId" = ${order.id}::uuid
          ORDER BY "id" ASC
          FOR UPDATE
        `
      );

      const targetAttempt = lockedAttempts.find(
        (item) => item.referenciaWompi === canonicalTx.reference
      );
      if (!targetAttempt) {
        throw new WompiServiceError(
          "El intento de pago asociado a la referencia no pudo ser bloqueado.",
          404,
          "ATTEMPT_REFERENCE_NOT_FOUND",
          false
        );
      }

      const expectedCents = toBigIntCents(targetAttempt.montoEnCentavos);
      if (
        canonicalTx.amountInCents !== expectedCents ||
        canonicalTx.currency !== targetAttempt.moneda.trim().toUpperCase()
      ) {
        throw new WompiServiceError(
          "Inconsistencia crítica: el monto en centavos o la moneda de Wompi no coincide con el intento firmado.",
          422,
          "AMOUNT_OR_CURRENCY_MISMATCH",
          false
        );
      }

      const existingMeta = parseAttemptMetadata(
        targetAttempt.datosRespuestaJson,
        targetAttempt.creadoEn
      );
      const siblingAttempts = lockedAttempts.filter(
        (item) => item.id !== targetAttempt.id
      );

      // Identificar transacciones paralelas activas o aprobadas en otros intentos de la misma orden
      const parallelTransactions: Array<{
        id: string;
        status: WompiRemoteTransactionStatus;
      }> = [];
      let secondaryApprovalsCount = 0;

      for (const sibling of siblingAttempts) {
        const sibProv = sibling.estadoProveedor
          ? sibling.estadoProveedor.trim().toUpperCase()
          : "";
        if (
          sibling.estado === "APROBADO" ||
          sibProv === "APPROVED"
        ) {
          secondaryApprovalsCount += 1;
          parallelTransactions.push({
            id: sibling.wompiTransactionId ?? `intent-${sibling.id}`,
            status: "APPROVED",
          });
        } else if (
          sibling.wompiTransactionId &&
          (sibling.estado === "PENDIENTE" || sibProv === "PENDING")
        ) {
          parallelTransactions.push({
            id: sibling.wompiTransactionId,
            status: "PENDING",
          });
        }
      }

      if (
        order.pasarelaCaptureId &&
        order.pasarelaCaptureId !== canonicalTx.id &&
        secondaryApprovalsCount === 0
      ) {
        secondaryApprovalsCount = 1;
        parallelTransactions.push({
          id: order.pasarelaCaptureId,
          status: "APPROVED",
        });
      }

      const openConciliationCount = siblingAttempts.filter(
        (s) => s.estado === "PENDIENTE_CONCILIACION"
      ).length;

      const sameTxId =
        targetAttempt.wompiTransactionId === null ||
        targetAttempt.wompiTransactionId === canonicalTx.id;

      let nextProviderStatus: WompiRemoteTransactionStatus;
      let nextIntentStatus: LocalPaymentIntentStatus;
      let nextOrderPaymentStatus: OrderPaymentStatus;
      let nextWinningCaptureId: string | null = order.pasarelaCaptureId;
      let linkedTransactionId: string = canonicalTx.id;
      let idempotentReplay = false;
      let effectiveFinancialMutation = false;
      let isStaleOutOfOrder = false;
      let incidentCode: FinancialIncidentCode | null = null;
      const archivedTxIds = new Set(existingMeta.archivedTransactionIds);

      if (sameTxId) {
        const providerRes = resolveCanonicalProviderStatus({
          previousProviderStatus: targetAttempt.estadoProveedor,
          incomingRemoteStatus: canonicalTx.status,
          sameTransactionId: true,
        });
        nextProviderStatus = providerRes.nextProviderStatus;
        isStaleOutOfOrder = providerRes.isStaleOutOfOrder;

        const alreadyObservedSameRemote =
          targetAttempt.wompiTransactionId === canonicalTx.id &&
          (targetAttempt.estadoProveedor ?? "").toUpperCase() ===
            canonicalTx.status;

        // Replay idempotente sobre intento ya retenido en PENDIENTE_CONCILIACION con APPROVED
        if (
          targetAttempt.estado === "PENDIENTE_CONCILIACION" &&
          alreadyObservedSameRemote &&
          canonicalTx.status === "APPROVED"
        ) {
          nextIntentStatus = "PENDIENTE_CONCILIACION";
          nextOrderPaymentStatus = order.estadoPago as OrderPaymentStatus;
          idempotentReplay = true;
          effectiveFinancialMutation = false;
          incidentCode =
            (existingMeta.lastAnomalyCode as FinancialIncidentCode | null) ??
            null;
        } else {
          const transition = evaluateSameTransactionTransition({
            localIntentStatus: targetAttempt.estado as LocalPaymentIntentStatus,
            remoteStatus: canonicalTx.status,
            alreadyObservedSameRemoteStatus: alreadyObservedSameRemote,
            orderOperationalStatus: order.estado as OrderOperationalStatus,
            orderPaymentStatus: order.estadoPago as OrderPaymentStatus,
            reparadorId: order.reparadorId,
            parallelTransactions,
            openFinancialIncidentsCount: openConciliationCount,
            secondaryApprovalsCount,
          });

          nextIntentStatus = transition.nextIntentStatus;
          nextOrderPaymentStatus = transition.nextOrderPaymentStatus;
          idempotentReplay = transition.idempotentReplay;
          effectiveFinancialMutation = transition.effectiveFinancialMutation;
          incidentCode = transition.incidentToOpen;

          // Asignación o preservación de la captura ganadora
          if (
            canonicalTx.status === "APPROVED" &&
            nextIntentStatus === "APROBADO" &&
            nextOrderPaymentStatus === "CAPTURADO"
          ) {
            if (!nextWinningCaptureId) {
              nextWinningCaptureId = canonicalTx.id;
            }
          } else if (canonicalTx.status === "VOIDED") {
            if (nextWinningCaptureId === canonicalTx.id) {
              nextWinningCaptureId = null;
            }
          }
        }
      } else {
        // Dos IDs de transacción distintos observados bajo la misma referencia
        const prevTxId = targetAttempt.wompiTransactionId!;
        const prevStatus = validateRemoteStatus(
          targetAttempt.estadoProveedor ?? "PENDING"
        );
        const prevObs = existingMeta.observations.find(
          (obs) => obs.id === prevTxId
        );

        const f3 = evaluateDistinctTransactionsTransition({
          currentTx: {
            id: prevTxId,
            status: prevStatus,
            createdAt: prevObs?.createdAt ?? null,
            finalizedAt: prevObs?.finalizedAt ?? null,
          },
          incomingTx: {
            id: canonicalTx.id,
            status: canonicalTx.status,
            createdAt: canonicalTx.createdAt,
            finalizedAt: canonicalTx.finalizedAt,
          },
          orderOperationalStatus: order.estado as OrderOperationalStatus,
          orderPaymentStatus: order.estadoPago as OrderPaymentStatus,
          reparadorId: order.reparadorId,
          otherParallelTransactions: parallelTransactions,
          openFinancialIncidentsCount: openConciliationCount,
        });

        linkedTransactionId = f3.linkedTransactionId;
        archivedTxIds.add(f3.archivedTransactionId);
        nextProviderStatus =
          f3.linkedTransactionId === canonicalTx.id
            ? canonicalTx.status
            : prevStatus;
        nextIntentStatus = f3.nextIntentStatus;
        nextOrderPaymentStatus = f3.nextOrderPaymentStatus;
        effectiveFinancialMutation = f3.effectiveFinancialMutation;
        incidentCode = f3.incidentToOpen;
        isStaleOutOfOrder =
          f3.rowCode === "ROW_4_APPROVED_PLUS_FAILED_OUT_OF_ORDER";

        if (
          nextIntentStatus === "APROBADO" &&
          nextOrderPaymentStatus === "CAPTURADO" &&
          !nextWinningCaptureId
        ) {
          nextWinningCaptureId = linkedTransactionId;
        }
      }

      const combinedObservations = combineTransactionObservations(
        { observations: existingMeta.observations },
        canonicalTx.snapshot
      );

      const updatedMetadata: WompiAttemptMetadataV1 = {
        version: 1,
        attemptSequence: existingMeta.attemptSequence,
        createdAtIso: existingMeta.createdAtIso,
        expirationTime: existingMeta.expirationTime,
        redirectUrl: existingMeta.redirectUrl,
        observations: combinedObservations.observations,
        archivedTransactionIds: [...archivedTxIds],
        lastAnomalyCode: incidentCode ?? existingMeta.lastAnomalyCode,
      };

      await tx.intentoPagoWompi.update({
        where: { id: targetAttempt.id },
        data: {
          wompiTransactionId: linkedTransactionId,
          estadoProveedor: nextProviderStatus,
          estado: nextIntentStatus,
          metodoPagoReportado:
            canonicalTx.paymentMethodType ?? targetAttempt.metodoPagoReportado,
          datosRespuestaJson: JSON.stringify(updatedMetadata),
          actualizadoEn: now,
        },
      });

      const orderChanged =
        order.estadoPago !== nextOrderPaymentStatus ||
        order.pasarelaCaptureId !== nextWinningCaptureId;

      if (orderChanged) {
        await tx.ordenServicio.update({
          where: { id: order.id },
          data: {
            estadoPago: nextOrderPaymentStatus as
              | "PENDIENTE"
              | "PREAUTORIZADO"
              | "CAPTURADO"
              | "LIBERADO"
              | "REEMBOLSADO"
              | "FALLIDO",
            pasarelaCaptureId: nextWinningCaptureId,
          },
        });
      }

      if (order.estadoPago !== nextOrderPaymentStatus) {
        const motivo = `Actualización canónica Wompi (${canonicalTx.id}, ${canonicalTx.status}): estadoPago ${order.estadoPago} -> ${nextOrderPaymentStatus}.`.slice(
          0,
          255
        );
        await tx.ordenTrazabilidad.create({
          data: {
            ordenId: order.id,
            estadoAnterior: order.estado as DbOrderStatus,
            estadoNuevo: order.estado as DbOrderStatus,
            cambiadoPorUsuarioId: order.clienteId,
            rolOperador: "CLIENTE",
            motivoCambio: motivo,
            creadoEn: now,
          },
        });
      }

      // 3. Apertura idempotente y específica de ticket crítico de soporte bajo el bloqueo de la orden
      let supportTicketCreated = false;
      if (incidentCode) {
        const ticketSpec = buildAnomalyTicketSpec({
          incidentCode,
          orderId: order.id,
          orderNumber: order.numeroOrden,
          transactionId: canonicalTx.id,
          winningCaptureId: nextWinningCaptureId,
        });

        if (ticketSpec) {
          const existingTicket = await tx.ticketSoporte.findFirst({
            where: {
              ordenId: order.id,
              categoria: "DISPUTA_COSTO",
              estado: "ABIERTO",
              asunto: { contains: ticketSpec.dedupSubjectMarker },
              descripcion: { contains: canonicalTx.id },
            },
            select: { id: true },
          });

          if (!existingTicket) {
            const ticketNumber = await generateUniqueTicketNumberInTx(tx, now);
            await tx.ticketSoporte.create({
              data: {
                numeroTicket: ticketNumber,
                usuarioEmisorId: order.clienteId,
                ordenId: order.id,
                categoria: "DISPUTA_COSTO",
                prioridad: "CRITICA",
                estado: "ABIERTO",
                asunto: ticketSpec.asunto,
                descripcion: ticketSpec.descripcion,
                creadoEn: now,
                fechaLimiteSla: calculateSlaDeadline("CRITICA", now),
              },
            });
            supportTicketCreated = true;
          }
        }
      }

      if (webhookEventRowId) {
        await tx.eventoWebhookWompi.update({
          where: { id: webhookEventRowId },
          data: {
            procesadoExitoso: true,
            errorProcesamiento: null,
            wompiTransactionId: canonicalTx.id,
          },
        });
      }

      return {
        orderId: order.id,
        orderNumber: order.numeroOrden,
        intentId: targetAttempt.id,
        reference: targetAttempt.referenciaWompi,
        transactionId: linkedTransactionId,
        providerStatus: nextProviderStatus,
        intentStatus: nextIntentStatus,
        orderPaymentStatus: nextOrderPaymentStatus,
        orderOperationalStatus: order.estado as DbOrderStatus,
        winningCaptureId: nextWinningCaptureId,
        amountInCents: expectedCents.toString(),
        formattedAmountCop: formatWompiCentsToCop(expectedCents),
        idempotentReplay,
        effectiveFinancialMutation,
        isStaleOutOfOrder,
        incidentCode,
        supportTicketCreated,
      };
    },
    {
      maxWait: 10_000,
      timeout: 15_000,
    }
  );
}

/**
 * Prepara o reutiliza de forma determinista y bajo bloqueo pesimista los parámetros
 * firmados para el Web Checkout oficial de Wompi (`GET https://checkout.wompi.co/p/`).
 */
export async function prepareWompiWebCheckout(
  db: PrismaClient,
  actor: OrderActor | null | undefined,
  rawOrderId: unknown,
  options?: WompiRuntimeOptions
): Promise<PreparedWompiWebCheckout> {
  assertVerifiedClientActor(actor);

  if (!isValidUuid(rawOrderId)) {
    throw new WompiServiceError(
      "El identificador de la orden no es un UUID válido.",
      400,
      "INVALID_ORDER_ID",
      false
    );
  }
  const orderId = rawOrderId.trim();
  const env = options?.env ?? process.env;
  const nowFn = options?.now ?? (() => new Date());

  let config;
  try {
    config = validateWompiEnvironmentConfig(env);
  } catch (err) {
    throw mapPolicyErrorToServiceError(err);
  }

  const redirectUrl = resolveValidatedRedirectUrl(env, options?.requestOrigin);

  // Fase previa FUERA de transacción DB: si existe algún intento previo con wompiTransactionId
  // cuyo estado remoto aún esté pendiente o sin reconciliar, consultamos a Wompi primero.
  const preCheckOrder = await db.ordenServicio.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      clienteId: true,
      intentosPagoWompi: {
        select: {
          id: true,
          estado: true,
          estadoProveedor: true,
          wompiTransactionId: true,
        },
        orderBy: { creadoEn: "asc" },
      },
    },
  });

  if (!preCheckOrder || preCheckOrder.clienteId !== actor.id) {
    throw new WompiServiceError(
      "No se encontró la orden de servicio solicitada.",
      404,
      "ORDER_NOT_FOUND",
      false
    );
  }

  for (const existingAttempt of preCheckOrder.intentosPagoWompi) {
    if (!existingAttempt.wompiTransactionId) continue;
    const provUpper = (existingAttempt.estadoProveedor ?? "").toUpperCase();
    const needsRemoteReconciliation =
      existingAttempt.estado === "PENDIENTE" ||
      provUpper === "" ||
      provUpper === "PENDING";

    if (needsRemoteReconciliation) {
      const canonicalTx = await fetchWompiCanonicalTransaction(
        existingAttempt.wompiTransactionId,
        options
      );
      await applyCanonicalTransactionTransition(db, {
        canonicalTx,
        source: "CHECKOUT_RECONCILIATION",
        expectedClientId: actor.id,
        now: nowFn(),
      });
    }
  }

  // Fase transaccional bajo bloqueo pesimista FOR UPDATE en el mismo orden jerárquico
  return await db.$transaction(
    async (tx) => {
      const createdAt = nowFn();
      const nowMs = createdAt.getTime();

      const lockedOrders = await tx.$queryRaw<LockedOrderRow[]>(
        Prisma.sql`
          SELECT
            "id",
            "numeroOrden",
            "estadoPago"::text AS "estadoPago",
            "pasarelaCaptureId",
            "clienteId",
            "reparadorId",
            "estado"::text AS "estado",
            "metodoPago"::text AS "metodoPago",
            "totalPreautorizado"
          FROM "ordenes_servicio"
          WHERE "id" = ${orderId}::uuid
          FOR UPDATE
        `
      );

      const order = lockedOrders[0];
      if (!order || order.clienteId !== actor.id) {
        throw new WompiServiceError(
          "No se encontró la orden de servicio solicitada.",
          404,
          "ORDER_NOT_FOUND",
          false
        );
      }

      try {
        assertImplementedPaymentMethod(order.metodoPago as DbPaymentMethod);
      } catch (err) {
        throw mapPolicyErrorToServiceError(err);
      }
      if (order.metodoPago !== "TARJETA") {
        throw new WompiServiceError(
          `El checkout de Wompi solo aplica para órdenes con método TARJETA (actual: ${order.metodoPago}).`,
          422,
          "PAYMENT_METHOD_UNAVAILABLE",
          false
        );
      }

      if (order.estadoPago === "CAPTURADO") {
        throw new WompiServiceError(
          "Esta orden ya cuenta con un pago confirmado y capturado.",
          409,
          "ORDER_ALREADY_PAID",
          false
        );
      }

      if (order.estado !== "BUSCANDO" || order.reparadorId !== null) {
        throw new WompiServiceError(
          "Solo se puede iniciar el pago para órdenes activas pendientes de asignación.",
          409,
          "INVALID_ORDER_STATE_FOR_CHECKOUT",
          false
        );
      }

      let amountInCents: bigint;
      try {
        const rawCents = catalogUnitsToWompiCents(String(order.totalPreautorizado));
        amountInCents = validateChargeableWompiAmount(rawCents, {
          minAmountInCents: config.minChargeableCopCents,
        });
      } catch (err) {
        throw mapPolicyErrorToServiceError(err);
      }

      const lockedAttempts = await tx.$queryRaw<LockedAttemptRow[]>(
        Prisma.sql`
          SELECT
            "id",
            "ordenId",
            "referenciaWompi",
            "montoEnCentavos",
            "moneda",
            "estado"::text AS "estado",
            "estadoProveedor",
            "wompiTransactionId",
            "firmaIntegridad",
            "metodoPagoReportado",
            "datosRespuestaJson",
            "creadoEn"
          FROM "intentos_pago_wompi"
          WHERE "ordenId" = ${order.id}::uuid
          ORDER BY "id" ASC
          FOR UPDATE
        `
      );

      // 1. Verificar si existe un intento PENDIENTE sin transacción remota y vigente -> reutilizar sin recalcular
      const normalizedAttempts: Array<{
        row: LockedAttemptRow;
        effectiveStatus: LocalPaymentIntentStatus;
        meta: WompiAttemptMetadataV1;
      }> = [];

      for (const att of lockedAttempts) {
        const meta = parseAttemptMetadata(att.datosRespuestaJson, att.creadoEn);
        const expMs = Date.parse(meta.expirationTime);
        const isUnexpired =
          !Number.isNaN(expMs) &&
          nowMs + CHECKOUT_REUSE_SAFETY_MARGIN_MS < expMs;

        if (att.estado === "PENDIENTE" && att.wompiTransactionId === null) {
          if (
            isUnexpired &&
            toBigIntCents(att.montoEnCentavos) === amountInCents
          ) {
            const effectiveRedirect = meta.redirectUrl || redirectUrl;
            if (order.estadoPago === "FALLIDO") {
              await tx.ordenServicio.update({
                where: { id: order.id },
                data: { estadoPago: "PENDIENTE" },
              });
            }
            return {
              checkoutUrl: config.checkoutUrl,
              method: "GET" as const,
              orderId: order.id,
              orderNumber: order.numeroOrden,
              intentId: att.id,
              attemptSequence: meta.attemptSequence,
              amountInCents: amountInCents.toString(),
              formattedAmountCop: formatWompiCentsToCop(amountInCents),
              expirationTime: meta.expirationTime,
              reusedExistingAttempt: true,
              params: {
                "public-key": config.publicKey,
                currency: WOMPI_CURRENCY_COP,
                "amount-in-cents": amountInCents.toString(),
                reference: att.referenciaWompi,
                "signature:integrity": att.firmaIntegridad,
                "expiration-time": meta.expirationTime,
                ...(effectiveRedirect ? { "redirect-url": effectiveRedirect } : {}),
              },
            };
          }

          // Intento PENDIENTE sin transacción remota cuyo tiempo de expiración ya venció -> cerrar como ANULADO
          await tx.intentoPagoWompi.update({
            where: { id: att.id },
            data: {
              estado: "ANULADO",
              estadoProveedor: "EXPIRED_UNUSED",
              actualizadoEn: createdAt,
            },
          });
          normalizedAttempts.push({
            row: att,
            effectiveStatus: "ANULADO",
            meta,
          });
          continue;
        }

        normalizedAttempts.push({
          row: att,
          effectiveStatus: att.estado as LocalPaymentIntentStatus,
          meta,
        });
      }

      // 2. Evaluar elegibilidad de reintento administrado si ya hubo intentos previos
      if (normalizedAttempts.length > 0) {
        const latestStatusByTx: Record<string, WompiRemoteTransactionStatus> = {};
        let openConciliationCount = 0;

        for (const item of normalizedAttempts) {
          if (item.effectiveStatus === "PENDIENTE_CONCILIACION") {
            openConciliationCount += 1;
          }
          if (item.row.wompiTransactionId && item.row.estadoProveedor) {
            const up = item.row.estadoProveedor.trim().toUpperCase();
            if (
              up === "PENDING" ||
              up === "APPROVED" ||
              up === "DECLINED" ||
              up === "ERROR" ||
              up === "VOIDED"
            ) {
              latestStatusByTx[item.row.wompiTransactionId] = up;
            }
          }
        }

        const openFinancialTickets = await tx.ticketSoporte.count({
          where: {
            ordenId: order.id,
            categoria: "DISPUTA_COSTO",
            estado: "ABIERTO",
            OR: [
              { asunto: { contains: "Doble cobro" } },
              { asunto: { contains: "VOIDED->APPROVED" } },
            ],
          },
        });

        const eligibility = evaluateManagedRetryEligibility({
          orderOperationalStatus: order.estado as OrderOperationalStatus,
          orderPaymentStatus: order.estadoPago as OrderPaymentStatus,
          reparadorId: order.reparadorId,
          localAttemptStatuses: normalizedAttempts.map((a) => a.effectiveStatus),
          latestStatusByTransactionId: latestStatusByTx,
          openFinancialIncidentsCount:
            openConciliationCount + openFinancialTickets,
        });

        if (!eligibility.allowed) {
          if (
            eligibility.blockReason ===
              "REMOTE_TRANSACTION_STILL_PENDING_OR_APPROVED" ||
            eligibility.blockReason === "LOCAL_ATTEMPT_STILL_ACTIVE_OR_APPROVED"
          ) {
            throw new WompiServiceError(
              "Ya existe una transacción de pago en procesamiento o pendiente de conciliación para esta orden.",
              409,
              "PAYMENT_TRANSACTION_IN_PROGRESS",
              false
            );
          }
          throw new WompiServiceError(
            `No es posible generar un nuevo intento de pago (${eligibility.blockReason}).`,
            409,
            eligibility.blockReason ?? "RETRY_NOT_ALLOWED",
            false
          );
        }
      }

      // 3. Crear nuevo intento determinista con vencimiento exacto a 30 minutos
      const attemptSequence = normalizedAttempts.length + 1;
      const attemptId = randomUUID();
      const expirationTime = new Date(
        nowMs + WOMPI_CHECKOUT_EXPIRATION_MS
      ).toISOString();

      let reference: string;
      let signature: string;
      try {
        reference = generateWompiReference({
          orderNumber: order.numeroOrden,
          attemptSequence,
          attemptId,
        });
        signature = buildWompiIntegritySignature({
          reference,
          amountInCents,
          currency: WOMPI_CURRENCY_COP,
          integritySecret: config.integritySecret,
          expirationTime,
        });
      } catch (err) {
        throw mapPolicyErrorToServiceError(err);
      }

      const metadata: WompiAttemptMetadataV1 = {
        version: 1,
        attemptSequence,
        createdAtIso: createdAt.toISOString(),
        expirationTime,
        redirectUrl: redirectUrl ?? "",
        observations: [],
        archivedTransactionIds: [],
        lastAnomalyCode: null,
      };

      const createdAttempt = await tx.intentoPagoWompi.create({
        data: {
          id: attemptId,
          ordenId: order.id,
          referenciaWompi: reference,
          montoEnCentavos: amountInCents,
          moneda: WOMPI_CURRENCY_COP,
          estado: "PENDIENTE",
          estadoProveedor: null,
          ambiente: "test",
          wompiTransactionId: null,
          firmaIntegridad: signature,
          datosRespuestaJson: JSON.stringify(metadata),
          creadoEn: createdAt,
          actualizadoEn: createdAt,
        },
      });

      if (order.estadoPago !== "PENDIENTE") {
        await tx.ordenServicio.update({
          where: { id: order.id },
          data: {
            estadoPago: "PENDIENTE",
          },
        });
        await tx.ordenTrazabilidad.create({
          data: {
            ordenId: order.id,
            estadoAnterior: order.estado as DbOrderStatus,
            estadoNuevo: order.estado as DbOrderStatus,
            cambiadoPorUsuarioId: actor.id,
            rolOperador: "CLIENTE",
            motivoCambio: `Nuevo intento de pago Wompi #${attemptSequence} (${reference}); orden retorna a estadoPago PENDIENTE.`.slice(
              0,
              255
            ),
            creadoEn: createdAt,
          },
        });
      }

      return {
        checkoutUrl: config.checkoutUrl,
        method: "GET" as const,
        orderId: order.id,
        orderNumber: order.numeroOrden,
        intentId: createdAttempt.id,
        attemptSequence,
        amountInCents: amountInCents.toString(),
        formattedAmountCop: formatWompiCentsToCop(amountInCents),
        expirationTime,
        reusedExistingAttempt: false,
        params: {
          "public-key": config.publicKey,
          currency: WOMPI_CURRENCY_COP,
          "amount-in-cents": amountInCents.toString(),
          reference,
          "signature:integrity": signature,
          "expiration-time": expirationTime,
          ...(redirectUrl ? { "redirect-url": redirectUrl } : {}),
        },
      };
    },
    {
      maxWait: 10_000,
      timeout: 15_000,
    }
  );
}

/**
 * Enruta la transición canónica según el origen del intento:
 * recargas de Fixi Wallet (recargaId) o pagos de órdenes (ordenId).
 */
async function applyCanonicalAny(
  db: PrismaClient,
  input: ApplyCanonicalTransitionInput
): Promise<CanonicalTransitionOutcome | CanonicalTopUpOutcome> {
  const routing = await db.intentoPagoWompi.findUnique({
    where: { referenciaWompi: input.canonicalTx.reference },
    select: { recargaId: true },
  });
  if (routing?.recargaId) {
    const mod = await import("./walletTopUpService");
    return mod.applyCanonicalTopUpTransition(db, input);
  }
  return applyCanonicalTransactionTransition(db, input);
}

/**
 * Procesa un evento Webhook de Wompi Sandbox:
 * 1. Valida entorno Sandbox, coincidencia constante de `X-Event-Checksum` y checksum dinámico.
 * 2. Verifica guardia `event === "transaction.updated"` y propiedad firmada `"transaction.id"`.
 * 3. Consulta la transacción canónica en Wompi FUERA de la transacción de BD.
 * 4. Ejecuta deduplicación + transición atómica bajo `SELECT ... FOR UPDATE`.
 */
export async function processWompiWebhook(
  db: PrismaClient,
  rawPayload: unknown,
  headerChecksum: string | null | undefined,
  options?: WompiRuntimeOptions
): Promise<CanonicalTransitionOutcome | CanonicalTopUpOutcome> {
  const env = options?.env ?? process.env;
  const nowFn = options?.now ?? (() => new Date());

  let config;
  try {
    config = validateWompiEnvironmentConfig(env);
  } catch (err) {
    throw mapPolicyErrorToServiceError(err);
  }

  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new WompiServiceError(
      "El cuerpo del webhook no es un objeto JSON válido.",
      400,
      "INVALID_WEBHOOK_PAYLOAD",
      false
    );
  }

  const body = rawPayload as Record<string, unknown>;
  const sigObj =
    body.signature && typeof body.signature === "object" && !Array.isArray(body.signature)
      ? (body.signature as Record<string, unknown>)
      : null;
  const rawBodyChecksum =
    sigObj && typeof sigObj.checksum === "string" ? sigObj.checksum.trim() : "";

  if (headerChecksum !== undefined && headerChecksum !== null) {
    const cleanHeader = headerChecksum.trim();
    if (!cleanHeader) {
      throw new WompiServiceError(
        "El encabezado X-Event-Checksum está vacío.",
        401,
        "EMPTY_EVENT_CHECKSUM_HEADER",
        false
      );
    }
    if (!constantTimeHexEquals(cleanHeader, rawBodyChecksum)) {
      throw new WompiServiceError(
        "El encabezado X-Event-Checksum no coincide con signature.checksum.",
        401,
        "HEADER_BODY_CHECKSUM_MISMATCH",
        false
      );
    }
  }

  const verification = verifyWompiEventChecksum({
    payload: rawPayload,
    eventsSecret: config.eventsSecret,
    headerChecksum,
  });

  if (!verification.valid) {
    const status =
      verification.reason === "CHECKSUM_MISMATCH" ||
      verification.reason === "HEADER_BODY_CHECKSUM_MISMATCH"
        ? 401
        : 400;
    throw new WompiServiceError(
      verification.message,
      status,
      verification.reason,
      false
    );
  }

  const rawEventType =
    typeof body.event === "string" ? body.event.trim() : "";
  if (rawEventType !== "transaction.updated") {
    throw new WompiServiceError(
      `Tipo de evento no soportado en Etapa 1: "${rawEventType}".`,
      400,
      "UNSUPPORTED_EVENT_TYPE",
      false
    );
  }

  const rawEnvironment =
    typeof body.environment === "string" ? body.environment.trim() : "";
  if (rawEnvironment !== "test") {
    throw new WompiServiceError(
      "El evento recibido no corresponde al ambiente Sandbox ('test').",
      400,
      "NON_SANDBOX_WEBHOOK_EVENT",
      false
    );
  }

  if (!verification.signedProperties.includes("transaction.id")) {
    throw new WompiServiceError(
      "Rechazado: signature.properties debe incluir obligatoriamente 'transaction.id'.",
      400,
      "UNSIGNED_TRANSACTION_ID",
      false
    );
  }

  const signedTxId = verification.signedPropertyValues["transaction.id"];
  if (!signedTxId || !CANONICAL_TRANSACTION_ID_REGEX.test(signedTxId)) {
    throw new WompiServiceError(
      "El transaction.id firmado no es válido.",
      400,
      "INVALID_TRANSACTION_ID",
      false
    );
  }

  let canonicalTimestampStr: string;
  let deduplicationKey: string;
  try {
    canonicalTimestampStr = normalizeCanonicalTimestamp(body.timestamp);
    deduplicationKey = computeWompiEventDeduplicationKey({
      environment: "test",
      eventType: rawEventType,
      canonicalTimestamp: canonicalTimestampStr,
      verifiedChecksum: verification.computedChecksum,
    });
  } catch (err) {
    throw mapPolicyErrorToServiceError(err);
  }

  // Optimización rápida de lectura previa: si el evento ya fue procesado con éxito, evitar llamada HTTP innecesaria
  const alreadyProcessed = await db.eventoWebhookWompi.findUnique({
    where: { claveDeduplicacion: deduplicationKey },
    select: { procesadoExitoso: true },
  });

  if (alreadyProcessed?.procesadoExitoso) {
    const existingAttempt = await db.intentoPagoWompi.findFirst({
      where: { wompiTransactionId: signedTxId },
      include: {
        orden: {
          select: {
            id: true,
            numeroOrden: true,
            estado: true,
            estadoPago: true,
            pasarelaCaptureId: true,
          },
        },
      },
    });

    if (existingAttempt && !existingAttempt.recargaId) {
      if (!existingAttempt.orden) {
        throw new WompiServiceError(
          "El intento de pago no está asociado a una orden de servicio.",
          400,
          "ATTEMPT_NOT_ORDER_BOUND",
          false
        );
      }
      const cents = toBigIntCents(existingAttempt.montoEnCentavos);
      return {
        orderId: existingAttempt.orden.id,
        orderNumber: existingAttempt.orden.numeroOrden,
        intentId: existingAttempt.id,
        reference: existingAttempt.referenciaWompi,
        transactionId: signedTxId,
        providerStatus: validateRemoteStatus(
          existingAttempt.estadoProveedor ?? "PENDING"
        ),
        intentStatus: existingAttempt.estado as LocalPaymentIntentStatus,
        orderPaymentStatus:
          existingAttempt.orden.estadoPago as OrderPaymentStatus,
        orderOperationalStatus: existingAttempt.orden.estado as DbOrderStatus,
        winningCaptureId: existingAttempt.orden.pasarelaCaptureId,
        amountInCents: cents.toString(),
        formattedAmountCop: formatWompiCentsToCop(cents),
        idempotentReplay: true,
        effectiveFinancialMutation: false,
        isStaleOutOfOrder: false,
        incidentCode: null,
        supportTicketCreated: false,
      };
    }
  }

  // Consulta canónica a Wompi FUERA de la transacción de base de datos
  const canonicalTx = await fetchWompiCanonicalTransaction(signedTxId, options);
  if (canonicalTx.id !== signedTxId) {
    throw new WompiServiceError(
      "El ID devuelto por la API canónica de Wompi no coincide con el ID firmado del evento.",
      502,
      "CANONICAL_TRANSACTION_ID_MISMATCH",
      false
    );
  }

  const tsBigInt = BigInt(canonicalTimestampStr);
  const pgTimestampInt =
    tsBigInt > BigInt(MAX_PG_INT32)
      ? Math.min(MAX_PG_INT32, Number(tsBigInt / 1000n))
      : Number(tsBigInt);

  const resumenPayloadJson = JSON.stringify({
    event: rawEventType,
    environment: "test",
    transactionId: signedTxId,
    canonicalTimestamp: canonicalTimestampStr,
    signedProperties: verification.signedProperties,
  });

  return await applyCanonicalAny(db, {
    canonicalTx,
    source: "WEBHOOK",
    webhookEvent: {
      deduplicationKey,
      environment: "test",
      eventType: rawEventType,
      timestampEvento: pgTimestampInt,
      checksumRecibido: verification.computedChecksum,
      resumenPayloadJson,
    },
    now: nowFn(),
  });
}

/**
 * Verifica una transacción retornada al navegador del cliente (`/pagos/resultado?id={txId}`).
 * Valida formato estricto, titularidad sin enumeración (404 uniforme) y retorna el
 * `CanonicalTransitionOutcome` recién consolidado.
 */
export async function verifyWompiTransactionForClient(
  db: PrismaClient,
  actor: OrderActor | null | undefined,
  rawTransactionId: unknown,
  options?: WompiRuntimeOptions
): Promise<CanonicalTransitionOutcome | CanonicalTopUpOutcome> {
  assertVerifiedClientActor(actor);

  const cleanTxId =
    typeof rawTransactionId === "string" ? rawTransactionId.trim() : "";
  if (!VERIFY_TRANSACTION_ID_REGEX.test(cleanTxId)) {
    throw new WompiServiceError(
      "El identificador de la transacción no cumple con el formato requerido.",
      400,
      "INVALID_TRANSACTION_ID",
      false
    );
  }

  const env = options?.env ?? process.env;
  const nowFn = options?.now ?? (() => new Date());

  try {
    validateWompiEnvironmentConfig(env);
  } catch (err) {
    throw mapPolicyErrorToServiceError(err);
  }

  // Pre-filtro rápido anti-enumeración si la transacción ya fue registrada localmente
  const localAttempt = await db.intentoPagoWompi.findUnique({
    where: { wompiTransactionId: cleanTxId },
    select: {
      orden: {
        select: { clienteId: true },
      },
      recarga: {
        select: { usuarioId: true },
      },
    },
  });

  if (localAttempt?.recarga && localAttempt.recarga.usuarioId !== actor.id) {
    throw new WompiServiceError(
      "No se encontró la transacción solicitada.",
      404,
      "TRANSACTION_NOT_FOUND",
      false
    );
  }

  if (localAttempt?.orden && localAttempt.orden.clienteId !== actor.id) {
    throw new WompiServiceError(
      "No se encontró la transacción solicitada.",
      404,
      "TRANSACTION_NOT_FOUND",
      false
    );
  }

  let canonicalTx: CanonicalWompiTransaction;
  try {
    canonicalTx = await fetchWompiCanonicalTransaction(cleanTxId, options);
  } catch (err) {
    if (
      err instanceof WompiServiceError &&
      err.code === "WOMPI_TRANSACTION_NOT_FOUND"
    ) {
      throw new WompiServiceError(
        "No se encontró la transacción solicitada.",
        404,
        "TRANSACTION_NOT_FOUND",
        false
      );
    }
    throw err;
  }

  return await applyCanonicalAny(db, {
    canonicalTx,
    source: "VERIFY",
    expectedClientId: actor.id,
    now: nowFn(),
  });
}
