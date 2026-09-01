"use client";

import React, { useEffect, useState } from "react";
import { useFixiStore } from "@/store/useFixiStore";
import { useAuthStore } from "@/store/useAuthStore";
import { DeviceFrame } from "@/components/layout/DeviceFrame";
import { BottomNav } from "@/components/layout/BottomNav";
import { HomeView } from "@/components/home/HomeView";
import { WizardContainer } from "@/components/wizard/WizardContainer";
import { LiveTrackingView } from "@/components/tracking/LiveTrackingView";
import { OrdersView } from "@/components/orders/OrdersView";
import { ProfileView } from "@/components/profile/ProfileView";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { RepairerDashboard } from "@/components/repairer/RepairerDashboard";
import { AnimatePresence, motion } from "framer-motion";

export default function App() {
  const { activeTab, activeOrder } = useFixiStore();
  const { isAuthenticated, currentUser } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-600/40 animate-pulse">
            <span className="font-extrabold text-xl text-white">F</span>
          </div>
          <span className="text-xs font-mono text-emerald-400">Cargando BuildMeAPP...</span>
        </div>
      </div>
    );
  }

  // Si el usuario no está autenticado -> Mostrar Pantalla de Acceso (Login / Registro Cliente / Registro Reparador)
  if (!isAuthenticated || !currentUser) {
    return (
      <DeviceFrame>
        <AuthScreen />
      </DeviceFrame>
    );
  }

  // Si el usuario tiene rol de REPARADOR -> Mostrar Dashboard del Reparador
  if (currentUser.role === "repairer") {
    return (
      <DeviceFrame>
        <main className="relative flex-1 flex flex-col min-h-full">
          <RepairerDashboard />
        </main>
      </DeviceFrame>
    );
  }

  // Si el usuario tiene rol de CLIENTE -> Mostrar Flujo de Cliente
  return (
    <DeviceFrame>
      <main className="relative flex-1 flex flex-col min-h-full">
        <AnimatePresence mode="wait">
          {activeTab === "home" && (
            <motion.div
              key="tab-home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1"
            >
              <HomeView />
            </motion.div>
          )}

          {activeTab === "wizard" && (
            <motion.div
              key="tab-wizard"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              transition={{ duration: 0.2 }}
              className="flex-1"
            >
              <WizardContainer />
            </motion.div>
          )}

          {activeTab === "tracking" && (
            <motion.div
              key="tab-tracking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1"
            >
              <LiveTrackingView />
            </motion.div>
          )}

          {activeTab === "orders" && (
            <motion.div
              key="tab-orders"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1"
            >
              <OrdersView />
            </motion.div>
          )}

          {activeTab === "profile" && (
            <motion.div
              key="tab-profile"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1"
            >
              <ProfileView />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Bottom Navigation Bar (Oculta sólo dentro del Wizard para foco de checkout) */}
        {activeTab !== "wizard" && <BottomNav />}
      </main>
    </DeviceFrame>
  );
}
