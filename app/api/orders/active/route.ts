import { getCurrentUser } from "@/lib/auth";
import { getActiveOrderForClient, OrderPolicyError } from "@/lib/orderService";
import { prisma } from "@/lib/prisma";

const NO_STORE = { "Cache-Control": "no-store" };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión para consultar el estado de tu orden activa.",
        },
        401
      );
    }

    const result = await getActiveOrderForClient(prisma, user);

    return jsonResponse({
      success: true,
      order: result.order,
    });
  } catch (error) {
    if (error instanceof OrderPolicyError) {
      return jsonResponse(
        {
          success: false,
          code: error.code ?? "ORDER_POLICY_ERROR",
          message: error.message,
        },
        error.status
      );
    }

    console.error("[OrdersActiveAPI][GET] Error al consultar orden activa:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible consultar el estado actual de tu orden.",
      },
      500
    );
  }
}
