import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonResponse(
        {
          success: false,
          code: "UNAUTHENTICATED",
          message: "Debes iniciar sesión como personal autorizado.",
        },
        401
      );
    }

    if (user.rol !== "ADMINISTRADOR") {
      return jsonResponse(
        {
          success: false,
          code: "FORBIDDEN",
          message: "No tienes permisos para auditar expedientes técnicos de reparadores.",
        },
        403
      );
    }

    const url = new URL(request.url);
    const searchQuery = (url.searchParams.get("search") || "").trim();
    const estadoFilter = (url.searchParams.get("estado") || "ALL").toUpperCase();
    const categoriaId = url.searchParams.get("categoriaId")?.trim() || "";
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20));
    const skip = (page - 1) * limit;

    // Filtros de Prisma sobre Usuario con rol REPARADOR
    const where: Record<string, unknown> = {
      rol: "REPARADOR",
    };

    if (estadoFilter !== "ALL") {
      where.estado = estadoFilter;
    }

    if (searchQuery) {
      where.OR = [
        { email: { contains: searchQuery, mode: "insensitive" } },
        { nombreUsuario: { contains: searchQuery, mode: "insensitive" } },
        {
          perfilReparador: {
            OR: [
              { nombres: { contains: searchQuery, mode: "insensitive" } },
              { apellidos: { contains: searchQuery, mode: "insensitive" } },
              { numeroDocumento: { contains: searchQuery, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    if (categoriaId) {
      where.perfilReparador = {
        ...(where.perfilReparador as object || {}),
        especialidades: {
          some: {
            categoriaId,
          },
        },
      };
    }

    // Ejecutar consulta paginada e inclusiva
    const [reparadoresRaw, total] = await Promise.all([
      prisma.usuario.findMany({
        where,
        orderBy: { creadoEn: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          nombreUsuario: true,
          telefono: true,
          estado: true,
          creadoEn: true,
          actualizadoEn: true,
          perfilReparador: {
            select: {
              id: true,
              tipoDocumento: true,
              numeroDocumento: true,
              nombres: true,
              apellidos: true,
              ciudadCobertura: true,
              calificacionPromedio: true,
              totalTrabajosCompletados: true,
              especialidades: {
                select: {
                  categoria: {
                    select: {
                      id: true,
                      nombre: true,
                      slug: true,
                    },
                  },
                },
              },
              documentos: {
                select: {
                  id: true,
                  tipoDocumento: true,
                  nombreOriginal: true,
                  mimeType: true,
                  tamanoBytes: true,
                  estado: true,
                  fechaExpiracion: true,
                  observacionesAdmin: true,
                  creadoEn: true,
                  // IMPORTANTE SEGURIDAD: NO exponemos archivoUrl cruda en la consulta general
                },
              },
            },
          },
        },
      }),
      prisma.usuario.count({ where }),
    ]);

    // Métricas reales con semántica verificada contra el esquema Prisma:
    // 1. Expedientes por validar: cuentas de reparador en revisión o pendientes de validación
    // 2. Perfiles verificados: conteo acumulado real de reparadores en estado VERIFICADO (el esquema no almacena fechaAprobacion inmutable)
    // 3. Rechazados / Suspendidos: perfiles inhabilitados según los estados del enum EstadoCuenta
    const [porValidarCount, verificadosTotalCount, rechazadosCount] = await Promise.all([
      prisma.usuario.count({
        where: {
          rol: "REPARADOR",
          estado: { in: ["EN_REVISION", "PENDIENTE_VERIFICACION"] },
        },
      }),
      prisma.usuario.count({
        where: {
          rol: "REPARADOR",
          estado: "VERIFICADO",
        },
      }),
      prisma.usuario.count({
        where: {
          rol: "REPARADOR",
          estado: { in: ["RECHAZADO", "SUSPENDIDO"] },
        },
      }),
    ]);

    // Mapeo seguro y consistente de la respuesta
    const reparadores = reparadoresRaw.map((u) => {
      const perfil = u.perfilReparador;
      const especialidades =
        perfil?.especialidades.map((e) => ({
          id: e.categoria.id,
          nombre: e.categoria.nombre,
          slug: e.categoria.slug,
        })) ?? [];

      const documentos =
        perfil?.documentos.map((d) => ({
          id: d.id,
          tipoDocumento: d.tipoDocumento,
          nombreOriginal: d.nombreOriginal ?? "Documento",
          mimeType: d.mimeType ?? "application/octet-stream",
          tamanoBytes: d.tamanoBytes ?? null,
          estado: d.estado,
          fechaExpiracion: d.fechaExpiracion?.toISOString() ?? null,
          observacionesAdmin: d.observacionesAdmin ?? null,
          creadoEn: d.creadoEn.toISOString(),
        })) ?? [];

      return {
        id: u.id,
        perfilId: perfil?.id ?? null,
        nombreCompleto: perfil ? `${perfil.nombres} ${perfil.apellidos}`.trim() : u.nombreUsuario,
        numeroDocumento: perfil?.numeroDocumento ?? "—",
        tipoDocumento: perfil?.tipoDocumento ?? "CC",
        email: u.email ?? "—",
        telefono: u.telefono ?? "—",
        ciudadCobertura: perfil?.ciudadCobertura ?? "—",
        estado: u.estado,
        creadoEn: u.creadoEn.toISOString(),
        especialidades,
        documentos,
        totalDocumentos: documentos.length,
        documentosPendientes: documentos.filter((d) => d.estado === "PENDIENTE").length,
      };
    });

    return jsonResponse({
      success: true,
      kpis: {
        expedientesPorValidar: porValidarCount,
        verificadosTotal: verificadosTotalCount,
        aprobadosMes: verificadosTotalCount, // Compatibilidad retroactiva
        rechazados: rechazadosCount,
      },
      reparadores,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error("[AdminRepairersAPI][GET] Error:", error);
    return jsonResponse(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "No fue posible consultar la lista de expedientes de reparadores.",
      },
      500
    );
  }
}
