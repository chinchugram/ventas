import type { Metadata, Viewport } from "next";
import { Navbar } from "@/components/navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ventas",
    template: "%s · Ventas",
  },
  description: "Control de ventas, costos y cobranzas",
  appleWebApp: { capable: true, title: "Ventas", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // El dueño opera con una mano ocupada y guantes, no hago zoom al tocar.
  maximumScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="min-h-dvh bg-slate-50">
        <Navbar />

        <main className="mx-auto max-w-5xl px-4 pt-4 pb-24">{children}</main>
      </body>
    </html>
  );
}
