import { create } from "zustand";
import { AuthUser, ServiceCategoryId } from "@/types";
import { useFixiStore } from "@/store/useFixiStore";

// ---------------------------------------------------------------------------
// Validación de contraseña (la usan los formularios; se mantiene igual)
// ---------------------------------------------------------------------------

export interface PasswordValidationResult {
  isValid: boolean;
  hasMinLength: boolean;
  hasMinTwoNumbers: boolean;
}

export const validateRegistrationPassword = (password: string): PasswordValidationResult => {
  const hasMinLength = password.length >= 7;
  const numbersCount = (password.match(/\d/g) || []).length;
  const hasMinTwoNumbers = numbersCount >= 2;
  return {
    isValid: hasMinLength && hasMinTwoNumbers,
    hasMinLength,
    hasMinTwoNumbers,
  };
};

export const PASSWORD_VALIDATION_ERROR_MESSAGE =
  "La contraseña debe tener mínimo 7 caracteres y contener al menos 2 números.";

// ---------------------------------------------------------------------------
// Traducción de la respuesta del backend (español, enums en mayúsculas)
// al formato AuthUser que ya usa toda la interfaz (inglés, minúsculas).
// ---------------------------------------------------------------------------

interface ApiUser {
  id: string;
  nombreUsuario: string;
  rol: "CLIENTE" | "REPARADOR" | "ADMINISTRADOR";
  estado: "PENDIENTE_VERIFICACION" | "EN_REVISION" | "VERIFICADO" | "RECHAZADO" | "SUSPENDIDO";
  creadoEn: string;
  perfilCliente?: { nombres: string; apellidos: string } | null;
  perfilReparador?: {
    nombres: string;
    apellidos: string;
    numeroDocumento?: string;
    especialidades?: { categoria?: { slug?: string } | null }[];
    documentos?: {
      nombreOriginal?: string | null;
      mimeType?: string | null;
      tamanoBytes?: number | null;
    }[];
  } | null;
}

const CATEGORY_IDS: ServiceCategoryId[] = [
  "electricidad",
  "plomeria",
  "carpinteria",
  "herreria",
  "pintura",
  "cerrajeria",
];

