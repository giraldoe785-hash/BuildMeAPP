import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/storage";
import { mimeFromStoredKey } from "@/lib/supportPolicy";
import { getAttachmentKey } from "@/lib/supportService";

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json(
        { success: false, message: "Debes iniciar sesión." },
        { status: 401, headers: SECURITY_HEADERS }
      );
    }

    const { id } = await context.params;
    const keyResult = await getAttachmentKey(prisma, user, id);
    if (!keyResult.ok) {
      return Response.json(
        { success: false, message: keyResult.message },
        { status: keyResult.status, headers: SECURITY_HEADERS }
      );
    }

    const buffer = await readStoredFile(keyResult.data);
    const mime = mimeFromStoredKey(keyResult.data);
    const ext = keyResult.data.split(".").pop() ?? "bin";
    const isPdf = mime === "application/pdf";

    // Endurecimiento A-01: los PDFs se entregan como attachment forzado con sandbox;
    // las imágenes conservan visualización inline para comodidad de mediación.
    const disposition = isPdf
      ? `attachment; filename="adjunto-${id.slice(0, 8)}.pdf"`
      : `inline; filename="adjunto-${id.slice(0, 8)}.${ext}"`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": mime,
        "Content-Disposition": disposition,
      },
    });
  } catch (error) {
    console.error("[SupportAttachment][GET] Error:", error);
    return Response.json(
      { success: false, message: "Archivo adjunto no disponible." },
      { status: 404, headers: SECURITY_HEADERS }
    );
  }
}
