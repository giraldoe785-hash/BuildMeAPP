import { generatePasswordResetToken } from "@/lib/auth";
import {
  getTrustedAppBaseUrl,
  isEmailConfigComplete,
  sendPasswordResetEmail,
} from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import {
  EMAIL_MAX_LENGTH,
  EMAIL_REGEX,
  normalizeEmail,
} from "@/lib/registrationValidation";

const RESET_TOKEN_EXPIRY_MINUTES = 15;
const RESET_TOKEN_EXPIRY_MS = RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000;
const PER_USER_COOLDOWN_MS = 60 * 1000; // 60 segundos entre enlaces para el mismo usuario

const GENERIC_SUCCESS_MESSAGE =
  "Si existe una cuenta compatible con esa dirección, recibirás un enlace para recuperar tu contraseña.";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Referrer-Policy": "no-referrer",
};

const forgotIpLimiter = createRateLimiter({ max: 10, windowMs: 30 * 60 * 1000 });
const forgotEmailLimiter = createRateLimiter({ max: 4, windowMs: 30 * 60 * 1000 });

function fail(message: string, status = 400) {
  return Response.json(
    { success: false, message },
    { status, headers: NO_STORE_HEADERS }
  );
}

function genericSuccessResponse() {
  return Response.json(
    {
      success: true,
      message: GENERIC_SUCCESS_MESSAGE,
    },
    { headers: NO_STORE_HEADERS }
  );
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "desconocida"
  );
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (forgotIpLimiter.isLimited(ip)) {
      return fail(
        "Demasiadas solicitudes de recuperación. Intenta nuevamente más tarde.",
        429
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("El cuerpo de la solicitud no es un JSON válido.");
    }

    if (typeof body !== "object" || body === null) {
      return fail("Solicitud inválida.");
    }

    const data = body as Record<string, unknown>;
    const email =
      typeof data.email === "string" ? normalizeEmail(data.email) : "";

    if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_REGEX.test(email)) {
      return fail("Ingresa una dirección de correo electrónico válida.");
    }

    if (forgotEmailLimiter.isLimited(email)) {
      return fail(
        "Demasiadas solicitudes para este correo. Intenta nuevamente en unos minutos.",
        429
      );
    }

    forgotIpLimiter.record(ip);
    forgotEmailLimiter.record(email);

    // Verificar configuración del servicio de correo y URL base antes de consultar
    // la cuenta, para no revelar la existencia del usuario por diferencias de error.
    if (!isEmailConfigComplete() || !getTrustedAppBaseUrl()) {
      console.error(
        "[PasswordForgot] Configuración incompleta para envío de correos (EMAIL_USER, EMAIL_PASS, EMAIL_FROM o APP_BASE_URL)."
      );
      return fail(
        "El servicio de envío de correos no está disponible en este momento. Verifica la configuración del servidor o intenta más tarde.",
        503
      );
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      include: {
        perfilCliente: true,
        perfilReparador: true,
      },
    });

    // Regla de seguridad y privacidad:
    // - Si el correo no existe
    // - Si la cuenta está suspendida
    // - Si la cuenta fue creada con Google OAuth y no tiene passwordHash local
    // Se devuelve exactamente la misma respuesta genérica sin enviar correo ni revelar el motivo.
    if (
      !usuario ||
      !usuario.email ||
      usuario.estado === "SUSPENDIDO" ||
      !usuario.passwordHash
    ) {
      return genericSuccessResponse();
    }

    const now = new Date();

    // Solo considerar tokens vigentes y no invalidados para el enfriamiento:
    // si un envío anterior falló y fue invalidado, no debe bloquear un reintento.
    const ultimoToken = await prisma.tokenRecuperacionPassword.findFirst({
      where: {
        usuarioId: usuario.id,
        consumidoEn: null,
        invalidadoEn: null,
      },
      orderBy: { creadoEn: "desc" },
    });

    if (
      ultimoToken &&
      now.getTime() - ultimoToken.creadoEn.getTime() < PER_USER_COOLDOWN_MS
    ) {
      return genericSuccessResponse();
    }

    const { token, tokenHash } = generatePasswordResetToken();
    const fechaExpira = new Date(now.getTime() + RESET_TOKEN_EXPIRY_MS);
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

    const registroCreado = await prisma.$transaction(async (tx) => {
      // Invalidar cualquier token de recuperación anterior que siga activo
      await tx.tokenRecuperacionPassword.updateMany({
        where: {
          usuarioId: usuario.id,
          consumidoEn: null,
          invalidadoEn: null,
        },
        data: {
          invalidadoEn: now,
        },
      });

      return tx.tokenRecuperacionPassword.create({
        data: {
          usuarioId: usuario.id,
          tokenHash,
          ipSolicitud: ip.slice(0, 45),
          userAgent,
          fechaExpira,
        },
      });
    });

    const nombreMostrar =
      usuario.perfilCliente?.nombres ||
      usuario.perfilReparador?.nombres ||
      usuario.nombreUsuario;

    const sendResult = await sendPasswordResetEmail({
      to: usuario.email,
      nombre: nombreMostrar,
      token,
      expiraEnMinutos: RESET_TOKEN_EXPIRY_MINUTES,
    });

    if (!sendResult.success) {
      // Invalidar el token cuyo correo no salió para que no quede utilizable ni
      // bloquee un nuevo intento, y devolver la misma respuesta pública genérica
      // para evitar enumeración de cuentas cuando el transporte SMTP falla.
      await prisma.tokenRecuperacionPassword.updateMany({
        where: { id: registroCreado.id },
        data: { invalidadoEn: new Date() },
      });
      return genericSuccessResponse();
    }

    return genericSuccessResponse();
  } catch (error) {
    console.error("Error al procesar solicitud de recuperación de contraseña:", error);
    return fail(
      "No fue posible procesar la solicitud en este momento.",
      500
    );
  }
}
