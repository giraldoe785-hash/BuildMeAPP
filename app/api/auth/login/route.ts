import {
  createSession,
  hashPassword,
  limpiarIntentosLogin,
  puedeIntentarLogin,
  registrarIntentoFallido,
  USUARIO_INCLUDE,
  verifyPassword,
} from "@/lib/auth";
import {
  isPendingTraditionalAccount,
  issueEmailVerificationCode,
} from "@/lib/emailVerification";
import { prisma } from "@/lib/prisma";

const USERNAME_MAX_LENGTH = 50; // mismo límite que la columna y el registro
const PASSWORD_MAX_LENGTH = 128; // mismo límite que el registro

// Bloqueo por cuenta (persistente en BD con intentosFallidosLogin / bloqueadoHasta)
const MAX_INTENTOS_FALLIDOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000; // 15 minutos

// Un solo mensaje para "usuario no existe" y "contraseña incorrecta":
// así nadie puede descubrir qué usuarios están registrados.
const CREDENCIALES_INVALIDAS = "Nombre de usuario o contraseña incorrectos.";

function fail(message: string, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function getClientIp(request: Request): string {
  // x-forwarded-for solo es confiable si tu hosting es quien lo agrega.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "desconocida"
  );
}

// Hash "señuelo": cuando el usuario NO existe igual se ejecuta una
// verificación completa de scrypt, para que la respuesta tarde lo mismo
// que con un usuario real (evita adivinar usuarios midiendo el tiempo).
let hashSenuelo: Promise<string> | null = null;
function getHashSenuelo(): Promise<string> {
  hashSenuelo ??= hashPassword("contraseña-senuelo-no-valida-1");
  return hashSenuelo;
}

async function registrarFalloDeCuenta(usuarioId: string): Promise<void> {
  const actualizado = await prisma.usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidosLogin: { increment: 1 } },
    select: { intentosFallidosLogin: true },
  });

  if (actualizado.intentosFallidosLogin >= MAX_INTENTOS_FALLIDOS) {
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: {
        intentosFallidosLogin: 0,
        bloqueadoHasta: new Date(Date.now() + BLOQUEO_MS),
      },
    });
  }
}

export async function POST(request: Request) {
  try {
    // Límite por IP (solo en producción: en local todas tus pruebas
    // comparten IP y te bloquearías tú mismo). Cuenta solo los fallos.
    const limitarPorIp = process.env.NODE_ENV === "production";
    const claveIp = `login:${getClientIp(request)}`;

    if (limitarPorIp && !puedeIntentarLogin(claveIp)) {
      return fail("Demasiados intentos. Intenta de nuevo en unos minutos.", 429);
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

    const username =
      typeof data.username === "string"
        ? data.username.trim().toLowerCase()
        : "";
    const password = typeof data.password === "string" ? data.password : "";

    if (!username || !password) {
      return fail("Ingresa tu nombre de usuario y contraseña.");
    }

    // Valores más largos que los permitidos en el registro no pueden ser
    // válidos: se responde igual que unas credenciales incorrectas.
    if (username.length > USERNAME_MAX_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      if (limitarPorIp) registrarIntentoFallido(claveIp);
      return fail(CREDENCIALES_INVALIDAS, 401);
    }

    const usuario = await prisma.usuario.findUnique({
      where: { nombreUsuario: username },
      include: {
        ...USUARIO_INCLUDE,
        identidadesOAuth: { select: { id: true } },
      },
    });

    // Cuenta bloqueada temporalmente: ni siquiera se verifica la contraseña.
    if (usuario?.bloqueadoHasta && usuario.bloqueadoHasta.getTime() > Date.now()) {
      return fail(
        "Demasiados intentos fallidos. Intenta de nuevo en unos minutos.",
        429
      );
    }

    const hashAComparar = usuario?.passwordHash ?? (await getHashSenuelo());
    const passwordCorrecta = await verifyPassword(password, hashAComparar);

    if (!usuario || !usuario.passwordHash || !passwordCorrecta) {
      if (limitarPorIp) registrarIntentoFallido(claveIp);
      if (usuario) await registrarFalloDeCuenta(usuario.id);
      return fail(CREDENCIALES_INVALIDAS, 401);
    }

    // Solo después de acertar la contraseña se revela el estado de la cuenta.
    if (usuario.estado === "SUSPENDIDO") {
      return fail("Tu cuenta está suspendida. Contacta a soporte.", 403);
    }

    // La contraseña es correcta: se limpian los contadores de fallos.
    if (limitarPorIp) limpiarIntentosLogin(claveIp);

    if (usuario.intentosFallidosLogin > 0 || usuario.bloqueadoHasta) {
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { intentosFallidosLogin: 0, bloqueadoHasta: null },
      });
    }

    // Cliente tradicional con correo que todavía no verifica su cuenta: no se crea
    // sesión hasta completar el código. Aquí (y solo aquí, con la contraseña ya
    // validada) se reutiliza el código vigente o se emite y envía uno nuevo.
    // Las cuentas antiguas sin correo y las de Google no pasan por este bloque.
    if (isPendingTraditionalAccount(usuario) && usuario.email) {
      const issued = await issueEmailVerificationCode({
        usuarioId: usuario.id,
        correoDestino: usuario.email,
        nombre: usuario.perfilCliente?.nombres || usuario.nombreUsuario,
        mode: "login",
      });

      switch (issued.status) {
        case "sent":
        case "existing":
          return Response.json(
            {
              success: false,
              requiresEmailVerification: true,
              codeStatus: issued.status,
              cooldownSeconds: issued.cooldownSeconds,
              expiresInSeconds: issued.expiresInSeconds,
              email: usuario.email,
              username: usuario.nombreUsuario,
              message:
                issued.status === "sent"
                  ? "Te enviamos un código de 6 dígitos a tu correo para verificar tu cuenta."
                  : "Tu cuenta aún no está verificada. Ingresa el código vigente que te enviamos.",
            },
            { status: 403 }
          );

        case "rate_limited":
        case "cooldown":
          return Response.json(
            {
              success: false,
              message:
                "Alcanzaste el límite de códigos de verificación. Intenta de nuevo más tarde.",
              retryAfterSeconds: issued.retryAfterSeconds,
            },
            { status: 429 }
          );

        case "failed":
          // El correo no salió: no se abre la pantalla del código. El usuario puede
          // volver a iniciar sesión para reintentar (el código fallido ya se invalidó).
          return fail(issued.userMessage, 503);
      }
    }

    await createSession(usuario.id);

    // Nunca se devuelve el hash ni los campos internos de seguridad.
    const {
      passwordHash: _hash,
      codigoVerificacion: _codigo,
      codigoVerificacionExpiraEn: _codigoExpira,
      intentosFallidosLogin: _intentos,
      bloqueadoHasta: _bloqueo,
      identidadesOAuth: _oauth,
      ...usuarioSeguro
    } = usuario;

    return Response.json({
      success: true,
      message: "Inicio de sesión exitoso.",
      user: usuarioSeguro,
    });
  } catch (error) {
    console.error("Error al iniciar sesión:", error);
    return fail("No fue posible iniciar sesión.", 500);
  }
}
