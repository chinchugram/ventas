/**
 * Humo posterior a migrar (VTA-21): con el rol de la APP (`ventas_app`, sujeto a RLS) comprueba que
 * un negocio ya migrado sigue andando: el dueño entra con su negocio, una venta se registra y los
 * totales que ve la app coinciden con los de la reconciliacion. Solo contra Postgres LOCAL.
 *
 *   DATABASE_URL="postgresql://ventas_app:ventas_app@localhost:5477/BASE?host=/tmp/pgsock7" \
 *   SMOKE_NEGOCIO=hl-laser SMOKE_USUARIO=dueno SMOKE_CLAVE='...' \
 *   [SMOKE_ESPERADO_VENTAS=3 SMOKE_ESPERADO_TOTAL_BRUTO=4235.0000] \
 *   npx tsx scripts/smoke-despliegue.ts
 *
 * Lo que hace (nada queda en la base: la sesion se cierra y la venta se deshace):
 *   1. login por negocio + usuario + clave, y la sesion se resuelve desde su cookie `<negocioId>.<token>`;
 *   2. una cookie con la forma ANTERIOR al multi-tenant (solo el token) ya no vale: esas sesiones
 *      obligan a entrar de nuevo, ahora eligiendo el negocio;
 *   3. dentro de `conNegocio`: cuenta las ventas del negocio y suma `totalBruto` (si se pasaron
 *      SMOKE_ESPERADO_*, tienen que coincidir con lo medido antes de migrar);
 *   4. registra una venta de punta a punta (precio, IVA, costo, stock) y la deshace.
 *
 * El rol de la conexion no puede ser superusuario ni tener BYPASSRLS (si no, no probaria RLS).
 * La clave del usuario es la real de la base: no se imprime.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { conNegocio } from "../src/lib/negocio";
import { cerrarSesion, iniciarSesion, resolverSesion } from "../src/lib/dominio/auth";
import { registrarVentaEnTx } from "../src/lib/dominio/ventas";
import { d } from "../src/lib/money";

function esLocal(url: string): boolean {
  try {
    const u = new URL(url);
    const socket = u.searchParams.get("host");
    if (socket) return socket.startsWith("/");
    return ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(u.hostname);
  } catch {
    return false;
  }
}

const url = process.env.DATABASE_URL ?? "";
if (!url || !esLocal(url)) {
  console.error("Este humo solo corre contra Postgres local (DATABASE_URL con localhost o socket unix). Nunca contra Neon.");
  process.exit(1);
}
const slug = process.env.SMOKE_NEGOCIO ?? "";
const usuario = process.env.SMOKE_USUARIO ?? "";
const clave = process.env.SMOKE_CLAVE ?? "";
if (!slug || !usuario || !clave) {
  console.error("Faltan SMOKE_NEGOCIO, SMOKE_USUARIO y SMOKE_CLAVE.");
  process.exit(1);
}

let fallos = 0;
function comprobar(ok: boolean, etiqueta: string, detalle = "") {
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK   " : "FALLA"} ${etiqueta}${detalle ? ` (${detalle})` : ""}`);
}

class Deshacer extends Error {}

async function main() {
  const rol = (await prisma.$queryRaw<{ rolname: string; omite: boolean }[]>`
    SELECT rolname, (rolsuper OR rolbypassrls) AS omite FROM pg_roles WHERE rolname = current_user`)[0];
  comprobar(rol !== undefined && !rol.omite, "el rol de la app no se salta RLS", rol?.rolname);

  // 1. Login y sesion.
  const login = await iniciarSesion(prisma, slug, usuario, clave);
  comprobar(login.ok, `login de ${usuario} en el negocio ${slug}`);
  if (!login.ok || login.negocio === null) throw new Error("sin login no se sigue");
  const negocioId = login.negocio.id;
  try {
    const resuelta = await resolverSesion(prisma, login.valorCookie);
    comprobar(resuelta?.usuario.negocioId === negocioId, "la cookie <negocioId>.<token> resuelve la sesion del negocio");

    // 2. Cookie anterior al multi-tenant (solo el token): no vale.
    const viejaResuelta = await resolverSesion(prisma, login.token);
    comprobar(viejaResuelta === null, "una cookie con la forma anterior (solo el token) ya no abre sesion");

    // 3 y 4. Totales y una venta, con el contexto del negocio. La venta se deshace lanzando al final:
    // `conNegocio` hace rollback si `fn` lanza, asi que NO se captura adentro.
    try {
      await conNegocio(negocioId, async (tx) => {
        const agregado = await tx.venta.aggregate({ _count: { _all: true }, _sum: { totalBruto: true } });
        const ventas = agregado._count._all;
        const total = agregado._sum.totalBruto?.toFixed(4) ?? "0.0000";
        console.log(`INFO ventas visibles para la app: ${ventas}; suma de totalBruto: ${total}`);
        const esperadoVentas = process.env.SMOKE_ESPERADO_VENTAS;
        const esperadoTotal = process.env.SMOKE_ESPERADO_TOTAL_BRUTO;
        if (esperadoVentas !== undefined) comprobar(String(ventas) === esperadoVentas, "cantidad de ventas igual a la de antes de migrar", `${ventas} vs ${esperadoVentas}`);
        if (esperadoTotal !== undefined) comprobar(total === d(esperadoTotal).toFixed(4), "suma de totalBruto igual a la de antes de migrar", `${total} vs ${esperadoTotal}`);

        const cliente = await tx.cliente.findFirst({ where: { activo: true }, orderBy: { nombre: "asc" } });
        const articulo = await tx.articulo.findFirst({ where: { activo: true }, orderBy: { nombre: "asc" } });
        if (!cliente || !articulo) {
          comprobar(false, "hay un cliente y un articulo activos para probar una venta");
          return;
        }
        const r = await registrarVentaEnTx(tx, negocioId, {
          clienteId: cliente.id,
          fecha: new Date(),
          observaciones: "humo de despliegue (se deshace)",
          entregada: false,
          items: [{ articuloId: articulo.id, cantidad: d(1) }],
          pago: null,
          usuarioId: login.usuario.id,
        });
        comprobar(r.numero > 0 && r.totalBruto.gt(0), "una venta se registra con numero y total", `venta ${r.anio}-${r.numero}, total ${r.totalBruto.toFixed(2)}`);
        throw new Deshacer();
      });
    } catch (e) {
      if (!(e instanceof Deshacer)) throw e;
    }
  } finally {
    await cerrarSesion(prisma, login.valorCookie);
  }
}

main()
  .catch((e) => {
    fallos += 1;
    console.error("FALLA inesperada:", e instanceof Error ? e.message : e);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(fallos === 0 ? "\nHUMO OK" : `\nHUMO CON ${fallos} FALLA(S)`);
    process.exit(fallos === 0 ? 0 : 1);
  });
