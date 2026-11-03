import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { SERVICE_CATEGORIES } from "../data/services";
import {
  ACTIVE_DB_ORDER_STATUSES,
  buildStoredDiagnosis,
  describeIdempotencyMismatch,
  generateOrderNumber,
  generateOrderOtp,
  isValidOrderOtpFormat,
  isValidUuid,
  mapDbPaymentMethodToUi,
  mapDbStatusToUiStatus,
  OrderPolicyError,
  validateCreateOrderInput,
} from "./orderPolicy";
import type {
  CategorySlug,
  DbOrderStatus,
  DbPaymentMethod,
  ValidatedOrderInput,
} from "./orderPolicy";

export { OrderPolicyError } from "./orderPolicy";

export interface OrderActor {
  id: string;
  rol: "CLIENTE" | "REPARADOR" | "AGENTE_SOPORTE" | "ADMINISTRADOR" | string;
  estado: "PENDIENTE_VERIFICACION" | "EN_REVISION" | "VERIFICADO" | "RECHAZADO" | "SUSPENDIDO" | string;
  nombreUsuario?: string | null;
  nombreCompleto?: string | null;
  correo?: string | null;
  email?: string | null;
  perfilCliente?: {
    id?: string;
    nombres?: string;
    apellidos?: string;
  } | null;
  perfilReparador?: {
    id: string;
    nombres?: string;
    apellidos?: string;
    numeroDocumento?: string | null;
    cedulaRuc?: string | null;
    calificacionPromedio?: unknown;
    totalTrabajosCompletados?: number;
    especialidades?: Array<{
      categoria?: {
        id: string;
        slug: string;
        nombre: string;
      } | null;
    }>;
  } | null;
}

export type DbPaymentStatus =
  | "PENDIENTE"
  | "PREAUTORIZADO"
  | "CAPTURADO"
  | "LIBERADO"
  | "REEMBOLSADO"
  | "FALLIDO";

const VALID_DB_PAYMENT_STATUSES: readonly DbPaymentStatus[] = [
  "PENDIENTE",
  "PREAUTORIZADO",
  "CAPTURADO",
  "LIBERADO",
  "REEMBOLSADO",
  "FALLIDO",
] as const;

function normalizeDbPaymentStatus(raw: unknown): DbPaymentStatus {
  if (typeof raw === "string") {
    const clean = raw.trim().toUpperCase() as DbPaymentStatus;
    if (VALID_DB_PAYMENT_STATUSES.includes(clean)) {
      return clean;
    }
  }
  return "PENDIENTE";
}

export interface SerializedClientOrder {
  id: string;
  orderNumber: string;
  category: CategorySlug;
  status: ReturnType<typeof mapDbStatusToUiStatus>;
  dbStatus: DbOrderStatus;
  paymentStatus: DbPaymentStatus;
  diagnosis: {
    id: string;
    title: string;
    category: CategorySlug;
    confidenceScore: number;
    confidenceLevel: "high" | "medium";
    pricingType: "fixed" | "estimated_range";
    severity: "baja" | "media" | "alta";
    rootCause: string;
    suggestedFix: string;
    requiredMaterials: string[];
    estimatedHours: number;
    priceFixed?: number;
    method: "Analisis_IA" | "Caso_Predefinido";
    thumbnailUrl?: string;
  };
  technician: {
    id: string;
    name: string;
    photoUrl: string;
    rating: number;
    completedJobs: number;
    specialty: CategorySlug;
    bio: string;
    responseMinutes: number;
    verificationHash: string;
    badgeLevel: "Master Fixer" | "Pro Certificado" | "Especialista";
    isAssigned: boolean;
  };
  urgencyType: "immediate" | "scheduled";
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  address: string;
  apartmentReference?: string;
  otpCode: string;
  paymentMethod: ReturnType<typeof mapDbPaymentMethodToUi>;
  pricing: {
    baseInspection: number;
    laborEstimate: number;
    warrantyProtection: number;
    discount: number;
    extraCost: number;
    total: number;
  };
  createdAt: string;
  assignedAt?: string | null;
}

export interface SerializedAvailableOrderForRepairer {
  id: string;
  orderNumber: string;
  category: CategorySlug;
  categoryName: string;
  issue: string;
  rootCause: string;
  suggestedFix: string;
  address: string;
  accessNotes: string | null;
  distance: string;
  payout: number;
  urgency: "immediate" | "scheduled";
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  clientDisplayName: string;
  createdAt: string;
  isLiveStoreOrder: true;
}

export interface SerializedAssignedOrderForRepairer
  extends SerializedAvailableOrderForRepairer {
  dbStatus: DbOrderStatus;
  paymentStatus: DbPaymentStatus;
  status: "dispatched" | "at_door" | "in_progress" | "finished";
  assignedAt: string | null;
}

function toNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (val && typeof val === "object" && "toNumber" in val && typeof (val as { toNumber: () => number }).toNumber === "function") {
    return (val as { toNumber: () => number }).toNumber();
  }
  if (val && typeof val === "object") {
    const parsed = Number(String(val));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function extractUserFullName(userRecord: Record<string, any> | undefined | null): string {
  if (!userRecord) return "";
  if (typeof userRecord.nombreCompleto === "string" && userRecord.nombreCompleto.trim()) {
    return userRecord.nombreCompleto.trim();
  }
  const pc = userRecord.perfilCliente;
  if (pc && (pc.nombres || pc.apellidos)) {
    return `${pc.nombres || ""} ${pc.apellidos || ""}`.trim();
  }
  const pr = userRecord.perfilReparador;
  if (pr && (pr.nombres || pr.apellidos)) {
    return `${pr.nombres || ""} ${pr.apellidos || ""}`.trim();
  }
  if (typeof userRecord.nombreUsuario === "string" && userRecord.nombreUsuario.trim()) {
    return userRecord.nombreUsuario.trim();
  }
  return "";
}

function maskClientDisplayName(clientRecord: Record<string, any> | string | undefined | null): string {
  const fullName =
    typeof clientRecord === "string"
      ? clientRecord
      : extractUserFullName(clientRecord);
  if (!fullName || !fullName.trim()) return "Cliente Fixi (En vivo)";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return `${parts[0]} (En vivo)`;
  }
  const firstName = parts[0];
  const lastInitial = parts[1][0]?.toUpperCase() || "";
  return `${firstName} ${lastInitial}. (En vivo)`;
}

