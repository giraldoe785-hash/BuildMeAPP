"use client";

import React, { useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { KeyRound, ShieldCheck, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const OtpSecurityCard: React.FC = () => {
  const { activeOrder, validateOtpCode } = useFixiStore();
  const [testInput, setTestInput] = useState("");
  const [errorMessage, setErrorMessage] = useState(false);

  if (!activeOrder) return null;

  const handleSimulateTechInput = (e: React.FormEvent) => {
    e.preventDefault();
    const success = validateOtpCode(testInput.trim());
    if (!success) {
      setErrorMessage(true);
    } else {
      setErrorMessage(false);
      setTestInput("");
    }
  };

  return (
    <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200/60">
            <KeyRound className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs font-extrabold text-slate-900 block">
              Código OTP de Seguridad
            </span>
            <span className="text-[10px] text-slate-500">
              Protocolo de inicio de obra seguro
            </span>
          </div>
        </div>

        {activeOrder.isOtpValidated ? (
          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Validado
          </span>
        ) : (
          <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
            Pendiente de entrega
          </span>
        )}
      </div>

      {/* Big OTP Code Display */}
      <div className="p-3.5 bg-slate-900 text-white rounded-2xl flex items-center justify-between shadow-inner">
        <div>
          <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
            Tu Código de Verificación
          </span>
          <p className="text-2xl font-mono font-black tracking-[0.3em] text-emerald-400">
            {activeOrder.otpCode}
          </p>
        </div>

        <div className="max-w-[150px] text-right">
          <p className="text-[10px] text-slate-300 leading-tight">
            Entrégale este código al técnico al abrirle la puerta para habilitar el inicio.
          </p>
        </div>
      </div>

      {/* Simulator helper to validate OTP */}
      {!activeOrder.isOtpValidated && (
        <form
          onSubmit={handleSimulateTechInput}
          className="pt-2 border-t border-slate-100 flex items-center gap-2"
        >
          <input
            type="text"
            maxLength={4}
            value={testInput}
            onChange={(e) => {
              setTestInput(e.target.value);
              setErrorMessage(false);
            }}
            placeholder={`Probar código (${activeOrder.otpCode})`}
            className="flex-1 text-xs px-3 py-2 rounded-xl border border-slate-200 font-mono text-center focus:ring-2 focus:ring-emerald-500"
          />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="shrink-0 text-xs font-bold"
          >
            Validar PIN
          </Button>
        </form>
      )}

      {errorMessage && (
        <p className="text-[11px] text-rose-600 font-semibold flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          <span>Código incorrecto. Ingresa {activeOrder.otpCode} o 1234.</span>
        </p>
      )}
    </div>
  );
};
