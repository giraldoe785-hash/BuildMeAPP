// Fuente única de verdad para el cálculo de importes de una solicitud.
//
// Este módulo NO depende de APIs de Node.js, por lo que lo comparten el servidor
// (lib/orderPolicy.ts) y los componentes de navegador (Wizard y modal de emergencia).
// El servidor siempre recalcula con estas reglas; nunca acepta totales del navegador.
//
// Reglas respaldadas por el código/catálogo existente:
//  - Visita técnica: 15.00 y garantía FixiCare: 4.90 (valores que ya mostraba el Wizard).
//  - Mano de obra:
//      * Caso predefinido con precio fijo  -> priceFixed del preset (data/aiPresets.ts).
//      * Caso predefinido con rango        -> priceRangeMin (lo que el Wizard ya mostraba).
//        Es un ESTIMADO de pre-autorización: no es una tarifa final.
//      * Sin caso predefinido (diagnóstico de IA o despacho de emergencia)
//                                          -> startingPrice de la categoría (data/services.ts).
//  - Cupones: FIXI2026 y PRIMERAVEZ descuentan 10.00 (reglas que ya existían en el store).
//
// DECISIONES COMERCIALES PENDIENTES (no se inventan tarifas):
//  - No existe una tarifa de emergencia documentada: se usa la tarifa base de la categoría.
//  - El precio propuesto por la IA no se persiste ni se firma en el servidor, por lo que no
//    puede usarse como base confiable del cobro.

import { AI_DIAGNOSIS_PRESETS } from "../data/aiPresets";
import { SERVICE_CATEGORIES } from "../data/services";

export const BASE_INSPECTION_FEE = 15.0;
export const FIXICARE_WARRANTY_FEE = 4.9;

export const PROMO_DISCOUNTS: Readonly<Record<string, number>> = {
  FIXI2026: 10.0,
  PRIMERAVEZ: 10.0,
};

export type LaborBasis = "preset_fixed" | "preset_range_min" | "category_base";

export interface OrderPricing {
  baseInspection: number;
  laborEstimate: number;
  warrantyProtection: number;
  discount: number;
  total: number;
  laborBasis: LaborBasis;
  /** true cuando la mano de obra no es una tarifa fija (rango o tarifa base de categoría). */
  isEstimate: boolean;
  rangeMin: number | null;
  rangeMax: number | null;
  /** Cupón válido normalizado, o null si no se envió o no es válido. */
  promoCode: string | null;
  /** Texto breve para mostrar al usuario cuando el importe es un estimado. */
  laborNote: string | null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizePromoCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const clean = code.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(PROMO_DISCOUNTS, clean) ? clean : null;
}

export function getPromoDiscount(code: string | null | undefined): number {
  const normalized = normalizePromoCode(code);
  return normalized ? PROMO_DISCOUNTS[normalized] : 0;
}

export function computeOrderPricing(input: {
  category: string;
  presetId?: string | null;
  promoCode?: string | null;
}): OrderPricing {
  const categoryDef = SERVICE_CATEGORIES.find((c) => c.id === input.category);
  if (!categoryDef) {
    throw new Error(`Categoría de servicio inválida: "${input.category}".`);
  }

  const preset = input.presetId
    ? AI_DIAGNOSIS_PRESETS.find((p) => p.id === input.presetId)
    : undefined;

  let laborEstimate: number;
  let laborBasis: LaborBasis;
  let rangeMin: number | null = null;
  let rangeMax: number | null = null;
  let laborNote: string | null = null;

  if (preset && typeof preset.priceFixed === "number") {
    laborEstimate = preset.priceFixed;
    laborBasis = "preset_fixed";
  } else if (preset && typeof preset.priceRangeMin === "number") {
    laborEstimate = preset.priceRangeMin;
    laborBasis = "preset_range_min";
    rangeMin = preset.priceRangeMin;
    rangeMax = typeof preset.priceRangeMax === "number" ? preset.priceRangeMax : null;
    laborNote =
      rangeMax !== null
        ? `Estimado: rango de $${rangeMin.toFixed(2)} a $${rangeMax.toFixed(2)} USD; se considera el mínimo del rango. No es una tarifa final.`
        : `Estimado: se considera el mínimo del rango ($${rangeMin.toFixed(2)} USD). No es una tarifa final.`;
  } else {
    laborEstimate = categoryDef.startingPrice;
    laborBasis = "category_base";
    laborNote = "Estimado: tarifa base de la categoría. No es una tarifa final.";
  }

  const discount = getPromoDiscount(input.promoCode);
  const total = round2(
    Math.max(0, BASE_INSPECTION_FEE + laborEstimate + FIXICARE_WARRANTY_FEE - discount)
  );

  return {
    baseInspection: round2(BASE_INSPECTION_FEE),
    laborEstimate: round2(laborEstimate),
    warrantyProtection: round2(FIXICARE_WARRANTY_FEE),
    discount: round2(discount),
    total,
    laborBasis,
    isEstimate: laborBasis !== "preset_fixed",
    rangeMin,
    rangeMax,
    promoCode: normalizePromoCode(input.promoCode),
    laborNote,
  };
}

