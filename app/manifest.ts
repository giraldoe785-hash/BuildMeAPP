import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fixi - Servicios del Hogar Bajo Demanda con IA",
    short_name: "Fixi",
    description: "Plataforma de diagnóstico con IA y servicios para el hogar bajo demanda con seguimiento en tiempo real y garantía FixiCare.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#059669",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
