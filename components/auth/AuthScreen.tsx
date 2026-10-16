"use client";

import React, { useEffect, useState } from "react";
import { LoginForm } from "./LoginForm";
import { RegisterClientForm } from "./RegisterClientForm";
import { RegisterRepairerForm } from "./RegisterRepairerForm";
import { iniciarOAuth } from "@/app/actions/oauth";
import { Wrench, UserCheck, Lock, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type AuthViewMode = "login" | "register_select" | "register_client" | "register_repairer";
type OAuthProviderButtonId = "google";

function getOAuthErrorMessage(code: string | null): string | null {
  if (!code) return null;

  switch (code) {
    case "AccessDenied":
      return "Inicio de sesión cancelado o acceso denegado por Google.";
    case "OAuthAccountNotLinked":
      return "Ya existe una cuenta registrada con ese correo electrónico. Inicia sesión con tu método original para conservar tu cuenta.";
    case "Configuration":
      return "El inicio de sesión con Google aún no está completamente configurado en el servidor (verifica AUTH_SECRET, AUTH_GOOGLE_ID y AUTH_GOOGLE_SECRET).";
    case "InvalidProvider":
      return "Actualmente solo está habilitado el inicio de sesión con Google.";
    case "EmailNotVerified":
      return "El correo electrónico de tu cuenta de Google no está verificado.";
    case "EmailMissing":
      return "Google no proporcionó un correo electrónico válido para tu cuenta.";
    case "AccountSuspended":
      return "Tu cuenta está suspendida. Contacta a soporte.";
    case "AccountLocked":
      return "Demasiados intentos fallidos. Intenta de nuevo en unos minutos.";
    case "AdminNotAllowed":
      return "Esta cuenta no tiene acceso a la aplicación.";
    case "RepairerRegistrationUnavailable":
      return "El registro de nuevos reparadores aún no está disponible porque requiere documentos de acreditación. Por ahora puedes crear una cuenta de cliente.";
    case "InvalidRole":
      return "El rol de usuario seleccionado no es válido.";
    default:
      return "No fue posible completar el inicio de sesión con Google. Intenta de nuevo.";
  }
}

const GoogleIcon: React.FC = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z"
    />
  </svg>
);

export const AuthScreen: React.FC = () => {
  const [viewMode, setViewMode] = useState<AuthViewMode>("login");
  const [oauthLoading, setOauthLoading] = useState<OAuthProviderButtonId | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error");
    if (errorCode) {
      setOauthError(getOAuthErrorMessage(errorCode));
      params.delete("error");
      params.delete("code");
      const cleanQuery = params.toString();
      const cleanUrl =
        window.location.pathname + (cleanQuery ? `?${cleanQuery}` : "");
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  const handleOAuthLogin = async (provider: OAuthProviderButtonId) => {
    setOauthError(null);
    setOauthLoading(provider);

    const selectedRole =
      viewMode === "register_repairer" ? "REPARADOR" : "CLIENTE";

    const result = await iniciarOAuth(provider, selectedRole);

    if (!result.success) {
      setOauthLoading(null);
      setOauthError(result.message);
      return;
    }

    window.location.assign(result.url);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center p-4 sm:p-6">
      <div className="w-full max-w-md mx-auto space-y-4">
        {/* Brand Header con Imagen de Identidad Oficial */}
        <div className="text-center space-y-2">
          {/* Logotipo Oficial de BuildMe */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 mx-auto rounded-3xl overflow-hidden shadow-xl shadow-emerald-950/40 border border-slate-700/60 bg-white p-1.5 transition-transform hover:scale-105 duration-200">
            <img
              src="/buildme-logo.png"
              alt="Logotipo oficial de BuildMe - Desde 2026"
              className="w-full h-full object-contain"
              loading="eager"
            />
          </div>

          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              BuildMeAPP <span className="text-emerald-400 font-mono text-sm sm:text-base font-normal">| Fixi</span>
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
              onClick={() => {
                setViewMode("login");
                setOauthError(null);
              }}
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
              onClick={() => {
                setViewMode("register_select");
                setOauthError(null);
              }}
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
                onClick={() => {
                  setViewMode("register_client");
                  setOauthError(null);
                }}
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
                onClick={() => {
                  setViewMode("register_repairer");
                  setOauthError(null);
                }}
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

          {/* OAuth Social Login Section (Google activo; Microsoft reservado para fase posterior) */}
          <div className="space-y-2.5">
            {oauthError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{oauthError}</span>
              </div>
            )}

            <div>
              <button
                type="button"
                disabled={oauthLoading !== null}
                onClick={() => handleOAuthLogin("google")}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 text-xs font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-2xs"
              >
                {oauthLoading === "google" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500 shrink-0" />
                ) : (
                  <GoogleIcon />
                )}
                <span>Continuar con Google</span>
              </button>
            </div>

            {/* Separador visual */}
            <div className="relative flex items-center py-1">
              <div className="grow border-t border-slate-200" />
              <span className="shrink-0 mx-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                o con usuario y contraseña
              </span>
              <div className="grow border-t border-slate-200" />
            </div>
          </div>

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
            <span>Acceso seguro con sesión protegida</span>
          </p>
          <p className="text-[10px] text-slate-400">
           Tus datos de acceso se validan en el servidor
          </p>
        </div>
      </div>
    </div>
  );
};
