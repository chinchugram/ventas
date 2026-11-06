/**
 * Verificacion de los datos fiscales del negocio (src/lib/datos-fiscales.ts):
 * cada campo con sus bordes, la normalizacion de lo que se guarda, la lectura
 * desde `Configuracion` y los mensajes de "que falta para emitir". No usa base.
 *
 *   npm run test:datos-fiscales
 */
import {
  CLAVES_FISCALES,
  datosFiscalesDesdeConfiguracion,
  faltantesParaEmitir,
  mensajeFaltantes,
  UMBRAL_IDENTIFICACION_POR_DEFECTO,
  validarCondicionIvaEmisor,
  validarCuitEmisor,
  validarDatosFiscales,
  validarDomicilio,
  validarIibb,
  validarInicioActividades,
  validarPuntoVenta,
  validarRazonSocial,
  validarUmbralIdentificacion,
  type EntradaFiscal,
} from "../src/lib/datos-fiscales";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

type V = { ok: true; valor: unknown } | { ok: false; error: string };
/** "ok:<valor>" o "error:<fragmento encontrado?>" para comparar en una linea. */
const valor = (r: V) => (r.ok ? `ok:${r.valor instanceof Date ? r.valor.toISOString() : String(r.valor)}` : "error");
const errorCon = (r: V, fragmento: string) => (r.ok ? "aceptado" : r.error.includes(fragmento) ? "error" : `otro error: ${r.error}`);

const HOY = new Date("2026-10-30T15:00:00Z"); // 30/10/2026 12:00 en Argentina

console.log("--- Razón social y domicilio ---");
comprobar("razón social normal", valor(validarRazonSocial("  HL   Laser S.R.L. ")), "ok:HL Laser S.R.L.");
comprobar("razón social vacía", errorCon(validarRazonSocial("   "), "Falta la razón social"), "error");
comprobar("razón social ausente", errorCon(validarRazonSocial(undefined), "Falta"), "error");
comprobar("razón social larguísima", errorCon(validarRazonSocial("x".repeat(201)), "hasta 200"), "error");
comprobar("razón social de 200", valor(validarRazonSocial("x".repeat(200))).length.toString(), String("ok:".length + 200));
comprobar("domicilio normal", valor(validarDomicilio("Av. Colón 1234, Córdoba")), "ok:Av. Colón 1234, Córdoba");
comprobar("domicilio vacío", errorCon(validarDomicilio(""), "Falta el domicilio"), "error");

console.log("--- CUIT del emisor ---");
comprobar("con guiones → normalizado", valor(validarCuitEmisor("20-33333333-4")), "ok:20333333334");
comprobar("sin guiones", valor(validarCuitEmisor("30712345671")), "ok:30712345671");
comprobar("con espacios", valor(validarCuitEmisor(" 30 71234567 1 ")), "ok:30712345671");
comprobar("dígito verificador mal", errorCon(validarCuitEmisor("30-71234567-2"), "dígito verificador"), "error");
comprobar("10 dígitos", errorCon(validarCuitEmisor("3071234567"), "11 dígitos"), "error");
comprobar("prefijo inexistente", errorCon(validarCuitEmisor("12-34567890-1"), "no puede empezar"), "error");
comprobar("letras", errorCon(validarCuitEmisor("30-7123456A-1"), "11 dígitos"), "error");
comprobar("vacío", errorCon(validarCuitEmisor(""), "Falta el CUIT"), "error");

console.log("--- Condición frente al IVA ---");
comprobar("vacía → responsable inscripto (por defecto)", valor(validarCondicionIvaEmisor("")), "ok:RESPONSABLE_INSCRIPTO");
comprobar("ausente → responsable inscripto", valor(validarCondicionIvaEmisor(undefined)), "ok:RESPONSABLE_INSCRIPTO");
comprobar("monotributo", valor(validarCondicionIvaEmisor("MONOTRIBUTO")), "ok:MONOTRIBUTO");
comprobar("en minúsculas", valor(validarCondicionIvaEmisor("monotributo")), "ok:MONOTRIBUTO");
comprobar("desconocida", errorCon(validarCondicionIvaEmisor("AUTONOMO"), "responsable inscripto o monotributo"), "error");
comprobar("exento (no emite con este sistema)", errorCon(validarCondicionIvaEmisor("EXENTO"), "responsable inscripto o monotributo"), "error");
comprobar("consumidor final (no es un emisor)", errorCon(validarCondicionIvaEmisor("CONSUMIDOR_FINAL"), "monotributo"), "error");