function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function toAuthUser(api: ApiUser): AuthUser | null {
  const perfil = api.rol === "REPARADOR" ? api.perfilReparador : api.perfilCliente;
  const fullName = perfil ? `${perfil.nombres} ${perfil.apellidos}`.trim() : "";
  const createdAt = (api.creadoEn ?? "").slice(0, 10);

  if (api.rol === "ADMINISTRADOR") {
    return {
      id: api.id,
      name: fullName || api.nombreUsuario,
      username: api.nombreUsuario,
      role: "admin",
      createdAt,
    };
  }

  if (api.rol === "REPARADOR") {
    const slug = api.perfilReparador?.especialidades?.[0]?.categoria?.slug;
    const specialty = CATEGORY_IDS.find((id) => id === slug);
    const doc = api.perfilReparador?.documentos?.[0];

    return {
      id: api.id,
      name: fullName || api.nombreUsuario,
      username: api.nombreUsuario,
      role: "repairer",
      cedula: api.perfilReparador?.numeroDocumento,
      verificationStatus:
        api.estado === "VERIFICADO" ? "approved" : api.estado === "RECHAZADO" ? "rejected" : "pending",
      createdAt,
      specialty,
      documentName: doc?.nombreOriginal ?? undefined,
      documentType: doc?.mimeType ?? undefined,
      documentSize: doc?.tamanoBytes != null ? formatFileSize(doc.tamanoBytes) : undefined,
    };
  }

  return {
    id: api.id,
    name: fullName || api.nombreUsuario,
    username: api.nombreUsuario,
    role: "client",
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// Llamadas al backend
// ---------------------------------------------------------------------------

export type VerificationCodeStatus = "sent" | "existing";

export type AuthResult = {
  success: boolean;
  message?: string;
  user?: AuthUser;
  requiresEmailVerification?: boolean;
  /** "sent": se envió un código ahora. "existing": ya había uno vigente. */
  codeStatus?: VerificationCodeStatus;
  /** Segundos que faltan, según el servidor, para poder pedir otro código. */
  cooldownSeconds?: number;
  expiresInSeconds?: number;
  email?: string;
  username?: string;
};

const NETWORK_ERROR = "Error de conexión. Verifica tu conexión a internet e intenta de nuevo.";

async function callApi(
  url: string,
  options: { method: "GET" | "POST"; body?: unknown; formData?: FormData }
): Promise<{ ok: boolean; status: number; data: any } | null> {
  try {
    // Con FormData el navegador pone solo el Content-Type (con su "boundary").
    const res = await fetch(url, {
      method: options.method,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.formData ?? (options.body ? JSON.stringify(options.body) : undefined),
      cache: "no-store",
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return null; // sin conexión
  }
}

// Al cerrar sesión se limpia lo que useFixiStore guarda en localStorage
// (orden activa, direcciones), para que la siguiente persona que use este
// navegador no vea los datos de la anterior. Se conserva solo la preferencia
// visual del marco de dispositivo.
function resetFixiStore() {
  const fixi = useFixiStore.getState();
  fixi.stopAutoSimulation(); // detiene la simulación del seguimiento si estaba corriendo
  useFixiStore.setState(
    { ...useFixiStore.getInitialState(), isDeviceFrameActive: fixi.isDeviceFrameActive },
    true
  );
}

// ---------------------------------------------------------------------------
// Store: ahora es solo una CACHÉ de la sesión real (la cookie vive en el
// servidor). No guarda contraseñas ni cuentas y no usa localStorage.
// ---------------------------------------------------------------------------

export interface AuthState {
  currentUser: AuthUser | null;
  isAuthenticated: boolean;
  /** true mientras se consulta /api/auth/me al cargar la página */
  isCheckingSession: boolean;

  checkSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<AuthResult>;
  registerClient: (data: {
    name: string;
    email: string;
    username: string;
    password: string;
    confirmPassword: string;
  }) => Promise<AuthResult>;
  verifyEmailCode: (data: {
    username?: string;
    email?: string;
    code: string;
  }) => Promise<AuthResult>;
  resendVerificationCode: (data: {
    username?: string;
    email?: string;
  }) => Promise<{
    success: boolean;
    message: string;
    /** Espera real (segundos) hasta poder pedir otro código, devuelta por el servidor. */
    cooldownSeconds?: number;
    expiresInSeconds?: number;
    /** En un 429, segundos que faltan para poder reintentar. */
    retryAfterSeconds?: number;
  }>;
  requestPasswordReset: (
    email: string
  ) => Promise<{ success: boolean; message: string }>;
  registerRepairer: (data: {
    name: string;
    username: string;
    cedula: string;
    city: string;
    password: string;
    confirmPassword: string;
    specialty: ServiceCategoryId;
    documentFile: File;
  }) => Promise<AuthResult>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  currentUser: null,
  isAuthenticated: false,
  isCheckingSession: true,

  checkSession: async () => {
    set({ isCheckingSession: true });

    const res = await callApi("/api/auth/me", { method: "GET" });
    const user = res?.ok && res.data?.user ? toAuthUser(res.data.user as ApiUser) : null;

    set({
      currentUser: user,
      isAuthenticated: user !== null,
      isCheckingSession: false,
    });
  },

  login: async (username, password) => {
    const res = await callApi("/api/auth/login", {
      method: "POST",
      body: { username: username.trim(), password },
    });

    if (!res) return { success: false, message: NETWORK_ERROR };
    if (!res.ok) {
      const needsVerification = Boolean(res.data?.requiresEmailVerification);
      return {
        success: false,
        message: res.data?.message || "No fue posible iniciar sesión.",
        requiresEmailVerification: needsVerification,
        codeStatus: res.data?.codeStatus === "sent" ? "sent" : "existing",
        cooldownSeconds:
          typeof res.data?.cooldownSeconds === "number" ? res.data.cooldownSeconds : 0,
        expiresInSeconds:
          typeof res.data?.expiresInSeconds === "number"
            ? res.data.expiresInSeconds
            : undefined,
        email: res.data?.email,
        username: res.data?.username || username.trim().toLowerCase(),
      };
    }

    const user = toAuthUser(res.data.user as ApiUser);
    if (!user) {
      // Cuenta de administrador: no tiene vista en esta app, se cierra la sesión recién creada
      await callApi("/api/auth/logout", { method: "POST" });
      return { success: false, message: "Esta cuenta no tiene acceso a la aplicación." };
    }

    set({ currentUser: user, isAuthenticated: true });
    return { success: true, user };
  },

  registerClient: async ({ name, email, username, password, confirmPassword }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();

    const res = await callApi("/api/auth/register/client", {
      method: "POST",
      body: {
        name: name.trim(),
        email: normalizedEmail,
        username: normalizedUsername,
        password,
        confirmPassword,
      },
    });

    if (!res) return { success: false, message: NETWORK_ERROR };

    // Error del servidor (400, 409, 429, 503...): se muestra el mensaje en el formulario
    // y NO se abre la pantalla del código, porque no se envió ningún código.
    if (!res.ok) {
      return {
        success: false,
        message: res.data?.message || "Error al crear la cuenta.",
      };
    }

    // 200/201 con código enviado (o vigente): se continúa en la pantalla del código.
    if (res.data?.requiresEmailVerification) {
      return {
        success: true,
        requiresEmailVerification: true,
        codeStatus: res.data?.codeStatus === "existing" ? "existing" : "sent",
        cooldownSeconds:
          typeof res.data?.cooldownSeconds === "number" ? res.data.cooldownSeconds : 0,
        expiresInSeconds:
          typeof res.data?.expiresInSeconds === "number"
            ? res.data.expiresInSeconds
            : undefined,
        email: res.data?.email || normalizedEmail,
        username: res.data?.username || normalizedUsername,
        message:
          res.data?.message ||
          "Ingresa el código de 6 dígitos enviado a tu correo electrónico.",
      };
    }

    // La cuenta existe pero no se pudo abrir la sesión: debe iniciar sesión a mano
    if (res.data?.sesionIniciada === false) {
      return {
        success: false,
        message: res.data?.message || "Cuenta creada. Inicia sesión para continuar.",
      };
    }

    const user = toAuthUser(res.data.user as ApiUser);
    if (!user) return { success: false, message: "Error al crear la cuenta." };

    set({ currentUser: user, isAuthenticated: true });
    return { success: true, user };
  },

  verifyEmailCode: async ({ username, email, code }) => {
    const res = await callApi("/api/auth/verify-email", {
      method: "POST",
      body: {
        username: username?.trim().toLowerCase(),
        email: email?.trim().toLowerCase(),
        code: code.trim(),
      },
    });

    if (!res) return { success: false, message: NETWORK_ERROR };
    if (!res.ok) {
      return {
        success: false,
        message: res.data?.message || "No fue posible verificar el código.",
      };
    }

    if (res.data?.sesionIniciada === false) {
      return {
        success: true,
        message:
          res.data?.message ||
          "Correo verificado correctamente. Ahora puedes iniciar sesión.",
      };
    }

    const user = toAuthUser(res.data.user as ApiUser);
    if (!user) {
      return {
        success: false,
        message: "Error al cargar los datos de tu cuenta verificada.",
      };
    }

    set({ currentUser: user, isAuthenticated: true });
    return {
      success: true,
      user,
      message: res.data?.message || "Correo verificado correctamente.",
    };
  },

  resendVerificationCode: async ({ username, email }) => {
    const res = await callApi("/api/auth/verify-email/resend", {
      method: "POST",
      body: {
        username: username?.trim().toLowerCase(),
        email: email?.trim().toLowerCase(),
      },
    });

    if (!res) return { success: false, message: NETWORK_ERROR };
    if (!res.ok) {
      return {
        success: false,
        message: res.data?.message || "No fue posible reenviar el código.",
        retryAfterSeconds:
          typeof res.data?.retryAfterSeconds === "number"
            ? res.data.retryAfterSeconds
            : undefined,
      };
    }

    return {
      success: true,
      message:
        res.data?.message ||
        "Hemos enviado un nuevo código de 6 dígitos a tu correo.",
      cooldownSeconds:
        typeof res.data?.cooldownSeconds === "number"
          ? res.data.cooldownSeconds
          : undefined,
      expiresInSeconds:
        typeof res.data?.expiresInSeconds === "number"
          ? res.data.expiresInSeconds
          : undefined,
    };
  },

  requestPasswordReset: async (email) => {
    const res = await callApi("/api/auth/password/forgot", {
      method: "POST",
      body: { email: email.trim().toLowerCase() },
    });

    if (!res) return { success: false, message: NETWORK_ERROR };
    if (!res.ok) {
      return {
        success: false,
        message:
          res.data?.message ||
          "No fue posible procesar la solicitud de recuperación.",
      };
    }

    return {
      success: true,
      message:
        res.data?.message ||
        "Si existe una cuenta compatible con esa dirección, recibirás un enlace para recuperar tu contraseña.",
    };
  },

  registerRepairer: async ({
    name,
    username,
    cedula,
    city,
    password,
    confirmPassword,
    specialty,
    documentFile,
  }) => {
    const formData = new FormData();
    formData.append("name", name.trim());
    formData.append("username", username.trim());
    formData.append("cedula", cedula.trim());
    formData.append("city", city.trim());
    formData.append("specialty", specialty);
    formData.append("password", password);
    formData.append("confirmPassword", confirmPassword);
    formData.append("document", documentFile);

    const res = await callApi("/api/auth/register/repairer", { method: "POST", formData });

    if (!res) return { success: false, message: NETWORK_ERROR };
    if (!res.ok) {
      return { success: false, message: res.data?.message || "Error al crear la cuenta de reparador." };
    }

    // La cuenta existe pero no se pudo abrir la sesión: debe iniciar sesión a mano
    if (res.data?.sesionIniciada === false) {
      return {
        success: false,
        message: res.data?.message || "Cuenta creada. Inicia sesión para continuar.",
      };
    }

    const user = toAuthUser(res.data.user as ApiUser);
    if (!user) return { success: false, message: "Error al crear la cuenta de reparador." };

    set({ currentUser: user, isAuthenticated: true });
    return { success: true, user };
  },

  logout: async () => {
    // La interfaz se limpia al instante; luego se cierra la sesión en el servidor.
    set({ currentUser: null, isAuthenticated: false });
    resetFixiStore();
    await callApi("/api/auth/logout", { method: "POST" });
  },
}));

if (typeof window !== "undefined") {
  // La versión anterior guardaba cuentas y contraseñas en texto plano en este
  // navegador: se borran para que no queden expuestas en localStorage.
  try {
    window.localStorage.removeItem("buildmeapp-auth-storage-v1");
  } catch {
    /* localStorage no disponible */
  }

  // Al cargar la app se consulta la sesión real una vez.
  void useAuthStore.getState().checkSession();
}