import type { NextRequest } from "next/server";
import {
  handlers,
  isAuthSecretConfigured,
  isOAuthProviderConfigured,
} from "@/auth";

function extractOAuthActionProvider(pathname: string): string | null {
  const match = pathname.match(/\/api\/auth\/(?:signin|callback)\/([^/?#]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function buildErrorResponse(request: NextRequest, errorCode: string): Response {
  const errorUrl = new URL(`/?error=${encodeURIComponent(errorCode)}`, request.nextUrl.origin).toString();
  if (request.headers.has("X-Auth-Return-Redirect")) {
    return Response.json({ url: errorUrl });
  }
  return Response.redirect(errorUrl);
}

export async function GET(request: NextRequest) {
  const provider = extractOAuthActionProvider(request.nextUrl.pathname);

  if (provider && provider !== "google") {
    return buildErrorResponse(request, "InvalidProvider");
  }

  if (provider === "google" && !isOAuthProviderConfigured("google")) {
    return buildErrorResponse(request, "Configuration");
  }

  if (!isAuthSecretConfigured()) {
    return buildErrorResponse(request, "Configuration");
  }

  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  const provider = extractOAuthActionProvider(request.nextUrl.pathname);

  if (provider && provider !== "google") {
    return buildErrorResponse(request, "InvalidProvider");
  }

  if (provider === "google" && !isOAuthProviderConfigured("google")) {
    return buildErrorResponse(request, "Configuration");
  }

  if (!isAuthSecretConfigured()) {
    return buildErrorResponse(request, "Configuration");
  }

  return handlers.POST(request);
}
