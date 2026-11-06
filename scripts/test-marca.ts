/**
 * Prueba la marca por negocio (F4.2) contra Postgres real, sin Next.
 *
 *   MIGRADOR_URL=postgresql://ventas_migrador:...  npx tsx scripts/test-marca.ts
 *   (DATABASE_URL = rol ventas_app: es el que usa la app y el que RIGE RLS)
 *
 * La siembra y la limpieza usan un cliente propio con el rol de migracion (`MIGRADOR_URL`, o
 * `DATABASE_URL_MIGRACIONES`); las lecturas y escrituras de la marca van por el camino de la
 * app (`conNegocio`, rol `ventas_app` con RLS). Crea dos negocios de prueba y los borra al final.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { conNegocio } from "../src/lib/negocio";
import { getMarcaPorSlug, guardarLogoEnTx, leerLogoPorSlug, MARCA_NEUTRA, quitarLogoEnTx } from "../src/lib/marca";
import { validarLogo } from "../src/lib/marca-pura";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const urlMigrador = process.env.MIGRADOR_URL ?? process.env.DATABASE_URL_MIGRACIONES;
if (!urlMigrador) throw new Error("Falta MIGRADOR_URL o DATABASE_URL_MIGRACIONES (rol con BYPASSRLS para sembrar).");
const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlMigrador }) });

const SLUG_A = "marca-prueba-a";
const SLUG_B = "marca-prueba-b";
const SLUG_C = "marca-prueba-c";
const SLUG_D = "marca-prueba-d";

const png = new Uint8Array(readFileSync("public/marca/logo.png"));
const svgA = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0a0"/></svg>',
);
const svgB = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#00a"/></svg>',
);

function logoValido(bytes: Uint8Array) {
  const r = validarLogo(bytes);
  if (!r.ok) throw new Error(r.error);
  return r.logo;
}
const igual = (a: Uint8Array | undefined, b: Uint8Array) => (a && a.length === b.length && a.every((x, i) => x === b[i]) ? "igual" : "distinto");

async function limpiar() {
  const negocios = await admin.negocio.findMany({ where: { slug: { in: [SLUG_A, SLUG_B, SLUG_C, SLUG_D] } }, select: { id: true } });
  const ids = negocios.map((n) => n.id);
  await admin.configuracion.deleteMany({ where: { negocioId: { in: ids } } });
  await admin.negocio.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpiar();
  const a = await admin.negocio.create({ data: { nombre: "Alfa Muebles", slug: SLUG_A } });
  const b = await admin.negocio.create({ data: { nombre: "Beta Grafica", slug: SLUG_B } });
  const c = await admin.negocio.create({ data: { nombre: "Gamma Inactivo", slug: SLUG_C, activo: false } });
  // El "negocio inicial": su logo de siempre vive en Negocio.logoUrl (como HL Laser tras la migracion).
  await admin.negocio.create({ data: { nombre: "Inicial Laser", slug: SLUG_D, logoUrl: "/marca/logo.png" } });

  try {
    console.log("--- Sin logo: nombre propio e iniciales ---");
    let ma = await getMarcaPorSlug(SLUG_A);
    comprobar("A: nombre", ma.nombre, "Alfa Muebles");
    comprobar("A: sin logo", String(ma.logo), "null");
    comprobar("A: iniciales", ma.iniciales, "AM");
    const mb0 = await getMarcaPorSlug(SLUG_B);
    comprobar("B: nombre", mb0.nombre, "Beta Grafica");

    console.log("--- Slug que no sirve: marca neutra, sin distinguir causas ---");
    for (const [etiqueta, slug] of [
      ["inexistente", "no-existe-xyz"],
      ["inactivo", SLUG_C],
      ["reservado", "admin"],
      ["mal formado", "a b"],
      ["vacío", ""],
      ["inyección", "x'; drop table negocios;--"],
    ] as const) {
      const m = await getMarcaPorSlug(slug);
      comprobar(`${etiqueta}`, String(m === MARCA_NEUTRA), "true");
    }
    comprobar("neutra: sin nombre de negocio", MARCA_NEUTRA.nombre, "Ventas");

    console.log("--- El nombre de la configuracion manda sobre Negocio.nombre ---");
    await conNegocio(a.id, (tx) =>
      tx.configuracion.upsert({
        where: { negocioId_clave: { negocioId: a.id, clave: "nombreNegocio" } },
        update: { valor: "  Alfa Muebles SRL " },
        create: { negocioId: a.id, clave: "nombreNegocio", valor: "  Alfa Muebles SRL " },
      }),
    );
    comprobar("A: nombre de configuracion recortado", (await getMarcaPorSlug(SLUG_A)).nombre, "Alfa Muebles SRL");
    comprobar("B: no cambia", (await getMarcaPorSlug(SLUG_B)).nombre, "Beta Grafica");

    console.log("--- Cada negocio con su logo ---");
    const versionA = await conNegocio(a.id, (tx) => guardarLogoEnTx(tx, a.id, logoValido(png)));
    const versionB = await conNegocio(b.id, (tx) => guardarLogoEnTx(tx, b.id, logoValido(svgB)));
    ma = await getMarcaPorSlug(SLUG_A);
    const mb = await getMarcaPorSlug(SLUG_B);
    comprobar("A: URL con su slug y su versión", String(ma.logo), `/marca/logo/${SLUG_A}?v=${versionA}`);
    comprobar("B: URL con su slug y su versión", String(mb.logo), `/marca/logo/${SLUG_B}?v=${versionB}`);
    comprobar("A: tipo", String(ma.logoTipo), "image/png");
    comprobar("B: tipo", String(mb.logoTipo), "image/svg+xml");
    comprobar("las versiones difieren", String(versionA !== versionB), "true");
    const la = await leerLogoPorSlug(SLUG_A);
    const lb = await leerLogoPorSlug(SLUG_B);
    comprobar("A sirve su PNG", igual(la?.bytes, png), "igual");
    comprobar("B sirve su SVG", igual(lb?.bytes, svgB), "igual");
    comprobar("A: tipo servido", String(la?.tipo), "image/png");
    comprobar("A: versión servida = versión de la URL", String(la?.version), versionA);

    console.log("--- RLS: un negocio no ve ni toca el logo de otro ---");
    const claves = await conNegocio(b.id, (tx) => tx.configuracion.findMany({ select: { negocioId: true, clave: true } }));
    comprobar("el contexto de B solo ve filas de B", String(claves.every((f) => f.negocioId === b.id)), "true");
    const vistoPorB = await conNegocio(b.id, (tx) => tx.configuracion.findMany({ where: { negocioId: a.id } }));
    comprobar("B no ve el logo de A aunque lo pida", String(vistoPorB.length), "0");
    let rechazo = "no lanzó error";
    try {
      await conNegocio(b.id, (tx) => guardarLogoEnTx(tx, a.id, logoValido(svgA)));
    } catch {
      rechazo = "rechazado por RLS";
    }
    comprobar("B no puede escribir el logo de A", rechazo, "rechazado por RLS");
    comprobar("el logo de A sigue intacto", igual((await leerLogoPorSlug(SLUG_A))?.bytes, png), "igual");
    await conNegocio(b.id, (tx) => quitarLogoEnTx(tx, b.id));
    comprobar("B quitó el suyo: ya no tiene", String((await getMarcaPorSlug(SLUG_B)).logo), "null");
    comprobar("B quitó el suyo: la ruta pública da null", String(await leerLogoPorSlug(SLUG_B)), "null");
    comprobar("quitar el de B no toca el de A", igual((await leerLogoPorSlug(SLUG_A))?.bytes, png), "igual");

    console.log("--- Reemplazar: la versión cambia (la URL cacheada deja de valer) ---");
    const versionA2 = await conNegocio(a.id, (tx) => guardarLogoEnTx(tx, a.id, logoValido(svgA)));
    comprobar("versión nueva", String(versionA2 !== versionA), "true");
    const ma2 = await getMarcaPorSlug(SLUG_A);
    comprobar("A: URL con la versión nueva", String(ma2.logo), `/marca/logo/${SLUG_A}?v=${versionA2}`);
    comprobar("A: tipo nuevo", String(ma2.logoTipo), "image/svg+xml");
    comprobar("A sirve el logo nuevo", igual((await leerLogoPorSlug(SLUG_A))?.bytes, svgA), "igual");
    const filas = await conNegocio(a.id, (tx) => tx.configuracion.count({ where: { clave: { in: ["logoMime", "logoDatos", "logoVersion"] } } }));
    comprobar("sin filas duplicadas (3 claves)", String(filas), "3");
    const mismoOtraVez = await conNegocio(a.id, (tx) => guardarLogoEnTx(tx, a.id, logoValido(svgA)));
    comprobar("mismo contenido, misma versión", mismoOtraVez, versionA2);

    console.log("--- Negocio inactivo: ni marca ni logo ---");
    await admin.configuracion.createMany({
      data: [
        { negocioId: c.id, clave: "logoMime", valor: "image/png" },
        { negocioId: c.id, clave: "logoDatos", valor: Buffer.from(png).toString("base64") },
        { negocioId: c.id, clave: "logoVersion", valor: "0123456789abcdef" },
      ],
    });
    comprobar("marca de inactivo: neutra", String((await getMarcaPorSlug(SLUG_C)) === MARCA_NEUTRA), "true");
    comprobar("logo de inactivo: no se sirve", String(await leerLogoPorSlug(SLUG_C)), "null");
    comprobar("slug inválido: no se sirve", String(await leerLogoPorSlug("../../etc/passwd")), "null");

    console.log("--- El negocio inicial conserva su logo (Negocio.logoUrl) ---");
    const mhl = await getMarcaPorSlug(SLUG_D);
    comprobar("inicial: logo por defecto", String(mhl.logo), "/marca/logo.png");
    comprobar("inicial: no es logo propio", String(mhl.logoPropio), "false");
    comprobar("inicial: tipo por extensión", String(mhl.logoTipo), "image/png");
    await admin.negocio.update({ where: { id: a.id }, data: { logoUrl: "javascript:alert(1)" } });
    await conNegocio(a.id, (tx) => quitarLogoEnTx(tx, a.id));
    comprobar("logoUrl peligrosa: se descarta", String((await getMarcaPorSlug(SLUG_A)).logo), "null");
    await admin.negocio.update({ where: { id: a.id }, data: { logoUrl: "https://cdn.example.com/alfa.png" } });
    comprobar("logoUrl https: se usa", String((await getMarcaPorSlug(SLUG_A)).logo), "https://cdn.example.com/alfa.png");
    await conNegocio(a.id, (tx) => guardarLogoEnTx(tx, a.id, logoValido(svgA)));
    comprobar("el logo subido gana a logoUrl", String((await getMarcaPorSlug(SLUG_A)).logoPropio), "true");

    console.log("--- Quitar el logo no depende solo de RLS (rol que se salta RLS) ---");
    await conNegocio(b.id, (tx) => guardarLogoEnTx(tx, b.id, logoValido(svgB)));
    await admin.$transaction((tx) => quitarLogoEnTx(tx, a.id)); // cliente de migracion: BYPASSRLS
    comprobar("A quedó sin logo propio", String((await getMarcaPorSlug(SLUG_A)).logoPropio), "false");
    comprobar("B conserva el suyo aunque RLS no rigiera", igual((await leerLogoPorSlug(SLUG_B))?.bytes, svgB), "igual");
  } finally {
    await limpiar();
  }
}

main()
  .catch((error) => {
    fallos += 1;
    console.error("FALLA error inesperado:", error);
  })
  .finally(async () => {
    await admin.$disconnect();
    console.log("");
    console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
    process.exit(fallos === 0 ? 0 : 1);
  });
