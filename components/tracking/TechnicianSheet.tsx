"use client";

import React from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { Phone, MessageSquare, ShieldCheck, Star, Car, Flame, AlertTriangle, ArrowRight, Play, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const TechnicianSheet: React.FC = () => {
  const {
    activeOrder,
    setChatModalOpen,
    setOrderStatus,
    simulateExtraCostProposal,
    setCompletionModalOpen,
    setEmergencyModalOpen,
  } = useFixiStore();

  if (!activeOrder) return null;

  const technician = activeOrder.technician;
  const status = activeOrder.status;

  return (
    <div className="bg-white rounded-t-3xl border-t border-x border-slate-200/80 shadow-2xl p-4 space-y-4">
      {/* Drag Indicator */}
      <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto" />

      {/* Technician Profile Row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <img
              src={technician.avatar}
              alt={technician.name}
              className="w-13 h-13 rounded-2xl object-cover border-2 border-emerald-500 shadow-sm"
            />
            <span className="absolute -bottom-1 -right-1 bg-emerald-600 text-white text-[9px] font-bold p-0.5 rounded-full ring-2 ring-white">
              <ShieldCheck className="w-3 h-3" />
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="text-xs font-extrabold text-slate-900 truncate">
                {technician.name}
              </h4>
            </div>
            <p className="text-[11px] text-slate-500 truncate">{technician.role}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="flex items-center text-amber-500 font-bold text-xs">
                <Star className="w-3.5 h-3.5 fill-amber-400 mr-0.5" />
                {technician.rating.toFixed(2)}
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-[11px] text-slate-600 font-medium font-mono">
                {technician.vehicle.type}: {technician.vehicle.plate}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Contact Buttons */}
        <div className="flex items-center gap-2">
          <a
            href={`tel:${technician.phone}`}
            className="w-10 h-10 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center justify-center transition-colors shadow-xs"
            title="Llamar al técnico"
          >
            <Phone className="w-4 h-4 text-emerald-600" />
          </a>

          <button
            onClick={() => setChatModalOpen(true)}
            className="relative w-10 h-10 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-md shadow-emerald-600/20 transition-colors"
            title="Abrir chat en vivo"
          >
            <MessageSquare className="w-4 h-4" />
            {activeOrder.chatMessages.length > 1 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-orange-500 ring-2 ring-white" />
            )}
          </button>
        </div>
      </div>

      {/* Primary Action / Simulation Toolbar */}
      <div className="pt-2 border-t border-slate-100 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
            Control de Simulación de Flujo:
          </span>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
            Estado: {status}
          </span>
        </div>

        {/* Dynamic action buttons based on status */}
        <div className="grid grid-cols-2 gap-2">
          {status === "finding_tech" && (
            <Button
              variant="primary"
              size="sm"
              className="col-span-2"
              onClick={() => setOrderStatus("on_the_way")}
            >
              <span>Simular: Técnico Asignado y en camino</span>
            </Button>
          )}

          {status === "on_the_way" && (
            <>
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={() => setOrderStatus("in_progress")}
              >
                <span>Técnico llega (Iniciar)</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setChatModalOpen(true)}
              >
                <span>Enviar Mensaje</span>
              </Button>
            </>
          )}

          {status === "in_progress" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
                onClick={simulateExtraCostProposal}
              >
                <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                <span>Simular Imprevisto (+$14.50)</span>
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setOrderStatus("completed");
                  setCompletionModalOpen(true);
                }}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                <span>Finalizar Trabajo</span>
              </Button>
            </>
          )}

          {status === "completed" && (
            <Button
              variant="primary"
              size="sm"
              className="col-span-2"
              onClick={() => setCompletionModalOpen(true)}
            >
              <span>Ver Recibo & Certificado FixiCare</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
