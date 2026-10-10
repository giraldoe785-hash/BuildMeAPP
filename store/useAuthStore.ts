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
  perfilReparador?: { nombres: string; apellidos: string; numeroDocumento?: string } | null;
}

function toAuthUser(api: ApiUser): AuthUser | null {
  if (api.rol === "ADMINISTRADOR") return null; // esta app no tiene vista de administrador

  const perfil = api.rol === "REPARADOR" ? api.perfilReparador : api.perfilCliente;
  const fullName = perfil ? `${perfil.nombres} ${perfil.apellidos}`.trim() : "";
  const createdAt = (api.creadoEn ?? "").slice(0, 10);

  if (api.rol === "REPARADOR") {
    return {
      id: api.id,
      name: fullName || api.nombreUsuario,
      username: api.nombreUsuario,
      role: "repairer",
      cedula: api.perfilReparador?.numeroDocumento,
      verificationStatus:
        api.estado === "VERIFICADO" ? "approved" : api.estado === "RECHAZADO" ? "rejected" : "pending",
      createdAt,
      // specialty, documentName, documentSize: llegarán cuando exista el
      // endpoint de registro/consulta de reparadores.
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

export type AuthResult = { success: boolean; message?: string; user?: AuthUser };

const NETWORK_ERROR = "Error de conexión. Verifica tu conexión a internet e intenta de nuevo.";

async function callApi(
  url: string,
  options: { method: "GET" | "POST"; body?: unknown }
): Promise<{ ok: boolean; status: number; data: any } | null> {
  try {
    const res = await fetch(url, {
      method: options.method,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
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
    username: string;
    password: string;
    confirmPassword: string;
  }) => Promise<AuthResult>;
  registerRepairer: (data: {
    name: string;
    username: string;
    cedula: string;
    password: string;
    confirmPassword: string;
    specialty: ServiceCategoryId;
    documentFile?: { name: string; type: string; size: string };
  }) => { success: boolean; message?: string; user?: AuthUser };
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
      return { success: false, message: res.data?.message || "No fue posible iniciar sesión." };
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

  registerClient: async ({ name, username, password, confirmPassword }) => {
    const res = await callApi("/api/auth/register/client", {
      method: "POST",
      body: { name: name.trim(), username: username.trim(), password, confirmPassword },
    });

    if (!res) return { success: false, message: NETWORK_ERROR };
    if (!res.ok) {
      return { success: false, message: res.data?.message || "Error al crear la cuenta." };
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

  // El backend de registro de reparadores todavía no existe (necesita decidir
  // dónde guardar los documentos de acreditación). Misma firma que antes para
  // que RegisterRepairerForm siga compilando.
  registerRepairer: () => ({
    success: false,
    message:
      "El registro de reparadores aún no está disponible. Por ahora puedes crear una cuenta de cliente.",
  }),

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