import { hashPassword } from "@/lib/auth";
import {
  isPendingTraditionalAccount,
  issueEmailVerificationCode,
} from "@/lib/emailVerification";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import {
  normalizeEmail,
  normalizeUsername,
  validateClientRegistration,
} from "@/lib/registrationValidation";

const registerLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });
const emailTargetLimiter = createRateLimiter({ max: 5, windowMs: 30 * 60 * 1000 });

function fail(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
) {
  return Response.json({ success: false, message, ...extra }, { status });
}

// Con 4 o más palabras se asume "nombre(s) + dos apellidos" (lo más común en
// nombres hispanos). Con 2 o 3 palabras queda ambiguo ("María José Pérez" vs
// "Juan Pérez García"), por eso lo ideal es pedir nombres y apellidos en
// campos separados en el formulario.
function splitFullName(fullName: string): {
  nombres: string;
  apellidos: string;
} {
  const parts = fullName.trim().split(/\s+/);
  const apellidosCount = parts.length >= 4 ? 2 : 1;

  return {
    nombres: parts.slice(0, -apellidosCount).join(" "),
    apellidos: parts.slice(-apellidosCount).join(" "),
  };
}

function getClientIp(request: Request): string {
  // OJO: x-forwarded-for solo es confiable si tu hosting es el que lo
  // agrega (Vercel, etc.). Detrás de nada, el cliente podría falsearlo.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "desconocida"
  );
}

export async function POST(request: Request) {
  try {
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

    const name = typeof data.name === "string" ? data.name.trim() : "";
    const email = typeof data.email === "string" ? normalizeEmail(data.email) : "";
    const username =
      typeof data.username === "string" ? normalizeUsername(data.username) : "";
    const password = typeof data.password === "string" ? data.password : "";
    const confirmPassword =
      typeof data.confirmPassword === "string" ? data.confirmPassword : "";

    // Mismas reglas que aplica el formulario (lib/registrationValidation.ts).
    const validationError = validateClientRegistration({
      name,
      email,
      username,
      password,
      confirmPassword,
    });
    if (validationError) {
      return fail(validationError);
    }

    const { nombres, apellidos } = splitFullName(name);

    // Verificar si ya existen usuarios con ese username o correo
    const [existingByUsername, existingByEmail] = await Promise.all([
      prisma.usuario.findUnique({
        where: { nombreUsuario: username },
        select: { id: true },
      }),
      prisma.usuario.findUnique({
        where: { email },
        include: { identidadesOAuth: { select: { id: true } } },
      }),
    ]);

    // Solo una cuenta tradicional pendiente puede reutilizarse (reintentar el registro
    // tras un envío fallido o con una contraseña nueva). Cualquier otra cuenta con ese
    // correo —verificada, de Google, suspendida…— NUNCA se vincula ni se reemplaza.
    let pendingAccountId: string | null = null;

    if (existingByEmail) {
      if (!isPendingTraditionalAccount(existingByEmail)) {
        return fail(
          "Ese correo electrónico ya está asociado a una cuenta. Inicia sesión con tu método original o usa otro correo.",
          409
        );
      }

      if (existingByUsername && existingByUsername.id !== existingByEmail.id) {
        return fail("El nombre de usuario ya está registrado.", 409);
      }

      pendingAccountId = existingByEmail.id;
    } else if (existingByUsername) {
      return fail("El nombre de usuario ya está registrado.", 409);
    }

    const ip = getClientIp(request);
    if (registerLimiter.isLimited(ip) || emailTargetLimiter.isLimited(email)) {
      return fail(
        "Demasiadas solicitudes de registro. Intenta de nuevo más tarde.",
        429
      );
    }
    registerLimiter.record(ip);
    emailTargetLimiter.record(email);

    const passwordHash = await hashPassword(password);

    // Crea la cuenta pendiente o actualiza la existente. Aquí NO se abre sesión.
    // Actualizar la contraseña en cada reintento también evita que alguien que
    // registró antes ese correo conserve la contraseña de la cuenta pendiente.
    const usuario = pendingAccountId
      ? await prisma.usuario.update({
          where: { id: pendingAccountId },
          data: {
            nombreUsuario: username,
            passwordHash,
            perfilCliente: {
              upsert: {
                create: { nombres, apellidos },
                update: { nombres, apellidos },
              },
            },
          },
          select: { id: true },
        })
      : await prisma.usuario.create({
          data: {
            email,
            nombreUsuario: username,
            passwordHash,
            rol: "CLIENTE",
            estado: "PENDIENTE_VERIFICACION",
            perfilCliente: { create: { nombres, apellidos } },
          },
          select: { id: true },
        });

    const issued = await issueEmailVerificationCode({
      usuarioId: usuario.id,
      correoDestino: email,
      nombre: nombres,
      mode: "register",
    });

    switch (issued.status) {
      case "sent":
        return Response.json(
          {
            success: true,
            requiresEmailVerification: true,
            sesionIniciada: false,
            codeStatus: "sent",
            cooldownSeconds: issued.cooldownSeconds,
            expiresInSeconds: issued.expiresInSeconds,
            email,
            username,
            message:
              "Te enviamos un código de verificación de 6 dígitos a tu correo electrónico.",
          },
          { status: 201 }
        );

      case "existing":
        return Response.json(
          {
            success: true,
            requiresEmailVerification: true,
            sesionIniciada: false,
            codeStatus: "existing",
            cooldownSeconds: issued.cooldownSeconds,
            expiresInSeconds: issued.expiresInSeconds,
            email,
            username,
            message:
              "Ya te enviamos un código hace un momento. Revisa tu correo e ingrésalo para continuar.",
          },
          { status: 200 }
        );

      case "rate_limited":
      case "cooldown": {
        return fail(
          "Alcanzaste el límite de códigos para esta cuenta. Intenta de nuevo más tarde.",
          429,
          { retryAfterSeconds: issued.retryAfterSeconds }
        );
      }

      case "failed":
        // El correo NO salió: no se abre la pantalla del código ni se afirma que se envió.
        // La cuenta queda pendiente y se puede reintentar con el mismo formulario.
        return fail(issued.userMessage, 503);
    }
  } catch (error) {
    console.error(
      `[Register] Error al registrar cliente | tipo=${
        error instanceof Error ? error.name : "desconocido"
      } | codigo=${(error as { code?: string }).code ?? "n/d"}`
    );

    if ((error as { code?: string }).code === "P2002") {
      return fail(
        "El nombre de usuario o el correo electrónico ya están registrados.",
        409
      );
    }

    return fail("No fue posible procesar el registro.", 500);
  }
}