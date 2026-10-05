import { deleteCurrentSession, getCurrentUser } from "@/lib/auth";

// Datos del usuario: nunca deben quedar guardados en cachés del navegador o de proxies.
const NO_CACHE = { "Cache-Control": "no-store" };

// ¿Quién soy? El frontend lo llama al cargar la página para saber si hay
// sesión válida y a qué vista enviar al usuario (según "rol").
export async function GET() {
  try {
    const usuario = await getCurrentUser();

    if (!usuario) {
      return Response.json(
        { success: false, message: "No hay una sesión activa." },
        { status: 401, headers: NO_CACHE }
      );
    }

    // Si suspendieron la cuenta mientras tenía sesión abierta, se cierra
    // la sesión ahora (el login ya bloquea a los suspendidos, pero una
    // sesión creada ANTES de la suspensión seguiría viva sin esta revisión).
    if (usuario.estado === "SUSPENDIDO") {
      await deleteCurrentSession();

      return Response.json(
        { success: false, message: "Tu cuenta está suspendida. Contacta a soporte." },
        { status: 403, headers: NO_CACHE }
      );
    }

    // getCurrentUser ya quita passwordHash; aquí se quitan además los
    // campos internos de seguridad.
    const {
      codigoVerificacion: _codigo,
      intentosFallidosLogin: _intentos,
      bloqueadoHasta: _bloqueo,
      ...usuarioSeguro
    } = usuario;

    return Response.json(
      { success: true, user: usuarioSeguro },
      { headers: NO_CACHE }
    );
  } catch (error) {
    console.error("Error al obtener la sesión:", error);

    return Response.json(
      { success: false, message: "No fue posible verificar la sesión." },
      { status: 500, headers: NO_CACHE }
    );
  }
}