import React from "react";
import { ShieldCheck, AlertCircle } from "lucide-react";

interface ConfidenceBadgeProps {
  score: number;
  type: "guaranteed_fixed" | "estimated_range";
  showDetail?: boolean;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({
  score,
  type,
  showDetail = true,
}) => {
  const isHighConfidence = score >= 80;
  const isGuaranteedFixed = type === "guaranteed_fixed";

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs shadow-sm border ${
        isGuaranteedFixed
          ? "bg-emerald-50 border-emerald-200/80 text-emerald-800 font-semibold"
          : "bg-amber-50 border-amber-200/80 text-amber-900 font-medium"
      }`}
    >
      {isHighConfidence ? (
        <>
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        </>
      ) : (
        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
      )}
      <span>Certeza IA: {score}%</span>
      <span className={isGuaranteedFixed ? "text-slate-300" : "text-amber-300"}>|</span>
      <span
        className={`${
          isGuaranteedFixed ? "bg-emerald-600" : "bg-amber-500"
        } text-white text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md font-bold`}
      >
        {isGuaranteedFixed
          ? "PRECIO FIJO GARANTIZADO"
          : "RANGO ESTIMADO (+ INSPECCIÓN)"}
      </span>
    </div>
  );
};