function formatOrderTime(dateInput: Date | string | undefined | null): string {
  const date = dateInput instanceof Date ? dateInput : dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "Reciente";
  }
  return date.toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const UNASSIGNED_TECH_AVATAR =
  "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=300&auto=format&fit=crop&q=80";
const ASSIGNED_TECH_AVATAR =
  "https://images.unsplash.com/photo-1540569014015-19a7be504e3a?w=300&auto=format&fit=crop&q=80";

/**
 * Serializa una orden de BD al contrato `ServiceOrder` esperado por el cliente en el frontend.
 * Mientras `reparadorId === null`, devuelve un placeholder explícito sin asignar a ningún
 * técnico fijo falso (`isAssigned: false`). Cuando un reparador real acepta la orden,
 * devuelve los datos reales del reparador autenticado.
 */
export function serializeOrderForClient(rawOrder: Record<string, any>): SerializedClientOrder {
  const categorySlug = (rawOrder.categoria?.slug || "electricidad") as CategorySlug;
  const dbStatus = (rawOrder.estado || "BUSCANDO") as DbOrderStatus;
  const paymentStatus = normalizeDbPaymentStatus(rawOrder.estadoPago);
  const uiStatus = mapDbStatusToUiStatus(dbStatus, false);

  const costoVisita = toNumber(rawOrder.costoVisita, 15.0);
  const costoManoObraEstimado = toNumber(rawOrder.costoManoObraEstimado, 40.0);
  const costoGarantiaFixicare = toNumber(rawOrder.costoGarantiaFixicare, 4.9);
  const montoDescuento = toNumber(rawOrder.montoDescuento, 0);
  const totalPreautorizado = toNumber(rawOrder.totalPreautorizado, 59.9);

  const reparador = rawOrder.reparador;
  const isAssigned = Boolean(rawOrder.reparadorId && reparador);
  const perfilReparador = reparador?.perfilReparador;

  const technician: SerializedClientOrder["technician"] = isAssigned
    ? {
        id: String(reparador.id),
        name: extractUserFullName(reparador) || "Especialista Fixi",
        photoUrl: String(reparador.fotoPerfilUrl || ASSIGNED_TECH_AVATAR),
        rating: toNumber(perfilReparador?.calificacionPromedio, 4.95) || 4.95,
        completedJobs: Number(perfilReparador?.totalTrabajosCompletados ?? 12),
        specialty: categorySlug,
        bio:
          "Especialista verificado en la red BuildMeAPP con garantía FixiCare®.",
        responseMinutes: 12,
        verificationHash: `FX-${String(reparador.id).slice(0, 6).toUpperCase()}-VERIFIED`,
        badgeLevel: "Pro Certificado",
        isAssigned: true,
      }
    : paymentStatus === "CAPTURADO"
    ? {
        id: "pending-assignment",
        name: "Buscando especialista verificado...",
        photoUrl: UNASSIGNED_TECH_AVATAR,
        rating: 5.0,
        completedJobs: 0,
        specialty: categorySlug,
        bio: "Tu solicitud fue publicada en la red de especialistas verificados de tu zona. Te notificaremos apenas un técnico la acepte.",
        responseMinutes: 8,
        verificationHash: "FX-RADAR-ACTIVE",
        badgeLevel: "Especialista",
        isAssigned: false,
      }
    : {
        id: "pending-payment",
        name: "Asignación sujeta a confirmación de pago",
        photoUrl: UNASSIGNED_TECH_AVATAR,
        rating: 5.0,
        completedJobs: 0,
        specialty: categorySlug,
        bio: "Completa la confirmación de tu pago en Wompi para publicar tu solicitud en la red de especialistas verificados.",
        responseMinutes: 8,
        verificationHash: "FX-AWAITING-PAYMENT",
        badgeLevel: "Especialista",
        isAssigned: false,
      };

  const rawRootCause = String(
    rawOrder.diagnosticoCausaRaiz || "Diagnóstico registrado en el sistema"
  );
  // Si guardamos "Título || Causa raíz" en diagnosticoCausaRaiz, lo separamos limpiamente
  const [parsedTitle, parsedCause] = rawRootCause.includes(" || ")
    ? rawRootCause.split(" || ", 2)
    : [rawRootCause, rawRootCause];

  const metodoDiag =
    rawOrder.metodoDiagnostico === "CASO_PREDEFINIDO"
      ? "Caso_Predefinido"
      : "Analisis_IA";

  const metodoPagoDb = (rawOrder.metodoPago || "TARJETA") as DbPaymentMethod;

  return {
    id: String(rawOrder.id),
    orderNumber: String(rawOrder.numeroOrden || rawOrder.id),
    category: categorySlug,
    status: uiStatus,
    dbStatus,
    paymentStatus,
    diagnosis: {
      id: String(rawOrder.tipoFallaId || `diag-${rawOrder.id}`),
      title: parsedTitle,
      category: categorySlug,
      confidenceScore: 94,
      confidenceLevel: "high",
      pricingType: "fixed",
      severity: "alta",
      rootCause: parsedCause,
      suggestedFix: String(rawOrder.solucionPropuesta || "Intervención técnica especializada en sitio."),
      requiredMaterials: ["Kit de herramientas certificadas", "Insumos de seguridad"],
      estimatedHours: 1.5,
      priceFixed: costoManoObraEstimado,
      method: metodoDiag,
      ...(rawOrder.archivoMultimediaUrl
        ? { thumbnailUrl: String(rawOrder.archivoMultimediaUrl) }
        : {}),
    },
    technician,
    urgencyType: rawOrder.modalidad === "PROGRAMADA" ? "scheduled" : "immediate",
    ...(rawOrder.fechaProgramada
      ? {
          scheduledDate:
            rawOrder.fechaProgramada instanceof Date
              ? rawOrder.fechaProgramada.toISOString().split("T")[0]
              : String(rawOrder.fechaProgramada),
        }
      : {}),
    ...(rawOrder.franjaHoraria ? { scheduledTimeSlot: String(rawOrder.franjaHoraria) } : {}),
    address: String(rawOrder.direccionServicio),
    ...(rawOrder.notasAcceso ? { apartmentReference: String(rawOrder.notasAcceso) } : {}),
    otpCode: String(rawOrder.codigoOtp || "0000"),
    paymentMethod: mapDbPaymentMethodToUi(metodoPagoDb),
    pricing: {
      baseInspection: costoVisita,
      laborEstimate: costoManoObraEstimado,
      warrantyProtection: costoGarantiaFixicare,
      discount: montoDescuento,
      extraCost: 0,
      total: totalPreautorizado,
    },
    createdAt: formatOrderTime(rawOrder.fechaCreacion),
    assignedAt: rawOrder.fechaAsignacion
      ? rawOrder.fechaAsignacion instanceof Date
        ? rawOrder.fechaAsignacion.toISOString()
        : String(rawOrder.fechaAsignacion)
      : null,
  };
}

