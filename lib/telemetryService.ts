/**
 * lib/telemetryService.ts
 *
 * Servicios de aplicación para HU25.1, HU25.2 y HU25.3:
 * - Ingesta y consulta de telemetría del reparador.
 * - Desbloqueo auditado de servicio por soporte (force start) sin validar falsamente el OTP.
 * - Gestión de incomparecencia del cliente tras espera confirmada en sitio.
 */

import { OrderPolicyError, isValidUuid } from "./orderPolicy";
import {
  evaluateTelemetrySample,
  validateTelemetryInput,
  validateForceStartInput,
  validateNoShowInput,
  evaluateNoShowWaitWindow,
  hasInternalSupportPermission,
  MAX_SUPPORT_INTERVENTION_TELEMETRY_AGE_SECONDS,
  MAX_ARRIVAL_RADIUS_METERS,
  MAX_GPS_ACCURACY_METERS,
  type TelemetryEvaluationResult,
} from "./telemetryPolicy";

export interface TelemetryActor {
  id: string;
  rol: "CLIENTE" | "REPARADOR" | "ADMINISTRADOR";
  estado?: string;
  permisosInternos?: string[];
}

type AnyPrisma = any;

/**
 * Registra una muestra de telemetría enviada por el técnico asignado a una orden activa (HU25.1).
 * Comprueba presencia en sitio mediante Haversine en servidor y efectúa la transición a EN_SITIO si corresponde.
 */
export async function recordRepairerTelemetry(
  db: AnyPrisma,
  actor: TelemetryActor | null | undefined,
  orderId: unknown,
  rawInput: unknown
): Promise<{
  success: true;
  sampleId: string;
  distanciaCalculadaMetros: number | null;
  enSitio: boolean;
  nuevoEstadoOrden: string;
  evaluation: TelemetryEvaluationResult;
}> {
  if (!actor || actor.rol !== "REPARADOR") {
    throw new OrderPolicyError(
      "Solo un técnico con rol REPARADOR puede transmitir telemetría.",
      403,
      "FORBIDDEN_NOT_REPAIRER"
    );
  }
  if (actor.estado && actor.estado !== "VERIFICADO") {
    throw new OrderPolicyError(
      "Tu cuenta de técnico debe estar en estado VERIFICADO para operar.",
      403,
      "REPAIRER_NOT_VERIFIED"
    );
  }

  if (!isValidUuid(orderId)) {
    throw new OrderPolicyError(
      "El identificador de la orden no es un UUID válido.",
      400,
      "INVALID_ORDER_ID"
    );
  }

  const cleanOrderId = (orderId as string).trim();
  const inputResult = validateTelemetryInput(rawInput);
  if (!inputResult.valid) {
    throw new OrderPolicyError(
      inputResult.errors.join(" "),
      400,
      "INVALID_TELEMETRY_PAYLOAD"
    );
  }

  const { latitud, longitud, precisionMetros } = inputResult.data;

  // 1. Obtener orden para control de pertenencia y estado
  const order = await db.ordenServicio.findUnique({
    where: { id: cleanOrderId },
    select: {
      id: true,
      estado: true,
      reparadorId: true,
      latitud: true,
      longitud: true,
    },
  });

  if (!order) {
    throw new OrderPolicyError("La orden solicitada no existe.", 404, "ORDER_NOT_FOUND");
  }

  if (order.reparadorId !== actor.id) {
    throw new OrderPolicyError(
      "No puedes registrar telemetría en una orden que no tienes asignada.",
      403,
      "FORBIDDEN_ORDER_MISMATCH"
    );
  }

  const allowedStates = ["EN_CAMINO", "EN_SITIO", "EN_TRABAJO"];
  if (!allowedStates.includes(order.estado)) {
    throw new OrderPolicyError(
      `No se permite telemetría para una orden en estado ${order.estado}.`,
      409,
      "ORDER_STATE_NOT_ACTIVE"
    );
  }

  const serverTime = new Date();

  // 2. Evaluar telemetría en servidor
  const orderLat = order.latitud !== null && order.latitud !== undefined ? Number(order.latitud) : null;
  const orderLon = order.longitud !== null && order.longitud !== undefined ? Number(order.longitud) : null;

  const evaluation = evaluateTelemetrySample({
    technicianLat: latitud,
    technicianLon: longitud,
    accuracyMeters: precisionMetros,
    destinationLat: orderLat,
    destinationLon: orderLon,
    receivedAtServer: serverTime,
    referenceTime: serverTime,
    maxRadiusMeters: MAX_ARRIVAL_RADIUS_METERS,
    maxAccuracyMeters: MAX_GPS_ACCURACY_METERS,
  });

  // 3. Persistir muestra y transicionar estado si arriba a destino
  const executePersistence = async (tx: AnyPrisma) => {
    const sample = await tx.muestraTelemetriaReparador.create({
      data: {
        reparadorId: actor.id,
        ordenId: cleanOrderId,
        latitud,
        longitud,
        precisionMetros: precisionMetros ?? null,
        distanciaCalculadaMetros: evaluation.distanceMeters,
        enSitio: evaluation.isOnSite,
        recibidoEnServidor: serverTime,
      },
    });

    let currentOrderState = order.estado;

    // Si el técnico arribó a sitio y la orden estaba EN_CAMINO, transiciona atómicamente a EN_SITIO
    if (evaluation.isOnSite && order.estado === "EN_CAMINO") {
      const updateResult = await tx.ordenServicio.updateMany({
        where: { id: cleanOrderId, estado: "EN_CAMINO" },
        data: { estado: "EN_SITIO" },
      });

      if (updateResult.count === 1) {
        currentOrderState = "EN_SITIO";
        await tx.ordenTrazabilidad.create({
          data: {
            ordenId: cleanOrderId,
            estadoAnterior: "EN_CAMINO",
            estadoNuevo: "EN_SITIO",
            cambiadoPorUsuarioId: actor.id,
            rolOperador: "REPARADOR",
            motivoCambio: "Llegada al sitio del servicio verificada por telemetría del servidor",
          },
        });
      }
    }

    return {
      sampleId: sample.id,
      nuevoEstadoOrden: currentOrderState,
    };
  };

  const persisted = db.$transaction
    ? await db.$transaction(executePersistence)
    : await executePersistence(db);

  return {
    success: true,
    sampleId: persisted.sampleId,
    distanciaCalculadaMetros: evaluation.distanceMeters,
    enSitio: evaluation.isOnSite,
    nuevoEstadoOrden: persisted.nuevoEstadoOrden,
    evaluation,
  };
}

