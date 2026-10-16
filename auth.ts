import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ProveedorOAuth, Prisma } from "./generated/prisma/client";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OAUTH_ROLE_COOKIE = "buildmeapp_oauth_role";

const EMAIL_MAX_LENGTH = 150;
const USERNAME_MAX_LENGTH = 50;
const NAME_MAX_LENGTH = 100;
const PROVIDER_ACCOUNT_MAX_LENGTH = 255;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-z0-9_.]{3,50}$/;

export type OAuthProviderId = "google";
export type AllowedOAuthRole = "CLIENTE" | "REPARADOR";

export function isAuthSecretConfigured(): boolean {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  return Boolean(secret && secret.trim().length > 0);
}

export function isGoogleCredentialsConfigured(): boolean {
  return Boolean(
    process.env.AUTH_GOOGLE_ID?.trim() &&
      process.env.AUTH_GOOGLE_SECRET?.trim()
  );
}

export function isOAuthProviderConfigured(provider: string): boolean {
  if (!isAuthSecretConfigured()) return false;

  if (provider === "google") {
    return isGoogleCredentialsConfigured();
  }

  // Nota: Microsoft Entra ID ("microsoft-entra-id") queda reservado para una fase posterior
  // cuando se configuren AUTH_MICROSOFT_ENTRA_ID_ID y AUTH_MICROSOFT_ENTRA_ID_SECRET.
  return false;
}

function mapProviderToEnum(providerId: string): ProveedorOAuth | null {
  if (providerId === "google") return ProveedorOAuth.GOOGLE;
  // Fase futura: cuando se habilite Microsoft Entra ID, mapear "microsoft-entra-id" -> ProveedorOAuth.MICROSOFT_ENTRA_ID
  return null;
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (
    !trimmed ||
    trimmed.length > EMAIL_MAX_LENGTH ||
    !EMAIL_REGEX.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function extractNamesFromProfile(
  profile: Record<string, unknown> | undefined,
  fallbackName: string | null | undefined,
  email: string
): { nombres: string; apellidos: string } {
  const givenName =
    typeof profile?.given_name === "string" ? profile.given_name.trim() : "";
  const familyName =
    typeof profile?.family_name === "string" ? profile.family_name.trim() : "";

  if (givenName || familyName) {
    const nombres = (givenName || email.split("@")[0] || "Usuario").slice(
      0,
      NAME_MAX_LENGTH
    );
    const apellidos = familyName.slice(0, NAME_MAX_LENGTH);
    return { nombres, apellidos };
  }

  const rawFullName =
    (typeof profile?.name === "string" ? profile.name.trim() : "") ||
    (typeof fallbackName === "string" ? fallbackName.trim() : "");

  if (rawFullName) {
    const parts = rawFullName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return {
        nombres: parts[0].slice(0, NAME_MAX_LENGTH),
        apellidos: "",
      };
    }
    const apellidosCount = parts.length >= 4 ? 2 : 1;
    const nombres = parts
      .slice(0, -apellidosCount)
      .join(" ")
      .slice(0, NAME_MAX_LENGTH);
    const apellidos = parts
      .slice(-apellidosCount)
      .join(" ")
      .slice(0, NAME_MAX_LENGTH);
    return { nombres, apellidos };
  }

  return {
    nombres: (email.split("@")[0] || "Usuario").slice(0, NAME_MAX_LENGTH),
    apellidos: "",
  };
}

function buildBaseUsername(email: string): string {
  const localPart = email.split("@")[0] ?? "usuario";
  let sanitized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[_.]+|[_.]+$/g, "");

  if (sanitized.length < 3) {
    sanitized = `${sanitized || "user"}_fx`;
  }

  if (sanitized.length > 40) {
    sanitized = sanitized.slice(0, 40).replace(/[_.]+$/g, "");
  }

  if (!USERNAME_REGEX.test(sanitized)) {
    sanitized = "usuario_fx";
  }

  return sanitized;
}

async function generateUniqueUsername(
  tx: Prisma.TransactionClient,
  baseUsername: string
): Promise<string> {
  const existingBase = await tx.usuario.findUnique({
    where: { nombreUsuario: baseUsername },
    select: { id: true },
  });

  if (!existingBase) {
    return baseUsername;
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomBytes(3).toString("hex");
    const candidate = `${baseUsername.slice(0, USERNAME_MAX_LENGTH - 7)}_${suffix}`;
    const collision = await tx.usuario.findUnique({
      where: { nombreUsuario: candidate },
      select: { id: true },
    });
    if (!collision) {
      return candidate;
    }
  }

  throw new Error("No fue posible generar un nombre de usuario único.");
}