/**
 * Serializa una orden disponible para la vista de reparadores elegibles.
 * NUNCA incluye `codigoOtp`, `codigoOtpCierre`, correo, teléfono ni tokens del cliente.
 */
export function serializeAvailableOrderForRepairer(
  rawOrder: Record<string, any>
): SerializedAvailableOrderForRepairer {
  const categorySlug = (rawOrder.categoria?.slug || "electricidad") as CategorySlug;
  const categoryName = String(rawOrder.categoria?.nombre || categorySlug);

  const rawRootCause = String(rawOrder.diagnosticoCausaRaiz || "Solicitud de servicio técnico");
  const [parsedTitle, parsedCause] = rawRootCause.includes(" || ")
    ? rawRootCause.split(" || ", 2)
    : [rawRootCause, rawRootCause];

  return {
    id: String(rawOrder.id),
    orderNumber: String(rawOrder.numeroOrden || rawOrder.id),
    category: categorySlug,
    categoryName,
    issue: parsedTitle,
    rootCause: parsedCause,
    suggestedFix: String(rawOrder.solucionPropuesta || "Revisión y reparación en domicilio."),
    address: String(rawOrder.direccionServicio),
    accessNotes: rawOrder.notasAcceso ? String(rawOrder.notasAcceso) : null,
    distance: "1.2 km (En tu zona)",
    payout: toNumber(rawOrder.totalPreautorizado, 59.9),
    urgency: rawOrder.modalidad === "PROGRAMADA" ? "scheduled" : "immediate",
    scheduledDate: rawOrder.fechaProgramada
      ? rawOrder.fechaProgramada instanceof Date
        ? rawOrder.fechaProgramada.toISOString().split("T")[0]
        : String(rawOrder.fechaProgramada)
      : null,
    scheduledTimeSlot: rawOrder.franjaHoraria ? String(rawOrder.franjaHoraria) : null,
    clientDisplayName: maskClientDisplayName(rawOrder.cliente),
    createdAt: formatOrderTime(rawOrder.fechaCreacion),
    isLiveStoreOrder: true,
  };
}

export function mapDbStatusToRepairerUiStatus(
  status: DbOrderStatus
): "dispatched" | "at_door" | "in_progress" | "finished" {
  switch (status) {
    case "EN_CAMINO":
      return "dispatched";
    case "EN_SITIO":
      return "at_door";
    case "EN_TRABAJO":
      return "in_progress";
    case "FINALIZADO":
      return "finished";
    default:
      return "dispatched";
  }
}

/**
 * Serializa una orden asignada para la vista de trabajo en curso del reparador.
 * NUNCA incluye `codigoOtp` (código de inicio del cliente) ni datos privados del cliente.
 */
export function serializeAssignedOrderForRepairer(
  rawOrder: Record<string, any>
): SerializedAssignedOrderForRepairer {
  const base = serializeAvailableOrderForRepairer(rawOrder);
  const dbStatus = (rawOrder.estado || "EN_CAMINO") as DbOrderStatus;
  const paymentStatus = normalizeDbPaymentStatus(rawOrder.estadoPago);
  const status = mapDbStatusToRepairerUiStatus(dbStatus);

  return {
    ...base,
    dbStatus,
    paymentStatus,
    status,
    assignedAt: rawOrder.fechaAsignacion
      ? rawOrder.fechaAsignacion instanceof Date
        ? rawOrder.fechaAsignacion.toISOString()
        : String(rawOrder.fechaAsignacion)
      : null,
  };
}

function assertAuthenticatedActor(actor: OrderActor | null | undefined): asserts actor is OrderActor {
  if (!actor || !actor.id) {
    throw new OrderPolicyError("Debes iniciar sesión para realizar esta operación.", 401, "UNAUTHENTICATED");
  }
  if (actor.estado === "SUSPENDIDO" || actor.estado === "RECHAZADO") {
    throw new OrderPolicyError(
      "Tu cuenta no está habilitada para operar en la plataforma.",
      403,
      "ACCOUNT_DISABLED"
    );
  }
}

/**
 * Verifica que el actor sea un reparador con perfil profesional aprobado (`estado === "VERIFICADO"`)
 * y al menos una especialidad registrada. No confunde la verificación de correo con la aprobación
 * profesional (los reparadores se registran en estado `EN_REVISION` hasta que un administrador aprueba su expediente).
 */
