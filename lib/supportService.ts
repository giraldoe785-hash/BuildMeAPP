// Lógica de negocio de soporte (HU21–HU23).
//
// Recibe el cliente de base de datos como parámetro (sin importar el singleton
// de Prisma ni "@/...") para poder probar los permisos con una BD en memoria.
// Toda decisión de autorización se toma aquí, en el servidor, y los filtros de
// visibilidad (p. ej. notas internas) viajan DENTRO de la consulta a la BD.

import {
  DICTAMEN_MAX,
  DICTAMEN_MIN,
  TERMINAL_STATES,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATES,
  calculateSlaDeadline,
  canCreateTickets,
  canHandleInternalNotes,
  generateTicketNumber,
  getSlaStatus,
  isSupportAdmin,
  isUuid,
  validateDictamenText,
  validateMessageText,
  validateTicketInput,
  type TicketCategory,
  type TicketInput,
  type TicketPriority,
  type TicketState,
} from "./supportPolicy";

// El cliente real es PrismaClient; se tipa flojo para poder inyectar una BD falsa en pruebas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export interface Actor {
  id: string;
  rol: string;
  estado: string;
  nombreUsuario?: string;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

const fail = (status: number, message: string) =>
  ({ ok: false, status, message }) as const;
const ok = <T>(data: T) => ({ ok: true, data }) as const;

class ConflictSignal extends Error {}

const MESSAGES_LIMIT = 300;
const LIST_PAGE_SIZE = 25;

// --- Consultas reutilizables ------------------------------------------------

const USER_SELECT = {
  select: {
    id: true,
    nombreUsuario: true,
    rol: true,
    perfilCliente: { select: { nombres: true, apellidos: true } },
    perfilReparador: { select: { nombres: true, apellidos: true } },
  },
};

const TICKET_INCLUDE = {
  orden: { select: { id: true, numeroOrden: true } },
  usuarioEmisor: USER_SELECT,
  agenteAsignado: USER_SELECT,
};

/** Participa en el ticket: lo radicó o es cliente/reparador de la orden vinculada. Admin: todos. */
export function participantWhere(actor: Actor) {
  if (isSupportAdmin(actor.rol)) return {};
  return {
    OR: [
      { usuarioEmisorId: actor.id },
      { orden: { OR: [{ clienteId: actor.id }, { reparadorId: actor.id }] } },
    ],
  };
}

function blocked(actor: Actor): Result<never> | null {
  if (actor.estado === "SUSPENDIDO") {
    return fail(403, "Tu cuenta está suspendida. Contacta a soporte.");
  }
  return null;
}

// --- Pre-validaciones tempranas (M-01: evita escribir adjuntos si la operación no es viable) ---

export async function validateTicketEligibility(
  db: Db,
  actor: Actor,
  ordenId: string | null
): Promise<Result<null>> {
  const b = blocked(actor);
  if (b) return b;
  if (!canCreateTickets(actor.rol)) {
    return fail(403, "Tu perfil no puede radicar tickets de soporte.");
  }
  if (ordenId) {
    if (!isUuid(ordenId)) {
      return fail(400, "La orden de servicio indicada no es válida.");
    }
    const orden = await db.ordenServicio.findFirst({
      where: {
        id: ordenId,
        OR: [{ clienteId: actor.id }, { reparadorId: actor.id }],
      },
      select: { id: true },
    });
    if (!orden) {
      return fail(404, "No se encontró la orden indicada entre tus servicios.");
    }
  }
  return ok(null);
}

export async function validateMessageEligibility(
  db: Db,
  actor: Actor,
  ticketId: string,
  wantsInternal: boolean
): Promise<Result<null>> {
  const b = blocked(actor);
  if (b) return b;
  if (!isUuid(ticketId)) return fail(404, "Ticket no encontrado.");

  const ticket = await db.ticketSoporte.findFirst({
    where: { id: ticketId, ...participantWhere(actor) },
    select: { id: true, estado: true },
  });
  if (!ticket) return fail(404, "Ticket no encontrado.");
  if (ticket.estado === "CERRADO") return fail(409, "El ticket está cerrado.");

  if (wantsInternal && !canHandleInternalNotes(actor.rol)) {
    return fail(403, "No tienes permiso para crear notas internas.");
  }
  return ok(null);
}

