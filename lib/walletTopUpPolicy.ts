/**
 * lib/walletTopUpPolicy.ts
 *
 * Política PURA (sin I/O) de recargas de Fixi Wallet vía Wompi Sandbox.
 * Todo importe se opera en centavos COP con BigInt. Prohibido Number() sobre dinero.
 */

export const DEFAULT_TOPUP_MIN_CENTS = 1_000_000n; // $10.000 COP
export const DEFAULT_TOPUP_MAX_CENTS = 200_000_000n; // $2.000.000 COP

export type TopUpRecargaState =
  | "PENDIENTE"
  | "APROBADA"
  | "RECHAZADA"
  | "EN_DISPUTA"
  | "ANULADA_WOMPI"
  | "REVERSADA_ADMIN"
  | "ANOMALIA_CONFIRMACION_TARDIA"
  | "EXPIRADA_LOCALMENTE";

export type TopUpRemoteStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "ERROR"
  | "VOIDED";

export type TopUpIncidentCode =
  | "VOID_AFTER_SPEND_DISPUTE"
  | "VOID_AFTER_CREDIT_COMPENSATED"
  | "LATE_APPROVAL_AFTER_VOID"
  | "DUPLICATE_TRANSACTION_FOR_ATTEMPT";

export class TopUpPolicyError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "TopUpPolicyError";
    this.code = code;
    this.status = status;
  }
}

export interface TopUpLimits {
  minCents: bigint;
  maxCents: bigint;
}

function parsePositiveBigInt(raw: string | undefined, fallback: bigint): bigint {
  if (typeof raw !== "string" || !/^[0-9]{1,15}$/.test(raw.trim())) return fallback;
  const v = BigInt(raw.trim());
  return v > 0n ? v : fallback;
}

/** Límites parametrizables por entorno (WALLET_TOPUP_MIN_CENTS / WALLET_TOPUP_MAX_CENTS). */
export function resolveTopUpLimits(
  env: Readonly<Record<string, string | undefined>> = process.env
): TopUpLimits {
  const minCents = parsePositiveBigInt(env.WALLET_TOPUP_MIN_CENTS, DEFAULT_TOPUP_MIN_CENTS);
  const maxCents = parsePositiveBigInt(env.WALLET_TOPUP_MAX_CENTS, DEFAULT_TOPUP_MAX_CENTS);
  if (minCents > maxCents) {
    return { minCents: DEFAULT_TOPUP_MIN_CENTS, maxCents: DEFAULT_TOPUP_MAX_CENTS };
  }
  return { minCents, maxCents };
}

/**
 * Convierte la entrada del cliente a BigInt centavos. Solo acepta string de dígitos
 * (o bigint). Rechaza number, decimales, signos, notación científica y ceros a la izquierda.
 */
export function parseTopUpAmountCents(raw: unknown): bigint {
  if (typeof raw === "bigint") {
    if (raw <= 0n) throw new TopUpPolicyError("El monto debe ser positivo.", "INVALID_TOPUP_AMOUNT");
    return raw;
  }
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,14}$/.test(raw.trim())) {
    throw new TopUpPolicyError(
      "El monto debe enviarse como cadena de dígitos en centavos COP.",
      "INVALID_TOPUP_AMOUNT"
    );
  }
  return BigInt(raw.trim());
}

export function assertTopUpWithinLimits(amountCents: bigint, limits: TopUpLimits): void {
  if (amountCents < limits.minCents || amountCents > limits.maxCents) {
    throw new TopUpPolicyError(
      `El monto de recarga debe estar entre ${limits.minCents.toString()} y ${limits.maxCents.toString()} centavos COP.`,
      "TOPUP_AMOUNT_OUT_OF_RANGE",
      422
    );
  }
}

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,60}$/;

export function validateTopUpIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string" || !IDEMPOTENCY_KEY_REGEX.test(raw.trim())) {
    throw new TopUpPolicyError(
      "La clave de idempotencia debe tener 8-60 caracteres [A-Za-z0-9_-].",
      "INVALID_IDEMPOTENCY_KEY"
    );
  }
  return raw.trim();
}

