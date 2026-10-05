import { deleteCurrentSession } from "@/lib/auth";

// Cerrar sesión: borra la sesión de la base de datos y limpia la cookie.
// Es POST (no GET) para que otro sitio no pueda cerrar la sesión del usuario
// con algo tan simple como una imagen o un enlace.
// Es idempotente: si no había sesión, también responde 200.
export async function POST() {
  try {
    await deleteCurrentSession();

    return Response.json({
      success: true,
      message: "Sesión cerrada correctamente.",
    });
  } catch (error) {
    console.error("Error al cerrar sesión:", error);

    return Response.json(
      { success: false, message: "No fue posible cerrar la sesión." },
      { status: 500 }
    );
  }
}