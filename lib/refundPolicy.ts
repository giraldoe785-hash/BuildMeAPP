/**
 * lib/refundPolicy.ts
 *
 * Dominio y reglas de negocio para HU26.2, HU26.3 y HU26.5:
 * - D-04: Umbral de aprobación dual ($150.000 COP) y separación de funciones.
 * - Validación de destino, importes, idempotencia y estados de reembolso.
 * - Restricciones de autoaprobación y matriz de autorizaciones internas.
 */

import { OrderPolicyError } from "./orderPolicy";

/** D-04: Umbral monetario a partir del cual se exige aprobación dual ($150.000 COP = 15.000.000 centavos) */
export const DUAL_APPROVAL_THRESHOLD_COP = 150000;
export const DUAL_APPROVAL_THRESHOLD_CENTS = 15000000n;
export const SECOND_APPROVAL_SLA_MS = 4 * 60 * 60 * 1000; // 4 horas (Regla C)

export interface RefundActor {
  id: string;
  rol: "CLIENTE" | "REPARADOR" | "ADMINISTRADOR" | "AGENTE_SOPORTE" | string;
  permisosInternos?: string[];
}

/**
 * Regla B — Matriz de roles autorizados por etapa:
 * - REQUEST: CLIENTE (titular de la orden), ADMINISTRADOR, SOPORTE_OPERATIVO o SOPORTE_NIVEL_2.
 * - FIRST_APPROVAL: ADMINISTRADOR o permiso SOPORTE_NIVEL_2.
 * - SECOND_APPROVAL / PROCESS_CREDIT: ADMINISTRADOR o permiso ADMIN_FINANCIERO.
 */
export function assertValidRefundActorForStage(
  actor: RefundActor | null | undefined,
  stage: "REQUEST" | "FIRST_APPROVAL" | "SECOND_APPROVAL" | "PROCESS_CREDIT"
): asserts actor is RefundActor {
  if (!actor || !actor.id) {
    throw new OrderPolicyError(
      "Debes iniciar sesión para realizar esta operación sobre reembolsos.",
      401,
      "UNAUTHENTICATED"
    );
  }

  const perms = actor.permisosInternos ?? [];

  if (stage === "REQUEST") {
    const allowed =
      actor.rol === "CLIENTE" ||
      actor.rol === "ADMINISTRADOR" ||
      actor.rol === "AGENTE_SOPORTE" ||
      perms.includes("SOPORTE_OPERATIVO") ||
      perms.includes("SOPORTE_NIVEL_2");
    if (!allowed) {
      throw new OrderPolicyError(
        "No tienes permisos para radicar solicitudes de reembolso.",
        403,
        "FORBIDDEN_REFUND_REQUEST"
      );
    }
    return;
  }

  if (stage === "FIRST_APPROVAL") {
    const allowed = actor.rol === "ADMINISTRADOR" || perms.includes("SOPORTE_NIVEL_2");
    if (!allowed) {
      throw new OrderPolicyError(
        "Se requiere rol ADMINISTRADOR o permiso SOPORTE_NIVEL_2 para la primera autorización.",
        403,
        "FORBIDDEN_REFUND_STAGE_PERMISSION"
      );
    }
    return;
  }

  if (stage === "SECOND_APPROVAL" || stage === "PROCESS_CREDIT") {
    const allowed = actor.rol === "ADMINISTRADOR" || perms.includes("ADMIN_FINANCIERO");
    if (!allowed) {
      throw new OrderPolicyError(
        "Se requiere rol ADMINISTRADOR o permiso ADMIN_FINANCIERO para esta operación financiera.",
        403,
        stage === "SECOND_APPROVAL"
          ? "FORBIDDEN_REFUND_STAGE_PERMISSION"
          : "FORBIDDEN_FINANCIAL_PROCESSING"
      );
    }
  }
}

export interface ValidatedCreateRefundInput {
  ordenId: string;
  ticketId: string;
  montoEnCentavos: bigint;
  destino: "FIXI_WALLET" | "TARJETA_ORIGEN";
  motivo: string;
  claveIdempotencia: string | null;
}

