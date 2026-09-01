"use client";

import React, { useState } from "react";
import { Search, Sparkles, Camera, Upload, ArrowRight, Video, Mic } from "lucide-react";
import { useFixiStore } from "@/store/useFixiStore";
import { AI_DIAGNOSIS_PRESETS } from "@/data/aiPresets";

export const AiScannerHero: React.FC = () => {
  const { startWizard, setSelectedCategory } = useFixiStore();
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Smart category matching
    const q = searchQuery.toLowerCase();
    if (q.includes("luz") || q.includes("electric") || q.includes("cable") || q.includes("enchufe") || q.includes("breaker")) {
      startWizard("electricidad");
    } else if (q.includes("agua") || q.includes("fuga") || q.includes("tubo") || q.includes("lavabo") || q.includes("inodoro")) {
      startWizard("plomeria");
    } else if (q.includes("llave") || q.includes("chapa") || q.includes("cerradura") || q.includes("puerta")) {
      startWizard("cerrajeria");
    } else if (q.includes("mueble") || q.includes("madera") || q.includes("puerta")) {
      startWizard("carpinteria");
    } else if (q.includes("pintar") || q.includes("humedad") || q.includes("muro")) {
      startWizard("pintura");
    } else {
      startWizard();
    }
  };

  return (
    <div className="px-4 pt-3 pb-2">
      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="relative mb-3">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="¿Qué necesitas reparar hoy? Ej. Fuga en lavabo..."
            className="w-full bg-white text-xs pl-10 pr-24 py-3 rounded-2xl border border-slate-200 shadow-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-slate-900 placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={() => startWizard()}
            className="absolute right-1.5 flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border border-emerald-200 transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Foto IA</span>
          </button>
        </div>
      </form>

      {/* Featured AI Scanner Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 p-5 text-white shadow-xl shadow-emerald-950/20 border border-emerald-500/30">
        {/* Background ambient glow */}
        <div className="absolute top-0 right-0 -mr-8 -mt-8 w-40 h-40 bg-emerald-500/20 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-8 -mb-8 w-32 h-32 bg-teal-500/20 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
              <Sparkles className="w-3 h-3 text-emerald-400" />
              Fixi Vision AI 2.0
            </span>
            <span className="text-[10px] text-emerald-300/80 font-mono">
              Diagnóstico en 3s
            </span>
          </div>

          <h2 className="text-base sm:text-lg font-extrabold text-white leading-snug">
            ¿No sabes qué falla tiene? <br />
            <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-white bg-clip-text text-transparent">
              Escanéala con Inteligencia Artificial
            </span>
          </h2>

          <p className="text-xs text-slate-300 mt-1 max-w-[92%] leading-relaxed">
            Sube foto, video o audio del problema. La IA detectará la causa, materiales y el precio garantizado al instante.
          </p>

          {/* Quick upload trigger CTA */}
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => startWizard()}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs py-3 px-4 rounded-xl shadow-lg shadow-emerald-500/25 active:scale-[0.98] transition-all"
            >
              <Camera className="w-4 h-4" />
              <span>Escanear Problema con IA</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Presets Quick Pills */}
          <div className="mt-3.5 pt-3 border-t border-white/10">
            <p className="text-[10px] font-medium text-emerald-200/80 mb-2">
              O prueba un diagnóstico de ejemplo:
            </p>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {AI_DIAGNOSIS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => startWizard(preset.category, preset.id)}
                  className="shrink-0 text-[11px] bg-white/10 hover:bg-white/20 text-slate-200 px-2.5 py-1 rounded-lg border border-white/15 transition-all text-left flex items-center gap-1"
                >
                  <span>⚡</span>
                  <span className="truncate max-w-[120px]">{preset.title.split(" ")[0]} {preset.title.split(" ")[1]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