/**
 * Consulta la última muestra de telemetría de una orden bajo estricto control de acceso.
 */
export async function getLatestOrderTelemetry(
  db: AnyPrisma,
  actor: TelemetryActor | null | undefined,
  orderId: unknown
) {
  if (!actor) {
    throw new OrderPolicyError("Debes iniciar sesión.", 401, "UNAUTHORIZED");
  }
  if (!isValidUuid(orderId)) {
    throw new OrderPolicyError("Identificador de orden inválido.", 400, "INVALID_ORDER_ID");
  }

  const cleanOrderId = (orderId as string).trim();
  const order = await db.ordenServicio.findUnique({
    where: { id: cleanOrderId },
    select: { id: true, clienteId: true, reparadorId: true, estado: true },
  });

  if (!order) {
    throw new OrderPolicyError("La orden no existe.", 404, "ORDER_NOT_FOUND");
  }

  const isSupport = actor.rol === "ADMINISTRADOR" || hasInternalSupportPermission(actor, "SOPORTE_OPERATIVO");
  const isAssignedRepairer = actor.rol === "REPARADOR" && order.reparadorId === actor.id;
  const isOrderClient = actor.rol === "CLIENTE" && order.clienteId === actor.id;

  if (!isSupport && !isAssignedRepairer && !isOrderClient) {
    throw new OrderPolicyError("No tienes permiso para ver la telemetría de esta orden.", 403, "FORBIDDEN");
  }

  const latestSample = await db.muestraTelemetriaReparador.findFirst({
    where: { ordenId: cleanOrderId },
    orderBy: { recibidoEnServidor: "desc" },
  });

  if (!latestSample) {
    return {
      hasTelemetry: false,
      sample: null,
      orderState: order.estado,
    };
  }

  // Protección de datos: cliente solo ve si está en sitio o no, sin exponer coordenadas GPS de terceros
  if (isOrderClient && !isSupport) {
    return {
      hasTelemetry: true,
      enSitio: latestSample.enSitio,
      recibidoEnServidor: latestSample.recibidoEnServidor,
      orderState: order.estado,
    };
  }

  return {
    hasTelemetry: true,
    sample: {
      id: latestSample.id,
      latitud: Number(latestSample.latitud),
      longitud: Number(latestSample.longitud),
      precisionMetros: latestSample.precisionMetros ? Number(latestSample.precisionMetros) : null,
      distanciaCalculadaMetros: latestSample.distanciaCalculadaMetros
        ? Number(latestSample.distanciaCalculadaMetros)
        : null,
      enSitio: latestSample.enSitio,
      recibidoEnServidor: latestSample.recibidoEnServidor,
    },
    orderState: order.estado,
  };
}

