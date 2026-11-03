"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DeviceFrame } from "@/components/layout/DeviceFrame";
import { Button } from "@/components/ui/Button";
import { useFixiStore } from "@/store/useFixiStore";
import {
  WompiCheckoutClientError,
  redirectOrderToWompiCheckout,
} from "@/lib/wompiCheckoutClient";
import type { CanonicalTransitionOutcome } from "@/lib/wompiService";
import type { CanonicalTopUpOutcome } from "@/lib/walletTopUpService";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Home,
  RefreshCw,
  ShieldAlert,
  Wallet,
  WifiOff,
  XCircle,
} from "lucide-react";

const MAX_PENDING_POLLS = 5;
const PENDING_POLL_INTERVAL_MS = 3000;
const TX_ID_FORMAT = /^[a-zA-Z0-9_-]{10,64}$/;

type VerificationViewState =
  | { kind: "loading"; attempt: number }
  | {
      kind: "resolved";
      outcome: CanonicalTransitionOutcome | CanonicalTopUpOutcome;
      pollExhausted: boolean;
    }
  | { kind: "network_error"; message: string; code?: string }
  | { kind: "fatal_error"; message: string; code?: string };

function PaymentResultSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
        <RefreshCw className="w-8 h-8 animate-spin" />
      </div>
      <div className="space-y-1.5 max-w-xs">
        <h1 className="text-sm font-extrabold text-slate-900">
          Verificando tu pago con Wompi...
        </h1>
        <p className="text-xs text-slate-500">
          Consultando de forma segura el estado canónico de tu transacción en Sandbox.
        </p>
      </div>
    </div>
  );
}

function PaymentResultContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTxId = searchParams.get("id")?.trim() ?? "";

  const { fetchActiveOrder, setActiveTab } = useFixiStore();

  const [viewState, setViewState] = useState<VerificationViewState>({
    kind: "loading",
    attempt: 1,
  });
  const [isRetryingCheckout, setIsRetryingCheckout] = useState(false);
  const [retryCheckoutError, setRetryCheckoutError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const runVerification = useCallback(
    async (attemptNumber: number) => {
      if (!rawTxId || !TX_ID_FORMAT.test(rawTxId)) {
        setViewState({
          kind: "fatal_error",
          code: "INVALID_TRANSACTION_ID",
          message:
            "No se recibió un identificador de transacción válido desde la pasarela de pago.",
        });
        return;
      }

      clearTimers();
      const controller = new AbortController();
      abortRef.current = controller;

      setViewState((prev) =>
        prev.kind === "resolved"
          ? prev
          : { kind: "loading", attempt: attemptNumber }
      );

      try {
        const res = await fetch("/api/payments/wompi/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({ transactionId: rawTxId }),
        });

        const data: unknown = await res.json().catch(() => null);
        if (!mountedRef.current || controller.signal.aborted) return;

        const body =
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : null;

        if (!res.ok || !body || body.success !== true || !body.outcome) {
          const code =
            body && typeof body.code === "string" ? body.code : undefined;
          const message =
            body && typeof body.message === "string"
              ? body.message
              : "No fue posible verificar la transacción en este momento.";
          const isTransient =
            Boolean(body?.retryable) ||
            res.status === 429 ||
            res.status === 502 ||
            res.status === 503 ||
            res.status >= 500;

          if (isTransient) {
            setViewState({
              kind: "network_error",
              code,
              message,
            });
          } else {
            setViewState({
              kind: "fatal_error",
              code,
              message,
            });
          }
          return;
        }

        const outcome = body.outcome as CanonicalTransitionOutcome | CanonicalTopUpOutcome;

        // Sincronizar orden activa en Zustand cuando el estado ya es definitivo o capturado (solo si es orden)
        if ("orderPaymentStatus" in outcome && outcome.providerStatus !== "PENDING") {
          try {
            await fetchActiveOrder();
          } catch {
            // No bloquear la pantalla de resultado si falla el refresco secundario del store
          }
        }

        if (!mountedRef.current || controller.signal.aborted) return;

        if (outcome.providerStatus === "PENDING") {
          if (attemptNumber < MAX_PENDING_POLLS) {
            setViewState({
              kind: "resolved",
              outcome,
              pollExhausted: false,
            });
            pollTimerRef.current = setTimeout(() => {
              if (mountedRef.current) {
                void runVerification(attemptNumber + 1);
              }
            }, PENDING_POLL_INTERVAL_MS);
          } else {
            setViewState({
              kind: "resolved",
              outcome,
              pollExhausted: true,
            });
          }
          return;
        }

        setViewState({
          kind: "resolved",
          outcome,
          pollExhausted: false,
        });
      } catch (err) {
        if (!mountedRef.current) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setViewState({
          kind: "network_error",
          code: "CONNECTION_ERROR",
          message:
            "Tuvimos un inconveniente de conexión al consultar tu pago. Tu transacción NO ha sido marcada como rechazada; puedes reintentar la verificación.",
        });
      }
    },
    [clearTimers, fetchActiveOrder, rawTxId]
  );

  useEffect(() => {
    mountedRef.current = true;
    void runVerification(1);
    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [runVerification, clearTimers]);

  const handleGoToTracking = () => {
    setActiveTab("tracking");
    router.push("/");
  };

  const handleGoHome = () => {
    setActiveTab("home");
    router.push("/");
  };

  const handleGoProfile = () => {
    setActiveTab("profile");
    router.push("/");
  };

  const handleGoWizard = () => {
    setActiveTab("wizard");
    router.push("/");
  };

  const handleRetryPayment = async (orderId: string) => {
    if (isRetryingCheckout) return;
    setIsRetryingCheckout(true);
    setRetryCheckoutError(null);
    try {
      await redirectOrderToWompiCheckout(orderId);
    } catch (err) {
      const msg =
        err instanceof WompiCheckoutClientError
          ? err.message
          : "No fue posible iniciar un nuevo intento de pago.";
      setRetryCheckoutError(msg);
      setIsRetryingCheckout(false);
    }
  };

  if (viewState.kind === "loading") {
    return (
      <div
        className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center space-y-4"
        aria-live="polite"
      >
        <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
          <RefreshCw className="w-8 h-8 animate-spin" />
        </div>
        <div className="space-y-1.5 max-w-xs">
          <h1 className="text-sm font-extrabold text-slate-900">
            Confirmando tu pago en Wompi Sandbox...
          </h1>
          <p className="text-xs text-slate-500">
            Verificación autenticada con el servidor (intento {viewState.attempt} de{" "}
            {MAX_PENDING_POLLS}).
          </p>
        </div>
      </div>
    );
  }

  if (viewState.kind === "network_error") {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center p-6 space-y-5">
        <div
          role="alert"
          className="bg-white rounded-3xl p-6 border border-amber-200 shadow-sm space-y-4 text-center"
        >
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <WifiOff className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
              Verificación Pendiente de Red
            </span>
            <h1 className="text-base font-extrabold text-slate-900">
              No pudimos confirmar el estado en este instante
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {viewState.message}
            </p>
          </div>

          <div className="pt-2 space-y-2">
            <Button
              variant="primary"
              size="lg"
              className="w-full flex items-center justify-center gap-2"
              onClick={() => void runVerification(1)}
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reintentar verificación</span>
            </Button>
            <Button
              variant="secondary"
              size="md"
              className="w-full flex items-center justify-center gap-2"
              onClick={handleGoToTracking}
            >
              <span>Ver estado de mi orden</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (viewState.kind === "fatal_error") {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center p-6 space-y-5">
        <div
          role="alert"
          className="bg-white rounded-3xl p-6 border border-rose-200 shadow-sm space-y-4 text-center"
        >
          <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-base font-extrabold text-slate-900">
              No se pudo validar la transacción
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {viewState.message}
            </p>
          </div>

          <div className="pt-2 space-y-2">
            <Button
              variant="primary"
              size="lg"
              className="w-full flex items-center justify-center gap-2"
              onClick={handleGoToTracking}
            >
              <span>Ir a mi solicitud</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="md"
              className="w-full flex items-center justify-center gap-2"
              onClick={handleGoHome}
            >
              <Home className="w-4 h-4" />
              <span>Volver al inicio</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { outcome, pollExhausted } = viewState;
  const isTopUp = "kind" in outcome && outcome.kind === "TOPUP";
  const topUpOutcome = isTopUp ? (outcome as CanonicalTopUpOutcome) : null;
  const orderOutcome = !isTopUp ? (outcome as CanonicalTransitionOutcome) : null;

  const isApproved = isTopUp
    ? topUpOutcome!.providerStatus === "APPROVED" || topUpOutcome!.recargaEstado === "APROBADA"
    : orderOutcome!.orderPaymentStatus === "CAPTURADO" &&
      (orderOutcome!.intentStatus === "APROBADO" || orderOutcome!.providerStatus === "APPROVED");

  const isPending = outcome.providerStatus === "PENDING";
  const isConciliation = !isTopUp && orderOutcome!.intentStatus === "PENDIENTE_CONCILIACION";

  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col justify-center p-5 space-y-4"
      aria-live="polite"
    >
      <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-md space-y-5">
        {/* Cabecera según estado canónico */}
        {isTopUp ? (
          isApproved ? (
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <span className="inline-block text-[10px] font-mono uppercase font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Recarga Aprobada • Fixi Wallet
              </span>
              <h1 className="text-lg font-black text-slate-900">
                ¡Recarga exitosa!
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                Los fondos han sido acreditados de forma segura a tu saldo digital Fixi Wallet.
              </p>
            </div>
          ) : isPending ? (
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                <Clock className="w-8 h-8 animate-pulse" />
              </div>
              <span className="inline-block text-[10px] font-mono uppercase font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                En Procesamiento Bancario
              </span>
              <h1 className="text-lg font-black text-slate-900">
                Tu recarga sigue en validación
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                {pollExhausted
                  ? "Wompi aún reporta la transacción como PENDIENTE. Puedes actualizar en unos segundos para verificar tu nuevo saldo."
                  : "Estamos consultando automáticamente a Wompi cada 3 segundos para confirmar la acreditación..."}
              </p>
            </div>
          ) : (
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200">
                <XCircle className="w-9 h-9" />
              </div>
              <span className="inline-block text-[10px] font-mono uppercase font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
                Estado Wompi: {outcome.providerStatus}
              </span>
              <h1 className="text-lg font-black text-slate-900">
                La recarga no pudo completarse
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                La transacción finalizó con estado <strong>{outcome.providerStatus}</strong>. No se realizó ningún cargo.
              </p>
            </div>
          )
        ) : isApproved ? (
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <span className="inline-block text-[10px] font-mono uppercase font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              Pago Aprobado • Wompi Sandbox
            </span>
            <h1 className="text-lg font-black text-slate-900">
              ¡Pago confirmado con éxito!
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Tu orden <strong>#{orderOutcome?.orderNumber}</strong> ya está habilitada y
              visible en el radar de especialistas verificados.
            </p>
          </div>
        ) : isPending ? (
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
              <Clock className="w-8 h-8 animate-pulse" />
            </div>
            <span className="inline-block text-[10px] font-mono uppercase font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
              En Procesamiento Bancario
            </span>
            <h1 className="text-lg font-black text-slate-900">
              Tu pago sigue en validación
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {pollExhausted
                ? "Wompi Sandbox aún reporta la transacción como PENDIENTE. Puedes actualizar manualmente en unos segundos; en cuanto se confirme se activará el despacho."
                : "Estamos consultando automáticamente a Wompi cada 3 segundos para confirmar la respuesta del emisor..."}
            </p>
          </div>
        ) : isConciliation ? (
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <span className="inline-block text-[10px] font-mono uppercase font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
              Revisión Financiera Automática
            </span>
            <h1 className="text-lg font-black text-slate-900">
              Transacción registrada en conciliación
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {orderOutcome?.orderPaymentStatus === "CAPTURADO"
                ? `Tu orden #${orderOutcome.orderNumber} ya cuenta con un pago principal confirmado y nuestro equipo de soporte revisará esta transacción adicional automáticamente.`
                : `Registramos una novedad de estado en la pasarela para la orden #${orderOutcome?.orderNumber}. Nuestro equipo de soporte financiero ya fue notificado.`}
            </p>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200">
              <XCircle className="w-9 h-9" />
            </div>
            <span className="inline-block text-[10px] font-mono uppercase font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
              Estado Wompi: {outcome.providerStatus}
            </span>
            <h1 className="text-lg font-black text-slate-900">
              El pago no pudo completarse
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              La transacción finalizó con estado{" "}
              <strong>{outcome.providerStatus}</strong>. No se ha asignado ningún
              técnico todavía; puedes generar un nuevo intento de pago seguro para tu
              orden <strong>#{orderOutcome?.orderNumber}</strong>.
            </p>
          </div>
        )}

        {/* Resumen verificable de la transacción */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-2 text-xs">
          {isTopUp ? (
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Destino</span>
              <span className="font-mono font-bold text-slate-900">
                Fixi Wallet
              </span>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Orden de servicio</span>
              <span className="font-mono font-bold text-slate-900">
                #{orderOutcome?.orderNumber}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-slate-500">
              {isTopUp ? "Monto acreditado" : "Monto verificado"}
            </span>
            <span className="font-extrabold text-emerald-700">
              {outcome.formattedAmountCop}
            </span>
          </div>
          <div className="flex justify-between items-center gap-3">
            <span className="text-slate-500 shrink-0">Referencia Wompi</span>
            <span className="font-mono text-[11px] text-slate-700 truncate">
              {outcome.reference}
            </span>
          </div>
          <div className="flex justify-between items-center gap-3">
            <span className="text-slate-500 shrink-0">ID Transacción</span>
            <span className="font-mono text-[11px] text-slate-700 truncate">
              {outcome.transactionId}
            </span>
          </div>
        </div>

        {retryCheckoutError && (
          <div
            role="alert"
            className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700 font-semibold"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{retryCheckoutError}</span>
          </div>
        )}

        {/* Acciones según resultado */}
        <div className="space-y-2 pt-1">
          {isTopUp ? (
            <>
              <Button
                variant="primary"
                size="lg"
                className="w-full flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
                onClick={handleGoProfile}
              >
                <Wallet className="w-4 h-4" />
                <span>Ver mi Billetera</span>
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="w-full flex items-center justify-center gap-2"
                onClick={handleGoWizard}
              >
                <Home className="w-4 h-4" />
                <span>Solicitar un Servicio</span>
              </Button>
            </>
          ) : isApproved ? (
            <Button
              variant="primary"
              size="lg"
              className="w-full flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
              onClick={handleGoToTracking}
            >
              <span>Ir al Seguimiento en Vivo</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : isPending ? (
            <>
              <Button
                variant="primary"
                size="lg"
                className="w-full flex items-center justify-center gap-2"
                onClick={() => void runVerification(1)}
              >
                <RefreshCw className="w-4 h-4" />
                <span>Actualizar estado ahora</span>
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="w-full flex items-center justify-center gap-2"
                onClick={handleGoToTracking}
              >
                <span>Ver estado de mi orden</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </>
          ) : isConciliation ? (
            <Button
              variant="primary"
              size="lg"
              className="w-full flex items-center justify-center gap-2"
              onClick={handleGoToTracking}
            >
              <span>Ir al estado de mi orden</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="lg"
                className="w-full flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
                isLoading={isRetryingCheckout}
                disabled={isRetryingCheckout}
                onClick={() => void handleRetryPayment(orderOutcome?.orderId || "")}
              >
                <CreditCard className="w-4 h-4" />
                <span>Reintentar Pago ({outcome.formattedAmountCop})</span>
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="w-full flex items-center justify-center gap-2"
                disabled={isRetryingCheckout}
                onClick={handleGoToTracking}
              >
                <span>Revisar detalles de mi orden</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PaymentResultPage() {
  return (
    <DeviceFrame>
      <main className="relative flex-1 flex flex-col min-h-full">
        <Suspense fallback={<PaymentResultSkeleton />}>
          <PaymentResultContent />
        </Suspense>
      </main>
    </DeviceFrame>
  );
}
