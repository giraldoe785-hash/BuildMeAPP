"use client";

import React from "react";
import { Home, Sparkles, Navigation, Clock, User } from "lucide-react";
import { useFixiStore } from "@/store/useFixiStore";

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab, activeOrder, startWizard } = useFixiStore();

  const isTrackingActive =
    activeOrder && activeOrder.status !== "completed" && activeOrder.status !== "cancelled";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 flex justify-center pointer-events-none px-3 pb-3">
      <nav aria-label="Navegación inferior" className="w-full max-w-md md:max-w-lg lg:max-w-xl bg-white/95 backdrop-blur-lg border border-slate-200/80 rounded-2xl shadow-xl shadow-slate-900/10 px-2 py-1.5 flex items-center justify-around pointer-events-auto">
        {/* Tab 1: Inicio */}
        <button
          onClick={() => setActiveTab("home")}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
            activeTab === "home"
              ? "text-emerald-600 font-bold scale-105"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Inicio</span>
        </button>

        {/* Tab 2: Pedidos / Historial */}
        <button
          onClick={() => setActiveTab("orders")}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
            activeTab === "orders"
              ? "text-emerald-600 font-bold scale-105"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <Clock className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Servicios</span>
        </button>

        {/* Central Floating Button: Scanner IA Wizard */}
        <button
          onClick={() => startWizard()}
          className="relative -top-5 flex flex-col items-center group"
        >
          <div className="w-13 h-13 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-600/40 group-hover:scale-110 group-active:scale-95 transition-all ring-4 ring-slate-50">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <span className="text-[10px] font-bold text-emerald-700 mt-0.5">
            IA Scan
          </span>
        </button>

        {/* Tab 4: Live Tracking */}
        <button
          onClick={() => setActiveTab("tracking")}
          className={`relative flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
            activeTab === "tracking"
              ? "text-emerald-600 font-bold scale-105"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <div className="relative">
            <Navigation className="w-5 h-5 mb-0.5" />
            {isTrackingActive && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-white animate-ping" />
            )}
          </div>
          <span className="text-[10px]">
            {isTrackingActive ? "En Vivo" : "Rastreo"}
          </span>
        </button>

        {/* Tab 5: Perfil */}
        <button
          onClick={() => setActiveTab("profile")}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
            activeTab === "profile"
              ? "text-emerald-600 font-bold scale-105"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <User className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Perfil</span>
        </button>
      </nav>
    </div>
  );
};
