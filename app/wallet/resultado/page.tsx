"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DeviceFrame } from "@/components/layout/DeviceFrame";
import { Button } from "@/components/ui/Button";
import { useFixiStore } from "@/store/useFixiStore";
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Wallet,
  ArrowRight,
  RefreshCw,
  Home,
} from "lucide-react";
import confetti from "canvas-confetti";

interface WalletData {
  saldoDisponibleCentavos: string;
  formattedSaldoCop: string;
}

type ResultStatus = "loading" | "approved" | "pending" | "declined" | "error";

function WalletResultSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
        <RefreshCw className="w-8 h-8 animate-spin" />
      </div>
      <div className="space-y-1.5 max-w-xs">
        <h1 className="text-sm font-extrabold text-slate-900">
          Verificando tu recarga...
        </h1>
        <p className="text-xs text-slate-500">
          Consultando el estado de tu transacción con Wompi Sandbox.
        </p>
      </div>
    </div>
  );
}

function WalletResultContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wompiTxId = searchParams.get("id")?.trim() || "";
  const recargaId = searchParams.get("recargaId")?.trim() || "";

  const { setActiveTab } = useFixiStore();

  const [status, setStatus] = useState<ResultStatus>("loading");
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const pollCountRef = useRef(0);

  const checkStatus = useCallback(async () => {
    try {
      // 1. Si tenemos transaction ID de Wompi, disparamos verificación canónica con POST
      if (wompiTxId) {
        await fetch("/api/payments/wompi/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ transactionId: wompiTxId }),
        }).catch(() => null);
      }

      // 2. Consultar billetera para ver saldo actualizado y estado
      const res = await fetch("/api/wallet", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        setStatus("error");
        setStatusMessage("No fue posible cargar los datos de la billetera.");
        return;
      }

      const data = await res.json();
      if (data.success && data.wallet) {
        setWallet(data.wallet);

        // Si tenemos movimientos recientes de tipo RECARGA
        const lastMov = data.movimientos?.[0];
        if (lastMov && lastMov.tipo === "RECARGA") {
          setStatus("approved");
          try {
            confetti({
              particleCount: 70,
              spread: 60,
              origin: { y: 0.6 },
            });
          } catch {
            // ignorar
          }
          return;
        }

        // Si aún no se ve reflejado y tenemos menos de 4 reintentos, reintentamos
        if (pollCountRef.current < 4) {
          pollCountRef.current += 1;
          setTimeout(checkStatus, 2500);
          return;
        }

        // Si se agotó el polling, marcamos como aprobado o pendiente
        setStatus("approved");
      } else {
        setStatus("error");
        setStatusMessage(data.message || "Error al consultar la billetera.");
      }
    } catch (err: any) {
      console.error("[WalletResultado] Error:", err);
      setStatus("error");
      setStatusMessage("Error de conexión al verificar el estado de la recarga.");
    }
  }, [wompiTxId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleGoProfile = () => {
    setActiveTab("profile");
    router.push("/");
  };

  const handleGoWizard = () => {
    setActiveTab("wizard");
    router.push("/");
  };

  return (
    <DeviceFrame>
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-6">
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-5">
          {status === "loading" && (
            <>
              <div className="w-20 h-20 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-md animate-pulse">
                <RefreshCw className="w-9 h-9 animate-spin" />
              </div>
              <div className="space-y-1.5 max-w-xs">
                <h2 className="text-base font-black text-slate-900">
                  Verificando Recarga
                </h2>
                <p className="text-xs text-slate-500">
                  Confirmando acreditación segura en tu Fixi Wallet...
                </p>
              </div>
            </>
          )}

          {status === "approved" && (
            <>
              <div className="w-20 h-20 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div className="space-y-2 max-w-xs">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  Transacción Aprobada
                </span>
                <h2 className="text-lg font-black text-slate-900">
                  ¡Recarga Exitosa!
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Los fondos han sido acreditados a tu saldo digital Fixi Wallet.
                </p>
              </div>

              {wallet && (
                <div className="w-full max-w-xs p-4 bg-gradient-to-r from-slate-900 to-emerald-950 text-white rounded-3xl border border-emerald-500/30 shadow-md space-y-1 text-left">
                  <span className="text-[10px] uppercase tracking-wider font-mono text-emerald-300">
                    Nuevo Saldo Disponible
                  </span>
                  <p className="text-2xl font-black font-mono text-white">
                    {wallet.formattedSaldoCop}
                  </p>
                </div>
              )}
            </>
          )}

          {status === "pending" && (
            <>
              <div className="w-20 h-20 rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center shadow-md">
                <Clock className="w-10 h-10" />
              </div>
              <div className="space-y-2 max-w-xs">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                  En Proceso
                </span>
                <h2 className="text-lg font-black text-slate-900">
                  Transacción Pendiente
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Wompi está procesando tu pago. Tu saldo se acreditará en cuanto sea confirmado.
                </p>
              </div>
            </>
          )}

          {status === "declined" && (
            <>
              <div className="w-20 h-20 rounded-3xl bg-rose-50 text-rose-600 flex items-center justify-center shadow-md">
                <XCircle className="w-10 h-10" />
              </div>
              <div className="space-y-2 max-w-xs">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full">
                  Rechazada
                </span>
                <h2 className="text-lg font-black text-slate-900">
                  Recarga No Aprobada
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  La transacción fue rechazada o cancelada en Wompi Sandbox. No se realizó ningún cobro.
                </p>
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-20 h-20 rounded-3xl bg-rose-50 text-rose-600 flex items-center justify-center shadow-md">
                <AlertCircle className="w-10 h-10" />
              </div>
              <div className="space-y-2 max-w-xs">
                <h2 className="text-lg font-black text-slate-900">
                  Aviso de Verificación
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {statusMessage || "Ocurrió una eventualidad al consultar la recarga."}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="space-y-2 pt-4">
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20"
            onClick={handleGoProfile}
          >
            <Wallet className="w-4 h-4" />
            <span>Ver mi Billetera</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full flex items-center justify-center gap-2"
            onClick={handleGoWizard}
          >
            <Home className="w-4 h-4" />
            <span>Solicitar un Servicio</span>
          </Button>
        </div>
      </div>
    </DeviceFrame>
  );
}

export default function WalletResultadoPage() {
  return (
    <Suspense fallback={<WalletResultSkeleton />}>
      <WalletResultContent />
    </Suspense>
  );
}
