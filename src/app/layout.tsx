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
  // Sin maximumScale: bloquear el zoom por pellizco impide leer a quien ve poco (WCAG 1.4.4).
  // El zoom automatico de iOS al enfocar un input ya se evita con font-size: 16px.
  // Deja usar el area bajo la barra de inicio del iPhone (la barra inferior la respeta).
  viewportFit: "cover",
  themeColor: "#1a171a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const marca = await getMarca();

  return (
    <html lang="es-AR" className={inter.variable}>
      <body className="min-h-dvh font-sans">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-lg focus:bg-marca focus:px-3 focus:py-2 focus:font-semibold focus:text-tinta"
        >
          Saltar al contenido
        </a>
        <Navbar nombre={marca.nombre} logo={marca.logo} />

        <main id="contenido" className="mx-auto max-w-5xl px-4 pt-5 pb-32 md:pb-10">{children}</main>
      </body>
    </html>
  );
}
