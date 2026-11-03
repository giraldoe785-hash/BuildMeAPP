"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  FileCheck2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  UserCheck,
  AlertCircle,
  Eye,
  Check,
  X,
  Building,
  Mail,
  Phone,
  Tag,
} from "lucide-react";
import { EmptyState } from "@/components/admin/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export interface RepairerDocumentDto {
  id: string;
  tipoDocumento: string;
  nombreOriginal: string;
  mimeType: string;
  tamanoBytes: number | null;
  estado: "PENDIENTE" | "APROBADO" | "RECHAZADO" | "VENCIDO";
  fechaExpiracion: string | null;
  observacionesAdmin: string | null;
  creadoEn: string;
}

export interface RepairerDossierDto {
  id: string;
  perfilId: string | null;
  nombreCompleto: string;
  numeroDocumento: string;
  tipoDocumento: string;
  email: string;
  telefono: string;
  ciudadCobertura: string;
  estado: string;
  creadoEn: string;
  especialidades: Array<{ id: string; nombre: string; slug: string }>;
  documentos: RepairerDocumentDto[];
  totalDocumentos: number;
  documentosPendientes: number;
}

interface TechnicalKpis {
  expedientesPorValidar: number;
  verificadosTotal?: number;
  aprobadosMes?: number;
  rechazados: number;
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

function getEstadoCuentaBadge(estado: string) {
  const norm = estado.toUpperCase();
  if (norm === "VERIFICADO") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
        Verificado
      </span>
    );
  }
  if (norm === "EN_REVISION") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="w-3 h-3 text-amber-600" />
        En Revisión
      </span>
    );
  }
  if (norm === "PENDIENTE_VERIFICACION") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
        <Clock className="w-3 h-3 text-blue-600" />
        Pendiente
      </span>
    );
  }
  if (norm === "RECHAZADO") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
        <XCircle className="w-3 h-3 text-rose-600" />
        Rechazado
      </span>
    );
  }
  if (norm === "SUSPENDIDO") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
        Suspendido
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      {estado}
    </span>
  );
}

function getEstadoDocumentoBadge(estado: string) {
  const norm = estado.toUpperCase();
  if (norm === "APROBADO") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        Aprobado
      </span>
    );
  }
  if (norm === "PENDIENTE") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        Pendiente
      </span>
    );
  }
  if (norm === "RECHAZADO") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
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

