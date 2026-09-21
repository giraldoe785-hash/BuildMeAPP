"use client";

import React, { useState, useRef, useCallback } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { AI_DIAGNOSIS_PRESETS } from "@/data/aiPresets";
import {
  Sparkles,
  Camera,
  Upload,
  CheckCircle2,
  AlertCircle,
  Wrench,
  Clock,
  ArrowRight,
  RefreshCw,
  X,
  ImageIcon,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import type { AiDiagnosisResult } from "@/types";

const ALLOWED_MIMES = ["image/jpeg", "image/png", "video/mp4"];
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const MAX_VIDEO_DURATION = 15; // seconds

/**
 * Validates video duration using HTMLVideoElement.
 * Returns a promise that resolves to true if valid, or rejects with an error message.
 */
function validateVideoDuration(file: File): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (video.duration > MAX_VIDEO_DURATION) {
        reject(
          `El video dura ${Math.ceil(video.duration)}s. El máximo permitido es ${MAX_VIDEO_DURATION}s.`
        );
      } else {
        resolve(true);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject("No se pudo leer la duración del video.");
    };
  });
}

/**
 * Optimizes image client-side only if dimensions or size are excessive.
 * Preserves already optimized images. Does not convert video.
 * - Max dimension: 1280px maintaining aspect ratio
 * - Quality: 0.80 JPEG
 */
function optimizeImageIfNeeded(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;

    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_SIDE = 1280;
      const { width, height } = img;

      // If dimensions are within 1280px and size is reasonable, preserve original
      if (width <= MAX_SIDE && height <= MAX_SIDE && file.size <= 800 * 1024) {
        resolve(file);
        return;
      }

      let targetWidth = width;
      let targetHeight = height;

      if (width > MAX_SIDE || height > MAX_SIDE) {
        if (width > height) {
          targetWidth = MAX_SIDE;
          targetHeight = Math.round((height * MAX_SIDE) / width);
        } else {
          targetHeight = MAX_SIDE;
          targetWidth = Math.round((width * MAX_SIDE) / height);
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const optimizedFile = new File(
            [blob],
            file.name.replace(/\.[^.]+$/, ".jpg"),
            {
              type: "image/jpeg",
              lastModified: Date.now(),
            }
          );
          resolve(optimizedFile);
        },
        "image/jpeg",
        0.8
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
  });
}

