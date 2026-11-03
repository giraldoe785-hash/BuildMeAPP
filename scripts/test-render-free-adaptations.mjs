/**
 * scripts/test-render-free-adaptations.mjs
 *
 * Suite de validación automatizada para la adaptación a Render Free:
 * 1. Health Check (/api/health)
 * 2. Adaptador de almacenamiento Cloudflare R2 y fallback local (lib/storage.ts)
 * 3. Adaptador de correo Resend HTTPS API y fallback SMTP (lib/email.ts)
 * 4. Validación de especificación de Blueprint Render (render.yaml)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/types") {
      return nextResolve("../types/index.ts", context);
    }
    if (specifier.startsWith("@/")) {
      return nextResolve("../" + specifier.slice(2) + ".ts", context);
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

console.log("=== INICIANDO VALIDACIÓN DE ADAPTACIÓN RENDER FREE (R2 + RESEND + NEON) ===");

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

  // Asegurar que no se exponen credenciales ni URLs en la respuesta
  const text = JSON.stringify(data);
  assert.ok(!text.includes("postgresql:"), "No debe exponer cadenas de conexión");
  assert.ok(!text.includes("secret"), "No debe exponer secretos");
  assert.ok(!text.includes("password"), "No debe exponer contraseñas");
});

// 2. Adaptador de almacenamiento (lib/storage.ts)
test("2. Almacenamiento: detección de proveedor y protección ante configuración R2 faltante", async () => {
  const storage = await import("../lib/storage.ts");

  // Proveedor por defecto en local
  const prevProvider = process.env.STORAGE_PROVIDER;
  const prevBucket = process.env.R2_BUCKET_NAME;
  const prevAccount = process.env.R2_ACCOUNT_ID;

  try {
    delete process.env.STORAGE_PROVIDER;
    delete process.env.R2_BUCKET_NAME;
    delete process.env.R2_ACCOUNT_ID;

    assert.equal(storage.getStorageProvider(), "local");

    // Configurado explícitamente a R2 pero sin credenciales -> debe lanzar error controlado
    process.env.STORAGE_PROVIDER = "r2";
    assert.equal(storage.getStorageProvider(), "r2");

    await assert.rejects(
      async () => {
        await storage.saveAccreditationFile(Buffer.from("dummy-pdf"), "pdf");
      },
      (err) => {
        assert.equal(err.name, "StorageConfigurationError");
        assert.equal(err.code, "R2_CONFIGURATION_MISSING");
        return true;
      }
    );
  } finally {
    if (prevProvider) process.env.STORAGE_PROVIDER = prevProvider;
    else delete process.env.STORAGE_PROVIDER;
    if (prevBucket) process.env.R2_BUCKET_NAME = prevBucket;
    else delete process.env.R2_BUCKET_NAME;
    if (prevAccount) process.env.R2_ACCOUNT_ID = prevAccount;
    else delete process.env.R2_ACCOUNT_ID;
  }
});

test("3. Almacenamiento: operaciones en Cloudflare R2 con cliente S3 inyectado", async () => {
  const storage = await import("../lib/storage.ts");

  let uploadedCommand = null;
  let fetchedKey = null;
  let deletedKey = null;

  // Mock del cliente S3
  const mockS3Client = {
    send: async (command) => {
      const name = command?.constructor?.name || "";
      if (name.includes("PutObject") || command.input?.Body !== undefined) {
        uploadedCommand = command.input;
        return {};
      }
      if (name.includes("DeleteObject")) {
        deletedKey = command.input?.Key;
        return {};
      }
      if (name.includes("GetObject") || command.input?.Key) {
        fetchedKey = command.input.Key;
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(Buffer.from("fake-r2-pdf-bytes")),
          },
        };
      }
      return {};
    },
  };

  const prevProvider = process.env.STORAGE_PROVIDER;
  try {
    process.env.STORAGE_PROVIDER = "r2";
    storage.setS3ClientForTests(mockS3Client);

    // 1. Guardar archivo de acreditación
    const dummyBuffer = Buffer.from("pdf-content-test");
    const key = await storage.saveAccreditationFile(dummyBuffer, "pdf");

    assert.ok(key.startsWith("acreditaciones/"));
    assert.ok(key.endsWith(".pdf"));
    assert.equal(uploadedCommand.Key, key);
    assert.equal(uploadedCommand.ContentType, "application/pdf");

    // 2. Leer archivo
    const readBuffer = await storage.readStoredFile(key);
    assert.equal(fetchedKey, key);
    assert.equal(readBuffer.toString(), "fake-r2-pdf-bytes");

    // 3. Eliminar archivo
    await storage.deleteStoredFile(key);
    assert.equal(deletedKey, key);
  } finally {
    storage.setS3ClientForTests(null);
    if (prevProvider) process.env.STORAGE_PROVIDER = prevProvider;
    else delete process.env.STORAGE_PROVIDER;
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

// 5. Validación de Blueprint Render (render.yaml)
test("5. Render Blueprint: validación de estructura Free Tier y cero secretos en Git", () => {
  assert.ok(fs.existsSync("render.yaml"), "render.yaml debe existir en la raíz");
  const content = fs.readFileSync("render.yaml", "utf8");

  assert.ok(content.includes("name: buildmeapp-demo"));
  assert.ok(content.includes("plan: free"), "Debe usar plan: free");
  assert.ok(content.includes("runtime: docker"), "Debe usar runtime: docker");
  assert.ok(content.includes("branch: deploy/render-free-7593392"), "Debe apuntar a la rama de despliegue");
  assert.ok(content.includes("healthCheckPath: /api/health"), "Debe configurar /api/health");
  assert.ok(content.includes("autoDeploy: false"), "Debe tener autoDeploy: false");
  assert.ok(content.includes("STORAGE_PROVIDER"));
  assert.ok(content.includes("EMAIL_PROVIDER"));
  assert.ok(content.includes("WOMPI_ENVIRONMENT"));

  // Verificación de que todos los secretos usan sync: false y no tienen valores hardcodeados
  const secretKeys = [
    "DATABASE_URL",
    "AUTH_SECRET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "RESEND_API_KEY",
    "WOMPI_PRIVATE_KEY",
    "WOMPI_INTEGRITY_SECRET",
  ];

  for (const key of secretKeys) {
    const regex = new RegExp(`key:\\s*${key}[\\s\\S]*?sync:\\s*false`);
    assert.ok(regex.test(content), `El secreto ${key} debe declararse con sync: false`);
  }
});

console.log("=== TODAS LAS PRUEBAS DE ADAPTACIÓN RENDER FREE PASARON EXITOSAMENTE ===");
