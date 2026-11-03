"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import {
  computeOrderPricing,
  formatCatalogUnitsToCop,
  formatWompiCentsToCop,
  catalogUnitsToWompiCents,
} from "@/lib/pricing";
import {
  WompiCheckoutClientError,
  requestWompiCheckoutParams,
  submitWompiCheckoutForm,
} from "@/lib/wompiCheckoutClient";
import type { WompiWebCheckoutFormParams } from "@/lib/wompiService";
import {
  CreditCard,
  ShieldCheck,
  Lock,
  Tag,
  ArrowLeft,
  Check,
  AlertCircle,
  ExternalLink,
  Wallet,
  PlusCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TopUpModal } from "@/components/wallet/TopUpModal";
import confetti from "canvas-confetti";

interface WalletBalanceState {
  saldoDisponibleCentavos: string;
  formattedSaldoCop: string;
  bloqueadaParaDebito: boolean;
  requiereReconciliacion: boolean;
}

export const StepPaymentHold: React.FC = () => {
  const {
    selectedCategoryForWizard,
    currentDiagnosis,
    paymentMethod,
    setPaymentMethod,
    applyPromoCode,
    promoCode,
    discountApplied,
    confirmBookingAndHoldFunds,
    setWizardStep,
    setActiveTab,
  } = useFixiStore();

  const promoInputId = useId();
  const [inputCode, setInputCode] = useState(promoCode || "");
  const [promoMessage, setPromoMessage] = useState<string | null>(
    discountApplied > 0
      ? `¡Cupón aplicado con éxito (-${formatCatalogUnitsToCop("10.00")})!`
      : null
  );
  const [isProcessingHold, setIsProcessingHold] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [checkoutParams, setCheckoutParams] =
    useState<WompiWebCheckoutFormParams | null>(null);

  // Fixi Wallet State
  const [wallet, setWallet] = useState<WalletBalanceState | null>(null);
  const [isWalletLoading, setIsWalletLoading] = useState(false);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);

  const idempotencyKeyRef = useRef<string>(
    `wiz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const pendingOrderUuidRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const wompiFormRef = useRef<HTMLFormElement | null>(null);

  // Consulta balance de Fixi Wallet
  const fetchWallet = useCallback(async () => {
    setIsWalletLoading(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.wallet) {
          setWallet({
            saldoDisponibleCentavos: data.wallet.saldoDisponibleCentavos,
            formattedSaldoCop: data.wallet.formattedSaldoCop,
            bloqueadaParaDebito: data.wallet.bloqueadaParaDebito,
            requiereReconciliacion: data.wallet.requiereReconciliacion,
          });
        }
      }
    } catch (err) {
      console.error("[StepPaymentHold] Error fetching wallet:", err);
    } finally {
      setIsWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  // Habilita pagos con tarjeta y con Fixi Wallet (Etapa 2)
  useEffect(() => {
    if (paymentMethod !== "card" && paymentMethod !== "fixi_wallet") {
      setPaymentMethod("card");
    }
  }, [paymentMethod, setPaymentMethod]);

  const selectedPresetId =
    currentDiagnosis && "id" in currentDiagnosis ? currentDiagnosis.id : null;
  const pricing = computeOrderPricing({
    category: selectedCategoryForWizard,
    presetId: selectedPresetId,
    promoCode,
  });

  const baseInspectionCop = formatCatalogUnitsToCop(
    pricing.baseInspection.toFixed(2)
  );
  const laborEstimateCop = formatCatalogUnitsToCop(
    pricing.laborEstimate.toFixed(2)
  );
  const warrantyFeeCop = formatCatalogUnitsToCop(
    pricing.warrantyProtection.toFixed(2)
  );
  const effectiveDiscountCop =
    pricing.discount > 0
      ? formatCatalogUnitsToCop(pricing.discount.toFixed(2))
      : null;
  const totalCop = formatCatalogUnitsToCop(pricing.total.toFixed(2));

  // Cálculo en centavos BigInt para comparar con el saldo disponible
  const totalCents = catalogUnitsToWompiCents(pricing.total.toFixed(2));
  const walletBalanceCents = wallet
    ? BigInt(wallet.saldoDisponibleCentavos)
    : 0n;
  const hasSufficientWalletBalance =
    wallet !== null &&
    !wallet.bloqueadaParaDebito &&
    walletBalanceCents >= totalCents;

  const laborNoteCop = pricing.isEstimate
    ? pricing.rangeMin !== null && pricing.rangeMax !== null
      ? `Estimado: rango de ${formatCatalogUnitsToCop(
          pricing.rangeMin.toFixed(2)
        )} a ${formatCatalogUnitsToCop(
          pricing.rangeMax.toFixed(2)
        )}; se cobra inicialmente el mínimo del rango.`
      : pricing.rangeMin !== null
      ? `Estimado: se considera el mínimo del rango (${formatCatalogUnitsToCop(
          pricing.rangeMin.toFixed(2)
        )}).`
      : "Estimado: tarifa base de la categoría sujeta a inspección en sitio."
    : null;

  const handleApplyCode = (e: React.FormEvent) => {
    e.preventDefault();
    const success = applyPromoCode(inputCode);
    if (success) {
      setPromoMessage(
        `¡Cupón aplicado correctamente! -${formatCatalogUnitsToCop("10.00")}`
      );
    } else {
      setPromoMessage("Código no válido. Prueba usando FIXI2026");
    }
  };

  const handleFinalConfirm = async () => {
    if (inFlightRef.current || isProcessingHold) return;
    inFlightRef.current = true;
    setIsProcessingHold(true);
    setConfirmError(null);

    try {
      let targetOrderUuid = pendingOrderUuidRef.current;

      // 1. Confirmar creación de orden si no existe ya
      if (!targetOrderUuid) {
        const result = await confirmBookingAndHoldFunds(
          idempotencyKeyRef.current
        );

        if (!result.success || !result.order) {
          setConfirmError(
            result.error ||
              "No fue posible confirmar la solicitud. Inténtalo de nuevo."
          );
          inFlightRef.current = false;
          setIsProcessingHold(false);
          return;
        }

        targetOrderUuid = result.order.dbId || result.order.id;
        pendingOrderUuidRef.current = targetOrderUuid;
      }

      // 2. Procesar según el medio seleccionado
      if (paymentMethod === "fixi_wallet") {
        // Pago inmediato con saldo interno Fixi Wallet
        const payRes = await fetch(`/api/orders/${targetOrderUuid}/pay-wallet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            idempotencyKey: idempotencyKeyRef.current,
          }),
        });

        const payData = await payRes.json().catch(() => null);

        if (!payRes.ok || !payData?.success) {
          setConfirmError(
            payData?.message ||
              "No fue posible procesar el débito en tu Fixi Wallet."
          );
          inFlightRef.current = false;
          setIsProcessingHold(false);
          return;
        }

        try {
          confetti({
            particleCount: 70,
            spread: 60,
            origin: { y: 0.6 },
            colors: ["#10b981", "#059669", "#f59e0b", "#064e3b"],
          });
        } catch {
          // cosmético
        }

        // Navegación inmediata a seguimiento
        setActiveTab("tracking");
        return;
      }

      // Pago con tarjeta vía Wompi Web Checkout
      const prepared = await requestWompiCheckoutParams(targetOrderUuid);
      setCheckoutParams(prepared.params);

      try {
        confetti({
          particleCount: 60,
          spread: 65,
          origin: { y: 0.6 },
          colors: ["#10b981", "#059669", "#f59e0b", "#064e3b"],
        });
      } catch {
        // ignorar
      }

      submitWompiCheckoutForm(prepared);
    } catch (err) {
      const msg =
        err instanceof WompiCheckoutClientError
          ? err.message
          : "No fue posible procesar la solicitud de pago. Inténtalo nuevamente.";
      setConfirmError(msg);
      inFlightRef.current = false;
      setIsProcessingHold(false);
    } finally {
      if (!pendingOrderUuidRef.current || paymentMethod === "fixi_wallet") {
        inFlightRef.current = false;
        setIsProcessingHold(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Security Banner */}
      <div className="p-4 bg-emerald-950 text-white rounded-3xl border border-emerald-500/30 shadow-md relative overflow-hidden">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-300">
                Pago Seguro • Fixi Care & Wompi
              </h4>
              <span className="text-[9px] bg-emerald-500/30 text-emerald-200 px-1.5 py-0.5 rounded font-mono">
                Moneda: COP
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
              Tu pago queda protegido en garantía y tu orden se publica a especialistas verificados al confirmar la retención o débito seguro.
            </p>
          </div>
        </div>
      </div>

      {/* Transparent Price Breakdown in COP */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
        <span className="text-xs font-bold text-slate-900 block">
          Desglose Transparente en Pesos Colombianos
        </span>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Visita técnica & Diagnóstico en sitio</span>
            <span className="font-semibold text-slate-900">
              {baseInspectionCop}
            </span>
          </div>

          <div className="flex justify-between text-slate-600">
            <span>
              {pricing.isEstimate
                ? `Mano de obra base estimada (${
                    currentDiagnosis?.title.split(" ")[0] ||
                    selectedCategoryForWizard
                  }...)`
                : `Mano de obra tabulada (${
                    currentDiagnosis?.title.split(" ")[0]
                  }...)`}
            </span>
            <span className="font-semibold text-slate-900">
              {laborEstimateCop}
            </span>
          </div>

          {laborNoteCop && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/80 rounded-xl px-2.5 py-1.5 leading-snug">
              {laborNoteCop}
            </p>
          )}

          <div className="flex justify-between text-slate-600">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Garantía FixiCare® (90 días)</span>
            </span>
            <span className="font-semibold text-slate-900">
              {warrantyFeeCop}
            </span>
          </div>

          {effectiveDiscountCop && (
            <div className="flex justify-between text-emerald-700 font-bold bg-emerald-50 p-2 rounded-xl border border-emerald-200">
              <span>Cupón ({pricing.promoCode})</span>
              <span>-{effectiveDiscountCop}</span>
            </div>
          )}

          <div className="pt-2.5 border-t border-slate-200 flex justify-between items-baseline gap-2">
            <div>
              <span className="text-xs font-bold text-slate-900 block">
                Total a Pagar
              </span>
              <span className="text-[10px] text-slate-500">
                Calculado y validado en servidor
              </span>
            </div>
            <span className="text-lg font-black text-emerald-700 font-mono">
              {totalCop}
            </span>
          </div>
        </div>

        {/* Promo code form */}
        <form
          onSubmit={handleApplyCode}
          className="pt-2 border-t border-slate-100 space-y-1.5"
        >
          <label
            htmlFor={promoInputId}
            className="text-[11px] font-semibold text-slate-700 block"
          >
            Cupón promocional (opcional)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Tag className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <input
                id={promoInputId}
                name="promoCode"
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                placeholder="Ej: FIXI2026"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="w-full text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 uppercase font-mono focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="md"
              className="shrink-0"
            >
              Aplicar
            </Button>
          </div>
        </form>

        {promoMessage && (
          <p
            aria-live="polite"
            className={`text-[11px] font-semibold ${
              discountApplied > 0 ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {promoMessage}
          </p>
        )}
      </div>

      {/* Payment Method Selector (Fixi Wallet + Tarjeta Wompi) */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-900">
            Métodos de Pago Disponibles
          </span>
          <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            Etapa 2 • Wallet & Wompi
          </span>
        </div>

        {/* Option 1: Fixi Wallet */}
        <button
          type="button"
          onClick={() => setPaymentMethod("fixi_wallet")}
          className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left shadow-xs transition-all ${
            paymentMethod === "fixi_wallet"
              ? "bg-emerald-50/90 border-emerald-500 ring-2 ring-emerald-500/20"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-xs shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-bold text-slate-900 truncate">
                  Fixi Wallet (Saldo Digital)
                </p>
                <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full uppercase">
                  Instantáneo
                </span>
              </div>
              <p className="text-[11px] text-slate-600 font-mono">
                {isWalletLoading
                  ? "Consultando saldo..."
                  : wallet
                  ? `Disponible: ${wallet.formattedSaldoCop}`
                  : "Inicia sesión para usar tu saldo"}
              </p>
            </div>
          </div>
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
              paymentMethod === "fixi_wallet"
                ? "bg-emerald-600 text-white"
                : "border border-slate-300"
            }`}
          >
            {paymentMethod === "fixi_wallet" && <Check className="w-3 h-3" />}
          </span>
        </button>

        {/* Insufficient balance warning + top up trigger */}
        {paymentMethod === "fixi_wallet" && wallet && !hasSufficientWalletBalance && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
            <div className="flex items-start gap-2 text-xs text-amber-800 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>
                {wallet.bloqueadaParaDebito
                  ? "Tu Fixi Wallet está suspendida temporalmente por seguridad. Utiliza tarjeta de crédito/débito."
                  : `Saldo insuficiente para cubrir esta orden (${totalCop}). Saldo actual: ${wallet.formattedSaldoCop}.`}
              </span>
            </div>
            {!wallet.bloqueadaParaDebito && (
              <button
                type="button"
                onClick={() => setIsTopUpOpen(true)}
                className="w-full py-1.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Recargar Fixi Wallet Ahora</span>
              </button>
            )}
          </div>
        )}

        {/* Option 2: Tarjeta Wompi */}
        <button
          type="button"
          onClick={() => setPaymentMethod("card")}
          className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left shadow-xs transition-all ${
            paymentMethod === "card"
              ? "bg-emerald-50/90 border-emerald-500 ring-2 ring-emerald-500/20"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">
                Tarjeta de Crédito / Débito (Wompi)
              </p>
              <p className="text-[11px] text-slate-600">
                Web Checkout seguro de Wompi Sandbox
              </p>
            </div>
          </div>
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
              paymentMethod === "card"
                ? "bg-emerald-600 text-white"
                : "border border-slate-300"
            }`}
          >
            {paymentMethod === "card" && <Check className="w-3 h-3" />}
          </span>
        </button>
      </div>

      {/* Formulario GET oculto estándar hacia Wompi Web Checkout */}
      {checkoutParams && (
        <form
          ref={wompiFormRef}
          action="https://checkout.wompi.co/p/"
          method="GET"
          className="hidden"
        >
          <input
            type="hidden"
            name="public-key"
            value={checkoutParams["public-key"]}
          />
          <input
            type="hidden"
            name="currency"
            value={checkoutParams.currency}
          />
          <input
            type="hidden"
            name="amount-in-cents"
            value={checkoutParams["amount-in-cents"]}
          />
          <input
            type="hidden"
            name="reference"
            value={checkoutParams.reference}
          />
          <input
            type="hidden"
            name="signature:integrity"
            value={checkoutParams["signature:integrity"]}
          />
          <input
            type="hidden"
            name="expiration-time"
            value={checkoutParams["expiration-time"]}
          />
          <input
            type="hidden"
            name="redirect-url"
            value={checkoutParams["redirect-url"]}
          />
        </form>
      )}

      {confirmError && (
        <div
          role="alert"
          className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700 font-semibold"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
          <span>{confirmError}</span>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex gap-2 pt-2">
        <Button
          variant="secondary"
          size="lg"
          className="w-1/3 flex items-center justify-center gap-1.5"
          disabled={isProcessingHold}
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
          disabled={
            isProcessingHold ||
            (paymentMethod === "fixi_wallet" && (!wallet || !hasSufficientWalletBalance))
          }
          onClick={() => void handleFinalConfirm()}
        >
          {paymentMethod === "fixi_wallet" ? (
            <>
              <Wallet className="w-4 h-4 shrink-0" />
              <span className="truncate">Pagar {totalCop} con Billetera</span>
            </>
          ) : (
            <>
              <ExternalLink className="w-4 h-4 shrink-0" />
              <span className="truncate">Pagar {totalCop} en Wompi</span>
            </>
          )}
        </Button>
      </div>

      <TopUpModal
        isOpen={isTopUpOpen}
        onClose={() => setIsTopUpOpen(false)}
        currentBalanceCop={wallet?.formattedSaldoCop}
        onSuccess={fetchWallet}
      />
    </div>
  );
};
