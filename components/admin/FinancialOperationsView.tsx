"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  WalletCards,
  RefreshCw,
  Search,
  AlertCircle,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Receipt,
  Download,
  Calendar,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  HelpCircle,
} from "lucide-react";
import { EmptyState } from "@/components/admin/EmptyState";

export interface FinancialOperation {
  id: string;
  tipo: "RECARGA" | "PAGO_SERVICIO" | "REEMBOLSO" | "COMISION";
  tipoLabel: string;
  referencia: string;
  ordenId: string | null;
  numeroOrden: string | null;
  usuarioEmail: string | null;
  usuarioNombre: string | null;
  montoEnCentavos: string;
  montoFormateado: string;
  naturaleza: "CREDITO" | "DEBITO" | null;
  estado: string;
  creadoEn: string;
  descripcion: string;
}

interface FinancialKpis {
  saldoEnCustodia: number | null;
  reembolsosSolicitados: number;
  dispersionesRealizadas: number | null;
}

type ViewStatus = "loading" | "success" | "error" | "forbidden";

function formatBogotaDateTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "—";
    const formatter = new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return formatter.format(date).replace(",", " -");
  } catch {
    return "—";
  }
}

function getTipoBadge(tipo: FinancialOperation["tipo"], label: string) {
  switch (tipo) {
    case "RECARGA":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
          <ArrowDownLeft className="w-3 h-3 text-blue-600" />
          {label}
        </span>
      );
    case "PAGO_SERVICIO":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <ArrowUpRight className="w-3 h-3 text-emerald-600" />
          {label}
        </span>
      );
    case "REEMBOLSO":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
          <Receipt className="w-3 h-3 text-purple-600" />
          {label}
        </span>
      );
    case "COMISION":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
          {label}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
          {label}
        </span>
      );
  }
}

function getEstadoBadge(estado: string) {
  const norm = estado.toUpperCase();
  if (norm.includes("EJECUTADO") || norm.includes("APROBADO") || norm.includes("PROCESADO") || norm.includes("EXITOSA")) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
        {norm.includes("EJECUTADO") ? "Ejecutado" : "Aprobado"}
      </span>
    );
  }
  if (norm.includes("PENDIENTE") || norm.includes("SOLICITADO")) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="w-3 h-3 text-amber-500" />
        Pendiente
      </span>
    );
  }
  if (norm.includes("RECHAZADO") || norm.includes("FALLIDA") || norm.includes("ANULADO")) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
        <XCircle className="w-3 h-3 text-rose-500" />
        Rechazado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      {estado}
    </span>
  );
}