/**
 * Desbloqueo auditado de OTP por soporte operativo (HU25.2, D-07).
 * NO falsifica `otpValidado`: conserva `otpValidado: false` y registra IntervencionOperativa.
 */
export async function forceStartServiceBySupport(
  db: AnyPrisma,
  actor: TelemetryActor | null | undefined,
  orderId: unknown,
  rawInput: unknown
): Promise<{
  success: true;
  intervencionId: string;
  orderId: string;
  estadoAnterior: string;
  estadoNuevo: "EN_TRABAJO";
  otpValidado: false;
}> {
  if (!actor || (actor.rol !== "ADMINISTRADOR" && !hasInternalSupportPermission(actor, "SOPORTE_OPERATIVO"))) {
    throw new OrderPolicyError(
      "No cuentas con autorización de soporte operativo para forzar el inicio de un servicio.",
      403,
      "FORBIDDEN_SUPPORT_PERMISSION"
    );
  }

  if (!isValidUuid(orderId)) {
    throw new OrderPolicyError("Identificador de orden inválido.", 400, "INVALID_ORDER_ID");
  }

  const cleanOrderId = (orderId as string).trim();
  const inputValidation = validateForceStartInput(rawInput);
  if (!inputValidation.valid) {
    throw new OrderPolicyError(
      inputValidation.errors.join(" "),
      400,
      "INVALID_FORCE_START_PAYLOAD"
    );
  }

  const { justificacion, referenciaContactoTelefonico, contactoConfirmado } = inputValidation.data;

  // 1. Obtener orden en estado EN_SITIO
  const order = await db.ordenServicio.findUnique({
    where: { id: cleanOrderId },
    select: {
      id: true,
      estado: true,
      reparadorId: true,
      codigoOtp: true,
      otpValidado: true,
    },
  });

  if (!order) {
    throw new OrderPolicyError("La orden solicitada no existe.", 404, "ORDER_NOT_FOUND");
  }

  if (order.estado !== "EN_SITIO") {
    throw new OrderPolicyError(
      `Solo se puede forzar el inicio de un servicio que se encuentre en estado EN_SITIO (estado actual: ${order.estado}).`,
      409,
      "INVALID_ORDER_STATE_FOR_FORCE_START"
    );
  }

  // 2. Verificar telemetría: técnico debe estar validado en sitio y muestra debe ser reciente
  const latestSample = await db.muestraTelemetriaReparador.findFirst({
    where: { ordenId: cleanOrderId },
    orderBy: { recibidoEnServidor: "desc" },
  });

  if (!latestSample || !latestSample.enSitio) {
    throw new OrderPolicyError(
      "No es posible forzar el inicio: no existe registro de telemetría del servidor que confirme la presencia del técnico en sitio.",
      400,
      "TELEMETRY_NOT_ON_SITE"
    );
  }

  const now = new Date();
  const sampleAgeSeconds = Math.max(
    0,
    Math.round((now.getTime() - new Date(latestSample.recibidoEnServidor).getTime()) / 1000)
  );

  if (sampleAgeSeconds > MAX_SUPPORT_INTERVENTION_TELEMETRY_AGE_SECONDS) {
    throw new OrderPolicyError(
      `La última telemetría del técnico en sitio es demasiado antigua (${sampleAgeSeconds} segundos; máximo permitido: ${MAX_SUPPORT_INTERVENTION_TELEMETRY_AGE_SECONDS}s). Solicita una actualización de ubicación.`,
      400,
      "TELEMETRY_STALE"
    );
  }

  // 3. Ejecutar transacción: transicionar a EN_TRABAJO, preservar otpValidado: false, registrar intervención y trazabilidad
  const executeTransaction = async (tx: AnyPrisma) => {
    const updateResult = await tx.ordenServicio.updateMany({
      where: {
        id: cleanOrderId,
        estado: "EN_SITIO",
      },
      data: {
        estado: "EN_TRABAJO",
        // REGLA CRÍTICA: NO falsificar otpValidado (debe seguir siendo false)
        otpValidado: false,
        fechaInicioTrabajo: now,
        intentosFallidosOtp: 0,
        otpBloqueadoHasta: null,
      },
    });

    if (updateResult.count !== 1) {
      throw new OrderPolicyError(
        "La orden ya no se encuentra en estado EN_SITIO debido a una operación concurrente.",
        409,
        "ORDER_CONCURRENT_UPDATE"
      );
    }

    const intervencion = await tx.intervencionOperativa.create({
      data: {
        ordenId: cleanOrderId,
        agenteId: actor.id,
        tipoContingencia: "FALLO_OTP_INICIO",
        resultado: "RESUELTO_INICIO_FORZADO",
        justificacion,
        latitudRegistrada: latestSample.latitud,
        longitudRegistrada: latestSample.longitud,
        distanciaCalculadaMetros: latestSample.distanciaCalculadaMetros,
        antiguedadTelemetriaSegundos: sampleAgeSeconds,
        referenciaContactoTelefonico,
        contactoConfirmado,
        estadoAnterior: "EN_SITIO",
        estadoNuevo: "EN_TRABAJO",
        creadoEn: now,
      },
    });

    await tx.ordenTrazabilidad.create({
      data: {
        ordenId: cleanOrderId,
        estadoAnterior: "EN_SITIO",
        estadoNuevo: "EN_TRABAJO",
        cambiadoPorUsuarioId: actor.id,
        rolOperador: "ADMINISTRADOR",
        motivoCambio: `Intervención operativa de soporte: inicio forzado de servicio sin validación de OTP (Ref. Telefónica: ${referenciaContactoTelefonico})`,
        creadoEn: now,
      },
    });

    return intervencion;
  };

  const intervencion = db.$transaction
    ? await db.$transaction(executeTransaction)
    : await executeTransaction(db);

  return {
    success: true,
    intervencionId: intervencion.id,
    orderId: cleanOrderId,
    estadoAnterior: "EN_SITIO",
    estadoNuevo: "EN_TRABAJO",
    otpValidado: false,
  };
}