// ============================================================================
// CONVERSIÓN MONETARIA CANÓNICA EN ENTEROS / BIGINT (STEP 2A - WOMPI COLOMBIA)
// ============================================================================
// Equivalencia del proyecto:
//   1 unidad del catálogo       = 1.000 COP        = 100.000 centavos COP
//   0.01 unidades del catálogo  =    10 COP        =   1.000 centavos COP
//   1 peso colombiano (1 COP)   =   100 centavos COP (unidad requerida por Wompi)
//
// Límite superior alineado con Decimal(10, 2) en PostgreSQL (máx. 99.999.999,99):
//   MAX_CANONICAL_COP_PESOS = 99_999_999n COP = 9_999_999_900n centavos Wompi.

export const COP_PESOS_PER_CATALOG_UNIT = 1_000n;
export const WOMPI_CENTS_PER_COP_PESO = 100n;
export const WOMPI_CENTS_PER_CATALOG_UNIT = 100_000n;
export const COP_PESOS_PER_CATALOG_HUNDREDTH = 10n;
export const WOMPI_CENTS_PER_CATALOG_HUNDREDTH = 1_000n;

export const MAX_CANONICAL_COP_PESOS = 99_999_999n;
export const MAX_WOMPI_AMOUNT_IN_CENTS =
  MAX_CANONICAL_COP_PESOS * WOMPI_CENTS_PER_COP_PESO; // 9_999_999_900n
export const MAX_CATALOG_UNIT_HUNDREDTHS =
  MAX_CANONICAL_COP_PESOS / COP_PESOS_PER_CATALOG_HUNDREDTH; // 9_999_999n (99.999,99 unidades)

export const BASE_INSPECTION_FEE_HUNDREDTHS = 1_500n; // 15.00 unidades -> 15.000 COP
export const FIXICARE_WARRANTY_FEE_HUNDREDTHS = 490n; // 4.90 unidades  ->  4.900 COP

export const PROMO_DISCOUNTS_HUNDREDTHS: Readonly<Record<string, bigint>> = {
  FIXI2026: 1_000n, // 10.00 unidades -> 10.000 COP
  PRIMERAVEZ: 1_000n,
};

export class MonetaryConversionError extends Error {
  code: string;

  constructor(message: string, code = "INVALID_MONETARY_VALUE") {
    super(message);
    this.name = "MonetaryConversionError";
    this.code = code;
  }
}

export interface CanonicalOrderPricing {
  baseInspectionCopPesos: bigint;
  laborEstimateCopPesos: bigint;
  warrantyProtectionCopPesos: bigint;
  discountCopPesos: bigint;
  totalCopPesos: bigint;
  baseInspectionWompiCents: bigint;
  laborEstimateWompiCents: bigint;
  warrantyProtectionWompiCents: bigint;
  discountWompiCents: bigint;
  totalWompiCents: bigint;
  formattedTotalCop: string;
  laborBasis: LaborBasis;
  isEstimate: boolean;
  rangeMinCopPesos: bigint | null;
  rangeMaxCopPesos: bigint | null;
  promoCode: string | null;
}

/**
 * Convierte un valor expresado en unidades del catálogo (ej. "49.90", 49.9, 35n)
 * a centésimas enteras de unidad del catálogo (ej. 4990n) sin usar parseFloat
 * ni multiplicaciones en coma flotante ni redondeos silenciosos.
 */
