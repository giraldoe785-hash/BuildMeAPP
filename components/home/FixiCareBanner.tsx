"use client";

import React from "react";
import { ShieldCheck, Lock, Award, Clock } from "lucide-react";

export const FixiCareBanner: React.FC = () => {
  return (
    <section className="px-4 py-3">
      <div className="p-4 rounded-3xl bg-gradient-to-r from-emerald-900 to-teal-900 text-white shadow-lg shadow-emerald-950/10 border border-emerald-500/20">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-xl bg-emerald-500/30 flex items-center justify-center border border-emerald-400/40">
            <ShieldCheck className="w-4 h-4 text-emerald-300" />
          </div>
          <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-300">
            Garantía FixiCare® Incluida
          </span>
        </div>

        <h4 className="text-xs font-bold text-slate-100 leading-snug">
          Tu tranquilidad es nuestra prioridad en cada reparación.
        </h4>

        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/10 text-center">
          <div className="flex flex-col items-center">
            <Award className="w-4 h-4 text-emerald-400 mb-1" />
            <span className="text-[10px] font-bold text-white">90 Días</span>
            <span className="text-[9px] text-slate-300">Garantía total</span>
          </div>

          <div className="flex flex-col items-center border-x border-white/10 px-1">
            <Lock className="w-4 h-4 text-amber-400 mb-1" />
            <span className="text-[10px] font-bold text-white">Hold Seguro</span>
            <span className="text-[9px] text-slate-300">Cobro al finalizar</span>
          </div>

          <div className="flex flex-col items-center">
            <Clock className="w-4 h-4 text-teal-400 mb-1" />
            <span className="text-[10px] font-bold text-white">OTP Clave</span>
            <span className="text-[9px] text-slate-300">Inicio validado</span>
          </div>
        </div>
      </div>
    </section>
  );
};
