import { randomBytes, randomInt } from "node:crypto";
import { AI_DIAGNOSIS_PRESETS } from "../data/aiPresets";
import { SERVICE_CATEGORIES } from "../data/services";
import { computeOrderPricing } from "./pricing";

export type CategorySlug =
  | "electricidad"
  | "plomeria"
  | "cerrajeria"
  | "carpinteria"
  | "herreria"
  | "pintura";

export type UiPaymentMethod = "card" | "apple_pay" | "cash_pos" | "fixi_wallet";
export type DbPaymentMethod = "TARJETA" | "FIXI_WALLET" | "APPLE_PAY" | "CASH_POS";

export type UiOrderStatus =
  | "idle"
  | "diagnosing"
  | "quoted"
  | "finding_tech"
  | "on_the_way"
  | "in_progress"
  | "extra_cost_pending"
  | "completed"
  | "cancelled";

export type DbOrderStatus =
  | "BUSCANDO"
  | "EN_CAMINO"
  | "EN_SITIO"
  | "EN_TRABAJO"
  | "FINALIZADO"
  | "CANCELADO";

// Las reglas de importes viven en ./pricing (compartidas con la interfaz).
export {
  BASE_INSPECTION_FEE,
  FIXICARE_WARRANTY_FEE,
  PROMO_DISCOUNTS as VALID_PROMO_DISCOUNTS,
} from "./pricing";

export const ACTIVE_DB_ORDER_STATUSES: readonly DbOrderStatus[] = [
  "BUSCANDO",
  "EN_CAMINO",
  "EN_SITIO",
  "EN_TRABAJO",
] as const;

export const CATEGORY_SLUG_SET = new Set<string>(
  SERVICE_CATEGORIES.map((c) => c.id)
);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OrderPolicyError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "OrderPolicyError";
    this.status = status;
    this.code = code;
  }
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

/**
 * Mapeo explícito y bidireccional entre estados de BD (`EstadoOrden`) y UI (`OrderStatus`).
 * No se admiten estados arbitrarios.
 */
export function mapDbStatusToUiStatus(
  dbStatus: DbOrderStatus,
  hasPendingExtraCost = false
): UiOrderStatus {
  if (hasPendingExtraCost && (dbStatus === "EN_SITIO" || dbStatus === "EN_TRABAJO")) {
    return "extra_cost_pending";
  }

  switch (dbStatus) {
    case "BUSCANDO":
      return "finding_tech";
    case "EN_CAMINO":
    case "EN_SITIO":
      return "on_the_way";
    case "EN_TRABAJO":
      return "in_progress";
    case "FINALIZADO":
      return "completed";
    case "CANCELADO":
      return "cancelled";
    default: {
      const exhaustiveCheck: never = dbStatus;
      throw new OrderPolicyError(`Estado de orden desconocido: ${String(exhaustiveCheck)}`, 500);
    }
  }
}

export function mapUiPaymentMethodToDb(method: unknown): DbPaymentMethod {
  if (typeof method !== "string") {
    throw new OrderPolicyError("El método de pago es obligatorio.", 400, "INVALID_PAYMENT_METHOD");
  }

  switch (method.trim().toLowerCase()) {
    case "card":
    case "tarjeta":
      return "TARJETA";
    case "fixi_wallet":
      return "FIXI_WALLET";
    case "apple_pay":
      return "APPLE_PAY";
    case "cash_pos":
      return "CASH_POS";
    default:
      throw new OrderPolicyError(
        `Método de pago no soportado: "${method}".`,
        400,
        "INVALID_PAYMENT_METHOD"
      );
  }
}

export function mapDbPaymentMethodToUi(method: DbPaymentMethod): UiPaymentMethod {
  switch (method) {
    case "TARJETA":
      return "card";
    case "FIXI_WALLET":
      return "fixi_wallet";
    case "APPLE_PAY":
      return "apple_pay";
    case "CASH_POS":
      return "cash_pos";
    default: {
      const exhaustiveCheck: never = method;
      throw new OrderPolicyError(
        `Método de pago en BD desconocido: ${String(exhaustiveCheck)}`,
        500
      );
    }
  }
}