async function consumeIntendedRoleCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const rawRole = cookieStore.get(OAUTH_ROLE_COOKIE)?.value ?? null;
    if (rawRole !== null) {
      cookieStore.set({
        name: OAUTH_ROLE_COOKIE,
        value: "",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: new Date(0),
        maxAge: 0,
      });
    }
    return rawRole;
  } catch {
    return null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: {
    signIn: "/",
    error: "/",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    // MicrosoftEntraID se reactivará en una fase posterior cuando se configure Azure App Registration.
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      const intendedRoleRaw = await consumeIntendedRoleCookie();

      if (!account || !account.provider) {
        return "/?error=InvalidProvider";
      }

      const proveedor = mapProviderToEnum(account.provider);
      if (!proveedor) {
        return "/?error=InvalidProvider";
      }

      const proveedorAccountId =
        typeof account.providerAccountId === "string"
          ? account.providerAccountId.trim()
          : "";

      if (
        !proveedorAccountId ||
        proveedorAccountId.length > PROVIDER_ACCOUNT_MAX_LENGTH
      ) {
        return "/?error=OAuthProfileInvalid";
      }

      const profileRecord = profile as Record<string, unknown> | undefined;

      // En Google se exige explícitamente que el correo esté verificado por el proveedor
      if (
        proveedor === ProveedorOAuth.GOOGLE &&
        profileRecord?.email_verified !== true
      ) {
        return "/?error=EmailNotVerified";
      }

      const rawEmail = profileRecord?.email ?? user?.email;

      const emailNormalizado = normalizeEmail(rawEmail);
      if (!emailNormalizado) {
        return "/?error=EmailMissing";
      }

      try {
        // 1. Buscar identidad externa existente por (proveedor, proveedorAccountId)
        const identidadExistente = await prisma.identidadOAuth.findUnique({
          where: {
            proveedor_proveedorAccountId: {
              proveedor,
              proveedorAccountId,
            },
          },
          include: {
            usuario: true,
          },
        });

        if (identidadExistente) {
          const usuarioExistente = identidadExistente.usuario;

          // Respetar bloqueo temporal si la cuenta está bloqueada
          if (
            usuarioExistente.bloqueadoHasta &&
            usuarioExistente.bloqueadoHasta.getTime() > Date.now()
          ) {
            return "/?error=AccountLocked";
          }

          // Rechazar cuentas suspendidas
          if (usuarioExistente.estado === "SUSPENDIDO") {
            return "/?error=AccountSuspended";
          }

          // Nunca permitir acceso ni asignar rol ADMINISTRADOR mediante OAuth
          if (usuarioExistente.rol === "ADMINISTRADOR") {
            return "/?error=AdminNotAllowed";
          }

          if (
            usuarioExistente.intentosFallidosLogin > 0 ||
            usuarioExistente.bloqueadoHasta
          ) {
            await prisma.usuario.update({
              where: { id: usuarioExistente.id },
              data: { intentosFallidosLogin: 0, bloqueadoHasta: null },
            });
          }

          // Emitir sesión oficial de BuildMeAPP (cookie buildmeapp_session + SesionUsuario)
          await createSession(usuarioExistente.id);
          return true;
        }

        // 2. La identidad externa es nueva: verificar si el correo ya pertenece a otra cuenta
        const cuentaConMismoCorreo = await prisma.usuario.findUnique({
          where: { email: emailNormalizado },
          select: { id: true },
        });

        if (cuentaConMismoCorreo) {
          // No vincular automáticamente por coincidencia de correo
          return "/?error=OAuthAccountNotLinked";
        }

        // 3. Validar rol solicitado para cuenta nueva (por defecto CLIENTE)
        const rolElegido = intendedRoleRaw ?? "CLIENTE";
        if (rolElegido !== "CLIENTE" && rolElegido !== "REPARADOR") {
          return "/?error=InvalidRole";
        }

        // No crear perfiles de reparador incompletos: PerfilReparador exige documento de
        // identidad único, ciudad de cobertura y documentos de acreditación.
        if (rolElegido === "REPARADOR") {
          return "/?error=RepairerRegistrationUnavailable";
        }

        const { nombres, apellidos } = extractNamesFromProfile(
          profileRecord,
          user?.name,
          emailNormalizado
        );
        const baseUsername = buildBaseUsername(emailNormalizado);

        const nuevoUsuario = await prisma.$transaction(async (tx) => {
          const nombreUsuario = await generateUniqueUsername(tx, baseUsername);

          return tx.usuario.create({
            data: {
              email: emailNormalizado,
              nombreUsuario,
              passwordHash: null,
              rol: "CLIENTE",
              estado: "PENDIENTE_VERIFICACION",
              perfilCliente: {
                create: {
                  nombres,
                  apellidos,
                },
              },
              identidadesOAuth: {
                create: {
                  proveedor,
                  proveedorAccountId,
                  correoProveedor: emailNormalizado,
                },
              },
            },
          });
        });

        await createSession(nuevoUsuario.id);
        return true;
      } catch (error) {
        console.error("Error en callback OAuth de BuildMeAPP:", error);
        if ((error as { code?: string })?.code === "P2002") {
          return "/?error=OAuthAccountNotLinked";
        }
        return "/?error=OAuthCallbackError";
      }
    },

    async jwt() {
      // Devuelve null para que Auth.js limpie/invalide su cookie de sesión auxiliar
      // tras haber emitido la sesión nativa buildmeapp_session en PostgreSQL.
      return null;
    },
  },
});
