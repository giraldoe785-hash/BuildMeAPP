"use client";

import React from "react";
import { MapPin, ChevronDown, Flame, Bell, Wifi, WifiOff } from "lucide-react";
import { useFixiStore } from "@/store/useFixiStore";

export const AppHeader: React.FC = () => {
  const {
    currentLocation,
    setLocationModalOpen,
    setEmergencyModalOpen,
    isOnline,
    activeOrder,
  } = useFixiStore();

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100 px-4 py-3 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        {/* Location Selector */}
        <button
          onClick={() => setLocationModalOpen(true)}
          className="flex items-center gap-2 text-left group max-w-[58%] py-1 px-1.5 -ml-1 rounded-xl hover:bg-slate-50 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200/60 group-hover:scale-105 transition-transform">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                Ubicación
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition-transform group-hover:translate-y-0.5" />
            </div>
            <p className="text-xs font-bold text-slate-900 truncate">
              {currentLocation.name}
            </p>
          </div>
        </button>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Emergency 24/7 High-priority button */}
          <button
            onClick={() => setEmergencyModalOpen(true)}
            className="relative flex items-center gap-1.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-md shadow-orange-500/25 hover:shadow-lg hover:shadow-orange-500/35 active:scale-95 transition-all overflow-hidden"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-90"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <Flame className="w-3.5 h-3.5 fill-white text-orange-200" />
            <span>SOS 24/7</span>
          </button>

          {/* Offline/Online PWA Indicator */}
          <div
            title={isOnline ? "Conectado a Fixi Realtime Engine" : "Modo Offline (Sincronización PWA local)"}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs border ${
              isOnline
                ? "bg-slate-50 text-slate-600 border-slate-200"
                : "bg-amber-50 text-amber-600 border-amber-300 animate-pulse"
            }`}
          >
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-600" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
