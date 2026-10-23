// Clasificación y saneamiento de errores del servicio de correo (Nodemailer / Gmail SMTP).
// Módulo PURO: no abre conexiones de red, así que puede probarse de forma aislada.

export type EmailFailureCategory =
  | "sandbox_recipient_restricted"
  | "domain_not_verified"
  | "invalid_api_key"
  | "invalid_credentials"
  | "invalid_from"
  | "invalid_recipient"
  | "rate_limited"
  | "network"
  | "unexpected_response"
  | "unknown";

export interface ProviderErrorInfo {
  category: EmailFailureCategory;
  statusCode: number | null;
  name: string;
  /** Texto del proveedor ya saneado (sin correos, contraseñas ni tokens). */
  safeMessage: string;
}

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RESEND_KEY_IN_TEXT = /re_[A-Za-z0-9_]{8,}/g;
const LONG_SECRET_IN_TEXT = /\b[A-Za-z0-9_-]{32,}\b/g;

/**
 * Enmascara cualquier dirección de correo, clave o cadena larga tipo secreto/token.
 */
export function sanitizeProviderText(text: string, maxLength = 300): string {
  return text
    .replace(RESEND_KEY_IN_TEXT, "[api-key]")
    .replace(EMAIL_IN_TEXT, "[correo]")
    .replace(LONG_SECRET_IN_TEXT, "[secreto]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Clasifica errores de Nodemailer / Gmail SMTP (y mantiene compatibilidad con
 * la firma previa para pruebas unitarias existentes).
 */
export function classifyEmailError(err: unknown): ProviderErrorInfo {
  const record =
    typeof err === "object" && err !== null
      ? (err as Record<string, unknown>)
      : {};

  const code = readString(record.code);
  const name =
    readString(record.name) ||
    code ||
    (err instanceof Error ? err.name : "");
  const rawMessage =
    readString(record.response) ||
    readString(record.message) ||
    (typeof err === "string" ? err : "");
  const statusCode =
    typeof record.statusCode === "number"
      ? record.statusCode
      : typeof record.responseCode === "number"
        ? record.responseCode
        : null;
  const message = rawMessage.toLowerCase();

  let category: EmailFailureCategory = "unknown";

  if (
    code === "EAUTH" ||
    statusCode === 535 ||
    statusCode === 534 ||
    /username and password not accepted|invalid login|authentication failed|application-specific password|badcredentials|missing credentials/.test(
      message
    )
  ) {
    category = "invalid_credentials";
  } else if (
    name === "invalid_api_key" ||
    name === "missing_api_key" ||
    statusCode === 401 ||
    /api key is invalid|invalid api key|missing api key/.test(message)
  ) {
    category = "invalid_api_key";
  } else if (name === "invalid_from_address") {
    category = "invalid_from";
  } else if (
    /only send testing emails to your own email address|testing emails to your own/.test(
      message
    )
  ) {
    category = "sandbox_recipient_restricted";
  } else if (/domain is not verified|domain.*not verified|verify (a|your) domain/.test(message)) {
    category = "domain_not_verified";
  } else if (
    name === "rate_limit_exceeded" ||
    name === "daily_quota_exceeded" ||
    name === "monthly_quota_exceeded" ||
    statusCode === 429 ||
    statusCode === 421 ||
    statusCode === 454 ||
    /too many login attempts|rate limit|daily user sending limit|quota exceeded|try again later/.test(
      message
    )
  ) {
    category = "rate_limited";
  } else if (
    code === "EENVELOPE" ||
    statusCode === 550 ||
    statusCode === 553 ||
    /invalid .*to.* address|invalid `to` field|invalid recipient|recipient address rejected|address not found/.test(
      message
    )
  ) {
    category = "invalid_recipient";
  } else if (
    code === "ECONNECTION" ||
    code === "ESOCKET" ||
    code === "ETIMEDOUT" ||
    code === "EDNS" ||
    name === "application_error" ||
    name === "internal_server_error" ||
    /fetch failed|unable to fetch|enotfound|econnreset|econnrefused|etimedout|network|socket|greeting never received/.test(
      message
    )
  ) {
    category = "network";
  }

  return {
    category,
    statusCode,
    name: name || "EmailError",
    safeMessage: sanitizeProviderText(
      rawMessage || "El servidor SMTP no devolvió un mensaje de error."
    ),
  };
}

export const classifyResendError = classifyEmailError;

/** Mensaje público (en español) para cada categoría. No incluye datos internos. */
export function publicMessageForCategory(category: EmailFailureCategory): string {
  switch (category) {
    case "sandbox_recipient_restricted":
      return "El servicio de correo está en modo de pruebas y solo puede enviar mensajes al titular de la cuenta del proveedor. Para enviar a otras direcciones, el administrador debe verificar un dominio de envío.";
    case "domain_not_verified":
      return "El dominio de envío configurado aún no está verificado en el proveedor de correo. Contacta al administrador.";
    case "invalid_api_key":
    case "invalid_credentials":
    case "invalid_from":
      return "El servicio de correo no está configurado correctamente en el servidor. Contacta al administrador.";
    case "invalid_recipient":
      return "No pudimos enviar el mensaje a esa dirección de correo. Verifica que esté escrita correctamente.";
    case "rate_limited":
      return "El servicio de correo recibió demasiadas solicitudes. Intenta de nuevo en unos minutos.";
    case "network":
      return "No fue posible conectar con el servicio de correo. Intenta de nuevo en unos minutos.";
    default:
      return "No fue posible enviar el correo electrónico en este momento. Intenta de nuevo en unos minutos.";
  }
}

/**
 * Valida el formato de EMAIL_FROM: "correo@dominio" o "Nombre <correo@dominio>".
 * Rechaza valores de ejemplo conocidos para detectar plantillas sin completar.
 */
export function isValidEmailFromFormat(from: string): boolean {
  const value = from.trim();
  const plain = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;
  const named = /^[^<>]+<[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+>$/;

  if (!plain.test(value) && !named.test(value)) return false;

  const placeholders = /correo-de-tu-dominio|tudominio\.com|tu-dominio|ejemplo\.com|example\.com/i;
  return !placeholders.test(value);
}
