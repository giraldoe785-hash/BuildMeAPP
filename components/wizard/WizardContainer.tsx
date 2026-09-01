"use client";

import React from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { motion, AnimatePresence } from "framer-motion";
import { StepAiScan } from "./StepAiScan";
import { StepScheduleLocation } from "./StepScheduleLocation";
import { StepPaymentHold } from "./StepPaymentHold";
import { ArrowLeft, Sparkles, Calendar, CreditCard, X } from "lucide-react";
import { SERVICE_CATEGORIES } from "@/data/services";

export const WizardContainer: React.FC = () => {
  const {
    wizardStep,
    setWizardStep,
    setActiveTab,
    selectedCategoryForWizard,
  } = useFixiStore();

  const categoryMeta = SERVICE_CATEGORIES.find((c) => c.id === selectedCategoryForWizard);

  const stepsMeta = [
    { num: 1, title: "Diagnóstico IA", icon: Sparkles },
    { num: 2, title: "Agenda & Mapa", icon: Calendar },
    { num: 3, title: "Tarifa & Hold", icon: CreditCard },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Wizard Navigation Bar */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (wizardStep > 1) {
                  setWizardStep((wizardStep - 1) as 1 | 2);
                } else {
                  setActiveTab("home");
                }
              }}
              className="p-1.5 -ml-1 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-xs font-extrabold text-slate-900 leading-tight">
                Cotización & Diagnóstico IA
              </h2>
              <span className="text-[10px] text-emerald-700 font-bold uppercase">
                {categoryMeta ? categoryMeta.name : "Servicio General"}
              </span>
            </div>
          </div>

          <button
            onClick={() => setActiveTab("home")}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors"
            title="Cancelar y volver"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3-Step Progress Bar */}
        <div className="grid grid-cols-3 gap-2">
          {stepsMeta.map((s) => {
            const isCompleted = wizardStep > s.num;
            const isCurrent = wizardStep === s.num;
            const Icon = s.icon;

            return (
              <div key={s.num} className="space-y-1">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isCompleted
                      ? "bg-emerald-600"
                      : isCurrent
                      ? "bg-emerald-500 ring-2 ring-emerald-500/30"
                      : "bg-slate-200"
                  }`}
                />
                <div className="flex items-center justify-center gap-1 text-[10px]">
                  <Icon
                    className={`w-3 h-3 ${
                      isCurrent || isCompleted ? "text-emerald-600" : "text-slate-400"
                    }`}
                  />
                  <span
                    className={`font-semibold truncate ${
                      isCurrent
                        ? "text-slate-900 font-bold"
                        : isCompleted
                        ? "text-emerald-700"
                        : "text-slate-400"
                    }`}
                  >
                    {s.title}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </header>

      {/* Step Body with Framer Motion transitions */}
      <div className="flex-1 p-4 pb-24">
        <AnimatePresence mode="wait">
          {wizardStep === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
            >
              <StepAiScan />
            </motion.div>
          )}

          {wizardStep === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
            >
              <StepScheduleLocation />
            </motion.div>
          )}

          {wizardStep === 3 && (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
            >
              <StepPaymentHold />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
