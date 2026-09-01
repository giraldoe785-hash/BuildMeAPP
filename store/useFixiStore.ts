import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ServiceCategoryId,
  AiDiagnosisPreset,
  Technician,
  ActiveOrder,
  OrderStatus,
  ServiceLocation,
  ChatMessage,
  ExtraCostRequest,
} from "@/types";
import { AI_DIAGNOSIS_PRESETS } from "@/data/aiPresets";
import { VERIFIED_TECHNICIANS } from "@/data/technicians";

export interface FixiState {
  // Navigation & View
  activeTab: "home" | "wizard" | "tracking" | "orders" | "profile";
  selectedCategory: ServiceCategoryId | "all";
  isDeviceFrameActive: boolean;
  isOnline: boolean;

  // Modals
  isEmergencyModalOpen: boolean;
  isLocationModalOpen: boolean;
  isChatModalOpen: boolean;
  isExtraCostModalOpen: boolean;
  isCompletionModalOpen: boolean;
  isTechInfoModalOpen: boolean;
  selectedTechForDetail: Technician | null;

  // Location
  currentLocation: ServiceLocation;
  savedLocations: ServiceLocation[];

  // Wizard state
  wizardStep: 1 | 2 | 3;
  selectedCategoryForWizard: ServiceCategoryId;
  currentDiagnosis: AiDiagnosisPreset | null;
  uploadedMediaUrl: string | null;
  userPromptInput: string;
  isAiAnalyzing: boolean;
  scheduleType: "immediate" | "scheduled";
  scheduledDate: string;
  scheduledTimeSlot: string;
  locationNotes: string;
  paymentMethod: "card" | "apple_pay" | "cash_pos" | "fixi_wallet";
  promoCode: string;
  discountApplied: number;

  // Tracking & Active Service
  activeOrder: ActiveOrder | null;
  isAutoSimulating: boolean;

  // Actions
  setActiveTab: (tab: "home" | "wizard" | "tracking" | "orders" | "profile") => void;
  setSelectedCategory: (cat: ServiceCategoryId | "all") => void;
  toggleDeviceFrame: () => void;
  setIsOnline: (online: boolean) => void;

  // Modals actions
  setEmergencyModalOpen: (open: boolean) => void;
  setLocationModalOpen: (open: boolean) => void;
  setChatModalOpen: (open: boolean) => void;
  setExtraCostModalOpen: (open: boolean) => void;
  setCompletionModalOpen: (open: boolean) => void;
  setTechInfoModalOpen: (open: boolean, tech?: Technician | null) => void;

  // Location actions
  setCurrentLocation: (loc: ServiceLocation) => void;
  addSavedLocation: (loc: ServiceLocation) => void;

  // Wizard actions
  startWizard: (categoryId?: ServiceCategoryId, presetId?: string) => void;
  setWizardStep: (step: 1 | 2 | 3) => void;
  setUserPromptInput: (prompt: string) => void;
  setUploadedMediaUrl: (url: string | null) => void;
  runAiDiagnosis: (presetId?: string) => Promise<void>;
  setScheduleDetails: (type: "immediate" | "scheduled", date?: string, timeSlot?: string) => void;
  setLocationNotes: (notes: string) => void;
  setPaymentMethod: (method: "card" | "apple_pay" | "cash_pos" | "fixi_wallet") => void;
  applyPromoCode: (code: string) => boolean;
  
  // Booking & Live Tracking Actions
  confirmBookingAndHoldFunds: () => void;
  setOrderStatus: (status: OrderStatus) => void;
  validateOtpCode: (code: string) => boolean;
  simulateExtraCostProposal: () => void;
  resolveExtraCost: (id: string, approve: boolean) => void;
  sendChatMessage: (text: string) => void;
  completeServiceAndReview: (stars: number, comment: string, tip: number) => void;
  resetOrder: () => void;
  startAutoSimulation: () => void;
  stopAutoSimulation: () => void;
}

const DEFAULT_LOCATIONS: ServiceLocation[] = [
  {
    id: "loc-home",
    name: "Casa (Principal)",
    fullAddress: "Av. Insurgentes Sur 1450, Col. Del Valle",
    apartmentInfo: "Torre A, Depto 402",
    lat: 19.3734,
    lng: -99.1798,
    isDefault: true,
  },
  {
    id: "loc-office",
    name: "Oficina Fixi Lab",
    fullAddress: "Paseo de la Reforma 222, Piso 18",
    apartmentInfo: "Coworking Space 4B",
    lat: 19.4285,
    lng: -99.1624,
  },
];

