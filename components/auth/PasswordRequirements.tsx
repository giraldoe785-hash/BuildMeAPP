"use client";

import React from "react";
import { CheckCircle2 } from "lucide-react";
import { PasswordValidationResult } from "@/store/useAuthStore";

interface PasswordRequirementsProps {
  validation: PasswordValidationResult;
}

export const PasswordRequirements: React.FC<PasswordRequirementsProps> = ({ validation }) => {
  return (
    <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1 mt-1.5">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        Requisitos de contraseña:
      </p>
      <div className="space-y-1">
        <div
          className={`flex items-center gap-1.5 text-[11px] transition-colors ${
            validation.hasMinLength ? "text-emerald-700 font-semibold" : "text-slate-500"
          }`}
        >
          <CheckCircle2
            className={`w-3.5 h-3.5 shrink-0 transition-colors ${
              validation.hasMinLength ? "text-emerald-600" : "text-slate-300"
            }`}
          />
          <span>Mínimo 7 caracteres</span>
        </div>
        <div
          className={`flex items-center gap-1.5 text-[11px] transition-colors ${
            validation.hasMinTwoNumbers ? "text-emerald-700 font-semibold" : "text-slate-500"
          }`}
        >
          <CheckCircle2
            className={`w-3.5 h-3.5 shrink-0 transition-colors ${
              validation.hasMinTwoNumbers ? "text-emerald-600" : "text-slate-300"
            }`}
          />
          <span>Al menos 2 números (0-9)</span>
        </div>
      </div>
    </div>
  );
};
