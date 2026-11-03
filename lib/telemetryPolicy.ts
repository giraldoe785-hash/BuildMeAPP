/**
 * lib/telemetryPolicy.ts
 *
 * Dominio y reglas de negocio para HU25.1, HU25.2 y HU25.3:
 * - Telemetría y cálculo de proximidad Haversine (D-06).
 * - Validación de coordenadas, precisión y frescura temporal en servidor.
 * - Reglas de desbloqueo auditado de OTP sin falsificar validación (D-07).
 * - Reglas de incomparecencia del cliente y cálculo de espera mínima (D-08).
 * - Verificación de permisos internos de soporte (D-20 / D-21).
 */

export const EARTH_RADIUS_METERS = 6371000;

/** D-06: Radio máximo de proximidad al punto de servicio para considerar arribo (100 metros) */
export const MAX_ARRIVAL_RADIUS_METERS = 100;

/** D-06: Umbral máximo de precisión GPS aceptable (50 metros) */
export const MAX_GPS_ACCURACY_METERS = 50;

/** D-06: Frescura máxima de la muestra de telemetría en el servidor (60 segundos) */
export const MAX_TELEMETRY_FRESHNESS_SECONDS = 60;

/** Tolerancia extendida de telemetría reciente para intervenciones de soporte (300 segundos = 5 minutos) */
export const MAX_SUPPORT_INTERVENTION_TELEMETRY_AGE_SECONDS = 300;

/** D-07: Longitud mínima de referencia telefónica para intervenciones de soporte */
export const MIN_TELEPHONE_REFERENCE_LENGTH = 8;

/** D-07: Longitud mínima de justificación obligatoria para soporte */
export const MIN_JUSTIFICATION_LENGTH = 20;

/** D-08: Tiempo mínimo de espera en sitio para incomparecencia (15 minutos = 900 segundos) */
export const MIN_WAIT_SECONDS_NO_SHOW = 900;

/** Estados de orden en los que un reparador puede emitir telemetría */
export const TELEMETRY_ALLOWED_ORDER_STATES = ["EN_CAMINO", "EN_SITIO", "EN_TRABAJO"] as const;
export type TelemetryAllowedOrderState = (typeof TELEMETRY_ALLOWED_ORDER_STATES)[number];

export type TelemetryEvaluationCode =
  | "VALID_ON_SITE"
  | "OUT_OF_RADIUS"
  | "INSUFFICIENT_ACCURACY"
  | "STALE_SAMPLE"
  | "NO_DESTINATION_COORDINATES";

export interface TelemetryEvaluationResult {
  code: TelemetryEvaluationCode;
  isOnSite: boolean;
  distanceMeters: number | null;
  accuracyMeters: number | null;
  ageSeconds: number;
  isAccuracyAcceptable: boolean;
  isWithinRadius: boolean;
  isFresh: boolean;
}

/**
 * Calcula la distancia ortodrómica en metros entre dos puntos geográficos usando la fórmula de Haversine.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    throw new TypeError("Las coordenadas deben ser números finitos.");
  }

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_METERS * c * 100) / 100;
}

/**
 * Valida si un valor representa una latitud válida [-90, 90].
 */
