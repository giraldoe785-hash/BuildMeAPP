"use client";

import React, { useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { CreditCard, ShieldCheck, Lock, Tag, ArrowLeft, Check, Sparkles, AlertCircle, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import confetti from "canvas-confetti";

export const StepPaymentHold: React.FC = () => {
  const {
    currentDiagnosis,
    paymentMethod,
    setPaymentMethod,
    applyPromoCode,
    promoCode,
    discountApplied,
    confirmBookingAndHoldFunds,
    setWizardStep,
  } = useFixiStore();

  const [inputCode, setInputCode] = useState(promoCode || "");
  const [promoMessage, setPromoMessage] = useState<string | null>(
    discountApplied > 0 ? "¡Cupón FIXI2026 aplicado con éxito (-$10.00 USD)!" : null
  );
  const [isProcessingHold, setIsProcessingHold] = useState(false);

  const baseInspection = 15.00;
  const laborEstimate = currentDiagnosis?.priceFixed || currentDiagnosis?.priceRangeMin || 48.50;
  const warrantyFee = 4.90;
  const subtotal = baseInspection + laborEstimate + warrantyFee;
  const totalHold = Math.max(0, subtotal - discountApplied);

  const handleApplyCode = (e: React.FormEvent) => {
    e.preventDefault();
    const success = applyPromoCode(inputCode);
    if (success) {
      setPromoMessage("¡Cupón aplicado correctamente! -$10.00 USD");
    } else {
      setPromoMessage("Código no válido. Prueba usando FIXI2026");
    }
  };

  const handleFinalConfirm = () => {
    setIsProcessingHold(true);

    // Launch celebratory confetti
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#10b981", "#059669", "#f59e0b", "#064e3b"],
      });
    } catch (e) {
      // ignore
    }

    setTimeout(() => {
      setIsProcessingHold(false);
      confirmBookingAndHoldFunds();
    }, 1600);
  };

  return (
    <div className="space-y-4">
      {/* Hold Policy Banner */}
      <div className="p-4 bg-emerald-950 text-white rounded-3xl border border-emerald-500/30 shadow-md relative overflow-hidden">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-300">
                Pre-autorización (Hold Seguro)
              </h4>
              <span className="text-[9px] bg-emerald-500/30 text-emerald-200 px-1.5 py-0.2 rounded font-mono">
                0% Comisión oculta
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
              Los fondos se retienen de forma segura en tu tarjeta. <strong>NO se cobrará nada</strong> hasta que el técnico concluya el trabajo y tú valides la satisfacción con tu firma digital.
            </p>
          </div>
        </div>
      </div>

      {/* Transparent Price Breakdown */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
        <span className="text-xs font-bold text-slate-900 block">
          Desglose Transparente de Tarifa
        </span>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Visita técnica & Diagnóstico en sitio</span>
            <span className="font-semibold text-slate-900">${baseInspection.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-slate-600">
            <span>
              Mano de obra estimada ({currentDiagnosis?.title.split(" ")[0]}...)
            </span>
            <span className="font-semibold text-slate-900">${laborEstimate.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-slate-600">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Garantía FixiCare® (90 días)</span>
            </span>
            <span className="font-semibold text-slate-900">${warrantyFee.toFixed(2)}</span>
          </div>

          {discountApplied > 0 && (
            <div className="flex justify-between text-emerald-700 font-bold bg-emerald-50 p-2 rounded-xl border border-emerald-200">
              <span>Cupón ({promoCode})</span>
              <span>-${discountApplied.toFixed(2)}</span>
            </div>
          )}

          <div className="pt-2.5 border-t border-slate-200 flex justify-between items-baseline">
            <div>
              <span className="text-xs font-bold text-slate-900 block">
                Total a Pre-autorizar (Hold)
              </span>
              <span className="text-[10px] text-slate-500">
                Se liquida con OTP al finalizar
              </span>
            </div>
            <span className="text-lg font-black text-emerald-700">
              ${totalHold.toFixed(2)} USD
            </span>
          </div>
        </div>

        {/* Promo code form */}
        <form onSubmit={handleApplyCode} className="pt-2 border-t border-slate-100 flex gap-2">
          <div className="relative flex-1">
            <Tag className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="Código cupón (ej: FIXI2026)"
              className="w-full text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 uppercase font-mono focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <Button type="submit" variant="secondary" size="md" className="shrink-0">
            Aplicar
          </Button>
        </form>

        {promoMessage && (
          <p
            className={`text-[11px] font-semibold ${
              discountApplied > 0 ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {promoMessage}
          </p>
        )}
      </div>

      {/* Payment Method Selector */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
        <span className="text-xs font-bold text-slate-900 block">
          Método de Pago
        </span>

        <div className="space-y-2">
          {/* Card */}
          <button
            type="button"
            onClick={() => setPaymentMethod("card")}
            className={`w-full flex items-center justify-between p-3 rounded-2xl border text-left transition-all ${
              paymentMethod === "card"
                ? "bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                : "bg-white border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
                <CreditCard className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Tarjeta Débito / Crédito</p>
                <p className="text-[11px] text-slate-500">•••• 8821 (Visa / Mastercard)</p>
              </div>
            </div>
            {paymentMethod === "card" && (
              <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                <Check className="w-3 h-3" />
              </span>
            )}
          </button>

          {/* Apple Pay / Google Pay */}
          <button
            type="button"
            onClick={() => setPaymentMethod("apple_pay")}
            className={`w-full flex items-center justify-between p-3 rounded-2xl border text-left transition-all ${
              paymentMethod === "apple_pay"
                ? "bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                : "bg-white border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold text-xs">
                 Pay
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Apple Pay / Google Pay</p>
                <p className="text-[11px] text-slate-500">Autorización biométrica instantánea</p>
              </div>
            </div>
            {paymentMethod === "apple_pay" && (
              <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                <Check className="w-3 h-3" />
              </span>
            )}
          </button>

          {/* Fixi Wallet */}
          <button
            type="button"
            onClick={() => setPaymentMethod("fixi_wallet")}
            className={`w-full flex items-center justify-between p-3 rounded-2xl border text-left transition-all ${
              paymentMethod === "fixi_wallet"
                ? "bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                : "bg-white border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Fixi Wallet</p>
                <p className="text-[11px] text-emerald-700 font-semibold">Saldo disponible: $120.00 USD</p>
              </div>
            </div>
            {paymentMethod === "fixi_wallet" && (
              <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                <Check className="w-3 h-3" />
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex gap-2 pt-2">
        <Button
          variant="secondary"
          size="lg"
          className="w-1/3 flex items-center justify-center gap-1.5"
          onClick={() => setWizardStep(2)}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Atrás</span>
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="w-2/3 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30"
          isLoading={isProcessingHold}
          onClick={handleFinalConfirm}
        >
          <Lock className="w-4 h-4" />
          <span>Confirmar & Retener Fondos</span>
        </Button>
      </div>
    </div>
  );
};
