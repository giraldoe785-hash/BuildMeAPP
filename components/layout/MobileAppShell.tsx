import React from "react";

export interface MobileAppShellProps {
  children: React.ReactNode;
}

/**
 * MobileAppShell
 *
 * Contenedor estructural mobile-first para las experiencias de cliente y reparador.
 * - Móvil (< md): Ocupa el 100 % del viewport (w-full min-h-dvh) con fondo nativo bg-slate-50,
 *   sin marcos, sin márgenes, sin sombras ni fondo exterior oscuro.
 * - Escritorio (>= md): Presentación centrada con fondo exterior (md:bg-slate-900),
 *   columna de ancho ergonómico (md:max-w-[448px] md:mx-auto md:shadow-2xl).
 * - Preserva el scroll normal del documento y el posicionamiento de elementos fixed (BottomNav, modales)
 *   sin aplicar transform, filter, perspective, contain, will-change ni overflow-hidden.
 */
export const MobileAppShell: React.FC<MobileAppShellProps> = ({ children }) => {
  return (
    <div className="w-full min-h-dvh bg-slate-50 md:bg-slate-900 flex justify-center">
      <div className="w-full min-h-dvh bg-slate-50 flex flex-col flex-1 md:max-w-[448px] md:mx-auto md:shadow-2xl">
        {children}
      </div>
    </div>
  );
};