console.log("--- Inicio de actividades ---");
comprobar("ISO", valor(validarInicioActividades("2020-03-02", HOY)), "ok:2020-03-02");
comprobar("dd/mm/aaaa", valor(validarInicioActividades("2/3/2020", HOY)), "ok:2020-03-02");
comprobar("hoy mismo vale", valor(validarInicioActividades("2026-10-30", HOY)), "ok:2026-10-30");
comprobar("mañana (futura)", errorCon(validarInicioActividades("2026-10-31", HOY), "futura"), "error");
comprobar("el año que viene", errorCon(validarInicioActividades("31/12/2027", HOY), "futura"), "error");
comprobar(
  "hoy en Argentina, aunque en UTC ya sea mañana",
  valor(validarInicioActividades("2026-10-30", new Date("2026-10-31T02:00:00Z"))),
  "ok:2026-10-30",
);
comprobar(
  "mañana en Argentina es futura aunque en UTC sea hoy",
  errorCon(validarInicioActividades("2026-10-31", new Date("2026-10-31T02:00:00Z")), "futura"),
  "error",
);
comprobar("31 de febrero", errorCon(validarInicioActividades("2021-02-31", HOY), "no existe"), "error");
comprobar("29/02 en año no bisiesto", errorCon(validarInicioActividades("29/02/2021", HOY), "no existe"), "error");
comprobar("29/02 en año bisiesto", valor(validarInicioActividades("29/02/2020", HOY)), "ok:2020-02-29");
comprobar("mes 13", errorCon(validarInicioActividades("2020-13-01", HOY), "no existe"), "error");
comprobar("texto", errorCon(validarInicioActividades("marzo 2020", HOY), "no es válida"), "error");
comprobar("año de 2 dígitos", errorCon(validarInicioActividades("02/03/20", HOY), "no es válida"), "error");
comprobar("antes de 1900", errorCon(validarInicioActividades("1899-12-31", HOY), "antigua"), "error");
comprobar("vacía", errorCon(validarInicioActividades("", HOY), "Falta la fecha"), "error");

console.log("--- Ingresos brutos (opcional) ---");
comprobar("vacío → sin IIBB", valor(validarIibb("")), "ok:null");
comprobar("ausente → sin IIBB", valor(validarIibb(undefined)), "ok:null");
comprobar("solo espacios → sin IIBB", valor(validarIibb("   ")), "ok:null");
comprobar("número provincial", valor(validarIibb("280-123456-7")), "ok:280-123456-7");
comprobar("convenio multilateral (CUIT)", valor(validarIibb("901-30712345671")), "ok:901-30712345671");
comprobar("texto 'Exento'", valor(validarIibb("Exento")), "ok:Exento");
comprobar("caracteres raros", errorCon(validarIibb("123<script>"), "no válidos"), "error");
comprobar("demasiado largo", errorCon(validarIibb("1".repeat(31)), "hasta 30"), "error");

console.log("--- Punto de venta ---");
comprobar("1", valor(validarPuntoVenta("1")), "ok:1");
comprobar("0001 → 1", valor(validarPuntoVenta("0001")), "ok:1");
comprobar("99999 (máximo)", valor(validarPuntoVenta("99999")), "ok:99999");
comprobar("0", errorCon(validarPuntoVenta("0"), "1 a 99999"), "error");
comprobar("00000", errorCon(validarPuntoVenta("00000"), "1 a 99999"), "error");
comprobar("100000", errorCon(validarPuntoVenta("100000"), "1 a 99999"), "error");
comprobar("decimal con punto", errorCon(validarPuntoVenta("1.5"), "entero"), "error");
comprobar("decimal con coma", errorCon(validarPuntoVenta("2,0"), "entero"), "error");
comprobar("negativo", errorCon(validarPuntoVenta("-3"), "entero"), "error");
comprobar("con signo +", errorCon(validarPuntoVenta("+3"), "entero"), "error");
comprobar("texto", errorCon(validarPuntoVenta("uno"), "entero"), "error");
comprobar("vacío", errorCon(validarPuntoVenta(""), "Falta el punto de venta"), "error");

console.log("--- Umbral de identificación (opcional) ---");
comprobar("vacío → por defecto", valor(validarUmbralIdentificacion("")), `ok:${UMBRAL_IDENTIFICACION_POR_DEFECTO}`);
comprobar("con coma", valor(validarUmbralIdentificacion("500000,50")), "ok:500000.5");
comprobar("negativo", errorCon(validarUmbralIdentificacion("-1"), "importe"), "error");
comprobar("3 decimales", errorCon(validarUmbralIdentificacion("1.234"), "importe"), "error");

