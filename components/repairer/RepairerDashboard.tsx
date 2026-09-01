"use client";

import React, { useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { useFixiStore } from "@/store/useFixiStore";
import { SERVICE_CATEGORIES } from "@/data/services";
import { Wrench, Clock, ShieldCheck, MapPin, FileText, CheckCircle2, AlertTriangle, LogOut, DollarSign, Star, Sparkles, Navigation, UserCheck, ArrowRight, Bell } from "lucide-react";
import { Button } from "@/components/ui/Button";
import confetti from "canvas-confetti";

export const RepairerDashboard: React.FC = () => {
  const { currentUser, logout } = useAuthStore();
  const { isOnline } = useFixiStore();

  const [activeTabRepairer, setActiveTabRepairer] = useState<"requests" | "active_job" | "documents" | "profile">("requests");
  const [acceptedJob, setAcceptedJob] = useState<{
    id: string;
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
  } | null>(null);

  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [earnings, setEarnings] = useState(185.00);
  const [completedCount, setCompletedCount] = useState(4);

  const categoryInfo = SERVICE_CATEGORIES.find((c) => c.id === currentUser?.specialty) || SERVICE_CATEGORIES[0];

  // Solicitudes simuladas en la zona para la especialidad del reparador
  const availableRequests = [
    {
      id: "REQ-901",
      clientName: "Valeria Domínguez",
      address: "Col. Del Valle Sur, CDMX",
      distance: "1.1 km",
      issue: "Cortocircuito en tablero y falsos contactos en contactos de cocina",
      category: currentUser?.specialty || "electricidad",
      payout: 52.00,
      urgency: "immediate" as const,
    },
    {
      id: "REQ-902",
      clientName: "Marcos Estrada",
      address: "Col. Nápoles, CDMX",
      distance: "2.4 km",
      issue: "Instalación de 4 luminarias LED empotradas con sensor de movimiento",
      category: currentUser?.specialty || "electricidad",
      payout: 45.00,
      urgency: "scheduled" as const,
    },
  ];

  const handleAcceptJob = (req: typeof availableRequests[0]) => {
    setAcceptedJob({
      ...req,
      status: "dispatched",
      otpEntered: "",
      isOtpValid: false,
      extraCostRequested: false,
    });
    setActiveTabRepairer("active_job");
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    // En el demo aceptamos cualquier código de 4 dígitos o el código '8492' / '1234'
    if (otpInput.trim().length >= 4) {
      setAcceptedJob((prev) => (prev ? { ...prev, status: "in_progress", isOtpValid: true } : null));
      setOtpError(false);
      setOtpInput("");
    } else {
      setOtpError(true);
    }
  };

  const handleFinishJob = () => {
    if (!acceptedJob) return;
    try {
      confetti({ particleCount: 70, spread: 60 });
    } catch (e) {}

    setEarnings((prev) => prev + acceptedJob.payout);
    setCompletedCount((prev) => prev + 1);
    setAcceptedJob((prev) => (prev ? { ...prev, status: "finished" } : null));

    setTimeout(() => {
      setAcceptedJob(null);
      setActiveTabRepairer("requests");
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

          <button
            onClick={logout}
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
            title="Cerrar Sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="p-4 space-y-4">
        {/* REGLA #9: Banner de Verificación Pendiente Obligatorio */}
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
              Demo Frontend
            </span>
          </div>

          <p className="text-xs text-amber-950 leading-relaxed font-medium">
            Tu documentación está registrada en tu dispositivo y será revisada cuando BuildMeAPP incorpore el sistema administrativo de validación en backend.
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

        {/* Repairer Metrics */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Ingresos</span>
            <p className="text-sm font-black text-emerald-700 mt-0.5">${earnings.toFixed(2)}</p>
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
            Solicitudes ({availableRequests.length})
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
            {acceptedJob ? "En Trabajo ⚡" : "Mi Trabajo"}
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
              <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                Radio: 3.5 km
              </span>
            </div>

            {availableRequests.map((req) => (
              <div
                key={req.id}
                className="p-4 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold bg-slate-900 text-white px-2 py-0.5 rounded-full font-mono">
                    {req.id}
                  </span>
                  <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                    {req.urgency === "immediate" ? "⚡ Urgente (30 min)" : "📅 Programado"}
                  </span>
                </div>

                <div>
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
                      ${req.payout.toFixed(2)} USD
                    </span>
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    className="flex items-center gap-1.5 shadow-sm"
                    onClick={() => handleAcceptJob(req)}
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
                    onClick={() => setAcceptedJob((prev) => (prev ? { ...prev, status: "at_door" } : null))}
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
                      <Button type="submit" variant="primary" size="sm">
                        Iniciar Trabajo
                      </Button>
                    </div>
                    {otpError && (
                      <p className="text-[10px] text-rose-600 font-bold">
                        Ingresa un código de 4 dígitos para validar.
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
                    🎉 ¡Servicio finalizado! Monto de ${acceptedJob.payout.toFixed(2)} liquidado a tu billetera.
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center bg-white rounded-3xl border border-slate-200/80 space-y-2">
                <Clock className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-700">No tienes servicios activos</p>
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
                <span className="font-bold text-amber-700">🟡 Pendiente de revisión</span>
              </div>
            </div>

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
    </div>
  );
};
