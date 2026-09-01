export type ServiceCategoryId =
  | "electricidad"
  | "plomeria"
  | "carpinteria"
  | "herreria"
  | "pintura"
  | "cerrajeria";

export interface ServiceCategory {
  id: ServiceCategoryId;
  name: string;
  shortDesc: string;
  iconName: string;
  startingPrice: number;
  availableTechsCount: number;
  isPopular?: boolean;
  color: string;
  bgLight: string;
}

export type UserRole = "client" | "repairer";
export type VerificationStatus = "pending" | "approved" | "rejected";

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  cedula?: string;
  specialty?: ServiceCategoryId;
  documentName?: string;
  documentType?: string;
  documentSize?: string;
  verificationStatus?: VerificationStatus;
  createdAt: string;
}

export interface Technician {
  id: string;
  name: string;
  role: string;
  avatar: string;
  rating: number;
  reviewCount: number;
  distanceKm: number;
  completedJobs: number;
  hourlyRate: number;
  verifiedBadges: string[];
  vehicle: {
    type: "Moto" | "Camioneta" | "Auto";
    model: string;
    plate: string;
  };
  phone: string;
  responseTimeMin: number;
  bio: string;
}

export type MediaFileType = "image" | "video" | "audio";

export interface AiDiagnosisPreset {
  id: string;
  title: string;
  category: ServiceCategoryId;
  thumbnailUrl: string;
  mediaType: MediaFileType;
  userPrompt: string;
  confidenceScore: number; // 0 - 100
  confidenceLevel: "high" | "medium" | "low";
  pricingType: "guaranteed_fixed" | "estimated_range";
  severity: "baja" | "media" | "alta" | "critica";
  rootCause: string;
  suggestedFix: string;
  requiredMaterials: string[];
  estimatedHours: number;
  priceFixed?: number;
  priceRangeMin?: number;
  priceRangeMax?: number;
}

export type OrderStatus =
  | "idle"
  | "finding_tech"
  | "on_the_way"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface ExtraCostRequest {
  id: string;
  description: string;
  amount: number;
  photoUrl?: string;
  status: "pending" | "approved" | "rejected";
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "technician" | "system";
  text: string;
  timestamp: string;
  quickAction?: string;
}

export interface ServiceLocation {
  id: string;
  name: string;
  fullAddress: string;
  apartmentInfo?: string;
  lat: number;
  lng: number;
  isDefault?: boolean;
}

export interface ActiveOrder {
  id: string;
  createdAt: string;
  category: ServiceCategoryId;
  status: OrderStatus;
  urgencyType: "immediate" | "scheduled";
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  location: ServiceLocation;
  notes?: string;
  diagnosis: AiDiagnosisPreset;
  technician: Technician;
  otpCode: string; // Código de 4 dígitos entregado por el cliente al técnico
  isOtpValidated: boolean;
  pricing: {
    baseInspection: number;
    laborEstimate: number;
    warrantyProtection: number;
    discount: number;
    subtotal: number;
    total: number;
    holdStatus: "authorized_hold" | "liquidated" | "refunded";
    paymentMethod: "card" | "apple_pay" | "cash_pos" | "fixi_wallet";
    last4Card?: string;
  };
  extraCosts: ExtraCostRequest[];
  etaMinutes: number;
  chatMessages: ChatMessage[];
  review?: {
    stars: number;
    comment: string;
    tip: number;
    warrantyCertificateCode: string;
  };
}