export function assertEligibleRepairer(actor: OrderActor | null | undefined): {
  reparadorUsuarioId: string;
  perfilReparadorId: string;
  specialtyCategoryIds: string[];
  specialtySlugs: string[];
} {
  assertAuthenticatedActor(actor);

  if (actor.rol !== "REPARADOR") {
    throw new OrderPolicyError(
      "Solo los reparadores registrados pueden consultar o aceptar órdenes de servicio.",
      403,
      "FORBIDDEN_ROLE"
    );
  }

  if (actor.estado !== "VERIFICADO") {
    throw new OrderPolicyError(
      "Tu perfil profesional se encuentra pendiente de acreditación administrativa (EN_REVISION). Una vez aprobado tu expediente podrás recibir y aceptar órdenes reales.",
      403,
      "REPAIRER_NOT_APPROVED"
    );
  }

  const perfil = actor.perfilReparador;
  if (!perfil || !perfil.id) {
    throw new OrderPolicyError(
      "No se encontró un expediente profesional asociado a tu cuenta.",
      403,
      "MISSING_REPAIRER_PROFILE"
    );
  }

  const especialidades = Array.isArray(perfil.especialidades) ? perfil.especialidades : [];
  const specialtyCategoryIds = especialidades
    .map((e) => e?.categoria?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const specialtySlugs = especialidades
    .map((e) => e?.categoria?.slug)
    .filter((slug): slug is string => typeof slug === "string" && slug.length > 0);

  if (specialtyCategoryIds.length === 0) {
    throw new OrderPolicyError(
      "Tu perfil profesional no tiene especialidades activas asignadas.",
      403,
      "NO_SPECIALTIES"
    );
  }

  return {
    reparadorUsuarioId: actor.id,
    perfilReparadorId: perfil.id,
    specialtyCategoryIds,
    specialtySlugs,
  };
}

const CLIENT_ORDER_INCLUDE = {
  categoria: {
    select: {
      id: true,
      slug: true,
      nombre: true,
    },
  },
  reparador: {
    select: {
      id: true,
      nombreUsuario: true,
      perfilReparador: {
        select: {
          id: true,
          nombres: true,
          apellidos: true,
          calificacionPromedio: true,
          totalTrabajosCompletados: true,
        },
      },
    },
  },
} as const satisfies Prisma.OrdenServicioInclude;

// Datos mínimos que ve un reparador. Excluye codigoOtp, correo, teléfono y datos privados.
const REPAIRER_ORDER_SELECT = {
  id: true,
  numeroOrden: true,
  estado: true,
  estadoPago: true,
  reparadorId: true,
  categoriaId: true,
  direccionServicio: true,
  notasAcceso: true,
  modalidad: true,
  fechaProgramada: true,
  franjaHoraria: true,
  diagnosticoCausaRaiz: true,
  solucionPropuesta: true,
  totalPreautorizado: true,
  fechaCreacion: true,
  fechaAsignacion: true,
  categoria: {
    select: {
      id: true,
      slug: true,
      nombre: true,
    },
  },
  cliente: {
    select: {
      nombreUsuario: true,
      perfilCliente: {
        select: {
          nombres: true,
          apellidos: true,
        },
      },
    },
  },
} as const satisfies Prisma.OrdenServicioSelect;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Cliente habilitado para operar órdenes: rol CLIENTE y correo verificado (`VERIFICADO`).
 * Las cuentas suspendidas o rechazadas ya se bloquean en `assertAuthenticatedActor`.
 * La verificación del correo del cliente es independiente de la aprobación profesional.
 */
function assertEnabledClient(
  actor: OrderActor | null | undefined,
  forbiddenRoleMessage: string
): asserts actor is OrderActor {
  assertAuthenticatedActor(actor);

  if (actor.rol !== "CLIENTE") {
    throw new OrderPolicyError(forbiddenRoleMessage, 403, "FORBIDDEN_ROLE");
  }

  if (actor.estado !== "VERIFICADO") {
    throw new OrderPolicyError(
      "Debes verificar tu correo electrónico antes de solicitar o consultar servicios.",
      403,
      "CLIENT_NOT_VERIFIED"
    );
  }
}

/**
 * Repetición idempotente: solo se devuelve la orden existente si la solicitud actual
 * coincide con ella. Si la misma clave llega con datos distintos se rechaza (409).
 */
function replayExistingOrder(
  existing: Record<string, any>,
  requested: ValidatedOrderInput
): { order: SerializedClientOrder; idempotentReplay: true } {
  const differences = describeIdempotencyMismatch(existing, requested);
  if (differences.length > 0) {
    throw new OrderPolicyError(
      `La clave de idempotencia ya se usó con una solicitud distinta (difiere: ${differences.join(", ")}). Genera una solicitud nueva.`,
      409,
      "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"
    );
  }
  return { order: serializeOrderForClient(existing), idempotentReplay: true };
}

/**
 * Tras un error de unicidad (P2002) solo se traduce a un conflicto de negocio si el estado
 * real de la base lo confirma. Devuelve null si no se puede explicar el conflicto, para que
 * el llamador relance el error original (no se oculta un fallo inesperado).
 */
async function resolveUniqueConflict(
  db: PrismaClient,
  clienteId: string,
  requested: ValidatedOrderInput
): Promise<{ order: SerializedClientOrder; idempotentReplay: true } | null> {
  if (requested.idempotencyKey) {
    const sameKey = await db.ordenServicio.findUnique({
      where: {
        clienteId_claveIdempotencia: {
          clienteId,
          claveIdempotencia: requested.idempotencyKey,
        },
      },
      include: CLIENT_ORDER_INCLUDE,
    });
    if (sameKey) {
      return replayExistingOrder(sameKey, requested);
    }
  }

  const activeOrder = await db.ordenServicio.findFirst({
    where: {
      clienteId,
      estado: { in: [...ACTIVE_DB_ORDER_STATUSES] },
    },
    select: { numeroOrden: true },
  });
  if (activeOrder) {
    throw new OrderPolicyError(
      `Ya tienes una solicitud de servicio activa (${activeOrder.numeroOrden}). Finalízala o cancélala antes de crear una nueva.`,
      409,
      "ACTIVE_ORDER_EXISTS"
    );
  }

  return null;
}

/**
 * 3.A - Creación de orden (`POST /api/orders`)
 */
export async function createOrder(
  db: PrismaClient,
  actor: OrderActor | null | undefined,
  rawInput: unknown
): Promise<{ order: SerializedClientOrder; idempotentReplay: boolean }> {
  assertEnabledClient(actor, "Solo las cuentas de cliente pueden solicitar servicios.");
  const clienteId = actor.id;

  const validated = validateCreateOrderInput(rawInput);

  // 1. Misma clave del mismo cliente: devolver la orden solo si la solicitud coincide.
  if (validated.idempotencyKey) {
    const existingByKey = await db.ordenServicio.findUnique({
      where: {
        clienteId_claveIdempotencia: {
          clienteId,
          claveIdempotencia: validated.idempotencyKey,
        },
      },
      include: CLIENT_ORDER_INCLUDE,
    });

    if (existingByKey) {
      return replayExistingOrder(existingByKey, validated);
    }
  }

  // 2. La categoría procede del catálogo existente: no se crea ni se modifica nada aquí.
  const categoria = await db.categoriaServicio.findUnique({
    where: { slug: validated.categorySlug },
    select: { id: true, activo: true },
  });

  if (!categoria || !categoria.activo) {
    throw new OrderPolicyError(
      "La categoría de servicio seleccionada todavía no está disponible. Contacta al administrador.",
      503,
      "CATEGORY_UNAVAILABLE"
    );
  }

  // 3. Creación + invariante de una orden activa por cliente dentro de una transacción.
  //    La garantía real la da el índice único parcial de PostgreSQL; el findFirst solo
  //    produce un mensaje temprano y no sustituye a la restricción.
  try {
    const result = await db.$transaction(async (tx) => {
      const existingActive = await tx.ordenServicio.findFirst({
        where: {
          clienteId,
          estado: { in: [...ACTIVE_DB_ORDER_STATUSES] },
        },
        include: CLIENT_ORDER_INCLUDE,
        orderBy: { fechaCreacion: "desc" },
      });

      if (existingActive) {
        if (
          validated.idempotencyKey &&
          existingActive.claveIdempotencia === validated.idempotencyKey
        ) {
          return { record: existingActive, replay: true as const };
        }
        throw new OrderPolicyError(
          `Ya tienes una solicitud de servicio activa (${existingActive.numeroOrden}). Finalízala o cancélala antes de crear una nueva.`,
          409,
          "ACTIVE_ORDER_EXISTS"
        );
      }

      const created = await tx.ordenServicio.create({
        data: {
          numeroOrden: generateOrderNumber(),
          claveIdempotencia: validated.idempotencyKey,
          clienteId,
          reparadorId: null,
          categoriaId: categoria.id,
          direccionServicio: validated.address,
          latitud: validated.latitude,
          longitud: validated.longitude,
          notasAcceso: validated.accessNotes,
          modalidad: validated.modalidad,
          fechaProgramada: validated.scheduledDate,
          franjaHoraria: validated.scheduledTimeSlot,
          metodoDiagnostico: validated.metodoDiagnostico,
          tipoFallaId: null,
          diagnosticoCausaRaiz: buildStoredDiagnosis(
            validated.diagnosisTitle,
            validated.diagnosisRootCause
          ),
          solucionPropuesta: validated.diagnosisSuggestedFix,
          archivoMultimediaUrl: validated.mediaUrl,
          codigoOtp: generateOrderOtp(),
          costoVisita: validated.pricing.costoVisita,
          costoManoObraEstimado: validated.pricing.costoManoObraEstimado,
          costoGarantiaFixicare: validated.pricing.costoGarantiaFixicare,
          montoDescuento: validated.pricing.montoDescuento,
          totalPreautorizado: validated.pricing.totalPreautorizado,
          metodoPago: validated.metodoPago,
          estadoPago: "PENDIENTE",
          pasarelaHoldId: null,
          estado: "BUSCANDO",
        },
        include: CLIENT_ORDER_INCLUDE,
      });

      await tx.ordenTrazabilidad.create({
        data: {
          ordenId: created.id,
          estadoAnterior: null,
          estadoNuevo: "BUSCANDO",
          cambiadoPorUsuarioId: clienteId,
          rolOperador: "CLIENTE",
          motivoCambio:
            "Solicitud de servicio registrada; pendiente de confirmación de pago en Wompi.",
        },
      });

      return { record: created, replay: false as const };
    });

    if (result.replay) {
      return replayExistingOrder(result.record, validated);
    }

    return {
      order: serializeOrderForClient(result.record),
      idempotentReplay: false,
    };
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      const resolved = await resolveUniqueConflict(db, clienteId, validated);
      if (resolved) {
        return resolved;
      }
    }
    throw error;
  }
}

