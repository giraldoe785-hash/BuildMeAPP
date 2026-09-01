"use client";

import React from "react";
import { SERVICE_CATEGORIES } from "@/data/services";
import { useFixiStore } from "@/store/useFixiStore";
import { Zap, Droplets, Hammer, ShieldAlert, Paintbrush, KeyRound, ChevronRight } from "lucide-react";
import { ServiceCategoryId } from "@/types";

const ICON_MAP: Record<string, React.ElementType> = {
  Zap,
  Droplets,
  Hammer,
  ShieldAlert,
  Paintbrush,
  KeyRound,
};

export const CategoryGrid: React.FC = () => {
  const { selectedCategory, setSelectedCategory, startWizard } = useFixiStore();

  const handleCategoryClick = (catId: ServiceCategoryId) => {
    startWizard(catId);
  };

  return (
    <section className="px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">
            Categorías de Servicio
          </h3>
          <p className="text-[11px] text-slate-500">
            Especialistas calificados con garantía FixiCare
          </p>
        </div>
        <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
          6 Especialidades
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {SERVICE_CATEGORIES.map((cat) => {
          const IconComponent = ICON_MAP[cat.iconName] || Zap;
          const isSelected = selectedCategory === cat.id;

          return (
            <button
              key={cat.id}
              onClick={() => handleCategoryClick(cat.id)}
              className="group relative flex flex-col items-center justify-between p-3 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:shadow-md hover:border-emerald-400 active:scale-95 transition-all text-center"
            >
              {/* Popular badge */}
              {cat.isPopular && (
                <span className="absolute -top-1.5 -right-1 bg-amber-500 text-white text-[9px] font-extrabold px-1.5 py-0.2 rounded-full uppercase tracking-tighter shadow-xs">
                  Top
                </span>
              )}

              {/* Icon Container */}
              <div
                className={`w-11 h-11 rounded-2xl ${cat.bgLight} ${cat.color} flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-xs`}
              >
                <IconComponent className="w-5 h-5" />
              </div>

              {/* Name & Starting Price */}
              <span className="text-xs font-bold text-slate-900 line-clamp-1">
                {cat.name}
              </span>

              <span className="text-[10px] text-slate-400 mt-0.5">
                Desde <strong className="text-slate-700 font-semibold">${cat.startingPrice}</strong>
              </span>

              <span className="text-[9px] text-emerald-600 font-medium mt-1 flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                {cat.availableTechsCount} activos
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
