"use client";

import React, { useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { User, Lock, UserPlus, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface RegisterClientFormProps {
  onSwitchToLogin: () => void;
}

export const RegisterClientForm: React.FC<RegisterClientFormProps> = ({ onSwitchToLogin }) => {
  const { registerClient } = useAuthStore();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validaciones locales
    if (!name.trim() || !username.trim() || !password || !confirmPassword) {
      setErrorMessage("Todos los campos son obligatorios.");
      return;
    }

    if (username.trim().length < 3) {
      setErrorMessage("El nombre de usuario debe tener mínimo 3 caracteres.");
      return;
    }

    if (password.length < 4) {
      setErrorMessage("La contraseña debe contener al menos 4 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("La confirmación no coincide con la contraseña.");
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      const res = registerClient({
        name: name.trim(),
        username: username.trim(),
        password,
        confirmPassword,
      });
      setIsLoading(false);

      if (!res.success) {
        setErrorMessage(res.message || "Error al crear la cuenta.");
      }
    }, 600);
  };

  return (
    <div className="space-y-4">
      <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <p className="text-xs font-bold text-emerald-900">Registro de Cliente</p>
        </div>
        <p className="text-[11px] text-emerald-700 mt-0.5">
          Solicita reparaciones bajo demanda, cotizaciones con IA y seguimiento en tiempo real.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Nombre completo */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Nombre completo
          </label>
          <div className="relative">
            <User className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="Ej. Sofía Navarro"
              className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>
        </div>

        {/* Nombre de usuario */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Nombre de usuario
          </label>
          <div className="relative">
            <User className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
            <input
              type="text"
              required
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="Ej. sofianavarro"
              className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900 font-mono"
            />
          </div>
        </div>

        {/* Contraseña */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Contraseña
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="••••••••"
              className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>
        </div>

        {/* Confirmación */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Confirmación de contraseña
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="••••••••"
              className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>
        </div>

        {/* Error alert */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Submit */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25"
          isLoading={isLoading}
        >
          <UserPlus className="w-4 h-4" />
          <span>Crear Cuenta de Cliente</span>
        </Button>
      </form>

      {/* Switch to Login */}
      <div className="text-center pt-2">
        <p className="text-xs text-slate-500">
          ¿Ya tienes cuenta?{" "}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-emerald-600 font-bold hover:underline"
          >
            Inicia sesión
          </button>
        </p>
      </div>
    </div>
  );
};