/**
 * 3.B - Consulta de órdenes disponibles para reparador (`GET /api/orders/available`)
 */
export async function listAvailableOrders(
  db: PrismaClient,
  actor: OrderActor | null | undefined
): Promise<{
  orders: SerializedAvailableOrderForRepairer[];
  specialtySlugs: string[];
}> {
  const { specialtyCategoryIds, specialtySlugs } = assertEligibleRepairer(actor);

  const rawOrders = await db.ordenServicio.findMany({
    where: {
      estado: "BUSCANDO",
      estadoPago: "CAPTURADO",
      reparadorId: null,
      categoriaId: { in: specialtyCategoryIds },
    },
    select: REPAIRER_ORDER_SELECT,
    orderBy: {
      fechaCreacion: "desc",
    },
    take: 25,
  });

  return {
    orders: rawOrders.map((o) => serializeAvailableOrderForRepairer(o)),
    specialtySlugs,
  };
}

/**
 * 3.C - Aceptación atómica por reparador (`POST /api/orders/[id]/accept`)
 *
 * La exclusividad se apoya en un UPDATE condicional (estado BUSCANDO, sin reparador y
 * categoría autorizada): PostgreSQL serializa las escrituras sobre la fila y solo una
 * llega a `count === 1`. Requiere prueba de integración para confirmarse.
 */
export async function acceptOrder(
  db: PrismaClient,
  actor: OrderActor | null | undefined,
  orderId: unknown
): Promise<{
  order: SerializedAvailableOrderForRepairer & { status: "dispatched" };
  idempotentReplay: boolean;
}> {
  if (!isValidUuid(orderId)) {
    throw new OrderPolicyError("El identificador de la orden no es un UUID válido.", 400, "INVALID_ORDER_ID");
  }

  const cleanOrderId = orderId.trim();
  const { reparadorUsuarioId, specialtyCategoryIds } = assertEligibleRepairer(actor);

  const now = new Date();

  const txResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.ordenServicio.updateMany({
      where: {
        id: cleanOrderId,
        estado: "BUSCANDO",
        estadoPago: "CAPTURADO",
        reparadorId: null,
        categoriaId: { in: specialtyCategoryIds },
      },
      data: {
        reparadorId: reparadorUsuarioId,
        estado: "EN_CAMINO",
        fechaAsignacion: now,
        fechaInicioViaje: now,
      },
    });

    if (updateResult.count === 1) {
      await tx.ordenTrazabilidad.create({
        data: {
          ordenId: cleanOrderId,
          estadoAnterior: "BUSCANDO",
          estadoNuevo: "EN_CAMINO",
          cambiadoPorUsuarioId: reparadorUsuarioId,
          rolOperador: "REPARADOR",
          motivoCambio: "Solicitud aceptada por especialista verificado; unidad en camino.",
        },
      });

      const updatedOrder = await tx.ordenServicio.findUnique({
        where: { id: cleanOrderId },
        select: REPAIRER_ORDER_SELECT,
      });

      if (!updatedOrder) {
        // Se revierte la transacción: no puede quedar asignación sin lectura coherente.
        throw new OrderPolicyError(
          "No fue posible recuperar la orden asignada.",
          500,
          "ORDER_READBACK_FAILED"
        );
      }

      return { record: updatedOrder, idempotentReplay: false };
    }

    // count === 0: se determina la causa sin modificar la fila.
    const existingOrder = await tx.ordenServicio.findUnique({
      where: { id: cleanOrderId },
      select: REPAIRER_ORDER_SELECT,
    });

    if (!existingOrder) {
      throw new OrderPolicyError("La orden de servicio solicitada no existe.", 404, "ORDER_NOT_FOUND");
    }

    // Repetición idempotente por el mismo reparador que ya la ganó
    if (existingOrder.reparadorId === reparadorUsuarioId) {
      return { record: existingOrder, idempotentReplay: true };
    }

    if (!specialtyCategoryIds.includes(existingOrder.categoriaId)) {
      throw new OrderPolicyError(
        "No tienes acreditada la especialidad requerida para aceptar esta solicitud.",
        403,
        "SPECIALTY_MISMATCH"
      );
    }

    if (existingOrder.estadoPago !== "CAPTURADO") {
      throw new OrderPolicyError(
        "Esta solicitud aún no cuenta con confirmación de pago verificado y no puede ser aceptada.",
        409,
        "PAYMENT_NOT_CAPTURED"
      );
    }

    throw new OrderPolicyError(
      "Esta solicitud acaba de ser aceptada por otro especialista o ya no se encuentra disponible.",
      409,
      "ORDER_ALREADY_TAKEN"
    );
  });

  return {
    order: {
      ...serializeAvailableOrderForRepairer(txResult.record),
      status: "dispatched",
    },
    idempotentReplay: txResult.idempotentReplay,
  };
}

