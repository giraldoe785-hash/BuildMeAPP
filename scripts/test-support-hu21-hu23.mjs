// Suite de pruebas para HU21, HU22 y HU23 (Soporte y Mediación).
//
// Ejecutar con:
//   node --test scripts/test-support-hu21-hu23.mjs
//
// No modifica la base de datos ni envía correos. Simula el motor de Prisma en
// memoria verificando que los filtros de seguridad (como esNotaInterna: false)
// se apliquen dentro del objeto `where` de la consulta a la base de datos.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./supportPolicy") {
      return nextResolve("./supportPolicy.ts", context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  DICTAMEN_MAX,
  DICTAMEN_MIN,
  SLA_HOURS,
  SLA_WARNING_FRACTION,
  TERMINAL_STATES,
  TICKET_NUMBER_REGEX,
  calculateSlaDeadline,
  detectAttachmentType,
  generateTicketNumber,
  getSlaStatus,
  validateDictamenText,
  validateMessageText,
  validateTicketInput,
} = await import("../lib/supportPolicy.ts");

const {
  assignTicket,
  changeTicketStatus,
  createTicket,
  getAttachmentKey,
  getTicketDetail,
  listAgents,
  listMessages,
  listTickets,
  postMessage,
  validateMessageEligibility,
  validateTicketEligibility,
} = await import("../lib/supportService.ts");

const { createRateLimiter } = await import("../lib/rateLimit.ts");
const { readBoundedBody } = await import("../lib/requestBody.ts");

