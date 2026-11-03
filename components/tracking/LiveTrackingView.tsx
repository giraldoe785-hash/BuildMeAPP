"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { formatCatalogUnitsToCop } from "@/lib/pricing";
import {
  WompiCheckoutClientError,
  redirectOrderToWompiCheckout,
} from "@/lib/wompiCheckoutClient";
import { InteractiveMap } from "./InteractiveMap";
import { StatusStepper } from "./StatusStepper";
import { OtpSecurityCard } from "./OtpSecurityCard";
import { TechnicianSheet } from "./TechnicianSheet";
import { LiveChatModal } from "./LiveChatModal";
import { ExtraCostApprovalModal } from "./ExtraCostApprovalModal";
import { ServiceCompletionModal } from "./ServiceCompletionModal";
import {
  ArrowLeft,
  CreditCard,
  ExternalLink,
  Lock,
  MapPin,
  Receipt,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ActiveOrder } from "@/types";

interface PendingPaymentTrackingCardProps {
  order: ActiveOrder;
  totalCop: string;
  onSyncNow: () => void;
}

const PendingPaymentTrackingCard: React.FC<PendingPaymentTrackingCardProps> = ({
  order,
  totalCop,
  onSyncNow,
}) => {
  const [isLaunchingCheckout, setIsLaunchingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const isFailed = order.paymentStatus === "FALLIDO";
  const targetOrderUuid = order.dbId || order.id;

  const handleLaunchCheckout = async () => {
    if (isLaunchingCheckout) return;
    setIsLaunchingCheckout(true);
    setCheckoutError(null);
    try {
      await redirectOrderToWompiCheckout(targetOrderUuid);
    } catch (err) {
      const msg =
        err instanceof WompiCheckoutClientError
          ? err.message
          : "No fue posible abrir el checkout de Wompi Sandbox.";
      setCheckoutError(msg);
      setIsLaunchingCheckout(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div
        className={`rounded-3xl p-5 border shadow-sm space-y-4 ${
          isFailed
            ? "bg-white border-rose-200"
            : "bg-white border-amber-200"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
              isFailed
                ? "bg-rose-50 text-rose-600 border-rose-200"
                : "bg-amber-50 text-amber-600 border-amber-200"
            }`}
          >
            {isFailed ? (
              <ShieldAlert className="w-6 h-6" />
            ) : (
              <Lock className="w-5 h-5" />
            )}
          </div>
          <div className="space-y-1">
            <span
              className={`inline-block text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-full ${
                isFailed
                  ? "bg-rose-100 text-rose-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {isFailed
                ? "Pago Rechazado o Anulado"
                : "Confirmación de Pago Pendiente"}
            </span>
            <h3 className="text-sm font-extrabold text-slate-900">
              {isFailed
                ? "Genera un nuevo intento de pago para activar el despacho"
                : "Completa tu pago en Wompi para publicar la solicitud"}
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Por seguridad operativa, el radar GPS y la asignación de
              especialistas verificados se habilitan únicamente cuando Wompi
              confirma el estado <strong>CAPTURADO</strong> de tu orden.
            </p>
          </div>
        </div>

        <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Orden registrada</span>
            <span className="font-mono font-bold text-slate-900">
              #{order.id}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 shrink-0">Servicio</span>
            <span className="font-bold text-slate-800 truncate">
              {order.diagnosis.title}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
            <span className="font-semibold text-slate-700">
              Total a pagar (COP)
            </span>
            <span className="text-sm font-black text-emerald-700">
              {totalCop}
            </span>
          </div>
        </div>

        {checkoutError && (
          <div
            role="alert"
            className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700 font-semibold"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{checkoutError}</span>
          </div>
        )}

        <div className="space-y-2">
          <Button
            variant="primary"
            size="lg"
            className="w-full flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
            isLoading={isLaunchingCheckout}
            disabled={isLaunchingCheckout}
            onClick={() => void handleLaunchCheckout()}
          >
            {isFailed ? (
              <CreditCard className="w-4 h-4 shrink-0" />
            ) : (
              <ExternalLink className="w-4 h-4 shrink-0" />
            )}
            <span>
              {isFailed
                ? `Reintentar Pago (${totalCop}) en Wompi`
                : `Pagar ${totalCop} en Wompi`}
            </span>
          </Button>

          <Button
            variant="secondary"
            size="md"
            className="w-full flex items-center justify-center gap-2"
            disabled={isLaunchingCheckout}
            onClick={onSyncNow}
          >
            <RefreshCw className="w-4 h-4" />
            <span>Ya pagué • Sincronizar estado</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export const LiveTrackingView: React.FC = () => {
  const { activeOrder, setActiveTab, startWizard, fetchActiveOrder } = useFixiStore();
  const [isLoadingInitial, setIsLoadingInitial] = useState(!activeOrder);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [, setHasResolvedInitial] = useState(Boolean(activeOrder));
  const pollSeqRef = useRef(0);

  const executePoll = useCallback(
    async (signal?: AbortSignal, isInitial = false) => {
      const mySeq = ++pollSeqRef.current;
      if (isInitial && !activeOrder) {
        setIsLoadingInitial(true);
      }

      try {
        await fetchActiveOrder(signal);
        if (mySeq === pollSeqRef.current) {
          setConnectionError(null);
          setHasResolvedInitial(true);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (mySeq === pollSeqRef.current) {
          const msg =
            err instanceof Error && err.message
              ? err.message
              : "No fue posible conectar con el servidor para consultar tu orden.";
          setConnectionError(msg);
          setHasResolvedInitial(true);
        }
      } finally {
        if (mySeq === pollSeqRef.current) {
          setIsLoadingInitial(false);
        }
      }
    },
    [activeOrder, fetchActiveOrder]
  );

  useEffect(() => {
    let isMounted = true;
    let activeAbortController: AbortController | null = null;

    const triggerPoll = (isInitial: boolean) => {
      if (!isMounted) return;
      if (activeAbortController) {
        activeAbortController.abort();
      }
      const controller = new AbortController();
      activeAbortController = controller;
      void executePoll(controller.signal, isInitial);
    };

    // Consulta inicial incondicional para sincronizar con PostgreSQL
    triggerPoll(true);

    const isTerminal =
      activeOrder?.status === "completed" || activeOrder?.status === "cancelled";

    let intervalId: NodeJS.Timeout | null = null;
    if (!isTerminal) {
      intervalId = setInterval(() => {
        triggerPoll(false);
      }, 4000);
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
      if (activeAbortController) {
        activeAbortController.abort();
      }
    };
  }, [executePoll, activeOrder?.status]);

  if (!activeOrder) {
    if (isLoadingInitial) {
      return (
        <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <RefreshCw className="w-8 h-8 animate-spin" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Sincronizando estado de tu servicio...
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">
              Consultando en la red de BuildMeAPP si tienes una orden activa en curso.
            </p>
          </div>
        </div>
      );
    }

    if (connectionError) {
      return (
        <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Error de conexión con el servicio
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">
              {connectionError}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => void executePoll(undefined, true)}
            >
              Reintentar
            </Button>
            <Button variant="primary" size="md" onClick={() => startWizard()}>
              Solicitar Servicio con IA
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-16 h-16 rounded-3xl bg-slate-100 text-slate-400 flex items-center justify-center">
          <MapPin className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            No tienes servicios activos en este momento
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">
            Inicia un diagnóstico con IA o solicita un especialista para ver su seguimiento en tiempo real.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => startWizard()}>
          Solicitar Servicio con IA
        </Button>
      </div>
    );
  }

  let formattedTotalCop = `$ ${Math.round(
    activeOrder.pricing.total * 1000
  ).toLocaleString("es-CO")} COP`;
  try {
    formattedTotalCop = formatCatalogUnitsToCop(
      activeOrder.pricing.total.toFixed(2)
    );
  } catch {
    // fallback seguro ante redondeos locales
  }

  const isPaymentCaptured = activeOrder.paymentStatus === "CAPTURADO";
  const isUnassigned =
    activeOrder.status === "finding_tech" ||
    activeOrder.technician.id === "pending-payment" ||
    activeOrder.technician.id === "pending-assignment";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col relative pb-28">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("home")}
            className="p-1.5 -ml-1 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isPaymentCaptured
                    ? "bg-emerald-500 animate-pulse"
                    : "bg-amber-500"
                }`}
              />
              <h2 className="text-xs font-extrabold text-slate-900">
                {isPaymentCaptured
                  ? `Seguimiento en Vivo #${activeOrder.id}`
                  : `Orden #${activeOrder.id} • Pago Requerido`}
              </h2>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Creado a las {activeOrder.createdAt}
            </span>
          </div>
        </div>

        <span className="text-[10px] bg-slate-900 text-white font-mono px-2 py-0.5 rounded-full font-bold">
          {activeOrder.urgencyType === "immediate"
            ? "⚡ Despacho Inmediato"
            : "📅 Programado"}
        </span>
      </header>

      {!isPaymentCaptured && isUnassigned ? (
        <PendingPaymentTrackingCard
          order={activeOrder}
          totalCop={formattedTotalCop}
          onSyncNow={() => void executePoll(undefined, false)}
        />
      ) : (
        <>
          {/* Interactive Uber-style Map */}
          <InteractiveMap />

          {/* Main Content Info Cards */}
          <div className="p-4 space-y-3 -mt-4 relative z-20">
            {!isPaymentCaptured && (
              <div
                role="alert"
                className="p-4 rounded-3xl bg-rose-50 border border-rose-200 text-rose-900 space-y-1.5 shadow-xs"
              >
                <div className="flex items-center gap-2 font-extrabold text-xs">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Anomalía Financiera Detectada en Pasarela</span>
                </div>
                <p className="text-[11px] text-rose-800 leading-relaxed">
                  {activeOrder.status === "in_progress"
                    ? "Wompi reportó una novedad sobre el cobro con la intervención ya en curso. Puedes completar el cierre seguro del servicio mientras soporte concilia el pago."
                    : "El pago fue revocado o anulado por la pasarela después de la asignación. El inicio mediante código OTP se encuentra suspendido hasta revisión de soporte."}
                </p>
              </div>
            )}

            {/* Barometer */}
            <StatusStepper />

            {/* OTP Security Verification Box (solo habilitado con pago capturado o cierre controlado en trabajo) */}
            {(isPaymentCaptured || activeOrder.status === "in_progress") && (
              <OtpSecurityCard />
            )}

            {/* Active Service Details Card */}
            <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  Detalles de la Reparación
                </span>
                <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 uppercase">
                  {activeOrder.category}
                </span>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200/70">
                <img
                  src={
                    "thumbnailUrl" in activeOrder.diagnosis
                      ? activeOrder.diagnosis.thumbnailUrl
                      : "/buildme-logo.png"
                  }
                  alt={activeOrder.diagnosis.title}
                  className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0 bg-white"
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 line-clamp-1">
                    {activeOrder.diagnosis.title}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                    {activeOrder.diagnosis.suggestedFix}
                  </p>
                </div>
              </div>

              {/* Pricing Status & Payment Info in COP */}
              <div className="flex items-center justify-between text-xs pt-1">
                <div className="flex items-center gap-1 text-slate-600">
                  <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                  <span>
                    {isPaymentCaptured
                      ? "Pago Confirmado (Wompi):"
                      : "Estado de Pago (Revisión):"}
                  </span>
                </div>
                <span className="font-extrabold text-slate-900">
                  {formattedTotalCop}
                </span>
              </div>
            </div>

            {/* Floating Bottom Sheet */}
            <TechnicianSheet />
          </div>
        </>
      )}

      {/* Modals */}
      <LiveChatModal />
      <ExtraCostApprovalModal />
      <ServiceCompletionModal />
    </div>
  );
};
