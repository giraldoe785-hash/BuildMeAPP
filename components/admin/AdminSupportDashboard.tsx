"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Filter,
  LogOut,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { Button } from "@/components/ui/Button";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATE_LABELS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATES,
  DICTAMEN_MIN,
  DICTAMEN_MAX,
  type SlaStatus,
  type TicketCategory,
  type TicketPriority,
  type TicketState,
} from "@/lib/supportPolicy";
import { TicketMediationChat } from "@/components/support/TicketMediationChat";

interface SlaInfo {
  status: SlaStatus;
  remainingMs: number;
}

interface AdminTicketItem {
  id: string;
  numeroTicket: string;
  asunto: string;
  descripcion: string;
  categoria: TicketCategory;
  prioridad: TicketPriority;
  estado: TicketState;
  resolucionDictamen: string | null;
  fechaLimiteSla: string;
  creadoEn: string;
  actualizadoEn: string;
  cerradoEn: string | null;
  esPropio: boolean;
  asignado: boolean;
  sla: SlaInfo;
  emisor?: {
    id: string;
    nombre: string;
    rol: string;
  };
  agente?: {
    id: string;
    nombre: string;
  } | null;
  orden: {
    id: string;
    numeroOrden: string;
  } | null;
}

interface InboxSummary {
  pendientes: number;
  sinAsignar: number;
  vencidos: number;
  porVencer: number;
}

interface AdminAgentOption {
  id: string;
  nombre: string;
}

