import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import { readBoundedBody } from "@/lib/requestBody";
import { deleteStoredFile, saveSupportAttachment } from "@/lib/storage";
import {
  MAX_ATTACHMENT_BYTES,
  detectAttachmentType,
  validateTicketInput,
} from "@/lib/supportPolicy";
import {
  createTicket,
  listTickets,
  validateTicketEligibility,
} from "@/lib/supportService";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_MULTIPART_BYTES = MAX_ATTACHMENT_BYTES + 1024 * 1024;

// Máximo 10 radicaciones por cuenta y hora.
const ticketCreateLimiter = createRateLimiter({
  max: 10,
  windowMs: 60 * 60 * 1000,
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        { success: false, message: "Debes iniciar sesión para consultar tickets." },
        401
      );
    }
    if (user.estado === "SUSPENDIDO") {
      return jsonResponse(
        { success: false, message: "Tu cuenta está suspendida. Contacta a soporte." },
        403
      );
    }

    const { searchParams } = new URL(request.url);
    const data = await listTickets(prisma, user, {
      estado: searchParams.get("estado") ?? undefined,
      prioridad: searchParams.get("prioridad") ?? undefined,
      categoria: searchParams.get("categoria") ?? undefined,
      asignado: searchParams.get("asignado") ?? undefined,
      q: searchParams.get("q") ?? undefined,
      sla: searchParams.get("sla") ?? undefined,
      page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    });

    return jsonResponse({ success: true, ...data });
  } catch (error) {
    console.error("[SupportTickets][GET] Error al listar tickets:", error);
    return jsonResponse(
      { success: false, message: "No fue posible consultar los tickets de soporte." },
      500
    );
  }
}

export async function POST(request: Request) {
  let storedKey: string | null = null;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        { success: false, message: "Debes iniciar sesión para radicar un ticket." },
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
    if (!ticketCreateLimiter.consume(user.id)) {
      return jsonResponse(
        {
          success: false,
          message:
            "Has alcanzado el límite de tickets por hora. Intenta nuevamente más tarde.",
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
    let rawFields: {
      asunto?: unknown;
      descripcion?: unknown;
      categoria?: unknown;
      prioridad?: unknown;
      ordenId?: unknown;
    } = {};
    let fileEntry: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      let formData: FormData;
      try {
        formData = await safeRequest.formData();
      } catch {
        return jsonResponse(
          { success: false, message: "Formulario de ticket inválido." },
          400
        );
      }

      const getText = (key: string) => {
        const val = formData.get(key);
        return typeof val === "string" ? val : undefined;
      };

      rawFields = {
        asunto: getText("asunto"),
        descripcion: getText("descripcion"),
        categoria: getText("categoria"),
        prioridad: getText("prioridad") ?? "MEDIA",
        ordenId: getText("ordenId"),
      };

      const attachment = formData.get("attachment");
      if (attachment instanceof File && attachment.size > 0) {
        fileEntry = attachment;
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
      rawFields = {
        asunto: data.asunto,
        descripcion: data.descripcion,
        categoria: data.categoria,
        prioridad: data.prioridad ?? "MEDIA",
        ordenId: data.ordenId,
      };
    }

    const validated = validateTicketInput(rawFields);
    if (!validated.ok) {
      return jsonResponse({ success: false, message: validated.message }, 400);
    }

    // Validación previa de elegibilidad: rol y pertenencia de la orden antes de guardar archivos en disco.
    const eligibility = await validateTicketEligibility(
      prisma,
      user,
      validated.data.ordenId
    );
    if (!eligibility.ok) {
      return jsonResponse(
        { success: false, message: eligibility.message },
        eligibility.status
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

    const result = await createTicket(prisma, user, validated.data, storedKey);
    if (!result.ok) {
      if (storedKey) await deleteStoredFile(storedKey);
      return jsonResponse({ success: false, message: result.message }, result.status);
    }

    return jsonResponse(
      {
        success: true,
        message: "Ticket de soporte radicado correctamente.",
        ticket: result.data,
      },
      201
    );
  } catch (error) {
    if (storedKey) {
      await deleteStoredFile(storedKey);
    }
    console.error("[SupportTickets][POST] Error al crear ticket:", error);
    return jsonResponse(
      { success: false, message: "No fue posible radicar el ticket de soporte." },
      500
    );
  }
}
