"use client";

import React from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { useAuthStore } from "@/store/useAuthStore";
import { User, ShieldCheck, CreditCard, MapPin, Bell, Globe, Smartphone, HelpCircle, LogOut, CheckCircle2, Wifi } from "lucide-react";

export const ProfileView: React.FC = () => {
  const {
    currentLocation,
    setLocationModalOpen,
    isDeviceFrameActive,
    toggleDeviceFrame,
    isOnline,
    setIsOnline,
  } = useFixiStore();

  const { currentUser, logout } = useAuthStore();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-4 pb-28 space-y-4">
      {/* Profile Header Card */}
      <div className="p-4 bg-white rounded-3xl border border-slate-200/80 shadow-xs flex items-center gap-3.5">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-xl shadow-md shadow-emerald-600/20">
          {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : "U"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-extrabold text-slate-900 truncate">
              {currentUser?.name || "Usuario Fixi"}
            </h3>
            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full uppercase">
              {currentUser?.role === "repairer" ? "Reparador" : "Cliente"}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-mono">@{currentUser?.username || "usuario"}</p>
          <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
            Miembro desde {currentUser?.createdAt || "2026"} • Autenticación Frontend
          </p>
        </div>
      </div>

      {/* Fixi Wallet & Protection Balance */}
      <div className="p-4 bg-gradient-to-r from-slate-900 to-emerald-950 text-white rounded-3xl border border-emerald-500/30 shadow-lg space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider font-mono text-emerald-300">
            Fixi Wallet & Cashback
          </span>
          <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-400/30">
            Activo
          </span>
        </div>
        <p className="text-2xl font-black text-white">$120.00 USD</p>
        <p className="text-[11px] text-slate-300">
          Saldo disponible aplicable a cualquier cotización con IA.
        </p>
      </div>

      {/* App & PWA Settings */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs divide-y divide-slate-100 overflow-hidden">
        <div className="p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Dirección Principal</p>
              <p className="text-[11px] text-slate-500 truncate max-w-[200px]">
                {currentLocation.fullAddress}
              </p>
            </div>
          </div>
          <button
            onClick={() => setLocationModalOpen(true)}
            className="text-xs font-bold text-emerald-600"
          >
            Cambiar
          </button>
        </div>

        <div className="p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Métodos de Pago</p>
              <p className="text-[11px] text-slate-500">Visa terminada en •••• 8821</p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-400">Administrar</span>
        </div>

        {/* Offline Toggle Simulation */}
        <div className="p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isOnline ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
              <Wifi className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Simulación Conexión PWA</p>
              <p className="text-[11px] text-slate-500">
                {isOnline ? "En línea (WebSockets & Realtime)" : "Modo Offline (Cache IndexedDB)"}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsOnline(!isOnline)}
            className={`text-xs font-bold px-2.5 py-1 rounded-xl transition-all ${
              isOnline
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {isOnline ? "Online" : "Offline"}
          </button>
        </div>

        {/* Logout button */}
        <div className="p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <LogOut className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-rose-600">Cerrar Sesión</p>
              <p className="text-[11px] text-slate-400">Volver a la pantalla de acceso</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="text-xs font-bold text-rose-600 hover:text-rose-800 px-3 py-1.5 rounded-xl hover:bg-rose-50 transition-colors"
          >
            Salir
          </button>
        </div>
      </div>
    </div>
  );
};