export function TechnicalVerificationView() {
  const [dossiers, setDossiers] = useState<RepairerDossierDto[]>([]);
  const [kpis, setKpis] = useState<TechnicalKpis>({
    expedientesPorValidar: 0,
    aprobadosMes: 0,
    rechazados: 0,
  });
  const [viewStatus, setViewStatus] = useState<ViewStatus>("loading");
  const [searchQuery, setSearchQuery] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("ALL");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Estado del modal de auditoría
  const [selectedRepairer, setSelectedRepairer] = useState<RepairerDossierDto | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [observacionesAudit, setObservacionesAudit] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [auditFeedback, setAuditFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchDossiers = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (estadoFilter !== "ALL") params.set("estado", estadoFilter);

      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/admin/repairers${qs}`, {
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
      if (!data || data.success !== true || !Array.isArray(data.reparadores)) {
        setViewStatus("error");
        setIsRefreshing(false);
        return;
      }

      setDossiers(data.reparadores);
      if (data.kpis) {
        setKpis({
          expedientesPorValidar: Number(data.kpis.expedientesPorValidar) || 0,
          aprobadosMes: Number(data.kpis.aprobadosMes) || 0,
          rechazados: Number(data.kpis.rechazados) || 0,
        });
      }
      setViewStatus("success");
    } catch {
      setViewStatus("error");
    } finally {
      setIsRefreshing(false);
    }
  }, [searchQuery, estadoFilter]);

  useEffect(() => {
    void fetchDossiers();
  }, [fetchDossiers]);

  const handleOpenAuditModal = (repairer: RepairerDossierDto) => {
    setSelectedRepairer(repairer);
    setObservacionesAudit("");
    setAuditFeedback(null);
    setIsAuditModalOpen(true);
  };

  const handleApproveDossier = async () => {
    if (!selectedRepairer || isApproving) return;

    setIsApproving(true);
    setAuditFeedback(null);

    try {
      // Se aprueban los documentos pendientes
      const documentIds = selectedRepairer.documentos
        .filter((d) => d.estado === "PENDIENTE" || d.estado === "APROBADO")
        .map((d) => d.id);

      const res = await fetch(`/api/admin/repairers/${selectedRepairer.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          documentIds,
          observaciones: observacionesAudit.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setAuditFeedback({
          type: "error",
          message: data?.message || "No fue posible aprobar el expediente técnico.",
        });
        setIsApproving(false);
        return;
      }

      setAuditFeedback({
        type: "success",
        message: "¡Expediente técnico aprobado exitosamente! El profesional ha sido verificado.",
      });

      // Refrescar lista de expedientes
      void fetchDossiers();
      setTimeout(() => {
        setIsAuditModalOpen(false);
      }, 1800);
    } catch {
      setAuditFeedback({
        type: "error",
        message: "Error de conexión al procesar la aprobación del expediente.",
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleConsultarVerificados = () => {
    setEstadoFilter("VERIFICADO");
    setSearchQuery("");
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setEstadoFilter("ALL");
  };

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-slate-900 font-bold text-lg">
            <FileCheck2 className="w-5 h-5 text-amber-600" />
            <h1>Verificación Técnica y Expedientes</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Auditoría de credenciales, antecedentes y habilitación de perfiles profesionales.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchDossiers()}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 transition-colors self-start sm:self-auto"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
          />
          <span>Actualizar Datos</span>
        </button>
      </div>

      {/* Barra de 3 KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: Expedientes por Validar */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Expedientes por Validar</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">
            {viewStatus === "loading" ? "…" : kpis.expedientesPorValidar}
          </div>
          <p className="text-[11px] text-amber-600 font-medium">
            Profesionales en revisión o pendientes de validación
          </p>
        </div>

        {/* KPI 2: Perfiles Verificados */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Perfiles Verificados</span>
            <UserCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">
            {viewStatus === "loading" ? "…" : kpis.verificadosTotal ?? kpis.aprobadosMes ?? 0}
          </div>
          <p className="text-[11px] text-emerald-600 font-medium">
            Total histórico de especialistas habilitados en plataforma
          </p>
        </div>

        {/* KPI 3: Rechazados / Suspendidos */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Rechazados / Suspendidos</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">
            {viewStatus === "loading" ? "…" : kpis.rechazados}
          </div>
          <p className="text-[11px] text-rose-600 font-medium">
            Perfiles inhabilitados por auditoría técnica
          </p>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Búsqueda por documento, nombre o correo */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por cédula, nombre o correo del profesional..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 placeholder:text-slate-400 bg-slate-50/50"
            />
          </div>

          {/* Selector de Estado */}
          <div className="relative">
            <select
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 bg-slate-50/50"
            >
              <option value="ALL">Todos los estados de expediente</option>
              <option value="EN_REVISION">En Revisión (Pendientes de auditoría)</option>
              <option value="PENDIENTE_VERIFICACION">Pendiente de Verificación</option>
              <option value="VERIFICADO">Verificados (Aprobados)</option>
              <option value="RECHAZADO">Rechazados</option>
              <option value="SUSPENDIDO">Suspendidos</option>
            </select>
          </div>
        </div>

        {(searchQuery || estadoFilter !== "ALL") && (
          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-slate-500">
              Mostrando {dossiers.length} expedientes encontrados
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
            No tienes los permisos requeridos para auditar expedientes de habilitación técnica.
          </p>
        </div>
      )}

      {viewStatus === "error" && (
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center shadow-xs space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">
            Error al consultar expedientes
          </h2>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Ocurrió un inconveniente al cargar la bandeja de verificación técnica.
          </p>
          <button
            type="button"
            onClick={() => void fetchDossiers()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reintentar</span>
          </button>
        </div>
      )}

      {viewStatus === "success" && dossiers.length === 0 && (
        <EmptyState
          icon={FileCheck2}
          title="Todos los expedientes están al día"
          description="No hay solicitudes de verificación técnica ni documentos pendientes de revisión en la cola de trabajo."
          actionLabel="Consultar historial de verificados"
          onAction={handleConsultarVerificados}
        />
      )}

      {viewStatus === "success" && dossiers.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50/80 text-slate-700 font-bold border-b border-slate-200/80 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3">ID Profesional</th>
                  <th className="px-4 py-3">Profesional</th>
                  <th className="px-4 py-3">Especialidad</th>
                  <th className="px-4 py-3">Documentos Adjuntos</th>
                  <th className="px-4 py-3">Fecha de Envío</th>
                  <th className="px-4 py-3">Nivel de Validación</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dossiers.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {r.id.slice(0, 8)}…{r.id.slice(-4)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{r.nombreCompleto}</div>
                      <div className="text-[10px] text-slate-400">
                        {r.tipoDocumento} {r.numeroDocumento} • {r.ciudadCobertura}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {r.especialidades.length > 0 ? (
                          r.especialidades.map((esp) => (
                            <span
                              key={esp.id}
                              className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-medium"
                            >
                              {esp.nombre}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">
                            Sin especialidad
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">
                        {r.totalDocumentos} {r.totalDocumentos === 1 ? "documento" : "documentos"}
                      </div>
                      {r.documentosPendientes > 0 ? (
                        <span className="text-[10px] font-bold text-amber-600">
                          {r.documentosPendientes} pendiente{r.documentosPendientes > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-600 font-medium">
                          Al día
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                      {formatBogotaDateTime(r.creadoEn)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getEstadoCuentaBadge(r.estado)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleOpenAuditModal(r)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Auditar Expediente</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Auditoría de Expediente */}
      {selectedRepairer && (
        <Modal
          isOpen={isAuditModalOpen}
          onClose={() => {
            if (!isApproving) setIsAuditModalOpen(false);
          }}
          title="Auditoría de Expediente Técnico"
        >
          <div className="space-y-5 text-xs text-slate-600">
            {/* Encabezado del Reparador */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900">
                  {selectedRepairer.nombreCompleto}
                </span>
                {getEstadoCuentaBadge(selectedRepairer.estado)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-500 pt-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Tag className="w-3 h-3 text-slate-400" />
                  <span>
                    {selectedRepairer.tipoDocumento}: {selectedRepairer.numeroDocumento}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Building className="w-3 h-3 text-slate-400" />
                  <span>Ciudad: {selectedRepairer.ciudadCobertura}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Mail className="w-3 h-3 text-slate-400" />
                  <span className="truncate">{selectedRepairer.email}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-slate-400" />
                  <span>{selectedRepairer.telefono}</span>
                </div>
              </div>
            </div>

            {/* Especialidades Acreditadas */}
            <div className="space-y-2">
              <span className="font-bold text-slate-800 uppercase text-[10px] tracking-wider block">
                Especialidades Radicadas
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selectedRepairer.especialidades.length > 0 ? (
                  selectedRepairer.especialidades.map((esp) => (
                    <span
                      key={esp.id}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold"
                    >
                      {esp.nombre}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 italic">Sin especialidades registradas</span>
                )}
              </div>
            </div>

            {/* Documentos Adjuntos de Acreditación */}
            <div className="space-y-2">
              <span className="font-bold text-slate-800 uppercase text-[10px] tracking-wider block">
                Documentos de Acreditación ({selectedRepairer.documentos.length})
              </span>
              {selectedRepairer.documentos.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
                  El reparador aún no ha cargado documentos de soporte en su expediente.
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {selectedRepairer.documentos.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate text-xs">
                            {doc.tipoDocumento}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {doc.nombreOriginal} • {formatBogotaDateTime(doc.creadoEn)}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {getEstadoDocumentoBadge(doc.estado)}
                        <a
                          href={`/api/admin/repairers/${selectedRepairer.id}/documents/${doc.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                          title="Visualizar documento original seguro"
                        >
                          <Eye className="w-3 h-3 text-slate-500" />
                          <span>Ver</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Observaciones de auditoría si se aprueba */}
            {selectedRepairer.estado === "EN_REVISION" && (
              <div className="space-y-1.5 pt-1">
                <label className="font-bold text-slate-800 text-[11px] block">
                  Observaciones de Aprobación (Opcional):
                </label>
                <textarea
                  rows={2}
                  placeholder="Detalles sobre antecedentes verificados, matricula técnica o requisitos validados..."
                  value={observacionesAudit}
                  onChange={(e) => setObservacionesAudit(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 bg-slate-50/50"
                />
              </div>
            )}

            {/* Feedback alert */}
            {auditFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  auditFeedback.type === "success"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold"
                    : "bg-rose-50 border-rose-200 text-rose-700 font-semibold"
                }`}
              >
                {auditFeedback.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                )}
                <span>{auditFeedback.message}</span>
              </div>
            )}

            {/* Acciones del Modal */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setIsAuditModalOpen(false)}
                disabled={isApproving}
              >
                Cerrar
              </Button>

              {selectedRepairer.estado === "EN_REVISION" ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleApproveDossier}
                  isLoading={isApproving}
                  disabled={isApproving || selectedRepairer.documentos.length === 0}
                  className="shadow-md shadow-emerald-600/20"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Aprobar y Habilitar Perfil</span>
                </Button>
              ) : (
                <span className="text-[11px] text-slate-400 italic">
                  Perfil no apto para aprobación directa ({selectedRepairer.estado})
                </span>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
