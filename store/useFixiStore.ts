import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ServiceCategoryId,
  AiDiagnosisPreset,
  AiDiagnosisResult,
  DiagnosisStatus,
  DiagnosisMethod,
  Technician,
  ActiveOrder,
  OrderStatus,
  OrderPaymentStatusUi,
  ServiceLocation,
  ChatMessage,
  ExtraCostRequest,
} from "@/types";
import { AI_DIAGNOSIS_PRESETS } from "@/data/aiPresets";
import { VERIFIED_TECHNICIANS } from "@/data/technicians";
import {
  formatCatalogUnitsToCop,
  getPromoDiscount,
  normalizePromoCode,
} from "@/lib/pricing";

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
  currentDiagnosis: AiDiagnosisPreset | AiDiagnosisResult | null;
  uploadedMediaUrl: string | null;
  userPromptInput: string;
  isAiAnalyzing: boolean;
  diagnosisStatus: DiagnosisStatus;
  diagnosisError: string | null;
  diagnosisMethod: DiagnosisMethod | null;
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
  selectPresetDiagnosis: (presetId: string) => void;
  setAiDiagnosisResult: (result: AiDiagnosisResult) => void;
  setAiDiagnosisLoading: () => void;
  setAiDiagnosisError: (error: string) => void;
  resetDiagnosis: () => void;
  setScheduleDetails: (type: "immediate" | "scheduled", date?: string, timeSlot?: string) => void;
  setLocationNotes: (notes: string) => void;
  setPaymentMethod: (method: "card" | "apple_pay" | "cash_pos" | "fixi_wallet") => void;
  applyPromoCode: (code: string) => boolean;
  
  // Booking & Live Tracking Actions
  confirmBookingAndHoldFunds: (idempotencyKey?: string) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    order?: ActiveOrder;
  }>;
  fetchActiveOrder: (signal?: AbortSignal) => Promise<ActiveOrder | null>;
  syncServerOrderToLocalState: (serverOrder: Record<string, any>) => ActiveOrder;
  acceptOrder: (techName?: string) => void;
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
      currentDiagnosis: null,
      uploadedMediaUrl: null,
      userPromptInput: "",
      isAiAnalyzing: false,
      diagnosisStatus: "idle" as DiagnosisStatus,
      diagnosisError: null,
      diagnosisMethod: null,
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

        // If a specific preset was requested (e.g. from HomeView shortcut), select it directly
        const matchedPreset = presetId
          ? AI_DIAGNOSIS_PRESETS.find((p) => p.id === presetId) || null
          : null;

        set({
          activeTab: "wizard",
          wizardStep: 1,
          selectedCategoryForWizard: cat,
          currentDiagnosis: matchedPreset,
          uploadedMediaUrl: null,
          userPromptInput: "",
          isAiAnalyzing: false,
          diagnosisStatus: matchedPreset ? ("success" as DiagnosisStatus) : ("idle" as DiagnosisStatus),
          diagnosisError: null,
          diagnosisMethod: matchedPreset ? ("Caso_Predefinido" as DiagnosisMethod) : null,
          discountApplied: 0,
          promoCode: "",
        });
      },

      setWizardStep: (step) => set({ wizardStep: step }),
      setUserPromptInput: (prompt) => set({ userPromptInput: prompt }),
      setUploadedMediaUrl: (url) => set({ uploadedMediaUrl: url }),

      selectPresetDiagnosis: (presetId) => {
        const preset =
          AI_DIAGNOSIS_PRESETS.find((p) => p.id === presetId) ||
          AI_DIAGNOSIS_PRESETS[0];
        set({
          currentDiagnosis: preset,
          isAiAnalyzing: false,
          diagnosisStatus: "success" as DiagnosisStatus,
          diagnosisError: null,
          diagnosisMethod: "Caso_Predefinido" as DiagnosisMethod,
        });
      },

      setAiDiagnosisResult: (result) => {
        set({
          currentDiagnosis: result,
          isAiAnalyzing: false,
          diagnosisStatus: "success" as DiagnosisStatus,
          diagnosisError: null,
          diagnosisMethod: "Análisis_IA" as DiagnosisMethod,
        });
      },

      setAiDiagnosisLoading: () => {
        set({
          isAiAnalyzing: true,
          diagnosisStatus: "loading" as DiagnosisStatus,
          diagnosisError: null,
          currentDiagnosis: null,
        });
      },

      setAiDiagnosisError: (error) => {
        set({
          isAiAnalyzing: false,
          diagnosisStatus: "error" as DiagnosisStatus,
          diagnosisError: error,
          currentDiagnosis: null,
        });
      },

      resetDiagnosis: () => {
        set({
          currentDiagnosis: null,
          isAiAnalyzing: false,
          diagnosisStatus: "idle" as DiagnosisStatus,
          diagnosisError: null,
          diagnosisMethod: null,
          uploadedMediaUrl: null,
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
        const clean = normalizePromoCode(code);
        const discount = getPromoDiscount(clean);
        if (clean && discount > 0) {
          set({ promoCode: clean, discountApplied: discount });
          return true;
        }
        return false;
      },

      syncServerOrderToLocalState: (serverOrder: Record<string, any>) => {
        const state = get();
        const existingOrder =
          state.activeOrder &&
          (state.activeOrder.id === serverOrder.orderNumber ||
            state.activeOrder.id === serverOrder.id ||
            (state.activeOrder.dbId && state.activeOrder.dbId === serverOrder.id))
            ? state.activeOrder
            : null;

        const validPaymentStatuses: readonly OrderPaymentStatusUi[] = [
          "PENDIENTE",
          "PREAUTORIZADO",
          "CAPTURADO",
          "LIBERADO",
          "REEMBOLSADO",
          "FALLIDO",
        ];
        const rawPaymentStatus =
          typeof serverOrder.paymentStatus === "string"
            ? (serverOrder.paymentStatus.trim().toUpperCase() as OrderPaymentStatusUi)
            : typeof serverOrder.estadoPago === "string"
            ? (serverOrder.estadoPago.trim().toUpperCase() as OrderPaymentStatusUi)
            : null;
        const paymentStatus: OrderPaymentStatusUi =
          rawPaymentStatus && validPaymentStatuses.includes(rawPaymentStatus)
            ? rawPaymentStatus
            : "PENDIENTE";

        const isAssigned = Boolean(serverOrder.technician?.isAssigned);
        const techData = serverOrder.technician || {};

        const mappedTechnician: Technician = isAssigned
          ? {
              id: String(techData.id || "tech-assigned"),
              name: String(techData.name || "Especialista Verificado"),
              role: `Especialista en ${String(serverOrder.category || "servicio")}`,
              avatar: String(
                techData.photoUrl ||
                  "https://images.unsplash.com/photo-1540569014015-19a7be504e3a?w=300&auto=format&fit=crop&q=80"
              ),
              rating: Number(techData.rating ?? 4.95),
              reviewCount: Number(techData.completedJobs ?? 24),
              distanceKm: 1.2,
              completedJobs: Number(techData.completedJobs ?? 24),
              hourlyRate: 35,
              verifiedBadges: ["Identidad Verificada", "Garantía FixiCare®"],
              vehicle: {
                type: "Moto",
                model: "Unidad Móvil Fixi",
                plate: "FX-PRO",
              },
              phone: "+593990000000",
              responseTimeMin: Number(techData.responseMinutes ?? 12),
              bio: String(
                techData.bio ||
                  "Especialista acreditado en la plataforma BuildMeAPP."
              ),
            }
          : paymentStatus === "CAPTURADO"
          ? {
              id: "pending-assignment",
              name: "Buscando especialista en tu zona...",
              role: "Asignación automática en curso",
              avatar:
                "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=300&auto=format&fit=crop&q=80",
              rating: 5.0,
              reviewCount: 0,
              distanceKm: 0,
              completedJobs: 0,
              hourlyRate: 35,
              verifiedBadges: ["Radar Fixi Activo"],
              vehicle: {
                type: "Moto",
                model: "Pendiente de asignación",
                plate: "EN-BUSQUEDA",
              },
              phone: "",
              responseTimeMin: 10,
              bio: "Tu solicitud ya está visible para los reparadores verificados de esta especialidad.",
            }
          : {
              id: "pending-payment",
              name: "Asignación sujeta a confirmación de pago",
              role:
                paymentStatus === "FALLIDO"
                  ? "Pago rechazado o pendiente de reintento"
                  : "Confirmación de pago pendiente en Wompi",
              avatar:
                "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=300&auto=format&fit=crop&q=80",
              rating: 5.0,
              reviewCount: 0,
              distanceKm: 0,
              completedJobs: 0,
              hourlyRate: 35,
              verifiedBadges: ["Pago Wompi requerido"],
              vehicle: {
                type: "Moto",
                model: "En espera de pago",
                plate: "PENDIENTE",
              },
              phone: "",
              responseTimeMin: 10,
              bio: "Completa el pago en Wompi para activar el radar y publicar tu solicitud a los especialistas verificados.",
            };

        const baseInspection = Number(serverOrder.pricing?.baseInspection ?? 15);
        const laborEstimate = Number(serverOrder.pricing?.laborEstimate ?? 40);
        const warrantyProtection = Number(serverOrder.pricing?.warrantyProtection ?? 4.9);
        const discount = Number(serverOrder.pricing?.discount ?? 0);
        const subtotal = Number((baseInspection + laborEstimate + warrantyProtection).toFixed(2));
        const total = Number(serverOrder.pricing?.total ?? Math.max(15, subtotal - discount));
        const otpCode = String(serverOrder.otpCode || existingOrder?.otpCode || "0000");

        let formattedTotalCop = `$ ${Math.round(total * 1000).toLocaleString("es-CO")} COP`;
        try {
          formattedTotalCop = formatCatalogUnitsToCop(total.toFixed(2));
        } catch {
          // fallback seguro si total tuviera decimales atípicos
        }

        let chatMessages: ChatMessage[] = existingOrder?.chatMessages?.length
          ? [...existingOrder.chatMessages]
          : [
              {
                id: "msg-1",
                sender: "system",
                text:
                  paymentStatus === "CAPTURADO"
                    ? `Pago confirmado en Wompi (${formattedTotalCop}) para tu servicio #${
                        serverOrder.orderNumber || serverOrder.id
                      }. Entrega tu código OTP ${otpCode} al técnico únicamente cuando llegue a tu puerta.`
                    : `Solicitud Fixi registrada (#${
                        serverOrder.orderNumber || serverOrder.id
                      }) por ${formattedTotalCop}. Completa el pago en Wompi para habilitar la asignación de especialista.`,
                timestamp: String(serverOrder.createdAt || "Ahora"),
              },
            ];

        if (
          existingOrder &&
          existingOrder.paymentStatus !== "CAPTURADO" &&
          paymentStatus === "CAPTURADO" &&
          !chatMessages.some((m) => m.id.startsWith("msg-payment-captured"))
        ) {
          chatMessages = [
            ...chatMessages,
            {
              id: `msg-payment-captured-${Date.now()}`,
              sender: "system",
              text: `Pago verificado con éxito en Wompi (${formattedTotalCop}). Tu solicitud ya está publicada en el radar de especialistas; conserva tu código OTP ${otpCode}.`,
              timestamp: "Ahora",
            },
          ];
        }

        const newStatus = (serverOrder.status || "finding_tech") as OrderStatus;
        if (
          newStatus === "on_the_way" &&
          isAssigned &&
          !chatMessages.some((m) => m.sender === "technician")
        ) {
          chatMessages = [
            ...chatMessages,
            {
              id: `msg-tech-assigned-${Date.now()}`,
              sender: "technician",
              text: `¡Hola! Soy ${mappedTechnician.name}. He aceptado tu solicitud #${
                serverOrder.orderNumber || serverOrder.id
              } y ya voy en camino a ${serverOrder.address}.`,
              timestamp: "Ahora",
            },
          ];
        }

        const diagRaw = serverOrder.diagnosis || {};
        const mappedDiagnosis: AiDiagnosisPreset = {
          id: String(diagRaw.id || `diag-${serverOrder.id}`),
          title: String(diagRaw.title || "Servicio técnico solicitado"),
          category: (serverOrder.category || state.selectedCategoryForWizard) as ServiceCategoryId,
          thumbnailUrl: String(
            diagRaw.thumbnailUrl ||
              "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=500&auto=format&fit=crop&q=80"
          ),
          mediaType: "image",
          userPrompt: String(diagRaw.title || ""),
          confidenceScore: Number(diagRaw.confidenceScore ?? 94),
          confidenceLevel: "high",
          pricingType: "guaranteed_fixed",
          currency: "COP",
          isIndicative: false,
          budget: {
            inspectionAmountCop: Math.round(baseInspection * 1000),
            laborEstimateCop: Math.round(laborEstimate * 1000),
            materialsEstimateCop: 0,
            discountAmountCop: Math.round(discount * 1000),
            totalEstimateCop: Math.round(total * 1000),
          },
          severity: "alta",
          rootCause: String(diagRaw.rootCause || diagRaw.title || ""),
          suggestedFix: String(
            diagRaw.suggestedFix || "Intervención técnica especializada en domicilio."
          ),
          requiredMaterials: Array.isArray(diagRaw.requiredMaterials)
            ? diagRaw.requiredMaterials
            : ["Kit de herramientas certificadas"],
          estimatedHours: Number(diagRaw.estimatedHours ?? 1.5),
          priceFixed: laborEstimate,
          method: "Caso_Predefinido",
        };

        const holdStatus: ActiveOrder["pricing"]["holdStatus"] =
          newStatus === "completed"
            ? "liquidated"
            : paymentStatus === "REEMBOLSADO"
            ? "refunded"
            : paymentStatus === "CAPTURADO"
            ? "authorized_hold"
            : paymentStatus === "FALLIDO"
            ? "payment_failed"
            : "pending_payment";

        const syncedOrder: ActiveOrder = {
          id: String(serverOrder.orderNumber || serverOrder.id),
          dbId:
            typeof serverOrder.id === "string" && serverOrder.id.trim().length > 0
              ? serverOrder.id.trim()
              : existingOrder?.dbId,
          createdAt: String(serverOrder.createdAt || "Ahora"),
          category: (serverOrder.category || state.selectedCategoryForWizard) as ServiceCategoryId,
          status: newStatus,
          paymentStatus,
          urgencyType: serverOrder.urgencyType === "scheduled" ? "scheduled" : "immediate",
          scheduledDate: serverOrder.scheduledDate || state.scheduledDate,
          scheduledTimeSlot: serverOrder.scheduledTimeSlot || state.scheduledTimeSlot,
          location: {
            ...state.currentLocation,
            fullAddress: String(serverOrder.address || state.currentLocation.fullAddress),
            apartmentInfo:
              serverOrder.apartmentReference !== undefined
                ? String(serverOrder.apartmentReference)
                : state.currentLocation.apartmentInfo,
          },
          notes:
            serverOrder.apartmentReference !== undefined
              ? String(serverOrder.apartmentReference)
              : state.locationNotes,
          diagnosis: existingOrder?.diagnosis || mappedDiagnosis,
          technician: mappedTechnician,
          otpCode,
          isOtpValidated:
            newStatus === "in_progress" || newStatus === "completed"
              ? true
              : Boolean(existingOrder?.isOtpValidated),
          pricing: {
            baseInspection,
            laborEstimate,
            warrantyProtection,
            discount,
            subtotal,
            total,
            holdStatus,
            paymentMethod: (serverOrder.paymentMethod || state.paymentMethod) as
              | "card"
              | "apple_pay"
              | "cash_pos"
              | "fixi_wallet",
          },
          extraCosts: existingOrder?.extraCosts || [],
          etaMinutes: isAssigned ? 12 : 15,
          chatMessages,
        };

        set({ activeOrder: syncedOrder });
        return syncedOrder;
      },

      fetchActiveOrder: async (signal?: AbortSignal) => {
        try {
          const response = await fetch("/api/orders/active", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            signal,
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(
              errData?.message || `Error del servidor (${response.status})`
            );
          }

          const data = await response.json().catch(() => null);
          if (!data?.success) {
            throw new Error(
              data?.message || "No fue posible consultar tu orden activa."
            );
          }

          if (!data.order) {
            const current = get().activeOrder;
            if (current && current.status !== "completed") {
              set({ activeOrder: null });
            }
            return null;
          }

          return get().syncServerOrderToLocalState(data.order);
        } catch (err: any) {
          if (err?.name === "AbortError") {
            return get().activeOrder;
          }
          throw err;
        }
      },

      confirmBookingAndHoldFunds: async (idempotencyKey?: string) => {
        const state = get();
        const diag = state.currentDiagnosis || AI_DIAGNOSIS_PRESETS[0];
        const presetId = "id" in diag ? diag.id : undefined;

        const payload = {
          category: state.selectedCategoryForWizard,
          address: state.currentLocation.fullAddress,
          latitude: state.currentLocation.lat,
          longitude: state.currentLocation.lng,
          apartmentReference:
            state.locationNotes || state.currentLocation.apartmentInfo || "",
          urgencyType: state.scheduleType,
          scheduledDate:
            state.scheduleType === "scheduled" ? state.scheduledDate : undefined,
          scheduledTimeSlot:
            state.scheduleType === "scheduled" ? state.scheduledTimeSlot : undefined,
          diagnosisPresetId: presetId,
          diagnosis: {
            id: presetId,
            title: diag.title,
            rootCause: diag.rootCause,
            suggestedFix: diag.suggestedFix,
            method: diag.method === "Caso_Predefinido" ? "Caso_Predefinido" : "Analisis_IA",
            thumbnailUrl: "thumbnailUrl" in diag ? diag.thumbnailUrl : state.uploadedMediaUrl,
          },
          paymentMethod: state.paymentMethod,
          promoCode: state.promoCode || undefined,
          idempotencyKey:
            idempotencyKey ||
            `ord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        };

        try {
          const response = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });

          const data = await response.json().catch(() => null);

          if (!response.ok || !data?.success || !data?.order) {
            return {
              success: false,
              code: typeof data?.code === "string" ? data.code : undefined,
              error:
                data?.message ||
                "No fue posible registrar la solicitud de servicio. Verifica tu sesión e inténtalo de nuevo.",
            };
          }

          const syncedOrder = get().syncServerOrderToLocalState(data.order);
          set((curr) => ({
            activeOrder: syncedOrder,
            activeTab:
              syncedOrder.paymentStatus === "CAPTURADO"
                ? "tracking"
                : curr.activeTab,
          }));

          return {
            success: true,
            order: syncedOrder,
          };
        } catch {
          return {
            success: false,
            error: "Error de conexión al registrar tu solicitud. Inténtalo nuevamente.",
          };
        }
      },

      acceptOrder: (techName?: string) => {
        const state = get();
        if (!state.activeOrder) return;
        const assignedName = techName || state.activeOrder.technician.name;
        const alreadyHasTechMsg = state.activeOrder.chatMessages.some((m) => m.sender === "technician");

        const chatMessages = alreadyHasTechMsg
          ? state.activeOrder.chatMessages
          : [
              ...state.activeOrder.chatMessages,
              {
                id: `msg-${Date.now()}`,
                sender: "technician" as const,
                text: `¡Hola! Soy ${assignedName}. He aceptado tu solicitud y ya voy en camino con las herramientas y refacciones necesarias. Estimo llegar en unos 14 minutos.`,
                timestamp: "Ahora",
              },
            ];

        set({
          activeOrder: {
            ...state.activeOrder,
            status: "on_the_way",
            chatMessages,
          },
        });
      },

      setOrderStatus: (status) =>
        set((state) => {
          if (!state.activeOrder) return {};
          const isOtpValidated =
            status === "in_progress" || status === "completed"
              ? true
              : state.activeOrder.isOtpValidated;

          let chatMessages = state.activeOrder.chatMessages;
          if (status === "on_the_way" && !chatMessages.some((m) => m.sender === "technician")) {
            chatMessages = [
              ...chatMessages,
              {
                id: `msg-${Date.now()}`,
                sender: "technician",
                text: `¡Hola! Soy ${state.activeOrder.technician.name}. He aceptado tu solicitud y ya voy en camino con las herramientas y refacciones necesarias. Estimo llegar en unos 14 minutos.`,
                timestamp: "Ahora",
              },
            ];
          }

          return {
            activeOrder: {
              ...state.activeOrder,
              status,
              isOtpValidated,
              chatMessages,
            },
          };
        }),

      validateOtpCode: (code) => {
        const currentOrder = get().activeOrder;
        if (!currentOrder) return false;
        const cleanCode = typeof code === "string" ? code.trim() : "";
        if (cleanCode && cleanCode === currentOrder.otpCode) {
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
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<FixiState>;
        const rawOrder = persisted.activeOrder;
        const normalizedOrder: ActiveOrder | null = rawOrder
          ? {
              ...rawOrder,
              paymentStatus: rawOrder.paymentStatus ?? "PENDIENTE",
            }
          : null;
        return {
          ...currentState,
          ...persisted,
          activeOrder: normalizedOrder,
        };
      },
    }
  )
);
