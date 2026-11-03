import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// Carpeta donde se guardan los archivos locales (desarrollo).
// En Render / producción (Plan Free - USD 0), se utiliza Supabase Storage (bucket privado).
// Cloudflare R2 queda estrictamente desactivado para mantener USD 0 de costo adicional.

export type StoredFileType = "pdf" | "jpg" | "png";
export type StorageProviderType = "local" | "supabase" | "r2";

export class StorageConfigurationError extends Error {
  code: string;
  constructor(message: string, code = "STORAGE_CONFIGURATION_ERROR") {
    super(message);
    this.name = "StorageConfigurationError";
    this.code = code;
  }
}

/**
 * Expresión regular estricta para validar claves de almacenamiento autorizadas:
 * - Prefijo único: 'acreditaciones' o 'soporte'
 * - Separador único '/'
 * - Nombre de archivo: UUIDv4 canónico
 * - Extensión autorizada: pdf, jpg o png
 * Rechaza '..', barras invertidas, prefijos desconocidos, segmentos adicionales o caracteres de escape.
 */
const VALID_KEY_REGEX =
  /^(acreditaciones|soporte)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/i;

export function isValidStorageKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  if (
    key.includes("..") ||
    key.includes("\\") ||
    key.startsWith("/") ||
    key.endsWith("/")
  ) {
    return false;
  }
  return VALID_KEY_REGEX.test(key);
}

export function validateStorageKey(key: string): void {
  if (!isValidStorageKey(key)) {
    throw new Error("Ruta de archivo inválida");
  }
}

/**
 * Determina el proveedor de almacenamiento configurado.
 * Regla de producción:
 * - Debe configurarse explícitamente "supabase" (o detectarse SUPABASE_URL).
 * - Si se intenta usar "r2" en producción, se rechaza de inmediato (USD 0).
 * - No se permite fallback silencioso a filesystem local en producción.
 */
export function getStorageProvider(): StorageProviderType {
  const configured = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    if (configured === "r2") {
      throw new StorageConfigurationError(
        "Cloudflare R2 está desactivado para este despliegue por restricción de presupuesto (USD 0). Utilice STORAGE_PROVIDER=supabase.",
        "R2_DEACTIVATED_FOR_FREE_TIER"
      );
    }
    if (configured === "supabase" || process.env.SUPABASE_URL) {
      return "supabase";
    }
    throw new StorageConfigurationError(
      "En entorno de producción (Render Free) se requiere configurar almacenamiento externo (STORAGE_PROVIDER=supabase). El almacenamiento local no está permitido en producción.",
      "LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION"
    );
  }

  // Entorno de desarrollo local / pruebas
  if (configured === "supabase") return "supabase";
  if (configured === "r2") return "r2";
  if (configured === "local") return "local";

  if (
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    return "supabase";
  }
  if (process.env.R2_BUCKET_NAME || process.env.R2_ACCOUNT_ID) {
    return "r2";
  }

  return "local";
}

/**
 * Comprueba si el proveedor actual dispone de sus credenciales completas
 * sin lanzar excepciones ni exponer valores sensibles.
 */
