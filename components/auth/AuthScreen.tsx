"use client";

import React, { useState } from "react";
import { LoginForm } from "./LoginForm";
import { RegisterClientForm } from "./RegisterClientForm";
import { RegisterRepairerForm } from "./RegisterRepairerForm";
import { Wrench, Sparkles, ShieldCheck, UserCheck, Lock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type AuthViewMode = "login" | "register_select" | "register_client" | "register_repairer";

export const AuthScreen: React.FC = () => {
  const [viewMode, setViewMode] = useState<AuthViewMode>("login");

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center p-4 sm:p-6">
      <div className="w-full max-w-md mx-auto space-y-4">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center mx-auto shadow-xl shadow-emerald-600/30 border border-emerald-400/40">
            <Wrench className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              BuildMeAPP <span className="text-emerald-400 font-mono text-base font-normal">| Fixi</span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Servicios del hogar bajo demanda & Diagnóstico con IA
            </p>
          </div>
        </div>

        {/* Main Auth Card */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-slate-100 space-y-4">
          {/* Main Top Tab Switcher */}
          <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-2xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setViewMode("login")}
              className={`py-2 rounded-xl transition-all ${
                viewMode === "login"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => setViewMode("register_select")}
              className={`py-2 rounded-xl transition-all ${
                viewMode !== "login"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Crear Cuenta
            </button>
          </div>

          {/* Sub-selector for Register: Cliente vs Reparador */}
          {viewMode !== "login" && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setViewMode("register_client")}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  viewMode === "register_client" || viewMode === "register_select"
                    ? "bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 text-emerald-900 font-bold"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <UserCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs">Soy Cliente</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal">
                  Necesito reparaciones
                </p>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("register_repairer")}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  viewMode === "register_repairer"
                    ? "bg-orange-50/80 border-orange-500 ring-2 ring-orange-500/20 text-orange-900 font-bold"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Wrench className="w-4 h-4 text-orange-600" />
                  <span className="text-xs">Soy Reparador</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal">
                  Ofrezco mis servicios
                </p>
              </button>
            </div>
          )}

          {/* Dynamic Views */}
          <AnimatePresence mode="wait">
            {viewMode === "login" && (
              <motion.div
                key="view-login"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
              >
                <LoginForm onSwitchToRegister={() => setViewMode("register_client")} />
              </motion.div>
            )}

            {(viewMode === "register_select" || viewMode === "register_client") && (
              <motion.div
                key="view-reg-client"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
              >
                <RegisterClientForm onSwitchToLogin={() => setViewMode("login")} />
              </motion.div>
            )}

            {viewMode === "register_repairer" && (
              <motion.div
                key="view-reg-repairer"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
              >
                <RegisterRepairerForm onSwitchToLogin={() => setViewMode("login")} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer info: REGLA #3 y #4 */}
        <div className="text-center space-y-1 text-slate-400 text-[11px] pt-1">
          <p className="flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span>Demostración de Autenticación & Roles en Frontend</span>
          </p>
          <p className="text-[10px] text-slate-400">
            Persistencia local mediante localStorage • Listo para integración con backend
          </p>
        </div>
      </div>
    </div>
  );
};
