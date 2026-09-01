import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fixi | Servicios del Hogar Bajo Demanda con IA",
  description:
    "Plataforma inteligente de servicios para el hogar. Diagnóstico con IA, cotización transparente sin sorpresas y seguimiento en vivo estilo Uber/Rappi.",
  applicationName: "Fixi App",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Fixi",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body className="h-full bg-slate-900 text-slate-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
