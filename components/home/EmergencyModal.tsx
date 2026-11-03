"use client";

import React, { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useFixiStore } from "@/store/useFixiStore";
import { computeOrderPricing } from "@/lib/pricing";
import { redirectOrderToWompiCheckout } from "@/lib/wompiCheckoutClient";
import { Flame, PhoneCall, Zap, Droplets, KeyRound, Wind, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

const EMERGENCY_TYPES = [
  {
    id: "em-electric",
    title: "Chispas / Cortocircuito / Humo",
    desc: "Riesgo de sobrecalentamiento en tablero o cables",
    icon: Zap,
    category: "electricidad",
    color: "text-amber-500 bg-amber-50 border-amber-200",
  },
  {
    id: "em-plumbing",
    title: "Inundación / Fuga desbordada",
    desc: "Rotura de tubería de presión o inundación activa",
    icon: Droplets,
    category: "plomeria",
    color: "text-blue-500 bg-blue-50 border-blue-200",
  },
  {
    id: "em-lock",
    title: "Quedé fuera de casa / Llave rota",
    desc: "Apertura urgente sin romper cerradura",
    icon: KeyRound,
    category: "cerrajeria",
    color: "text-emerald-500 bg-emerald-50 border-emerald-200",
  },
  {
    id: "em-gas",
    title: "Olor a Gas / Válvula con fuga",
    desc: "Cierre de línea y aseguramiento preventivo",
    icon: Wind,
    category: "plomeria",
    color: "text-orange-500 bg-orange-50 border-orange-200",
  },
];

export const EmergencyModal: React.FC = () => {
  const {
    isEmergencyModalOpen,
    setEmergencyModalOpen,
    startWizard,
    confirmBookingAndHoldFunds,
  } = useFixiStore();

  const [selectedEmergency, setSelectedEmergency] = useState<string>("em-electric");
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string>(
    `emg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const inFlightRef = useRef(false);

  const handleInstantEmergencyDispatch = async () => {
    if (inFlightRef.current || isDispatching) return;
    inFlightRef.current = true;
    setIsDispatching(true);
    setDispatchError(null);

    const emergencyDef =
      EMERGENCY_TYPES.find((e) => e.id === selectedEmergency) || EMERGENCY_TYPES[0];
    const emergencyPricing = computeOrderPricing({
      category: emergencyDef.category,
      presetId: null,
      promoCode: null,
    });

    useFixiStore.setState({
      selectedCategoryForWizard: emergencyDef.category as "electricidad" | "plomeria" | "cerrajeria",
      scheduleType: "immediate",
      paymentMethod: "card",
      promoCode: "",
      discountApplied: 0,
      currentDiagnosis: {
        title: `Emergencia 24/7: ${emergencyDef.title}`,
        confidenceScore: 98,
        confidenceLevel: "high",
        pricingType: "guaranteed_fixed",
        currency: "COP",
        isIndicative: false,
        budget: {
          inspectionAmountCop: Math.round(emergencyPricing.baseInspection * 1000),
          laborEstimateCop: Math.round(emergencyPricing.laborEstimate * 1000),
          materialsEstimateCop: 0,
          discountAmountCop: 0,
          totalEstimateCop: Math.round(emergencyPricing.total * 1000),
        },
        severity: "critica",
        rootCause: emergencyDef.desc,
        suggestedFix: `Despacho prioritario de guardia (${emergencyDef.title}). Aseguramiento inmediato y reparación en sitio.`,
        requiredMaterials: ["Kit de emergencia prioritaria"],
        estimatedHours: 1.5,
        priceFixed: emergencyPricing.laborEstimate,
        method: "Análisis_IA",
      },
    });

    try {
      const result = await confirmBookingAndHoldFunds(idempotencyKeyRef.current);
      if (!result.success || !result.order) {
        setDispatchError(
          result.error || "No fue posible despachar la solicitud de emergencia."
        );
        return;
      }

      idempotencyKeyRef.current = `emg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setEmergencyModalOpen(false);
      useFixiStore.getState().setActiveTab("tracking");

      const targetOrderUuid = result.order.dbId || result.order.id;
      try {
        await redirectOrderToWompiCheckout(targetOrderUuid);
      } catch {
        // Si la redirección automática no puede completarse, el cliente queda en
        // tracking sobre PendingPaymentTrackingCard para iniciar o reintentar el pago.
      }
    } finally {
      inFlightRef.current = false;
      setIsDispatching(false);
    }
  };

  return (
    <Modal
      isOpen={isEmergencyModalOpen}
      onClose={() => setEmergencyModalOpen(false)}
      title={
        <div className="flex items-center gap-2 text-orange-600">
          <Flame className="w-5 h-5 fill-orange-500 animate-pulse" />
          <span>Atención de Emergencia 24/7</span>
        </div>
      }
      description="Despacho prioritario con arribo garantizado en menos de 20-30 minutos"
    >
      <div className="space-y-4">
        {/* Banner with guarantee */}
        <div className="p-3.5 bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-200 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0 shadow-sm font-bold text-xs">
            15m
          </div>
          <div>
            <p className="text-xs font-bold text-slate-900">
              Red de Guardia Activa
            </p>
            <p className="text-[11px] text-slate-600">
              12 especialistas en guardia listos para salir inmediatamente a tu zona.
            </p>
          </div>
        </div>

        {/* Hazard options */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            ¿Cuál es la urgencia en tu hogar?
          </p>
          <div className="grid grid-cols-1 gap-2">
            {EMERGENCY_TYPES.map((item) => {
              const Icon = item.icon;
              const isSelected = selectedEmergency === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedEmergency(item.id)}
                  className={`flex items-start gap-3 p-3 rounded-2xl border text-left transition-all ${
                    isSelected
                      ? "bg-orange-50/70 border-orange-500 ring-2 ring-orange-500/20 shadow-xs"
                      : "bg-white hover:bg-slate-50 border-slate-200"
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${item.color}`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900">{item.title}</p>
                    <p className="text-[11px] text-slate-500">{item.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {dispatchError && (
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700 font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{dispatchError}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="pt-2 space-y-2">
          <Button
            variant="emergency"
            size="lg"
            className="w-full flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30"
            isLoading={isDispatching}
            disabled={isDispatching}
            onClick={handleInstantEmergencyDispatch}
          >
            <Flame className="w-5 h-5 fill-white" />
            <span>Despachar Especialista Inmediato</span>
          </Button>

          <a
            href="tel:+525541928831"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            <PhoneCall className="w-4 h-4 text-emerald-600" />
            <span>Llamar a Central de Emergencias Fixi</span>
          </a>
        </div>
      </div>
    </Modal>
  );
};