export const StepAiScan: React.FC = () => {
  const {
    currentDiagnosis,
    uploadedMediaUrl,
    userPromptInput,
    isAiAnalyzing,
    diagnosisStatus,
    diagnosisError,
    setUserPromptInput,
    setUploadedMediaUrl,
    selectPresetDiagnosis,
    setAiDiagnosisResult,
    setAiDiagnosisLoading,
    setAiDiagnosisError,
    resetDiagnosis,
    setWizardStep,
    selectedCategoryForWizard,
  } = useFixiStore();

  const [activeTabMedia, setActiveTabMedia] = useState<"preset" | "upload">(
    "preset"
  );
  const [tempPrompt, setTempPrompt] = useState(userPromptInput || "");
  const [clientValidationError, setClientValidationError] = useState<
    string | null
  >(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<"image" | "video" | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSelectPreset = (presetId: string) => {
    setClientValidationError(null);
    selectPresetDiagnosis(presetId);
  };

  const handleTabChange = (tab: "preset" | "upload") => {
    setActiveTabMedia(tab);
    setClientValidationError(null);
    // Reset diagnosis when switching modes
    resetDiagnosis();
    clearPreview();
  };

  const clearPreview = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setPreviewType(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [previewUrl]);

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setClientValidationError(null);

    // Client-side MIME validation
    if (!ALLOWED_MIMES.includes(file.type)) {
      setClientValidationError(
        `Formato no permitido (${file.type}). Solo se aceptan: JPG, PNG, MP4.`
      );
      return;
    }

    // Client-side size validation
    if (file.size > MAX_FILE_SIZE) {
      setClientValidationError(
        `El archivo excede 30 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`
      );
      return;
    }

    // Client-side video duration validation
    if (file.type === "video/mp4") {
      try {
        await validateVideoDuration(file);
      } catch (durationError) {
        setClientValidationError(durationError as string);
        return;
      }
    }

    // Create local preview
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setPreviewType(file.type.startsWith("video/") ? "video" : "image");
    setUploadedMediaUrl(localUrl);

    // Optimize image if dimensions or size are excessive (preserves already optimized files)
    let fileToSend = file;
    if (file.type.startsWith("image/")) {
      try {
        fileToSend = await optimizeImageIfNeeded(file);
      } catch {
        fileToSend = file;
      }
    }

    // Send to API route
    await sendToGemini(fileToSend);
  };

  const sendToGemini = async (file: File) => {
    setAiDiagnosisLoading();

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", selectedCategoryForWizard);
      if (tempPrompt.trim()) {
        formData.append("userPrompt", tempPrompt.trim());
      }

      const response = await fetch("/api/ai-diagnosis", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setAiDiagnosisError(
          data.error || "Error desconocido al analizar la evidencia."
        );
        return;
      }

      // Success — data is an AiDiagnosisResult
      setAiDiagnosisResult(data as AiDiagnosisResult);
    } catch {
      setAiDiagnosisError(
        "Error de conexión. Verifica tu conexión a internet e intenta de nuevo."
      );
    }
  };

  const handleRetry = async () => {
    if (fileInputRef.current?.files?.[0]) {
      const file = fileInputRef.current.files[0];
      let fileToSend = file;
      if (file.type.startsWith("image/")) {
        try {
          fileToSend = await optimizeImageIfNeeded(file);
        } catch {
          fileToSend = file;
        }
      }
      sendToGemini(fileToSend);
    }
  };

  const handleContinue = () => {
    setUserPromptInput(tempPrompt);
    setWizardStep(2);
  };

  const canContinue =
    diagnosisStatus === "success" && currentDiagnosis !== null;

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
              onClick={() => handleTabChange("preset")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                activeTabMedia === "preset"
                  ? "bg-white text-slate-900 shadow-xs font-bold"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Problema predefinido
            </button>
            <button
              onClick={() => handleTabChange("upload")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                activeTabMedia === "upload"
                  ? "bg-white text-slate-900 shadow-xs font-bold"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Analizar daño
            </button>
          </div>
        </div>

        {activeTabMedia === "preset" ? (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Selecciona un problema común para obtener diagnóstico y
              cotización instantáneos:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {AI_DIAGNOSIS_PRESETS.map((preset) => {
                const isSelected = currentDiagnosis?.title === preset.title &&
                  diagnosisStatus === "success" &&
                  ("id" in currentDiagnosis && currentDiagnosis.id === preset.id);
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
                        Certeza:{" "}
                        <strong className="text-slate-800">
                          {preset.confidenceScore}%
                        </strong>
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
          <div className="space-y-3">
            {/* Preview area */}
            {previewUrl && previewType ? (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100">
                {previewType === "image" ? (
                  <img
                    src={previewUrl}
                    alt="Preview de evidencia"
                    className="w-full h-40 object-cover"
                  />
                ) : (
                  <video
                    src={previewUrl}
                    controls
                    className="w-full h-40 object-cover"
                  />
                )}
                <button
                  onClick={() => {
                    clearPreview();
                    resetDiagnosis();
                  }}
                  className="absolute top-2 right-2 p-1 bg-slate-900/70 text-white rounded-full hover:bg-slate-900/90 transition-colors"
                  title="Quitar archivo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                <div className="absolute bottom-2 left-2">
                  <span className="bg-slate-900/70 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    {previewType === "image" ? (
                      <ImageIcon className="w-3 h-3" />
                    ) : (
                      <Video className="w-3 h-3" />
                    )}
                    {previewType === "image" ? "Imagen" : "Video"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="relative border-2 border-dashed border-emerald-300 bg-emerald-50/30 rounded-2xl p-6 text-center hover:bg-emerald-50/50 transition-colors">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,video/mp4"
                  capture="environment"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 shadow-xs">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-slate-800">
                    Toca para tomar foto o subir archivo
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Formatos: JPG, PNG, MP4 (Máx 30MB, video máx 15s)
                  </p>
                </div>
              </div>
            )}

            {/* Client-side validation error */}
            {clientValidationError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-red-800">
                    Archivo no válido
                  </p>
                  <p className="text-[11px] text-red-600 mt-0.5">
                    {clientValidationError}
                  </p>
                </div>
              </div>
            )}
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

      {/* AI Scanner Analysis Card — Loading State */}
      {isAiAnalyzing && (
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
                Segmentando imagen • Identificando componentes • Calculando
                costos
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {diagnosisStatus === "error" && diagnosisError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-3xl space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold text-red-800">
                Error en el diagnóstico
              </p>
              <p className="text-[11px] text-red-600 mt-1 leading-relaxed">
                {diagnosisError}
              </p>
            </div>
          </div>

          {activeTabMedia === "upload" && (
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 text-[11px] font-bold text-red-700 hover:text-red-900 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reintentar análisis
            </button>
          )}
        </div>
      )}

      {/* Diagnosis Result Card */}
      {diagnosisStatus === "success" && currentDiagnosis && (
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

            {activeTabMedia === "upload" && (
              <button
                onClick={handleRetry}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                title="Volver a escanear"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
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
                  <li key={i} className="truncate">
                    {mat}
                  </li>
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
                {currentDiagnosis.pricingType === "guaranteed_fixed"
                  ? "Sin sorpresas"
                  : "Sujeto a sitio"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Step 1 CTA */}
      <div className="pt-2">
        <Button
          variant="primary"
          size="lg"
          className="w-full flex items-center justify-center gap-2"
          disabled={!canContinue}
          onClick={handleContinue}
        >
          <span>Paso 2: Agendar & Domicilio</span>
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
