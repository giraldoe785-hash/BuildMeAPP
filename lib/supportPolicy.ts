// Política y validaciones PURAS del módulo de soporte (HU21–HU23).
// Sin imports de servidor, Prisma ni Next: se usa igual en API, componentes
// y pruebas. Es la ÚNICA fuente de verdad de SLA, etiquetas y límites.

// Los valores reflejan los enums reales de prisma/schema.prisma.
export const TICKET_PRIORITIES = ["BAJA", "MEDIA", "ALTA", "CRITICA"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATES = [
  "ABIERTO",
  "EN_GESTION",
  "EN_ESPERA_USUARIO",
  "RESUELTO",
  "CERRADO",
] as const;
export type TicketState = (typeof TICKET_STATES)[number];

export const TICKET_CATEGORIES = [
  "INCOMPARECENCIA",
  "DISPUTA_COSTO",
  "COMPORTAMIENTO_INDEBIDO",
  "FALLA_TECNICA_APP",
  "GARANTIA_INCONFORME",
  "OTRO",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Estados en los que el ticket ya no cuenta como pendiente de atención. */
export const TERMINAL_STATES: readonly TicketState[] = ["RESUELTO", "CERRADO"];

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  BAJA: "Baja",
  MEDIA: "Media",
  ALTA: "Alta",
  CRITICA: "Crítica",
};

export const STATE_LABELS: Record<TicketState, string> = {
  ABIERTO: "Abierto",
  EN_GESTION: "En gestión",
  EN_ESPERA_USUARIO: "En espera del usuario",
  RESUELTO: "Resuelto",
  CERRADO: "Cerrado",
};

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  INCOMPARECENCIA: "Incomparecencia",
  DISPUTA_COSTO: "Disputa de costo",
  COMPORTAMIENTO_INDEBIDO: "Comportamiento indebido",
  FALLA_TECNICA_APP: "Falla técnica de la app",
  GARANTIA_INCONFORME: "Garantía inconforme",
  OTRO: "Otro",
};

// ---------------------------------------------------------------------------
// SLA — POLÍTICA PROVISIONAL DEL PROYECTO
// Estos tiempos NO provienen de una norma oficial ni de un estándar verificado:
// son una matriz provisional para el MVP, pendiente de aprobación funcional.
// Para cambiarla basta editar este objeto; ninguna otra capa duplica valores.
// ---------------------------------------------------------------------------
export const SLA_HOURS: Record<TicketPriority, number> = {
  CRITICA: 4,
  ALTA: 12,
  MEDIA: 24,
  BAJA: 72,
};

/** Un ticket está "por vencer" cuando le queda esta fracción (o menos) del plazo total. */
export const SLA_WARNING_FRACTION = 0.25;

const HOUR_MS = 60 * 60 * 1000;

/** Fecha límite = momento de creación + horas de la prioridad. Se calcula SIEMPRE en el servidor. */
export function calculateSlaDeadline(
  priority: TicketPriority,
  from: Date = new Date()
): Date {
  return new Date(from.getTime() + SLA_HOURS[priority] * HOUR_MS);
}

export type SlaStatus = "on_time" | "warning" | "overdue" | "closed";

export interface SlaInput {
  estado: TicketState;
  creadoEn: Date;
  fechaLimiteSla: Date;
}

/**
 * - closed:   estado terminal (RESUELTO/CERRADO): nunca es un incumplimiento activo.
 * - overdue:  restante <= 0 (el límite exacto ya cuenta como vencido).
 * - warning:  0 < restante <= 25 % del plazo total (el límite exacto cuenta como warning).
 * - on_time:  restante > 25 % del plazo total.
 * Una sola regla: no hay umbrales en horas que puedan contradecirla.
 */
export function getSlaStatus(
  t: SlaInput,
  now: Date = new Date()
): { status: SlaStatus; remainingMs: number } {
  const remainingMs = t.fechaLimiteSla.getTime() - now.getTime();

  if (TERMINAL_STATES.includes(t.estado)) {
    return { status: "closed", remainingMs };
  }
  if (remainingMs <= 0) return { status: "overdue", remainingMs };

  const totalMs = t.fechaLimiteSla.getTime() - t.creadoEn.getTime();
  if (totalMs > 0 && remainingMs <= totalMs * SLA_WARNING_FRACTION) {
    return { status: "warning", remainingMs };
  }
  return { status: "on_time", remainingMs };
}

// ---------------------------------------------------------------------------
// Numeración de tickets: TCK-YYYYMMDD-XXXXXX
// El sufijo es aleatorio (no un conteo). La unicidad real la garantiza el
// índice único de numeroTicket; el servicio reintenta ante un conflicto (P2002).
// ---------------------------------------------------------------------------
const TICKET_SUFFIX_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TICKET_NUMBER_REGEX = /^TCK-\d{8}-[A-Z0-9]{6}$/;