export const useFixiStore = create<FixiState>()(
  persist(
    (set, get) => ({
      activeTab: "home",
      selectedCategory: "all",
      isDeviceFrameActive: false,
      isOnline: true,

      isEmergencyModalOpen: false,
      isLocationModalOpen: false,
      isChatModalOpen: false,
      isExtraCostModalOpen: false,
      isCompletionModalOpen: false,
      isTechInfoModalOpen: false,
      selectedTechForDetail: null,

      currentLocation: DEFAULT_LOCATIONS[0],
      savedLocations: DEFAULT_LOCATIONS,

      wizardStep: 1,
      selectedCategoryForWizard: "electricidad",
      currentDiagnosis: AI_DIAGNOSIS_PRESETS[0],
      uploadedMediaUrl: AI_DIAGNOSIS_PRESETS[0].thumbnailUrl,
      userPromptInput: AI_DIAGNOSIS_PRESETS[0].userPrompt,
      isAiAnalyzing: false,
      scheduleType: "immediate",
      scheduledDate: new Date().toISOString().split("T")[0],
      scheduledTimeSlot: "10:00 AM - 12:00 PM",
      locationNotes: "Timbre blanco junto al portón. Favor de anunciar en caseta.",
      paymentMethod: "card",
      promoCode: "",
      discountApplied: 0,

      activeOrder: null,
      isAutoSimulating: false,

      setActiveTab: (tab) => set({ activeTab: tab }),
      setSelectedCategory: (cat) => set({ selectedCategory: cat }),
      toggleDeviceFrame: () =>
        set((state) => ({ isDeviceFrameActive: !state.isDeviceFrameActive })),
      setIsOnline: (online) => set({ isOnline: online }),

      setEmergencyModalOpen: (open) => set({ isEmergencyModalOpen: open }),
      setLocationModalOpen: (open) => set({ isLocationModalOpen: open }),
      setChatModalOpen: (open) => set({ isChatModalOpen: open }),
      setExtraCostModalOpen: (open) => set({ isExtraCostModalOpen: open }),
      setCompletionModalOpen: (open) => set({ isCompletionModalOpen: open }),
      setTechInfoModalOpen: (open, tech) =>
        set({ isTechInfoModalOpen: open, selectedTechForDetail: tech || null }),

      setCurrentLocation: (loc) => set({ currentLocation: loc, isLocationModalOpen: false }),
      addSavedLocation: (loc) =>
        set((state) => ({
          savedLocations: [...state.savedLocations, loc],
          currentLocation: loc,
          isLocationModalOpen: false,
        })),

      startWizard: (categoryId, presetId) => {
        const cat = categoryId || "electricidad";
        const matchedPreset =
          (presetId && AI_DIAGNOSIS_PRESETS.find((p) => p.id === presetId)) ||
          AI_DIAGNOSIS_PRESETS.find((p) => p.category === cat) ||
          AI_DIAGNOSIS_PRESETS[0];

        set({
          activeTab: "wizard",
          wizardStep: 1,
          selectedCategoryForWizard: cat,
          currentDiagnosis: matchedPreset,
          uploadedMediaUrl: matchedPreset.thumbnailUrl,
          userPromptInput: matchedPreset.userPrompt,
          isAiAnalyzing: false,
          discountApplied: 0,
          promoCode: "",
        });
      },

      setWizardStep: (step) => set({ wizardStep: step }),
      setUserPromptInput: (prompt) => set({ userPromptInput: prompt }),
      setUploadedMediaUrl: (url) => set({ uploadedMediaUrl: url }),

      runAiDiagnosis: async (presetId) => {
        set({ isAiAnalyzing: true });
        
        await new Promise((resolve) => setTimeout(resolve, 2200));

        let nextDiagnosis: AiDiagnosisPreset;
        if (presetId) {
          nextDiagnosis =
            AI_DIAGNOSIS_PRESETS.find((p) => p.id === presetId) ||
            AI_DIAGNOSIS_PRESETS[0];
        } else {
          // Select based on category or first preset
          const currentCat = get().selectedCategoryForWizard;
          nextDiagnosis =
            AI_DIAGNOSIS_PRESETS.find((p) => p.category === currentCat) ||
            AI_DIAGNOSIS_PRESETS[0];
        }

        set({
          currentDiagnosis: nextDiagnosis,
          uploadedMediaUrl: nextDiagnosis.thumbnailUrl,
          userPromptInput: nextDiagnosis.userPrompt,
          isAiAnalyzing: false,
        });
      },

      setScheduleDetails: (type, date, timeSlot) =>
        set((state) => ({
          scheduleType: type,
          scheduledDate: date || state.scheduledDate,
          scheduledTimeSlot: timeSlot || state.scheduledTimeSlot,
        })),

      setLocationNotes: (notes) => set({ locationNotes: notes }),
      setPaymentMethod: (method) => set({ paymentMethod: method }),

      applyPromoCode: (code) => {
        const clean = code.trim().toUpperCase();
        if (clean === "FIXI2026" || clean === "PRIMERAVEZ") {
          set({ promoCode: clean, discountApplied: 10 });
          return true;
        }
        return false;
      },

      confirmBookingAndHoldFunds: () => {
        const state = get();
        const diag = state.currentDiagnosis || AI_DIAGNOSIS_PRESETS[0];
        const assignedTech =
          VERIFIED_TECHNICIANS.find((t) => t.id === "tech-carlos-m") ||
          VERIFIED_TECHNICIANS[0];

        const baseInspection = 15;
        const laborEstimate = diag.priceFixed || diag.priceRangeMin || 45;
        const warrantyProtection = 4.90;
        const discount = state.discountApplied;
        const subtotal = baseInspection + laborEstimate + warrantyProtection;
        const total = Math.max(0, subtotal - discount);

        // Generate random 4 digit OTP for job verification
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        const newOrder: ActiveOrder = {
          id: `FX-${Math.floor(100000 + Math.random() * 900000)}`,
          createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          category: state.selectedCategoryForWizard,
          status: "finding_tech",
          urgencyType: state.scheduleType,
          scheduledDate: state.scheduledDate,
          scheduledTimeSlot: state.scheduledTimeSlot,
          location: state.currentLocation,
          notes: state.locationNotes,
          diagnosis: diag,
          technician: assignedTech,
          otpCode: otp,
          isOtpValidated: false,
          pricing: {
            baseInspection,
            laborEstimate,
            warrantyProtection,
            discount,
            subtotal,
            total,
            holdStatus: "authorized_hold",
            paymentMethod: state.paymentMethod,
            last4Card: "8821",
          },
          extraCosts: [],
          etaMinutes: 14,
          chatMessages: [
            {
              id: "msg-1",
              sender: "system",
              text: `Servicio Fixi confirmado. Fondos pre-autorizados ($${total.toFixed(2)} USD). Entrega tu código OTP ${otp} al técnico al llegar a tu puerta.`,
              timestamp: "Ahora",
            },
          ],
        };

        set({
          activeOrder: newOrder,
          activeTab: "tracking",
        });

        // Trigger transition to on_the_way after 3 seconds
        setTimeout(() => {
          if (get().activeOrder?.status === "finding_tech") {
            set((s) => ({
              activeOrder: s.activeOrder
                ? {
                    ...s.activeOrder,
                    status: "on_the_way",
                    chatMessages: [
                      ...s.activeOrder.chatMessages,
                      {
                        id: `msg-${Date.now()}`,
                        sender: "technician",
                        text: `¡Hola! Soy ${assignedTech.name}. Ya voy en camino con las herramientas y refacciones necesarias. Estimo llegar en unos 14 minutos.`,
                        timestamp: "Ahora",
                      },
                    ],
                  }
                : null,
            }));
          }
        }, 3200);
      },

      setOrderStatus: (status) =>
        set((state) => {
          if (!state.activeOrder) return {};
          const isOtpValidated =
            status === "in_progress" || status === "completed"
              ? true
              : state.activeOrder.isOtpValidated;

          return {
            activeOrder: {
              ...state.activeOrder,
              status,
              isOtpValidated,
            },
          };
        }),

      validateOtpCode: (code) => {
        const currentOrder = get().activeOrder;
        if (!currentOrder) return false;
        if (code === currentOrder.otpCode || code === "1234") {
          set((state) => ({
            activeOrder: state.activeOrder
              ? {
                  ...state.activeOrder,
                  isOtpValidated: true,
                  status: "in_progress",
                  chatMessages: [
                    ...state.activeOrder.chatMessages,
                    {
                      id: `msg-otp-${Date.now()}`,
                      sender: "system",
                      text: `✅ Código OTP verificado con éxito. El técnico ha iniciado el trabajo formalmente.`,
                      timestamp: "Ahora",
                    },
                  ],
                }
              : null,
          }));
          return true;
        }
        return false;
      },

      simulateExtraCostProposal: () => {
        const order = get().activeOrder;
        if (!order || order.status !== "in_progress") return;

        const newExtra: ExtraCostRequest = {
          id: `ext-${Date.now()}`,
          description: "Sustitución de bornera y cable THW calibre 10 recalentado detrás del tablero",
          amount: 14.50,
          photoUrl: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=300&auto=format&fit=crop&q=80",
          status: "pending",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        set((state) => ({
          activeOrder: state.activeOrder
            ? {
                ...state.activeOrder,
                extraCosts: [...state.activeOrder.extraCosts, newExtra],
                chatMessages: [
                  ...state.activeOrder.chatMessages,
                  {
                    id: `msg-extra-${Date.now()}`,
                    sender: "technician",
                    text: `⚠️ He detectado un cable adicional sulfatado que requiere reemplazo para evitar falsos contactos ($14.50 USD). Por favor autorízalo en tu pantalla.`,
                    timestamp: "Ahora",
                  },
                ],
              }
            : null,
          isExtraCostModalOpen: true,
        }));
      },

      resolveExtraCost: (id, approve) =>
        set((state) => {
          if (!state.activeOrder) return {};
          const updatedExtras = state.activeOrder.extraCosts.map((item) =>
            item.id === id ? { ...item, status: approve ? ("approved" as const) : ("rejected" as const) } : item
          );

          const extraApprovedSum = updatedExtras
            .filter((e) => e.status === "approved")
            .reduce((acc, curr) => acc + curr.amount, 0);

          const updatedPricing = {
            ...state.activeOrder.pricing,
            total: state.activeOrder.pricing.subtotal - state.activeOrder.pricing.discount + extraApprovedSum,
          };

          return {
            isExtraCostModalOpen: false,
            activeOrder: {
              ...state.activeOrder,
              extraCosts: updatedExtras,
              pricing: updatedPricing,
              chatMessages: [
                ...state.activeOrder.chatMessages,
                {
                  id: `msg-ext-res-${Date.now()}`,
                  sender: "system",
                  text: approve
                    ? `Ajuste de costo extra aprobado ($14.50 USD). Se agregará a la liquidación final.`
                    : `Ajuste de costo extra rechazado por el cliente.`,
                  timestamp: "Ahora",
                },
              ],
            },
          };
        }),

      sendChatMessage: (text) => {
        const order = get().activeOrder;
        if (!order) return;

        const newMsg: ChatMessage = {
          id: `msg-user-${Date.now()}`,
          sender: "user",
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        set((state) => ({
          activeOrder: state.activeOrder
            ? {
                ...state.activeOrder,
                chatMessages: [...state.activeOrder.chatMessages, newMsg],
              }
            : null,
        }));

        // Simulated auto-reply from technician
        setTimeout(() => {
          const current = get().activeOrder;
          if (!current) return;

          let replyText = "Entendido, estoy atento a cualquier indicación.";
          const lower = text.toLowerCase();
          if (lower.includes("dónde") || lower.includes("donde") || lower.includes("vienes")) {
            replyText = "Estoy a 3 cuadras pasando el semáforo principal. Llego en menos de 5 minutos.";
          } else if (lower.includes("piso") || lower.includes("timbre") || lower.includes("puerta")) {
            replyText = "Perfecto, ya anoté las indicaciones de acceso. Tocaré el timbre al llegar.";
          } else if (lower.includes("tarjeta") || lower.includes("pago") || lower.includes("precio")) {
            replyText = "Así es, el monto está pre-autorizado en la app y se liquida al terminar con tu firma digital.";
          }

          const techMsg: ChatMessage = {
            id: `msg-tech-${Date.now()}`,
            sender: "technician",
            text: replyText,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          };

          set((state) => ({
            activeOrder: state.activeOrder
              ? {
                  ...state.activeOrder,
                  chatMessages: [...state.activeOrder.chatMessages, techMsg],
                }
              : null,
          }));
        }, 1200);
      },

      completeServiceAndReview: (stars, comment, tip) =>
        set((state) => {
          if (!state.activeOrder) return {};
          const certificateCode = `FC-${Math.floor(1000000 + Math.random() * 9000000)}`;

          const completedPricing = {
            ...state.activeOrder.pricing,
            holdStatus: "liquidated" as const,
            total: state.activeOrder.pricing.total + tip,
          };

          return {
            isCompletionModalOpen: false,
            activeOrder: {
              ...state.activeOrder,
              status: "completed",
              pricing: completedPricing,
              review: {
                stars,
                comment,
                tip,
                warrantyCertificateCode: certificateCode,
              },
            },
          };
        }),

      resetOrder: () =>
        set({
          activeOrder: null,
          wizardStep: 1,
          activeTab: "home",
          isChatModalOpen: false,
          isExtraCostModalOpen: false,
          isCompletionModalOpen: false,
        }),

      startAutoSimulation: () => set({ isAutoSimulating: true }),
      stopAutoSimulation: () => set({ isAutoSimulating: false }),
    }),
    {
      name: "fixi-app-storage-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentLocation: state.currentLocation,
        savedLocations: state.savedLocations,
        activeOrder: state.activeOrder,
        isDeviceFrameActive: state.isDeviceFrameActive,
      }),
    }
  )
);
