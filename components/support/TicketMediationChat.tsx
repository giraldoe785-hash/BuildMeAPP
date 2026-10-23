"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  FileText,
  Lock,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  MAX_ATTACHMENT_BYTES,
  MESSAGE_MAX,
  type TicketState,
} from "@/lib/supportPolicy";

export interface SupportMessageItem {
  id: string;
  ticketId: string;
  mensaje: string;
  creadoEn: string;
  esNotaInterna: boolean;
  tieneAdjunto: boolean;
  autor: {
    id: string;
    nombre: string;
    rol: string;
    esPropio: boolean;
  };
}

interface TicketMediationChatProps {
  ticketId: string;
  ticketEstado: TicketState;
  isAdmin: boolean;
  refreshTrigger?: number;
}

const POLL_INTERVAL_MS = 4000;

export const TicketMediationChat: React.FC<TicketMediationChatProps> = ({
  ticketId,
  ticketEstado,
  isAdmin,
  refreshTrigger = 0,
}) => {
  const [messages, setMessages] = useState<SupportMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [esNotaInterna, setEsNotaInterna] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  const fetchMessages = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
          credentials: "include",
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (!mountedRef.current) return;

        if (!res.ok || !data?.success) {
          if (!silent) {
            setLoadError(
              data?.message || "No fue posible cargar la conversación."
            );
          }
          setLoading(false);
          return;
        }

        if (Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
        setLoadError(null);
        setLoading(false);
      } catch {
        if (!mountedRef.current) return;
        if (!silent) {
          setLoadError("Error de conexión al consultar los mensajes.");
        }
        setLoading(false);
      }
    },
    [ticketId]
  );

  // Carga inicial y actualización casi en tiempo real mediante sondeo limpio (cada 4s).
  useEffect(() => {
    mountedRef.current = true;
    fetchMessages(false);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchMessages(true);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, [fetchMessages, refreshTrigger]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setAttachment(null);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setSendError("El archivo adjunto no puede superar los 10 MB.");
      e.target.value = "";
      return;
    }
    setAttachment(file);
    setSendError(null);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendError(null);

    const clean = text.trim();
    if (!clean && !attachment) {
      setSendError("Escribe un mensaje o selecciona un archivo adjunto.");
      return;
    }

    setSending(true);
    try {
      let res: Response;
      if (attachment) {
        const formData = new FormData();
        formData.append("mensaje", clean);
        if (isAdmin && esNotaInterna) {
          formData.append("esNotaInterna", "true");
        }
        formData.append("attachment", attachment);

        res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
      } else {
        res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mensaje: clean,
            esNotaInterna: isAdmin ? esNotaInterna : false,
          }),
        });
      }

      const data = await res.json().catch(() => null);
      if (!mountedRef.current) return;

      if (!res.ok || !data?.success) {
        setSendError(data?.message || "No fue posible enviar el mensaje.");
        setSending(false);
        return;
      }

      setText("");
      setAttachment(null);
      setEsNotaInterna(false);
      setSending(false);

      if (data.item) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.item.id) ? prev : [...prev, data.item]
        );
      } else {
        fetchMessages(true);
      }
    } catch {
      if (!mountedRef.current) return;
      setSendError("Error de red al enviar el mensaje.");
      setSending(false);
    }
  };

  const isClosed = ticketEstado === "CERRADO";

  return (
    <div className="flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Cabecera del chat */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-extrabold text-slate-800">
            Conversación del Ticket
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            • actualización automática (4s)
          </span>
        </div>
        <button
          type="button"
          onClick={() => fetchMessages(false)}
          className="text-[11px] font-semibold text-slate-600 hover:text-emerald-700 inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
          title="Actualizar mensajes"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      {/* Lista de mensajes */}
      <div className="p-3.5 space-y-2.5 max-h-80 min-h-48 overflow-y-auto bg-slate-50/40">
        {loading ? (
          <div className="py-10 text-center text-xs text-slate-400">
            Cargando mensajes del ticket...
          </div>
        ) : loadError ? (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {loadError}
            </span>
            <button
              type="button"
              onClick={() => fetchMessages(false)}
              className="font-bold underline shrink-0"
            >
              Reintentar
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            Aún no hay mensajes en este ticket. Envía el primero para iniciar la
            mediación.
          </div>
        ) : (
          messages.map((m) => {
            const internal = m.esNotaInterna;
            const fromAdmin = m.autor.rol === "ADMINISTRADOR";

            return (
              <div
                key={m.id}
                className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                  internal
                    ? "bg-amber-50/90 border-amber-300 text-amber-950"
                    : m.autor.esPropio
                    ? "bg-emerald-50/80 border-emerald-200 text-slate-900 ml-4"
                    : "bg-white border-slate-200 text-slate-900 mr-4"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-extrabold text-slate-900">
                      {m.autor.nombre}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                        fromAdmin
                          ? "bg-indigo-100 text-indigo-800"
                          : m.autor.rol === "REPARADOR"
                          ? "bg-sky-100 text-sky-800"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {fromAdmin
                        ? "Soporte"
                        : m.autor.rol === "REPARADOR"
                        ? "Reparador"
                        : "Cliente"}
                    </span>
                    {internal && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-amber-200/80 text-amber-950 px-2 py-0.5 rounded-full">
                        <Lock className="w-3 h-3" />
                        Nota interna (solo soporte)
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {new Date(m.creadoEn).toLocaleString()}
                  </span>
                </div>

                <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                  {m.mensaje}
                </p>

                {m.tieneAdjunto && (
                  <div className="pt-1">
                    <a
                      href={`/api/support/attachments/${m.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 hover:text-emerald-800 bg-white/90 px-2.5 py-1 rounded-lg border border-emerald-200 shadow-2xs"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Descargar / ver adjunto
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {/* Formulario de envío */}
      {isClosed ? (
        <div className="p-3 bg-slate-100 border-t border-slate-200 text-center text-xs text-slate-500">
          Este ticket se encuentra cerrado y no admite nuevos mensajes.
        </div>
      ) : (
        <form
          onSubmit={handleSend}
          className="p-3 bg-white border-t border-slate-200 space-y-2"
        >
          {sendError && (
            <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-700 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{sendError}</span>
            </div>
          )}

          {isAdmin && (
            <div className="flex items-center justify-between bg-amber-50/70 border border-amber-200/80 px-3 py-1.5 rounded-xl">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-amber-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={esNotaInterna}
                  onChange={(e) => setEsNotaInterna(e.target.checked)}
                  className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                <Lock className="w-3.5 h-3.5 text-amber-700" />
                Registrar como nota interna (invisible para cliente y reparador)
              </label>
              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <textarea
                rows={2}
                maxLength={MESSAGE_MAX}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setSendError(null);
                }}
                placeholder={
                  isAdmin && esNotaInterna
                    ? "Escribe una nota interna confidencial para el equipo de soporte..."
                    : "Escribe un mensaje para el ticket..."
                }
                className={`w-full text-xs p-2.5 rounded-xl border focus:outline-none focus:ring-2 resize-none ${
                  isAdmin && esNotaInterna
                    ? "border-amber-300 bg-amber-50/40 focus:ring-amber-500 text-amber-950"
                    : "border-slate-200 bg-slate-50 focus:ring-emerald-500 text-slate-900"
                }`}
              />
            </div>

            <label
              className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
              title="Adjuntar archivo (PDF, JPG o PNG máx. 10 MB)"
            >
              <Paperclip className="w-4 h-4" />
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>

            <Button
              type="submit"
              size="sm"
              variant={isAdmin && esNotaInterna ? "emergency" : "primary"}
              isLoading={sending}
              className="h-10 px-3.5 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              Enviar
            </Button>
          </div>

          {attachment && (
            <div className="flex items-center justify-between text-[11px] bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
              <span className="truncate text-slate-700 font-medium">
                Adjunto: {attachment.name} (
                {Math.max(1, Math.round(attachment.size / 1024))} KB)
              </span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-rose-600 font-bold hover:underline ml-2"
              >
                Quitar
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
};
