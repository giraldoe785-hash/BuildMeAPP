"use client";

import React from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { Search, Navigation, Wrench, CheckCircle2, AlertCircle } from "lucide-react";
import { OrderStatus } from "@/types";

interface StepConfig {
  key: OrderStatus;
  label: string;
  subLabel: string;
  icon: React.ElementType;
}

const STAGES: StepConfig[] = [
  {
    key: "finding_tech",
    label: "Buscando",
    subLabel: "Asignando especialista",
    icon: Search,
  },
  {
    key: "on_the_way",
    label: "En Camino",
    subLabel: "Llegada en ~12 min",
    icon: Navigation,
  },
  {
    key: "in_progress",
    label: "En Trabajo",
    subLabel: "Reparando en sitio",
    icon: Wrench,
  },
  {
    key: "completed",
    label: "Finalizado",
    subLabel: "Garantía activada",
    icon: CheckCircle2,
  },
];

export const StatusStepper: React.FC = () => {
  const { activeOrder, setOrderStatus } = useFixiStore();

  const currentStatus = activeOrder?.status || "finding_tech";

  const getStepIndex = (status: OrderStatus) => {
    switch (status) {
      case "finding_tech":
        return 0;
      case "on_the_way":
        return 1;
      case "in_progress":
        return 2;
      case "completed":
        return 3;
      default:
        return 0;
    }
  };

  const currentIndex = getStepIndex(currentStatus);

  return (
    <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
          Barómetro de Estado del Servicio
        </span>
        <span className="text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
          Etapa {currentIndex + 1} de 4
        </span>
      </div>

      {/* 4-Stage Stepper Bar */}
      <div className="relative flex items-center justify-between pt-1 pb-1">
        {/* Background Connecting Line */}
        <div className="absolute left-6 right-6 top-5 h-1 bg-slate-100 -translate-y-1/2 z-0" />

        {/* Active Filled Progress Line */}
        <div
          style={{ width: `${(currentIndex / 3) * 100}%` }}
          className="absolute left-6 top-5 h-1 bg-emerald-600 -translate-y-1/2 z-0 transition-all duration-500 ease-out"
        />

        {/* Step Nodes */}
        {STAGES.map((stage, idx) => {
          const isPassed = currentIndex > idx;
          const isCurrent = currentIndex === idx;
          const Icon = stage.icon;

          return (
            <div
              key={stage.key}
              className="relative z-10 flex flex-col items-center text-center max-w-[72px]"
            >
              <div
                className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                  isPassed
                    ? "bg-emerald-600 text-white shadow-xs"
                    : isCurrent
                    ? "bg-emerald-600 text-white ring-4 ring-emerald-500/25 shadow-md scale-110"
                    : "bg-slate-100 text-slate-400 border border-slate-200"
                }`}
              >
                <Icon className={`w-4 h-4 ${isCurrent && stage.key === "finding_tech" ? "animate-spin" : ""}`} />
              </div>

              <span
                className={`text-[11px] font-bold mt-2 leading-tight ${
                  isCurrent
                    ? "text-emerald-800"
                    : isPassed
                    ? "text-slate-800"
                    : "text-slate-400"
                }`}
              >
                {stage.label}
              </span>

              <span className="text-[9px] text-slate-400 mt-0.5 leading-tight line-clamp-1">
                {stage.subLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
