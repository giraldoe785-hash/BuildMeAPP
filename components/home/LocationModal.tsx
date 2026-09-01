"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useFixiStore } from "@/store/useFixiStore";
import { MapPin, Navigation, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ServiceLocation } from "@/types";

export const LocationModal: React.FC = () => {
  const {
    isLocationModalOpen,
    setLocationModalOpen,
    currentLocation,
    savedLocations,
    setCurrentLocation,
    addSavedLocation,
  } = useFixiStore();

  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newApt, setNewApt] = useState("");
  const [isDetectingGps, setIsDetectingGps] = useState(false);

  const handleUseGps = () => {
    setIsDetectingGps(true);
    setTimeout(() => {
      const gpsLocation: ServiceLocation = {
        id: `loc-gps-${Date.now()}`,
        name: "Ubicación Actual (GPS)",
        fullAddress: "Calle Durango 210, Roma Norte, CDMX",
        apartmentInfo: "Detectado vía Satélite ±4m",
        lat: 19.4187,
        lng: -99.1672,
      };
      setCurrentLocation(gpsLocation);
      setIsDetectingGps(false);
    }, 1200);
  };

  const handleSaveNewLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim() || !newAddress.trim()) return;

    const newLoc: ServiceLocation = {
      id: `loc-${Date.now()}`,
      name: newLabel.trim(),
      fullAddress: newAddress.trim(),
      apartmentInfo: newApt.trim() || undefined,
      lat: 19.39 + Math.random() * 0.05,
      lng: -99.17 + Math.random() * 0.05,
    };

    addSavedLocation(newLoc);
    setIsAddingNew(false);
    setNewLabel("");
    setNewAddress("");
    setNewApt("");
  };

  return (
    <Modal
      isOpen={isLocationModalOpen}
      onClose={() => {
        setLocationModalOpen(false);
        setIsAddingNew(false);
      }}
      title="Dirección del Servicio"
      description="Selecciona dónde necesitas la atención o añade un nuevo domicilio"
    >
      <div className="space-y-4">
        {/* GPS Quick Button */}
        <button
          onClick={handleUseGps}
          disabled={isDetectingGps}
          className="w-full flex items-center justify-between p-3.5 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 rounded-2xl text-emerald-800 transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Navigation className={`w-4 h-4 ${isDetectingGps ? "animate-spin" : ""}`} />
            </div>
            <div>
              <p className="text-xs font-bold">Usar mi ubicación actual</p>
              <p className="text-[11px] text-emerald-700">Geolocalización por GPS en tiempo real</p>
            </div>
          </div>
          {isDetectingGps && (
            <span className="text-[11px] font-semibold text-emerald-700 animate-pulse">
              Detectando...
            </span>
          )}
        </button>

        {/* Saved Locations List */}
        {!isAddingNew ? (
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wider px-1">
              Direcciones Guardadas
            </p>
            <div className="space-y-2">
              {savedLocations.map((loc) => {
                const isSelected = loc.id === currentLocation.id;
                return (
                  <button
                    key={loc.id}
                    onClick={() => setCurrentLocation(loc)}
                    className={`w-full flex items-start justify-between p-3.5 rounded-2xl border text-left transition-all ${
                      isSelected
                        ? "bg-emerald-50/60 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                        : "bg-white hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          isSelected
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-slate-900">{loc.name}</p>
                          {loc.isDefault && (
                            <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                              Predeterminada
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 truncate">{loc.fullAddress}</p>
                        {loc.apartmentInfo && (
                          <p className="text-[11px] text-slate-400">{loc.apartmentInfo}</p>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 ml-2">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="md"
              className="w-full mt-3 flex items-center justify-center gap-2"
              onClick={() => setIsAddingNew(true)}
            >
              <Plus className="w-4 h-4" />
              <span>Añadir otra dirección</span>
            </Button>
          </div>
        ) : (
          /* Form for new location */
          <form onSubmit={handleSaveNewLocation} className="space-y-3 pt-2">
            <p className="text-xs font-bold text-slate-800">Nueva Dirección</p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Etiqueta (ej. Casa, Depósito, Local)
              </label>
              <input
                type="text"
                required
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Mi Departamento"
                className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Calle y Número Exterior/Interior
              </label>
              <input
                type="text"
                required
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="Av. Juárez 890, Col. Centro"
                className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Piso, Depto o Referencia (Opcional)
              </label>
              <input
                type="text"
                value={newApt}
                onChange={(e) => setNewApt(e.target.value)}
                placeholder="Piso 3, Puerta B (Frente al elevador)"
                className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="w-1/2"
                onClick={() => setIsAddingNew(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="md" className="w-1/2">
                Guardar
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
