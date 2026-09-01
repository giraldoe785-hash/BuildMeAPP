"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { useFixiStore } from "@/store/useFixiStore";
import { AlertTriangle, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const ExtraCostApprovalModal: React.FC = () => {
  const {
    isExtraCostModalOpen,
    setExtraCostModalOpen,
    activeOrder,
    resolveExtraCost,
  } = useFixiStore();

  const pendingExtra = activeOrder?.extraCosts.find((c) => c.status === "pending");

  if (!pendingExtra) return null;

  return (
    <Modal
      isOpen={isExtraCostModalOpen}
      onClose={() => setExtraCostModalOpen(false)}
      title={
        <div className="flex items-center gap-2 text-amber-600">
          <AlertTriangle className="w-5 h-5" />
          <span>Aprobación de Ajuste Técnico</span>
        </div>
      }
      description="El especialista reporta un imprevisto detectado al desmontar componentes"
    >
      <div className="space-y-4">
        {/* Photo sent by technician */}
        {pendingExtra.photoUrl && (
          <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
            <img
              src={pendingExtra.photoUrl}
              alt="Evidencia técnica"
              className="w-full h-44 object-cover"
            />
            <span className="absolute bottom-2 left-2 bg-slate-900/80 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
              📷 Foto enviada por el técnico
            </span>
          </div>
        )}

        {/* Description & Cost */}
        <div className="p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-2xl space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
            Detalle del Imprevisto Técnico:
          </span>
          <p className="text-xs text-slate-800 font-medium leading-relaxed">
            {pendingExtra.description}
          </p>

          <div className="pt-2 border-t border-amber-200/60 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              Costo Adicional Requerido:
            </span>
            <span className="text-base font-black text-amber-900">
              +${pendingExtra.amount.toFixed(2)} USD
            </span>
          </div>
        </div>

        {/* Fixi Protection reassurance */}
        <div className="flex items-center gap-2 text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Este ajuste se sumará a la pre-autorización y contará con los mismos 90 días de garantía FixiCare.
          </span>
        </div>

        {/* Action Buttons: Approve vs Reject */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="danger"
            size="md"
            className="w-1/2 flex items-center justify-center gap-1.5"
            onClick={() => resolveExtraCost(pendingExtra.id, false)}
          >
            <XCircle className="w-4 h-4" />
            <span>Rechazar</span>
          </Button>

          <Button
            variant="primary"
            size="md"
            className="w-1/2 flex items-center justify-center gap-1.5"
            onClick={() => resolveExtraCost(pendingExtra.id, true)}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Aprobar Ajuste</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