/**
 * Etapa 2 Fixi Wallet + Wompi Sandbox: se encuentran habilitados pagos con tarjeta ("TARJETA") y saldo interno ("FIXI_WALLET").
 * Rechaza en servidor métodos aún no implementados con HTTP 422 PAYMENT_METHOD_UNAVAILABLE.
 */
export function assertImplementedPaymentMethod(
  metodoPago: DbPaymentMethod
): asserts metodoPago is "TARJETA" | "FIXI_WALLET" {
  if (metodoPago !== "TARJETA" && metodoPago !== "FIXI_WALLET") {
    throw new OrderPolicyError(
      `El método de pago "${metodoPago}" aún no está disponible. En esta etapa solo se admite pago con tarjeta mediante Wompi o saldo interno Fixi Wallet.`,
      422,
      "PAYMENT_METHOD_UNAVAILABLE"
    );
  }
}

export function generateOrderNumber(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `FX-${yyyy}${mm}${dd}-${suffix}`;
}

export function generateOrderOtp(): string {
  // Genera un código criptográficamente aleatorio de 4 dígitos (0000 a 9999) con relleno de ceros
  return randomInt(0, 10000).toString().padStart(4, "0");
}

export function isValidOrderOtpFormat(code: unknown): code is string {
  return typeof code === "string" && /^\d{4}$/.test(code.trim());
}

export interface ValidatedOrderInput {
  categorySlug: CategorySlug;
  address: string;
  latitude: number | null;
  longitude: number | null;
  accessNotes: string | null;
  urgencyType: "immediate" | "scheduled";
  modalidad: "INMEDIATA" | "PROGRAMADA";
  scheduledDate: Date | null;
  scheduledTimeSlot: string | null;
  diagnosisPresetId: string | null;
  diagnosisTitle: string;
  diagnosisRootCause: string;
  diagnosisSuggestedFix: string;
  metodoDiagnostico: "ANALISIS_IA" | "CASO_PREDEFINIDO";
  mediaUrl: string | null;
  paymentMethodUi: UiPaymentMethod;
  metodoPago: DbPaymentMethod;
  promoCode: string | null;
  idempotencyKey: string | null;
  pricing: {
    costoVisita: number;
    costoManoObraEstimado: number;
    costoGarantiaFixicare: number;
    montoDescuento: number;
    totalPreautorizado: number;
  };
}

/**
 * Calcula los costos exclusivamente con reglas del servidor (lib/pricing.ts, la misma
 * fuente que usa la interfaz). Ignora cualquier monto, subtotal o descuento del navegador.
 */
export function calculateServerOrderPricing(params: {
  categorySlug: CategorySlug;
  diagnosisPresetId?: string | null;
  promoCode?: string | null;
}): {
  costoVisita: number;
  costoManoObraEstimado: number;
  costoGarantiaFixicare: number;
  montoDescuento: number;
  totalPreautorizado: number;
  normalizedPromoCode: string | null;
} {
  if (!CATEGORY_SLUG_SET.has(params.categorySlug)) {
    throw new OrderPolicyError(
      `Categoría de servicio inválida: "${params.categorySlug}".`,
      400,
      "INVALID_CATEGORY"
    );
  }

  const pricing = computeOrderPricing({
    category: params.categorySlug,
    presetId: params.diagnosisPresetId,
    promoCode: params.promoCode,
  });

  return {
    costoVisita: pricing.baseInspection,
    costoManoObraEstimado: pricing.laborEstimate,
    costoGarantiaFixicare: pricing.warrantyProtection,
    montoDescuento: pricing.discount,
    totalPreautorizado: pricing.total,
    normalizedPromoCode: pricing.promoCode,
  };
}

