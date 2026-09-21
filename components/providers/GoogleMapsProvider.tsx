"use client";

import React from "react";
import { APIProvider } from "@vis.gl/react-google-maps";

const GOOGLE_MAPS_LIBRARIES: ("marker" | "geocoding")[] = ["marker", "geocoding"];

/**
 * Proveedor global único de Google Maps para toda la aplicación.
 * Envuelve la app con APIProvider para evitar cargas duplicadas del SDK.
 */
export const GoogleMapsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    // Sin API Key, renderizar children sin provider.
    // Los componentes hijos manejan individualmente su fallback visual.
    return <>{children}</>;
  }

  return (
    <APIProvider apiKey={apiKey} libraries={GOOGLE_MAPS_LIBRARIES}>
      {children}
    </APIProvider>
  );
};