// ---------------------------------------------------------------------------
// Base de datos en memoria que emula el contrato de Prisma usado por supportService
// ---------------------------------------------------------------------------
function createInMemoryDb(seed = {}) {
  const users = new Map();
  const orders = new Map();
  const tickets = new Map();
  const messages = new Map();
  const queryLog = [];

  for (const u of seed.users ?? []) users.set(u.id, { ...u });
  for (const o of seed.orders ?? []) orders.set(o.id, { ...o });
  for (const t of seed.tickets ?? []) tickets.set(t.id, { ...t });
  for (const m of seed.messages ?? []) messages.set(m.id, { ...m });

  let failNextTicketCreateWithP2002 = seed.simulateCollisionCount ?? 0;

  function hydrateUser(userId) {
    if (!userId) return null;
    const u = users.get(userId);
    return u ? { ...u } : null;
  }

  function hydrateTicket(t) {
    if (!t) return null;
    return {
      ...t,
      orden: t.ordenId ? orders.get(t.ordenId) ?? null : null,
      usuarioEmisor: hydrateUser(t.usuarioEmisorId),
      agenteAsignado: hydrateUser(t.agenteAsignadoId),
    };
  }

  function hydrateMessage(m) {
    if (!m) return null;
    return {
      ...m,
      emisor: hydrateUser(m.emisorId),
    };
  }

  function matchesParticipantOr(ticket, orClauses) {
    if (!Array.isArray(orClauses)) return true;
    return orClauses.some((clause) => {
      if (clause.usuarioEmisorId && ticket.usuarioEmisorId === clause.usuarioEmisorId) {
        return true;
      }
      if (clause.orden && ticket.ordenId) {
        const ord = orders.get(ticket.ordenId);
        if (!ord) return false;
        const ordOr = clause.orden.OR ?? [];
        return ordOr.some(
          (c) =>
            (c.clienteId && ord.clienteId === c.clienteId) ||
            (c.reparadorId && ord.reparadorId === c.reparadorId)
        );
      }
      return false;
    });
  }

  function matchesTicketWhere(t, where = {}) {
    if (!where) return true;
    if (where.id && t.id !== where.id) return false;
    if (where.OR && !matchesParticipantOr(t, where.OR)) return false;
    if (typeof where.estado === "string" && t.estado !== where.estado) return false;
    if (where.estado?.notIn && where.estado.notIn.includes(t.estado)) return false;
    if (where.prioridad && t.prioridad !== where.prioridad) return false;
    if (where.categoria && t.categoria !== where.categoria) return false;
    if ("agenteAsignadoId" in where && t.agenteAsignadoId !== where.agenteAsignadoId) {
      return false;
    }
    if (
      where.actualizadoEn &&
      t.actualizadoEn.getTime() !== where.actualizadoEn.getTime()
    ) {
      return false;
    }
    if (Array.isArray(where.AND)) {
      for (const cond of where.AND) {
        if (cond.OR) {
          const ok = cond.OR.some((sub) => {
            if (sub.numeroTicket?.contains) {
              return t.numeroTicket
                .toLowerCase()
                .includes(sub.numeroTicket.contains.toLowerCase());
            }
            if (sub.asunto?.contains) {
              return t.asunto
                .toLowerCase()
                .includes(sub.asunto.contains.toLowerCase());
            }
            return false;
          });
          if (!ok) return false;
        }
      }
    }
    return true;
  }

  const db = {
    queryLog,
    users,
    orders,
    tickets,
    messages,

    usuario: {
      async findFirst({ where }) {
        for (const u of users.values()) {
          if (where.id && u.id !== where.id) continue;
          if (where.rol && u.rol !== where.rol) continue;
          if (where.estado?.not && u.estado === where.estado.not) continue;
          return { ...u };
        }
        return null;
      },
      async findMany({ where }) {
        const res = [];
        for (const u of users.values()) {
          if (where?.rol && u.rol !== where.rol) continue;
          if (where?.estado?.not && u.estado === where.estado.not) continue;
          res.push({ ...u });
        }
        return res;
      },
    },

    ordenServicio: {
      async findFirst({ where }) {
        for (const o of orders.values()) {
          if (where.id && o.id !== where.id) continue;
          if (where.OR) {
            const ok = where.OR.some(
              (c) =>
                (c.clienteId && o.clienteId === c.clienteId) ||
                (c.reparadorId && o.reparadorId === c.reparadorId)
            );
            if (!ok) continue;
          }
          return { ...o };
        }
        return null;
      },
    },

    ticketSoporte: {
      async create({ data }) {
        if (failNextTicketCreateWithP2002 > 0) {
          failNextTicketCreateWithP2002--;
          const err = new Error("Unique constraint failed on numeroTicket");
          err.code = "P2002";
          throw err;
        }
        for (const existing of tickets.values()) {
          if (existing.numeroTicket === data.numeroTicket) {
            const err = new Error("Unique constraint failed on numeroTicket");
            err.code = "P2002";
            throw err;
          }
        }
        const now = new Date();
        const record = {
          id: randomUUID(),
          numeroTicket: data.numeroTicket,
          usuarioEmisorId: data.usuarioEmisorId,
          agenteAsignadoId: data.agenteAsignadoId ?? null,
          ordenId: data.ordenId ?? null,
          categoria: data.categoria,
          prioridad: data.prioridad ?? "MEDIA",
          estado: data.estado ?? "ABIERTO",
          asunto: data.asunto,
          descripcion: data.descripcion,
          resolucionDictamen: data.resolucionDictamen ?? null,
          fechaLimiteSla: data.fechaLimiteSla,
          creadoEn: data.creadoEn ?? now,
          actualizadoEn: data.actualizadoEn ?? now,
          cerradoEn: data.cerradoEn ?? null,
        };
        tickets.set(record.id, record);
        return hydrateTicket(record);
      },

      async findFirst({ where }) {
        queryLog.push({ model: "ticketSoporte", op: "findFirst", where });
        for (const t of tickets.values()) {
          if (matchesTicketWhere(t, where)) return hydrateTicket(t);
        }
        return null;
      },

      async findMany({ where, skip = 0, take = 50 }) {
        queryLog.push({ model: "ticketSoporte", op: "findMany", where });
        const all = [...tickets.values()].filter((t) => matchesTicketWhere(t, where));
        all.sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime());
        return all.slice(skip, skip + take).map(hydrateTicket);
      },

      async count({ where }) {
        return [...tickets.values()].filter((t) => matchesTicketWhere(t, where)).length;
      },

      async updateMany({ where, data }) {
        let count = 0;
        for (const [id, t] of tickets.entries()) {
          if (matchesTicketWhere(t, where)) {
            const updated = {
              ...t,
              ...data,
              actualizadoEn: new Date(t.actualizadoEn.getTime() + 1000),
            };
            tickets.set(id, updated);
            count++;
          }
        }
        return { count };
      },
    },

    mensajeSoporte: {
      async create({ data }) {
        const record = {
          id: randomUUID(),
          ticketId: data.ticketId,
          emisorId: data.emisorId,
          mensaje: data.mensaje,
          archivoAdjuntoUrl: data.archivoAdjuntoUrl ?? null,
          esNotaInterna: Boolean(data.esNotaInterna),
          leido: Boolean(data.leido),
          creadoEn: data.creadoEn ?? new Date(),
        };
        messages.set(record.id, record);
        return hydrateMessage(record);
      },

      async findMany({ where }) {
        queryLog.push({ model: "mensajeSoporte", op: "findMany", where });
        const list = [...messages.values()].filter((m) => {
          if (where.ticketId && m.ticketId !== where.ticketId) return false;
          if (
            typeof where.esNotaInterna === "boolean" &&
            m.esNotaInterna !== where.esNotaInterna
          ) {
            return false;
          }
          if (where.creadoEn?.gte && m.creadoEn < where.creadoEn.gte) return false;
          return true;
        });
        list.sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime());
        return list.map(hydrateMessage);
      },

      async findFirst({ where }) {
        queryLog.push({ model: "mensajeSoporte", op: "findFirst", where });
        for (const m of messages.values()) {
          if (where.id && m.id !== where.id) continue;
          if (where.archivoAdjuntoUrl?.not === null && !m.archivoAdjuntoUrl) continue;
          if (
            typeof where.esNotaInterna === "boolean" &&
            m.esNotaInterna !== where.esNotaInterna
          ) {
            continue;
          }
          if (where.ticket) {
            const t = tickets.get(m.ticketId);
            if (!t || !matchesTicketWhere(t, where.ticket)) continue;
          }
          return hydrateMessage(m);
        }
        return null;
      },
    },

    async $transaction(fn) {
      return fn(db);
    },
  };

  return db;
}

// Actores de prueba
const CLIENTE_1 = {
  id: "11111111-1111-4111-8111-111111111111",
  nombreUsuario: "cliente_ana",
  rol: "CLIENTE",
  estado: "VERIFICADO",
  perfilCliente: { nombres: "Ana", apellidos: "Gómez" },
};

