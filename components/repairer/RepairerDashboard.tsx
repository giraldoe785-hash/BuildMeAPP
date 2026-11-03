"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { useFixiStore } from "@/store/useFixiStore";
import { SERVICE_CATEGORIES } from "@/data/services";
import { formatCatalogUnitsToCop } from "@/lib/pricing";
import { Wrench, Clock, ShieldCheck, MapPin, FileText, CheckCircle2, AlertTriangle, LogOut, DollarSign, Star, Sparkles, Navigation, UserCheck, ArrowRight, Bell, HelpCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { UserSupportModal } from "@/components/support/UserSupportModal";
import confetti from "canvas-confetti";

interface AvailableOrderItem {
  id: string;
  orderNumber: string;
  clientName: string;
  address: string;
  distance: string;
  issue: string;
  category: string;
  payout: number;
  urgency: "immediate" | "scheduled";
  isLiveStoreOrder: boolean;
}

interface AssignedJobItem {
  id: string;
  orderNumber: string;
  clientName: string;
  address: string;
  distance: string;
  issue: string;
  category: string;
  payout: number;
  urgency: "immediate" | "scheduled";
  status: "dispatched" | "at_door" | "in_progress" | "finished";
  otpEntered: string;
  isOtpValid: boolean;
  extraCostRequested: boolean;
}

export const RepairerDashboard: React.FC = () => {
  const { currentUser, logout } = useAuthStore();
  const { isOnline, activeOrder, setOrderStatus, validateOtpCode } = useFixiStore();

  const [activeTabRepairer, setActiveTabRepairer] = useState<"requests" | "active_job" | "documents" | "profile">("requests");
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<AvailableOrderItem[]>([]);
  const [isLoadingAvailable, setIsLoadingAvailable] = useState(false);
  const [availableOrdersError, setAvailableOrdersError] = useState<string | null>(null);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: "error" | "info";
    message: string;
  } | null>(null);
  const pollSeqRef = useRef(0);

  const [assignedJobs, setAssignedJobs] = useState<AssignedJobItem[]>([]);
  const [selectedAssignedJobId, setSelectedAssignedJobId] = useState<string | null>(null);
  const [isLoadingAssigned, setIsLoadingAssigned] = useState(false);
  const [assignedJobsError, setAssignedJobsError] = useState<string | null>(null);
  const assignedPollSeqRef = useRef(0);

  const acceptedJob =
    assignedJobs.find((j) => j.id === selectedAssignedJobId) ||
    assignedJobs[0] ||
    null;

  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [otpErrorMessage, setOtpErrorMessage] = useState<string | null>(null);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [earnings, setEarnings] = useState(185.00);
  const [completedCount, setCompletedCount] = useState(4);

  const categoryInfo = SERVICE_CATEGORIES.find((c) => c.id === currentUser?.specialty) || SERVICE_CATEGORIES[0];

  const loadAvailableOrders = useCallback(async (signal?: AbortSignal, showSpinner = false) => {
    const seq = ++pollSeqRef.current;
    if (showSpinner) {
      setIsLoadingAvailable(true);
    }

    try {
      const res = await fetch("/api/orders/available", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal,
      });

      const data = await res.json().catch(() => null);
      if (seq !== pollSeqRef.current) return;

      if (!res.ok || !data?.success) {
        setAvailableOrders([]);
        setAvailableOrdersError(
          data?.message ||
            "No fue posible cargar las solicitudes disponibles en este momento."
        );
        return;
      }

      setAvailableOrdersError(null);
      const mapped: AvailableOrderItem[] = Array.isArray(data.orders)
        ? data.orders.map((o: any) => ({
            id: String(o.id),
            orderNumber: String(o.orderNumber || o.id),
            clientName: String(o.clientDisplayName || "Cliente Fixi (En vivo)"),
            address: String(o.address || ""),
            distance: String(o.distance || "1.2 km"),
            issue: String(o.issue || "Solicitud de servicio"),
            category: String(o.category || categoryInfo.id),
            payout: Number(o.payout ?? 50),
            urgency: o.urgency === "scheduled" ? "scheduled" : "immediate",
            isLiveStoreOrder: true,
          }))
        : [];

      setAvailableOrders(mapped);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (seq === pollSeqRef.current && showSpinner) {
        setAvailableOrdersError("Error de conexión al consultar solicitudes disponibles.");
      }
    } finally {
      if (seq === pollSeqRef.current && showSpinner) {
        setIsLoadingAvailable(false);
      }
    }
  }, [categoryInfo.id]);

  const loadAssignedOrders = useCallback(
    async (signal?: AbortSignal, showSpinner = false) => {
      const seq = ++assignedPollSeqRef.current;
      if (showSpinner) {
        setIsLoadingAssigned(true);
      }

      try {
        const res = await fetch("/api/orders/assigned", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal,
        });

        const data = await res.json().catch(() => null);
        if (seq !== assignedPollSeqRef.current) return;

        if (!res.ok || !data?.success) {
          if (showSpinner) {
            setAssignedJobsError(
              data?.message || "No fue posible consultar tus solicitudes asignadas."
            );
          }
          return;
        }

        setAssignedJobsError(null);
        const incomingOrders: any[] = Array.isArray(data.orders) ? data.orders : [];

        setAssignedJobs((prev) => {
          const prevMap = new Map(prev.map((j) => [j.id, j]));
          return incomingOrders.map((o) => {
            const existing = prevMap.get(String(o.id));
            const dbStatus = o.dbStatus || "EN_CAMINO";
            const serverUiStatus: "dispatched" | "at_door" | "in_progress" | "finished" =
              o.status ||
              (dbStatus === "EN_SITIO"
                ? "at_door"
                : dbStatus === "EN_TRABAJO"
                ? "in_progress"
                : dbStatus === "FINALIZADO"
                ? "finished"
                : "dispatched");

            let finalStatus = serverUiStatus;
            if (existing?.status === "at_door" && serverUiStatus === "dispatched") {
              finalStatus = "at_door";
            } else if (
              existing?.status === "in_progress" &&
              (serverUiStatus === "dispatched" || serverUiStatus === "at_door")
            ) {
              finalStatus = "in_progress";
            } else if (existing?.status === "finished") {
              finalStatus = "finished";
            }

            return {
              id: String(o.id),
              orderNumber: String(o.orderNumber || o.id),
              clientName: String(o.clientDisplayName || o.clientName || "Cliente Fixi"),
              address: String(o.address || ""),
              distance: String(o.distance || "1.2 km"),
              issue: String(o.issue || "Servicio técnico"),
              category: String(o.category || categoryInfo.id),
              payout: Number(o.payout ?? 50),
              urgency: o.urgency === "scheduled" ? "scheduled" : "immediate",
              status: finalStatus,
              otpEntered: existing?.otpEntered || "",
              isOtpValid:
                finalStatus === "in_progress" ||
                finalStatus === "finished" ||
                Boolean(existing?.isOtpValid),
              extraCostRequested: Boolean(existing?.extraCostRequested),
            };
          });
        });
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (seq === assignedPollSeqRef.current && showSpinner) {
          setAssignedJobsError("Error de conexión al consultar solicitudes asignadas.");
        }
      } finally {
        if (seq === assignedPollSeqRef.current && showSpinner) {
          setIsLoadingAssigned(false);
        }
      }
    },
    [categoryInfo.id]
  );

  useEffect(() => {
    void loadAvailableOrders(undefined, true);
    void loadAssignedOrders(undefined, true);
  }, [loadAvailableOrders, loadAssignedOrders]);

  useEffect(() => {
    if (activeTabRepairer !== "requests") return;

    let isMounted = true;
    let currentController: AbortController | null = null;

    const triggerPoll = (initial: boolean) => {
      if (!isMounted) return;
      if (currentController) {
        currentController.abort();
      }
      const controller = new AbortController();
      currentController = controller;
      void loadAvailableOrders(controller.signal, initial);
    };

    triggerPoll(false);
    const intervalId = setInterval(() => {
      triggerPoll(false);
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      if (currentController) {
        currentController.abort();
      }
    };
  }, [activeTabRepairer, loadAvailableOrders]);

  useEffect(() => {
    if (activeTabRepairer !== "active_job") return;

    let isMounted = true;
    let currentController: AbortController | null = null;

    const triggerPoll = (initial: boolean) => {
      if (!isMounted) return;
      if (currentController) {
        currentController.abort();
      }
      const controller = new AbortController();
      currentController = controller;
      void loadAssignedOrders(controller.signal, initial);
    };

    triggerPoll(false);
    const intervalId = setInterval(() => {
      triggerPoll(false);
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      if (currentController) {
        currentController.abort();
      }
    };
  }, [activeTabRepairer, loadAssignedOrders]);

  const allAvailableRequests = availableOrders;

  const handleAcceptJob = async (req: AvailableOrderItem) => {
    if (acceptingOrderId) return;
    setAcceptingOrderId(req.id);
    setActionFeedback(null);

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(req.id)}/accept`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setActionFeedback({
          type: "error",
          message:
            data?.message ||
            "No fue posible aceptar esta solicitud. Es posible que otro reparador ya la haya tomado.",
        });
        await loadAvailableOrders(undefined, false);
        return;
      }

      const accepted = data.order || req;
      const newJob: AssignedJobItem = {
        id: String(accepted.id || req.id),
        orderNumber: String(accepted.orderNumber || req.orderNumber || req.id),
        clientName: String(accepted.clientDisplayName || req.clientName),
        address: String(accepted.address || req.address),
        distance: String(accepted.distance || req.distance),
        issue: String(accepted.issue || req.issue),
        category: String(accepted.category || req.category),
        payout: Number(accepted.payout ?? req.payout),
        urgency: accepted.urgency === "scheduled" ? "scheduled" : "immediate",
        status: "dispatched",
        otpEntered: "",
        isOtpValid: false,
        extraCostRequested: false,
      };

      setAssignedJobs((prev) => [newJob, ...prev.filter((j) => j.id !== newJob.id)]);
      setSelectedAssignedJobId(newJob.id);
      setAvailableOrders((prev) => prev.filter((item) => item.id !== req.id));
      setActiveTabRepairer("active_job");
      void loadAssignedOrders(undefined, false);
    } catch {
      setActionFeedback({
        type: "error",
        message: "Error de conexión al intentar aceptar el trabajo.",
      });
    } finally {
      setAcceptingOrderId(null);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedJob || isVerifyingOtp) return;

    const clean = otpInput.trim();
    if (!/^\d{4}$/.test(clean)) {
      setOtpError(true);
      setOtpErrorMessage("Ingresa un código de 4 dígitos numéricos.");
      return;
    }

    setIsVerifyingOtp(true);
    setOtpError(false);
    setOtpErrorMessage(null);

    try {
      const res = await fetch(`/api/orders/${acceptedJob.id}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otpCode: clean }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setOtpError(true);
        setOtpErrorMessage(data?.message || "Código incorrecto o no válido.");
        return;
      }

      // Éxito: el servidor validó el código y cambió la orden a EN_TRABAJO
      if (activeOrder && activeOrder.id === acceptedJob.id) {
        validateOtpCode(clean);
      }
      setAssignedJobs((prev) =>
        prev.map((job) =>
          job.id === acceptedJob.id
            ? { ...job, status: "in_progress", isOtpValid: true }
            : job
        )
      );
      setOtpError(false);
      setOtpErrorMessage(null);
      setOtpInput("");
    } catch {
      setOtpError(true);
      setOtpErrorMessage("Error de conexión al validar el código.");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleFinishJob = () => {
    if (!acceptedJob) return;
    try {
      confetti({ particleCount: 70, spread: 60 });
    } catch (e) {}

    if (activeOrder && activeOrder.id === acceptedJob.id) {
      setOrderStatus("completed");
    }

    setEarnings((prev) => prev + acceptedJob.payout);
    setCompletedCount((prev) => prev + 1);

    const finishedId = acceptedJob.id;
    setAssignedJobs((prev) =>
      prev.map((job) =>
        job.id === finishedId ? { ...job, status: "finished" } : job
      )
    );

    setTimeout(() => {
      setAssignedJobs((prev) => prev.filter((j) => j.id !== finishedId));
      if (assignedJobs.length <= 1) {
        setActiveTabRepairer("requests");
      }
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20">
      {/* Top Header for Repairer */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100 px-4 py-3 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-orange-500 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-black text-slate-900 truncate">
                  {currentUser?.name || "Reparador Fixi"}
                </h2>
                <span className="text-[9px] bg-orange-100 text-orange-800 font-bold px-1.5 py-0.2 rounded-full uppercase">
                  Técnico
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono">
                Especialidad: {categoryInfo.name} • Cédula: {currentUser?.cedula || "N/A"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsSupportOpen(true)}
              className="flex items-center gap-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-xl transition-colors"
              title="Centro de Soporte y Mediación"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Soporte</span>
            </button>
            <button
              onClick={logout}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="p-4 space-y-4">
        {/* REGLA #9: Banner de Estado de Acreditación Profesional */}
        {currentUser?.verificationStatus === "approved" ? (
          <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-emerald-500/10 border border-emerald-300 rounded-3xl space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-black uppercase tracking-wider text-emerald-900">
                  Estado: 🟢 Acreditado y Verificado
                </span>
              </div>
              <span className="text-[10px] font-mono bg-emerald-100 text-emerald-900 font-bold px-2 py-0.5 rounded-full border border-emerald-200">
                Habilitado
              </span>
            </div>
            <p className="text-xs text-emerald-950 leading-relaxed font-medium">
              Tu expediente profesional está aprobado. Puedes recibir y aceptar solicitudes de servicio reales de tu especialidad.
            </p>
          </div>
        ) : (
          <div className="p-4 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border border-amber-300 rounded-3xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                </span>
                <span className="text-xs font-black uppercase tracking-wider text-amber-900">
                  Estado: 🟡 Pendiente de Verificación
                </span>
              </div>
              <span className="text-[10px] font-mono bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                En Revisión
              </span>
            </div>

            <p className="text-xs text-amber-950 leading-relaxed font-medium">
              Tu documentación está registrada y requiere aprobación administrativa antes de que puedas consultar y aceptar órdenes reales.
            </p>

            <div className="pt-2 border-t border-amber-200/80 flex items-center justify-between text-[11px] text-amber-900">
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-amber-700" />
                <span>{currentUser?.documentName || "Certificado_Adjunto.pdf"}</span>
              </span>
              <span className="font-mono text-[10px] bg-white/70 px-1.5 py-0.5 rounded border border-amber-200">
                {currentUser?.documentSize || "1.8 MB"}
              </span>
            </div>
          </div>
        )}

        {/* Repairer Metrics */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Ingresos</span>
            <p className="text-sm font-black text-emerald-700 mt-0.5">{formatCatalogUnitsToCop(earnings.toFixed(2))}</p>
          </div>
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Trabajos</span>
            <p className="text-sm font-black text-slate-900 mt-0.5">{completedCount}</p>
          </div>
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Calificación</span>
            <p className="text-sm font-black text-amber-500 mt-0.5 flex items-center justify-center gap-0.5">
              <Star className="w-3 h-3 fill-amber-400" /> 4.95
            </p>
          </div>
        </div>

        {/* Tab Selector for Repairer view */}
        <div className="grid grid-cols-3 gap-1 bg-slate-200/80 p-1 rounded-2xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTabRepairer("requests")}
            className={`py-2 rounded-xl transition-all ${
              activeTabRepairer === "requests"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Solicitudes ({allAvailableRequests.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTabRepairer("active_job")}
            className={`py-2 rounded-xl transition-all ${
              activeTabRepairer === "active_job"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {assignedJobs.length > 0 ? `En Trabajo (${assignedJobs.length}) ⚡` : "Mi Trabajo"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTabRepairer("documents")}
            className={`py-2 rounded-xl transition-all ${
              activeTabRepairer === "documents"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Mi Ficha
          </button>
        </div>

        {/* Tab 1: Available Requests */}
        {activeTabRepairer === "requests" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                Solicitudes Cercanas ({categoryInfo.name})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadAvailableOrders(undefined, true)}
                  disabled={isLoadingAvailable}
                  className="text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1"
                  title="Actualizar solicitudes disponibles"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingAvailable ? "animate-spin" : ""}`} />
                  <span>Actualizar</span>
                </button>
                <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                  Radio: 3.5 km
                </span>
              </div>
            </div>

            {actionFeedback && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 font-semibold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{actionFeedback.message}</span>
              </div>
            )}

            {availableOrdersError && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-3xl text-xs text-amber-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Aviso de disponibilidad profesional</span>
                </p>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  {availableOrdersError}
                </p>
              </div>
            )}

            {!availableOrdersError && allAvailableRequests.length === 0 && (
              <div className="p-8 text-center bg-white rounded-3xl border border-slate-200/80 space-y-2">
                <Clock className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-700">
                  {isLoadingAvailable
                    ? "Buscando solicitudes disponibles en tu especialidad..."
                    : "No hay solicitudes disponibles en este momento"}
                </p>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                  Cuando un cliente confirme un servicio de {categoryInfo.name}, aparecerá aquí automáticamente.
                </p>
              </div>
            )}

            {allAvailableRequests.map((req) => (
              <div
                key={req.id}
                className={`p-4 bg-white rounded-3xl border shadow-xs space-y-3 ${
                  req.isLiveStoreOrder
                    ? "border-emerald-500 ring-2 ring-emerald-500/20"
                    : "border-slate-200/80"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold bg-slate-900 text-white px-2 py-0.5 rounded-full font-mono">
                      {req.orderNumber}
                    </span>
                    {req.isLiveStoreOrder && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Nueva Solicitud
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                    {req.urgency === "immediate" ? "⚡ Urgente (30 min)" : "📅 Programado"}
                  </span>
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-emerald-700 mb-0.5">
                    {req.clientName}
                  </p>
                  <h4 className="text-xs font-bold text-slate-900">{req.issue}</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    <span>{req.address} • {req.distance}</span>
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Pago estimado:</span>
                    <span className="text-sm font-black text-emerald-700">
                      {formatCatalogUnitsToCop(req.payout.toFixed(2))}
                    </span>
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    className="flex items-center gap-1.5 shadow-sm"
                    isLoading={acceptingOrderId === req.id}
                    disabled={acceptingOrderId !== null}
                    onClick={() => void handleAcceptJob(req)}
                  >
                    <span>Aceptar y Despachar</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 2: Active Job Management & OTP Flow */}
        {activeTabRepairer === "active_job" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                Trabajos Asignados ({assignedJobs.length})
              </h3>
              <button
                type="button"
                onClick={() => void loadAssignedOrders(undefined, true)}
                disabled={isLoadingAssigned}
                className="text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1"
                title="Actualizar trabajos asignados"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingAssigned ? "animate-spin" : ""}`} />
                <span>Actualizar</span>
              </button>
            </div>

            {assignedJobsError && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{assignedJobsError}</span>
              </div>
            )}

            {assignedJobs.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">
                  Seleccionar:
                </span>
                {assignedJobs.map((job, idx) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedAssignedJobId(job.id)}
                    className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all shrink-0 flex items-center gap-1.5 ${
                      acceptedJob?.id === job.id
                        ? "bg-orange-500 text-white border-orange-600 shadow-xs"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span>#{job.orderNumber || idx + 1}</span>
                    <span className="text-[10px] opacity-80 truncate max-w-[100px]">
                      {job.clientName}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {acceptedJob ? (
              <div className="p-4 bg-white rounded-3xl border-2 border-orange-500 shadow-md space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-orange-600 uppercase tracking-wider">
                    Servicio Activo en Curso
                  </span>
                  <span className="text-[10px] font-bold bg-orange-100 text-orange-900 px-2 py-0.5 rounded-full">
                    {acceptedJob.status === "dispatched" && "🚗 En Camino"}
                    {acceptedJob.status === "at_door" && "🚪 En Puerta"}
                    {acceptedJob.status === "in_progress" && "🛠️ Reparando"}
                    {acceptedJob.status === "finished" && "✅ Concluido"}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/70 space-y-1">
                  <p className="text-xs font-bold text-slate-900">{acceptedJob.clientName}</p>
                  <p className="text-[11px] text-slate-600">{acceptedJob.address}</p>
                  <p className="text-[11px] text-slate-500 italic mt-1">"{acceptedJob.issue}"</p>
                </div>

                {/* Step 1: Arrived at Door */}
                {acceptedJob.status === "dispatched" && (
                  <Button
                    variant="primary"
                    size="md"
                    className="w-full"
                    onClick={() =>
                      setAssignedJobs((prev) =>
                        prev.map((job) =>
                          job.id === acceptedJob.id ? { ...job, status: "at_door" } : job
                        )
                      )
                    }
                  >
                    <span>Marcar: He llegado a la puerta</span>
                  </Button>
                )}

                {/* Step 2: Request & Validate Customer OTP Code */}
                {acceptedJob.status === "at_door" && (
                  <form onSubmit={handleVerifyOtp} className="space-y-2 p-3 bg-amber-50 rounded-2xl border border-amber-200">
                    <span className="text-xs font-bold text-amber-900 block">
                      Solicita el Código OTP al Cliente
                    </span>
                    <p className="text-[11px] text-amber-800">
                      Pídele al cliente el código de 4 dígitos que ve en su pantalla de Fixi para habilitar el inicio.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={4}
                        value={otpInput}
                        onChange={(e) => {
                          setOtpInput(e.target.value);
                          setOtpError(false);
                        }}
                        placeholder="Ej. 8492"
                        className="flex-1 text-xs px-3 py-2 rounded-xl border border-amber-300 font-mono text-center font-bold"
                      />
                      <Button type="submit" variant="primary" size="sm" disabled={isVerifyingOtp}>
                        {isVerifyingOtp ? "Validando..." : "Iniciar Trabajo"}
                      </Button>
                    </div>
                    {otpError && (
                      <p className="text-[10px] text-rose-600 font-bold">
                        {otpErrorMessage || "Ingresa un código de 4 dígitos para validar."}
                      </p>
                    )}
                  </form>
                )}

                {/* Step 3: In Progress actions */}
                {acceptedJob.status === "in_progress" && (
                  <div className="space-y-2">
                    <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>OTP Validado. Trabajo formalmente iniciado.</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-amber-700 border-amber-300 bg-amber-50"
                        onClick={() => alert("Simulación: Solicitud de ajuste de repuestos enviada a la app del cliente.")}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        <span>Pedir Costo Extra</span>
                      </Button>

                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleFinishJob}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        <span>Terminar y Cobrar</span>
                      </Button>
                    </div>
                  </div>
                )}

                {acceptedJob.status === "finished" && (
                  <div className="p-3 bg-emerald-100 rounded-2xl text-center text-xs text-emerald-900 font-bold">
                    🎉 ¡Servicio finalizado! Monto de {formatCatalogUnitsToCop(acceptedJob.payout.toFixed(2))} liquidado a tu billetera.
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center bg-white rounded-3xl border border-slate-200/80 space-y-2">
                <Clock className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-700">
                  {isLoadingAssigned
                    ? "Consultando tus solicitudes asignadas..."
                    : "No tienes servicios activos"}
                </p>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                  Acepta una de las solicitudes disponibles en la pestaña anterior para iniciar despacho.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Document Details & Profile */}
        {activeTabRepairer === "documents" && (
          <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
            <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
              Expediente Profesional
            </h3>

            <div className="space-y-2 text-xs divide-y divide-slate-100">
              <div className="flex justify-between py-2">
                <span className="text-slate-500">Nombre completo:</span>
                <span className="font-bold text-slate-900">{currentUser?.name}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">Nombre de usuario:</span>
                <span className="font-mono text-slate-900">@{currentUser?.username}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">Cédula / Documento:</span>
                <span className="font-mono font-bold text-slate-900">{currentUser?.cedula}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">Especialidad:</span>
                <span className="font-bold text-emerald-700">{categoryInfo.name}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">Documento cargado:</span>
                <span className="font-bold text-slate-800">{currentUser?.documentName || "Certificado.pdf"}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">Estado de Acreditación:</span>
                {currentUser?.verificationStatus === "approved" ? (
                  <span className="font-bold text-emerald-700">🟢 Verificado y Aprobado</span>
                ) : (
                  <span className="font-bold text-amber-700">🟡 Pendiente de revisión</span>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              size="md"
              className="w-full text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 mt-2"
              onClick={() => setIsSupportOpen(true)}
            >
              <HelpCircle className="w-4 h-4 mr-1.5" />
              <span>Centro de Soporte y Mediación</span>
            </Button>

            <Button
              variant="secondary"
              size="md"
              className="w-full text-rose-600 hover:text-rose-700 mt-2"
              onClick={logout}
            >
              <LogOut className="w-4 h-4 mr-1.5" />
              <span>Cerrar Sesión de Técnico</span>
            </Button>
          </div>
        )}
      </div>

      <UserSupportModal
        isOpen={isSupportOpen}
        onClose={() => setIsSupportOpen(false)}
      />
    </div>
  );
};
