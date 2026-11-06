import { z } from "zod";
import { d, type Dinero } from "@/lib/money";
import { esDecimal, normalizarDecimal, textoOpcional } from "@/lib/acciones";

// Configuracion del negocio: claves, valores por defecto y validacion de cada
// valor. Logica pura (sin Prisma ni Next): la usan las server actions, las
// consultas y `scripts/verificar-configuracion.ts`.
//
// En la base todo se guarda como texto (`Configuracion.valor`). Si una clave no
// existe, vale su valor por defecto: asi una clave nueva (como `ivaPorDefecto`)
// no necesita migracion, se crea con upsert la primera vez que se guarda.

export const CLAVES = {
  nombreNegocio: "nombreNegocio",
  costoHoraManoObra: "costoHoraManoObra",
  ivaPorDefecto: "ivaPorDefecto",
  margenObjetivo: "margenObjetivo",
} as const;

export type ClaveConfiguracion = keyof typeof CLAVES;

/** Valores por defecto: los mismos que ya asumian `marca.ts`, el catalogo y el tablero. */
export const POR_DEFECTO: Record<ClaveConfiguracion, string> = {
  nombreNegocio: "HL Laser",
  costoHoraManoObra: "0",
  ivaPorDefecto: "21",
  margenObjetivo: "40",
};

/** Alicuotas de IVA vigentes en Argentina. */
export const IVAS_VALIDOS = ["0", "10.5", "21", "27"] as const;

export type ConfiguracionNegocio = {
  nombreNegocio: string;
  costoHoraManoObra: Dinero;
  ivaPorDefecto: Dinero;
  margenObjetivo: Dinero;
};

// ─── Validacion de cada valor ─────────────────────────────────────────────────

/** Tope de los importes: decimal(14,2) admite hasta 12 digitos enteros. */
const MAXIMO_IMPORTE = d("999999999999.99");

/** Costo por hora (mano de obra o maquina): 0 o mas, hasta 2 decimales. */
export function validarCostoHora(valor: string): string | null {
  if (!esDecimal(valor)) return "Debe ser un número válido, 0 o más";
  const n = d(normalizarDecimal(valor));
  if (n.decimalPlaces() > 2) return "Usá hasta 2 decimales";
  if (n.gt(MAXIMO_IMPORTE)) return "El importe es demasiado grande";
  return null;
}

/** IVA por defecto: una de las alicuotas vigentes (0, 10,5, 21 o 27). */
export function validarIva(valor: string): string | null {
  if (!esDecimal(valor)) return "El IVA debe ser 0, 10,5, 21 o 27";
  const n = d(normalizarDecimal(valor));
  return IVAS_VALIDOS.some((iva) => d(iva).eq(n)) ? null : "El IVA debe ser 0, 10,5, 21 o 27";
}

/**
 * Margen objetivo en %: de 0 a menos de 100. El 100% no se admite porque el
 * precio sugerido es costo / (1 - margen): con 100% seria una division por cero.
 */
export function validarMargen(valor: string): string | null {
  if (!esDecimal(valor)) return "El margen debe ser un número entre 0 y 100";
  const n = d(normalizarDecimal(valor));
  if (n.gte(100)) return "El margen debe ser menor a 100%";
  if (n.decimalPlaces() > 2) return "Usá hasta 2 decimales";
  return null;
}

/** "10,50" → "10.5": forma canonica con la que se guarda en la base. */
export function canonico(valor: string): string {
  return d(normalizarDecimal(valor)).toString();
}

/** Campo decimal de zod a partir de un validador: devuelve el texto canonico. */
function campoDecimal(validar: (v: string) => string | null) {
  return z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const error = validar(v);
      if (error) ctx.addIssue({ code: "custom", message: error });
    })
    .transform(canonico);
}

export const esquemaConfiguracion = z.object({
  nombreNegocio: z.string().trim().min(1, "Falta el nombre del negocio").max(80, "Máximo 80 caracteres"),
  costoHoraManoObra: campoDecimal(validarCostoHora),
  ivaPorDefecto: campoDecimal(validarIva),
  margenObjetivo: campoDecimal(validarMargen),
});

export type DatosConfiguracion = z.input<typeof esquemaConfiguracion>;
export type ConfiguracionValidada = z.output<typeof esquemaConfiguracion>;

export const esquemaMaquina = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre de la máquina").max(80, "Máximo 80 caracteres"),
  costoHora: campoDecimal(validarCostoHora),
  notas: textoOpcional(500),
});

export type DatosMaquina = z.input<typeof esquemaMaquina>;
export type MaquinaValidada = z.output<typeof esquemaMaquina>;

// ─── Lectura tipada ───────────────────────────────────────────────────────────

/**
 * Valor de una clave numerica: el guardado si es valido, si no el por defecto.
 * Un valor roto en la base (cargado a mano) no tira abajo las pantallas.
 */
function numero(config: Record<string, string>, clave: ClaveConfiguracion, validar: (v: string) => string | null) {
  const guardado = config[clave];
  return d(guardado !== undefined && validar(guardado) === null ? normalizarDecimal(guardado) : POR_DEFECTO[clave]);
}

/** Configuracion cruda (clave → texto) a valores tipados, con sus defaults. */
export function leerConfiguracion(config: Record<string, string>): ConfiguracionNegocio {
  return {
    nombreNegocio: config.nombreNegocio?.trim() || POR_DEFECTO.nombreNegocio,
    costoHoraManoObra: numero(config, "costoHoraManoObra", validarCostoHora),
    ivaPorDefecto: numero(config, "ivaPorDefecto", validarIva),
    margenObjetivo: numero(config, "margenObjetivo", validarMargen),
  };
}