function parseOtpInput(raw: unknown): string {
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    const candidate = record.otpCode ?? record.otp ?? record.code;
    if (typeof candidate === "string") {
      return candidate.trim();
    }
  }
  return "";
}

/**
 * Valida el código OTP presentado por el cliente en sitio y transiciona la orden a EN_TRABAJO.
 * Protege contra fuerza bruta, reutilización de códigos, concurrencia y acceso cruzado entre profesionales.
 */
export async function verifyOrderOtp(
  db: PrismaClient,
  actor: OrderActor | null | undefined,
  orderId: unknown,
  rawInput: unknown
): Promise<{
  order: SerializedAssignedOrderForRepairer & { status: "in_progress" };
  idempotentReplay: boolean;
}> {
  if (!isValidUuid(orderId)) {
    throw new OrderPolicyError("El identificador de la orden no es un UUID válido.", 400, "INVALID_ORDER_ID");
  }

  const cleanOrderId = (orderId as string).trim();
  const { reparadorUsuarioId } = assertEligibleRepairer(actor);

  const cleanOtp = parseOtpInput(rawInput);
  if (!isValidOrderOtpFormat(cleanOtp)) {
    throw new OrderPolicyError(
      "El código de verificación debe contener exactamente 4 dígitos numéricos.",
      400,
      "INVALID_OTP_FORMAT"
    );
  }

  const now = new Date();

  // 1. Obtener orden para control de estado, pertenencia y bloqueo
  const order = await db.ordenServicio.findUnique({
    where: { id: cleanOrderId },
    select: {
      id: true,
      estado: true,
      estadoPago: true,
      reparadorId: true,
      codigoOtp: true,
      otpValidado: true,
      intentosFallidosOtp: true,
      otpBloqueadoHasta: true,
    },
  });

  if (!order) {
    throw new OrderPolicyError("No se encontró la orden indicada.", 404, "ORDER_NOT_FOUND");
  }

  // 2. Control de pertenencia: solo el profesional asignado puede validar el código
  if (order.reparadorId !== reparadorUsuarioId) {
    throw new OrderPolicyError(
      "No estás autorizado para validar el código de una orden asignada a otro profesional.",
      403,
      "FORBIDDEN_ORDER"
    );
  }

  // 3. Bloqueo temporal por intentos fallidos excesivos (comprobado antes de validar código)
  if (order.otpBloqueadoHasta && order.otpBloqueadoHasta.getTime() > now.getTime()) {
    const waitMinutes = Math.ceil((order.otpBloqueadoHasta.getTime() - now.getTime()) / 60000);
    throw new OrderPolicyError(
      `Validación de código bloqueada por exceso de intentos fallidos. Intenta nuevamente en ${waitMinutes} minutos.`,
      429,
      "OTP_ATTEMPTS_EXCEEDED"
    );
  }

  // 4. Si el código ya fue validado previamente (código de un solo uso)
  if (order.otpValidado) {
    if (order.estado === "EN_TRABAJO" && order.codigoOtp === cleanOtp) {
      const updatedOrder = await db.ordenServicio.findUnique({
        where: { id: cleanOrderId },
        select: REPAIRER_ORDER_SELECT,
      });
      if (!updatedOrder) {
        throw new OrderPolicyError("No fue posible recuperar la orden.", 500, "ORDER_READBACK_FAILED");
      }
      return {
        order: {
          ...serializeAssignedOrderForRepairer(updatedOrder),
          status: "in_progress" as const,
        },
        idempotentReplay: true,
      };
    }

    throw new OrderPolicyError(
      "El código de verificación de esta orden ya fue validado y consumido.",
      409,
      "OTP_ALREADY_CONSUMED"
    );
  }

  // 5. Verificar que el estado actual admita el inicio del trabajo
  if (order.estado !== "EN_CAMINO" && order.estado !== "EN_SITIO") {
    throw new OrderPolicyError(
      `No se puede validar el código para una orden en estado ${order.estado}. La orden debe estar EN_CAMINO o EN_SITIO.`,
      409,
      "INVALID_ORDER_STATE"
    );
  }

  // 5.B Suspensión diferenciada ante fondos revocados/no capturados en pasarela:
  // Si la orden está EN_CAMINO o EN_SITIO y el pago fue anulado (VOIDED -> FALLIDO) o no está CAPTURADO,
  // se impide iniciar labores. (Si ya estaba EN_TRABAJO, la rama anterior preserva el cierre controlado).
  if (order.estadoPago !== "CAPTURADO") {
    throw new OrderPolicyError(
      "El pago de esta orden fue anulado o revocado por la pasarela. Se ha suspendido el inicio del servicio; contacta a soporte.",
      409,
      "PAYMENT_REVOKED_BY_GATEWAY"
    );
  }

  // 6. Comprobar coincidencia exacta con el código auténtico
  if (order.codigoOtp !== cleanOtp) {
    const MAX_ATTEMPTS = 5;

    // Actualización atómica en base de datos fuera de la transacción de éxito:
    // Evita pérdida de incrementos por rollback ante la excepción siguiente.
    const updated = await db.ordenServicio.update({
      where: { id: cleanOrderId },
      data: {
        intentosFallidosOtp: { increment: 1 },
      },
      select: {
        intentosFallidosOtp: true,
        otpBloqueadoHasta: true,
      },
    });

    const isBlocked = (updated.intentosFallidosOtp ?? 0) >= MAX_ATTEMPTS;
    let lockUntil = updated.otpBloqueadoHasta;

    if (isBlocked && (!lockUntil || lockUntil.getTime() <= now.getTime())) {
      lockUntil = new Date(now.getTime() + 15 * 60 * 1000);
      await db.ordenServicio.update({
        where: { id: cleanOrderId },
        data: {
          otpBloqueadoHasta: lockUntil,
        },
      });
    }

    throw new OrderPolicyError(
      isBlocked
        ? "Has superado el número máximo de intentos fallidos. El código ha sido bloqueado por 15 minutos."
        : "El código de verificación ingresado es incorrecto.",
      400,
      "INVALID_OTP_CODE"
    );
  }

  // 7. Código auténtico: ejecutar la transición atómica y registrar trazabilidad
  return await db.$transaction(async (tx) => {
    const updateResult = await tx.ordenServicio.updateMany({
      where: {
        id: cleanOrderId,
        reparadorId: reparadorUsuarioId,
        otpValidado: false,
        estadoPago: "CAPTURADO",
        estado: { in: ["EN_CAMINO", "EN_SITIO"] },
      },
      data: {
        estado: "EN_TRABAJO",
        otpValidado: true,
        fechaInicioTrabajo: now,
        intentosFallidosOtp: 0,
        otpBloqueadoHasta: null,
      },
    });

    if (updateResult.count !== 1) {
      // Re-comprobar si una operación concurrente idéntica ya realizó la transición
      const checkOrder = await tx.ordenServicio.findUnique({
        where: { id: cleanOrderId },
        select: { estado: true, estadoPago: true, otpValidado: true, codigoOtp: true },
      });
      if (checkOrder?.otpValidado && checkOrder?.estado === "EN_TRABAJO" && checkOrder?.codigoOtp === cleanOtp) {
        const fresh = await tx.ordenServicio.findUnique({
          where: { id: cleanOrderId },
          select: REPAIRER_ORDER_SELECT,
        });
        return {
          order: {
            ...serializeAssignedOrderForRepairer(fresh!),
            status: "in_progress" as const,
          },
          idempotentReplay: true,
        };
      }

      if (checkOrder && checkOrder.estado !== "EN_TRABAJO" && checkOrder.estadoPago !== "CAPTURADO") {
        throw new OrderPolicyError(
          "El pago de esta orden fue anulado o revocado por la pasarela. Se ha suspendido el inicio del servicio; contacta a soporte.",
          409,
          "PAYMENT_REVOKED_BY_GATEWAY"
        );
      }

      throw new OrderPolicyError(
        "La orden ya fue modificada por otra operación concurrente. Reintenta.",
        409,
        "ORDER_CONCURRENT_UPDATE"
      );
    }

    // 8. Trazabilidad inmutable
    await tx.ordenTrazabilidad.create({
      data: {
        ordenId: cleanOrderId,
        estadoAnterior: order.estado,
        estadoNuevo: "EN_TRABAJO",
        cambiadoPorUsuarioId: reparadorUsuarioId,
        rolOperador: "REPARADOR",
        motivoCambio: "Código de verificación presencial validado con éxito. Inicio formal de labores en sitio.",
      },
    });

    // 9. Lectura consistente para retorno
    const freshOrder = await tx.ordenServicio.findUnique({
      where: { id: cleanOrderId },
      select: REPAIRER_ORDER_SELECT,
    });

    if (!freshOrder) {
      throw new OrderPolicyError("No fue posible recuperar la orden actualizada.", 500, "ORDER_READBACK_FAILED");
    }

    return {
      order: {
        ...serializeAssignedOrderForRepairer(freshOrder),
        status: "in_progress" as const,
      },
      idempotentReplay: false,
    };
  });
}

