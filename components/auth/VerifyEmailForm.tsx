"use client";

import React, { useEffect, useState } from "react";
import { useAuthStore, type VerificationCodeStatus } from "@/store/useAuthStore";
import {
  ShieldCheck,
  Mail,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface VerifyEmailFormProps {
  email?: string;
  username?: string;
  /** "sent": se acaba de enviar un código. "existing": ya había uno vigente. */
  codeStatus: VerificationCodeStatus;
  /** Segundos de espera restantes según el servidor (0 = se puede reenviar ya). */
  initialCooldownSeconds: number;
  /** Segundos de vigencia restantes del código, si el servidor los informó. */
  expiresInSeconds?: number;
  /** Mensaje informativo del servidor (se muestra en verde solo si no hay error). */
  notice?: string | null;
  onBack: () => void;
  onSwitchToLogin: () => void;
}

const DEFAULT_EXPIRY_MINUTES = 10;

function minutesFromSeconds(seconds?: number): number {
  if (!seconds || seconds <= 0) return DEFAULT_EXPIRY_MINUTES;
  return Math.max(1, Math.ceil(seconds / 60));
}

export const VerifyEmailForm: React.FC<VerifyEmailFormProps> = ({
  email,
  username,
  codeStatus: initialCodeStatus,
  initialCooldownSeconds,
  expiresInSeconds: initialExpiresInSeconds,
  notice,
  onBack,
  onSwitchToLogin,
}) => {
  const { verifyEmailCode, resendVerificationCode } = useAuthStore();

  const [code, setCode] = useState("");
  const [codeStatus, setCodeStatus] =
    useState<VerificationCodeStatus>(initialCodeStatus);
  const [expiresInSeconds, setExpiresInSeconds] = useState<number | undefined>(
    initialExpiresInSeconds
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(notice ?? null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  // La espera inicial la calcula el servidor: si no se envió nada ahora (código
  // vigente de hace rato), puede ser 0 y el botón de reenvío queda disponible.
  const [cooldown, setCooldown] = useState(Math.max(0, initialCooldownSeconds));
  const [verifiedNeedManualLogin, setVerifiedNeedManualLogin] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setErrorMessage("Ingresa el código numérico de 6 dígitos.");
      return;
    }

    setIsVerifying(true);
    const res = await verifyEmailCode({
      username,
      email,
      code: trimmedCode,
    });
    setIsVerifying(false);

    if (!res.success) {
      setInfoMessage(null);
      setErrorMessage(res.message || "Código inválido o expirado.");
      return;
    }

    if (!res.user) {
      setVerifiedNeedManualLogin(true);
      setInfoMessage(
        res.message ||
          "Correo verificado correctamente. Ahora puedes iniciar sesión."
      );
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setErrorMessage(null);
    setInfoMessage(null);
    setIsResending(true);

    const res = await resendVerificationCode({ username, email });
    setIsResending(false);

    if (!res.success) {
      setErrorMessage(res.message);
      // Si el servidor dice cuánto falta (429), la cuenta regresiva refleja ese valor.
      if (typeof res.retryAfterSeconds === "number" && res.retryAfterSeconds > 0) {
        setCooldown(res.retryAfterSeconds);
      }
      return;
    }

    setCode("");
    setCodeStatus("sent");
    setExpiresInSeconds(res.expiresInSeconds);
    setInfoMessage(res.message);
    setCooldown(res.cooldownSeconds ?? 60);
  };

  const expiryMinutes = minutesFromSeconds(expiresInSeconds);
  const destination = email || username || "tu correo";

  return (
    <div className="space-y-4">
      <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-2xl space-y-1">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
          <Mail className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Verifica tu correo electrónico</span>
        </div>
        <p className="text-[11px] text-emerald-800 leading-relaxed">
          {codeStatus === "sent" ? (
            <>
              Enviamos un código de 6 dígitos a{" "}
              <span className="font-bold font-mono break-all">{destination}</span>. El
              código caduca en {expiryMinutes} {expiryMinutes === 1 ? "minuto" : "minutos"}.
            </>
          ) : (
            <>
              Ya hay un código vigente enviado a{" "}
              <span className="font-bold font-mono break-all">{destination}</span> (caduca en
              unos {expiryMinutes} {expiryMinutes === 1 ? "minuto" : "minutos"}). Ingrésalo;
              si no lo encuentras, podrás pedir otro cuando termine la espera.
            </>
          )}
        </p>
      </div>

      {infoMessage && !errorMessage && (
        <div
          role="status"
          className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-start gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <span>{infoMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {verifiedNeedManualLogin ? (
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="w-full"
          onClick={onSwitchToLogin}
        >
          Ir a Iniciar Sesión
        </Button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label
              htmlFor="verification-code-input"
              className="block text-xs font-bold text-slate-700 mb-1"
            >
              Código de verificación (6 dígitos)
            </label>
            <input
              id="verification-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => {
                const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(digitsOnly);
                setErrorMessage(null);
              }}
              placeholder="000000"
              className="w-full text-center text-lg tracking-[0.45em] font-mono font-extrabold px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25"
            isLoading={isVerifying}
            disabled={code.length !== 6}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Verificar código y continuar</span>
          </Button>
        </form>
      )}

      <div className="pt-2 border-t border-slate-100 flex flex-col gap-2 text-center">
        {!verifiedNeedManualLogin && (
          <button
            type="button"
            disabled={cooldown > 0 || isResending}
            onClick={handleResend}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 disabled:text-slate-400 disabled:cursor-not-allowed py-1"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isResending ? "animate-spin" : ""}`}
            />
            <span>
              {isResending
                ? "Enviando nuevo código..."
                : cooldown > 0
                  ? `Reenviar código en ${cooldown}s`
                  : "Reenviar código de verificación"}
            </span>
          </button>
        )}

        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Volver</span>
          </button>

          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-emerald-600 font-bold hover:underline"
          >
            Ir a Iniciar sesión
          </button>
        </div>
      </div>
    </div>
  );
};
