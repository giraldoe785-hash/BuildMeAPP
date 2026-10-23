import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Carpeta donde se guardan los archivos subidos (documentos de acreditación).
// NO está dentro de public/: nadie puede descargarlos con una URL directa.
// Se puede cambiar con la variable de entorno STORAGE_DIR.
//
// Limitación: es el disco del servidor. Sirve para desarrollo y para correr la
// app en un solo equipo. Si algún día se despliega en un hosting sin disco
// persistente, habrá que cambiar solo este archivo por un servicio de
// almacenamiento (el resto del código solo guarda y lee la "clave" del archivo).

function storageRoot(): string {
  return path.resolve(process.cwd(), process.env.STORAGE_DIR || "storage");
}

// Convierte una clave en ruta y evita salirse de la carpeta de almacenamiento.
function resolveKey(key: string): string {
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new Error("Ruta de archivo inválida");
  }
  return full;
}

export type StoredFileType = "pdf" | "jpg" | "png";

/** Guarda el archivo con un nombre aleatorio y devuelve su clave (p. ej. "acreditaciones/<uuid>.pdf"). */
export async function saveAccreditationFile(
  buffer: Buffer,
  ext: StoredFileType
): Promise<string> {
  const key = `acreditaciones/${randomUUID()}.${ext}`;
  const fullPath = resolveKey(key);

  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer, { flag: "wx" }); // "wx": nunca sobrescribe

  return key;
}

/** Guarda un adjunto de soporte con nombre aleatorio bajo "soporte/<uuid>.<ext>". */
export async function saveSupportAttachment(
  buffer: Buffer,
  ext: StoredFileType
): Promise<string> {
  const key = `soporte/${randomUUID()}.${ext}`;
  const fullPath = resolveKey(key);

  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer, { flag: "wx" });

  return key;
}

/** Lee un archivo almacenado tras validar que su clave no sale de la carpeta base. */
export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

/** Borra un archivo guardado. Si ya no existe, no hace nada. */
export async function deleteStoredFile(key: string): Promise<void> {
  try {
    await unlink(resolveKey(key));
  } catch {
    /* ya no existe */
  }
}
