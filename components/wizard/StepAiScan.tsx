"use client";

import React, { useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { AI_DIAGNOSIS_PRESETS } from "@/data/aiPresets";
import { Sparkles, Camera, Upload, Mic, Video, CheckCircle2, AlertCircle, Wrench, Clock, ShieldCheck, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";

export const StepAiScan: React.FC = () => {
  const {
    currentDiagnosis,
    uploadedMediaUrl,
    userPromptInput,
    isAiAnalyzing,
    setUserPromptInput,
    setUploadedMediaUrl,
    runAiDiagnosis,
    setWizardStep,
    selectedCategoryForWizard,
  } = useFixiStore();

  const [activeTabMedia, setActiveTabMedia] = useState<"preset" | "upload">("preset");
  const [tempPrompt, setTempPrompt] = useState(userPromptInput || "");

  const handleSelectPreset = (presetId: string) => {
    runAiDiagnosis(presetId);
  };

  const handleSimulateCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const fakeUrl = URL.createObjectURL(file);
      setUploadedMediaUrl(fakeUrl);
      runAiDiagnosis();
    }
  };

  const handleContinue = () => {
    setUserPromptInput(tempPrompt);
    setWizardStep(2);
  };

  return (
    <div className="space-y-4">
      {/* Media Input Card */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-emerald-600" />
            Evidencia del Problema
          </span>

          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl text-[11px]">
            <button
              onClick={() => setActiveTabMedia("preset")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                activeTabMedia === "preset"
                  ? "bg-white text-slate-900 shadow-xs font-bold"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Ejemplos
            </button>
            <button
              onClick={() => setActiveTabMedia("upload")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                activeTabMedia === "upload"
                  ? "bg-white text-slate-900 shadow-xs font-bold"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Subir Archivo
            </button>
          </div>
        </div>

        {activeTabMedia === "preset" ? (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Selecciona una avería modelo para simular el análisis en tiempo real:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {AI_DIAGNOSIS_PRESETS.map((preset) => {
                const isSelected = currentDiagnosis?.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`relative p-2.5 rounded-2xl border text-left flex flex-col justify-between transition-all overflow-hidden ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20 shadow-xs"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <img
                        src={preset.thumbnailUrl}
                        alt={preset.title}
                        className="w-10 h-10 rounded-xl object-cover border border-slate-100"
                      />
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">
                          {preset.category}
                        </span>
                        <p className="text-[11px] font-bold text-slate-900 line-clamp-1 leading-tight">
                          {preset.title}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-100/80">
                      <span className="text-slate-500 font-medium">
                        Certeza: <strong className="text-slate-800">{preset.confidenceScore}%</strong>
                      </span>
                      <span className="text-emerald-700 font-bold">
                        {preset.pricingType === "guaranteed_fixed"
                          ? `$${preset.priceFixed?.toFixed(2)}`
                          : `$${preset.priceRangeMin}-$${preset.priceRangeMax}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Custom Upload Dropzone */
          <div className="relative border-2 border-dashed border-emerald-300 bg-emerald-50/30 rounded-2xl p-6 text-center hover:bg-emerald-50/50 transition-colors">
            <input
              type="file"
              accept="image/*,video/*,audio/*"
              onChange={handleSimulateCustomUpload}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 shadow-xs">
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-slate-800">
                Arrastra o haz clic para subir foto, video o audio
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Formatos: JPG, PNG, MP4, MP3 (Máx 25MB)
              </p>
            </div>
          </div>
        )}

        {/* Text prompt notes */}
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">
            Describe qué sucede (o agrega notas adicionales):
          </label>
          <textarea
            rows={2}
            value={tempPrompt}
            onChange={(e) => setTempPrompt(e.target.value)}
            placeholder="Ejemplo: Gotea agua constante por debajo del mueble del baño..."
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
          />
        </div>
      </div>

      {/* AI Scanner Analysis Card */}
      {isAiAnalyzing ? (
        <div className="p-6 bg-slate-900 text-white rounded-3xl relative overflow-hidden border border-emerald-500/40 shadow-xl">
          {/* Laser beam animation */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan-wave" />
          
          <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center animate-pulse">
                <Sparkles className="w-8 h-8 text-emerald-400" />
              </div>
              <span className="w-20 h-20 rounded-full border border-emerald-400/30 absolute -inset-2 animate-ping" />
            </div>

            <div>
              <h4 className="text-sm font-bold text-white">
                Fixi Vision AI analizando falla...
              </h4>
              <p className="text-xs text-emerald-300 font-mono mt-1">
                Segmentando imagen • Identificando componentes • Calculando costos
              </p>
            </div>
          </div>
        </div>
      ) : currentDiagnosis ? (
        /* Diagnosis Result Card */
        <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-md space-y-3.5">
          {/* Header of Diagnosis */}
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold bg-slate-900 text-white px-2 py-0.5 rounded-full uppercase">
                  Diagnóstico IA
                </span>
                <ConfidenceBadge
                  score={currentDiagnosis.confidenceScore}
                  type={currentDiagnosis.pricingType}
                />
              </div>
              <h3 className="text-sm font-extrabold text-slate-900">
                {currentDiagnosis.title}
              </h3>
            </div>

            <button
              onClick={() => runAiDiagnosis()}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
              title="Volver a escanear"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Root cause and suggested fix */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/70 space-y-2 text-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Causa Raíz Detectada:
              </span>
              <p className="text-slate-800 font-medium leading-relaxed mt-0.5">
                {currentDiagnosis.rootCause}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-200/60">
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
                Solución Técnica Recomendada:
              </span>
              <p className="text-slate-800 font-medium leading-relaxed mt-0.5">
                {currentDiagnosis.suggestedFix}
              </p>
            </div>
          </div>

          {/* Materials & Labor Specs */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/70">
              <div className="flex items-center gap-1 text-slate-500 font-bold text-[10px] uppercase mb-1">
                <Wrench className="w-3 h-3 text-slate-600" />
                <span>Refacciones Probables</span>
              </div>
              <ul className="text-[11px] text-slate-700 space-y-0.5 list-disc list-inside">
                {currentDiagnosis.requiredMaterials.map((mat, i) => (
                  <li key={i} className="truncate">{mat}</li>
                ))}
              </ul>
            </div>

            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/70">
              <div className="flex items-center gap-1 text-slate-500 font-bold text-[10px] uppercase mb-1">
                <Clock className="w-3 h-3 text-slate-600" />
                <span>Tiempo Estimado</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                ~{currentDiagnosis.estimatedHours} horas
              </p>
              <p className="text-[10px] text-emerald-600 font-medium mt-0.5">
                Incluye pruebas de calidad
              </p>
            </div>
          </div>

          {/* Price Callout Banner */}
          <div className="p-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-2xl flex items-center justify-between shadow-md">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200 block">
                {currentDiagnosis.pricingType === "guaranteed_fixed"
                  ? "Estimado de Mano de Obra (Precio Fijo)"
                  : "Rango Estimado (+ Inspección)"}
              </span>
              <p className="text-lg font-black tracking-tight text-white">
                {currentDiagnosis.pricingType === "guaranteed_fixed"
                  ? `$${currentDiagnosis.priceFixed?.toFixed(2)} USD`
                  : `$${currentDiagnosis.priceRangeMin?.toFixed(2)} - $${currentDiagnosis.priceRangeMax?.toFixed(2)} USD`}
              </p>
            </div>

            <div className="text-right">
              <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">
                {currentDiagnosis.pricingType === "guaranteed_fixed" ? "Sin sorpresas" : "Sujeto a sitio"}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 1 CTA */}
      <div className="pt-2">
        <Button
          variant="primary"
          size="lg"
          className="w-full flex items-center justify-center gap-2"
          disabled={isAiAnalyzing}
          onClick={handleContinue}
        >
          <span>Paso 2: Agendar & Domicilio</span>
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