export function isValidLatitude(lat: unknown): lat is number {
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

/**
 * Valida si un valor representa una longitud válida [-180, 180].
 */
export function isValidLongitude(lon: unknown): lon is number {
  return typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

/**
 * Valida si un valor representa una precisión GPS positiva y razonable.
 */
export function isValidAccuracy(accuracy: unknown): accuracy is number {
  return typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 10000;
}

/**
 * Evalúa una muestra de telemetría respecto al destino del servicio según D-06.
 */
export function evaluateTelemetrySample(params: {
  technicianLat: number;
  technicianLon: number;
  accuracyMeters?: number | null;
  destinationLat?: number | null;
  destinationLon?: number | null;
  receivedAtServer: Date;
  referenceTime?: Date;
  maxRadiusMeters?: number;
  maxAccuracyMeters?: number;
  maxFreshnessSeconds?: number;
}): TelemetryEvaluationResult {
  const refTime = params.referenceTime ?? new Date();
  const maxRadius = params.maxRadiusMeters ?? MAX_ARRIVAL_RADIUS_METERS;
  const maxAccuracy = params.maxAccuracyMeters ?? MAX_GPS_ACCURACY_METERS;
  const maxFreshness = params.maxFreshnessSeconds ?? MAX_TELEMETRY_FRESHNESS_SECONDS;

  const ageSeconds = Math.max(
    0,
    Math.round((refTime.getTime() - params.receivedAtServer.getTime()) / 1000)
  );
  const isFresh = ageSeconds <= maxFreshness;

  const accuracy = params.accuracyMeters ?? null;
  const isAccuracyAcceptable = accuracy !== null && accuracy <= maxAccuracy;

  if (
    params.destinationLat === null ||
    params.destinationLat === undefined ||
    params.destinationLon === null ||
    params.destinationLon === undefined
  ) {
    return {
      code: "NO_DESTINATION_COORDINATES",
      isOnSite: false,
      distanceMeters: null,
      accuracyMeters: accuracy,
      ageSeconds,
      isAccuracyAcceptable,
      isWithinRadius: false,
      isFresh,
    };
  }

  const distanceMeters = calculateHaversineDistanceMeters(
    params.technicianLat,
    params.technicianLon,
    params.destinationLat,
    params.destinationLon
  );

  const isWithinRadius = distanceMeters <= maxRadius;
  const isOnSite = isWithinRadius && isAccuracyAcceptable;

  let code: TelemetryEvaluationCode = "VALID_ON_SITE";
  if (!isAccuracyAcceptable) {
    code = "INSUFFICIENT_ACCURACY";
  } else if (!isWithinRadius) {
    code = "OUT_OF_RADIUS";
  } else if (!isFresh) {
    code = "STALE_SAMPLE";
  }

  return {
    code,
    isOnSite,
    distanceMeters,
    accuracyMeters: accuracy,
    ageSeconds,
    isAccuracyAcceptable,
    isWithinRadius,
    isFresh,
  };
}

/**
 * Valida la entrada cruda de una muestra de telemetría enviada por el reparador.
 */
export function validateTelemetryInput(raw: unknown): {
  valid: true;
  data: { latitud: number; longitud: number; precisionMetros?: number };
} | {
  valid: false;
  errors: string[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["El cuerpo de la solicitud debe ser un objeto JSON."] };
  }

  const r = raw as Record<string, unknown>;
  const errors: string[] = [];

  const lat = typeof r.latitud === "string" ? parseFloat(r.latitud) : r.latitud;
  const lon = typeof r.longitud === "string" ? parseFloat(r.longitud) : r.longitud;

  if (!isValidLatitude(lat)) {
    errors.push("La latitud debe ser un número decimal válido entre -90 y 90.");
  }
  if (!isValidLongitude(lon)) {
    errors.push("La longitud debe ser un número decimal válido entre -180 y 180.");
  }

  let precision: number | undefined = undefined;
  if (r.precisionMetros !== undefined && r.precisionMetros !== null) {
    const prec =
      typeof r.precisionMetros === "string"
        ? parseFloat(r.precisionMetros)
        : r.precisionMetros;
    if (!isValidAccuracy(prec)) {
      errors.push("La precisión en metros debe ser un número mayor a 0.");
    } else {
      precision = prec;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      latitud: lat as number,
      longitud: lon as number,
      precisionMetros: precision,
    },
  };
}

/**
 * Valida la entrada requerida para el inicio forzado de soporte (HU25.2, D-07).
 */
export function validateForceStartInput(raw: unknown): {
  valid: true;
  data: {
    justificacion: string;
    referenciaContactoTelefonico: string;
    contactoConfirmado: boolean;
  };
} | {
  valid: false;
  errors: string[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["El cuerpo de la solicitud debe ser un objeto JSON."] };
  }

  const r = raw as Record<string, unknown>;
  const errors: string[] = [];

  const justificacion = typeof r.justificacion === "string" ? r.justificacion.trim() : "";
  if (justificacion.length < MIN_JUSTIFICATION_LENGTH) {
    errors.push(
      `La justificación operativa es obligatoria y debe tener al menos ${MIN_JUSTIFICATION_LENGTH} caracteres (recibidos: ${justificacion.length}).`
    );
  }

  const referenciaContacto =
    typeof r.referenciaContactoTelefonico === "string"
      ? r.referenciaContactoTelefonico.trim()
      : "";
  if (referenciaContacto.length < MIN_TELEPHONE_REFERENCE_LENGTH) {
    errors.push(
      `La referencia de contacto telefónico es obligatoria y debe tener al menos ${MIN_TELEPHONE_REFERENCE_LENGTH} caracteres (e.g. ID de llamada o registro).`
    );
  }

  if (r.contactoConfirmado !== true) {
    errors.push(
      "Debes confirmar explícitamente haber establecido contacto telefónico con el cliente (contactoConfirmado: true)."
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      justificacion,
      referenciaContactoTelefonico: referenciaContacto,
      contactoConfirmado: true,
    },
  };
}