/**
 * 3.E - Consulta de órdenes asignadas activas del reparador (`GET /api/orders/assigned`)
 *
 * Permite que el reparador recupere sus órdenes en curso (EN_CAMINO, EN_SITIO, EN_TRABAJO)
 * tras recargar la página o iniciar sesión en un dispositivo nuevo.
 * NUNCA expone el código OTP del cliente, correos ni datos privados.
 */
export async function listAssignedOrdersForRepairer(
  db: PrismaClient,
  actor: OrderActor | null | undefined
): Promise<{ orders: SerializedAssignedOrderForRepairer[] }> {
  const { reparadorUsuarioId } = assertEligibleRepairer(actor);

  const rawOrders = await db.ordenServicio.findMany({
    where: {
      reparadorId: reparadorUsuarioId,
      estado: {
        in: ["EN_CAMINO", "EN_SITIO", "EN_TRABAJO"],
      },
    },
    select: REPAIRER_ORDER_SELECT,
    orderBy: {
      fechaAsignacion: "desc",
    },
    take: 25,
  });

  return {
    orders: rawOrders.map((o) => serializeAssignedOrderForRepairer(o)),
  };
}

/**
 * 3.D - Consulta de orden activa del cliente (`GET /api/orders/active`)
 */
export async function getActiveOrderForClient(
  db: PrismaClient,
  actor: OrderActor | null | undefined
): Promise<{ order: SerializedClientOrder | null }> {
  assertEnabledClient(actor, "Solo los clientes pueden consultar su orden de servicio activa.");

  const activeOrder = await db.ordenServicio.findFirst({
    where: {
      clienteId: actor.id,
      estado: { in: [...ACTIVE_DB_ORDER_STATUSES] },
    },
    include: CLIENT_ORDER_INCLUDE,
    orderBy: {
      fechaCreacion: "desc",
    },
  });

  if (!activeOrder) {
    return { order: null };
  }

  return {
    order: serializeOrderForClient(activeOrder),
  };
}

function parseApprovalInput(raw: unknown): { documentIds: string[]; observaciones: string } {
  if (!raw || typeof raw !== "object") {
    throw new OrderPolicyError(
      "Indica los documentos revisados (documentIds) para aprobar al reparador.",
      400,
      "INVALID_PAYLOAD"
    );
  }

  const body = raw as Record<string, unknown>;
  const ids = body.documentIds;

  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20) {
    throw new OrderPolicyError(
      "documentIds debe contener entre 1 y 20 identificadores de documentos revisados.",
      400,
      "INVALID_DOCUMENT_IDS"
    );
  }

  const clean = ids.map((id) => (typeof id === "string" ? id.trim() : ""));
  if (!clean.every((id) => isValidUuid(id)) || new Set(clean).size !== clean.length) {
    throw new OrderPolicyError(
      "documentIds contiene identificadores inválidos o repetidos.",
      400,
      "INVALID_DOCUMENT_IDS"
    );
  }

  const observaciones = typeof body.observaciones === "string" ? body.observaciones.trim() : "";
  if (observaciones.length > 500) {
    throw new OrderPolicyError(
      "Las observaciones no pueden superar los 500 caracteres.",
      400,
      "INVALID_OBSERVATIONS"
    );
  }

  return { documentIds: clean, observaciones };
}