export function parseCatalogUnitsToHundredths(value: unknown): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new MonetaryConversionError(
        "El importe en unidades del catálogo no puede ser negativo.",
        "NEGATIVE_MONETARY_VALUE"
      );
    }
    const hundredths = value * 100n;
    if (hundredths > MAX_CATALOG_UNIT_HUNDREDTHS) {
      throw new MonetaryConversionError(
        "El importe supera el límite máximo permitido por el esquema Decimal(10,2).",
        "MONETARY_OVERFLOW"
      );
    }
    return hundredths;
  }

  let rawStr: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MonetaryConversionError(
        "El importe numérico debe ser un número finito.",
        "NON_FINITE_MONETARY_VALUE"
      );
    }
    if (Object.is(value, -0) || value < 0) {
      throw new MonetaryConversionError(
        "El importe en unidades del catálogo no puede ser negativo.",
        "NEGATIVE_MONETARY_VALUE"
      );
    }
    rawStr = value.toString();
    if (/[eE]/.test(rawStr)) {
      throw new MonetaryConversionError(
        "No se admite notación exponencial en importes monetarios.",
        "INVALID_MONETARY_FORMAT"
      );
    }
  } else if (typeof value === "string") {
    rawStr = value.trim();
  } else {
    throw new MonetaryConversionError(
      "Tipo de dato inválido para conversión monetaria.",
      "INVALID_MONETARY_TYPE"
    );
  }

  if (rawStr.length === 0) {
    throw new MonetaryConversionError(
      "El importe monetario no puede estar vacío.",
      "EMPTY_MONETARY_VALUE"
    );
  }

  if (rawStr.startsWith("-")) {
    throw new MonetaryConversionError(
      "El importe en unidades del catálogo no puede ser negativo.",
      "NEGATIVE_MONETARY_VALUE"
    );
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(rawStr);
  if (!match) {
    throw new MonetaryConversionError(
      `Formato de importe inválido: "${rawStr}". Use dígitos enteros con hasta 2 decimales.`,
      "INVALID_MONETARY_FORMAT"
    );
  }

  const integerPartStr = match[1];
  const fractionPartStr = match[2] ?? "";

  if (fractionPartStr.length > 2) {
    throw new MonetaryConversionError(
      `El importe "${rawStr}" tiene más de 2 decimales; no se permiten redondeos silenciosos.`,
      "EXCESS_DECIMAL_PLACES"
    );
  }

  const paddedFraction = fractionPartStr.padEnd(2, "0");
  const hundredths = BigInt(integerPartStr) * 100n + BigInt(paddedFraction);

  if (hundredths > MAX_CATALOG_UNIT_HUNDREDTHS) {
    throw new MonetaryConversionError(
      "El importe supera el límite máximo permitido por el esquema Decimal(10,2).",
      "MONETARY_OVERFLOW"
    );
  }

  return hundredths;
}

/**
 * Convierte unidades del catálogo (1 unidad = 1.000 COP) a pesos colombianos enteros (BigInt).
 * Ejemplo: "49.90" -> 49900n COP.
 */
export function catalogUnitsToCopPesos(units: unknown): bigint {
  const hundredths = parseCatalogUnitsToHundredths(units);
  return hundredths * COP_PESOS_PER_CATALOG_HUNDREDTH;
}

/**
 * Convierte unidades del catálogo (1 unidad = 100.000 centavos) a centavos de Wompi (BigInt).
 * Ejemplo: "49.90" -> 4990000n centavos.
 */
export function catalogUnitsToWompiCents(units: unknown): bigint {
  const hundredths = parseCatalogUnitsToHundredths(units);
  return hundredths * WOMPI_CENTS_PER_CATALOG_HUNDREDTH;
}

/**
 * Valida y normaliza un importe entero expresado en pesos colombianos (COP) a BigInt.
 */
export function parseCopPesosBigInt(copPesos: unknown): bigint {
  let value: bigint;

  if (typeof copPesos === "bigint") {
    value = copPesos;
  } else if (typeof copPesos === "number") {
    if (!Number.isFinite(copPesos) || !Number.isSafeInteger(copPesos)) {
      throw new MonetaryConversionError(
        "El importe en pesos COP debe ser un entero seguro.",
        "UNSAFE_INTEGER_COP"
      );
    }
    if (Object.is(copPesos, -0)) {
      throw new MonetaryConversionError(
        "El importe en pesos COP no puede ser -0.",
        "NEGATIVE_MONETARY_VALUE"
      );
    }
    value = BigInt(copPesos);
  } else if (typeof copPesos === "string") {
    const clean = copPesos.trim();
    if (!/^\d+$/.test(clean)) {
      throw new MonetaryConversionError(
        "El importe en pesos COP debe ser una cadena de dígitos enteros no negativos.",
        "INVALID_COP_PESOS_STRING"
      );
    }
    value = BigInt(clean);
  } else {
    throw new MonetaryConversionError(
      "Tipo inválido para importe en pesos COP.",
      "INVALID_MONETARY_TYPE"
    );
  }

  if (value < 0n) {
    throw new MonetaryConversionError(
      "El importe en pesos COP no puede ser negativo.",
      "NEGATIVE_MONETARY_VALUE"
    );
  }

  if (value > MAX_CANONICAL_COP_PESOS) {
    throw new MonetaryConversionError(
      `El importe ${value.toString()} COP excede el máximo permitido (${MAX_CANONICAL_COP_PESOS.toString()} COP).`,
      "MONETARY_OVERFLOW"
    );
  }

  return value;
}

