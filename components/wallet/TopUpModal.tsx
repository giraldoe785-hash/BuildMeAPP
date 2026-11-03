"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatWompiCentsToCop } from "@/lib/pricing";
import { submitWompiCheckoutForm } from "@/lib/wompiCheckoutClient";
import {
  Wallet,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Sparkles,
} from "lucide-react";

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalanceCop?: string;
  onSuccess?: () => void;
}

const PRESET_AMOUNTS = [
  { label: "$20.000 COP", cents: "2000000" },
  { label: "$50.000 COP", cents: "5000000" },
  { label: "$100.000 COP", cents: "10000000" },
  { label: "$200.000 COP", cents: "20000000" },
];

const MIN_CENTS = 1_000_000n; // $10.000 COP
const MAX_CENTS = 200_000_000n; // $2.000.000 COP

export const TopUpModal: React.FC<TopUpModalProps> = ({
  isOpen,
  onClose,
  currentBalanceCop,
  onSuccess,
}) => {
  const [selectedCents, setSelectedCents] = useState<string>("5000000");
  const [customCop, setCustomCop] = useState<string>("");
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const getActiveCentsBigInt = (): bigint | null => {
    if (isCustom) {
      const clean = customCop.replace(/\D/g, "");
      if (!clean) return null;
      try {
        // En pesos colombianos a centavos: valor * 100
        return BigInt(clean) * 100n;
      } catch {
        return null;
      }
    }
    return BigInt(selectedCents);
  };

  const activeCents = getActiveCentsBigInt();
  const isValidAmount =
    activeCents !== null &&
    activeCents >= MIN_CENTS &&
    activeCents <= MAX_CENTS;

  const handleSelectPreset = (cents: string) => {
    setIsCustom(false);
    setSelectedCents(cents);
    setErrorMessage(null);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    setCustomCop(raw);
    setIsCustom(true);
    setErrorMessage(null);
  };

  const handleInitiateTopUp = async () => {
    if (!activeCents || !isValidAmount || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);

    const idempotencyKey = `topup-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amountInCents: activeCents.toString(),
          idempotencyKey,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success || !data?.checkout) {
        setErrorMessage(
          data?.message ||
            "No fue posible iniciar la recarga. Inténtalo de nuevo."
        );
        setIsLoading(false);
        return;
      }

      if (onSuccess) {
        onSuccess();
      }

      // Redirige al checkout oficial de Wompi Sandbox
      submitWompiCheckoutForm(data.checkout);
    } catch (err: any) {
      console.error("[TopUpModal] Error:", err);
      setErrorMessage(
        "Error de conexión al preparar la pasarela Wompi. Verifica tu red."
      );
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Wallet className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900">
              Recargar Fixi Wallet
            </h3>
            <p className="text-[11px] text-slate-500">
              Saldo digital protegido para servicios Fixi
            </p>
          </div>
        </div>
      }
      maxWidth="md"
    >
      <div className="space-y-4 pt-1">
        {/* Current Balance Banner */}
        {currentBalanceCop && (
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Saldo actual disponible:</span>
            <span className="font-extrabold text-slate-900 font-mono">
              {currentBalanceCop}
            </span>
          </div>
        )}

        {/* Preset Amounts Grid */}
        <div>
          <label className="text-xs font-bold text-slate-900 block mb-2">
            Selecciona el monto a recargar
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_AMOUNTS.map((preset) => {
              const isSelected = !isCustom && selectedCents === preset.cents;
              return (
                <button
                  key={preset.cents}
                  type="button"
                  onClick={() => handleSelectPreset(preset.cents)}
                  className={`p-3 rounded-2xl border text-left font-bold text-xs transition-all ${
                    isSelected
                      ? "border-emerald-600 bg-emerald-50/80 text-emerald-800 ring-2 ring-emerald-500/20 shadow-xs"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{preset.label}</span>
                    {isSelected && (
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Amount Input */}
        <div>
          <label className="text-xs font-bold text-slate-900 block mb-1.5">
            O escribe otro monto en COP
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-2.5 text-xs font-bold text-slate-400">
              $
            </span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Ej: 35000"
              value={customCop}
              onChange={handleCustomChange}
              className={`w-full pl-8 pr-16 py-2.5 rounded-xl border text-xs font-mono font-bold transition-all focus:outline-none focus:ring-2 ${
                isCustom
                  ? "border-emerald-500 ring-2 ring-emerald-500/20 bg-white"
                  : "border-slate-200 bg-slate-50/50"
              }`}
            />
            <span className="absolute right-3 top-2.5 text-[10px] font-bold text-slate-400">
              COP
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            Mínimo: $10.000 COP • Máximo: $2.000.000 COP
          </p>
        </div>

        {/* Selected Summary Card */}
        {activeCents !== null && (
          <div className="p-3.5 bg-gradient-to-r from-slate-900 to-emerald-950 text-white rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Total a pagar:</span>
              <span className="text-sm font-black text-emerald-300 font-mono">
                {formatWompiCentsToCop(activeCents)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pt-1 border-t border-white/10">
              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>Transacción cifrada y protegida por Wompi Sandbox</span>
            </div>
          </div>
        )}

        {/* Error Feedback */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700 font-semibold"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="w-1/3"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="w-2/3 flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20"
            disabled={!isValidAmount || isLoading}
            isLoading={isLoading}
            onClick={() => void handleInitiateTopUp()}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Pagar en Wompi</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
