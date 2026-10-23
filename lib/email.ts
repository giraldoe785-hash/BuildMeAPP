import nodemailer, { type Transporter } from "nodemailer";

import {
  classifyEmailError,
  isValidEmailFromFormat,
  publicMessageForCategory,
  type EmailFailureCategory,
} from "@/lib/emailErrors";

export type SendSuccess = {
  success: true;
  /** Identificador del mensaje devuelto por el servidor SMTP. */
  providerMessageId: string;
};

export type SendFailure = {
  success: false;
  reason: "not_configured" | "invalid_from" | "invalid_base_url" | "send_failed";
  category: EmailFailureCategory;
  userMessage: string;
};

export type SendEmailResult = SendSuccess | SendFailure;

const GENERIC_EMAIL_SEND_ERROR =
  "No fue posible enviar el correo electrónico en este momento. Intenta de nuevo en unos minutos.";

function getEmailUser(): string | null {
  const user = process.env.EMAIL_USER?.trim();
  return user && user.length > 0 ? user : null;
}

function getEmailPass(): string | null {
  const pass = process.env.EMAIL_PASS?.trim();
  return pass && pass.length > 0 ? pass : null;
}

function getEmailFrom(): string | null {
  const from = process.env.EMAIL_FROM?.trim();
  return from && from.length > 0 ? from : null;
}

export function isEmailConfigComplete(): boolean {
  return Boolean(getEmailUser() && getEmailPass() && getEmailFrom());
}

let customTransportForTests: Transporter | null = null;

/** Permite inyectar un transporte simulado en pruebas unitarias sin tocar la red. */
export function setEmailTransportForTests(transport: Transporter | null): void {
  customTransportForTests = transport;
}

function createGmailTransport(user: string, pass: string): Transporter {
  if (customTransportForTests) {
    return customTransportForTests;
  }

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user,
      pass,
    },
  });
}

/**
 * Comprueba la conexión y autenticación SMTP con Gmail sin enviar un correo real.
 * No imprime credenciales ni direcciones privadas.
 */
export async function verifySmtpConnection(): Promise<
  | { success: true }
  | { success: false; category: EmailFailureCategory; safeMessage: string }
> {
  const user = getEmailUser();
  const pass = getEmailPass();
  const from = getEmailFrom();

  if (!user || !pass || !from) {
    return {
      success: false,
      category: "invalid_credentials",
      safeMessage: "Faltan variables EMAIL_USER, EMAIL_PASS o EMAIL_FROM.",
    };
  }

  try {
    const transporter = createGmailTransport(user, pass);
    await transporter.verify();
    return { success: true };
  } catch (err) {
    const info = classifyEmailError(err);
    return {
      success: false,
      category: info.category,
      safeMessage: info.safeMessage,
    };
  }
}

/**
 * Obtiene y valida la URL base pública y confiable de BuildMeAPP.
 * Nunca utiliza cabeceras Host / X-Forwarded-Host / Origin de la petición entrante.
 * En producción exige explícitamente APP_BASE_URL con esquema HTTPS.
 * En desarrollo local admite http://localhost:3000 como valor por defecto si APP_BASE_URL no está definida.
 */
