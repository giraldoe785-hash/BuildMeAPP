import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTicketDetail } from "@/lib/supportService";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
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

    const { id } = await context.params;
    const result = await getTicketDetail(prisma, user, id);
    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message },
        { status: result.status, headers: NO_STORE }
      );
    }

    return Response.json(
      { success: true, ticket: result.data },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[SupportTicketDetail][GET] Error:", error);
    return Response.json(
      { success: false, message: "No fue posible obtener el detalle del ticket." },
      { status: 500, headers: NO_STORE }
    );
  }
}