export function validateCreateRefundInput(raw: unknown): ValidatedCreateRefundInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrderPolicyError("El cuerpo debe ser un objeto JSON válido.", 400, "INVALID_PAYLOAD");
  }

  const r = raw as Record<string, unknown>;
  const ordenId = typeof r.ordenId === "string" ? r.ordenId.trim() : "";
  const ticketId = typeof r.ticketId === "string" ? r.ticketId.trim() : "";

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ordenId)) {
    throw new OrderPolicyError("El identificador de la orden (ordenId) es inválido.", 400, "INVALID_ORDER_ID");
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
    throw new OrderPolicyError("Todo reembolso debe estar vinculado a un TicketSoporte válido (ticketId).", 400, "MISSING_SUPPORT_TICKET");
  }

  let montoEnCentavos: bigint;
  if (r.montoEnCentavos !== undefined && r.montoEnCentavos !== null) {
    if (typeof r.montoEnCentavos === "bigint") {
      montoEnCentavos = r.montoEnCentavos;
    } else if (typeof r.montoEnCentavos === "string" && /^\d+$/.test(r.montoEnCentavos.trim())) {
      montoEnCentavos = BigInt(r.montoEnCentavos.trim());
    } else {
      throw new OrderPolicyError(
        "montoEnCentavos debe enviarse como cadena de dígitos enteros o BigInt.",
        400,
        "INVALID_AMOUNT_CENTS"
      );
    }
  } else if (r.montoCop !== undefined && r.montoCop !== null && /^\d+$/.test(String(r.montoCop).trim())) {
    montoEnCentavos = BigInt(String(r.montoCop).trim()) * 100n;
  } else {
    throw new OrderPolicyError(
      "Se requiere especificar montoEnCentavos (entero positivo en centavos COP).",
      400,
      "MISSING_AMOUNT_CENTS"
    );
  }

  if (montoEnCentavos <= 0n || montoEnCentavos % 100n !== 0n) {
    throw new OrderPolicyError(
      "El monto del reembolso debe ser un entero positivo múltiplo exacto de 100 centavos.",
      400,
      "INVALID_AMOUNT_CENTS"
    );
  }

  const rawDestino = typeof r.destino === "string" ? r.destino.trim().toUpperCase() : "FIXI_WALLET";
  if (rawDestino !== "FIXI_WALLET" && rawDestino !== "TARJETA_ORIGEN") {
    throw new OrderPolicyError(
      "El destino del reembolso debe ser FIXI_WALLET o TARJETA_ORIGEN.",
      400,
      "INVALID_REFUND_DESTINATION"
    );
  }

  const motivo = typeof r.motivo === "string" ? r.motivo.trim() : "";
  if (motivo.length < 5 || motivo.length > 500) {
    throw new OrderPolicyError(
      "El motivo del reembolso debe tener entre 5 y 500 caracteres.",
      400,
      "INVALID_REFUND_REASON"
    );
  }

  let claveIdempotencia: string | null = null;
  if (typeof r.claveIdempotencia === "string" && r.claveIdempotencia.trim().length > 0) {
    const cleanKey = r.claveIdempotencia.trim();
    if (cleanKey.length < 6 || cleanKey.length > 100) {
      throw new OrderPolicyError(
        "La clave de idempotencia debe tener entre 6 y 100 caracteres.",
        400,
        "INVALID_IDEMPOTENCY_KEY"
      );
    }
    claveIdempotencia = cleanKey;
  }

  return {
    ordenId,
    ticketId,
    montoEnCentavos,
    destino: rawDestino,
    motivo,
    claveIdempotencia,
  };
}

/**
 * Determina si un monto de reembolso requiere aprobación dual según D-04.
 * Admite monto en pesos COP (number) o en centavos BigInt.
 */
export function requiresDualApproval(montoCopOrCents: number | bigint): boolean {
  if (typeof montoCopOrCents === "bigint") {
    if (montoCopOrCents <= 0n) {
      throw new TypeError("El monto en centavos debe ser un valor positivo.");
    }
    return montoCopOrCents >= DUAL_APPROVAL_THRESHOLD_CENTS;
  }
  if (!Number.isFinite(montoCopOrCents) || montoCopOrCents <= 0) {
    throw new TypeError("El monto debe ser un número positivo.");
  }
  return montoCopOrCents >= DUAL_APPROVAL_THRESHOLD_COP;
}

/**
 * Valida los permisos requeridos para autorizar un reembolso:
 * - Etapa 1 (primer aprobador): Rol ADMINISTRADOR o permiso SOPORTE_NIVEL_2.
 * - Etapa 2 (segundo aprobador): Rol ADMINISTRADOR o permiso ADMIN_FINANCIERO.
 */
export function canAuthorizeRefundStage(
  actor: RefundActor,
  stage: "FIRST" | "SECOND"
): boolean {
  if (actor.rol === "ADMINISTRADOR") return true;

  if (stage === "FIRST") {
    return Boolean(actor.permisosInternos?.includes("SOPORTE_NIVEL_2"));
  }
  if (stage === "SECOND") {
    return Boolean(actor.permisosInternos?.includes("ADMIN_FINANCIERO"));
  }
  return false;
}

/**
 * Aplica el principio de separación estricta de funciones (SoD) para autorizaciones de reembolso:
 * 1. El solicitante (e.g. creador del ticket de soporte) nunca puede aprobar el reembolso.
 * 2. El primer autorizador no puede ser el segundo autorizador en aprobaciones duales.
 */
export function assertSeparationOfDuties(params: {
  actor: RefundActor;
  ticketCreatorId?: string | null;
  firstAuthorizerId?: string | null;
  stage: "FIRST" | "SECOND";
}): void {
  const { actor, ticketCreatorId, firstAuthorizerId, stage } = params;

  // Prevención de autoaprobación por quien radicó la solicitud
  if (ticketCreatorId && actor.id === ticketCreatorId) {
    throw new OrderPolicyError(
      "Principio de segregación de funciones: el solicitante del ticket no puede aprobar el reembolso.",
      403,
      "FORBIDDEN_SELF_APPROVAL"
    );
  }

  // En la segunda etapa de aprobación dual, el segundo aprobador debe ser un usuario diferente al primero
  if (stage === "SECOND" && firstAuthorizerId && actor.id === firstAuthorizerId) {
    throw new OrderPolicyError(
      "Principio de doble autorización: el segundo autorizador financiero debe ser un usuario diferente al primer aprobador.",
      403,
      "FORBIDDEN_IDENTICAL_DUAL_APPROVER"
    );
  }
}

/**
 * Valida la entrada para autorizar una etapa de reembolso.
 */
export function validateRefundApprovalInput(raw: unknown): {
  valid: true;
  data: { stage: "FIRST" | "SECOND"; notas?: string };
} | {
  valid: false;
  errors: string[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["El cuerpo debe ser un objeto JSON."] };
  }

  const r = raw as Record<string, unknown>;
  const stage = r.stage;

  if (stage !== "FIRST" && stage !== "SECOND") {
    return {
      valid: false,
      errors: ["La etapa de aprobación debe ser 'FIRST' o 'SECOND'."],
    };
  }

  const notas = typeof r.notas === "string" ? r.notas.trim() : undefined;

  return {
    valid: true,
    data: { stage, notas },
  };
}
