"use client";

import React, { useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { Clock, ShieldCheck, CheckCircle2, ChevronRight, ArrowRight, Wrench, Receipt, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { UserSupportModal } from "@/components/support/UserSupportModal";

export const OrdersView: React.FC = () => {
  const { activeOrder, setActiveTab, startWizard, setCompletionModalOpen } = useFixiStore();
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [openCreateOnMount, setOpenCreateOnMount] = useState(false);

  const pastOrders = [
    {
      id: "FX-774192",
      date: "24 Ago 2026",
      category: "Plomería",
      title: "Reparación de válvula angular y cambio de mangueras de monomando",
      technician: "Raúl González",
      total: 48.50,
      status: "Finalizado",
      warrantyExpires: "22 Nov 2026",
      certificate: "FC-8819201",
    },
    {
      id: "FX-651029",
      date: "12 Jul 2026",
      category: "Cerrajería",
      title: "Cambio de cilindro europerfil de alta seguridad con 5 llaves",
      technician: "Andrés Silva",
      total: 55.00,
      status: "Finalizado",
      warrantyExpires: "10 Oct 2026",
      certificate: "FC-5491022",
    },
  ];

  const handleOpenSupport = (createImmediate: boolean) => {
    setOpenCreateOnMount(createImmediate);
    setIsSupportOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-4 pb-28 space-y-4">
      <header className="pt-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">
            Tus Servicios & Garantías
          </h2>
          <p className="text-xs text-slate-500">
            Historial de trabajos con cobertura FixiCare activa
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleOpenSupport(false)}
          className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-2xl shadow-xs transition-colors shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Soporte</span>
        </button>
      </header>

      {/* Active Order Card if any */}
      {activeOrder && (
        <div className="space-y-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Servicio Activo
          </span>
          <div className="p-4 bg-white rounded-3xl border-2 border-emerald-500 shadow-md space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full uppercase">
                {activeOrder.status}
              </span>
              <span className="text-xs font-mono font-bold text-slate-700">
                #{activeOrder.id}
              </span>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-900">
                {activeOrder.diagnosis.title}
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Especialista: {activeOrder.technician.name}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs font-black text-emerald-700">
                ${activeOrder.pricing.total.toFixed(2)} USD
              </span>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenSupport(true)}
                >
                  Reportar
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="flex items-center gap-1"
                  onClick={() => setActiveTab("tracking")}
                >
                  <span>Ver en Vivo</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Past Orders */}
      <div className="space-y-2">
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          Historial Completado
        </span>

        <div className="space-y-2.5">
          {pastOrders.map((order) => (
            <div
              key={order.id}
              className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  {order.category}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {order.date}
                </span>
              </div>

              <p className="text-xs text-slate-700 font-medium">
                {order.title}
              </p>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px]">
                <span className="text-emerald-700 font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Garantía activa hasta {order.warrantyExpires}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenSupport(true)}
                    className="text-[11px] font-bold text-emerald-700 hover:underline"
                  >
                    Solicitar soporte
                  </button>
                  <span className="font-extrabold text-slate-900">
                    ${order.total.toFixed(2)} USD
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <UserSupportModal
        isOpen={isSupportOpen}
        onClose={() => setIsSupportOpen(false)}
        initialOpenCreate={openCreateOnMount}
      />
    </div>
  );
};
