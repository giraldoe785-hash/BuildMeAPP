"use server";

import { cookies } from "next/headers";
import {
  OAUTH_ROLE_COOKIE,
  isAuthSecretConfigured,
  isGoogleCredentialsConfigured,
  isOAuthProviderConfigured,
  signIn,
  type OAuthProviderId,
} from "@/auth";

export type StartOAuthResult =
  | { success: true; url: string }
  | { success: false; message: string };

export async function iniciarOAuth(
  provider: string,
  role: string = "CLIENTE"
): Promise<StartOAuthResult> {
  if (provider !== "google") {
    return {
      success: false,
      message: "Actualmente solo está habilitado el inicio de sesión con Google.",
    };
  }

  const typedProvider: OAuthProviderId = provider;

  if (role !== "CLIENTE" && role !== "REPARADOR") {
    return {
      success: false,
      message: "El rol seleccionado no es válido.",
    };
  }

  if (!isAuthSecretConfigured()) {
    return {
      success: false,
      message:
        "Falta configurar la variable de entorno AUTH_SECRET en el servidor antes de iniciar sesión con Google.",
    };
  }

  if (!isGoogleCredentialsConfigured() || !isOAuthProviderConfigured(typedProvider)) {
    return {
      success: false,
      message:
        "El inicio de sesión con Google aún no está configurado en el servidor. Verifica AUTH_GOOGLE_ID y AUTH_GOOGLE_SECRET.",
    };
  }

  try {
    const cookieStore = await cookies();
    cookieStore.set({
      name: OAUTH_ROLE_COOKIE,
      value: role,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10, // 10 minutos para completar el flujo OAuth
    });

    const redirectUrl = await signIn(typedProvider, {
      redirect: false,
      redirectTo: "/",
    });

    if (typeof redirectUrl !== "string" || !redirectUrl) {
      return {
        success: false,
        message: "No fue posible iniciar la redirección a Google.",
      };
    }

    return {
      success: true,
      url: redirectUrl,
    };
  } catch (error) {
    console.error("Error al iniciar flujo OAuth con Google:", error);
    return {
      success: false,
      message:
        "No fue posible conectar con Google. Intenta de nuevo.",
    };
  }
}