export function validateCreateOrderInput(raw: unknown): ValidatedOrderInput {
  if (!raw || typeof raw !== "object") {
    throw new OrderPolicyError("El cuerpo de la solicitud es inválido.", 400, "INVALID_PAYLOAD");
  }

  const body = raw as Record<string, unknown>;

  // 1. Categoría
  const rawCategory = typeof body.category === "string" ? body.category.trim().toLowerCase() : "";
  if (!CATEGORY_SLUG_SET.has(rawCategory)) {
    throw new OrderPolicyError(
      "Selecciona una categoría de servicio válida.",
      400,
      "INVALID_CATEGORY"
    );
  }
  const categorySlug = rawCategory as CategorySlug;

  // 2. Dirección
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (address.length < 5 || address.length > 255) {
    throw new OrderPolicyError(
      "La dirección del servicio debe tener entre 5 y 255 caracteres.",
      400,
      "INVALID_ADDRESS"
    );
  }

  // Coordenadas opcionales
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (body.latitude !== undefined && body.latitude !== null) {
    const lat = Number(body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new OrderPolicyError("La latitud es inválida.", 400, "INVALID_COORDINATES");
    }
    latitude = lat;
  }
  if (body.longitude !== undefined && body.longitude !== null) {
    const lng = Number(body.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new OrderPolicyError("La longitud es inválida.", 400, "INVALID_COORDINATES");
    }
    longitude = lng;
  }

  // Notas de acceso opcionales
  const accessNotesRaw = typeof body.apartmentReference === "string"
    ? body.apartmentReference.trim()
    : typeof body.accessNotes === "string"
    ? body.accessNotes.trim()
    : "";
  if (accessNotesRaw.length > 500) {
    throw new OrderPolicyError(
      "Las notas de acceso no pueden superar los 500 caracteres.",
      400,
      "INVALID_ACCESS_NOTES"
    );
  }
  const accessNotes = accessNotesRaw.length > 0 ? accessNotesRaw : null;

  // 3. Modalidad y programación
  const urgencyRaw = typeof body.urgencyType === "string" ? body.urgencyType.trim() : "immediate";
  if (urgencyRaw !== "immediate" && urgencyRaw !== "scheduled") {
    throw new OrderPolicyError(
      "La modalidad de urgencia debe ser 'immediate' o 'scheduled'.",
      400,
      "INVALID_URGENCY"
    );
  }
  const urgencyType = urgencyRaw;
  const modalidad = urgencyType === "immediate" ? "INMEDIATA" : "PROGRAMADA";

  let scheduledDate: Date | null = null;
  let scheduledTimeSlot: string | null = null;

  if (modalidad === "PROGRAMADA") {
    const rawDate = typeof body.scheduledDate === "string" ? body.scheduledDate.trim() : "";
    const rawSlot = typeof body.scheduledTimeSlot === "string" ? body.scheduledTimeSlot.trim() : "";

    if (!rawDate) {
      throw new OrderPolicyError(
        "La fecha programada es obligatoria para servicios agendados.",
        400,
        "MISSING_SCHEDULE_DATE"
      );
    }
    const parsedDate = new Date(rawDate);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new OrderPolicyError(
        "El formato de la fecha programada es inválido.",
        400,
        "INVALID_SCHEDULE_DATE"
      );
    }
    if (!rawSlot || rawSlot.length > 50) {
      throw new OrderPolicyError(
        "La franja horaria es obligatoria para servicios agendados (máx. 50 caracteres).",
        400,
        "INVALID_TIME_SLOT"
      );
    }
    scheduledDate = parsedDate;
    scheduledTimeSlot = rawSlot;
  }

  // 4. Diagnóstico
  const diagnosisObj =
    body.diagnosis && typeof body.diagnosis === "object"
      ? (body.diagnosis as Record<string, unknown>)
      : {};

  const diagnosisPresetIdRaw =
    typeof body.diagnosisPresetId === "string"
      ? body.diagnosisPresetId.trim()
      : typeof diagnosisObj.id === "string"
      ? diagnosisObj.id.trim()
      : "";

  const matchedPreset = diagnosisPresetIdRaw
    ? AI_DIAGNOSIS_PRESETS.find((p) => p.id === diagnosisPresetIdRaw)
    : undefined;

  const rawTitle =
    matchedPreset?.title ||
    (typeof diagnosisObj.title === "string" ? diagnosisObj.title.trim() : "") ||
    (typeof body.diagnosisTitle === "string" ? body.diagnosisTitle.trim() : "");

  const rawRootCause =
    matchedPreset?.rootCause ||
    (typeof diagnosisObj.rootCause === "string" ? diagnosisObj.rootCause.trim() : "") ||
    (typeof body.diagnosisRootCause === "string" ? body.diagnosisRootCause.trim() : "");

  const rawSuggestedFix =
    matchedPreset?.suggestedFix ||
    (typeof diagnosisObj.suggestedFix === "string" ? diagnosisObj.suggestedFix.trim() : "") ||
    (typeof body.diagnosisSuggestedFix === "string" ? body.diagnosisSuggestedFix.trim() : "");

  if (rawTitle.length < 3 || rawTitle.length > 300) {
    throw new OrderPolicyError(
      "El título del diagnóstico es obligatorio (entre 3 y 300 caracteres).",
      400,
      "INVALID_DIAGNOSIS"
    );
  }

  if (rawSuggestedFix.length < 3 || rawSuggestedFix.length > 2000) {
    throw new OrderPolicyError(
      "La solución propuesta del diagnóstico es obligatoria.",
      400,
      "INVALID_DIAGNOSIS"
    );
  }

  const diagnosisRootCause =
    rawRootCause.length > 0 ? rawRootCause.slice(0, 2000) : rawTitle;

  const metodoDiagnostico: "ANALISIS_IA" | "CASO_PREDEFINIDO" = matchedPreset
    ? (matchedPreset.method as string) === "Analisis_IA" ||
      (matchedPreset.method as string) === "Análisis_IA"
      ? "ANALISIS_IA"
      : "CASO_PREDEFINIDO"
    : diagnosisObj.method === "Caso_Predefinido"
    ? "CASO_PREDEFINIDO"
    : "ANALISIS_IA";

  const mediaUrlRaw =
    matchedPreset?.thumbnailUrl ||
    (typeof diagnosisObj.thumbnailUrl === "string" ? diagnosisObj.thumbnailUrl.trim() : "");
  const mediaUrl =
    mediaUrlRaw.length > 0 && mediaUrlRaw.length <= 500 ? mediaUrlRaw : null;

  // 5. Método de pago
  const metodoPago = mapUiPaymentMethodToDb(body.paymentMethod);
  assertImplementedPaymentMethod(metodoPago);
  const paymentMethodUi = mapDbPaymentMethodToUi(metodoPago);

  // 6. Clave de idempotencia opcional
  let idempotencyKey: string | null = null;
  if (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim().length > 0) {
    const cleanKey = body.idempotencyKey.trim();
    if (cleanKey.length < 8 || cleanKey.length > 100) {
      throw new OrderPolicyError(
        "La clave de idempotencia debe tener entre 8 y 100 caracteres.",
        400,
        "INVALID_IDEMPOTENCY_KEY"
      );
    }
    idempotencyKey = cleanKey;
  }

  // 7. Cálculo de precios en servidor
  const promoCodeInput = typeof body.promoCode === "string" ? body.promoCode : null;
  const pricingCalc = calculateServerOrderPricing({
    categorySlug,
    diagnosisPresetId: matchedPreset ? matchedPreset.id : null,
    promoCode: promoCodeInput,
  });

  return {
    categorySlug,
    address,
    latitude,
    longitude,
    accessNotes,
    urgencyType,
    modalidad,
    scheduledDate,
    scheduledTimeSlot,
    diagnosisPresetId: matchedPreset ? matchedPreset.id : null,
    diagnosisTitle: rawTitle,
    diagnosisRootCause,
    diagnosisSuggestedFix: rawSuggestedFix,
    metodoDiagnostico,
    mediaUrl,
    paymentMethodUi,
    metodoPago,
    promoCode: pricingCalc.normalizedPromoCode,
    idempotencyKey,
    pricing: {
      costoVisita: pricingCalc.costoVisita,
      costoManoObraEstimado: pricingCalc.costoManoObraEstimado,
      costoGarantiaFixicare: pricingCalc.costoGarantiaFixicare,
      montoDescuento: pricingCalc.montoDescuento,
      totalPreautorizado: pricingCalc.totalPreautorizado,
    },
  };
}

