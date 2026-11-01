/**
 * Verificacion de las reglas de la marca (F4.2): validacion del logo (tipo por contenido,
 * tamaño, SVG de lista blanca), iniciales y `logoUrlSegura`. Logica pura, sin base.
 *
 *   npx tsx scripts/verificar-marca.ts
 */
import { readFileSync } from "node:fs";
import { inicialesDe, logoUrlSegura, MAX_LOGO_BYTES, tipoPorExtension, validarLogo, validarSvg } from "../src/lib/marca-pura";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const bytes = (s: string) => new TextEncoder().encode(s);
const tipoDe = (b: Uint8Array) => {
  const r = validarLogo(b);
  return r.ok ? r.logo.tipo : `rechazado: ${r.error}`;
};
const rechazado = (b: Uint8Array) => (validarLogo(b).ok ? "aceptado" : "rechazado");
const svg = (cuerpo: string, attrs = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"') => `<svg ${attrs}>${cuerpo}</svg>`;
const svgOk = (s: string) => (validarSvg(s).ok ? "aceptado" : "rechazado");

console.log("--- Tipo por contenido ---");
const png = new Uint8Array(readFileSync("public/marca/logo.png"));
comprobar("el logo.png del repo es PNG", tipoDe(png), "image/png");
comprobar("JPEG por firma", tipoDe(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])), "image/jpeg");
comprobar("SVG simple", tipoDe(bytes(svg('<rect width="10" height="10" fill="#f90"/>'))), "image/svg+xml");
comprobar("vacío", rechazado(new Uint8Array(0)), "rechazado");
comprobar("GIF", rechazado(bytes("GIF89a\u0001\u0000\u0001\u0000")), "rechazado");
comprobar("WebP", rechazado(bytes("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")), "rechazado");
comprobar("PDF", rechazado(bytes("%PDF-1.7\n")), "rechazado");
comprobar("ejecutable", rechazado(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])), "rechazado");
comprobar("HTML", rechazado(bytes("<html><script>alert(1)</script></html>")), "rechazado");
comprobar("texto cualquiera", rechazado(bytes("hola")), "rechazado");
comprobar("binario no UTF-8", rechazado(new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x80])), "rechazado");
// Un .png de nombre cuyo contenido es un SVG con script: se decide por el contenido.
comprobar("script disfrazado de imagen", rechazado(bytes(svg("<script>alert(1)</script>"))), "rechazado");

console.log("--- Tamaño: hasta 1 MB ---");
const grande = new Uint8Array(MAX_LOGO_BYTES + 1);
grande.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const rGrande = validarLogo(grande);
comprobar("1 MB + 1 byte se rechaza", rGrande.ok ? "aceptado" : "rechazado", "rechazado");
comprobar("el mensaje dice cuánto pesa y el tope", String(!rGrande.ok && /1,0 MB.*máximo es 1 MB/.test(rGrande.error)), "true");
const justo = new Uint8Array(MAX_LOGO_BYTES);
justo.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
comprobar("exactamente 1 MB se acepta", rechazado(justo), "aceptado");
const rVacio = validarLogo(new Uint8Array(0));
comprobar("mensaje de archivo vacío", rVacio.ok ? "" : rVacio.error, "El archivo está vacío.");
const rGif = validarLogo(bytes("GIF89a"));
comprobar("mensaje de formato", rGif.ok ? "" : rGif.error, "El archivo no es un logo válido. Subí una imagen PNG, JPG o SVG.");