export function isStorageConfigured(): boolean {
  try {
    const provider = getStorageProvider();
    if (provider === "local") {
      return process.env.NODE_ENV !== "production";
    }
    if (provider === "supabase") {
      const url = process.env.SUPABASE_URL?.trim();
      const key =
        process.env.SUPABASE_SECRET_KEY?.trim() ||
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      return Boolean(url && key);
    }
    if (provider === "r2") {
      return false; // Desactivado
    }
    return false;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Adaptador Supabase Storage (Free Tier - USD 0)
// -----------------------------------------------------------------------------

interface SupabaseStorageConfig {
  url: string;
  secretKey: string;
  bucketName: string;
}

function getSupabaseConfig(): SupabaseStorageConfig {
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucketName =
    process.env.SUPABASE_STORAGE_BUCKET?.trim() || "buildmeapp-private-documents";

  if (!url || !secretKey) {
    throw new StorageConfigurationError(
      "Configuración de Supabase Storage incompleta. Faltan variables SUPABASE_URL o SUPABASE_SECRET_KEY.",
      "SUPABASE_CONFIGURATION_MISSING"
    );
  }

  return { url, secretKey, bucketName };
}

// Cliente inyectable para pruebas unitarias sin llamadas a la red
let customSupabaseClientForTests: any = null;
let supabaseClientInstance: SupabaseClient | null = null;

export function setSupabaseClientForTests(client: any): void {
  customSupabaseClientForTests = client;
}

function getSupabaseClient(): { client: any; bucketName: string } {
  if (customSupabaseClientForTests) {
    const bucketName =
      process.env.SUPABASE_STORAGE_BUCKET?.trim() || "buildmeapp-private-documents";
    return { client: customSupabaseClientForTests, bucketName };
  }

  const config = getSupabaseConfig();
  if (!supabaseClientInstance) {
    // Cliente de servidor con SUPABASE_SECRET_KEY. Sesión persistente y renovación desactivadas.
    supabaseClientInstance = createClient(config.url, config.secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return { client: supabaseClientInstance, bucketName: config.bucketName };
}

// -----------------------------------------------------------------------------
// Adaptador Cloudflare R2 (Conservado por compatibilidad, desactivado en prod)
// -----------------------------------------------------------------------------

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

/** Restablece los clientes singleton para pruebas unitarias. */
export function resetStorageClientsForTests(): void {
  customSupabaseClientForTests = null;
  supabaseClientInstance = null;
  customS3ClientForTests = null;
  s3ClientInstance = null;
}

// -----------------------------------------------------------------------------
// Utilidades de validación y rutas
// -----------------------------------------------------------------------------

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

function resolveKey(key: string): string {
  validateStorageKey(key);
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new Error("Ruta de archivo inválida");
  }
  return full;
}

// -----------------------------------------------------------------------------
// Operaciones del Adaptador
// -----------------------------------------------------------------------------

/**
 * Guarda un archivo de acreditación (reparadores) con nombre UUID no determinista.
 * En Supabase Storage se almacena en el bucket privado bajo "acreditaciones/<uuid>.<ext>".
 */
export async function saveAccreditationFile(
  buffer: Buffer,
  ext: StoredFileType
): Promise<string> {
  // Límite de seguridad de BuildMeAPP (10 MB, inferior al límite de 50 MB de Supabase Free)
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("El archivo excede el tamaño máximo permitido de 10 MB.");
  }

  const provider = getStorageProvider();
  const key = `acreditaciones/${randomUUID()}.${ext}`;

  if (provider === "supabase") {
    const { client, bucketName } = getSupabaseClient();
    const contentType = mimeTypeForExt(ext);
    const { error } = await client.storage
      .from(bucketName)
      .upload(key, buffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(`Error al almacenar archivo en Supabase Storage: ${error.message}`);
    }
    return key;
  }

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

/**
 * Guarda un adjunto de soporte con nombre UUID no determinista bajo "soporte/<uuid>.<ext>".
 */
export async function saveSupportAttachment(
  buffer: Buffer,
  ext: StoredFileType
): Promise<string> {
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("El archivo excede el tamaño máximo permitido de 10 MB.");
  }

  const provider = getStorageProvider();
  const key = `soporte/${randomUUID()}.${ext}`;

  if (provider === "supabase") {
    const { client, bucketName } = getSupabaseClient();
    const contentType = mimeTypeForExt(ext);
    const { error } = await client.storage
      .from(bucketName)
      .upload(key, buffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(`Error al almacenar adjunto en Supabase Storage: ${error.message}`);
    }
    return key;
  }

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

/**
 * Lee un archivo almacenado (desde Supabase Storage, R2 o filesystem local).
 * Valida de forma estricta que la clave coincida con los formatos autorizados.
 * Para Supabase se descarga el blob privado y se convierte a Buffer sin generar URL pública.
 */
export async function readStoredFile(key: string): Promise<Buffer> {
  validateStorageKey(key);

  const provider = getStorageProvider();
  const cleanKey = key.replace(/^\/+/, "");

  if (provider === "supabase") {
    const { client, bucketName } = getSupabaseClient();
    const { data, error } = await client.storage
      .from(bucketName)
      .download(cleanKey);

    if (error || !data) {
      throw new Error(
        `Error al descargar archivo de Supabase Storage: ${error?.message || "Archivo no encontrado"}`
      );
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (provider === "r2") {
    const { client, bucketName } = getS3Client();
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

/**
 * Elimina un archivo de Supabase Storage, R2 o disco local.
 * Valida que la clave sea autorizada antes de procesar el borrado.
 * Si ya no existe, la operación finaliza de manera controlada.
 */
export async function deleteStoredFile(key: string): Promise<void> {
  if (!isValidStorageKey(key)) {
    return;
  }

  const provider = getStorageProvider();
  const cleanKey = key.replace(/^\/+/, "");

  if (provider === "supabase") {
    try {
      const { client, bucketName } = getSupabaseClient();
      await client.storage.from(bucketName).remove([cleanKey]);
    } catch {
      /* ya no existe o fallo controlado */
    }
    return;
  }

  if (provider === "r2") {
    try {
      const { client, bucketName } = getS3Client();
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
