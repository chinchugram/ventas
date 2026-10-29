import { ErrorDeNegocio } from "@/lib/acciones";
import { d } from "@/lib/money";
import { CLAVES, type ConfiguracionValidada, type MaquinaValidada } from "@/lib/configuracion";
import type { Tx } from "@/lib/dominio/tx";

// Escrituras de configuracion y maquinas. Reciben datos ya validados por zod
// (`esquemaConfiguracion`, `esquemaMaquina`) y un `tx`, asi las llaman tanto las
// server actions como `scripts/test-configuracion.ts`.

/** Guarda las cuatro claves con upsert: las que no existian se crean. */
export async function guardarConfiguracionEnTx(tx: Tx, datos: ConfiguracionValidada): Promise<void> {
  for (const clave of Object.values(CLAVES)) {
    const valor = datos[clave];
    await tx.configuracion.upsert({ where: { clave }, update: { valor }, create: { clave, valor } });
  }
}

/** El nombre de una maquina no se repite (sin distinguir mayusculas), ni con las de baja. */
async function exigirNombreLibre(tx: Tx, nombre: string, excepto?: string) {
  const otra = await tx.maquina.findFirst({
    where: { nombre: { equals: nombre, mode: "insensitive" }, ...(excepto ? { id: { not: excepto } } : {}) },
    select: { nombre: true, activo: true },
  });
  if (otra) {
    throw new ErrorDeNegocio(
      otra.activo
        ? `Ya hay una máquina llamada "${otra.nombre}"`
        : `Ya hay una máquina dada de baja llamada "${otra.nombre}": reactivala en vez de crear otra`,
    );
  }
}

export async function crearMaquinaEnTx(tx: Tx, datos: MaquinaValidada): Promise<{ id: string }> {
  await exigirNombreLibre(tx, datos.nombre);
  return tx.maquina.create({
    data: { nombre: datos.nombre, costoHora: d(datos.costoHora), notas: datos.notas },
    select: { id: true },
  });
}

export async function editarMaquinaEnTx(tx: Tx, id: string, datos: MaquinaValidada): Promise<void> {
  const existe = await tx.maquina.findUnique({ where: { id }, select: { id: true } });
  if (!existe) throw new ErrorDeNegocio("La máquina no existe");
  await exigirNombreLibre(tx, datos.nombre, id);
  await tx.maquina.update({
    where: { id },
    data: { nombre: datos.nombre, costoHora: d(datos.costoHora), notas: datos.notas },
  });
}

/**
 * Baja logica o reactivacion. Nunca se borra: la maquina puede estar en recetas.
 * Devuelve en cuantas recetas de articulos activos figura, para avisar.
 */
export async function cambiarActivoMaquinaEnTx(tx: Tx, id: string, activo: boolean): Promise<{ recetas: number }> {
  const maquina = await tx.maquina.findUnique({ where: { id }, select: { activo: true } });
  if (!maquina) throw new ErrorDeNegocio("La máquina no existe");
  if (maquina.activo !== activo) await tx.maquina.update({ where: { id }, data: { activo } });
  return { recetas: await contarRecetasConMaquina(tx, id) };
}

/** Recetas distintas (de articulos activos) que usan la maquina. */
export async function contarRecetasConMaquina(tx: Tx, maquinaId: string): Promise<number> {
  const filas = await tx.recetaComponente.findMany({
    where: { maquinaId, receta: { articulo: { activo: true } } },
    distinct: ["recetaId"],
    select: { recetaId: true },
  });
  return filas.length;
}
