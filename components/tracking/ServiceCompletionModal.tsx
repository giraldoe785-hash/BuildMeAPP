"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useFixiStore } from "@/store/useFixiStore";
import { Star, ShieldCheck, CheckCircle2, Award, Heart, Receipt, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import confetti from "canvas-confetti";

export const ServiceCompletionModal: React.FC = () => {
  const {
    isCompletionModalOpen,
    setCompletionModalOpen,
    activeOrder,
    completeServiceAndReview,
    resetOrder,
  } = useFixiStore();

  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [selectedTip, setSelectedTip] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasFinished, setHasFinished] = useState(false);

  if (!activeOrder) return null;

  const technician = activeOrder.technician;
  const pricing = activeOrder.pricing;

  const handleFinishReview = () => {
    setIsSubmitting(true);
    try {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.5 },
      });
    } catch (e) {
      // ignore
    }

    setTimeout(() => {
      completeServiceAndReview(stars, comment, selectedTip);
      setIsSubmitting(false);
      setHasFinished(true);
    }, 1200);
  };

  return (
    <Modal
      isOpen={isCompletionModalOpen}
      onClose={() => {
        setCompletionModalOpen(false);
        if (hasFinished) resetOrder();
      }}
      title={
        <div className="flex items-center gap-2 text-emerald-700">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <span>¡Servicio Finalizado con Éxito!</span>
        </div>
      }
      description="Tu reparación ha concluido y el cobro ha sido liquidado correctamente"
    >
      <div className="space-y-4">
        {!hasFinished ? (
          <>
            {/* Payment Liquidation Receipt Banner */}
            <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                  Cobro Liquidado (Hold Liberado)
                </span>
                <p className="text-sm font-black text-slate-900">
                  ${pricing.total.toFixed(2)} USD
                </p>
                <p className="text-[10px] text-slate-500">
                  Facturado a Tarjeta •••• {pricing.last4Card}
                </p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                <Receipt className="w-5 h-5" />
              </div>
            </div>

            {/* Specialist Rating */}
            <div className="text-center space-y-2 pt-1">
              <img
                src={technician.avatar}
                alt={technician.name}
                className="w-16 h-16 rounded-full mx-auto object-cover border-2 border-emerald-500 shadow-sm"
              />
              <div>
                <h4 className="text-xs font-bold text-slate-900">
                  ¿Cómo calificarías el trabajo de {technician.name}?
                </h4>
                <p className="text-[11px] text-slate-500">Tu opinión mantiene la calidad Fixi</p>
              </div>

              {/* Star selector */}
              <div className="flex items-center justify-center gap-1.5 py-1">
                {[1, 2, 3, 4, 5].map((starVal) => (
                  <button
                    key={starVal}
                    type="button"
                    onClick={() => setStars(starVal)}
                    className="p-1 text-amber-400 hover:scale-125 transition-transform"
                  >
                    <Star
                      className={`w-7 h-7 ${
                        starVal <= stars
                          ? "fill-amber-400 text-amber-400"
                          : "text-slate-200 fill-slate-100"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Comment */}
            <div>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Escribe un comentario opcional..."
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
              />
            </div>

            {/* Tip Options */}
            <div>
              <span className="block text-[11px] font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                <span>Agregar Propina al Especialista (Opcional):</span>
              </span>
              <div className="grid grid-cols-4 gap-1.5 text-xs font-bold">
                {[0, 2, 3, 5].map((tip) => (
                  <button
                    key={tip}
                    type="button"
                    onClick={() => setSelectedTip(tip)}
                    className={`py-2 rounded-xl border text-center transition-all ${
                      selectedTip === tip
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {tip === 0 ? "Sin propina" : `+$${tip}`}
                  </button>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="pt-2">
              <Button
                variant="primary"
                size="lg"
                className="w-full flex items-center justify-center gap-2"
                isLoading={isSubmitting}
                onClick={handleFinishReview}
              >
                <Award className="w-4 h-4" />
                <span>Enviar Calificación & Obtener Certificado</span>
              </Button>
            </div>
          </>
        ) : (
          /* Final Digital Warranty Certificate */
          <div className="space-y-4 text-center">
            <div className="p-5 bg-gradient-to-b from-slate-900 to-emerald-950 text-white rounded-3xl border border-emerald-500/40 shadow-xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
                <ShieldCheck className="w-7 h-7" />
              </div>

              <div>
                <span className="text-[10px] font-mono tracking-widest text-emerald-300 uppercase">
                  Certificado de Garantía Oficial
                </span>
                <h3 className="text-base font-black text-white">
                  FixiCare Protection 90 Días
                </h3>
                <p className="text-xs font-mono text-emerald-400 mt-0.5">
                  ID: FC-9831049
                </p>
              </div>

              <div className="p-3 bg-white/10 rounded-2xl text-[11px] text-slate-200 text-left space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Servicio:</span>
                  <span className="font-bold text-white">{activeOrder.diagnosis.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Técnico Certificado:</span>
                  <span className="font-bold text-white">{technician.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vigencia:</span>
                  <span className="font-bold text-emerald-300">90 días a partir de hoy</span>
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => {
                setCompletionModalOpen(false);
                resetOrder();
              }}
            >
              Volver al Inicio
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};
