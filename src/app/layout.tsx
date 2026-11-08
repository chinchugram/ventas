import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, IBM_Plex_Mono } from "next/font/google";
import { Navbar } from "@/components/navbar";
import { MomentosProvider } from "@/components/momentos";
import { SonidoProvider } from "@/components/sonido";
import { getMarca } from "@/lib/marca";
import { usuarioActual } from "@/lib/auth";
import { modoActual } from "@/lib/modo-servidor";
import { ChatAyuda } from "@/components/chat-ayuda";
import { asistenteDisponible } from "@/lib/ayuda/asistente";
import "./globals.css";

// Tipografías de Kiwitt (docs/brand/tipografia.md), autoalojadas por next/font. Cada una deja su
// variable en <html>; globals.css las usa en --font-display, --font-sans y --font-mono.
const bricolage = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], variable: "--fuente-bricolage", display: "swap" });
const figtree = Figtree({ subsets: ["latin", "latin-ext"], variable: "--fuente-figtree", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--fuente-plex-mono",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { nombre } = await getMarca();
  return {
    title: { default: nombre, template: `%s · ${nombre}` },
    description: "Control de ventas, costos y cobranzas",
    applicationName: nombre,
    appleWebApp: { capable: true, title: nombre, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sin maximumScale: bloquear el zoom por pellizco impide leer a quien ve poco (WCAG 1.4.4).
  // El zoom automatico de iOS al enfocar un input ya se evita con font-size: 16px.
  // Deja usar el area bajo la barra de inicio del iPhone (la barra inferior la respeta).
  viewportFit: "cover",
  // Color de la barra del navegador: el papel (`surface`) de cada tema. Next no puede leer
  // variables CSS acá; si cambia `--surface` en globals.css, cambiar también estos dos.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff8ee" },
    { media: "(prefers-color-scheme: dark)", color: "#14201a" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Solo para pintar la navegacion: no protege nada (el layout no se vuelve a
  // ejecutar en las navegaciones del cliente). Protegen el proxy y cada pagina.
  const [marca, usuario, modo] = await Promise.all([getMarca(), usuarioActual(), modoActual()]);

  return (
    <html lang="es-AR" className={`${bricolage.variable} ${figtree.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-surface font-sans text-ink">
        <SonidoProvider>
          <MomentosProvider>
            <a
              href="#contenido"
              className="boton boton-primario sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70]"
            >
              Saltar al contenido
            </a>
            {/* Sin sesion (la pantalla de /login) no hay navegacion. Al cliente solo viajan nombre y rol. */}
            {usuario ? (
              <Navbar nombre={marca.nombre} logo={marca.logo} usuario={{ nombre: usuario.nombre, rol: usuario.rol }} modo={modo} />
            ) : null}

            <main id="contenido" className={`mx-auto max-w-page px-4 pt-6 ${usuario ? "pb-32 md:pb-10" : "pb-10"}`}>
              {children}
            </main>
            {/* Chat de ayuda: solo con sesion y con la clave de la API configurada. */}
            {usuario && asistenteDisponible() ? <ChatAyuda /> : null}
          </MomentosProvider>
        </SonidoProvider>
      </body>
    </html>
  );
}
