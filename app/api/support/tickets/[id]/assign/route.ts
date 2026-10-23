import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assignTicket } from "@/lib/supportService";

const NO_STORE = { "Cache-Control": "no-store" };

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json(
        { success: false, message: "Debes iniciar sesión." },
        { status: 401, headers: NO_STORE }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, message: "El cuerpo de la solicitud no es un JSON válido." },
        { status: 400, headers: NO_STORE }
      );
    }

    if (typeof body !== "object" || body === null) {
      return Response.json(
        { success: false, message: "Solicitud inválida." },
        { status: 400, headers: NO_STORE }
      );
    }

    const data = body as Record<string, unknown>;
    const { id } = await context.params;
    const result = await assignTicket(
      prisma,
      user,
      id,
      data.agenteId ?? null,
      data.actualizadoEn
    );

    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message },
        { status: result.status, headers: NO_STORE }
      );
    }

    return Response.json(
      {
        success: true,
        message: "Asignación del ticket actualizada correctamente.",
        ticket: result.data,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[SupportTicketAssign][PATCH] Error:", error);
    return Response.json(
      { success: false, message: "No fue posible actualizar la asignación del ticket." },
      { status: 500, headers: NO_STORE }
    );
  }
}