const CLIENTE_2 = {
  id: "22222222-2222-4222-8222-222222222222",
  nombreUsuario: "cliente_ajeno",
  rol: "CLIENTE",
  estado: "VERIFICADO",
  perfilCliente: { nombres: "Pedro", apellidos: "Ajeno" },
};

const REPARADOR_1 = {
  id: "33333333-3333-4333-8333-333333333333",
  nombreUsuario: "reparador_carlos",
  rol: "REPARADOR",
  estado: "EN_REVISION",
  perfilReparador: { nombres: "Carlos", apellidos: "Mendoza" },
};

const ADMIN_1 = {
  id: "44444444-4444-4444-8444-444444444444",
  nombreUsuario: "admin_soporte",
  rol: "ADMINISTRADOR",
  estado: "VERIFICADO",
};

const ADMIN_2 = {
  id: "55555555-5555-4555-8555-555555555555",
  nombreUsuario: "admin_turno2",
  rol: "ADMINISTRADOR",
  estado: "VERIFICADO",
};

const ORDEN_1 = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  numeroOrden: "FX-100001",
  clienteId: CLIENTE_1.id,
  reparadorId: REPARADOR_1.id,
};

// ===========================================================================
// PRUEBAS HU21 — Radicación y tipificación de tickets
// ===========================================================================

test("HU21: creación válida de ticket con cálculo de SLA y formato TCK-YYYYMMDD-XXXXXX", async () => {
  const db = createInMemoryDb({
    users: [CLIENTE_1, REPARADOR_1],
    orders: [ORDEN_1],
  });
  const baseNow = new Date("2026-10-18T12:00:00.000Z");

  const valid = validateTicketInput({
    asunto: "El técnico no llegó a la cita programada",
    descripcion: "Esperé durante 2 horas en el domicilio y nunca se presentó.",
    categoria: "INCOMPARECENCIA",
    prioridad: "ALTA",
    ordenId: ORDEN_1.id,
  });
  assert.equal(valid.ok, true);

  const res = await createTicket(db, CLIENTE_1, valid.data, "soporte/evidencia.pdf", baseNow);
  assert.equal(res.ok, true);
  assert.match(res.data.numeroTicket, TICKET_NUMBER_REGEX);
  assert.equal(res.data.estado, "ABIERTO");
  assert.equal(res.data.categoria, "INCOMPARECENCIA");
  assert.equal(res.data.prioridad, "ALTA");
  assert.equal(res.data.orden?.id, ORDEN_1.id);

  // SLA de ALTA = 12 horas exactas desde baseNow
  const expectedSla = new Date(baseNow.getTime() + SLA_HOURS.ALTA * 3600 * 1000);
  assert.equal(res.data.fechaLimiteSla.getTime(), expectedSla.getTime());

  // El adjunto inicial se persiste como primer mensaje público del ticket
  assert.equal(db.messages.size, 1);
  const firstMsg = [...db.messages.values()][0];
  assert.equal(firstMsg.ticketId, res.data.id);
  assert.equal(firstMsg.archivoAdjuntoUrl, "soporte/evidencia.pdf");
  assert.equal(firstMsg.esNotaInterna, false);
});

test("HU21: rechazo de datos obligatorios inválidos (asunto corto, descripción corta, categoría/prioridad/UUID inválidos)", () => {
  assert.equal(
    validateTicketInput({
      asunto: "",
      descripcion: "Descripción suficientemente larga",
      categoria: "OTRO",
      prioridad: "MEDIA",
    }).ok,
    false
  );

  assert.equal(
    validateTicketInput({
      asunto: "Cort",
      descripcion: "Descripción suficientemente larga",
      categoria: "OTRO",
      prioridad: "MEDIA",
    }).ok,
    false
  );

  assert.equal(
    validateTicketInput({
      asunto: "Asunto válido para el ticket",
      descripcion: "Muy corta",
      categoria: "OTRO",
      prioridad: "MEDIA",
    }).ok,
    false
  );

  assert.equal(
    validateTicketInput({
      asunto: "Asunto válido para el ticket",
      descripcion: "Descripción suficientemente larga para pasar.",
      categoria: "CATEGORIA_INVENTADA",
      prioridad: "MEDIA",
    }).ok,
    false
  );

  assert.equal(
    validateTicketInput({
      asunto: "Asunto válido para el ticket",
      descripcion: "Descripción suficientemente larga para pasar.",
      categoria: "OTRO",
      prioridad: "URGENTISIMA",
    }).ok,
    false
  );

  assert.equal(
    validateTicketInput({
      asunto: "Asunto válido para el ticket",
      descripcion: "Descripción suficientemente larga para pasar.",
      categoria: "OTRO",
      prioridad: "MEDIA",
      ordenId: "no-es-un-uuid",
    }).ok,
    false
  );
});

test("HU21: rechazo cuando el usuario intenta vincular una orden inexistente o que pertenece a otro usuario", async () => {
  const db = createInMemoryDb({
    users: [CLIENTE_1, CLIENTE_2],
    orders: [ORDEN_1],
  });

  const valid = validateTicketInput({
    asunto: "Intento de reclamo sobre orden ajena",
    descripcion: "Quiero asociar una orden que no es mía a este ticket.",
    categoria: "DISPUTA_COSTO",
    prioridad: "MEDIA",
    ordenId: ORDEN_1.id,
  });
  assert.equal(valid.ok, true);

  // CLIENTE_2 no es ni clienteId ni reparadorId de ORDEN_1
  const res = await createTicket(db, CLIENTE_2, valid.data, null);
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  assert.equal(db.tickets.size, 0);
});

