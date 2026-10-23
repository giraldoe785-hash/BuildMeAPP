import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    if (user.estado === "SUSPENDIDO") {
      return Response.json(
        { success: false, message: "Tu cuenta está suspendida." },
        { status: 403, headers: NO_STORE }
      );
    }

    const orders = await prisma.ordenServicio.findMany({
      where: {
        OR: [{ clienteId: user.id }, { reparadorId: user.id }],
      },
      select: {
        id: true,
        numeroOrden: true,
        estado: true,
        direccionServicio: true,
        fechaCreacion: true,
      },
      orderBy: { fechaCreacion: "desc" },
      take: 30,
    });

    return Response.json(
      { success: true, items: orders },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[SupportOrders][GET] Error al consultar órdenes:", error);
    return Response.json(
      { success: false, message: "No fue posible consultar tus órdenes." },
      { status: 500, headers: NO_STORE }
    );
  }
}
