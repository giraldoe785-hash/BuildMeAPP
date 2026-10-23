"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  HelpCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATE_LABELS,
  TERMINAL_STATES,
  type SlaStatus,
  type TicketCategory,
  type TicketPriority,
  type TicketState,
} from "@/lib/supportPolicy";
import { CreateTicketModal, type CreatedTicketSummary } from "./CreateTicketModal";
import { TicketMediationChat } from "./TicketMediationChat";

interface TicketListItem {
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
  sla: {
    status: SlaStatus;
    remainingMs: number;
  };
  orden: {
    id: string;
    numeroOrden: string;
  } | null;
}

interface UserSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialOpenCreate?: boolean;
  initialOrderId?: string | null;
}

export const UserSupportModal: React.FC<UserSupportModalProps> = ({
  isOpen,
  onClose,
  initialOpenCreate = false,
  initialOrderId = null,
}) => {
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<TicketListItem | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(initialOpenCreate);

  useEffect(() => {
    if (isOpen) {
      setIsCreateOpen(initialOpenCreate);
    }
  }, [isOpen, initialOpenCreate]);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/support/tickets", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message || "No se pudieron cargar tus tickets de soporte.");
        return;
      }
      if (Array.isArray(data.items)) {
        setTickets(data.items);
        if (selectedTicket) {
          const updated = data.items.find(
            (t: TicketListItem) => t.id === selectedTicket.id
          );
          if (updated) setSelectedTicket(updated);
        }
      }
    } catch {
      setError("Error de conexión al consultar tus tickets.");
    } finally {
      setLoading(false);
    }
  }, [selectedTicket]);

  useEffect(() => {
    if (isOpen) {
      fetchTickets();
    } else {
      setSelectedTicket(null);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

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
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
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

  const handleCreated = (_created: CreatedTicketSummary) => {
    setIsCreateOpen(false);
    fetchTickets();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4">
        <div className="w-full max-w-lg bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {selectedTicket ? (
                <button
                  type="button"
                  onClick={() => setSelectedTicket(null)}
                  className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                  title="Volver a mis tickets"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <HelpCircle className="w-5 h-5" />
                </div>
              )}
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold tracking-tight truncate">
                  {selectedTicket
                    ? `Ticket ${selectedTicket.numeroTicket}`
                    : "Centro de Ayuda y Mediación"}
                </h3>
                <p className="text-[11px] text-slate-300 truncate">
                  {selectedTicket
                    ? CATEGORY_LABELS[selectedTicket.categoria]
                    : "Radicación de casos y chat de mediación en tiempo real"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!selectedTicket && (
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="flex items-center gap-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-xl transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Nuevo Ticket</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Cerrar centro de soporte"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 overflow-y-auto flex-1 space-y-3">
            {selectedTicket ? (
              <div className="space-y-3">
                {/* Resumen del ticket */}
                <div className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-mono text-xs font-black text-slate-900">
                      {selectedTicket.numeroTicket}
                    </span>
                    <div className="flex items-center gap-1.5">
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
                    <h4 className="text-xs font-extrabold text-slate-900">
                      {selectedTicket.asunto}
                    </h4>
                    <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">
                      {selectedTicket.descripcion}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Mediador asignado</span>
                      <span className="font-bold text-slate-800">
                        {selectedTicket.asignado
                          ? "Agente de Soporte BuildMeAPP"
                          : "Pendiente de asignación"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Límite SLA</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {new Date(selectedTicket.fechaLimiteSla).toLocaleString("es-CO", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    {selectedTicket.orden && (
                      <div className="col-span-2">
                        <span className="text-[10px] text-slate-400 block">Orden vinculada</span>
                        <span className="font-mono font-bold text-emerald-700">
                          #{selectedTicket.orden.numeroOrden}
                        </span>
                      </div>
                    )}
                  </div>

                  {selectedTicket.resolucionDictamen && TERMINAL_STATES.includes(selectedTicket.estado) && (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1">
                      <div className="flex items-center gap-1.5 font-extrabold text-emerald-800 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Dictamen de Resolución Oficial</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        {selectedTicket.resolucionDictamen}
                      </p>
                    </div>
                  )}
                </div>

                {/* Chat de mediación HU23 */}
                <TicketMediationChat
                  ticketId={selectedTicket.id}
                  ticketEstado={selectedTicket.estado}
                  isAdmin={false}
                />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                    Mis Tickets ({tickets.length})
                  </span>
                  <button
                    type="button"
                    onClick={fetchTickets}
                    disabled={loading}
                    className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-800 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                    <span>Actualizar</span>
                  </button>
                </div>

                {error && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs text-rose-700">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {loading && tickets.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    Cargando tus tickets de soporte...
                  </div>
                ) : tickets.length === 0 ? (
                  <div className="p-8 bg-white rounded-3xl border border-slate-200/80 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-extrabold text-slate-900">
                        No tienes tickets abiertos
                      </h4>
                      <p className="text-xs text-slate-500 max-w-xs mx-auto">
                        Si tienes un inconveniente con un servicio, pago, garantía o acceso, radica un ticket para recibir mediación.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setIsCreateOpen(true)}
                      className="mx-auto flex items-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Radicar Primer Ticket</span>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {tickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        type="button"
                        onClick={() => setSelectedTicket(ticket)}
                        className="w-full text-left p-3.5 bg-white hover:bg-emerald-50/40 rounded-2xl border border-slate-200/80 hover:border-emerald-400 shadow-xs transition-all space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-black text-slate-900">
                            {ticket.numeroTicket}
                          </span>
                          <div className="flex items-center gap-1.5">
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
                          <p className="text-xs font-bold text-slate-900 line-clamp-1">
                            {ticket.asunto}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {CATEGORY_LABELS[ticket.categoria]}
                            {ticket.orden ? ` • Orden #${ticket.orden.numeroOrden}` : ""}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                          <span className="flex items-center gap-1 font-medium">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>
                              SLA:{" "}
                              {new Date(ticket.fechaLimiteSla).toLocaleString("es-CO", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </span>
                          </span>
                          <span className="flex items-center gap-1 font-bold text-emerald-700">
                            <MessageSquare className="w-3 h-3" />
                            <span>Abrir Chat</span>
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
      </div>

      <CreateTicketModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        initialOrderId={initialOrderId}
        onCreated={handleCreated}
      />
    </>
  );
};
