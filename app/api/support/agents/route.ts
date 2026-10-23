import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listAgents } from "@/lib/supportService";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json(
        { success: false, message: "Debes iniciar sesión." },
        { status: 401, headers: NO_STORE }
      );
    }

    const result = await listAgents(prisma, user);
    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message },
        { status: result.status, headers: NO_STORE }
      );
    }

    return Response.json(
      { success: true, agents: result.data },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[SupportAgents][GET] Error:", error);
    return Response.json(
      { success: false, message: "No fue posible consultar el listado de agentes." },
      { status: 500, headers: NO_STORE }
    );
  }
}
