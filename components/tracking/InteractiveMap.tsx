"use client";

import React, { useEffect, useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { MapPin, Navigation, Compass, Layers } from "lucide-react";

export const InteractiveMap: React.FC = () => {
  const { activeOrder } = useFixiStore();
  const [techPosProgress, setTechPosProgress] = useState(0.2);

  // Simulated technician moving along the route
  useEffect(() => {
    if (activeOrder?.status === "on_the_way") {
      const interval = setInterval(() => {
        setTechPosProgress((prev) => (prev >= 0.85 ? 0.2 : prev + 0.05));
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [activeOrder?.status]);

  const vehicleType = activeOrder?.technician.vehicle.type || "Moto";

  return (
    <div className="relative w-full h-[360px] bg-slate-900 overflow-hidden select-none">
      {/* Map Graphic Layer with Grid and Streets */}
      <div className="absolute inset-0 bg-[#0f172a] opacity-95">
        {/* Custom SVG Streets Network */}
        <svg className="w-full h-full" viewBox="0 0 400 360" fill="none">
          <defs>
            <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="glow" />
              <feComposite in="SourceGraphic" in2="glow" operator="over" />
            </filter>
          </defs>

          {/* Background Map Road Grid */}
          <path d="M-20,90 Q120,80 200,120 T420,100" stroke="#1e293b" strokeWidth="18" strokeLinecap="round" />
          <path d="M60,-20 L60,380" stroke="#1e293b" strokeWidth="14" />
          <path d="M340,-20 L340,380" stroke="#1e293b" strokeWidth="14" />
          <path d="M-20,260 L420,240" stroke="#1e293b" strokeWidth="16" />
          <path d="M180,0 L240,360" stroke="#1e293b" strokeWidth="12" />

          {/* Planned GPS Route Line */}
          {activeOrder?.status === "on_the_way" && (
            <>
              {/* Route Glow Shadow */}
              <path
                d="M70,80 C120,120 180,180 220,240"
                stroke="#10b981"
                strokeWidth="8"
                strokeOpacity="0.4"
                fill="none"
                filter="url(#glow)"
              />
              {/* Main Glowing Route */}
              <path
                d="M70,80 C120,120 180,180 220,240"
                stroke="url(#routeGradient)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray="6 4"
                fill="none"
              />
            </>
          )}

          {/* City District Blocks */}
          <rect x="80" y="20" width="80" height="50" rx="8" fill="#1e293b" fillOpacity="0.5" />
          <rect x="220" y="30" width="100" height="70" rx="8" fill="#1e293b" fillOpacity="0.5" />
          <rect x="80" y="150" width="70" height="80" rx="8" fill="#1e293b" fillOpacity="0.5" />
          <rect x="250" y="160" width="70" height="60" rx="8" fill="#1e293b" fillOpacity="0.5" />
        </svg>
      </div>

      {/* Customer Location Pin (Destination) */}
      <div className="absolute top-[230px] left-[210px] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center pointer-events-none">
        {/* Pulsing radar rings */}
        <div className="absolute -inset-4 rounded-full bg-emerald-500/20 animate-ping" />
        <div className="absolute -inset-2 rounded-full bg-emerald-500/40" />

        <div className="relative w-9 h-9 rounded-full bg-emerald-600 border-2 border-white shadow-xl flex items-center justify-center text-white">
          <MapPin className="w-5 h-5 fill-white" />
        </div>

        <span className="mt-1 bg-slate-900/90 backdrop-blur-sm text-white text-[9px] font-bold px-2 py-0.5 rounded-full border border-slate-700 shadow-md whitespace-nowrap">
          Tu Domicilio
        </span>
      </div>

      {/* Technician Moving Marker */}
      {activeOrder?.status === "on_the_way" && (
        <div
          style={{
            top: `${80 + (230 - 80) * techPosProgress}px`,
            left: `${70 + (210 - 70) * techPosProgress}px`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 z-30 transition-all duration-1000 ease-out flex flex-col items-center pointer-events-none"
        >
          {/* Floating ETA Tag */}
          <div className="bg-emerald-600 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full shadow-lg border border-emerald-400/50 mb-1 flex items-center gap-1 animate-pulse">
            <span>En camino • 12 min</span>
          </div>

          {/* Vehicle Icon Circle */}
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-slate-900 to-slate-800 border-2 border-emerald-400 shadow-2xl flex items-center justify-center text-white">
              <span className="text-base">{vehicleType === "Moto" ? "🏍️" : "🚐"}</span>
            </div>
            <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 absolute -top-1 -right-1 ring-2 ring-slate-900 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            </div>
          </div>
        </div>
      )}

      {/* When In-Progress: Technician icon at customer home */}
      {(activeOrder?.status === "in_progress" || activeOrder?.status === "completed") && (
        <div className="absolute top-[180px] left-[210px] -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center">
          <div className="bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg border border-emerald-400 flex items-center gap-1 mb-1">
            <span>🛠️ Técnico en el sitio</span>
          </div>
        </div>
      )}

      {/* Top Map Badges */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-20 pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur-md text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-700 shadow-md flex items-center gap-1.5 pointer-events-auto">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] font-mono">GPS Satelital Activo</span>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-md text-white text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-slate-700 shadow-md flex items-center gap-1.5 pointer-events-auto">
          <Layers className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[10px]">Tráfico en vivo</span>
        </div>
      </div>
    </div>
  );
};