test("HU21: rechazo de radicación por usuario sin permisos o con cuenta suspendida", async () => {
  const db = createInMemoryDb({ users: [ADMIN_1, CLIENTE_1] });
  const valid = validateTicketInput({
    asunto: "Prueba de permisos de creación",
    descripcion: "Descripción válida de al menos diez caracteres.",
    categoria: "OTRO",
    prioridad: "BAJA",
  });
  assert.equal(valid.ok, true);

  // Un administrador gestiona la bandeja, no radica tickets como cliente/reparador
  const adminAttempt = await createTicket(db, ADMIN_1, valid.data, null);
  assert.equal(adminAttempt.ok, false);
  assert.equal(adminAttempt.status, 403);

  // Usuario suspendido
  const suspendedAttempt = await createTicket(
    db,
    { ...CLIENTE_1, estado: "SUSPENDIDO" },
    valid.data,
    null
  );
  assert.equal(suspendedAttempt.ok, false);
  assert.equal(suspendedAttempt.status, 403);
});

test("HU21: validación de firmas binarias (magic bytes) de adjuntos y reintento ante colisión P2002", async () => {
  const pdfBuf = Buffer.from("%PDF-1.7 contenido de prueba", "latin1");
  const jpgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const fakeBuf = Buffer.from("MZ executable disfrazado de pdf", "utf8");

  assert.deepEqual(detectAttachmentType(pdfBuf), { ext: "pdf", mime: "application/pdf" });
  assert.deepEqual(detectAttachmentType(jpgBuf), { ext: "jpg", mime: "image/jpeg" });
  assert.deepEqual(detectAttachmentType(pngBuf), { ext: "png", mime: "image/png" });
  assert.equal(detectAttachmentType(fakeBuf), null);

  // Simular colisión P2002 en el primer intento de generación de numeroTicket
  const db = createInMemoryDb({
    users: [REPARADOR_1],
    simulateCollisionCount: 1,
  });
  const valid = validateTicketInput({
    asunto: "Falla al registrar pago en efectivo",
    descripcion: "La aplicación se cerró al intentar confirmar el trabajo.",
    categoria: "FALLA_TECNICA_APP",
    prioridad: "CRITICA",
  });
  const res = await createTicket(db, REPARADOR_1, valid.data, null);
  assert.equal(res.ok, true);
  assert.match(res.data.numeroTicket, TICKET_NUMBER_REGEX);
});

test("HU21: cálculo exacto de SLA para todas las prioridades (CRITICA 4h, ALTA 12h, MEDIA 24h, BAJA 72h)", () => {
  const start = new Date("2026-10-18T00:00:00.000Z");
  assert.equal(
    calculateSlaDeadline("CRITICA", start).toISOString(),
    "2026-10-18T04:00:00.000Z"
  );
  assert.equal(
    calculateSlaDeadline("ALTA", start).toISOString(),
    "2026-10-18T12:00:00.000Z"
  );
  assert.equal(
    calculateSlaDeadline("MEDIA", start).toISOString(),
    "2026-10-19T00:00:00.000Z"
  );
  assert.equal(
    calculateSlaDeadline("BAJA", start).toISOString(),
    "2026-10-21T00:00:00.000Z"
  );
});

// ===========================================================================
// PRUEBAS HU22 — Bandeja de soporte, asignación y SLA
// ===========================================================================

test("HU22: control de acceso en bandeja — administrador ve todos los tickets y resumen; cliente solo los suyos", async () => {
  const db = createInMemoryDb({
    users: [CLIENTE_1, CLIENTE_2, ADMIN_1],
    orders: [ORDEN_1],
  });

  const v1 = validateTicketInput({
    asunto: "Ticket de Ana",
    descripcion: "Descripción del ticket de Ana para soporte.",
    categoria: "OTRO",
    prioridad: "MEDIA",
  });
  const v2 = validateTicketInput({
    asunto: "Ticket de Pedro",
    descripcion: "Descripción del ticket de Pedro para soporte.",
    categoria: "DISPUTA_COSTO",
    prioridad: "CRITICA",
  });

  await createTicket(db, CLIENTE_1, v1.data, null);
  await createTicket(db, CLIENTE_2, v2.data, null);

  // Cliente 1 solo ve su propio ticket y no recibe metadatos administrativos de otros
  const listCliente = await listTickets(db, CLIENTE_1, {});
  assert.equal(listCliente.total, 1);
  assert.equal(listCliente.items[0].asunto, "Ticket de Ana");
  assert.equal(listCliente.items[0].emisor, undefined);
  assert.equal(listCliente.resumen, undefined);

  // Administrador ve ambos tickets y el resumen global de SLA
  const listAdmin = await listTickets(db, ADMIN_1, {});
  assert.equal(listAdmin.total, 2);
  assert.equal(listAdmin.resumen?.pendientes, 2);
  assert.equal(listAdmin.resumen?.sinAsignar, 2);

  // Listado de agentes de soporte rechazado a clientes y permitido a administradores
  const agentsForClient = await listAgents(db, CLIENTE_1);
  assert.equal(agentsForClient.ok, false);
  assert.equal(agentsForClient.status, 403);

  const agentsForAdmin = await listAgents(db, ADMIN_1);
  assert.equal(agentsForAdmin.ok, true);
  assert.equal(agentsForAdmin.data.length, 1);
});

