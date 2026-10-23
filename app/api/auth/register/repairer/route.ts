import { createSession, hashPassword, USUARIO_INCLUDE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import {
  deleteStoredFile,
  saveAccreditationFile,
  type StoredFileType,
} from "@/lib/storage";

const PASSWORD_MIN_LENGTH = 7;
const PASSWORD_MAX_LENGTH = 128;
const USERNAME_REGEX = /^[a-z0-9_.]{3,50}$/;
const CEDULA_REGEX = /^\d{6,15}$/;
const NAME_MAX_LENGTH = 100;
const CITY_MIN_LENGTH = 2;
const CITY_MAX_LENGTH = 100;
const VALID_SPECIALTIES = [
  "electricidad",
  "plomeria",
  "carpinteria",
  "herreria",
  "pintura",
  "cerrajeria",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (igual que el formulario)
const MAX_CONTENT_LENGTH = MAX_FILE_SIZE + 1024 * 1024; // el cuerpo trae también los campos de texto

const PASSWORD_ERROR =
  "La contraseña debe tener mínimo 7 caracteres y contener al menos 2 números.";

// Máximo 5 registros de reparador por IP y hora (cuenta solo los que llegan al hash).
const repairerLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

function fail(message: string, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function isValidPassword(password: string): boolean {
  const numbersCount = (password.match(/\d/g) || []).length;
  return password.length >= PASSWORD_MIN_LENGTH && numbersCount >= 2;
}

// Con 4 o más palabras se asume "nombre(s) + dos apellidos".
function splitFullName(fullName: string): { nombres: string; apellidos: string } {
  const parts = fullName.trim().split(/\s+/);
  const apellidosCount = parts.length >= 4 ? 2 : 1;
  return {
    nombres: parts.slice(0, -apellidosCount).join(" "),
    apellidos: parts.slice(-apellidosCount).join(" "),
  };
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "desconocida"
  );
}

// El tipo MIME lo declara el cliente y se puede falsear: se comprueba también
// el contenido real del archivo (firma de los primeros bytes).
function detectFileType(
  buffer: Buffer
): { ext: StoredFileType; mime: string } | null {
  if (buffer.length > 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { ext: "pdf", mime: "application/pdf" };
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buffer.length > 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: "png", mime: "image/png" };
  }
  return null;
}

// Nombre original para mostrarlo: sin rutas ni caracteres de control, máximo 150.
// Nunca se usa para guardar el archivo (ese nombre es aleatorio).
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  let clean = "";
  for (const ch of base) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) clean += ch;
  }
  clean = clean.replace(/\s+/g, " ").trim().slice(0, 150);
  return clean || "documento";
}