/** Formato en que se persiste el diagnóstico en `OrdenServicio.diagnosticoCausaRaiz`. */
export function buildStoredDiagnosis(title: string, rootCause: string): string {
  return `${title} || ${rootCause}`;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return null;
}

function toTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function sameCoordinate(stored: unknown, requested: number | null): boolean {
  const storedNumber = toFiniteNumber(stored);
  if (storedNumber === null || requested === null) return storedNumber === requested;
  // Decimal(10,7) en BD: se tolera el redondeo de la séptima cifra decimal.
  return Math.abs(storedNumber - requested) < 1e-6;
}

function sameMoney(stored: unknown, requested: number): boolean {
  const storedNumber = toFiniteNumber(stored);
  return storedNumber !== null && Math.round(storedNumber * 100) === Math.round(requested * 100);
}

/**
 * Compara una orden ya persistida con la solicitud validada y devuelve los NOMBRES de los
 * campos de negocio que difieren (lista vacía = misma solicitud). Los importes se comparan
 * contra el cálculo del servidor, nunca contra montos enviados por el navegador.
 */
export function describeIdempotencyMismatch(
  existing: Record<string, any>,
  requested: ValidatedOrderInput
): string[] {
  const differences: string[] = [];
  const check = (field: string, same: boolean) => {
    if (!same) differences.push(field);
  };

  check("categoria", existing.categoria?.slug === requested.categorySlug);
  check("direccion", existing.direccionServicio === requested.address);
  check("latitud", sameCoordinate(existing.latitud, requested.latitude));
  check("longitud", sameCoordinate(existing.longitud, requested.longitude));
  check("notasAcceso", (existing.notasAcceso ?? null) === requested.accessNotes);
  check("modalidad", existing.modalidad === requested.modalidad);
  check("fechaProgramada", toTimestamp(existing.fechaProgramada) === toTimestamp(requested.scheduledDate));
  check("franjaHoraria", (existing.franjaHoraria ?? null) === requested.scheduledTimeSlot);
  check("metodoDiagnostico", existing.metodoDiagnostico === requested.metodoDiagnostico);
  check(
    "diagnostico",
    existing.diagnosticoCausaRaiz ===
      buildStoredDiagnosis(requested.diagnosisTitle, requested.diagnosisRootCause)
  );
  check("solucionPropuesta", existing.solucionPropuesta === requested.diagnosisSuggestedFix);
  check("archivoMultimedia", (existing.archivoMultimediaUrl ?? null) === requested.mediaUrl);
  check("metodoPago", existing.metodoPago === requested.metodoPago);
  check("costoVisita", sameMoney(existing.costoVisita, requested.pricing.costoVisita));
  check("costoManoObra", sameMoney(existing.costoManoObraEstimado, requested.pricing.costoManoObraEstimado));
  check("costoGarantia", sameMoney(existing.costoGarantiaFixicare, requested.pricing.costoGarantiaFixicare));
  check("descuento", sameMoney(existing.montoDescuento, requested.pricing.montoDescuento));
  check("total", sameMoney(existing.totalPreautorizado, requested.pricing.totalPreautorizado));

  return differences;
}