export const AdminSupportDashboard: React.FC = () => {
  const { currentUser, logout } = useAuthStore();

  const [tickets, setTickets] = useState<AdminTicketItem[]>([]);
  const [summary, setSummary] = useState<InboxSummary>({
    pendientes: 0,
    sinAsignar: 0,
    vencidos: 0,
    porVencer: 0,
  });
  const [agents, setAgents] = useState<AdminAgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterEstado, setFilterEstado] = useState<string>("ALL");
  const [filterPrioridad, setFilterPrioridad] = useState<string>("ALL");
  const [filterCategoria, setFilterCategoria] = useState<string>("ALL");
  const [filterAsignado, setFilterAsignado] = useState<string>("ALL");
  const [filterSla, setFilterSla] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);

  // Selected Ticket & Actions
  const [selectedTicket, setSelectedTicket] = useState<AdminTicketItem | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignFeedback, setAssignFeedback] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  const [targetEstado, setTargetEstado] = useState<TicketState>("EN_GESTION");
  const [dictamenText, setDictamenText] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  const [chatRefreshCounter, setChatRefreshCounter] = useState(0);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/support/agents", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.agents)) {
        setAgents(data.agents);
      }
    } catch {
      // ignore non-critical error
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterEstado !== "ALL") params.set("estado", filterEstado);
      if (filterPrioridad !== "ALL") params.set("prioridad", filterPrioridad);
      if (filterCategoria !== "ALL") params.set("categoria", filterCategoria);
      if (filterAsignado !== "ALL") params.set("asignado", filterAsignado);
      if (filterSla !== "ALL") params.set("sla", filterSla);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());

      const res = await fetch(`/api/support/tickets?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message || "Error al consultar la bandeja de soporte.");
        return;
      }
      if (Array.isArray(data.items)) {
        setTickets(data.items);
      }
      if (data.resumen) {
        setSummary(data.resumen);
      }
    } catch {
      setError("Error de conexión al cargar la bandeja de soporte.");
    } finally {
      setLoading(false);
    }
  }, [
    filterEstado,
    filterPrioridad,
    filterCategoria,
    filterAsignado,
    filterSla,
    searchQuery,
  ]);

  const fetchTicketDetail = useCallback(async (ticketId: string) => {
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ticket) {
        const t = data.ticket as AdminTicketItem;
        setSelectedTicket(t);
        setSelectedAgentId(t.agente?.id || "");
        setTargetEstado(t.estado);
        setDictamenText(t.resolucionDictamen || "");
      }
    } catch {
      // keep existing selectedTicket
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleSelectTicket = (ticket: AdminTicketItem) => {
    setSelectedTicket(ticket);
    setSelectedAgentId(ticket.agente?.id || "");
    setTargetEstado(ticket.estado);
    setDictamenText(ticket.resolucionDictamen || "");
    setAssignFeedback(null);
    setStatusFeedback(null);
    fetchTicketDetail(ticket.id);
  };

  const handleAssign = async (agentIdToAssign: string | null) => {
    if (!selectedTicket) return;
    setAssignLoading(true);
    setAssignFeedback(null);
    try {
      const res = await fetch(`/api/support/tickets/${selectedTicket.id}/assign`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agenteId: agentIdToAssign,
          actualizadoEn: selectedTicket.actualizadoEn,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setAssignFeedback({
          type: "error",
          text: data?.message || "No se pudo actualizar la asignación.",
        });
        if (res.status === 409) {
          await fetchTicketDetail(selectedTicket.id);
        }
        return;
      }

      setAssignFeedback({
        type: "ok",
        text: agentIdToAssign
          ? "Ticket asignado y registrado en auditoría."
          : "Ticket liberado sin agente asignado.",
      });
      await fetchTicketDetail(selectedTicket.id);
      await fetchTickets();
      setChatRefreshCounter((c) => c + 1);
    } catch {
      setAssignFeedback({
        type: "error",
        text: "Error de red al asignar el ticket.",
      });
    } finally {
      setAssignLoading(false);
    }
  };

  const handleStatusChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;

    if (
      (targetEstado === "RESUELTO" || targetEstado === "CERRADO") &&
      dictamenText.trim().length < DICTAMEN_MIN
    ) {
      setStatusFeedback({
        type: "error",
        text: `Para resolver o cerrar un ticket debes registrar un dictamen de al menos ${DICTAMEN_MIN} caracteres.`,
      });
      return;
    }

    setStatusLoading(true);
    setStatusFeedback(null);
    try {
      const res = await fetch(`/api/support/tickets/${selectedTicket.id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: targetEstado,
          dictamen: dictamenText.trim() || undefined,
          actualizadoEn: selectedTicket.actualizadoEn,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setStatusFeedback({
          type: "error",
          text: data?.message || "No se pudo cambiar el estado del ticket.",
        });
        return;
      }

      setStatusFeedback({
        type: "ok",
        text: `Estado actualizado a ${STATE_LABELS[targetEstado]}.`,
      });
      await fetchTicketDetail(selectedTicket.id);
      await fetchTickets();
      setChatRefreshCounter((c) => c + 1);
    } catch {
      setStatusFeedback({
        type: "error",
        text: "Error de red al cambiar el estado.",
      });
    } finally {
      setStatusLoading(false);
    }
  };

  const renderSlaBadge = (sla: SlaInfo) => {
    if (sla.status === "closed") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>SLA Cerrado</span>
        </span>
      );
    }
    const hoursAbs = Math.max(0, Math.round(Math.abs(sla.remainingMs) / (1000 * 60 * 60)));
    if (sla.status === "overdue") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
          <ShieldAlert className="w-3 h-3 text-rose-600" />
          <span>SLA Vencido ({hoursAbs}h)</span>
        </span>
      );
    }
    if (sla.status === "warning") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          <span>Por vencer (≤25% • {hoursAbs}h)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
        <Clock className="w-3 h-3 text-emerald-600" />
        <span>En tiempo ({hoursAbs}h)</span>
      </span>
    );
  };

  const getPriorityBadgeClass = (prioridad: TicketPriority) => {
    switch (prioridad) {
      case "CRITICA":
        return "bg-rose-100 text-rose-800 border-rose-200";
      case "ALTA":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "MEDIA":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "BAJA":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
    }
  };

  const getStateBadgeClass = (estado: TicketState) => {
    switch (estado) {
      case "ABIERTO":
        return "bg-sky-100 text-sky-800 border-sky-200";
      case "EN_GESTION":
        return "bg-indigo-100 text-indigo-800 border-indigo-200";
      case "EN_ESPERA_USUARIO":
        return "bg-amber-100 text-amber-900 border-amber-300";
      case "RESUELTO":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "CERRADO":
        return "bg-slate-200 text-slate-700 border-slate-300";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-12">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white border-b border-slate-800 px-4 py-3 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {selectedTicket ? (
              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Volver a la bandeja"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-xs font-black tracking-tight truncate">
                  {selectedTicket
                    ? `Mediación ${selectedTicket.numeroTicket}`
                    : "Consola de Soporte & Mediación"}
                </h1>
                <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 font-bold px-1.5 py-0.2 rounded-full uppercase">
                  Admin
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono truncate">
                {currentUser?.name} (@{currentUser?.username})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (selectedTicket) {
                  fetchTicketDetail(selectedTicket.id);
                }
                fetchTickets();
              }}
              className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
              title="Actualizar bandeja"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={logout}
              className="p-2 text-slate-300 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="p-4 space-y-4 flex-1">
        {selectedTicket ? (
          /* VISTA DE DETALLE, ASIGNACIÓN, ESTADO Y CHAT DE MEDIACIÓN */
          <div className="space-y-4">
            {/* Tarjeta de Información del Ticket */}
            <div className="p-4 bg-white rounded-3xl border border-slate-200/90 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-black text-slate-900">
                  {selectedTicket.numeroTicket}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {renderSlaBadge(selectedTicket.sla)}
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getPriorityBadgeClass(
                      selectedTicket.prioridad
                    )}`}
                  >
                    {PRIORITY_LABELS[selectedTicket.prioridad]}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStateBadgeClass(
                      selectedTicket.estado
                    )}`}
                  >
                    {STATE_LABELS[selectedTicket.estado]}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  {CATEGORY_LABELS[selectedTicket.categoria]}
                </span>
                <h2 className="text-sm font-extrabold text-slate-900 mt-0.5">
                  {selectedTicket.asunto}
                </h2>
                <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">
                  {selectedTicket.descripcion}
                </p>
              </div>

              <div className="pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-2.5 text-[11px]">
                <div>
                  <span className="text-[10px] text-slate-400 block">Usuario Emisor</span>
                  <span className="font-bold text-slate-900">
                    {selectedTicket.emisor?.nombre || "Usuario"}
                  </span>
                  <span className="text-[10px] text-slate-500 block font-mono">
                    {selectedTicket.emisor?.rol || "CLIENTE"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Límite SLA (Fijo)</span>
                  <span className="font-mono font-bold text-slate-900">
                    {new Date(selectedTicket.fechaLimiteSla).toLocaleString("es-CO", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    Creado:{" "}
                    {new Date(selectedTicket.creadoEn).toLocaleString("es-CO", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                {selectedTicket.orden && (
                  <div className="col-span-2 p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">
                        Orden de Servicio Relacionada
                      </span>
                      <span className="font-mono text-xs font-extrabold text-emerald-700">
                        #{selectedTicket.orden.numeroOrden}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Panel HU22: Asignación de Agente Mediador */}
            <div className="p-4 bg-white rounded-3xl border border-slate-200/90 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                    Asignación de Mediador (HU22)
                  </h3>
                </div>
                {currentUser &&
                  selectedTicket.agente?.id !== currentUser.id && (
                    <button
                      type="button"
                      disabled={assignLoading}
                      onClick={() => handleAssign(currentUser.id)}
                      className="flex items-center gap-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-xl transition-colors disabled:opacity-50"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Tomar Caso</span>
                    </button>
                  )}
              </div>

              <div className="flex gap-2">
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  disabled={assignLoading}
                  className="flex-1 px-3 py-2 text-xs rounded-2xl border border-slate-200 bg-slate-50 text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- Sin agente asignado --</option>
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.nombre}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={assignLoading}
                  onClick={() => handleAssign(selectedAgentId || null)}
                >
                  {assignLoading ? "Guardando..." : "Guardar Asignación"}
                </Button>
              </div>

              {assignFeedback && (
                <div
                  className={`p-2.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 ${
                    assignFeedback.type === "ok"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-rose-50 border-rose-200 text-rose-700"
                  }`}
                >
                  {assignFeedback.type === "ok" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{assignFeedback.text}</span>
                </div>
              )}
            </div>

            {/* Panel HU22: Estado del Ticket y Dictamen de Resolución */}
            <form
              onSubmit={handleStatusChange}
              className="p-4 bg-white rounded-3xl border border-slate-200/90 shadow-xs space-y-3"
            >
              <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                Estado del Ticket y Dictamen Oficial
              </h3>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-700">
                  Estado actual / transición
                </label>
                <select
                  value={targetEstado}
                  onChange={(e) => setTargetEstado(e.target.value as TicketState)}
                  disabled={statusLoading}
                  className="w-full px-3 py-2 text-xs rounded-2xl border border-slate-200 bg-slate-50 text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {TICKET_STATES.map((st) => (
                    <option key={st} value={st}>
                      {STATE_LABELS[st]}
                    </option>
                  ))}
                </select>
              </div>

              {(targetEstado === "RESUELTO" ||
                targetEstado === "CERRADO" ||
                Boolean(dictamenText)) && (
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-700">
                    Dictamen de resolución{" "}
                    {(targetEstado === "RESUELTO" || targetEstado === "CERRADO") && (
                      <span className="text-rose-600">* (mín. {DICTAMEN_MIN} caracteres)</span>
                    )}
                  </label>
                  <textarea
                    rows={3}
                    value={dictamenText}
                    onChange={(e) => setDictamenText(e.target.value)}
                    disabled={statusLoading}
                    placeholder="Describe la decisión tomada, acuerdo entre las partes o resolución aplicada..."
                    className="w-full px-3 py-2 text-xs rounded-2xl border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  />
                </div>
              )}

              {statusFeedback && (
                <div
                  className={`p-2.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 ${
                    statusFeedback.type === "ok"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-rose-50 border-rose-200 text-rose-700"
                  }`}
                >
                  {statusFeedback.type === "ok" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{statusFeedback.text}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={statusLoading}
                className="w-full"
              >
                {statusLoading ? "Actualizando estado..." : "Actualizar Estado"}
              </Button>
            </form>

            {/* Chat de Mediación y Notas Internas (HU23) */}
            <TicketMediationChat
              ticketId={selectedTicket.id}
              ticketEstado={selectedTicket.estado}
              isAdmin={true}
              refreshTrigger={chatRefreshCounter}
            />
          </div>
        ) : (
          /* BANDEJA PRINCIPAL DE SOPORTE (HU22) */
          <>
            {/* Resumen Operativo y Alertas SLA */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setFilterSla("ALL");
                  setFilterEstado("ALL");
                  setFilterAsignado("ALL");
                }}
                className="p-2.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-400 transition-colors"
              >
                <span className="text-[9px] font-bold text-slate-400 uppercase block">
                  Pendientes
                </span>
                <span className="text-sm font-black text-slate-900">
                  {summary.pendientes}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFilterAsignado("none");
                  setFilterSla("ALL");
                }}
                className="p-2.5 bg-sky-50/70 rounded-2xl border border-sky-200 shadow-xs hover:border-sky-400 transition-colors"
              >
                <span className="text-[9px] font-bold text-sky-700 uppercase block">
                  Sin Asignar
                </span>
                <span className="text-sm font-black text-sky-900">
                  {summary.sinAsignar}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFilterSla("warning");
                  setFilterEstado("ALL");
                }}
                className="p-2.5 bg-amber-50/80 rounded-2xl border border-amber-300 shadow-xs hover:border-amber-500 transition-colors"
              >
                <span className="text-[9px] font-bold text-amber-800 uppercase block">
                  SLA ≤25%
                </span>
                <span className="text-sm font-black text-amber-900">
                  {summary.porVencer}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFilterSla("overdue");
                  setFilterEstado("ALL");
                }}
                className="p-2.5 bg-rose-50/80 rounded-2xl border border-rose-300 shadow-xs hover:border-rose-500 transition-colors"
              >
                <span className="text-[9px] font-bold text-rose-700 uppercase block">
                  Vencidos
                </span>
                <span className="text-sm font-black text-rose-800">
                  {summary.vencidos}
                </span>
              </button>
            </div>

            {/* Buscador y Botón de Filtros */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por #TCK o asunto..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-2xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowFilters((v) => !v)}
                  className={`px-3 py-2 rounded-2xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    showFilters
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Filtros</span>
                </button>
              </div>

              {/* Accesos rápidos de asignación */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {[
                  { id: "ALL", label: "Todos" },
                  { id: "none", label: "Sin asignar" },
                  { id: "me", label: "Mis casos" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterAsignado(tab.id)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap border transition-colors ${
                      filterAsignado === tab.id
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Panel desplegable de filtros detallados */}
              {showFilters && (
                <div className="p-3.5 bg-white rounded-2xl border border-slate-200/90 shadow-xs grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Estado
                    </label>
                    <select
                      value={filterEstado}
                      onChange={(e) => setFilterEstado(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                    >
                      <option value="ALL">Todos los estados</option>
                      {TICKET_STATES.map((st) => (
                        <option key={st} value={st}>
                          {STATE_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Prioridad
                    </label>
                    <select
                      value={filterPrioridad}
                      onChange={(e) => setFilterPrioridad(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                    >
                      <option value="ALL">Todas las prioridades</option>
                      {TICKET_PRIORITIES.map((pr) => (
                        <option key={pr} value={pr}>
                          {PRIORITY_LABELS[pr]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Categoría
                    </label>
                    <select
                      value={filterCategoria}
                      onChange={(e) => setFilterCategoria(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                    >
                      <option value="ALL">Todas las categorías</option>
                      {TICKET_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Estado SLA
                    </label>
                    <select
                      value={filterSla}
                      onChange={(e) => setFilterSla(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                    >
                      <option value="ALL">Todos</option>
                      <option value="overdue">Vencidos</option>
                      <option value="warning">Por vencer (≤25%)</option>
                      <option value="on_time">En tiempo</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Lista de Tickets en Bandeja */}
            {loading && tickets.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                Consultando bandeja de tickets...
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-8 bg-white rounded-3xl border border-slate-200/80 text-center space-y-2">
                <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="text-xs font-bold text-slate-800">
                  No se encontraron tickets con los filtros actuales
                </p>
                <p className="text-[11px] text-slate-500">
                  Prueba ajustando los criterios de búsqueda o limpiando los filtros activos.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => handleSelectTicket(ticket)}
                    className={`w-full text-left p-3.5 bg-white hover:bg-emerald-50/30 rounded-2xl border shadow-xs transition-all space-y-2 ${
                      ticket.sla.status === "overdue"
                        ? "border-rose-300 ring-1 ring-rose-200"
                        : ticket.sla.status === "warning"
                          ? "border-amber-300"
                          : "border-slate-200/90 hover:border-emerald-400"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="font-mono text-xs font-black text-slate-900">
                        {ticket.numeroTicket}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {renderSlaBadge(ticket.sla)}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getPriorityBadgeClass(
                            ticket.prioridad
                          )}`}
                        >
                          {PRIORITY_LABELS[ticket.prioridad]}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStateBadgeClass(
                            ticket.estado
                          )}`}
                        >
                          {STATE_LABELS[ticket.estado]}
                        </span>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-extrabold text-slate-900 line-clamp-1">
                        {ticket.asunto}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {CATEGORY_LABELS[ticket.categoria]} • Emisor:{" "}
                        <span className="font-semibold text-slate-700">
                          {ticket.emisor?.nombre || "Usuario"} (
                          {ticket.emisor?.rol || "CLIENTE"})
                        </span>
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                      <span>
                        {ticket.agente ? (
                          <span className="font-bold text-emerald-700">
                            Asignado: {ticket.agente.nombre}
                          </span>
                        ) : (
                          <span className="font-bold text-amber-700">
                            ⚠️ Sin asignar
                          </span>
                        )}
                      </span>
                      <span className="font-mono">
                        {ticket.orden
                          ? `Orden #${ticket.orden.numeroOrden}`
                          : "Sin orden vinculada"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
