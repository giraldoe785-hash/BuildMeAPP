"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  HelpCircle,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  CATEGORY_LABELS,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  MAX_ATTACHMENT_BYTES,
  PRIORITY_LABELS,
  SLA_HOURS,
  SUBJECT_MAX,
  SUBJECT_MIN,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  validateTicketInput,
  type TicketCategory,
  type TicketPriority,
} from "@/lib/supportPolicy";

interface OrderOption {
  id: string;
  numeroOrden: string;
  estado: string;
  direccionServicio: string;
  fechaCreacion: string;
}

export interface CreatedTicketSummary {
  id: string;
  numeroTicket: string;
  asunto: string;
  categoria: TicketCategory;
  prioridad: TicketPriority;
  estado: string;
  fechaLimiteSla: string;
}

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialOrderId?: string | null;
  onCreated?: (ticket: CreatedTicketSummary) => void;
}

export const CreateTicketModal: React.FC<CreateTicketModalProps> = ({
  isOpen,
  onClose,
  initialOrderId = null,
  onCreated,
}) => {
  const [asunto, setAsunto] = useState("");
  const [categoria, setCategoria] = useState<TicketCategory>("FALLA_TECNICA_APP");
  const [prioridad, setPrioridad] = useState<TicketPriority>("MEDIA");
  const [ordenId, setOrdenId] = useState<string>(initialOrderId ?? "");
  const [descripcion, setDescripcion] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);

  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] = useState<CreatedTicketSummary | null>(
    null
  );

  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);
    if (initialOrderId) {
      setOrdenId(initialOrderId);
    }

    let active = true;
    setLoadingOrders(true);
    fetch("/api/support/orders", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data?.success && Array.isArray(data.items)) {
          setOrders(data.items);
        }
      })
      .catch(() => {
        /* sin órdenes previas o sin conexión */
      })
      .finally(() => {
        if (active) setLoadingOrders(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, initialOrderId]);

  if (!isOpen) return null;

  const resetAndClose = () => {
    setAsunto("");
    setDescripcion("");
    setCategoria("FALLA_TECNICA_APP");
    setPrioridad("MEDIA");
    setOrdenId(initialOrderId ?? "");
    setAttachment(null);
    setErrorMessage(null);
    setCreatedTicket(null);
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setAttachment(null);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setErrorMessage("El archivo adjunto no puede superar los 10 MB.");
      e.target.value = "";
      return;
    }
    setAttachment(file);
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const check = validateTicketInput({
      asunto,
      descripcion,
      categoria,
      prioridad,
      ordenId: ordenId || null,
    });

    if (!check.ok) {
      setErrorMessage(check.message);
      return;
    }

    setSubmitting(true);
    try {
      let response: Response;
      if (attachment) {
        const formData = new FormData();
        formData.append("asunto", check.data.asunto);
        formData.append("descripcion", check.data.descripcion);
        formData.append("categoria", check.data.categoria);
        formData.append("prioridad", check.data.prioridad);
        if (check.data.ordenId) {
          formData.append("ordenId", check.data.ordenId);
        }
        formData.append("attachment", attachment);

        response = await fetch("/api/support/tickets", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
      } else {
        response = await fetch("/api/support/tickets", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(check.data),
        });
      }

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        setErrorMessage(
          data?.message || "No fue posible radicar el ticket de soporte."
        );
        setSubmitting(false);
        return;
      }

      setCreatedTicket(data.ticket as CreatedTicketSummary);
      setSubmitting(false);
    } catch {
      setErrorMessage(
        "No se pudo conectar con el servidor. Verifica tu conexión."
      );
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-ticket-title"
    >
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="create-ticket-title"
                className="text-sm font-extrabold text-slate-900"
              >
                Radicar Ticket de Soporte
              </h3>
              <p className="text-[11px] text-slate-500">
                HU21 • Clasificación e inicio de atención con control SLA
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {createdTicket ? (
          <div className="p-6 space-y-4 overflow-y-auto">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-extrabold text-emerald-950">
                  Ticket radicado exitosamente
                </p>
                <p className="text-xs text-emerald-800">
                  Tu solicitud quedó registrada con el número único{" "}
                  <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-200">
                    {createdTicket.numeroTicket}
                  </span>
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Asunto:</span>
                <span className="font-bold text-slate-900 text-right">
                  {createdTicket.asunto}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Categoría:</span>
                <span className="font-semibold text-slate-800">
                  {CATEGORY_LABELS[createdTicket.categoria]}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Criticidad:</span>
                <span className="font-semibold text-slate-800">
                  {PRIORITY_LABELS[createdTicket.prioridad]} (SLA:{" "}
                  {SLA_HOURS[createdTicket.prioridad]}h)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Fecha límite SLA:</span>
                <span className="font-mono text-slate-800">
                  {new Date(createdTicket.fechaLimiteSla).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              {onCreated && (
                <Button
                  type="button"
                  variant="primary"
                  className="flex-1"
                  onClick={() => {
                    const ticket = createdTicket;
                    resetAndClose();
                    onCreated(ticket);
                  }}
                >
                  Abrir conversación del ticket
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={resetAndClose}
              >
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="p-5 space-y-4 overflow-y-auto"
          >
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-700 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Asunto */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Asunto del incidente *
              </label>
              <input
                type="text"
                required
                minLength={SUBJECT_MIN}
                maxLength={SUBJECT_MAX}
                value={asunto}
                onChange={(e) => {
                  setAsunto(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="Ej. Disputa sobre cobro adicional o falla en la orden"
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
              />
              <p className="text-[10px] text-slate-400 mt-1 text-right">
                {asunto.trim().length}/{SUBJECT_MAX} caracteres
              </p>
            </div>

            {/* Categoría y Prioridad */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tipo de incidente *
                </label>
                <select
                  value={categoria}
                  onChange={(e) =>
                    setCategoria(e.target.value as TicketCategory)
                  }
                  className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
                >
                  {TICKET_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nivel de criticidad *
                </label>
                <select
                  value={prioridad}
                  onChange={(e) =>
                    setPrioridad(e.target.value as TicketPriority)
                  }
                  className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
                >
                  {TICKET_PRIORITIES.map((prio) => (
                    <option key={prio} value={prio}>
                      {PRIORITY_LABELS[prio]} — SLA {SLA_HOURS[prio]}h
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Aviso SLA */}
            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 flex items-center gap-2.5 text-xs text-amber-900">
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Plazo máximo de atención según criticidad{" "}
                <strong>{PRIORITY_LABELS[prioridad]}</strong>:{" "}
                <strong>{SLA_HOURS[prioridad]} horas</strong> (política SLA
                provisional del proyecto).
              </span>
            </div>

            {/* Orden vinculada opcional */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Orden de servicio relacionada (opcional)
              </label>
              <select
                value={ordenId}
                onChange={(e) => setOrdenId(e.target.value)}
                disabled={loadingOrders}
                className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
              >
                <option value="">
                  {loadingOrders
                    ? "Cargando tus órdenes..."
                    : "Sin vincular a una orden específica"}
                </option>
                {orders.map((ord) => (
                  <option key={ord.id} value={ord.id}>
                    #{ord.numeroOrden} • {ord.estado} • {ord.direccionServicio}
                  </option>
                ))}
              </select>
            </div>

            {/* Descripción */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Descripción detallada *
              </label>
              <textarea
                required
                rows={4}
                minLength={DESCRIPTION_MIN}
                maxLength={DESCRIPTION_MAX}
                value={descripcion}
                onChange={(e) => {
                  setDescripcion(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="Describe qué ocurrió, fechas o detalles relevantes para que soporte pueda ayudarte..."
                className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900 resize-none"
              />
              <p className="text-[10px] text-slate-400 mt-1 text-right">
                {descripcion.trim().length}/{DESCRIPTION_MAX} caracteres (mín.{" "}
                {DESCRIPTION_MIN})
              </p>
            </div>

            {/* Evidencia adjunta */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Evidencia adjunta (opcional • PDF, JPG o PNG máx. 10 MB)
              </label>
              <label className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100/70 cursor-pointer transition-colors text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  {attachment ? (
                    <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Upload className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className="truncate text-slate-700">
                    {attachment
                      ? `${attachment.name} (${Math.max(
                          1,
                          Math.round(attachment.size / 1024)
                        )} KB)`
                      : "Seleccionar archivo de evidencia..."}
                  </span>
                </div>
                {attachment && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.preventDefault();
                      setAttachment(null);
                    }}
                    className="text-[11px] font-bold text-rose-600 hover:underline shrink-0"
                  >
                    Quitar
                  </button>
                )}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={resetAndClose}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={submitting}
                className="flex-1"
              >
                Radicar Ticket
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