/**
 * Convierte pesos colombianos enteros (COP) a centavos para Wompi (1 COP = 100 centavos).
 */
export function copPesosToWompiCents(copPesos: unknown): bigint {
  const validatedPesos = parseCopPesosBigInt(copPesos);
  return validatedPesos * WOMPI_CENTS_PER_COP_PESO;
}

/**
 * Valida y convierte centavos de Wompi a pesos colombianos enteros (exige divisibilidad exacta por 100).
 */
export function wompiCentsToCopPesosExact(amountInCents: unknown): bigint {
  let cents: bigint;

  if (typeof amountInCents === "bigint") {
    cents = amountInCents;
  } else if (typeof amountInCents === "number") {
    if (!Number.isFinite(amountInCents) || !Number.isSafeInteger(amountInCents)) {
      throw new MonetaryConversionError(
        "El monto en centavos debe ser un entero seguro.",
        "UNSAFE_INTEGER_CENTS"
      );
    }
    if (Object.is(amountInCents, -0)) {
      throw new MonetaryConversionError(
        "El monto en centavos no puede ser -0.",
        "NEGATIVE_MONETARY_VALUE"
      );
    }
    cents = BigInt(amountInCents);
  } else if (typeof amountInCents === "string") {
    const clean = amountInCents.trim();
    if (!/^\d+$/.test(clean)) {
      throw new MonetaryConversionError(
        "El monto en centavos debe ser una cadena de dígitos enteros no negativos.",
        "INVALID_CENTS_STRING"
      );
    }
    cents = BigInt(clean);
  } else {
    throw new MonetaryConversionError(
      "Tipo inválido para monto en centavos.",
      "INVALID_MONETARY_TYPE"
    );
  }

  if (cents < 0n) {
    throw new MonetaryConversionError(
      "El monto en centavos no puede ser negativo.",
      "NEGATIVE_MONETARY_VALUE"
    );
  }

  if (cents > MAX_WOMPI_AMOUNT_IN_CENTS) {
    throw new MonetaryConversionError(
      `El monto en centavos (${cents.toString()}) supera el máximo permitido (${MAX_WOMPI_AMOUNT_IN_CENTS.toString()}).`,
      "MONETARY_OVERFLOW"
    );
  }

  if (cents % WOMPI_CENTS_PER_COP_PESO !== 0n) {
    throw new MonetaryConversionError(
      `El monto en centavos (${cents.toString()}) no es múltiplo exacto de 100 centavos.`,
      "INEXACT_COP_CENTS"
    );
  }

  return cents / WOMPI_CENTS_PER_COP_PESO;
}

/**
 * Formateador de moneda colombiana reutilizable basado en Intl.NumberFormat con configuración de Colombia (es-CO).
 */
export const copIntlFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formatea un entero en pesos colombianos (COP) de forma determinista sin depender
 * de espacios Unicode de Intl: 49900n -> "$ 49.900 COP".
 */
