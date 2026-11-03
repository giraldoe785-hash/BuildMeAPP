"use client";

import React from "react";
import { useFixiStore } from "@/store/useFixiStore";

interface DeviceFrameProps {
  children: React.ReactNode;
}

export const DeviceFrame: React.FC<DeviceFrameProps> = ({ children }) => {
  const { isDeviceFrameActive } = useFixiStore();

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-start sm:p-4 md:p-6 transition-colors duration-300">
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
