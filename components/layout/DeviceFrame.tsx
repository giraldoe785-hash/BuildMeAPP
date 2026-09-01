"use client";

import React from "react";
import { Smartphone, Monitor } from "lucide-react";
import { useFixiStore } from "@/store/useFixiStore";

interface DeviceFrameProps {
  children: React.ReactNode;
}

export const DeviceFrame: React.FC<DeviceFrameProps> = ({ children }) => {
  const { isDeviceFrameActive, toggleDeviceFrame } = useFixiStore();

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-start sm:p-4 md:p-6 transition-colors duration-300">
      {/* Top Floating Control Bar */}
      <header aria-label="Controles de vista" className="w-full max-w-md sm:max-w-lg md:max-w-4xl flex items-center justify-between py-2.5 px-4 mb-2 text-slate-300 text-xs font-medium">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-white font-bold tracking-tight text-sm">Fixi</span>
          <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full font-mono border border-slate-700">
            PWA Mobile-First
          </span>
        </div>

        <button
          onClick={toggleDeviceFrame}
          className="flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl border border-slate-700 transition-all text-xs"
          title="Alternar entre modo smartphone y pantalla completa"
        >
          {isDeviceFrameActive ? (
            <>
              <Monitor className="w-3.5 h-3.5 text-emerald-400" />
              <span>Modo Expandido</span>
            </>
          ) : (
            <>
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span>Marco Móvil</span>
            </>
          )}
        </button>
      </header>

      {/* Main Container: either simulated iPhone/Android phone or responsive mobile-first container */}
      <div
        className={`w-full transition-all duration-300 ${
          isDeviceFrameActive
            ? "max-w-[420px] rounded-[44px] border-[10px] border-slate-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] overflow-hidden relative min-h-[850px] bg-slate-50 ring-1 ring-slate-700"
            : "max-w-md md:max-w-lg lg:max-w-xl bg-slate-50 sm:rounded-3xl sm:shadow-2xl overflow-hidden relative min-h-[90vh] sm:border sm:border-slate-200"
        }`}
      >
        {/* Dynamic Island / Speaker cutout if in device frame */}
        {isDeviceFrameActive && (
          <div className="w-full bg-slate-50 pt-2 px-6 flex items-center justify-between z-40 relative select-none">
            <span className="text-[11px] font-semibold text-slate-800">9:41</span>
            <div className="w-24 h-4 bg-slate-900 rounded-full mx-auto flex items-center justify-end px-2 gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </div>
            <div className="flex items-center gap-1 text-slate-800 text-[10px]">
              <span>5G</span>
              <div className="w-4 h-2 border border-slate-700 rounded-sm p-0.5 flex items-center">
                <div className="w-full h-full bg-slate-800 rounded-xs" />
              </div>
            </div>
          </div>
        )}

        <div className="relative flex flex-col min-h-full pb-20">{children}</div>
      </div>
    </div>
  );
};
