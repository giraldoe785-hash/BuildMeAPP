"use client";

import React from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { AiScannerHero } from "./AiScannerHero";
import { CategoryGrid } from "./CategoryGrid";
import { VerifiedTechList } from "./VerifiedTechList";
import { FixiCareBanner } from "./FixiCareBanner";
import { LocationModal } from "./LocationModal";
import { EmergencyModal } from "./EmergencyModal";
import { useFixiStore } from "@/store/useFixiStore";
import { Sparkles, ArrowRight, ShieldCheck } from "lucide-react";

export const HomeView: React.FC = () => {
  const { activeOrder, setActiveTab } = useFixiStore();

  const isOrderActive =
    activeOrder &&
    activeOrder.status !== "completed" &&
    activeOrder.status !== "cancelled";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-24">
      {/* App Header */}
      <AppHeader />

      {/* Floating Alert if an Order is in Progress */}
      {isOrderActive && (
        <div className="mx-4 mt-3 p-3 bg-gradient-to-r from-emerald-700 to-teal-800 text-white rounded-2xl shadow-md flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-ping shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">
                Servicio #{activeOrder.id} en curso
              </p>
              <p className="text-[10px] text-emerald-200 truncate">
                Técnico {activeOrder.technician.name.split(" ")[0]} ({activeOrder.status})
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab("tracking")}
            className="text-[11px] bg-white text-slate-900 font-bold px-2.5 py-1.5 rounded-xl shrink-0 flex items-center gap-1 shadow-xs hover:bg-slate-100"
          >
            <span>Ver mapa</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* AI Scanner Hero */}
      <AiScannerHero />

      {/* Categories */}
      <CategoryGrid />

      {/* Verified Technicians */}
      <VerifiedTechList />

      {/* FixiCare Warranty Guarantee */}
      <FixiCareBanner />

      {/* Global Modals */}
      <LocationModal />
      <EmergencyModal />
    </div>
  );
};
