import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Frame-Options": "DENY",
};

const SAFE_INLINE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; documentId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión como administrador para visualizar documentos.",
        },
        401
      );
    }

    if (user.rol !== "ADMINISTRADOR") {
      return jsonResponse(
        {
          success: false,
          code: "FORBIDDEN",
          message: "No tienes autorización para acceder a los documentos de este expediente.",
        },
        403
      );
    }

    const { id: targetUserId, documentId } = await context.params;

    if (!targetUserId || !documentId) {
      return jsonResponse(
        {
          success: false,
          code: "BAD_REQUEST",
          message: "Parámetros de consulta incompletos.",
        },
        400
      );
    }

    // Consulta del documento verificando pertenencia estricta al expediente del reparador
    const doc = await prisma.documentoReparador.findUnique({
      where: { id: documentId },
      include: {
        reparador: {
          select: { usuarioId: true },
        },
      },
    });

    if (!doc || doc.reparador.usuarioId !== targetUserId) {
      return jsonResponse(
        {
          success: false,
          code: "DOCUMENT_NOT_FOUND",
          message: "El documento solicitado no existe o no pertenece al expediente indicado.",
        },
        404
      );
    }

    try {
      const buffer = await readStoredFile(doc.archivoUrl);
      const safeFileName = (doc.nombreOriginal || "documento").replace(/["\r\n]/g, "_");

      const isSafeInline = Boolean(doc.mimeType && SAFE_INLINE_MIME_TYPES.has(doc.mimeType));
      const contentType = (isSafeInline && doc.mimeType) ? doc.mimeType : "application/octet-stream";
      const disposition = isSafeInline ? "inline" : "attachment";

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          ...NO_STORE,
          "Content-Type": contentType,
          "Content-Disposition": `${disposition}; filename="${encodeURIComponent(safeFileName)}"`,
        },
      });
    } catch (readErr: unknown) {
      const errorObj = readErr as { name?: string; code?: string };
      if (
        errorObj?.name === "StorageConfigurationError" ||
        errorObj?.code === "SUPABASE_CONFIGURATION_MISSING" ||
        errorObj?.code === "R2_DEACTIVATED_FOR_FREE_TIER" ||
        errorObj?.code === "LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION"
      ) {
        return jsonResponse(
          {
            success: false,
            code: "STORAGE_NOT_CONFIGURED",
            message: "El servicio de almacenamiento no está disponible o no ha sido configurado.",
          },
          503
        );
      }
      return jsonResponse(
        {
          success: false,
          code: "FILE_NOT_FOUND",
          message: "El archivo físico no fue encontrado en el almacenamiento.",
        },
        404
      );
    }
  } catch (error) {
    console.error("[AdminRepairerDocAPI][GET] Error al servir documento:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible procesar la consulta del documento.",
      },
      500
    );
  }
}
