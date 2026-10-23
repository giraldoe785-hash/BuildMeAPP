"use client";

import React, { useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  Mail,
  ArrowLeft,
  Send,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({
  onBackToLogin,
}) => {
  const { requestPasswordReset } = useAuthStore();

  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalized = email.trim().toLowerCase();
    if (!normalized || !EMAIL_REGEX.test(normalized)) {
      setErrorMessage("Ingresa una dirección de correo electrónico válida.");
      return;
    }

    setIsLoading(true);
    const res = await requestPasswordReset(normalized);
    setIsLoading(false);

    if (!res.success) {
      setErrorMessage(res.message);
      return;
    }

    setSuccessMessage(
      res.message ||
        "Si existe una cuenta compatible con esa dirección, recibirás un enlace para recuperar tu contraseña."
    );
  };

  return (
    <div className="space-y-4">
      <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-1">
        <p className="text-xs font-bold text-slate-900">
          Recuperación de contraseña
        </p>
        <p className="text-[11px] text-slate-600 leading-relaxed">
          Ingresa el correo electrónico asociado a tu cuenta y te enviaremos un
          enlace seguro para establecer una contraseña nueva.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
        <div>
          <label
            htmlFor="forgot-password-email"
            className="block text-xs font-bold text-slate-700 mb-1"
          >
            Correo electrónico
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
            <input
              id="forgot-password-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="tu_correo@ejemplo.com"
              className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-start gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25"
          isLoading={isLoading}
        >
          <Send className="w-4 h-4" />
          <span>Enviar enlace de recuperación</span>
        </Button>
      </form>

      <div className="text-center pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onBackToLogin}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Volver al inicio de sesión</span>
        </button>
      </div>
    </div>
  );
};