export function FinancialOperationsView() {
  const [operations, setOperations] = useState<FinancialOperation[]>([]);
  const [kpis, setKpis] = useState<FinancialKpis>({
    saldoEnCustodia: null,
    reembolsosSolicitados: 0,
    dispersionesRealizadas: null,
  });
  const [viewStatus, setViewStatus] = useState<ViewStatus>("loading");
  const [searchQuery, setSearchQuery] = useState("");
  const [tipoFilter, setTipoFilter] = useState("ALL");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchOperations = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (tipoFilter !== "ALL") params.set("tipo", tipoFilter);
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);

      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/admin/financial/operations${qs}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        setViewStatus("forbidden");
        setIsRefreshing(false);
        return;
      }

      if (!res.ok) {
        setViewStatus("error");
        setIsRefreshing(false);
        return;
      }

      const data = await res.json().catch(() => null);
      if (!data || data.success !== true || !Array.isArray(data.operaciones)) {
        setViewStatus("error");
        setIsRefreshing(false);
        return;
      }

      setOperations(data.operaciones);
      if (data.kpis) {
        setKpis({
          saldoEnCustodia: data.kpis.saldoEnCustodia ?? null,
          reembolsosSolicitados: Number(data.kpis.reembolsosSolicitados) || 0,
          dispersionesRealizadas: data.kpis.dispersionesRealizadas ?? null,
        });
      }
      setViewStatus("success");
    } catch {
      setViewStatus("error");
    } finally {
      setIsRefreshing(false);
    }
  }, [searchQuery, tipoFilter, fechaDesde, fechaHasta]);

  useEffect(() => {
    void fetchOperations();
  }, [fetchOperations]);

  // Exportar a CSV respetando registros activos filtrados
  const handleExportCsv = () => {
    if (operations.length === 0) return;

    const headers = [
      "ID Operación",
      "Tipo",
      "Referencia",
      "Número de Orden",
      "Correo Usuario",
      "Nombre Usuario",
      "Monto COP",
      "Naturaleza",
      "Estado",
      "Fecha (Bogotá)",
      "Descripción",
    ];

    const escapeCsv = (str: string | null | undefined) => {
      if (!str) return '""';
      const clean = String(str).replace(/"/g, '""');
      return `"${clean}"`;
    };

    const rows = operations.map((op) => [
      escapeCsv(op.id),
      escapeCsv(op.tipoLabel),
      escapeCsv(op.referencia),
      escapeCsv(op.numeroOrden ?? "N/A"),
      escapeCsv(op.usuarioEmail ?? "N/A"),
      escapeCsv(op.usuarioNombre ?? "N/A"),
      escapeCsv(op.montoFormateado),
      escapeCsv(op.naturaleza ?? "N/A"),
      escapeCsv(op.estado),
      escapeCsv(formatBogotaDateTime(op.creadoEn)),
      escapeCsv(op.descripcion),
    ]);

    const csvContent =
      "\uFEFF" +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", url);
    link.setAttribute("download", `operaciones_financieras_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setTipoFilter("ALL");
    setFechaDesde("");
    setFechaHasta("");
  };

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-slate-900 font-bold text-lg">
            <WalletCards className="w-5 h-5 text-emerald-600" />
            <h1>Operaciones Financieras y Tesorería</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Gestión de transacciones, movimientos, reembolsos y Fixi Wallet.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={operations.length === 0 || viewStatus !== "success"}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar Reporte CSV</span>
          </button>

          <button
            type="button"
            onClick={() => void fetchOperations()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            <span>Actualizar Datos</span>
          </button>
        </div>
      </div>

      {/* Barra de 3 KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: Saldo en Custodia */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Saldo en Custodia</span>
            <div className="group relative">
              <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
              <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block w-48 p-2 bg-slate-800 text-white text-[10px] rounded-lg shadow-md z-10 leading-tight">
                Métrica no expuesta en el modelo contable actual.
              </div>
            </div>
          </div>
          <div className="text-2xl font-black text-slate-400 font-mono tracking-tight">
            {kpis.saldoEnCustodia !== null ? `$ ${kpis.saldoEnCustodia} COP` : "—"}
          </div>
          <p className="text-[11px] text-slate-400">
            Fondos en retención temporal de órdenes
          </p>
        </div>

        {/* KPI 2: Reembolsos Solicitados */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Reembolsos Solicitados</span>
            <Receipt className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">
            {viewStatus === "loading" ? "…" : kpis.reembolsosSolicitados}
          </div>
          <p className="text-[11px] text-amber-600 font-medium">
            Solicitudes pendientes de auditoría y autorización
          </p>
        </div>

        {/* KPI 3: Dispersiones Realizadas */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Dispersiones Realizadas</span>
            <div className="group relative">
              <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
              <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block w-48 p-2 bg-slate-800 text-white text-[10px] rounded-lg shadow-md z-10 leading-tight">
                Dispersiones bancarias pendientes de módulo de tesorería.
              </div>
            </div>
          </div>
          <div className="text-2xl font-black text-slate-400 font-mono tracking-tight">
            {kpis.dispersionesRealizadas !== null
              ? `$ ${kpis.dispersionesRealizadas} COP`
              : "—"}
          </div>
          <p className="text-[11px] text-slate-400">
            Liquidaciones acreditadas a reparadores
          </p>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Búsqueda */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por orden, ref Wompi o correo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 placeholder:text-slate-400 bg-slate-50/50"
            />
          </div>

          {/* Tipo de Movimiento */}
          <div className="relative">
            <select
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 bg-slate-50/50"
            >
              <option value="ALL">Todos los tipos de movimiento</option>
              <option value="RECARGA">Recargas Wallet</option>
              <option value="PAGO_SERVICIO">Pagos de Servicio</option>
              <option value="REEMBOLSO">Reembolsos</option>
              <option value="COMISION">
                Comisiones de Plataforma (Pendiente)
              </option>
            </select>
          </div>

          {/* Fecha Desde */}
          <div className="relative flex items-center">
            <Calendar className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none" />
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              title="Fecha inicial"
              className="w-full pl-9 pr-2 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 bg-slate-50/50"
            />
          </div>

          {/* Fecha Hasta */}
          <div className="relative flex items-center">
            <Calendar className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none" />
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              title="Fecha final"
              className="w-full pl-9 pr-2 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 bg-slate-50/50"
            />
          </div>
        </div>

        {(searchQuery || tipoFilter !== "ALL" || fechaDesde || fechaHasta) && (
          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-slate-500">
              Mostrando {operations.length} registros filtrados
            </span>
            <button
              type="button"
              onClick={handleClearFilters}
              className="text-emerald-700 hover:text-emerald-800 font-semibold"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* Aviso si se selecciona categoría pendiente de integración */}
      {tipoFilter === "COMISION" && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-bold">Categoría pendiente de integración</p>
            <p className="mt-0.5 text-amber-700">
              Las comisiones de plataforma se calculan dinámicamente en el flujo
              de órdenes; su registro segregado en libro mayor se integrará en la
              próxima fase de contabilidad general.
            </p>
          </div>
        </div>
      )}

      {/* 5 Estados */}
      {viewStatus === "loading" && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-xs space-y-4">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-slate-200 rounded-md w-1/4" />
            <div className="h-10 bg-slate-100 rounded-xl w-full" />
            <div className="h-10 bg-slate-100 rounded-xl w-full" />
            <div className="h-10 bg-slate-100 rounded-xl w-full" />
            <div className="h-10 bg-slate-100 rounded-xl w-full" />
          </div>
        </div>
      )}

      {viewStatus === "forbidden" && (
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center shadow-xs space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">Acceso restringido</h2>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No tienes permisos suficientes para auditar las operaciones
            financieras de tesorería.
          </p>
        </div>
      )}

      {viewStatus === "error" && (
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center shadow-xs space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">
            Error al consultar operaciones
          </h2>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Ocurrió un inconveniente al cargar el consolidado de tesorería.
          </p>
          <button
            type="button"
            onClick={() => void fetchOperations()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reintentar</span>
          </button>
        </div>
      )}

      {viewStatus === "success" && operations.length === 0 && (
        <EmptyState
          icon={Receipt}
          title="No hay movimientos financieros"
          description="No se encontraron operaciones registradas con los filtros seleccionados."
          actionLabel="Restablecer filtros"
          onAction={handleClearFilters}
        />
      )}

      {viewStatus === "success" && operations.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50/80 text-slate-700 font-bold border-b border-slate-200/80 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Referencia / Orden</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Fecha (Bogotá)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {operations.map((op) => (
                  <tr key={op.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getTipoBadge(op.tipo, op.tipoLabel)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-[11px] font-bold text-slate-800 truncate max-w-[200px]" title={op.referencia}>
                        {op.referencia}
                      </div>
                      {op.numeroOrden && (
                        <div className="text-[10px] text-slate-400">
                          Orden #{op.numeroOrden}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800 truncate max-w-[160px]">
                        {op.usuarioEmail || op.usuarioNombre || "—"}
                      </div>
                      {op.usuarioEmail && op.usuarioNombre && (
                        <div className="text-[10px] text-slate-400 truncate max-w-[160px]">
                          @{op.usuarioNombre}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span
                        className={`font-mono font-bold ${
                          op.naturaleza === "CREDITO"
                            ? "text-emerald-700"
                            : "text-slate-900"
                        }`}
                      >
                        {op.naturaleza === "CREDITO" ? "+" : ""}
                        {op.montoFormateado}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getEstadoBadge(op.estado)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                      {formatBogotaDateTime(op.creadoEn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
