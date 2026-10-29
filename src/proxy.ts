import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Acceso con usuario y contrasena (HTTP Basic) para todo el sitio.
 *
 * La app no tiene login propio (un solo usuario, ver README), asi que esto es lo
 * unico que impide que cualquiera con la URL vea clientes, deudas y margenes.
 *
 *   BASIC_AUTH_USER      usuario (por defecto "demo")
 *   BASIC_AUTH_PASSWORD  contrasena
 *
 * En desarrollo, sin contrasena configurada, el sitio queda abierto. En
 * produccion, sin contrasena, se NIEGA el acceso: un deploy con la variable
 * olvidada no debe quedar publico.
 */
export function proxy(request: NextRequest) {
  const password = process.env.BASIC_AUTH_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Acceso no configurado: falta BASIC_AUTH_PASSWORD.", {
      status: 503,
    });
  }

  const usuario = process.env.BASIC_AUTH_USER || "demo";
  const credenciales = leerBasic(request.headers.get("authorization"));

  // Se comparan ambos campos siempre, para no revelar cual fallo ni cuanto tardo.
  const usuarioOk = igualesEnTiempoConstante(credenciales?.usuario ?? "", usuario);
  const passwordOk = igualesEnTiempoConstante(credenciales?.password ?? "", password);

  if (credenciales && usuarioOk && passwordOk) return NextResponse.next();

  return new NextResponse("Se requiere usuario y contrasena.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Ventas", charset="UTF-8"' },
  });
}

function leerBasic(cabecera: string | null): { usuario: string; password: string } | null {
  if (!cabecera) return null;
  const [esquema, valor] = cabecera.split(" ");
  if (esquema?.toLowerCase() !== "basic" || !valor) return null;

  try {
    const bytes = Uint8Array.from(atob(valor), (c) => c.charCodeAt(0));
    const texto = new TextDecoder().decode(bytes);
    const corte = texto.indexOf(":");
    if (corte < 0) return null;
    return { usuario: texto.slice(0, corte), password: texto.slice(corte + 1) };
  } catch {
    return null;
  }
}

function igualesEnTiempoConstante(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diferencia = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diferencia |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diferencia === 0;
}

export const config = {
  // Todo el sitio, salvo los archivos estaticos de Next y el icono.
  matcher: ["/((?!_next/static|_next/image|icon.svg).*)"],
};