/** Clave global persistida: aísla por usuario para evitar colisiones entre clientes. */
export function buildScopedTopUpKey(usuarioId: string, clientKey: string): string {
  return `${usuarioId}:${clientKey}`;
}

export function buildTopUpCreditKey(recargaId: string): string {
  return `topup-credit-${recargaId}`;
}

export function buildTopUpVoidKey(recargaId: string): string {
  return `topup-void-${recargaId}`;
}

export interface TopUpTransitionInput {
  recargaEstado: TopUpRecargaState;
  incomingStatus: TopUpRemoteStatus;
  recargaAmountCents: bigint;
  walletBalanceCents: bigint;
  walletBlockedForDebit: boolean;
}

export type TopUpAction =
  | { kind: "NOOP"; reason: string }
  | { kind: "CREDIT"; nextState: "APROBADA" }
  | { kind: "REJECT"; nextState: "RECHAZADA" }
  | { kind: "VOID_PENDING"; nextState: "ANULADA_WOMPI" }
  | {
      kind: "VOID_COMPENSATE";
      nextState: "ANULADA_WOMPI";
      incident: "VOID_AFTER_CREDIT_COMPENSATED";
    }
  | {
      kind: "VOID_DISPUTE";
      nextState: "ANULADA_WOMPI";
      incident: "VOID_AFTER_SPEND_DISPUTE";
      disputeCents: bigint;
    }
  | {
      kind: "ANOMALY";
      nextState: "ANOMALIA_CONFIRMACION_TARDIA";
      incident: "LATE_APPROVAL_AFTER_VOID";
    };

/**
 * Matriz de transiciones de RecargaWallet. NUNCA acredita sin APPROVED canónico y
 * NUNCA permite saldo negativo: si el saldo ya fue gastado, abre disputa en lugar de descontar.
 */
export function evaluateTopUpTransition(input: TopUpTransitionInput): TopUpAction {
  const { recargaEstado: e, incomingStatus: s } = input;

  if (s === "PENDING") return { kind: "NOOP", reason: "REMOTE_STILL_PENDING" };

  if (s === "APPROVED") {
    // RECHAZADA + APPROVED: reintento legítimo dentro del mismo checkout Wompi (misma referencia
    // y monto verificados). El dinero fue capturado: se acredita una sola vez (clave idempotente).
    if (e === "PENDIENTE" || e === "EXPIRADA_LOCALMENTE" || e === "RECHAZADA") {
      return { kind: "CREDIT", nextState: "APROBADA" };
    }
    if (e === "ANULADA_WOMPI") {
      return {
        kind: "ANOMALY",
        nextState: "ANOMALIA_CONFIRMACION_TARDIA",
        incident: "LATE_APPROVAL_AFTER_VOID",
      };
    }
    return { kind: "NOOP", reason: "ALREADY_APPROVED_OR_UNDER_REVIEW" };
  }

  if (s === "DECLINED" || s === "ERROR") {
    if (e === "PENDIENTE" || e === "EXPIRADA_LOCALMENTE") {
      return { kind: "REJECT", nextState: "RECHAZADA" };
    }
    return { kind: "NOOP", reason: "STALE_REJECTION" };
  }

  // VOIDED
  if (e === "PENDIENTE" || e === "EXPIRADA_LOCALMENTE") {
    return { kind: "VOID_PENDING", nextState: "ANULADA_WOMPI" };
  }
  if (e === "APROBADA") {
    if (!input.walletBlockedForDebit && input.walletBalanceCents >= input.recargaAmountCents) {
      return {
        kind: "VOID_COMPENSATE",
        nextState: "ANULADA_WOMPI",
        incident: "VOID_AFTER_CREDIT_COMPENSATED",
      };
    }
    return {
      kind: "VOID_DISPUTE",
      nextState: "ANULADA_WOMPI",
      incident: "VOID_AFTER_SPEND_DISPUTE",
      disputeCents: input.recargaAmountCents,
    };
  }
  return { kind: "NOOP", reason: "VOID_ON_NON_APPROVED_STATE" };
}

export function isTopUpTerminalState(e: TopUpRecargaState): boolean {
  return e !== "PENDIENTE";
}