/**
 * Gestión de incomparecencia del cliente tras espera confirmada en sitio (HU25.3, D-08).
 * Valida el tiempo de espera del técnico en sitio (>= 15 min), cancela la orden y aplica compensación interna.
 */
export async function cancelOrderForClientNoShow(
  db: AnyPrisma,
  actor: TelemetryActor | null | undefined,
  orderId: unknown,
  rawInput: unknown
): Promise<{
  success: true;
  intervencionId: string;
  orderId: string;
  estadoAnterior: string;
  estadoNuevo: "CANCELADO";
  esperaConfirmadaSegundos: number;
  movimientoLiquidacionId?: string;
}> {
  if (!actor || (actor.rol !== "ADMINISTRADOR" && !hasInternalSupportPermission(actor, "SOPORTE_OPERATIVO"))) {
    throw new OrderPolicyError(
      "No cuentas con autorización de soporte para gestionar incomparecencias.",
      403,
      "FORBIDDEN_SUPPORT_PERMISSION"
    );
  }

  if (!isValidUuid(orderId)) {
    throw new OrderPolicyError("Identificador de orden inválido.", 400, "INVALID_ORDER_ID");
  }

  const cleanOrderId = (orderId as string).trim();
  const inputValidation = validateNoShowInput(rawInput);
  if (!inputValidation.valid) {
    throw new OrderPolicyError(
      inputValidation.errors.join(" "),
      400,
      "INVALID_NO_SHOW_PAYLOAD"
    );
  }

  const { justificacion, referenciaContactoTelefonico, contactoConfirmado, claveIdempotencia } =
    inputValidation.data;

  // 1. Obtener orden en estado EN_SITIO
  const order = await db.ordenServicio.findUnique({
    where: { id: cleanOrderId },
    select: {
      id: true,
      estado: true,
      reparadorId: true,
      costoVisita: true,
    },
  });

  if (!order) {
    throw new OrderPolicyError("La orden no existe.", 404, "ORDER_NOT_FOUND");
  }

  if (order.estado !== "EN_SITIO") {
    throw new OrderPolicyError(
      `Solo se puede declarar incomparecencia para una orden en estado EN_SITIO (estado actual: ${order.estado}).`,
      409,
      "INVALID_ORDER_STATE_FOR_NO_SHOW"
    );
  }

  if (!order.reparadorId) {
    throw new OrderPolicyError("La orden no tiene un reparador asignado.", 400, "NO_REPAIRER_ASSIGNED");
  }

  // 2. Comprobar tiempo de espera en sitio según muestras de telemetría del servidor (mínimo 900 segundos)
  const samples = await db.muestraTelemetriaReparador.findMany({
    where: { ordenId: cleanOrderId, enSitio: true },
    select: { enSitio: true, recibidoEnServidor: true },
    orderBy: { recibidoEnServidor: "asc" },
  });

  const waitResult = evaluateNoShowWaitWindow(samples);
  if (!waitResult.eligible) {
    throw new OrderPolicyError(
      `El técnico no ha cumplido el tiempo reglamentario de espera de 15 minutos en sitio (tiempo registrado: ${waitResult.waitSeconds} segundos). No procede la incomparecencia.`,
      400,
      "INSUFFICIENT_WAIT_TIME"
    );
  }

  const now = new Date();
  const latestSample = samples[samples.length - 1];

  // 3. Transacción: cancelación, intervención operativa, trazabilidad y movimiento de liquidación
  const executeTransaction = async (tx: AnyPrisma) => {
    const updateResult = await tx.ordenServicio.updateMany({
      where: { id: cleanOrderId, estado: "EN_SITIO" },
      data: {
        estado: "CANCELADO",
      },
    });

    if (updateResult.count !== 1) {
      throw new OrderPolicyError(
        "La orden cambió de estado concurrentemente.",
        409,
        "ORDER_CONCURRENT_UPDATE"
      );
    }

    const intervencion = await tx.intervencionOperativa.create({
      data: {
        ordenId: cleanOrderId,
        agenteId: actor.id,
        tipoContingencia: "INCOMPARECENCIA_CLIENTE",
        resultado: "CANCELADO_INCOMPARECENCIA",
        justificacion,
        antiguedadTelemetriaSegundos: waitResult.waitSeconds,
        referenciaContactoTelefonico,
        contactoConfirmado,
        estadoAnterior: "EN_SITIO",
        estadoNuevo: "CANCELADO",
        creadoEn: now,
      },
    });

    await tx.ordenTrazabilidad.create({
      data: {
        ordenId: cleanOrderId,
        estadoAnterior: "EN_SITIO",
        estadoNuevo: "CANCELADO",
        cambiadoPorUsuarioId: actor.id,
        rolOperador: "ADMINISTRADOR",
        motivoCambio: `Cancelación por incomparecencia del cliente tras ${Math.round(
          waitResult.waitSeconds / 60
        )} minutos de espera en sitio`,
        creadoEn: now,
      },
    });

    // Compensación interna al reparador según D-08 (sin cargos externos / sin Wompi)
    let movimientoId: string | undefined = undefined;
    const montoCompensacion = order.costoVisita !== null && order.costoVisita !== undefined ? Number(order.costoVisita) : 35000;

    if (tx.movimientoLiquidacionReparador) {
      const movimiento = await tx.movimientoLiquidacionReparador.upsert({
        where: { claveIdempotencia },
        update: {},
        create: {
          reparadorId: order.reparadorId,
          ordenId: cleanOrderId,
          tipo: "COMPENSACION_INCOMPARECENCIA_CLIENTE",
          monto: montoCompensacion,
          descripcion: `Compensación al reparador por incomparecencia del cliente en orden ${cleanOrderId}`,
          aplicadoPorId: actor.id,
          claveIdempotencia,
          creadoEn: now,
        },
      });
      movimientoId = movimiento.id;
    }

    return { intervencion, movimientoId };
  };

  const { intervencion, movimientoId } = db.$transaction
    ? await db.$transaction(executeTransaction)
    : await executeTransaction(db);

  return {
    success: true,
    intervencionId: intervencion.id,
    orderId: cleanOrderId,
    estadoAnterior: "EN_SITIO",
    estadoNuevo: "CANCELADO",
    esperaConfirmadaSegundos: waitResult.waitSeconds,
    movimientoLiquidacionId: movimientoId,
  };
}
