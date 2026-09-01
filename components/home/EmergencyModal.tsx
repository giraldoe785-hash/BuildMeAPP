"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useFixiStore } from "@/store/useFixiStore";
import { Flame, PhoneCall, Zap, Droplets, KeyRound, Wind, AlertTriangle, ShieldCheck } from "lucide-react";
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

  const handleInstantEmergencyDispatch = () => {
    setIsDispatching(true);
    setTimeout(() => {
      setIsDispatching(false);
      setEmergencyModalOpen(false);
      // Fast dispatch straight to live tracking
      confirmBookingAndHoldFunds();
    }, 1500);
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

        {/* Action Buttons */}
        <div className="pt-2 space-y-2">
          <Button
            variant="emergency"
            size="lg"
            className="w-full flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30"
            isLoading={isDispatching}
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
