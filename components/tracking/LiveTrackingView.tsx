"use client";

import React from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { InteractiveMap } from "./InteractiveMap";
import { StatusStepper } from "./StatusStepper";
import { OtpSecurityCard } from "./OtpSecurityCard";
import { TechnicianSheet } from "./TechnicianSheet";
import { LiveChatModal } from "./LiveChatModal";
import { ExtraCostApprovalModal } from "./ExtraCostApprovalModal";
import { ServiceCompletionModal } from "./ServiceCompletionModal";
import { ArrowLeft, Sparkles, ShieldCheck, MapPin, Receipt, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const LiveTrackingView: React.FC = () => {
  const { activeOrder, setActiveTab, startWizard } = useFixiStore();

  if (!activeOrder) {
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col relative pb-28">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("home")}
            className="p-1.5 -ml-1 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-xs font-extrabold text-slate-900">
                Seguimiento en Vivo #{activeOrder.id}
              </h2>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Creado a las {activeOrder.createdAt}
            </span>
          </div>
        </div>

        <span className="text-[10px] bg-slate-900 text-white font-mono px-2 py-0.5 rounded-full font-bold">
          {activeOrder.urgencyType === "immediate" ? "⚡ Despacho Inmediato" : "📅 Programado"}
        </span>
      </header>

      {/* Interactive Uber-style Map */}
      <InteractiveMap />

      {/* Main Content Info Cards */}
      <div className="p-4 space-y-3 -mt-4 relative z-20">
        {/* Barometer */}
        <StatusStepper />

        {/* OTP Security Verification Box */}
        <OtpSecurityCard />

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
              src={activeOrder.diagnosis.thumbnailUrl}
              alt={activeOrder.diagnosis.title}
              className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
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

          {/* Pricing Status & Hold Info */}
          <div className="flex items-center justify-between text-xs pt-1">
            <div className="flex items-center gap-1 text-slate-600">
              <Receipt className="w-3.5 h-3.5 text-emerald-600" />
              <span>Monto Pre-autorizado:</span>
            </div>
            <span className="font-extrabold text-slate-900">
              ${activeOrder.pricing.total.toFixed(2)} USD
            </span>
          </div>
        </div>

        {/* Floating Bottom Sheet */}
        <TechnicianSheet />
      </div>

      {/* Modals */}
      <LiveChatModal />
      <ExtraCostApprovalModal />
      <ServiceCompletionModal />
    </div>
  );
};
