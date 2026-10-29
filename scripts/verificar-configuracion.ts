/**
 * Verificacion de las reglas de configuracion (claves, defaults y validacion de
 * cada valor) contra casos conocidos. Logica pura, sin base.
 *
 *   npx tsx scripts/verificar-configuracion.ts
 */
import {
  esquemaConfiguracion,
  esquemaMaquina,
  leerConfiguracion,
  validarCostoHora,
  validarIva,
  validarMargen,
} from "../src/lib/configuracion";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const valido = (error: string | null) => (error === null ? "válido" : "inválido");

console.log("--- Costo por hora: 0 o más, hasta 2 decimales ---");
comprobar("0", valido(validarCostoHora("0")), "válido");
comprobar("3500", valido(validarCostoHora("3500")), "válido");
comprobar("3500,50 con coma", valido(validarCostoHora("3500,50")), "válido");
comprobar("negativo", valido(validarCostoHora("-1")), "inválido");
comprobar("vacío", valido(validarCostoHora("")), "inválido");
comprobar("texto", valido(validarCostoHora("mil")), "inválido");
comprobar("3 decimales", valido(validarCostoHora("10.123")), "inválido");
comprobar("separador de miles", valido(validarCostoHora("3.500,00")), "inválido");
comprobar("más de 12 dígitos", valido(validarCostoHora("1000000000000")), "inválido");

console.log("--- IVA: 0, 10,5, 21 o 27 ---");
for (const iva of ["0", "10.5", "10,5", "21", "27", "21.00"]) comprobar(`IVA ${iva}`, valido(validarIva(iva)), "válido");
for (const iva of ["5", "105", "-21", "", "veintiuno", "100"]) comprobar(`IVA ${iva || "vacío"}`, valido(validarIva(iva)), "inválido");

console.log("--- Margen objetivo: de 0 a menos de 100 ---");
for (const m of ["0", "40", "45,5", "99.99"]) comprobar(`margen ${m}`, valido(validarMargen(m)), "válido");
for (const m of ["100", "150", "-5", "", "40.123"]) comprobar(`margen ${m || "vacío"}`, valido(validarMargen(m)), "inválido");

console.log("--- Esquema: normaliza a la forma con la que se guarda ---");
const ok = esquemaConfiguracion.safeParse({
  nombreNegocio: "  Taller Láser  ",
  costoHoraManoObra: "3500,50",
  ivaPorDefecto: "10,5",
  margenObjetivo: "45.0",
});
comprobar("acepta", String(ok.success), "true");
if (ok.success) {
  comprobar("nombre recortado", ok.data.nombreNegocio, "Taller Láser");
  comprobar("costo con punto", ok.data.costoHoraManoObra, "3500.5");
  comprobar("IVA con punto", ok.data.ivaPorDefecto, "10.5");
  comprobar("margen sin ceros", ok.data.margenObjetivo, "45");
}
const sinNombre = esquemaConfiguracion.safeParse({
  nombreNegocio: "   ",
  costoHoraManoObra: "1",
  ivaPorDefecto: "21",
  margenObjetivo: "40",
});
comprobar("rechaza nombre vacío", String(sinNombre.success), "false");
const ivaMalo = esquemaConfiguracion.safeParse({
  nombreNegocio: "X",
  costoHoraManoObra: "1",
  ivaPorDefecto: "19",
  margenObjetivo: "40",
});
comprobar("rechaza IVA 19", ivaMalo.success ? "aceptado" : String(ivaMalo.error.issues[0]?.message), "El IVA debe ser 0, 10,5, 21 o 27");

const maquina = esquemaMaquina.safeParse({ nombre: " Láser CO2 ", costoHora: "8000", notas: "  " });
comprobar("máquina válida", String(maquina.success), "true");
if (maquina.success) comprobar("notas vacías → null", String(maquina.data.notas), "null");
comprobar("máquina sin costo", String(esquemaMaquina.safeParse({ nombre: "X", costoHora: "" }).success), "false");

console.log("--- Lectura con defaults ---");
const vacia = leerConfiguracion({});
comprobar("nombre por defecto", vacia.nombreNegocio, "HL Laser");
comprobar("costo/hora por defecto", vacia.costoHoraManoObra.toString(), "0");
comprobar("IVA por defecto", vacia.ivaPorDefecto.toString(), "21");
comprobar("margen por defecto", vacia.margenObjetivo.toString(), "40");
const cargada = leerConfiguracion({
  nombreNegocio: "Otro",
  costoHoraManoObra: "3500",
  ivaPorDefecto: "10.5",
  margenObjetivo: "45",
});
comprobar("costo/hora guardado", cargada.costoHoraManoObra.toString(), "3500");
comprobar("IVA guardado", cargada.ivaPorDefecto.toString(), "10.5");
const rota = leerConfiguracion({ nombreNegocio: "  ", ivaPorDefecto: "19", margenObjetivo: "abc" });
comprobar("valor roto → default (IVA)", rota.ivaPorDefecto.toString(), "21");
comprobar("valor roto → default (margen)", rota.margenObjetivo.toString(), "40");
comprobar("nombre en blanco → default", rota.nombreNegocio, "HL Laser");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
