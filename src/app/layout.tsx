import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Navbar } from "@/components/navbar";
import { getMarca } from "@/lib/marca";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { nombre } = await getMarca();
  return {
    title: { default: nombre, template: `%s · ${nombre}` },
    description: "Control de ventas, costos y cobranzas",
    applicationName: nombre,
    appleWebApp: { capable: true, title: nombre, statusBarStyle: "black" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // El dueño opera con una mano ocupada y guantes, no hago zoom al tocar.
  maximumScale: 1,
  // Deja usar el area bajo la barra de inicio del iPhone (la barra inferior la respeta).
  viewportFit: "cover",
  themeColor: "#1a171a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const marca = await getMarca();

  return (
    <html lang="es-AR" className={inter.variable}>
      <body className="min-h-dvh bg-slate-50 font-sans">
        <Navbar nombre={marca.nombre} logo={marca.logo} />

        <main className="mx-auto max-w-5xl px-4 pt-5 pb-32 md:pb-10">{children}</main>
      </body>
    </html>
  );
}