test("HU22: asignación válida, rechazo a usuario no administrador, preservación de SLA y concurrencia optimista", async () => {
  const db = createInMemoryDb({
    users: [CLIENTE_1, ADMIN_1, ADMIN_2],
  });
  const createdAt = new Date("2026-10-18T10:00:00.000Z");
  const valid = validateTicketInput({
    asunto: "Problema con cobro duplicado",
    descripcion: "Se realizó un cargo doble en mi tarjeta registrada.",
    categoria: "DISPUTA_COSTO",
    prioridad: "ALTA",
  });

  const created = await createTicket(db, CLIENTE_1, valid.data, null, createdAt);
  assert.equal(created.ok, true);
  const ticketId = created.data.id;
  const originalSla = created.data.fechaLimiteSla.getTime();
  const initialVersion = created.data.actualizadoEn.toISOString();

  // Un cliente no puede asignar tickets
  const clientAssign = await assignTicket(
    db,
    CLIENTE_1,
    ticketId,
    ADMIN_1.id,
    initialVersion
  );
  assert.equal(clientAssign.ok, false);
  assert.equal(clientAssign.status, 403);

  // Un administrador no puede asignar el ticket a un cliente ordinario
  const assignToClient = await assignTicket(
    db,
    ADMIN_1,
    ticketId,
    CLIENTE_1.id,
    initialVersion
  );
  assert.equal(assignToClient.ok, false);
  assert.equal(assignToClient.status, 422);

  // Asignación válida a ADMIN_2
  const assigned = await assignTicket(
    db,
    ADMIN_1,
    ticketId,
    ADMIN_2.id,
    initialVersion
  );
  assert.equal(assigned.ok, true);
  assert.equal(assigned.data.agente?.id, ADMIN_2.id);
  // La fecha límite original del SLA NO se modifica al reasignar
  assert.equal(assigned.data.fechaLimiteSla.getTime(), originalSla);

  // Se registró exactamente 1 nota interna de auditoría
  assert.equal(db.messages.size, 1);
  const auditNote = [...db.messages.values()][0];
  assert.equal(auditNote.esNotaInterna, true);
  assert.match(auditNote.mensaje, /\[AUDITORÍA\]/);

  // Concurrencia optimista: si se intenta reasignar enviando la versión vieja (initialVersion), falla con 409
  const staleAssign = await assignTicket(
    db,
    ADMIN_1,
    ticketId,
    ADMIN_1.id,
    initialVersion
  );
  assert.equal(staleAssign.ok, false);
  assert.equal(staleAssign.status, 409);
});

test("HU22: cambio de estado, exigencia de dictamen al resolver/cerrar y cálculo de estados de SLA", async () => {
  const db = createInMemoryDb({
    users: [CLIENTE_1, ADMIN_1],
  });
  const t0 = new Date("2026-10-18T00:00:00.000Z");
  const valid = validateTicketInput({
    asunto: "Incidencia crítica de prueba",
    descripcion: "Descripción completa para verificar el ciclo de vida.",
    categoria: "FALLA_TECNICA_APP",
    prioridad: "CRITICA", // SLA = 4h -> vence a las 04:00:00Z
  });
  const created = await createTicket(db, CLIENTE_1, valid.data, null, t0);
  const ticketId = created.data.id;

  // Verificación de umbrales de SLA (regla única del 25% restante):
  // - A las 02:00 (quedan 2h de 4h = 50% > 25%) -> on_time
  assert.equal(
    getSlaStatus(created.data, new Date("2026-10-18T02:00:00.000Z")).status,
    "on_time"
  );
  // - A las 03:00 (queda 1h de 4h = 25% exacto) -> warning
  assert.equal(
    getSlaStatus(created.data, new Date("2026-10-18T03:00:00.000Z")).status,
    "warning"
  );
  // - A las 04:00:01 (vencido) -> overdue
  assert.equal(
    getSlaStatus(created.data, new Date("2026-10-18T04:00:01.000Z")).status,
    "overdue"
  );

  // Resolver sin dictamen debe fallar con 400
  const noDictamen = await changeTicketStatus(
    db,
    ADMIN_1,
    ticketId,
    "RESUELTO",
    "",
    created.data.actualizadoEn.toISOString()
  );
  assert.equal(noDictamen.ok, false);
  assert.equal(noDictamen.status, 400);

  // Resolver con dictamen válido pasa y el SLA pasa a "closed" incluso después del vencimiento
  const resolved = await changeTicketStatus(
    db,
    ADMIN_1,
    ticketId,
    "RESUELTO",
    "Se verificó la falla y se aplicó la corrección en la cuenta.",
    created.data.actualizadoEn.toISOString(),
    new Date("2026-10-18T05:00:00.000Z")
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.estado, "RESUELTO");
  assert.equal(resolved.data.sla.status, "closed");
});

// ===========================================================================
// PRUEBAS HU23 — Chat de mediación y aislamiento estricto de notas internas
// ===========================================================================

