"use client";

import React from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export interface WalletMovementItem {
  id: string;
  tipo: string;
  naturaleza: "CREDITO" | "DEBITO" | string;
  montoEnCentavos: string;
  saldoAnteriorCentavos?: string | null;
  saldoPosteriorCentavos?: string | null;
  formattedMontoCop?: string;
  formattedSaldoPosteriorCop?: string | null;
  metadata?: any;
  createdAt: string;
}

interface WalletHistoryListProps {
  movimientos: WalletMovementItem[];
  isLoading?: boolean;
  onRefresh?: () => void;
}

function mapTipoLabel(tipo: string): { title: string; subtitle: string } {
  switch (tipo) {
    case "RECARGA":
      return {
        title: "Recarga de Saldo",
        subtitle: "Wompi Web Checkout",
      };
    case "PAGO_SERVICIO":
      return {
        title: "Pago de Servicio Fixi",
        subtitle: "Débito automático de orden",
      };
    case "REEMBOLSO_GARANTIA":
      return {
        title: "Reembolso por Garantía",
        subtitle: "Acreditación Fixi Wallet",
      };
    case "AJUSTE_COMPENSATORIO":
      return {
        title: "Ajuste Compensatorio",
        subtitle: "Resolución de mediación / soporte",
      };
    default:
      return {
        title: tipo,
        subtitle: "Movimiento contable",
      };
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export const WalletHistoryList: React.FC<WalletHistoryListProps> = ({
  movimientos,
  isLoading = false,
  onRefresh,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
          Historial de Movimientos
        </h4>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition-colors disabled:opacity-50"
            title="Actualizar movimientos"
          >
            <RefreshCw
              className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`}
            />
            <span>Actualizar</span>
          </button>
        )}
      </div>

      {isLoading && movimientos.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-100">
          <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-emerald-600" />
          <span>Cargando movimientos...</span>
        </div>
      ) : movimientos.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-100 space-y-1">
          <Clock className="w-5 h-5 mx-auto text-slate-300" />
          <p className="font-semibold text-slate-600">Aún no tienes movimientos</p>
          <p className="text-[11px] text-slate-400">
            Tus recargas, pagos de servicios y reembolsos aparecerán aquí.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs divide-y divide-slate-100 overflow-hidden">
          {movimientos.map((m) => {
            const isCredit = m.naturaleza === "CREDITO";
            const info = mapTipoLabel(m.tipo);
            const amountFormatted = m.formattedMontoCop || `${m.montoEnCentavos} centavos`;

            return (
              <div
                key={m.id}
                className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                      isCredit
                        ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                        : "bg-slate-100 text-slate-700 border border-slate-200"
                    }`}
                  >
                    {isCredit ? (
                      <ArrowDownLeft className="w-4 h-4" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {info.title}
                    </p>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                      <span>{formatDate(m.createdAt)}</span>
                      <span>•</span>
                      <span className="truncate">{info.subtitle}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span
                    className={`text-xs font-extrabold font-mono block ${
                      isCredit ? "text-emerald-600" : "text-slate-900"
                    }`}
                  >
                    {isCredit ? `+${amountFormatted}` : `-${amountFormatted}`}
                  </span>
                  {m.formattedSaldoPosteriorCop && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      Saldo: {m.formattedSaldoPosteriorCop}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
