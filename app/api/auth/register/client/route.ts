import {
  createSession,
  hashPassword,
  puedeIntentarLogin,
  registrarIntentoFallido,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PASSWORD_MIN_LENGTH = 7;
const PASSWORD_MAX_LENGTH = 128; // evita contraseñas gigantes (abuso de CPU/memoria)
const USERNAME_REGEX = /^[a-z0-9_.]{3,50}$/; // 50 = límite que ya tenías
const NAME_MAX_LENGTH = 100;

const PASSWORD_ERROR =
  "La contraseña debe tener mínimo 7 caracteres y contener al menos 2 números.";

function fail(message: string, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function isValidPassword(password: string): boolean {
  const numbersCount = (password.match(/\d/g) || []).length;

  return password.length >= PASSWORD_MIN_LENGTH && numbersCount >= 2;
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
    // Límite de registros por IP (reutiliza el limitador de lib/auth).
    // Cuenta cada solicitud: evita que alguien cree cuentas en masa.
    const claveLimite = `registro:${getClientIp(request)}`;

    if (!puedeIntentarLogin(claveLimite)) {
      return fail("Demasiados intentos. Intenta de nuevo en unos minutos.", 429);
    }
    registrarIntentoFallido(claveLimite);

    // Un JSON roto o vacío es un error del cliente (400), no del servidor (500)
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
    const username =
      typeof data.username === "string"
        ? data.username.trim().toLowerCase()
        : "";
    const password = typeof data.password === "string" ? data.password : "";
    const confirmPassword =
      typeof data.confirmPassword === "string" ? data.confirmPassword : "";

    if (!name || !username || !password || !confirmPassword) {
      return fail("Todos los campos son obligatorios.");
    }

    if (!USERNAME_REGEX.test(username)) {
      return fail(
        "El nombre de usuario debe tener entre 3 y 50 caracteres y solo puede contener letras, números, punto o guion bajo."
      );
    }

    if (password.length > PASSWORD_MAX_LENGTH || !isValidPassword(password)) {
      return fail(PASSWORD_ERROR);
    }

    if (password !== confirmPassword) {
      return fail("Las contraseñas no coinciden.");
    }

    if (name.length > NAME_MAX_LENGTH) {
      return fail(`El nombre no puede superar ${NAME_MAX_LENGTH} caracteres.`);
    }

    if (name.split(/\s+/).length < 2) {
      return fail(
        "Ingresa el nombre completo incluyendo al menos un apellido."
      );
    }

    const { nombres, apellidos } = splitFullName(name);

    // Chequeo temprano: evita calcular el hash si el usuario ya existe.
    // La carrera entre dos registros simultáneos se cubre con el P2002 de abajo.
    const existingUser = await prisma.usuario.findUnique({
      where: { nombreUsuario: username },
      select: { id: true },
    });

    if (existingUser) {
      return fail("El nombre de usuario ya está registrado.", 409);
    }

    const passwordHash = await hashPassword(password);

    // El create con relación anidada ya es atómico: no hace falta $transaction.
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: username,
        passwordHash,
        rol: "CLIENTE",
        estado: "PENDIENTE_VERIFICACION",
        perfilCliente: {
          create: { nombres, apellidos },
        },
      },
      include: { perfilCliente: true },
    });

    // Si la sesión falla, la cuenta YA existe: no devolvemos 500, porque el
    // usuario reintentaría y recibiría "usuario ya registrado".
    let sesionIniciada = true;
    try {
      await createSession(usuario.id);
    } catch (sessionError) {
      sesionIniciada = false;
      console.error("Cuenta creada pero falló la sesión:", sessionError);
    }

    const { passwordHash: _, ...usuarioSeguro } = usuario;

    return Response.json(
      {
        success: true,
        message: sesionIniciada
          ? "Cuenta de cliente creada correctamente."
          : "Cuenta creada. Inicia sesión para continuar.",
        sesionIniciada,
        user: usuarioSeguro,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error al registrar cliente:", error);

    if ((error as { code?: string }).code === "P2002") {
      return fail("El nombre de usuario ya está registrado.", 409);
    }

    return fail("No fue posible crear la cuenta.", 500);
  }
}