/**
 * Aprobación profesional (`PATCH /api/admin/repairers/[id]/approve`).
 *
 * El administrador debe indicar EXPLÍCITAMENTE los documentos que revisó y aprobó
 * (`documentIds`). No se aprueban documentos no indicados, y el usuario solo pasa a
 * VERIFICADO si, tras la revisión, no queda ningún documento PENDIENTE y existe al menos
 * uno aprobado y vigente. Es independiente de la verificación de correo de un cliente.
 *
 * LIMITACIÓN: `DocumentoReparador` no tiene columnas de revisor ni fecha de revisión.
 * Como respaldo mínimo se registra quién y cuándo aprobó en `observacionesAdmin`. Un
 * registro estructurado requeriría una migración (decisión pendiente). Tampoco existe una
 * interfaz administrativa para revisar documentos: hoy solo hay esta ruta.
 */
export async function approveRepairerProfile(
  db: PrismaClient,
  actor: OrderActor | null | undefined,
  targetUserId: unknown,
  rawInput: unknown
): Promise<{
  userId: string;
  estado: "VERIFICADO";
  approvedDocumentIds: string[];
  approvedDocumentsCount: number;
}> {
  assertAuthenticatedActor(actor);

  if (actor.rol !== "ADMINISTRADOR") {
    throw new OrderPolicyError(
      "Solo un administrador puede aprobar expedientes profesionales de reparadores.",
      403,
      "FORBIDDEN_ROLE"
    );
  }

  if (!isValidUuid(targetUserId)) {
    throw new OrderPolicyError("El identificador del reparador no es un UUID válido.", 400, "INVALID_USER_ID");
  }

  const cleanUserId = targetUserId.trim();
  const { documentIds, observaciones } = parseApprovalInput(rawInput);
  const adminId = actor.id;
  const now = new Date();

  return await db.$transaction(async (tx) => {
    const targetUser = await tx.usuario.findUnique({
      where: { id: cleanUserId },
      include: {
        perfilReparador: {
          include: {
            especialidades: true,
            documentos: true,
          },
        },
      },
    });

    if (!targetUser || targetUser.rol !== "REPARADOR" || !targetUser.perfilReparador) {
      throw new OrderPolicyError(
        "No se encontró un perfil de reparador registrado para el usuario indicado.",
        404,
        "REPAIRER_NOT_FOUND"
      );
    }

    if (targetUser.estado !== "EN_REVISION") {
      throw new OrderPolicyError(
        "Solo se pueden aprobar reparadores cuya cuenta esté en revisión (EN_REVISION).",
        409,
        "REPAIRER_NOT_IN_REVIEW"
      );
    }

    const perfil = targetUser.perfilReparador;

    if (perfil.especialidades.length === 0) {
      throw new OrderPolicyError(
        "El reparador no puede ser aprobado sin al menos una especialidad registrada.",
        400,
        "MISSING_SPECIALTIES"
      );
    }

    if (perfil.documentos.length === 0) {
      throw new OrderPolicyError(
        "El reparador no tiene documentos de acreditación para revisar.",
        409,
        "NO_DOCUMENTS"
      );
    }

    const documentsById = new Map(perfil.documentos.map((doc) => [doc.id, doc]));

    for (const documentId of documentIds) {
      const doc = documentsById.get(documentId);
      if (!doc) {
        throw new OrderPolicyError(
          "Alguno de los documentos indicados no pertenece al expediente de este reparador.",
          400,
          "DOCUMENT_NOT_OWNED"
        );
      }
      if (doc.estado !== "PENDIENTE" && doc.estado !== "APROBADO") {
        throw new OrderPolicyError(
          "Alguno de los documentos indicados fue rechazado o está vencido y no puede aprobarse.",
          409,
          "DOCUMENT_NOT_REVIEWABLE"
        );
      }
      if (doc.fechaExpiracion && doc.fechaExpiracion.getTime() <= now.getTime()) {
        throw new OrderPolicyError(
          "Alguno de los documentos indicados está vencido.",
          409,
          "DOCUMENT_EXPIRED"
        );
      }
    }

    const reviewed = new Set(documentIds);
    const stillPending = perfil.documentos.filter(
      (doc) => doc.estado === "PENDIENTE" && !reviewed.has(doc.id)
    );
    if (stillPending.length > 0) {
      throw new OrderPolicyError(
        "Quedan documentos pendientes sin revisión explícita; no se puede aprobar el perfil.",
        409,
        "DOCUMENTS_PENDING_REVIEW"
      );
    }

    const toApprove = documentIds.filter((id) => documentsById.get(id)?.estado === "PENDIENTE");

    if (toApprove.length > 0) {
      const note = `Aprobado por administrador ${adminId} el ${now.toISOString()}${
        observaciones ? `: ${observaciones}` : ""
      }`;

      const docsUpdate = await tx.documentoReparador.updateMany({
        where: {
          id: { in: toApprove },
          reparadorId: perfil.id,
          estado: "PENDIENTE",
        },
        data: {
          estado: "APROBADO",
          observacionesAdmin: note,
        },
      });

      if (docsUpdate.count !== toApprove.length) {
        throw new OrderPolicyError(
          "El estado de los documentos cambió durante la revisión. Reintenta la operación.",
          409,
          "DOCUMENT_STATE_CHANGED"
        );
      }
    }

    const userUpdate = await tx.usuario.updateMany({
      where: { id: cleanUserId, rol: "REPARADOR", estado: "EN_REVISION" },
      data: { estado: "VERIFICADO" },
    });

    if (userUpdate.count !== 1) {
      throw new OrderPolicyError(
        "El estado de la cuenta cambió durante la aprobación. Reintenta la operación.",
        409,
        "REPAIRER_STATE_CHANGED"
      );
    }

    return {
      userId: cleanUserId,
      estado: "VERIFICADO" as const,
      approvedDocumentIds: documentIds,
      approvedDocumentsCount: documentIds.length,
    };
  });
}

export { payOrderWithFixiWallet } from "./walletService";