test("HU23: envío y lectura de mensajes autorizados, rechazo a terceros y aislamiento de notas internas en BD", async () => {
  const db = createInMemoryDb({
    users: [CLIENTE_1, CLIENTE_2, REPARADOR_1, ADMIN_1],
    orders: [ORDEN_1],
  });

  const valid = validateTicketInput({
    asunto: "Mediación sobre trabajo en curso",
    descripcion: "Necesitamos mediación sobre el alcance de la reparación.",
    categoria: "DISPUTA_COSTO",
    prioridad: "ALTA",
    ordenId: ORDEN_1.id,
  });
  const created = await createTicket(db, CLIENTE_1, valid.data, null);
  const ticketId = created.data.id;

  // 1. Cliente emisor envía mensaje público
  const msgCliente = await postMessage(db, CLIENTE_1, ticketId, {
    mensaje: "Hola, adjunto mi postura sobre el presupuesto.",
    esNotaInterna: false,
    archivoKey: null,
  });
  assert.equal(msgCliente.ok, true);
  assert.equal(msgCliente.data.esNotaInterna, false);

  // 2. Reparador vinculado a la orden también puede participar
  const msgReparador = await postMessage(db, REPARADOR_1, ticketId, {
    mensaje: "Confirmo que el material adicional fue necesario.",
    esNotaInterna: false,
    archivoKey: null,
  });
  assert.equal(msgReparador.ok, true);

  // 3. Un usuario ajeno (CLIENTE_2) no puede leer ni escribir en el ticket
  const outsiderRead = await listMessages(db, CLIENTE_2, ticketId);
  assert.equal(outsiderRead.ok, false);
  assert.equal(outsiderRead.status, 404);

  const outsiderWrite = await postMessage(db, CLIENTE_2, ticketId, {
    mensaje: "Intento de intrusión",
    archivoKey: null,
  });
  assert.equal(outsiderWrite.ok, false);
  assert.equal(outsiderWrite.status, 404);

  // 4. Un cliente o reparador que intenta enviar esNotaInterna=true es rechazado con 403
  const forgedInternal = await postMessage(db, CLIENTE_1, ticketId, {
    mensaje: "Intento de nota interna falsificada",
    esNotaInterna: true,
    archivoKey: null,
  });
  assert.equal(forgedInternal.ok, false);
  assert.equal(forgedInternal.status, 403);

  // 5. El administrador crea una nota interna con adjunto confidencial y un mensaje público
  const internalNote = await postMessage(db, ADMIN_1, ticketId, {
    mensaje: "NOTA CONFIDENCIAL: revisar historial de pagos en pasarela.",
    esNotaInterna: true,
    archivoKey: "soporte/auditoria-interna.pdf",
  });
  assert.equal(internalNote.ok, true);
  assert.equal(internalNote.data.esNotaInterna, true);

  const publicReply = await postMessage(db, ADMIN_1, ticketId, {
    mensaje: "Hemos revisado el caso y les daremos respuesta en breve.",
    esNotaInterna: false,
    archivoKey: "soporte/comprobante-publico.pdf",
  });
  assert.equal(publicReply.ok, true);

  // 6. Al consultar como CLIENTE_1 o REPARADOR_1:
  //    - Solo reciben los 3 mensajes públicos (nunca la nota interna).
  //    - La consulta a la BD incluyó `esNotaInterna: false` en el `where`.
  db.queryLog.length = 0;
  const visibleToClient = await listMessages(db, CLIENTE_1, ticketId);
  assert.equal(visibleToClient.ok, true);
  assert.equal(visibleToClient.data.length, 3);
  assert.equal(
    visibleToClient.data.some((m) => m.esNotaInterna || m.mensaje.includes("CONFIDENCIAL")),
    false
  );
  const lastQuery = db.queryLog.find(
    (q) => q.model === "mensajeSoporte" && q.op === "findMany"
  );
  assert.equal(lastQuery.where.esNotaInterna, false);

  // 7. Al consultar como ADMINISTRADOR: recibe los 4 mensajes (incluyendo la nota interna)
  const visibleToAdmin = await listMessages(db, ADMIN_1, ticketId);
  assert.equal(visibleToAdmin.ok, true);
  assert.equal(visibleToAdmin.data.length, 4);

  // 8. Control de acceso a adjuntos:
  //    - Cliente NO puede descargar el adjunto de la nota interna (404).
  //    - Cliente SÍ puede descargar el adjunto público del ticket.
  //    - Cliente ajeno NO puede descargar ningún adjunto del ticket.
  const clientInternalAtt = await getAttachmentKey(
    db,
    CLIENTE_1,
    internalNote.data.id
  );
  assert.equal(clientInternalAtt.ok, false);
  assert.equal(clientInternalAtt.status, 404);

  const clientPublicAtt = await getAttachmentKey(
    db,
    CLIENTE_1,
    publicReply.data.id
  );
  assert.equal(clientPublicAtt.ok, true);
  assert.equal(clientPublicAtt.data, "soporte/comprobante-publico.pdf");

  const outsiderPublicAtt = await getAttachmentKey(
    db,
    CLIENTE_2,
    publicReply.data.id
  );
  assert.equal(outsiderPublicAtt.ok, false);
  assert.equal(outsiderPublicAtt.status, 404);

  const adminInternalAtt = await getAttachmentKey(
    db,
    ADMIN_1,
    internalNote.data.id
  );
  assert.equal(adminInternalAtt.ok, true);
  assert.equal(adminInternalAtt.data, "soporte/auditoria-interna.pdf");
});