// --- Serialización explícita (nunca se devuelve la fila cruda) --------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function displayName(user: any, viewerIsAdmin: boolean): string {
  if (!user) return "Usuario";
  if (user.rol === "ADMINISTRADOR" && !viewerIsAdmin) return "Soporte BuildMeAPP";
  const perfil = user.perfilReparador ?? user.perfilCliente;
  const full = perfil ? `${perfil.nombres} ${perfil.apellidos}`.trim() : "";
  return full || user.nombreUsuario;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeTicket(t: any, actor: Actor, now: Date = new Date()) {
  const admin = isSupportAdmin(actor.rol);
  const sla = getSlaStatus(
    { estado: t.estado, creadoEn: t.creadoEn, fechaLimiteSla: t.fechaLimiteSla },
    now
  );
  return {
    id: t.id as string,
    numeroTicket: t.numeroTicket as string,
    asunto: t.asunto as string,
    descripcion: t.descripcion as string,
    categoria: t.categoria as TicketCategory,
    prioridad: t.prioridad as TicketPriority,
    estado: t.estado as TicketState,
    resolucionDictamen: (t.resolucionDictamen ?? null) as string | null,
    fechaLimiteSla: t.fechaLimiteSla as Date,
    creadoEn: t.creadoEn as Date,
    actualizadoEn: t.actualizadoEn as Date,
    cerradoEn: (t.cerradoEn ?? null) as Date | null,
    orden: t.orden ? { id: t.orden.id as string, numeroOrden: t.orden.numeroOrden as string } : null,
    esPropio: t.usuarioEmisorId === actor.id,
    asignado: Boolean(t.agenteAsignadoId),
    sla,
    // Datos de personas: solo para administradores.
    emisor: admin && t.usuarioEmisor
      ? { id: t.usuarioEmisor.id as string, nombre: displayName(t.usuarioEmisor, true), rol: t.usuarioEmisor.rol as string }
      : undefined,
    agente: admin
      ? t.agenteAsignado
        ? { id: t.agenteAsignado.id as string, nombre: displayName(t.agenteAsignado, true) }
        : null
      : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeMessage(m: any, actor: Actor) {
  const admin = isSupportAdmin(actor.rol);
  return {
    id: m.id as string,
    ticketId: m.ticketId as string,
    mensaje: m.mensaje as string,
    creadoEn: m.creadoEn as Date,
    esNotaInterna: Boolean(m.esNotaInterna),
    // Se expone solo si hay adjunto; la descarga pasa por /api/support/attachments/<id>.
    tieneAdjunto: Boolean(m.archivoAdjuntoUrl),
    autor: {
      id: m.emisorId as string,
      nombre: displayName(m.emisor, admin),
      rol: (m.emisor?.rol ?? "CLIENTE") as string,
      esPropio: m.emisorId === actor.id,
    },
  };
}

// --- HU21: radicación -------------------------------------------------------

export async function createTicket(
  db: Db,
  actor: Actor,
  input: TicketInput,
  archivoKey: string | null,
  now: Date = new Date()
): Promise<Result<ReturnType<typeof serializeTicket>>> {
  const b = blocked(actor);
  if (b) return b;
  if (!canCreateTickets(actor.rol)) {
    return fail(403, "Tu perfil no puede radicar tickets de soporte.");
  }

  // La orden debe existir Y pertenecerle al usuario (se verifica en BD, no se confía en el navegador).
  if (input.ordenId) {
    const orden = await db.ordenServicio.findFirst({
      where: {
        id: input.ordenId,
        OR: [{ clienteId: actor.id }, { reparadorId: actor.id }],
      },
      select: { id: true },
    });
    if (!orden) {
      return fail(404, "No se encontró la orden indicada entre tus servicios.");
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const ticket = await db.$transaction(async (tx: Db) => {
        const created = await tx.ticketSoporte.create({
          data: {
            numeroTicket: generateTicketNumber(now),
            usuarioEmisorId: actor.id,
            ordenId: input.ordenId,
            categoria: input.categoria,
            prioridad: input.prioridad,
            estado: "ABIERTO",
            asunto: input.asunto,
            descripcion: input.descripcion,
            // SIEMPRE calculada aquí; el cliente no puede enviarla.
            creadoEn: now,
            fechaLimiteSla: calculateSlaDeadline(input.prioridad, now),
          },
          include: TICKET_INCLUDE,
        });

        if (archivoKey) {
          await tx.mensajeSoporte.create({
            data: {
              ticketId: created.id,
              emisorId: actor.id,
              mensaje: "Evidencia adjunta al radicar el ticket.",
              archivoAdjuntoUrl: archivoKey,
              esNotaInterna: false,
            },
          });
        }
        return created;
      });
      return ok(serializeTicket(ticket, actor, now));
    } catch (error) {
      // Conflicto de numeroTicket (índice único): se genera otro número.
      if ((error as { code?: string }).code === "P2002") continue;
      throw error;
    }
  }
  return fail(503, "No fue posible generar el número del ticket. Intenta de nuevo.");
}

// --- HU22: bandeja ----------------------------------------------------------

export interface ListFilters {
  estado?: string;
  prioridad?: string;
  categoria?: string;
  asignado?: string; // "me" | "none" | uuid
  q?: string;
  sla?: string; // "overdue" | "warning" | "on_time"
  page?: number;
}

export async function listTickets(
  db: Db,
  actor: Actor,
  filters: ListFilters,
  now: Date = new Date()
) {
  const admin = isSupportAdmin(actor.rol);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { ...participantWhere(actor) };

  if (TICKET_STATES.includes(filters.estado as TicketState)) where.estado = filters.estado;

  if (!admin) {
    const items = await db.ticketSoporte.findMany({
      where,
      include: TICKET_INCLUDE,
      orderBy: { creadoEn: "desc" },
      take: 50,
    });
    return {
      items: items.map((t: unknown) => serializeTicket(t, actor, now)),
      total: items.length,
      page: 1,
      pageSize: 50,
    };
  }

  if (TICKET_PRIORITIES.includes(filters.prioridad as TicketPriority)) where.prioridad = filters.prioridad;
  if (TICKET_CATEGORIES.includes(filters.categoria as TicketCategory)) where.categoria = filters.categoria;

  if (filters.asignado === "me") where.agenteAsignadoId = actor.id;
  else if (filters.asignado === "none") where.agenteAsignadoId = null;
  else if (isUuid(filters.asignado)) where.agenteAsignadoId = filters.asignado;

  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    where.AND = [
      {
        OR: [
          { numeroTicket: { contains: q, mode: "insensitive" } },
          { asunto: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }

  const page = Math.max(1, Math.floor(filters.page ?? 1) || 1);
  const slaFilter = ["overdue", "warning", "on_time"].includes(filters.sla ?? "")
    ? filters.sla
    : undefined;

  let items;
  let total;
  if (slaFilter) {
    // El SLA depende del plazo total de cada ticket: se filtra en memoria sobre un tope acotado.
    if (!where.estado) where.estado = { notIn: [...TERMINAL_STATES] };
    const candidates = await db.ticketSoporte.findMany({
      where,
      include: TICKET_INCLUDE,
      orderBy: { fechaLimiteSla: "asc" },
      take: 500,
    });
    const filtered = candidates.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) =>
        getSlaStatus(
          { estado: t.estado, creadoEn: t.creadoEn, fechaLimiteSla: t.fechaLimiteSla },
          now
        ).status === slaFilter
    );
    total = filtered.length;
    items = filtered.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);
  } else {
    [items, total] = await Promise.all([
      db.ticketSoporte.findMany({
        where,
        include: TICKET_INCLUDE,
        orderBy: { creadoEn: "desc" },
        skip: (page - 1) * LIST_PAGE_SIZE,
        take: LIST_PAGE_SIZE,
      }),
      db.ticketSoporte.count({ where }),
    ]);
  }

  // Indicadores de la bandeja (sobre tickets pendientes).
  const open = await db.ticketSoporte.findMany({
    where: { estado: { notIn: [...TERMINAL_STATES] } },
    select: {
      estado: true,
      creadoEn: true,
      fechaLimiteSla: true,
      agenteAsignadoId: true,
    },
    take: 2000,
  });
  const resumen = { pendientes: open.length, sinAsignar: 0, vencidos: 0, porVencer: 0 };
  for (const t of open) {
    if (!t.agenteAsignadoId) resumen.sinAsignar++;
    const s = getSlaStatus(t, now).status;
    if (s === "overdue") resumen.vencidos++;
    else if (s === "warning") resumen.porVencer++;
  }

  return {
    items: items.map((t: unknown) => serializeTicket(t, actor, now)),
    total,
    page,
    pageSize: LIST_PAGE_SIZE,
    resumen,
  };
}

export async function getTicketDetail(
  db: Db,
  actor: Actor,
  ticketId: string,
  now: Date = new Date()
): Promise<Result<ReturnType<typeof serializeTicket>>> {
  const b = blocked(actor);
  if (b) return b;
  if (!isUuid(ticketId)) return fail(404, "Ticket no encontrado.");

  const ticket = await db.ticketSoporte.findFirst({
    where: { id: ticketId, ...participantWhere(actor) },
    include: TICKET_INCLUDE,
  });
  // Misma respuesta para "no existe" y "no es tuyo": no se revela la existencia.
  if (!ticket) return fail(404, "Ticket no encontrado.");
  return ok(serializeTicket(ticket, actor, now));
}

export async function listAgents(db: Db, actor: Actor): Promise<Result<{ id: string; nombre: string }[]>> {
  const b = blocked(actor);
  if (b) return b;
  if (!isSupportAdmin(actor.rol)) return fail(403, "No tienes permiso para esta acción.");

  const agents = await db.usuario.findMany({
    where: { rol: "ADMINISTRADOR", estado: { not: "SUSPENDIDO" } },
    select: { id: true, nombreUsuario: true, rol: true, perfilCliente: false },
    orderBy: { nombreUsuario: "asc" },
    take: 100,
  });
  return ok(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agents.map((a: any) => ({ id: a.id as string, nombre: a.nombreUsuario as string }))
  );
}

function parseExpected(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function assignTicket(
  db: Db,
  actor: Actor,
  ticketId: string,
  agenteId: unknown,
  actualizadoEn: unknown,
  now: Date = new Date()
): Promise<Result<ReturnType<typeof serializeTicket>>> {
  const b = blocked(actor);
  if (b) return b;
  if (!isSupportAdmin(actor.rol)) return fail(403, "No tienes permiso para asignar tickets.");
  if (!isUuid(ticketId)) return fail(404, "Ticket no encontrado.");

  const expected = parseExpected(actualizadoEn);
  if (!expected) return fail(400, "Falta la versión del ticket (actualizadoEn).");
  if (agenteId !== null && !isUuid(agenteId)) return fail(400, "Responsable inválido.");

  const ticket = await db.ticketSoporte.findFirst({
    where: { id: ticketId },
    select: { id: true, estado: true, agenteAsignadoId: true, numeroTicket: true },
  });
  if (!ticket) return fail(404, "Ticket no encontrado.");
  if (ticket.estado === "CERRADO") return fail(409, "El ticket está cerrado y no admite cambios.");
  if ((ticket.agenteAsignadoId ?? null) === agenteId) {
    return fail(409, "El ticket ya tiene ese responsable.");
  }

  // El responsable debe existir, ser ADMINISTRADOR y no estar suspendido.
  let agent: { id: string; nombreUsuario: string } | null = null;
  if (agenteId !== null) {
    agent = await db.usuario.findFirst({
      where: { id: agenteId, rol: "ADMINISTRADOR", estado: { not: "SUSPENDIDO" } },
      select: { id: true, nombreUsuario: true },
    });
    if (!agent) return fail(422, "El responsable indicado no puede asumir tickets.");
  }

  try {
    await db.$transaction(async (tx: Db) => {
      // Concurrencia optimista: si otro administrador modificó el ticket, no se sobrescribe.
      // fechaLimiteSla NO se toca: reasignar no reinicia el SLA.
      const res = await tx.ticketSoporte.updateMany({
        where: { id: ticketId, actualizadoEn: expected },
        data: { agenteAsignadoId: agenteId },
      });
      if (res.count === 0) throw new ConflictSignal();

      await tx.mensajeSoporte.create({
        data: {
          ticketId,
          emisorId: actor.id,
          mensaje: agent
            ? `[AUDITORÍA] ${actor.nombreUsuario ?? "Un administrador"} asignó el ticket a ${agent.nombreUsuario}.`
            : `[AUDITORÍA] ${actor.nombreUsuario ?? "Un administrador"} quitó el responsable del ticket.`,
          esNotaInterna: true,
        },
      });
    });
  } catch (error) {
    if (error instanceof ConflictSignal) {
      return fail(409, "El ticket fue modificado por otra persona. Recarga e intenta de nuevo.");
    }
    throw error;
  }

  return getTicketDetail(db, actor, ticketId, now);
}

export async function changeTicketStatus(
  db: Db,
  actor: Actor,
  ticketId: string,
  estado: unknown,
  dictamen: unknown,
  actualizadoEn: unknown,
  now: Date = new Date()
): Promise<Result<ReturnType<typeof serializeTicket>>> {
  const b = blocked(actor);
  if (b) return b;
  if (!isSupportAdmin(actor.rol)) return fail(403, "No tienes permiso para cambiar el estado.");
  if (!isUuid(ticketId)) return fail(404, "Ticket no encontrado.");
  if (!TICKET_STATES.includes(estado as TicketState)) return fail(400, "Estado inválido.");

  const expected = parseExpected(actualizadoEn);
  if (!expected) return fail(400, "Falta la versión del ticket (actualizadoEn).");

  const target = estado as TicketState;
  const ticket = await db.ticketSoporte.findFirst({
    where: { id: ticketId },
    select: { id: true, estado: true },
  });
  if (!ticket) return fail(404, "Ticket no encontrado.");
  if (ticket.estado === "CERRADO") return fail(409, "El ticket está cerrado y no admite cambios.");
  if (ticket.estado === target) return fail(409, "El ticket ya está en ese estado.");

  const isTerminal = TERMINAL_STATES.includes(target);
  const dictamenValidation = validateDictamenText(dictamen, isTerminal);
  if (!dictamenValidation.ok) {
    return fail(400, dictamenValidation.message);
  }
  const dictamenText = dictamenValidation.data;

  try {
    await db.$transaction(async (tx: Db) => {
      // M-03: al pasar a un estado no terminal permitido se limpia el dictamen y cerradoEn a null;
      // si pasa a CERRADO se registra cerradoEn; si pasa a RESUELTO cerradoEn se mantiene null.
      const res = await tx.ticketSoporte.updateMany({
        where: { id: ticketId, actualizadoEn: expected },
        data: {
          estado: target,
          resolucionDictamen: isTerminal ? dictamenText : null,
          cerradoEn: target === "CERRADO" ? now : null,
        },
      });
      if (res.count === 0) throw new ConflictSignal();

      await tx.mensajeSoporte.create({
        data: {
          ticketId,
          emisorId: actor.id,
          mensaje: `[AUDITORÍA] ${actor.nombreUsuario ?? "Un administrador"} cambió el estado de ${ticket.estado} a ${target}.`,
          esNotaInterna: true,
        },
      });
    });
  } catch (error) {
    if (error instanceof ConflictSignal) {
      return fail(409, "El ticket fue modificado por otra persona. Recarga e intenta de nuevo.");
    }
    throw error;
  }

  return getTicketDetail(db, actor, ticketId, now);
}

// --- HU23: mensajes ---------------------------------------------------------

export async function listMessages(
  db: Db,
  actor: Actor,
  ticketId: string,
  since?: Date | null
): Promise<Result<ReturnType<typeof serializeMessage>[]>> {
  const b = blocked(actor);
  if (b) return b;
  if (!isUuid(ticketId)) return fail(404, "Ticket no encontrado.");

  const ticket = await db.ticketSoporte.findFirst({
    where: { id: ticketId, ...participantWhere(actor) },
    select: { id: true },
  });
  if (!ticket) return fail(404, "Ticket no encontrado.");

  // El filtro de notas internas va EN la consulta: una nota interna nunca sale de la BD
  // hacia un usuario sin permiso.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { ticketId };
  if (!canHandleInternalNotes(actor.rol)) where.esNotaInterna = false;
  if (since) where.creadoEn = { gte: since };

  const messages = await db.mensajeSoporte.findMany({
    where,
    include: { emisor: USER_SELECT },
    orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
    take: MESSAGES_LIMIT,
  });
  return ok(messages.map((m: unknown) => serializeMessage(m, actor)));
}

export async function postMessage(
  db: Db,
  actor: Actor,
  ticketId: string,
  input: { mensaje: unknown; esNotaInterna?: unknown; archivoKey: string | null }
): Promise<Result<ReturnType<typeof serializeMessage>>> {
  const b = blocked(actor);
  if (b) return b;
  if (!isUuid(ticketId)) return fail(404, "Ticket no encontrado.");

  const ticket = await db.ticketSoporte.findFirst({
    where: { id: ticketId, ...participantWhere(actor) },
    select: { id: true, estado: true },
  });
  if (!ticket) return fail(404, "Ticket no encontrado.");
  if (ticket.estado === "CERRADO") return fail(409, "El ticket está cerrado.");

  // Política: quien no es administrador y pide una nota interna es rechazado (no se ignora en silencio).
  const wantsInternal = input.esNotaInterna === true || input.esNotaInterna === "true";
  if (wantsInternal && !canHandleInternalNotes(actor.rol)) {
    return fail(403, "No tienes permiso para crear notas internas.");
  }

  const text = validateMessageText(input.mensaje, Boolean(input.archivoKey));
  if (!text.ok) return fail(400, text.message);

  const created = await db.mensajeSoporte.create({
    data: {
      ticketId,
      emisorId: actor.id,
      mensaje: text.data,
      archivoAdjuntoUrl: input.archivoKey,
      // Decidido por el servidor según el rol real, nunca por el cuerpo de la petición.
      esNotaInterna: canHandleInternalNotes(actor.rol) && wantsInternal,
    },
    include: { emisor: USER_SELECT },
  });
  return ok(serializeMessage(created, actor));
}

/** Devuelve la clave del adjunto SOLO si el actor puede ver ese mensaje (autorización en la consulta). */
export async function getAttachmentKey(
  db: Db,
  actor: Actor,
  messageId: string
): Promise<Result<string>> {
  const b = blocked(actor);
  if (b) return b;
  if (!isUuid(messageId)) return fail(404, "Archivo no encontrado.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { id: messageId, archivoAdjuntoUrl: { not: null } };
  if (!canHandleInternalNotes(actor.rol)) {
    where.esNotaInterna = false;
    where.ticket = participantWhere(actor);
  }

  const message = await db.mensajeSoporte.findFirst({
    where,
    select: { archivoAdjuntoUrl: true },
  });
  if (!message?.archivoAdjuntoUrl) return fail(404, "Archivo no encontrado.");
  return ok(message.archivoAdjuntoUrl as string);
}

export { validateTicketInput };
