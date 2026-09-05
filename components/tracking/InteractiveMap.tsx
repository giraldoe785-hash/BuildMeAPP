"use client";

import React, { useEffect, useState } from "react";
import {
  APIProvider,
  Map,
  Marker,
} from "@vis.gl/react-google-maps";
import { useFixiStore } from "@/store/useFixiStore";
import { Layers, MapPin } from "lucide-react";

const DEFAULT_CENTER = {
  lat: 19.3734,
  lng: -99.1798,
};

export const InteractiveMap: React.FC = () => {
  const { activeOrder } = useFixiStore();

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  /*
   * IMPORTANTE:
   * El hook siempre se ejecuta antes de cualquier return.
   */
  const [techPosProgress, setTechPosProgress] = useState(0.2);

  useEffect(() => {
    if (activeOrder?.status !== "on_the_way") {
      setTechPosProgress(0.2);
      return;
    }

    const interval = setInterval(() => {
      setTechPosProgress((prev) =>
        prev >= 0.85 ? 0.2 : prev + 0.05
      );
    }, 2500);

    return () => clearInterval(interval);
  }, [activeOrder?.status]);

  console.log(
    "[BuildMeApp] Google Maps API Key configurada:",
    Boolean(apiKey)
  );

  const destination = {
    lat: activeOrder?.location?.lat ?? DEFAULT_CENTER.lat,
    lng: activeOrder?.location?.lng ?? DEFAULT_CENTER.lng,
  };

  /*
   * Posición simulada del técnico.
   * Esto NO es GPS real todavía.
   */
  const technicianPosition = {
    lat: destination.lat + 0.01 - techPosProgress * 0.01,
    lng: destination.lng - 0.012 + techPosProgress * 0.012,
  };

  const vehicleType =
    activeOrder?.technician?.vehicle?.type ?? "Moto";

  if (!apiKey) {
    return (
      <div className="relative w-full h-[360px] bg-slate-900 flex items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <MapPin className="w-10 h-10 mx-auto text-red-400 mb-3" />

          <p className="text-white font-bold text-sm">
            No se encontró la API Key de Google Maps
          </p>

          <p className="text-slate-400 text-xs mt-2 leading-relaxed">
            Verifica que tu archivo .env.local tenga:
          </p>

          <code className="block mt-2 text-emerald-400 text-[11px] break-all">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
          </code>

          <p className="text-slate-500 text-[10px] mt-3">
            Reinicia npm run dev después de modificar .env.local.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[360px] overflow-hidden bg-slate-900 select-none">

      <APIProvider
        apiKey={apiKey}
        onLoad={() => {
          console.log(
            "[BuildMeApp] Google Maps JavaScript API cargada correctamente."
          );
          setMapLoaded(true);
        }}
        onError={(error) => {
          console.error(
            "[BuildMeApp] Error cargando Google Maps:",
            error
          );

          setMapError(
            error instanceof Error
              ? error.message
              : "Error desconocido al cargar Google Maps"
          );
        }}
      >
        <Map
          defaultCenter={destination}
          defaultZoom={14}
          gestureHandling="greedy"
          disableDefaultUI={false}
          clickableIcons={false}
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          zoomControl={true}
          style={{
            width: "100%",
            height: "100%",
          }}
        >
          {/* Domicilio */}
          <Marker
            position={destination}
            title={
              activeOrder?.location?.name ??
              "Tu domicilio"
            }
          />

          {/* Técnico simulado */}
          {activeOrder?.status === "on_the_way" && (
            <Marker
              position={technicianPosition}
              title={`Técnico en ${vehicleType}`}
              label={{
                text:
                  vehicleType === "Moto"
                    ? "🏍️"
                    : "🚐",
                fontSize: "22px",
              }}
            />
          )}

          {/* Técnico en sitio */}
          {(activeOrder?.status === "in_progress" ||
            activeOrder?.status === "completed") && (
            <Marker
              position={destination}
              title="Técnico en el sitio"
              label={{
                text: "🛠️",
                fontSize: "22px",
              }}
            />
          )}
        </Map>
      </APIProvider>

      {/* Estado superior */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">

        <div className="bg-slate-900/85 backdrop-blur-md text-white px-3 py-1.5 rounded-xl border border-slate-700 shadow-md flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />

          <span className="text-[10px] font-mono">
            {mapLoaded
              ? "Google Maps Activo"
              : "Cargando Google Maps..."}
          </span>
        </div>

        <div className="bg-slate-900/85 backdrop-blur-md text-white px-2.5 py-1.5 rounded-xl border border-slate-700 shadow-md flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-emerald-400" />

          <span className="text-[10px]">
            Mapa Google
          </span>
        </div>
      </div>

      {/* Error visible en pantalla */}
      {mapError && (
        <div className="absolute bottom-3 left-3 right-3 z-30">
          <div className="bg-red-950/95 border border-red-500/40 text-red-100 text-[10px] px-3 py-2 rounded-xl shadow-xl">
            <strong>Error Google Maps:</strong>{" "}
            {mapError}
          </div>
        </div>
      )}

      {/* Estado de ubicación */}
      <div className="absolute bottom-4 left-4 z-20 pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-md text-white px-3 py-2 rounded-xl border border-slate-700 shadow-lg">
          <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">
            Destino
          </p>

          <p className="text-[11px] font-bold mt-0.5">
            {activeOrder?.location?.name ??
              "Tu domicilio"}
          </p>
        </div>
      </div>

    </div>
  );
};

