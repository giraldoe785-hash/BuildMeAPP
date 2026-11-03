import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// Carpeta donde se guardan los archivos locales (desarrollo).
// En Render / producción con STORAGE_PROVIDER=r2, se utiliza Cloudflare R2 (API S3).

export type StoredFileType = "pdf" | "jpg" | "png";
export type StorageProviderType = "local" | "r2";

export class StorageConfigurationError extends Error {
  code: string;
  constructor(message: string, code = "STORAGE_CONFIGURATION_ERROR") {
    super(message);
    this.name = "StorageConfigurationError";
    this.code = code;
  }
}

export function getStorageProvider(): StorageProviderType {
  const configured = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (configured === "r2") return "r2";
  if (configured === "local") return "local";

  // Si se configuran credenciales R2 en variables de entorno, usar R2
  if (process.env.R2_BUCKET_NAME || process.env.R2_ACCOUNT_ID) {
    return "r2";
  }
  return "local";
}

interface R2Config {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
}

function getR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey || !endpoint) {
    throw new StorageConfigurationError(
      "Configuración de Cloudflare R2 incompleta. Faltan variables R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID o R2_SECRET_ACCESS_KEY.",
      "R2_CONFIGURATION_MISSING"
    );
  }

  return { accountId, bucketName, accessKeyId, secretAccessKey, endpoint };
}

let customS3ClientForTests: S3Client | null = null;
let s3ClientInstance: S3Client | null = null;

/** Permite inyectar un cliente S3 simulado en pruebas unitarias sin red. */
export function setS3ClientForTests(client: S3Client | null): void {
  customS3ClientForTests = client;
}

function getS3Client(): { client: S3Client; bucketName: string } {
  if (customS3ClientForTests) {
    const bucketName = process.env.R2_BUCKET_NAME?.trim() || "buildmeapp-docs-test";
    return { client: customS3ClientForTests, bucketName };
  }

  const config = getR2Config();
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return { client: s3ClientInstance, bucketName: config.bucketName };
}

function mimeTypeForExt(ext: StoredFileType): string {
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function storageRoot(): string {
  return path.resolve(process.cwd(), process.env.STORAGE_DIR || "storage");
}

// Convierte una clave en ruta y evita salirse de la carpeta de almacenamiento.
function resolveKey(key: string): string {
  if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
    throw new Error("Ruta de archivo inválida");
  }
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new Error("Ruta de archivo inválida");
  }
  return full;
}

/** Guarda el archivo con un nombre aleatorio y devuelve su clave (p. ej. "acreditaciones/<uuid>.pdf"). */
export async function saveAccreditationFile(
  buffer: Buffer,
  ext: StoredFileType
): Promise<string> {
  const provider = getStorageProvider();
  const key = `acreditaciones/${randomUUID()}.${ext}`;

  if (provider === "r2") {
    const { client, bucketName } = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeTypeForExt(ext),
      })
    );
    return key;
  }

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
  const provider = getStorageProvider();
  const key = `soporte/${randomUUID()}.${ext}`;

  if (provider === "r2") {
    const { client, bucketName } = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeTypeForExt(ext),
      })
    );
    return key;
  }

  const fullPath = resolveKey(key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer, { flag: "wx" });

  return key;
}

/** Lee un archivo almacenado (desde R2 o desde filesystem local tras validar su clave). */
export async function readStoredFile(key: string): Promise<Buffer> {
  const provider = getStorageProvider();

  if (provider === "r2") {
    const { client, bucketName } = getS3Client();
    const cleanKey = key.replace(/^\/+/, "");
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: cleanKey,
      })
    );

    if (!response.Body) {
      throw new Error("El objeto recuperado de R2 no contiene cuerpo de datos.");
    }

    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  return readFile(resolveKey(key));
}

/** Borra un archivo guardado en R2 o disco local. Si ya no existe, no hace nada. */
export async function deleteStoredFile(key: string): Promise<void> {
  const provider = getStorageProvider();

  if (provider === "r2") {
    try {
      const { client, bucketName } = getS3Client();
      const cleanKey = key.replace(/^\/+/, "");
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: cleanKey,
        })
      );
    } catch {
      /* ya no existe o fallo controlado */
    }
    return;
  }

  try {
    await unlink(resolveKey(key));
  } catch {
    /* ya no existe */
  }
}