// ===========================================================================
// PRUEBAS DE AUDITORÍA Y CORRECCIÓN (M-01, M-02, M-03, RateLimiter, BoundedBody)
// Comprueban el comportamiento real de las funciones y las actualizaciones
// sobre los objetos de persistencia simulados en memoria (sin BD PostgreSQL real).
// ===========================================================================

test("M-02: validateDictamenText valida límites de frontera (9, 10, 2000, 2001 caracteres) y espacios en blanco", () => {
  assert.equal(DICTAMEN_MIN, 10);
  assert.equal(DICTAMEN_MAX, 2000);

  // 9 caracteres: debe fallar tanto si es requerido como si no (si se envía, debe cumplir longitud mínima)
  const nineChars = "123456789";
  const resNineReq = validateDictamenText(nineChars, true);
  assert.equal(resNineReq.ok, false);
  const resNineOptional = validateDictamenText(nineChars, false);
  assert.equal(resNineOptional.ok, false);

  // 10 caracteres exactos: debe pasar
  const tenChars = "1234567890";
  const resTen = validateDictamenText(tenChars, true);
  assert.equal(resTen.ok, true);
  assert.equal(resTen.data, tenChars);

  // 2000 caracteres exactos: debe pasar
  const twoThousandChars = "a".repeat(2000);
  const res2000 = validateDictamenText(twoThousandChars, true);
  assert.equal(res2000.ok, true);
  assert.equal(res2000.data?.length, 2000);

  // 2001 caracteres: debe fallar
  const twoThousandOneChars = "a".repeat(2001);
  const res2001 = validateDictamenText(twoThousandOneChars, true);
  assert.equal(res2001.ok, false);

  // Espacios en blanco / vacío con isRequired=true: debe fallar
  const emptyReq = validateDictamenText("   \n\t  ", true);
  assert.equal(emptyReq.ok, false);

  // Espacios en blanco / vacío con isRequired=false: debe pasar con data=null
  const emptyOpt = validateDictamenText("   \n\t  ", false);
  assert.equal(emptyOpt.ok, true);
  assert.equal(emptyOpt.data, null);
});

test("M-03: reapertura de ticket desde RESUELTO limpia resolucionDictamen y cerradoEn a null; CERRADO es inmutable", async () => {
  const db = createInMemoryDb({
    users: [CLIENTE_1, ADMIN_1],
  });
  const t0 = new Date("2026-10-18T00:00:00.000Z");
  const valid = validateTicketInput({
    asunto: "Caso con resolución y reapertura",
    descripcion: "Descripción para verificar ciclo de reapertura y limpieza de dictamen.",
    categoria: "FALLA_TECNICA_APP",
    prioridad: "MEDIA",
  });
  const created = await createTicket(db, CLIENTE_1, valid.data, null, t0);
  const ticketId = created.data.id;

  // 1. Resolver ticket con dictamen oficial
  const resolved = await changeTicketStatus(
    db,
    ADMIN_1,
    ticketId,
    "RESUELTO",
    "Dictamen válido de resolución del problema técnico.",
    created.data.actualizadoEn.toISOString(),
    new Date("2026-10-18T01:00:00.000Z")
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.estado, "RESUELTO");
  assert.equal(
    resolved.data.resolucionDictamen,
    "Dictamen válido de resolución del problema técnico."
  );
  assert.equal(resolved.data.cerradoEn, null);

  // Verificar en el objeto simulado de persistencia
  const storedResolved = db.tickets.get(ticketId);
  assert.equal(
    storedResolved.resolucionDictamen,
    "Dictamen válido de resolución del problema técnico."
  );
  assert.equal(storedResolved.cerradoEn, null);

  // 2. Reabrir ticket: transición de RESUELTO a EN_GESTION
  // Debe limpiar el dictamen obsoleto y cerradoEn en el registro persistido simulado
  const reopened = await changeTicketStatus(
    db,
    ADMIN_1,
    ticketId,
    "EN_GESTION",
    undefined,
    resolved.data.actualizadoEn.toISOString(),
    new Date("2026-10-18T02:00:00.000Z")
  );
  assert.equal(reopened.ok, true);
  assert.equal(reopened.data.estado, "EN_GESTION");
  assert.equal(reopened.data.resolucionDictamen, null);
  assert.equal(reopened.data.cerradoEn, null);

  const storedReopened = db.tickets.get(ticketId);
  assert.equal(storedReopened.resolucionDictamen, null);
  assert.equal(storedReopened.cerradoEn, null);

  // 3. Pasar a CERRADO con dictamen de cierre
  const closed = await changeTicketStatus(
    db,
    ADMIN_1,
    ticketId,
    "CERRADO",
    "Dictamen definitivo de cierre sin ulterior trámite.",
    reopened.data.actualizadoEn.toISOString(),
    new Date("2026-10-18T03:00:00.000Z")
  );
  assert.equal(closed.ok, true);
  assert.equal(closed.data.estado, "CERRADO");
  assert.equal(
    closed.data.resolucionDictamen,
    "Dictamen definitivo de cierre sin ulterior trámite."
  );
  assert.ok(closed.data.cerradoEn instanceof Date);

  // 4. Intentar reabrir un ticket en estado CERRADO debe rechazarse con 409
  const reopenClosed = await changeTicketStatus(
    db,
    ADMIN_1,
    ticketId,
    "EN_GESTION",
    undefined,
    closed.data.actualizadoEn.toISOString()
  );
  assert.equal(reopenClosed.ok, false);
  assert.equal(reopenClosed.status, 409);
  assert.match(reopenClosed.message, /cerrado/i);

  // El registro persistido simulado sigue inalterado en CERRADO
  const storedFinal = db.tickets.get(ticketId);
  assert.equal(storedFinal.estado, "CERRADO");
});