export function generateTicketNumber(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let suffix = "";
  for (const b of bytes) {
    suffix += TICKET_SUFFIX_ALPHABET[b % TICKET_SUFFIX_ALPHABET.length];
  }
  return `TCK-${y}${m}${d}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Validación de entrada (se repite en el servidor; el formulario solo la reutiliza)
// ---------------------------------------------------------------------------
export const SUBJECT_MIN = 5;
export const SUBJECT_MAX = 150;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 2000;
export const MESSAGE_MAX = 2000;
export const DICTAMEN_MIN = 10;
export const DICTAMEN_MAX = 2000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB, igual que registro de reparadores

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export interface TicketInput {
  asunto: string;
  descripcion: string;
  categoria: TicketCategory;
  prioridad: TicketPriority;
  ordenId: string | null;
}

export type Validation<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export function validateTicketInput(raw: {
  asunto?: unknown;
  descripcion?: unknown;
  categoria?: unknown;
  prioridad?: unknown;
  ordenId?: unknown;
}): Validation<TicketInput> {
  const asunto = typeof raw.asunto === "string" ? raw.asunto.trim() : "";
  const descripcion =
    typeof raw.descripcion === "string" ? raw.descripcion.trim() : "";

  if (!asunto || !descripcion) {
    return { ok: false, message: "El asunto y la descripción son obligatorios." };
  }
  if (asunto.length < SUBJECT_MIN || asunto.length > SUBJECT_MAX) {
    return {
      ok: false,
      message: `El asunto debe tener entre ${SUBJECT_MIN} y ${SUBJECT_MAX} caracteres.`,
    };
  }
  if (descripcion.length < DESCRIPTION_MIN || descripcion.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      message: `La descripción debe tener entre ${DESCRIPTION_MIN} y ${DESCRIPTION_MAX} caracteres.`,
    };
  }
  if (!TICKET_CATEGORIES.includes(raw.categoria as TicketCategory)) {
    return { ok: false, message: "La categoría seleccionada no es válida." };
  }
  if (!TICKET_PRIORITIES.includes(raw.prioridad as TicketPriority)) {
    return { ok: false, message: "La prioridad seleccionada no es válida." };
  }

  let ordenId: string | null = null;
  if (raw.ordenId !== undefined && raw.ordenId !== null && raw.ordenId !== "") {
    if (!isUuid(raw.ordenId)) {
      return { ok: false, message: "La orden de servicio indicada no es válida." };
    }
    ordenId = raw.ordenId;
  }

  return {
    ok: true,
    data: {
      asunto,
      descripcion,
      categoria: raw.categoria as TicketCategory,
      prioridad: raw.prioridad as TicketPriority,
      ordenId,
    },
  };
}

export function validateMessageText(
  raw: unknown,
  hasAttachment: boolean
): Validation<string> {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text && !hasAttachment) {
    return { ok: false, message: "Escribe un mensaje o adjunta un archivo." };
  }
  if (text.length > MESSAGE_MAX) {
    return {
      ok: false,
      message: `El mensaje no puede superar ${MESSAGE_MAX} caracteres.`,
    };
  }
  return { ok: true, data: text || "Archivo adjunto" };
}

export function validateDictamenText(
  raw: unknown,
  isRequired: boolean
): Validation<string | null> {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    if (isRequired) {
      return {
        ok: false,
        message: `Para resolver o cerrar indica un dictamen de ${DICTAMEN_MIN} a ${DICTAMEN_MAX} caracteres.`,
      };
    }
    return { ok: true, data: null };
  }
  if (text.length < DICTAMEN_MIN || text.length > DICTAMEN_MAX) {
    return {
      ok: false,
      message: `El dictamen de resolución debe tener entre ${DICTAMEN_MIN} y ${DICTAMEN_MAX} caracteres.`,
    };
  }
  return { ok: true, data: text };
}

// ---------------------------------------------------------------------------
// Adjuntos: el tipo real se decide por los primeros bytes, no por MIME/extensión.
// ---------------------------------------------------------------------------
export type AttachmentType = { ext: "pdf" | "jpg" | "png"; mime: string };

export function detectAttachmentType(buffer: Buffer): AttachmentType | null {
  if (buffer.length > 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { ext: "pdf", mime: "application/pdf" };
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buffer.length > 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: "png", mime: "image/png" };
  }
  return null;
}

export function mimeFromStoredKey(key: string): string {
  if (key.endsWith(".pdf")) return "application/pdf";
  if (key.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

// ---------------------------------------------------------------------------
// Roles (valores reales de RolUsuario) y visibilidad
// ---------------------------------------------------------------------------
export type SupportRole = "CLIENTE" | "REPARADOR" | "ADMINISTRADOR";

export const canCreateTickets = (rol: string) =>
  rol === "CLIENTE" || rol === "REPARADOR";
export const isSupportAdmin = (rol: string) => rol === "ADMINISTRADOR";
/** Solo el personal administrador crea o lee notas internas. */
export const canHandleInternalNotes = (rol: string) => rol === "ADMINISTRADOR";
