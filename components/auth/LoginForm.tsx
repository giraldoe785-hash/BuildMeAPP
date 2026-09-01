"use client";

import React, { useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { User, Lock, ArrowRight, AlertCircle, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface LoginFormProps {
  onSwitchToRegister: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSwitchToRegister }) => {
  const { login } = useAuthStore();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password.trim()) {
      setErrorMessage("Por favor ingresa tu usuario y contraseña.");
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      const res = login(username, password);
      setIsLoading(false);
      if (!res.success) {
        setErrorMessage(res.message || "Credenciales incorrectas.");
      }
    }, 600);
  };

  const handleQuickDemoLogin = (demoUser: string, demoPass: string) => {
    setUsername(demoUser);
    setPassword(demoPass);
    setIsLoading(true);
    setTimeout(() => {
      login(demoUser, demoPass);
      setIsLoading(false);
    }, 400);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {/* Username */}
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
              placeholder="Ej. sofia_navarro o cliente_demo"
              className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>
        </div>

        {/* Password */}
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
          <span>Iniciar Sesión</span>
          <ArrowRight className="w-4 h-4" />
        </Button>
      </form>

      {/* Quick Demo Accounts for Testing */}
      <div className="pt-3 border-t border-slate-100 space-y-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
          Acceso Rápido de Prueba (Demo)
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleQuickDemoLogin("cliente_demo", "123456")}
            className="p-2.5 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 rounded-xl text-left transition-colors"
          >
            <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-800">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              <span>Cliente Demo</span>
            </div>
            <p className="text-[10px] text-emerald-600 font-mono mt-0.5">cliente_demo</p>
          </button>

          <button
            type="button"
            onClick={() => handleQuickDemoLogin("reparador_demo", "123456")}
            className="p-2.5 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 rounded-xl text-left transition-colors"
          >
            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-900">
              <Sparkles className="w-3 h-3 text-amber-600" />
              <span>Reparador Demo</span>
            </div>
            <p className="text-[10px] text-amber-700 font-mono mt-0.5">reparador_demo</p>
          </button>
        </div>
      </div>

      {/* Switch to Register */}
      <div className="text-center pt-2">
        <p className="text-xs text-slate-500">
          ¿No tienes una cuenta aún?{" "}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="text-emerald-600 font-bold hover:underline"
          >
            Regístrate aquí
          </button>
        </p>
      </div>
    </div>
  );
};
