import { getStorageProvider, isStorageConfigured } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  let storageProvider = "unknown";
  let storageConfigured = false;

  try {
    storageProvider = getStorageProvider();
    storageConfigured = isStorageConfigured();
  } catch (err: unknown) {
    const error = err as { code?: string };
    storageProvider = error?.code || "unconfigured";
    storageConfigured = false;
  }

  return Response.json(
    {
      status: "ok",
      app: "BuildMeAPP",
      version: "1.0.0-rc1",
      timestamp: new Date().toISOString(),
      storage: {
        provider: storageProvider,
        configured: storageConfigured,
      },
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