console.log("--- SVG: lo que se acepta ---");
comprobar("con declaración XML y comentario", svgOk('<?xml version="1.0" encoding="UTF-8"?>\n<!-- hecho a mano -->\n' + svg('<g><path d="M0 0L10 10" stroke="#000" stroke-width="2"/></g>')), "aceptado");
comprobar("con BOM", svgOk("﻿" + svg("<circle cx='5' cy='5' r='4'/>")), "aceptado");
comprobar(
  "degradado con referencia interna",
  svgOk(
    svg(
      '<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#f90"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>',
    ),
  ),
  "aceptado",
);
comprobar("texto con entidad básica", svgOk(svg('<text x="1" y="5">A &amp; B</text>')), "aceptado");
comprobar("style con clases", svgOk(svg('<style>.a{fill:#f90}</style><rect class="a" width="3" height="3"/>')), "aceptado");
comprobar("use con #id", svgOk(svg('<defs><path id="p" d="M0 0h1"/></defs><use href="#p"/>')), "aceptado");
comprobar("xlink:href interno", svgOk(svg('<defs><path id="p" d="M0 0h1"/></defs><use xlink:href="#p"/>', 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"')), "aceptado");

console.log("--- SVG: lo que se rechaza ---");
const malos: [string, string][] = [
  ["script", svg("<script>alert(1)</script>")],
  ["script en mayúsculas", svg("<SCRIPT>alert(1)</SCRIPT>")],
  ["onload", svg('<rect width="1" height="1" onload="alert(1)"/>')],
  ["onclick con mayúsculas", svg('<rect width="1" height="1" OnClick="alert(1)"/>')],
  ["onload en la raíz", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`],
  ["foreignObject", svg("<foreignObject><div>hola</div></foreignObject>")],
  ["iframe", svg('<iframe src="https://x"/>')],
  ["image externa", svg('<image href="https://evil.example/x.png"/>')],
  ["image con data:", svg('<image href="data:image/png;base64,AAAA"/>')],
  ["use externo", svg('<use href="https://evil.example/x.svg#a"/>')],
  ["use con javascript:", svg('<use href="javascript:alert(1)"/>')],
  ["a con javascript:", svg('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>')],
  ["animate (cambia href)", svg('<a><animate attributeName="href" values="javascript:alert(1)"/></a>')],
  ["set", svg('<set attributeName="onload" to="alert(1)"/>')],
  ["DOCTYPE", `<!DOCTYPE svg [<!ENTITY x "y">]>` + svg("<text>&x;</text>")],
  ["entidad numérica", svg('<text>&#60;script&#62;</text>')],
  ["entidad propia", svg("<text>&xxe;</text>")],
  ["CDATA", svg("<style><![CDATA[a{}]]></style>")],
  ["instrucción de procesamiento", svg('<?xml-stylesheet href="x.css"?><g/>')],
  ["style con @import", svg('<style>@import url(https://evil.example/x.css);</style>')],
  ["style con url externa", svg('<rect width="1" height="1" style="fill:url(https://evil.example/x)"/>')],
  ["style con expression", svg('<rect width="1" height="1" style="width:expression(alert(1))"/>')],
  ["fill con url externa", svg('<rect width="1" height="1" fill="url(https://evil.example/x)"/>')],
  ["sin xmlns", svg("<g/>", 'viewBox="0 0 1 1"')],
  ["xmlns raro", svg("<g/>", 'xmlns="http://evil.example/ns"')],
  ["raíz que no es svg", "<g xmlns=\"http://www.w3.org/2000/svg\"></g>"],
  ["dos raíces", svg("<g/>") + svg("<g/>")],
  ["svg anidado", svg("<svg><g/></svg>")],
  ["atributo sin comillas", '<svg xmlns="http://www.w3.org/2000/svg"><rect width=1 height=1/></svg>'],
  ["atributo sin valor", '<svg xmlns="http://www.w3.org/2000/svg"><rect hidden/></svg>'],
  ["barra antes del atributo", '<svg/onload=alert(1) xmlns="http://www.w3.org/2000/svg"></svg>'],
  ["etiquetas mal anidadas", svg("<g><path/></g></g>")],
  ["sin cerrar", '<svg xmlns="http://www.w3.org/2000/svg"><g>'],
  ["texto fuera de la raíz", svg("<g/>") + "hola"],
  ["texto suelto en g", svg("<g>hola</g>")],
  ["atributo repetido", svg('<rect width="1" width="2"/>')],
  ["atributo con namespace raro", svg('<rect xlink:foo="1"/>')],
  ["atributo con '<'", '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a<b"/></svg>'],
  ["elemento con namespace", svg("<svg:script>alert(1)</svg:script>")],
  ["inkscape sodipodi", svg('<sodipodi:namedview id="base"/>')],
  ["barra invertida (escape CSS)", svg('<rect width="1" height="1" style="fill:\\75rl(https://x)"/>')],
];
for (const [etiqueta, doc] of malos) comprobar(etiqueta, svgOk(doc), "rechazado");

console.log("--- SVG: mensaje claro ---");
const rScript = validarLogo(bytes(svg("<script>alert(1)</script>")));
comprobar("nombra el elemento", String(!rScript.ok && rScript.error.includes("<script>")), "true");

console.log("--- Iniciales ---");
comprobar("HL Laser", inicialesDe("HL Laser"), "HL");
comprobar("una palabra", inicialesDe("Taller"), "T");
comprobar("tres palabras", inicialesDe("Casa de Pintura"), "CD");
comprobar("minúsculas y acento", inicialesDe("ñandú sur"), "ÑS");
comprobar("espacios sobrantes", inicialesDe("   Ana   María  "), "AM");
comprobar("solo símbolos", inicialesDe("***"), "?");
comprobar("vacío", inicialesDe(""), "?");

console.log("--- logoUrl segura ---");
comprobar("ruta propia", String(logoUrlSegura("/marca/logo.png")), "/marca/logo.png");
comprobar("https", String(logoUrlSegura("https://cdn.example.com/a.png")), "https://cdn.example.com/a.png");
comprobar("javascript:", String(logoUrlSegura("javascript:alert(1)")), "null");
comprobar("data:", String(logoUrlSegura("data:image/svg+xml,<svg/>")), "null");
comprobar("//host (mismo esquema)", String(logoUrlSegura("//evil.example/x.png")), "null");
comprobar("http plano", String(logoUrlSegura("http://example.com/x.png")), "null");
comprobar("con comillas", String(logoUrlSegura('/a"onerror="x')), "null");
comprobar("vacía", String(logoUrlSegura("  ")), "null");
comprobar("null", String(logoUrlSegura(null)), "null");

console.log("--- Tipo por extensión ---");
comprobar("png con query", String(tipoPorExtension("/marca/logo/x.png?v=1")), "image/png");
comprobar("svg", String(tipoPorExtension("/a/b.SVG")), "image/svg+xml");
comprobar("sin extensión", String(tipoPorExtension("/marca/logo/x")), "null");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