export async function POST(request: Request) {
  let storedKey: string | null = null;

  try {
    // Sin un Content-Length válido no se puede acotar el tamaño antes de leer el cuerpo.
    const contentLengthHeader = request.headers.get("content-length");
    if (
      contentLengthHeader === null ||
      !/^\d+$/.test(contentLengthHeader.trim()) ||
      Number(contentLengthHeader) === 0
    ) {
      return fail("La solicitud debe incluir un encabezado Content-Length válido.", 411);
    }
    if (Number(contentLengthHeader) > MAX_CONTENT_LENGTH) {
      return fail("El archivo excede el tamaño máximo de 10 MB.", 413);
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return fail("Se esperaba un formulario multipart/form-data.");
    }

    const text = (key: string) => {
      const value = formData.get(key);
      return typeof value === "string" ? value : "";
    };

    const name = text("name").trim();
    const username = text("username").trim().toLowerCase();
    const cedula = text("cedula").trim();
    const city = text("city").trim();
    const specialty = text("specialty").trim();
    const password = text("password");
    const confirmPassword = text("confirmPassword");
    const documentEntry = formData.get("document");

    if (!name || !username || !cedula || !city || !specialty || !password || !confirmPassword) {
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
      return fail("Ingresa el nombre completo incluyendo al menos un apellido.");
    }
    if (!CEDULA_REGEX.test(cedula)) {
      return fail("La cédula debe tener solo números (6 a 15 dígitos).");
    }
    if (city.length < CITY_MIN_LENGTH || city.length > CITY_MAX_LENGTH) {
      return fail("Ingresa una ciudad de cobertura válida.");
    }
    if (!VALID_SPECIALTIES.includes(specialty)) {
      return fail("La especialidad seleccionada no es válida.");
    }

    // --- Documento de acreditación ---
    // Un archivo llega como objeto (File); un campo de texto llega como string.
    // Se evita `instanceof File` porque su clase puede variar según el entorno.
    if (documentEntry === null || typeof documentEntry === "string" || documentEntry.size === 0) {
      return fail("Debes adjuntar tu documento de acreditación (PDF, JPG o PNG).");
    }
    if (documentEntry.size > MAX_FILE_SIZE) {
      return fail("El archivo supera el límite de 10 MB.", 413);
    }
    const buffer = Buffer.from(await documentEntry.arrayBuffer());
    const detected = detectFileType(buffer);
    if (!detected) {
      return fail("El archivo no es un PDF, JPG o PNG válido.");
    }

    // --- Comprobaciones en la base de datos (antes de guardar nada en disco) ---
    const existingUser = await prisma.usuario.findUnique({
      where: { nombreUsuario: username },
      select: { id: true },
    });
    if (existingUser) {
      return fail("El nombre de usuario ya está registrado.", 409);
    }

    const existingProfile = await prisma.perfilReparador.findUnique({
      where: { numeroDocumento: cedula },
      select: { id: true },
    });
    if (existingProfile) {
      return fail("Ya existe un reparador registrado con ese número de documento.", 409);
    }

    const category = await prisma.categoriaServicio.findUnique({
      where: { slug: specialty },
      select: { id: true, activo: true },
    });
    if (!category || !category.activo) {
      console.error(`[REGISTRO-REPARADOR] La categoría "${specialty}" no existe o está inactiva en la base de datos`);
      return fail(
        "La especialidad seleccionada todavía no está disponible. Contacta al administrador.",
        503
      );
    }

    // Límite por IP: solo cuentan las solicitudes que llegan hasta aquí.
    const ip = getClientIp(request);
    if (repairerLimiter.isLimited(ip)) {
      return fail("Demasiados registros desde esta conexión. Intenta de nuevo más tarde.", 429);
    }
    repairerLimiter.record(ip);

    const passwordHash = await hashPassword(password);
    const { nombres, apellidos } = splitFullName(name);

    storedKey = await saveAccreditationFile(buffer, detected.ext);

    // La cuenta nace "en revisión": un administrador debe aprobar la acreditación.
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: username,
        passwordHash,
        rol: "REPARADOR",
        estado: "EN_REVISION",
        perfilReparador: {
          create: {
            tipoDocumento: "CEDULA",
            numeroDocumento: cedula,
            nombres,
            apellidos,
            ciudadCobertura: city,
            especialidades: { create: [{ categoriaId: category.id }] },
            documentos: {
              create: [
                {
                  tipoDocumento: "ACREDITACION",
                  archivoUrl: storedKey,
                  nombreOriginal: sanitizeFileName(documentEntry.name),
                  mimeType: detected.mime,
                  tamanoBytes: buffer.length,
                },
              ],
            },
          },
        },
      },
      include: USUARIO_INCLUDE,
    });
    storedKey = null; // la cuenta ya existe: el archivo debe conservarse

    // Si la sesión falla, la cuenta ya existe: no se devuelve 500 para que no reintente.
    let sesionIniciada = true;
    try {
      await createSession(usuario.id);
    } catch (sessionError) {
      sesionIniciada = false;
      console.error("Cuenta de reparador creada pero falló la sesión:", sessionError);
    }

    // Nunca se devuelve el hash ni los campos internos de seguridad.
    const {
      passwordHash: _hash,
      codigoVerificacion: _codigo,
      codigoVerificacionExpiraEn: _codigoExpira,
      intentosFallidosLogin: _intentos,
      bloqueadoHasta: _bloqueo,
      ...usuarioSeguro
    } = usuario;

    return Response.json(
      {
        success: true,
        message: sesionIniciada
          ? "Cuenta de reparador creada. Tu documentación está en revisión."
          : "Cuenta creada. Inicia sesión para continuar.",
        sesionIniciada,
        user: usuarioSeguro,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error al registrar reparador:", error);

    // Si el archivo ya se guardó pero la cuenta no se creó, se borra para no dejar archivos huérfanos.
    if (storedKey) await deleteStoredFile(storedKey);

    if ((error as { code?: string }).code === "P2002") {
      return fail("El usuario o el documento ya están registrados.", 409);
    }
    return fail("No fue posible crear la cuenta.", 500);
  }
}