/**
 * Valida la entrada requerida para registrar la incomparecencia del cliente (HU25.3, D-08).
 */
export function validateNoShowInput(raw: unknown): {
  valid: true;
  data: {
    justificacion: string;
    referenciaContactoTelefonico: string;
    contactoConfirmado: boolean;
    claveIdempotencia: string;
  };
} | {
  valid: false;
  errors: string[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["El cuerpo de la solicitud debe ser un objeto JSON."] };
  }

  const r = raw as Record<string, unknown>;
  const errors: string[] = [];

  const justificacion = typeof r.justificacion === "string" ? r.justificacion.trim() : "";
  if (justificacion.length < MIN_JUSTIFICATION_LENGTH) {
    errors.push(
      `La justificación operativa de incomparecencia debe tener al menos ${MIN_JUSTIFICATION_LENGTH} caracteres.`
    );
  }

  const referenciaContacto =
    typeof r.referenciaContactoTelefonico === "string"
      ? r.referenciaContactoTelefonico.trim()
      : "";
  if (referenciaContacto.length < MIN_TELEPHONE_REFERENCE_LENGTH) {
    errors.push(
      `La referencia del intento de contacto telefónico debe tener al menos ${MIN_TELEPHONE_REFERENCE_LENGTH} caracteres.`
    );
  }

  const claveIdempotencia =
    typeof r.claveIdempotencia === "string" ? r.claveIdempotencia.trim() : "";
  if (claveIdempotencia.length < 5) {
    errors.push("La clave de idempotencia es obligatoria para garantizar operaciones financieras internas atómicas.");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      justificacion,
      referenciaContactoTelefonico: referenciaContacto,
      contactoConfirmado: Boolean(r.contactoConfirmado),
      claveIdempotencia,
    },
  };
}

/**
 * Evalúa la ventana de espera del técnico en sitio a partir del registro del servidor (HU25.3, D-08).
 * Se calcula la diferencia temporal entre la primera y la última muestra confirmada en sitio.
 */
export function evaluateNoShowWaitWindow(
  samples: Array<{ enSitio: boolean; recibidoEnServidor: Date }>,
  minWaitSeconds: number = MIN_WAIT_SECONDS_NO_SHOW
): {
  eligible: boolean;
  waitSeconds: number;
  firstOnSiteAt: Date | null;
  lastOnSiteAt: Date | null;
} {
  const onSiteSamples = samples
    .filter((s) => s.enSitio)
    .sort((a, b) => a.recibidoEnServidor.getTime() - b.recibidoEnServidor.getTime());

  if (onSiteSamples.length === 0) {
    return {
      eligible: false,
      waitSeconds: 0,
      firstOnSiteAt: null,
      lastOnSiteAt: null,
    };
  }

  const firstOnSiteAt = onSiteSamples[0].recibidoEnServidor;
  const lastOnSiteAt = onSiteSamples[onSiteSamples.length - 1].recibidoEnServidor;
  const waitSeconds = Math.max(
    0,
    Math.round((lastOnSiteAt.getTime() - firstOnSiteAt.getTime()) / 1000)
  );

  return {
    eligible: waitSeconds >= minWaitSeconds,
    waitSeconds,
    firstOnSiteAt,
    lastOnSiteAt,
  };
}

/**
 * Comprueba si un usuario tiene autorización para operar soporte (D-20).
 * Es válido si es ADMINISTRADOR o si cuenta con el permiso interno específico.
 */
export function hasInternalSupportPermission(
  actor: {
    rol: string;
    permisosInternos?: string[];
  } | null | undefined,
  requiredPermission: "SOPORTE_OPERATIVO" | "SOPORTE_NIVEL_2" | "ADMIN_FINANCIERO"
): boolean {
  if (!actor) return false;
  if (actor.rol === "ADMINISTRADOR") return true;
  return Boolean(actor.permisosInternos?.includes(requiredPermission));
}
