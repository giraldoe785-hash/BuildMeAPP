import { getCurrentUser } from "@/lib/auth";
import { listAssignedOrdersForRepairer, OrderPolicyError } from "@/lib/orderService";
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
          message: "Debes iniciar sesión como reparador para consultar tus órdenes asignadas.",
        },
        401
      );
    }

    const result = await listAssignedOrdersForRepairer(prisma, user);

    return jsonResponse({
      success: true,
      orders: result.orders,
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

    console.error("[OrdersAssignedAPI][GET] Error al consultar órdenes asignadas:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible consultar tus órdenes asignadas.",
      },
      500
    );
  }
}