export function getTrustedAppBaseUrl(): string | null {
  const raw = process.env.APP_BASE_URL?.trim();
  const isProd = process.env.NODE_ENV === "production";

  const candidate = raw && raw.length > 0 ? raw : isProd ? null : "http://localhost:3000";
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (isProd && parsed.protocol !== "https:") {
      console.error(
        "[EmailConfig] APP_BASE_URL debe utilizar el protocolo HTTPS en producción."
      );
      return null;
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      console.error("[EmailConfig] APP_BASE_URL tiene un protocolo inválido.");
      return null;
    }

    // Devolver el origen + ruta base sin barra final ni parámetros
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}`;
  } catch {
    console.error("[EmailConfig] APP_BASE_URL no tiene un formato de URL válido.");
    return null;
  }
}

/**
 * Construye de forma segura el enlace de restablecimiento `/reset-password?token=...`
 * a partir de APP_BASE_URL usando `URL` y `searchParams`.
 */
export function buildPasswordResetUrl(token: string): string | null {
  const baseUrl = getTrustedAppBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const cleanToken = token.trim();
  if (!cleanToken) {
    return null;
  }

  try {
    const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = new URL("reset-password", baseWithSlash);
    url.searchParams.set("token", cleanToken);
    return url.toString();
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type DeliverContext = "VerificationCode" | "PasswordReset";

function failure(
  reason: SendFailure["reason"],
  category: EmailFailureCategory,
  userMessage: string
): SendFailure {
  return { success: false, reason, category, userMessage };
}

/**
 * Envío único mediante Nodemailer y Gmail SMTP para todos los correos de la app.
 * - Valida EMAIL_USER, EMAIL_PASS y EMAIL_FROM antes de abrir conexión SMTP.
 * - Comprueba que el servidor SMTP acepte el destinatario y devuelva `messageId`.
 * - Clasifica y sanea cualquier error del servidor SMTP (sin destinatarios,
 *   sin tokens/códigos y sin credenciales en los logs).
 */
async function deliverEmail(args: {
  context: DeliverContext;
  to: string;
  subject: string;
  html: string;
  text: string;
  exposeFailureDetail: boolean;
}): Promise<SendEmailResult> {
  const tag = `[EmailService:${args.context}]`;
  const user = getEmailUser();
  const pass = getEmailPass();
  const from = getEmailFrom();

  if (!user || !pass || !from) {
    console.error(
      `${tag} Configuración incompleta: falta EMAIL_USER, EMAIL_PASS y/o EMAIL_FROM en el servidor.`
    );
    return failure("not_configured", "invalid_credentials", GENERIC_EMAIL_SEND_ERROR);
  }

  if (!isValidEmailFromFormat(from)) {
    console.error(
      `${tag} EMAIL_FROM no tiene un formato válido o conserva un valor de ejemplo. Usa "Nombre <correo@dominio>" o una dirección de correo válida.`
    );
    return failure(
      "invalid_from",
      "invalid_from",
      args.exposeFailureDetail
        ? publicMessageForCategory("invalid_from")
        : GENERIC_EMAIL_SEND_ERROR
    );
  }

  try {
    const transporter = createGmailTransport(user, pass);
    const info = await transporter.sendMail({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });

    const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0;
    const providerMessageId =
      typeof info.messageId === "string" && info.messageId.trim().length > 0
        ? info.messageId.trim()
        : "";

    if (!providerMessageId || acceptedCount === 0) {
      console.error(
        `${tag} El servidor SMTP no confirmó la aceptación del mensaje; se trata como envío fallido.`
      );
      return failure("send_failed", "unexpected_response", GENERIC_EMAIL_SEND_ERROR);
    }

    console.info(
      `${tag} Correo enviado mediante Gmail SMTP | id=${providerMessageId}`
    );
    return { success: true, providerMessageId };
  } catch (err) {
    const info = classifyEmailError(err);
    console.error(
      `${tag} Error al enviar mediante Gmail SMTP | categoria=${info.category} | codigo=${info.statusCode ?? "n/d"} | tipo=${info.name} | detalle="${info.safeMessage}"`
    );
    return failure(
      "send_failed",
      info.category,
      args.exposeFailureDetail
        ? publicMessageForCategory(info.category)
        : GENERIC_EMAIL_SEND_ERROR
    );
  }
}

export async function sendVerificationCodeEmail(params: {
  to: string;
  nombre: string;
  codigo: string;
  expiraEnMinutos: number;
}): Promise<SendEmailResult> {
  const safeNombre = escapeHtml(params.nombre || "Usuario");
  const safeCodigo = escapeHtml(params.codigo);

  const html = `
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Verifica tu correo en BuildMeAPP</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#ffffff;border-radius:24px;padding:32px 28px;border:1px solid #e2e8f0;">
            <tr>
              <td align="center" style="padding-bottom:16px;">
                <span style="display:inline-block;background-color:#ecfdf5;color:#047857;font-size:12px;font-weight:700;padding:6px 14px;border-radius:9999px;letter-spacing:0.5px;">
                  BUILDMEAPP | FIXI
                </span>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:12px;">
                <h1 style="margin:0;color:#0f172a;font-size:20px;font-weight:800;">
                  Código de verificación de correo
                </h1>
              </td>
            </tr>
            <tr>
              <td style="color:#334155;font-size:14px;line-height:1.6;padding-bottom:20px;">
                Hola <strong>${safeNombre}</strong>,<br /><br />
                Gracias por registrarte en <strong>BuildMeAPP</strong>. Ingresa el siguiente código de 6 dígitos en la pantalla de verificación para activar tu cuenta:
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <div style="background-color:#f8fafc;border:2px solid #10b981;border-radius:16px;padding:18px 24px;display:inline-block;">
                  <span style="font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#0f172a;">
                    ${safeCodigo}
                  </span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;line-height:1.5;padding-bottom:16px;">
                Este código es de un solo uso y caducará en <strong>${params.expiraEnMinutos} minutos</strong>. Nunca compartas este código con nadie.
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #f1f5f9;padding-top:16px;color:#94a3b8;font-size:11px;line-height:1.5;">
                Si no solicitaste crear una cuenta en BuildMeAPP, puedes ignorar este mensaje de forma segura.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const text = [
    `BuildMeAPP | Fixi — Verificación de correo`,
    ``,
    `Hola ${params.nombre || "Usuario"},`,
    ``,
    `Tu código de verificación de 6 dígitos para completar tu registro en BuildMeAPP es:`,
    ``,
    `${params.codigo}`,
    ``,
    `Este código es de un solo uso y caduca en ${params.expiraEnMinutos} minutos.`,
    `Si no solicitaste crear una cuenta, puedes ignorar este correo.`,
  ].join("\n");

  return deliverEmail({
    context: "VerificationCode",
    to: params.to,
    subject: "Tu código de verificación de BuildMeAPP",
    html,
    text,
    exposeFailureDetail: true,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  nombre: string;
  token: string;
  expiraEnMinutos: number;
}): Promise<SendEmailResult> {
  const resetUrl = buildPasswordResetUrl(params.token);
  if (!resetUrl) {
    console.error(
      "[EmailService:PasswordReset] No se pudo construir el enlace de recuperación porque APP_BASE_URL no es válida o falta en producción."
    );
    return {
      success: false,
      reason: "invalid_base_url",
      category: "unknown",
      userMessage:
        "El servicio de recuperación de contraseña no está disponible en este momento.",
    };
  }

  const safeNombre = escapeHtml(params.nombre || "Usuario");
  const safeResetUrl = escapeHtml(resetUrl);

  const html = `
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Recuperación de contraseña en BuildMeAPP</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#ffffff;border-radius:24px;padding:32px 28px;border:1px solid #e2e8f0;">
            <tr>
              <td align="center" style="padding-bottom:16px;">
                <span style="display:inline-block;background-color:#ecfdf5;color:#047857;font-size:12px;font-weight:700;padding:6px 14px;border-radius:9999px;letter-spacing:0.5px;">
                  BUILDMEAPP | FIXI
                </span>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:12px;">
                <h1 style="margin:0;color:#0f172a;font-size:20px;font-weight:800;">
                  Restablecer tu contraseña
                </h1>
              </td>
            </tr>
            <tr>
              <td style="color:#334155;font-size:14px;line-height:1.6;padding-bottom:24px;">
                Hola <strong>${safeNombre}</strong>,<br /><br />
                Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>BuildMeAPP</strong>. Haz clic en el siguiente botón para crear una contraseña nueva:
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${safeResetUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#059669;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 28px;border-radius:14px;">
                  Establecer nueva contraseña
                </a>
              </td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:12px;line-height:1.5;padding-bottom:16px;">
                Este enlace es de un solo uso y caducará en <strong>${params.expiraEnMinutos} minutos</strong>.<br />
                Si el botón no funciona, copia y pega este enlace en tu navegador:<br />
                <span style="word-break:break-all;color:#059669;">${safeResetUrl}</span>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #f1f5f9;padding-top:16px;color:#94a3b8;font-size:11px;line-height:1.5;">
                Si no solicitaste restablecer tu contraseña, ignora este mensaje. Tu contraseña actual seguirá protegida y sin cambios.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const text = [
    `BuildMeAPP | Fixi — Recuperación de contraseña`,
    ``,
    `Hola ${params.nombre || "Usuario"},`,
    ``,
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta en BuildMeAPP.`,
    `Para establecer una contraseña nueva, abre el siguiente enlace (válido por ${params.expiraEnMinutos} minutos y de un solo uso):`,
    ``,
    resetUrl,
    ``,
    `Si no solicitaste este cambio, puedes ignorar este correo de forma segura.`,
  ].join("\n");

  return deliverEmail({
    context: "PasswordReset",
    to: params.to,
    subject: "Restablece tu contraseña en BuildMeAPP",
    html,
    text,
    exposeFailureDetail: false,
  });
}
