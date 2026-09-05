"use client";

import React, { useState } from "react";
import { useAuthStore, validateRegistrationPassword, PASSWORD_VALIDATION_ERROR_MESSAGE } from "@/store/useAuthStore";
import { SERVICE_CATEGORIES } from "@/data/services";
import { ServiceCategoryId } from "@/types";
import { User, Lock, CreditCard, Wrench, Upload, FileText, AlertCircle, Clock, CheckCircle2, UserPlus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PasswordRequirements } from "./PasswordRequirements";

interface RegisterRepairerFormProps {
  onSwitchToLogin: () => void;
}

export const RegisterRepairerForm: React.FC<RegisterRepairerFormProps> = ({
  onSwitchToLogin,
}) => {
  const { registerRepairer } = useAuthStore();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [cedula, setCedula] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [specialty, setSpecialty] = useState<ServiceCategoryId>("electricidad");
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    type: string;
    size: string;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const passwordValidation = validateRegistrationPassword(password);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validación de extensiones permitidas
    const validExtensions = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    const fileExt = file.name.split(".").pop()?.toLowerCase();

    if (!validExtensions.includes(file.type) && !["pdf", "jpg", "jpeg", "png"].includes(fileExt || "")) {
      setErrorMessage("Formato no válido. Solo se admiten archivos PDF, JPG o PNG.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("El archivo supera el límite de 10 MB.");
      return;
    }

    const sizeFormatted = (file.size / (1024 * 1024)).toFixed(1) + " MB";
    setSelectedFile({
      name: file.name,
      type: file.type || "application/pdf",
      size: sizeFormatted,
    });
    setErrorMessage(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validaciones
    if (!name.trim() || !username.trim() || !cedula.trim() || !password || !confirmPassword) {
      setErrorMessage("Todos los campos son obligatorios.");
      return;
    }

    if (cedula.trim().length < 6) {
      setErrorMessage("Por favor ingresa un número de cédula válido (mínimo 6 dígitos).");
      return;
    }

    if (!passwordValidation.isValid) {
      setErrorMessage(PASSWORD_VALIDATION_ERROR_MESSAGE);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Las contraseñas no coinciden.");
      return;
    }

    if (!selectedFile) {
      setErrorMessage("Debes adjuntar tu documento de acreditación o certificación (PDF, JPG, PNG).");
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      const res = registerRepairer({
        name: name.trim(),
        username: username.trim(),
        cedula: cedula.trim(),
        password,
        confirmPassword,
        specialty,
        documentFile: selectedFile,
      });
      setIsLoading(false);

      if (!res.success) {
        setErrorMessage(res.message || "Error al crear la cuenta de reparador.");
      }
    }, 600);
  };

  return (
    <div className="space-y-4">
      {/* Disclaimer banner: REGLA #9 */}
      <div className="p-3.5 bg-amber-50/90 border border-amber-200 rounded-2xl space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Estado inicial: 🟡 Pendiente de verificación</span>
        </div>
        <p className="text-[11px] text-amber-800 leading-relaxed">
          Tu documentación será revisada cuando BuildMeAPP incorpore el sistema administrativo de validación en backend.
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
              placeholder="Ej. Ing. Carlos Mendoza"
              className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>
        </div>

        {/* Username & Cédula */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Nombre de usuario
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="carlos_tech"
              className="w-full text-xs px-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Cédula / DNI
            </label>
            <input
              type="text"
              required
              value={cedula}
              onChange={(e) => {
                setCedula(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="0928374615"
              className="w-full text-xs px-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900 font-mono"
            />
          </div>
        </div>

        {/* Specialty (usando categorías existentes) */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Especialidad profesional
          </label>
          <div className="relative">
            <Wrench className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value as ServiceCategoryId)}
              className="w-full text-xs pl-9 pr-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            >
              {SERVICE_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} — {cat.shortDesc.split(",")[0]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Documento de acreditación */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Documento de acreditación / certificación
          </label>

          <div className="relative border-2 border-dashed border-slate-200 hover:border-emerald-400 bg-slate-50 rounded-2xl p-3.5 text-center transition-colors">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
            />
            {selectedFile ? (
              <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-emerald-300">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="text-left min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {selectedFile.size} • Listo para adjuntar
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full shrink-0">
                  Cargado
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center py-1">
                <Upload className="w-5 h-5 text-slate-400 mb-1" />
                <p className="text-xs font-bold text-slate-800">
                  Seleccionar archivo (Título o Certificado)
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Formatos admitidos: PDF, JPG, PNG (Máx 10 MB)
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Password & Confirm */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Contraseña
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="••••••••"
              className="w-full text-xs px-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Confirmar
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="••••••••"
              className="w-full text-xs px-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
            />
          </div>
        </div>

        {/* Indicador de requisitos en tiempo real */}
        <PasswordRequirements validation={passwordValidation} />

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
          variant="emergency"
          size="lg"
          className="w-full flex items-center justify-center gap-2 shadow-md shadow-orange-500/25"
          isLoading={isLoading}
          disabled={!passwordValidation.isValid}
        >
          <UserPlus className="w-4 h-4" />
          <span>Crear Cuenta de Reparador</span>
        </Button>
      </form>

      {/* Switch to Login */}
      <div className="text-center pt-2">
        <p className="text-xs text-slate-500">
          ¿Ya estás registrado?{" "}
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
