import { getCurrentUser } from "@/lib/auth";
import { listAvailableOrders, OrderPolicyError } from "@/lib/orderService";
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
          message: "Debes iniciar sesión como reparador para consultar solicitudes disponibles.",
        },
        401
      );
    }

    const result = await listAvailableOrders(prisma, user);

    return jsonResponse({
      success: true,
      orders: result.orders,
      specialtySlugs: result.specialtySlugs,
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

    console.error("[OrdersAvailableAPI][GET] Error al consultar órdenes disponibles:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible consultar las solicitudes disponibles.",
      },
      500
    );
  }
}
