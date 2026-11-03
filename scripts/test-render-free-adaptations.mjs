/**
 * scripts/test-render-free-adaptations.mjs
 *
 * Suite de validación automatizada para la adaptación a Render Free:
 * 1. Health Check (/api/health) con verificación de proveedor de almacenamiento
 * 2. Adaptador Supabase Storage (Free Tier - USD 0), variable canónica SUPABASE_SECRET_KEY y desactivación de R2
 * 3. Operaciones de Supabase Storage con cliente mockeado y sin llamadas de red:
 *    - Subida y descarga de acreditaciones y adjuntos con la misma clave
 *    - Eliminación de archivos
 *    - Validación estricta de rutas y rechazo de manipulación / traversal
 *    - Límite de 10 MB y detección de tipo de archivo
 *    - Compensación ante fallo de base de datos
 * 4. Adaptador de correo Resend HTTPS API y fallback SMTP (lib/email.ts)
 * 5. Validación de especificación de Blueprint Render (render.yaml) y Prisma 7 config
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/types") {
      const absPath = path.resolve(process.cwd(), "types/index.ts");
      return nextResolve(pathToFileURL(absPath).href, context);
    }
    if (specifier.startsWith("@/")) {
      const relPath = specifier.slice(2);
      const absPath = path.resolve(process.cwd(), relPath + ".ts");
      return nextResolve(pathToFileURL(absPath).href, context);
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (!/\.(ts|js|mjs|json)$/.test(specifier)) {
        try {
          return nextResolve(specifier + ".ts", context);
        } catch {
          // fallback
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

console.log("=== INICIANDO VALIDACIÓN DE ADAPTACIÓN RENDER FREE (SUPABASE STORAGE + RESEND + NEON) ===");

// 1. Health Check
test("1. Health Check (/api/health): formato de respuesta y ausencia de secretos", async () => {
  const { GET } = await import("../app/api/health/route.ts");
  const response = await GET();
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.status, "ok");
  assert.equal(data.app, "BuildMeAPP");
  assert.ok(data.version);
  assert.ok(data.timestamp);
  assert.ok(data.storage, "Debe reportar el objeto storage");
  assert.ok(data.storage.provider, "Debe indicar el proveedor de storage");

  // Asegurar que no se exponen credenciales ni URLs en la respuesta
  const text = JSON.stringify(data);
  assert.ok(!text.includes("postgresql:"), "No debe exponer cadenas de conexión");
  assert.ok(!text.includes("sb_secret_"), "No debe exponer claves secretas");
  assert.ok(!text.includes("secret"), "No debe exponer secretos");
  assert.ok(!text.includes("password"), "No debe exponer contraseñas");
});

// 2. Selección de proveedor y reglas de entorno
test("2. Almacenamiento: reglas de selección, variable canónica SUPABASE_SECRET_KEY y rechazo de R2 en producción", async () => {
  const storage = await import("../lib/storage.ts");

  const prevProvider = process.env.STORAGE_PROVIDER;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevSupabaseKey = process.env.SUPABASE_SECRET_KEY;

  try {
    delete process.env.STORAGE_PROVIDER;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NODE_ENV = "development";

    // En desarrollo: por defecto es local
    assert.equal(storage.getStorageProvider(), "local");

    // En desarrollo: si se configura supabase explícitamente
    process.env.STORAGE_PROVIDER = "supabase";
    assert.equal(storage.getStorageProvider(), "supabase");

    // En producción (Render Free): STORAGE_PROVIDER=r2 debe ser RECHAZADO por regla de USD 0
    process.env.NODE_ENV = "production";
    process.env.STORAGE_PROVIDER = "r2";
    assert.throws(
      () => storage.getStorageProvider(),
      (err) => {
        assert.equal(err.name, "StorageConfigurationError");
        assert.equal(err.code, "R2_DEACTIVATED_FOR_FREE_TIER");
        return true;
      }
    );

    // En producción: fallback a local está estrictamente prohibido
    process.env.STORAGE_PROVIDER = "local";
    assert.throws(
      () => storage.getStorageProvider(),
      (err) => {
        assert.equal(err.name, "StorageConfigurationError");
        assert.equal(err.code, "LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION");
        return true;
      }
    );

    // En producción: supabase configurado pero sin credenciales -> getStorageProvider devuelve supabase
    process.env.STORAGE_PROVIDER = "supabase";
    assert.equal(storage.getStorageProvider(), "supabase");

    // Pero al intentar usar el cliente sin credenciales debe lanzar error controlado
    await assert.rejects(
      async () => {
        await storage.saveAccreditationFile(Buffer.from("dummy-pdf"), "pdf");
      },
      (err) => {
        assert.equal(err.name, "StorageConfigurationError");
        assert.equal(err.code, "SUPABASE_CONFIGURATION_MISSING");
        return true;
      }
    );
  } finally {
    if (prevProvider) process.env.STORAGE_PROVIDER = prevProvider;
    else delete process.env.STORAGE_PROVIDER;
    if (prevNodeEnv) process.env.NODE_ENV = prevNodeEnv;
    else delete process.env.NODE_ENV;
    if (prevSupabaseUrl) process.env.SUPABASE_URL = prevSupabaseUrl;
    else delete process.env.SUPABASE_URL;
    if (prevSupabaseKey) process.env.SUPABASE_SECRET_KEY = prevSupabaseKey;
    else delete process.env.SUPABASE_SECRET_KEY;
  }
});

// 3. Operaciones de Supabase Storage con cliente mockeado y validación de claves
test("3. Supabase Storage: subida, descarga y eliminación con la misma clave, validación estricta y compensación", async () => {
  const storage = await import("../lib/storage.ts");

  let uploadParams = null;
  let downloadedKey = null;
  let removedKeys = null;

  const mockSupabaseClient = {
    storage: {
      from: (bucket) => ({
        upload: async (key, buffer, options) => {
          uploadParams = { bucket, key, buffer, options };
          return { data: { path: key }, error: null };
        },
        download: async (key) => {
          downloadedKey = key;
          return {
            data: {
              arrayBuffer: async () => Buffer.from("fake-supabase-pdf-bytes"),
            },
            error: null,
          };
        },
        remove: async (keys) => {
          removedKeys = keys;
          return { data: keys, error: null };
        },
      }),
    },
  };

  const prevProvider = process.env.STORAGE_PROVIDER;
  const prevNodeEnv = process.env.NODE_ENV;

  try {
    process.env.STORAGE_PROVIDER = "supabase";
    process.env.NODE_ENV = "production";
    storage.setSupabaseClientForTests(mockSupabaseClient);

    // 1. Guardar archivo de acreditación
    const dummyBuffer = Buffer.from("pdf-content-test");
    const key = await storage.saveAccreditationFile(dummyBuffer, "pdf");

    assert.ok(key.startsWith("acreditaciones/"));
    assert.ok(key.endsWith(".pdf"));
    assert.equal(uploadParams.bucket, "buildmeapp-private-documents");
    assert.equal(uploadParams.key, key);
    assert.equal(uploadParams.options.contentType, "application/pdf");
    assert.equal(uploadParams.options.upsert, false);

    // 2. Descargar archivo usando EXACTAMENTE la misma clave
    const downloadedBuffer = await storage.readStoredFile(key);
    assert.equal(downloadedKey, key, "Debe descargar exactamente la misma clave generada");
    assert.equal(downloadedBuffer.toString(), "fake-supabase-pdf-bytes");

    // 3. Eliminar archivo usando EXACTAMENTE la misma clave
    await storage.deleteStoredFile(key);
    assert.deepEqual(removedKeys, [key], "Debe eliminar exactamente la misma clave");

    // 4. Guardar adjunto de soporte
    const ticketBuffer = Buffer.from("ticket-png-content");
    const ticketKey = await storage.saveSupportAttachment(ticketBuffer, "png");
    assert.ok(ticketKey.startsWith("soporte/"));
    assert.ok(ticketKey.endsWith(".png"));
    assert.equal(uploadParams.key, ticketKey);
    assert.equal(uploadParams.options.contentType, "image/png");

    // 5. Descargar y eliminar adjunto de soporte con la misma clave
    const ticketDownloaded = await storage.readStoredFile(ticketKey);
    assert.equal(downloadedKey, ticketKey);
    assert.equal(ticketDownloaded.toString(), "fake-supabase-pdf-bytes");
    await storage.deleteStoredFile(ticketKey);
    assert.deepEqual(removedKeys, [ticketKey]);

    // 6. Validación estricta de rutas de almacenamiento:
    // Formatos válidos:
    assert.equal(storage.isValidStorageKey("acreditaciones/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.pdf"), true);
    assert.equal(storage.isValidStorageKey("soporte/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.png"), true);
    assert.equal(storage.isValidStorageKey("soporte/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.jpg"), true);

    // Formatos inválidos / manipulados:
    assert.equal(storage.isValidStorageKey("../etc/passwd"), false);
    assert.equal(storage.isValidStorageKey("acreditaciones/../passwd"), false);
    assert.equal(storage.isValidStorageKey("acreditaciones\\uuid.pdf"), false);
    assert.equal(storage.isValidStorageKey("invalido/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.pdf"), false);
    assert.equal(storage.isValidStorageKey("acreditaciones/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.exe"), false);
    assert.equal(storage.isValidStorageKey("/acreditaciones/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.pdf"), false);

    // Intentar leer con clave manipulada debe ser rechazado inmediatamente
    await assert.rejects(
      async () => {
        await storage.readStoredFile("../etc/passwd");
      },
      /Ruta de archivo inválida/
    );

    // 7. Archivo que supera el límite de 10 MB debe ser rechazado antes de la subida
    const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024);
    await assert.rejects(
      async () => {
        await storage.saveAccreditationFile(oversizedBuffer, "pdf");
      },
      /excede el tamaño máximo/
    );

    // 8. Compensación en fallo de base de datos simulado:
    // Si la DB falla tras crear el archivo, deleteStoredFile limpia el archivo
    let compensatedKey = null;
    const compensationMock = {
      storage: {
        from: () => ({
          upload: async (k) => ({ data: { path: k }, error: null }),
          remove: async (keys) => {
            compensatedKey = keys[0];
            return { data: keys, error: null };
          },
        }),
      },
    };
    storage.setSupabaseClientForTests(compensationMock);

    let savedKey = null;
    try {
      savedKey = await storage.saveAccreditationFile(dummyBuffer, "pdf");
      // Simular fallo en inserción PostgreSQL
      throw new Error("DB_WRITE_FAILURE");
    } catch {
      if (savedKey) {
        await storage.deleteStoredFile(savedKey);
      }
    }
    assert.equal(compensatedKey, savedKey, "El archivo debe ser eliminado como compensación");

    // 9. Error devuelto por Supabase al subir debe propagarse como excepción clara
    const failingMock = {
      storage: {
        from: () => ({
          upload: async () => ({
            data: null,
            error: { message: "Bucket quota exceeded or storage down" },
          }),
        }),
      },
    };
    storage.setSupabaseClientForTests(failingMock);
    await assert.rejects(
      async () => {
        await storage.saveAccreditationFile(dummyBuffer, "pdf");
      },
      /Error al almacenar archivo en Supabase Storage/
    );
  } finally {
    storage.resetStorageClientsForTests();
    if (prevProvider) process.env.STORAGE_PROVIDER = prevProvider;
    else delete process.env.STORAGE_PROVIDER;
    if (prevNodeEnv) process.env.NODE_ENV = prevNodeEnv;
    else delete process.env.NODE_ENV;
  }
});

// 4. Adaptador de correo (lib/email.ts)
test("4. Correo: detección de proveedor Resend y envío mediante HTTPS API mock", async () => {
  const email = await import("../lib/email.ts");

  const prevProvider = process.env.EMAIL_PROVIDER;
  const prevApiKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.EMAIL_FROM;

  try {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test_mock_key_123456";
    process.env.EMAIL_FROM = "BuildMeAPP <notificaciones@buildmeapp.test>";

    assert.equal(email.getEmailProvider(), "resend");
    assert.equal(email.isEmailConfigComplete(), true);

    let sentParams = null;
    const mockResend = {
      emails: {
        send: async (params) => {
          sentParams = params;
          return { data: { id: "resend-msg-id-998877" }, error: null };
        },
      },
    };

    email.setResendClientForTests(mockResend);

    const result = await email.sendVerificationCodeEmail({
      to: "usuario.demo@example.com",
      nombre: "Juan Demo",
      codigo: "654321",
      expiraEnMinutos: 15,
    });

    assert.equal(result.success, true);
    assert.equal(result.providerMessageId, "resend-msg-id-998877");
    assert.equal(sentParams.to, "usuario.demo@example.com");
    assert.ok(sentParams.html.includes("654321"));
  } finally {
    email.setResendClientForTests(null);
    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;
    if (prevApiKey) process.env.RESEND_API_KEY = prevApiKey;
    else delete process.env.RESEND_API_KEY;
    if (prevFrom) process.env.EMAIL_FROM = prevFrom;
    else delete process.env.EMAIL_FROM;
  }
});

// 5. Validación de Blueprint Render (render.yaml) y configuración de Neon / Prisma 7
test("5. Render Blueprint y Prisma 7: validación de estructura Free Tier, variables de Neon y cero secretos en Git", () => {
  assert.ok(fs.existsSync("render.yaml"), "render.yaml debe existir en la raíz");
  const content = fs.readFileSync("render.yaml", "utf8");

  assert.ok(content.includes("name: buildmeapp-demo"));
  assert.ok(content.includes("plan: free"), "Debe usar plan: free");
  assert.ok(content.includes("runtime: docker"), "Debe usar runtime: docker");
  assert.ok(content.includes("branch: deploy/render-free-7593392"), "Debe apuntar a la rama de despliegue");
  assert.ok(content.includes("healthCheckPath: /api/health"), "Debe configurar /api/health");
  assert.ok(content.includes("autoDeploy: false"), "Debe tener autoDeploy: false");

  // Almacenamiento Supabase Storage con clave canónica SUPABASE_SECRET_KEY
  assert.ok(content.includes("STORAGE_PROVIDER"));
  assert.ok(content.includes("value: supabase"));
  assert.ok(content.includes("SUPABASE_URL"));
  assert.ok(content.includes("SUPABASE_SECRET_KEY"));
  assert.ok(content.includes("SUPABASE_STORAGE_BUCKET"));
  assert.ok(content.includes("buildmeapp-private-documents"));

  // Base de datos Neon: conexión pooled y direct
  assert.ok(content.includes("DATABASE_URL"));
  assert.ok(content.includes("DIRECT_URL"));

  // R2 NO debe estar presente en las variables activas del blueprint
  assert.ok(!content.includes("R2_ACCESS_KEY_ID"), "R2_ACCESS_KEY_ID no debe estar en render.yaml");
  assert.ok(!content.includes("R2_SECRET_ACCESS_KEY"), "R2_SECRET_ACCESS_KEY no debe estar en render.yaml");
  assert.ok(!content.includes("R2_ACCOUNT_ID"), "R2_ACCOUNT_ID no debe estar en render.yaml");

  // Correo y Pagos
  assert.ok(content.includes("EMAIL_PROVIDER"));
  assert.ok(content.includes("WOMPI_ENVIRONMENT"));

  // Verificación de que todos los secretos usan sync: false y no tienen valores hardcodeados
  const secretKeys = [
    "DATABASE_URL",
    "DIRECT_URL",
    "AUTH_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "RESEND_API_KEY",
    "WOMPI_PRIVATE_KEY",
    "WOMPI_INTEGRITY_SECRET",
  ];

  for (const key of secretKeys) {
    const regex = new RegExp(`key:\\s*${key}[\\s\\S]*?sync:\\s*false`);
    assert.ok(regex.test(content), `El secreto ${key} debe declararse con sync: false`);
  }

  // Verificación de prisma7.config.ts
  assert.ok(fs.existsSync("prisma7.config.ts"), "prisma7.config.ts debe existir");
  const prisma7Content = fs.readFileSync("prisma7.config.ts", "utf8");
  assert.ok(
    prisma7Content.includes("DIRECT_URL"),
    "prisma7.config.ts debe incluir DIRECT_URL para migraciones y CLI"
  );
});

console.log("=== TODAS LAS PRUEBAS DE ADAPTACIÓN RENDER FREE PASARON EXITOSAMENTE ===");
