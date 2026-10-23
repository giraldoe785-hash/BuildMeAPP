"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { DeviceFrame } from "@/components/layout/DeviceFrame";
import { Button } from "@/components/ui/Button";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";
import {
  validateRegistrationPassword,
  PASSWORD_VALIDATION_ERROR_MESSAGE,
} from "@/store/useAuthStore";
import {
  Lock,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Loader2,
} from "lucide-react";

type TokenValidationState =
  | { status: "checking" }
  | { status: "valid" }
  | { status: "invalid"; message: string };

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [token, setToken] = useState<string>("");
  const [tokenState, setTokenState] = useState<TokenValidationState>({
    status: "checking",
  });

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passwordValidation = validateRegistrationPassword(password);

  useEffect(() => {
    const rawToken = searchParams.get("token")?.trim() ?? "";

    if (!rawToken) {
      setTokenState({
        status: "invalid",
        message:
          "El enlace de recuperación no contiene un token válido. Solicita un nuevo enlace desde la pantalla de inicio de sesión.",
      });
      return;
    }

    setToken(rawToken);

    let cancelled = false;
    async function verifyToken() {
      try {
        const res = await fetch("/api/auth/password/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: rawToken }),
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });

        const data = await res.json().catch(() => null);
        if (cancelled) return;

        if (res.ok && data?.valid) {
          setTokenState({ status: "valid" });
        } else {
          setTokenState({
            status: "invalid",
            message:
              data?.message ||
              "El enlace de recuperación es inválido, ha caducado o ya fue utilizado.",
          });
        }
      } catch {
        if (!cancelled) {
          setTokenState({
            status: "invalid",
            message:
              "Error de conexión al verificar el enlace. Verifica tu conexión a internet e intenta de nuevo.",
          });
        }
      }
    }

    void verifyToken();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!password || !confirmPassword) {
      setErrorMessage("Por favor completa y confirma tu nueva contraseña.");
      return;
    }

    if (!passwordValidation.isValid) {
      setErrorMessage(PASSWORD_VALIDATION_ERROR_MESSAGE);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("La confirmación no coincide con la nueva contraseña.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          confirmPassword,
        }),
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });

      const data = await res.json().catch(() => null);
      setIsSubmitting(false);

      if (!res.ok || !data?.success) {
        if (
          data?.reason === "invalid" ||
          data?.reason === "expired" ||
          data?.reason === "consumed"
        ) {
          setTokenState({
            status: "invalid",
            message:
              data?.message ||
              "Este enlace de recuperación ya no es válido. Solicita uno nuevo.",
          });
          return;
        }
        setErrorMessage(
          data?.message || "No fue posible actualizar la contraseña."
        );
        return;
      }

      setSuccessMessage(
        data.message ||
          "Tu contraseña ha sido actualizada correctamente. Ahora puedes iniciar sesión con tu nueva contraseña."
      );
    } catch {
      setIsSubmitting(false);
      setErrorMessage(
        "Error de conexión. Verifica tu conexión a internet e intenta de nuevo."
      );
    }
  };

  return (
    <DeviceFrame>
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center p-4 sm:p-6">
        <div className="w-full max-w-md mx-auto space-y-4">
          {/* Brand Header */}
          <div className="text-center space-y-2">
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 mx-auto rounded-3xl overflow-hidden shadow-xl shadow-emerald-950/40 border border-slate-700/60 bg-white p-1.5">
              <img
                src="/buildme-logo.png"
                alt="Logotipo oficial de BuildMe"
                className="w-full h-full object-contain"
              />
            </div>

            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                BuildMeAPP{" "}
                <span className="text-emerald-400 font-mono text-sm sm:text-base font-normal">
                  | Fixi
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Restablecimiento seguro de contraseña
              </p>
            </div>
          </div>

          {/* Card */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
              <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  Establecer nueva contraseña
                </h2>
                <p className="text-[11px] text-slate-500">
                  Crea una contraseña segura para tu cuenta
                </p>
              </div>
            </div>

            {tokenState.status === "checking" && (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                <p className="text-xs font-semibold">
                  Verificando validez del enlace...
                </p>
              </div>
            )}

            {tokenState.status === "invalid" && (
              <div className="space-y-4">
                <div
                  role="alert"
                  className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 font-medium flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{tokenState.message}</span>
                </div>

                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="w-full flex items-center justify-center gap-2"
                  onClick={() => router.push("/")}
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Regresar al inicio de sesión</span>
                </Button>
              </div>
            )}

            {tokenState.status === "valid" && successMessage && (
              <div className="space-y-4">
                <div
                  role="status"
                  className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-medium flex items-start gap-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <span>{successMessage}</span>
                </div>

                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="w-full flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25"
                  onClick={() => router.push("/")}
                >
                  <span>Iniciar sesión con nueva contraseña</span>
                </Button>
              </div>
            )}

            {tokenState.status === "valid" && !successMessage && (
              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div>
                  <label
                    htmlFor="new-password-input"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Nueva contraseña
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
                    <input
                      id="new-password-input"
                      type="password"
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setErrorMessage(null);
                      }}
                      placeholder="••••••••"
                      className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
                    />
                  </div>
                  <PasswordRequirements validation={passwordValidation} />
                </div>

                <div>
                  <label
                    htmlFor="confirm-new-password-input"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Confirmar nueva contraseña
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
                    <input
                      id="confirm-new-password-input"
                      type="password"
                      required
                      autoComplete="new-password"
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

                {errorMessage && (
                  <div
                    role="alert"
                    className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25"
                  isLoading={isSubmitting}
                  disabled={!passwordValidation.isValid}
                >
                  <KeyRound className="w-4 h-4" />
                  <span>Cambiar contraseña</span>
                </Button>

                <div className="text-center pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Regresar al inicio de sesión</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="text-center space-y-1 text-slate-400 text-[11px] pt-1">
            <p className="flex items-center justify-center gap-1.5">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>Enlace de un solo uso validado en el servidor</span>
            </p>
          </div>
        </div>
      </div>
    </DeviceFrame>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
