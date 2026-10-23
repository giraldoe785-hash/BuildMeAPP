import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import { deleteStoredFile, saveSupportAttachment } from "@/lib/storage";
import {
  MAX_ATTACHMENT_BYTES,
  detectAttachmentType,
  validateMessageText,
} from "@/lib/supportPolicy";
import {
  listMessages,
  postMessage,
  validateMessageEligibility,
} from "@/lib/supportService";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_MULTIPART_BYTES = MAX_ATTACHMENT_BYTES + 1024 * 1024;

// Máximo 40 mensajes por usuario cada 5 minutos.
const messageLimiter = createRateLimiter({
  max: 40,
  windowMs: 5 * 60 * 1000,
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        { success: false, message: "Debes iniciar sesión." },
        401
      );
    }

    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get("since");
    let sinceDate: Date | null = null;
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      if (!Number.isNaN(parsed.getTime())) {
        sinceDate = parsed;
      }
    }

    const { id } = await context.params;
    const result = await listMessages(prisma, user, id, sinceDate);
    if (!result.ok) {
      return jsonResponse(
        { success: false, message: result.message },
        result.status
      );
    }

    return jsonResponse({ success: true, messages: result.data });
  } catch (error) {
    console.error("[SupportMessages][GET] Error:", error);
    return jsonResponse(
      { success: false, message: "No fue posible cargar los mensajes del ticket." },
      500
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  let storedKey: string | null = null;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        { success: false, message: "Debes iniciar sesión." },
        401
      );
    }
    if (user.estado === "SUSPENDIDO") {
      return jsonResponse(
        { success: false, message: "Tu cuenta está suspendida. Contacta a soporte." },
        403
      );
    }

    // Comprobación y consumo inmediato: los intentos cuentan antes de procesar el cuerpo.
    // Si ya superó el límite, se rechaza de inmediato antes de leer el stream.
    if (!messageLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          message: "Estás enviando mensajes demasiado rápido. Espera un momento.",
        },
        429
      );
    }

    // Lectura acotada físicamente del stream HTTP
    const bounded = await readBoundedBody(request, MAX_MULTIPART_BYTES);
    if (!bounded.ok) {
      return jsonResponse(
        { success: false, message: bounded.message },
        bounded.status
      );
    }
    const safeRequest = bounded.request;

    const contentType = safeRequest.headers.get("content-type") ?? "";
    let mensaje: unknown = "";
    let esNotaInterna: unknown = false;
    let fileEntry: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      let formData: FormData;
      try {
        formData = await safeRequest.formData();
      } catch {
        return jsonResponse(
          { success: false, message: "Formulario de mensaje inválido." },
          400
        );
      }

      mensaje = formData.get("mensaje") ?? "";
      esNotaInterna = formData.get("esNotaInterna") ?? false;
      const att = formData.get("attachment");
      if (att instanceof File && att.size > 0) {
        fileEntry = att;
      }
    } else {
      let body: unknown;
      try {
        body = await safeRequest.json();
      } catch {
        return jsonResponse(
          { success: false, message: "El cuerpo de la solicitud no es un JSON válido." },
          400
        );
      }
      if (typeof body !== "object" || body === null) {
        return jsonResponse({ success: false, message: "Solicitud inválida." }, 400);
      }
      const data = body as Record<string, unknown>;
      mensaje = data.mensaje;
      esNotaInterna = data.esNotaInterna;
    }

    const { id } = await context.params;
    const wantsInternal = esNotaInterna === true || esNotaInterna === "true";

    // Validación previa de elegibilidad: pertenencia, estado no cerrado y permisos de notas antes de almacenar archivos.
    const eligibility = await validateMessageEligibility(
      prisma,
      user,
      id,
      wantsInternal
    );
    if (!eligibility.ok) {
      return jsonResponse(
        { success: false, message: eligibility.message },
        eligibility.status
      );
    }

    const validatedText = validateMessageText(mensaje, Boolean(fileEntry));
    if (!validatedText.ok) {
      return jsonResponse(
        { success: false, message: validatedText.message },
        400
      );
    }

    // Solo se almacena el adjunto en disco una vez superada la validación de elegibilidad
    if (fileEntry) {
      if (fileEntry.size > MAX_ATTACHMENT_BYTES) {
        return jsonResponse(
          { success: false, message: "El archivo adjunto no puede superar 10 MB." },
          413
        );
      }
      const buffer = Buffer.from(await fileEntry.arrayBuffer());
      const detected = detectAttachmentType(buffer);
      if (!detected) {
        return jsonResponse(
          {
            success: false,
            message: "Formato de archivo no permitido. Solo se aceptan PDF, JPG o PNG válidos.",
          },
          400
        );
      }
      storedKey = await saveSupportAttachment(buffer, detected.ext);
    }

    const result = await postMessage(prisma, user, id, {
      mensaje: validatedText.data,
      esNotaInterna: wantsInternal,
      archivoKey: storedKey,
    });

    if (!result.ok) {
      if (storedKey) await deleteStoredFile(storedKey);
      return jsonResponse(
        { success: false, message: result.message },
        result.status
      );
    }

    return jsonResponse(
      {
        success: true,
        message: "Mensaje enviado correctamente.",
        item: result.data,
      },
      201
    );
  } catch (error) {
    if (storedKey) {
      await deleteStoredFile(storedKey);
    }
    console.error("[SupportMessages][POST] Error:", error);
    return jsonResponse(
      { success: false, message: "No fue posible enviar el mensaje." },
      500
    );
  }
}