export function formatCanonicalCopPesos(copPesos: unknown): string {
  const validated = parseCopPesosBigInt(copPesos);
  const digits = validated.toString();
  const withThousands = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$ ${withThousands} COP`;
}

/**
 * Formatea importes en pesos colombianos usando la configuración estándar de Colombia: 135000 -> "$ 135.000 COP".
 */
export function formatCopAmount(amount: unknown): string {
  const validated = parseCopPesosBigInt(amount);
  return formatCanonicalCopPesos(validated);
}

/**
 * Formatea unidades del catálogo directamente en pesos colombianos:
 * 49.90 -> "$ 49.900 COP".
 */
export function formatCatalogUnitsToCop(units: unknown): string {
  const copPesos = catalogUnitsToCopPesos(units);
  return formatCanonicalCopPesos(copPesos);
}

/**
 * Formatea centavos de Wompi en pesos colombianos:
 * 4990000n -> "$ 49.900 COP".
 */
export function formatWompiCentsToCop(amountInCents: unknown): string {
  const copPesos = wompiCentsToCopPesosExact(amountInCents);
  return formatCanonicalCopPesos(copPesos);
}

/**
 * Calcula los importes de una orden íntegramente con aritmética entera BigInt.
 */
export function computeCanonicalOrderPricing(input: {
  category: string;
  presetId?: string | null;
  promoCode?: string | null;
}): CanonicalOrderPricing {
  const categoryDef = SERVICE_CATEGORIES.find((c) => c.id === input.category);
  if (!categoryDef) {
    throw new MonetaryConversionError(
      `Categoría de servicio inválida: "${input.category}".`,
      "INVALID_CATEGORY"
    );
  }

  const preset = input.presetId
    ? AI_DIAGNOSIS_PRESETS.find((p) => p.id === input.presetId)
    : undefined;

  let laborHundredths: bigint;
  let laborBasis: LaborBasis;
  let rangeMinCopPesos: bigint | null = null;
  let rangeMaxCopPesos: bigint | null = null;

  if (preset && typeof preset.priceFixed === "number") {
    laborHundredths = parseCatalogUnitsToHundredths(preset.priceFixed);
    laborBasis = "preset_fixed";
  } else if (preset && typeof preset.priceRangeMin === "number") {
    laborHundredths = parseCatalogUnitsToHundredths(preset.priceRangeMin);
    laborBasis = "preset_range_min";
    rangeMinCopPesos = laborHundredths * COP_PESOS_PER_CATALOG_HUNDREDTH;
    rangeMaxCopPesos =
      typeof preset.priceRangeMax === "number"
        ? parseCatalogUnitsToHundredths(preset.priceRangeMax) *
          COP_PESOS_PER_CATALOG_HUNDREDTH
        : null;
  } else {
    laborHundredths = parseCatalogUnitsToHundredths(categoryDef.startingPrice);
    laborBasis = "category_base";
  }

  const normalizedPromo = normalizePromoCode(input.promoCode);
  const discountHundredths = normalizedPromo
    ? PROMO_DISCOUNTS_HUNDREDTHS[normalizedPromo] ?? 0n
    : 0n;

  const subtotalHundredths =
    BASE_INSPECTION_FEE_HUNDREDTHS +
    laborHundredths +
    FIXICARE_WARRANTY_FEE_HUNDREDTHS;
  const totalHundredths =
    subtotalHundredths > discountHundredths
      ? subtotalHundredths - discountHundredths
      : 0n;

  const baseInspectionCopPesos =
    BASE_INSPECTION_FEE_HUNDREDTHS * COP_PESOS_PER_CATALOG_HUNDREDTH;
  const laborEstimateCopPesos =
    laborHundredths * COP_PESOS_PER_CATALOG_HUNDREDTH;
  const warrantyProtectionCopPesos =
    FIXICARE_WARRANTY_FEE_HUNDREDTHS * COP_PESOS_PER_CATALOG_HUNDREDTH;
  const discountCopPesos =
    discountHundredths * COP_PESOS_PER_CATALOG_HUNDREDTH;
  const totalCopPesos = totalHundredths * COP_PESOS_PER_CATALOG_HUNDREDTH;

  if (totalCopPesos > MAX_CANONICAL_COP_PESOS) {
    throw new MonetaryConversionError(
      "El total calculado supera el límite máximo permitido.",
      "MONETARY_OVERFLOW"
    );
  }

  return {
    baseInspectionCopPesos,
    laborEstimateCopPesos,
    warrantyProtectionCopPesos,
    discountCopPesos,
    totalCopPesos,
    baseInspectionWompiCents: baseInspectionCopPesos * WOMPI_CENTS_PER_COP_PESO,
    laborEstimateWompiCents: laborEstimateCopPesos * WOMPI_CENTS_PER_COP_PESO,
    warrantyProtectionWompiCents:
      warrantyProtectionCopPesos * WOMPI_CENTS_PER_COP_PESO,
    discountWompiCents: discountCopPesos * WOMPI_CENTS_PER_COP_PESO,
    totalWompiCents: totalCopPesos * WOMPI_CENTS_PER_COP_PESO,
    formattedTotalCop: formatCanonicalCopPesos(totalCopPesos),
    laborBasis,
    isEstimate: laborBasis !== "preset_fixed",
    rangeMinCopPesos,
    rangeMaxCopPesos,
    promoCode: normalizedPromo,
  };
}