console.log("--- Todos juntos ---");
const completos: EntradaFiscal = {
  razonSocial: "HL Laser S.R.L.",
  cuit: "20-33333333-4",
  condicionIva: "",
  domicilio: "Av. Colón 1234, Córdoba",
  inicioActividades: "02/03/2020",
  iibb: "",
  puntoVenta: "0003",
};
{
  const r = validarDatosFiscales(completos, HOY);
  comprobar("completos: válidos", String(r.ok), "true");
  if (r.ok) {
    comprobar("CUIT normalizado", r.datos.cuit, "20333333334");
    comprobar("condición por defecto", r.datos.condicionIva, "RESPONSABLE_INSCRIPTO");
    comprobar("fecha como Date a medianoche UTC", r.datos.inicioActividades.toISOString(), "2020-03-02T00:00:00.000Z");
    comprobar("punto de venta numérico", String(r.datos.puntoVenta), "3");
    comprobar("IIBB vacío → null", String(r.datos.iibb), "null");
    comprobar("umbral por defecto", r.datos.umbralIdentificacion.toString(), UMBRAL_IDENTIFICACION_POR_DEFECTO);
    comprobar(
      "valores a guardar normalizados",
      JSON.stringify(r.valores),
      JSON.stringify({
        fiscalRazonSocial: "HL Laser S.R.L.",
        fiscalCuit: "20333333334",
        fiscalCondicionIva: "RESPONSABLE_INSCRIPTO",
        fiscalDomicilio: "Av. Colón 1234, Córdoba",
        fiscalInicioActividades: "2020-03-02",
        fiscalIibb: "",
        fiscalPuntoVenta: "3",
        fiscalUmbralIdentificacion: "",
      }),
    );
    // Lo guardado se vuelve a leer igual (idempotente).
    const releido = datosFiscalesDesdeConfiguracion(r.valores, HOY);
    comprobar("lo guardado se relee igual", String(releido.ok && JSON.stringify(releido.valores) === JSON.stringify(r.valores)), "true");
  }
}
{
  const r = validarDatosFiscales({ ...completos, cuit: "30-71234567-2", puntoVenta: "0", inicioActividades: "2030-01-01" }, HOY);
  comprobar("varios errores: inválido", String(r.ok), "false");
  if (!r.ok) {
    comprobar("varios errores: uno por campo", Object.keys(r.errores).sort().join(","), "cuit,inicioActividades,puntoVenta");
  }
}

console.log("--- Desde Configuracion y qué falta para emitir ---");
{
  comprobar("las claves no chocan con las existentes", Object.values(CLAVES_FISCALES).every((c) => c.startsWith("fiscal")).toString(), "true");
  const nada = faltantesParaEmitir({}, HOY);
  comprobar("sin nada: faltan los 5 obligatorios (razón social, CUIT, domicilio, inicio, punto)", String(nada.length), "5");
  comprobar("sin nada: el orden es el del formulario", nada[0]!.startsWith("Falta la razón social") ? "ok" : nada[0]!, "ok");
  comprobar("sin nada: no pide IIBB (opcional)", String(nada.some((m) => m.includes("ngresos brutos"))), "false");
  comprobar("sin nada: no pide la condición (tiene valor por defecto)", String(nada.some((m) => m.includes("condición"))), "false");

  const guardado = {
    fiscalRazonSocial: "HL Laser",
    fiscalCuit: "20333333334",
    fiscalDomicilio: "Córdoba",
    fiscalInicioActividades: "2020-03-02",
    fiscalPuntoVenta: "1",
    otraClave: "no molesta",
  };
  comprobar("completo: no falta nada", JSON.stringify(faltantesParaEmitir(guardado, HOY)), "[]");
  const sinPunto = faltantesParaEmitir({ ...guardado, fiscalPuntoVenta: "" }, HOY);
  comprobar("sin punto de venta: un faltante claro", JSON.stringify(sinPunto), JSON.stringify(["Falta el punto de venta."]));
  const cuitRoto = faltantesParaEmitir({ ...guardado, fiscalCuit: "20333333335" }, HOY);
  comprobar("CUIT guardado inválido: lo dice", String(cuitRoto.length === 1 && cuitRoto[0]!.includes("dígito verificador")), "true");
  const condicionRara = faltantesParaEmitir({ ...guardado, fiscalCondicionIva: "OTRA" }, HOY);
  comprobar("condición guardada desconocida: lo dice", String(condicionRara.length === 1 && condicionRara[0]!.includes("condición")), "true");
  const mensaje = mensajeFaltantes(sinPunto);
  comprobar("mensaje para el usuario", mensaje, "No se puede facturar todavía: completá los datos fiscales del negocio en Configuración. Falta el punto de venta.");
  comprobar("mensaje vacío si no falta nada", mensajeFaltantes([]), "");
  const umbral = datosFiscalesDesdeConfiguracion({ ...guardado, fiscalUmbralIdentificacion: "250000" }, HOY);
  comprobar("umbral guardado se respeta", umbral.ok ? umbral.datos.umbralIdentificacion.toString() : "error", "250000");
}

if (fallos > 0) {
  console.log(`\n${fallos} comprobaciones fallaron.`);
  process.exit(1);
}
console.log("\nTodo OK.");
