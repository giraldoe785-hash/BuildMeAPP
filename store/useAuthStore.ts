import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { AuthUser, ServiceCategoryId, UserRole, VerificationStatus } from "@/types";

export interface StoredUserAccount extends AuthUser {
  passwordHash: string; // Simulación de hash local en frontend
}

export interface AuthState {
  currentUser: AuthUser | null;
  isAuthenticated: boolean;
  registeredUsers: StoredUserAccount[];
  
  // Acciones de autenticación
  login: (username: string, password: string) => { success: boolean; message?: string; user?: AuthUser };
  registerClient: (data: {
    name: string;
    username: string;
    password: string;
    confirmPassword: string;
  }) => { success: boolean; message?: string; user?: AuthUser };
  registerRepairer: (data: {
    name: string;
    username: string;
    cedula: string;
    password: string;
    confirmPassword: string;
    specialty: ServiceCategoryId;
    documentFile?: { name: string; type: string; size: string };
  }) => { success: boolean; message?: string; user?: AuthUser };
  logout: () => void;
}

// Cuentas de demostración iniciales
const INITIAL_DEMO_ACCOUNTS: StoredUserAccount[] = [
  {
    id: "user-client-1",
    name: "Sofía Navarro",
    username: "cliente_demo",
    passwordHash: "123456",
    role: "client",
    createdAt: "2026-08-15",
  },
  {
    id: "user-repairer-1",
    name: "Carlos Mendoza",
    username: "reparador_demo",
    passwordHash: "123456",
    role: "repairer",
    cedula: "0928374615",
    specialty: "electricidad",
    documentName: "Certificacion_Tecnico_Electricista.pdf",
    documentType: "application/pdf",
    documentSize: "2.4 MB",
    verificationStatus: "pending",
    createdAt: "2026-08-20",
  },
];

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      isAuthenticated: false,
      registeredUsers: INITIAL_DEMO_ACCOUNTS,

      login: (username, password) => {
        const cleanUser = username.trim().toLowerCase();
        const users = get().registeredUsers;

        const foundUser = users.find(
          (u) => u.username.toLowerCase() === cleanUser && u.passwordHash === password
        );

        if (!foundUser) {
          return {
            success: false,
            message: "Nombre de usuario o contraseña incorrectos.",
          };
        }

        const safeUser: AuthUser = {
          id: foundUser.id,
          name: foundUser.name,
          username: foundUser.username,
          role: foundUser.role,
          cedula: foundUser.cedula,
          specialty: foundUser.specialty,
          documentName: foundUser.documentName,
          documentType: foundUser.documentType,
          documentSize: foundUser.documentSize,
          verificationStatus: foundUser.verificationStatus,
          createdAt: foundUser.createdAt,
        };

        set({
          currentUser: safeUser,
          isAuthenticated: true,
        });

        return {
          success: true,
          user: safeUser,
        };
      },

      registerClient: ({ name, username, password, confirmPassword }) => {
        const cleanName = name.trim();
        const cleanUser = username.trim().toLowerCase();

        // Validaciones
        if (!cleanName || !cleanUser || !password || !confirmPassword) {
          return { success: false, message: "Todos los campos son obligatorios." };
        }

        if (cleanUser.length < 3) {
          return { success: false, message: "El usuario debe tener al menos 3 caracteres." };
        }

        if (password.length < 4) {
          return { success: false, message: "La contraseña debe tener al menos 4 caracteres." };
        }

        if (password !== confirmPassword) {
          return { success: false, message: "Las contraseñas no coinciden." };
        }

        const users = get().registeredUsers;
        const exists = users.some((u) => u.username.toLowerCase() === cleanUser);
        if (exists) {
          return { success: false, message: "El nombre de usuario ya está registrado." };
        }

        const newAccount: StoredUserAccount = {
          id: `cli-${Date.now()}`,
          name: cleanName,
          username: cleanUser,
          passwordHash: password,
          role: "client",
          createdAt: new Date().toISOString().split("T")[0],
        };

        const safeUser: AuthUser = {
          id: newAccount.id,
          name: newAccount.name,
          username: newAccount.username,
          role: "client",
          createdAt: newAccount.createdAt,
        };

        set((state) => ({
          registeredUsers: [...state.registeredUsers, newAccount],
          currentUser: safeUser,
          isAuthenticated: true,
        }));

        return {
          success: true,
          user: safeUser,
        };
      },

      registerRepairer: ({
        name,
        username,
        cedula,
        password,
        confirmPassword,
        specialty,
        documentFile,
      }) => {
        const cleanName = name.trim();
        const cleanUser = username.trim().toLowerCase();
        const cleanCedula = cedula.trim();

        // Validaciones
        if (!cleanName || !cleanUser || !cleanCedula || !password || !confirmPassword || !specialty) {
          return { success: false, message: "Todos los campos son obligatorios." };
        }

        if (cleanCedula.length < 6) {
          return { success: false, message: "Ingresa un número de cédula válido." };
        }

        if (password.length < 4) {
          return { success: false, message: "La contraseña debe tener al menos 4 caracteres." };
        }

        if (password !== confirmPassword) {
          return { success: false, message: "Las contraseñas no coinciden." };
        }

        const users = get().registeredUsers;
        const exists = users.some((u) => u.username.toLowerCase() === cleanUser);
        if (exists) {
          return { success: false, message: "El nombre de usuario ya está registrado." };
        }

        const newAccount: StoredUserAccount = {
          id: `rep-${Date.now()}`,
          name: cleanName,
          username: cleanUser,
          cedula: cleanCedula,
          passwordHash: password,
          role: "repairer",
          specialty,
          documentName: documentFile?.name || "Certificado_Acreditacion.pdf",
          documentType: documentFile?.type || "application/pdf",
          documentSize: documentFile?.size || "1.8 MB",
          verificationStatus: "pending", // REGLA #9: Siempre pendiente, nunca verificado automáticamente
          createdAt: new Date().toISOString().split("T")[0],
        };

        const safeUser: AuthUser = {
          id: newAccount.id,
          name: newAccount.name,
          username: newAccount.username,
          cedula: newAccount.cedula,
          role: "repairer",
          specialty: newAccount.specialty,
          documentName: newAccount.documentName,
          documentType: newAccount.documentType,
          documentSize: newAccount.documentSize,
          verificationStatus: "pending",
          createdAt: newAccount.createdAt,
        };

        set((state) => ({
          registeredUsers: [...state.registeredUsers, newAccount],
          currentUser: safeUser,
          isAuthenticated: true,
        }));

        return {
          success: true,
          user: safeUser,
        };
      },

      logout: () => {
        set({
          currentUser: null,
          isAuthenticated: false,
        });
      },
    }),
    {
      name: "buildmeapp-auth-storage-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentUser: state.currentUser,
        isAuthenticated: state.isAuthenticated,
        registeredUsers: state.registeredUsers,
      }),
    }
  )
);
