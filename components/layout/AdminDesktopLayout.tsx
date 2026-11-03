"use client";

import React, { useState, useEffect } from "react";
import { Shield, Headphones, FileCheck2, WalletCards } from "lucide-react";
import { FinancialOperationsView } from "@/components/admin/FinancialOperationsView";
import { TechnicalVerificationView } from "@/components/admin/TechnicalVerificationView";

export type AdminModuleId = "support" | "technical" | "financial";

export interface AdminDesktopLayoutProps {
  children: React.ReactNode;
  activeModule?: AdminModuleId;
  onSelectModule?: (moduleId: AdminModuleId) => void;
}

interface ModuleConfig {
  id: AdminModuleId;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
  isImplemented: boolean;
}

const MODULES: ModuleConfig[] = [
  {
    id: "support",
    label: "Soporte y Mediación",
    sublabel: "Tickets y disputas",
    icon: Headphones,
    isImplemented: true,
  },
  {
    id: "technical",
    label: "Verificación Técnica",
    sublabel: "Expedientes y perfiles",
    icon: FileCheck2,
    isImplemented: true,
  },
  {
    id: "financial",
    label: "Operaciones Financieras",
    sublabel: "Reembolsos y wallet",
    icon: WalletCards,
    isImplemented: true,
  },
];

/**
 * AdminDesktopLayout
 *
 * Contenedor estructural y de presentación de escritorio para administración, soporte y finanzas.
 * - Navegación lateral funcional: permite alternar entre módulos sin recargar la página.
 * - Resaltado activo claro de la sección seleccionada.
 * - Si un módulo no tiene interfaz gráfica implementada, muestra un panel informativo claro y honesto
 *   especificando el estado del backend y lo que falta, sin pantallas simuladas ni botones inactivos.
 * - Soporte responsivo: barra lateral en pantallas grandes (lg+) y selectores accesibles en pantallas pequeñas.
 */
export const AdminDesktopLayout: React.FC<AdminDesktopLayoutProps> = ({
  children,
  activeModule = "support",
  onSelectModule,
}) => {
  const [currentModule, setCurrentModule] = useState<AdminModuleId>(activeModule);

  useEffect(() => {
    if (activeModule) {
      setCurrentModule(activeModule);
    }
  }, [activeModule]);

  const handleSelect = (modId: AdminModuleId) => {
    setCurrentModule(modId);
    onSelectModule?.(modId);
  };

  return (
    <div className="w-full h-screen min-h-screen bg-slate-900 text-slate-100 flex flex-col lg:flex-row overflow-x-hidden overflow-y-hidden">
      {/* Sidebar Lateral (Resolución >= 1024px) */}
      <aside
        aria-label="Panel lateral de navegación administrativa"
        className="hidden lg:flex lg:w-64 xl:w-72 shrink-0 bg-slate-900 border-r border-slate-800 flex-col justify-between p-5 select-none"
      >
        <div className="flex flex-col gap-6">
          {/* Identidad de Marca */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 font-extrabold text-lg">
              B
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-black tracking-tight text-white leading-tight">
                BuildMeAPP
              </h1>
              <p className="text-[11px] font-mono text-emerald-400 font-medium">
                Consola Central
              </p>
            </div>
          </div>

          {/* Módulos de Navegación Lateral */}
          <nav aria-label="Módulos administrativos" className="flex flex-col gap-1.5 pt-2">
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Módulos del Sistema
            </p>

            {MODULES.map((mod) => {
              const Icon = mod.icon;
              const isActive = currentModule === mod.id;

              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => handleSelect(mod.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left transition-all duration-150 ${
                    isActive
                      ? "bg-slate-800/90 border-emerald-500/50 text-white shadow-sm"
                      : "bg-slate-800/30 border-transparent text-slate-300 hover:bg-slate-800/60 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? "text-emerald-400" : "text-slate-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-semibold leading-tight truncate ${
                          isActive ? "text-white" : "text-slate-200"
                        }`}
                      >
                        {mod.label}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {mod.sublabel}
                      </p>
                    </div>
                  </div>

                  {!mod.isImplemented && (
                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      Pendiente
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Pie de Sidebar */}
        <div className="pt-4 border-t border-slate-800 px-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-slate-400" />
            <span>Administración Interna</span>
          </div>
        </div>
      </aside>

      {/* Estructura Principal: Header + Contenido */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-slate-100 text-slate-900">
        {/* Header Superior */}
        <header
          aria-label="Encabezado del panel administrativo"
          className="shrink-0 bg-white border-b border-slate-200 px-4 md:px-8 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 z-10 shadow-xs"
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Logotipo en móviles (< lg) */}
            <div className="lg:hidden flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-extrabold text-xs">
                B
              </div>
              <span className="font-bold text-xs text-slate-900">BuildMeAPP</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800">
                Panel de Administración y Control
              </span>
              <span className="hidden sm:inline text-slate-300 font-mono">/</span>
              <span className="hidden sm:inline text-xs text-slate-500 font-medium">
                {currentModule === "support"
                  ? "Soporte y Mediación"
                  : currentModule === "technical"
                  ? "Verificación Técnica"
                  : "Operaciones Financieras"}
              </span>
            </div>
          </div>

          {/* Selector accesible en móviles/tablets (< lg) */}
          <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {MODULES.map((mod) => (
              <button
                key={mod.id}
                type="button"
                onClick={() => handleSelect(mod.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
                  currentModule === mod.id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {mod.label}
              </button>
            ))}
          </div>
        </header>

        {/* Área de Contenido Principal: Ancho Completo con Scroll Vertical */}
        <main className="flex-1 min-w-0 max-w-full overflow-y-auto overflow-x-hidden p-4 md:p-6 lg:p-8">
          {currentModule === "support" && children}
          {currentModule === "technical" && <TechnicalVerificationView />}
          {currentModule === "financial" && <FinancialOperationsView />}
        </main>
      </div>
    </div>
  );
};
