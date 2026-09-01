"use client";

import React, { useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { Zap, Calendar, Clock, MapPin, Navigation, ArrowLeft, ArrowRight, ShieldCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";

const TIME_SLOTS = [
  "09:00 AM - 11:00 AM",
  "11:30 AM - 01:30 PM",
  "02:00 PM - 04:00 PM",
  "04:30 PM - 06:30 PM",
  "07:00 PM - 09:00 PM",
];

export const StepScheduleLocation: React.FC = () => {
  const {
    scheduleType,
    scheduledDate,
    scheduledTimeSlot,
    locationNotes,
    currentLocation,
    setScheduleDetails,
    setLocationNotes,
    setWizardStep,
    setLocationModalOpen,
  } = useFixiStore();

  const [localUrgency, setLocalUrgency] = useState<"immediate" | "scheduled">(scheduleType);
  const [localDate, setLocalDate] = useState(scheduledDate);
  const [localSlot, setLocalSlot] = useState(scheduledTimeSlot);
  const [localNotes, setLocalNotes] = useState(locationNotes);

  const handleContinue = () => {
    setScheduleDetails(localUrgency, localDate, localSlot);
    setLocationNotes(localNotes);
    setWizardStep(3);
  };

  return (
    <div className="space-y-4">
      {/* Urgency Selector Tabs */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
        <span className="text-xs font-bold text-slate-900 block">
          ¿Cuándo requieres el servicio?
        </span>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setLocalUrgency("immediate")}
            className={`p-3 rounded-2xl border text-left flex flex-col justify-between transition-all ${
              localUrgency === "immediate"
                ? "bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                : "bg-white border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                <Zap className="w-4 h-4" />
              </div>
              {localUrgency === "immediate" && (
                <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Atención Inmediata</p>
              <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                Arribo en 30-45 min
              </p>
            </div>
          </button>

          <button
            onClick={() => setLocalUrgency("scheduled")}
            className={`p-3 rounded-2xl border text-left flex flex-col justify-between transition-all ${
              localUrgency === "scheduled"
                ? "bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                : "bg-white border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                <Calendar className="w-4 h-4" />
              </div>
              {localUrgency === "scheduled" && (
                <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Programar Visita</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Elige día y hora fija
              </p>
            </div>
          </button>
        </div>

        {/* If Scheduled, show date & slot picker */}
        {localUrgency === "scheduled" && (
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Fecha de la cita:
              </label>
              <input
                type="date"
                value={localDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => setLocalDate(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Franja Horaria:
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {TIME_SLOTS.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setLocalSlot(slot)}
                    className={`py-2 px-2 rounded-xl text-[11px] font-medium border text-center transition-all ${
                      localSlot === slot
                        ? "bg-slate-900 text-white border-slate-900 font-bold"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Map & Address Confirmation */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-emerald-600" />
            Punto de Atención en Mapa
          </span>
          <button
            onClick={() => setLocationModalOpen(true)}
            className="text-[11px] font-bold text-emerald-600 hover:underline"
          >
            Cambiar
          </button>
        </div>

        {/* Map visual canvas simulation */}
        <div className="relative h-40 rounded-2xl overflow-hidden border border-slate-200 shadow-inner bg-slate-100">
          {/* Simulated Map Streets Background */}
          <div className="absolute inset-0 opacity-80 bg-[radial-gradient(#94a3b8_1px,transparent_1px)] [background-size:16px_16px]">
            <svg className="w-full h-full text-slate-300 stroke-current" fill="none">
              <line x1="0" y1="40" x2="400" y2="40" strokeWidth="6" className="text-amber-100" />
              <line x1="0" y1="110" x2="400" y2="110" strokeWidth="8" className="text-slate-200" />
              <line x1="120" y1="0" x2="120" y2="200" strokeWidth="10" className="text-slate-200" />
              <line x1="280" y1="0" x2="280" y2="200" strokeWidth="6" className="text-emerald-100" />
            </svg>
          </div>

          {/* Central Pin Marker */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center">
              <div className="bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md mb-1 animate-bounce">
                Aquí llegará el técnico
              </div>
              <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-lg ring-4 ring-emerald-500/30">
                <MapPin className="w-5 h-5 fill-white" />
              </div>
              <div className="w-3 h-1.5 bg-slate-900/40 rounded-full blur-[1px] mt-0.5" />
            </div>
          </div>

          {/* GPS recenter badge */}
          <button
            onClick={() => setLocationModalOpen(true)}
            className="absolute bottom-2.5 right-2.5 bg-white/90 backdrop-blur-sm hover:bg-white text-slate-800 text-[10px] font-bold px-2.5 py-1 rounded-xl shadow-md border border-slate-200 flex items-center gap-1"
          >
            <Navigation className="w-3 h-3 text-emerald-600" />
            <span>Ajustar Pin</span>
          </button>
        </div>

        {/* Current Address Details */}
        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/70">
          <p className="text-xs font-bold text-slate-900">{currentLocation.name}</p>
          <p className="text-xs text-slate-600 mt-0.5">{currentLocation.fullAddress}</p>
          {currentLocation.apartmentInfo && (
            <p className="text-[11px] text-slate-400 mt-0.5">{currentLocation.apartmentInfo}</p>
          )}
        </div>

        {/* Access notes */}
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">
            Instrucciones de acceso para el técnico:
          </label>
          <input
            type="text"
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            placeholder="Ej. Timbre 4B, estacionamiento disponible en la esquina..."
            className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
          />
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex gap-2 pt-2">
        <Button
          variant="secondary"
          size="lg"
          className="w-1/3 flex items-center justify-center gap-1.5"
          onClick={() => setWizardStep(1)}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Atrás</span>
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="w-2/3 flex items-center justify-center gap-2"
          onClick={handleContinue}
        >
          <span>Paso 3: Tarifa & Pago</span>
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
