"use client";

import React, { useState, useEffect } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { Zap, Calendar, Clock, MapPin, Navigation, ArrowLeft, ArrowRight, ShieldCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";

const DEFAULT_CENTER = {
  lat: 19.3734,
  lng: -99.1798,
};

const MapPanController: React.FC<{
  center: { lat: number; lng: number };
  recenterTrigger: number;
}> = ({ center, recenterTrigger }) => {
  const map = useMap();

  useEffect(() => {
    if (map) {
      map.panTo(center);
    }
  }, [map, center.lat, center.lng]);

  useEffect(() => {
    if (map && recenterTrigger > 0) {
      map.panTo(center);
      map.setZoom(16);
    }
  }, [map, recenterTrigger, center]);

  return null;
};

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
    setCurrentLocation,
  } = useFixiStore();

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const [localUrgency, setLocalUrgency] = useState<"immediate" | "scheduled">(scheduleType);
  const [localDate, setLocalDate] = useState(scheduledDate);
  const [localSlot, setLocalSlot] = useState(scheduledTimeSlot);
  const [localNotes, setLocalNotes] = useState(locationNotes);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const [pinNotice, setPinNotice] = useState(false);

  const coords = {
    lat: typeof currentLocation?.lat === "number" ? currentLocation.lat : DEFAULT_CENTER.lat,
    lng: typeof currentLocation?.lng === "number" ? currentLocation.lng : DEFAULT_CENTER.lng,
  };

  const handleUpdateCoords = (newLat: number, newLng: number) => {
    if (typeof window !== "undefined" && (window as any).google?.maps?.Geocoder) {
      try {
        const geocoder = new (window as any).google.maps.Geocoder();
        geocoder.geocode({ location: { lat: newLat, lng: newLng } }, (results: any, status: any) => {
          if (status === "OK" && results && results[0]) {
            setCurrentLocation({
              ...currentLocation,
              lat: newLat,
              lng: newLng,
              fullAddress: results[0].formatted_address,
            });
          } else {
            setCurrentLocation({
              ...currentLocation,
              lat: newLat,
              lng: newLng,
            });
          }
        });
        return;
      } catch {
        // Fallback below
      }
    }
    setCurrentLocation({
      ...currentLocation,
      lat: newLat,
      lng: newLng,
    });
  };

  const handleMarkerDragEnd = (e: any) => {
    if (!e.latLng) return;
    const newLat = Number(e.latLng.lat().toFixed(6));
    const newLng = Number(e.latLng.lng().toFixed(6));
    handleUpdateCoords(newLat, newLng);
  };

  const handleMapClick = (e: any) => {
    if (!e.latLng) return;
    const newLat = Number(e.latLng.lat().toFixed(6));
    const newLng = Number(e.latLng.lng().toFixed(6));
    handleUpdateCoords(newLat, newLng);
  };

  const handleAjustarPin = () => {
    setRecenterTrigger((prev) => prev + 1);
    setPinNotice(true);
    setTimeout(() => setPinNotice(false), 2200);
  };

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

        {/* Interactive Google Map Canvas */}
        <div className="relative h-40 rounded-2xl overflow-hidden border border-slate-200 shadow-inner bg-slate-900 select-none">
          {!apiKey ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-slate-900 text-white">
              <MapPin className="w-6 h-6 text-amber-400 mb-1" />
              <p className="text-xs font-bold">API Key de Google Maps no configurada</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Verifica NEXT_PUBLIC_GOOGLE_MAPS_API_KEY en .env.local</p>
            </div>
          ) : (
            <APIProvider
              apiKey={apiKey}
              onLoad={() => setMapLoaded(true)}
              onError={(err) => setMapError(err instanceof Error ? err.message : "Error cargando Google Maps")}
            >
              <Map
                defaultCenter={coords}
                defaultZoom={15}
                gestureHandling="greedy"
                disableDefaultUI={false}
                zoomControl={true}
                mapTypeControl={false}
                streetViewControl={false}
                fullscreenControl={false}
                clickableIcons={false}
                onClick={handleMapClick}
                style={{ width: "100%", height: "100%" }}
              >
                <MapPanController center={coords} recenterTrigger={recenterTrigger} />
                <Marker
                  position={coords}
                  draggable={true}
                  onDragEnd={handleMarkerDragEnd}
                  title="Punto de atención del servicio (arrastra para ajustar)"
                />
              </Map>
            </APIProvider>
          )}

          {/* Top Status Badge */}
          <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none">
            <div className="bg-slate-900/85 backdrop-blur-md text-white text-[9px] font-medium px-2.5 py-1 rounded-xl border border-slate-700/60 shadow-md flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${mapLoaded ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-ping"}`} />
              <span>{mapLoaded ? "Google Maps Activo" : "Cargando mapa..."}</span>
            </div>
          </div>

          {/* Top Right Instruction Tooltip */}
          <div className="absolute top-2.5 right-2.5 z-10 pointer-events-none">
            <span className="bg-emerald-700/90 backdrop-blur-md text-white text-[9px] font-bold px-2 py-0.5 rounded-full shadow-md">
              📍 Pin ajustable
            </span>
          </div>

          {/* Error Banner */}
          {mapError && (
            <div className="absolute top-10 left-2.5 right-2.5 z-20 pointer-events-none">
              <div className="bg-red-950/90 border border-red-500/40 text-red-200 text-[10px] px-2.5 py-1 rounded-xl shadow-md">
                {mapError}
              </div>
            </div>
          )}

          {/* Pin center notice badge when recentered */}
          {pinNotice && (
            <div className="absolute bottom-11 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
              <div className="bg-slate-900/95 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg border border-emerald-500/50 whitespace-nowrap">
                🎯 Centrado en tu ubicación
              </div>
            </div>
          )}

          {/* GPS recenter / Ajustar Pin badge */}
          <button
            type="button"
            onClick={handleAjustarPin}
            className="absolute bottom-2.5 right-2.5 z-10 bg-white/95 backdrop-blur-sm hover:bg-white text-slate-800 text-[10px] font-bold px-2.5 py-1 rounded-xl shadow-md border border-slate-200 flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
            title="Centrar mapa en la ubicación del servicio y hacer zoom"
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