test("M-01: validación previa de elegibilidad (validateTicketEligibility y validateMessageEligibility) antes de persistir adjuntos", async () => {
  const db = createInMemoryDb({
    users: [CLIENTE_1, CLIENTE_2, REPARADOR_1, ADMIN_1],
    orders: [ORDEN_1],
  });

  // 1. validateTicketEligibility rechaza si el usuario intenta asociar una orden ajena
  const ineligibleOrder = await validateTicketEligibility(
    db,
    CLIENTE_2,
    ORDEN_1.id
  );
  assert.equal(ineligibleOrder.ok, false);
  assert.equal(ineligibleOrder.status, 404);

  // validateTicketEligibility rechaza si el rol no puede radicar tickets (ADMINISTRADOR)
  const ineligibleRole = await validateTicketEligibility(db, ADMIN_1, null);
  assert.equal(ineligibleRole.ok, false);
  assert.equal(ineligibleRole.status, 403);

  // validateTicketEligibility aprueba si el cliente es dueño de la orden
  const eligibleTicket = await validateTicketEligibility(
    db,
    CLIENTE_1,
    ORDEN_1.id
  );
  assert.equal(eligibleTicket.ok, true);

  // 2. Crear un ticket para pruebas de mensajes
  const valid = validateTicketInput({
    asunto: "Ticket para prueba de mensajes",
    descripcion: "Descripción para verificar prevalidación de mensajes.",
    categoria: "OTRO",
    prioridad: "BAJA",
  });
  const created = await createTicket(db, CLIENTE_1, valid.data, null);
  const ticketId = created.data.id;

  // validateMessageEligibility rechaza a usuario ajeno (404)
  const ineligibleMsgUser = await validateMessageEligibility(
    db,
    CLIENTE_2,
    ticketId,
    false
  );
  assert.equal(ineligibleMsgUser.ok, false);
  assert.equal(ineligibleMsgUser.status, 404);

  // validateMessageEligibility rechaza nota interna si no es admin (403)
  const ineligibleInternalNote = await validateMessageEligibility(
    db,
    CLIENTE_1,
    ticketId,
    true
  );
  assert.equal(ineligibleInternalNote.ok, false);
  assert.equal(ineligibleInternalNote.status, 403);

  // validateMessageEligibility aprueba mensaje de participante
  const eligibleMsg = await validateMessageEligibility(
    db,
    CLIENTE_1,
    ticketId,
    false
  );
  assert.equal(eligibleMsg.ok, true);

  // Cerrar el ticket y verificar que validateMessageEligibility rechaza con 409
  await changeTicketStatus(
    db,
    ADMIN_1,
    ticketId,
    "CERRADO",
    "Cierre de prueba para rechazo de mensajes.",
    created.data.actualizadoEn.toISOString()
  );

  const closedTicketMsg = await validateMessageEligibility(
    db,
    CLIENTE_1,
    ticketId,
    false
  );
  assert.equal(closedTicketMsg.ok, false);
  assert.equal(closedTicketMsg.status, 409);
});

test("RateLimiter.consume(): comprueba y consume intentos sincrónicamente sin holguras asíncronas", () => {
  let fakeTime = 10000;
  const limiter = createRateLimiter({
    max: 3,
    windowMs: 5000,
    now: () => fakeTime,
  });

  const userId = "user-test-uuid";

  // Intentos 1, 2, 3 son aprobados y consumidos
  assert.equal(limiter.consume(userId), true);
  assert.equal(limiter.consume(userId), true);
  assert.equal(limiter.consume(userId), true);

  // Intento 4 excede la cuota de 3 en la ventana -> rechazado inmediatamente
  assert.equal(limiter.consume(userId), false);
  assert.equal(limiter.consume(userId), false);

  // Al avanzar el tiempo fuera de la ventana de 5000ms, se reanuda la cuota
  fakeTime += 5001;
  assert.equal(limiter.consume(userId), true);
});

test("readBoundedBody(): limita la lectura física del stream y reconstruye la petición", async () => {
  // 1. Cuerpo que cabe en el límite
  const smallText = JSON.stringify({ key: "val" });
  const smallReq = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: smallText,
  });

  const smallResult = await readBoundedBody(smallReq, 100);
  assert.equal(smallResult.ok, true);
  const parsedSmall = await smallResult.request.json();
  assert.equal(parsedSmall.key, "val");

  // 2. Cuerpo que excede el límite máximo de bytes en el flujo
  const largeData = new Uint8Array(200);
  const largeReq = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: largeData,
  });

  const largeResult = await readBoundedBody(largeReq, 100);
  assert.equal(largeResult.ok, false);
  assert.equal(largeResult.status, 413);

  // 3. Encabezado Content-Length que declara más del máximo
  const declaredExcessReq = new Request("http://localhost/api/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "5000",
    },
    body: "{}",
  });

  const declaredResult = await readBoundedBody(declaredExcessReq, 100);
  assert.equal(declaredResult.ok, false);
  assert.equal(declaredResult.status, 413);
});
