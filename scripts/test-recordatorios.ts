/**
 * Prueba los recordatorios de cobranza contra Postgres real, sin Next:
 * el registro de contactos (dominio + CHECK de la tabla) y la consulta
 * "a quien llamar hoy" de punta a punta.
 *
 *   npx tsx scripts/test-recordatorios.ts
 *
 * Usa la base de DATABASE_URL. Los escenarios de dominio corren dentro de una
 * transaccion que se deshace al final. La consulta lee con su propia conexion,
 * asi que el escenario de punta a punta confirma sus datos y los borra al
 * terminar (borrado fisico: son datos de prueba, no de negocio), tambien si falla.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { ErrorDeNegocio, fechaDesdeISO, hoyArgentinaISO } from "../src/lib/acciones";
import type { Tx } from "../src/lib/dominio/tx";
import { registrarVentaEnTx } from "../src/lib/dominio/ventas";
import { registrarPagoEnTx, anularPagoEnTx } from "../src/lib/dominio/pagos";
import { registrarContactoEnTx } from "../src/lib/dominio/recordatorios";
import { getRecordatoriosHoy } from "../src/lib/queries/recordatorios";
import { estadoDemo } from "../src/lib/respaldo";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

/** Espera un ErrorDeNegocio cuyo mensaje contenga `fragmento`. */
async function rechaza(etiqueta: string, fragmento: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    comprobar(etiqueta, "no lanzó error", `error "${fragmento}"`);
  } catch (error) {
    const ok = error instanceof ErrorDeNegocio && error.message.includes(fragmento);
    comprobar(etiqueta, ok ? "rechazada" : String(error), "rechazada");
  }
}

/** Espera que la base rechace la operacion por la restriccion `restriccion`. Aborta la transaccion: va ultima. */
async function violaRestriccion(etiqueta: string, restriccion: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    comprobar(etiqueta, "la base lo aceptó", `rechazado por ${restriccion}`);
  } catch (error) {
    comprobar(etiqueta, String(error).includes(restriccion) ? `rechazado por ${restriccion}` : String(error), `rechazado por ${restriccion}`);
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

class Deshacer extends Error {}

/** Corre `fn` en una transaccion que siempre se deshace. */
async function escenario(titulo: string, fn: (tx: Tx) => Promise<void>) {
  console.log(`--- ${titulo} ---`);
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Deshacer();
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof Deshacer)) {
      fallos += 1;
      console.log("FALLA error inesperado:", error);
    }
  }
}

const hoyISO = hoyArgentinaISO();
const hoy = fechaDesdeISO(hoyISO);
const dia = (n: number) => new Date(hoy.getTime() + n * 86_400_000);
const iso = (f: Date | null) => (f ? f.toISOString().slice(0, 10) : "null");

const HASH_DE_PRUEBA = `scrypt$ln=14,r=8,p=1$${"a".repeat(22)}$${"b".repeat(43)}`;

/** Usuario real de prueba (los escenarios lo crean dentro de su transaccion: se deshace con ella). */
async function usuarioDePrueba(tx: Tx, nombre: string) {
  return tx.usuario.create({
    data: { usuario: `zz-${Math.random().toString(36).slice(2, 10)}`, nombre, rol: "EMPLEADO", hashClave: HASH_DE_PRUEBA },
  });
}

async function clienteDePrueba(tx: Tx, nombre = "Cliente de recordatorios", telefono: string | null = "351 455-6677") {
  return tx.cliente.create({ data: { nombre, telefono } });
}

async function main() {
  await escenario("Registrar un contacto", async (tx) => {
    const c = await clienteDePrueba(tx);
    const { id } = await registrarContactoEnTx(tx, {
      clienteId: c.id,
      fecha: hoy,
      nota: "  No atendió, probar a la tarde  ",
      proximoContacto: dia(2),
    });
    const guardado = await tx.contactoCobranza.findUniqueOrThrow({ where: { id } });
    comprobar("cliente", guardado.clienteId, c.id);
    comprobar("fecha del contacto", iso(guardado.fecha), hoyISO);
    comprobar("nota sin espacios sobrantes", guardado.nota, "No atendió, probar a la tarde");
    comprobar("próximo contacto", iso(guardado.proximoContacto), iso(dia(2)));
    comprobar("creadoEn se completa solo", String(guardado.creadoEn instanceof Date), "true");

    const sin = await registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "Prometió pagar", proximoContacto: null });
    comprobar("próximo contacto opcional", String((await tx.contactoCobranza.findUniqueOrThrow({ where: { id: sin.id } })).proximoContacto), "null");

    const mismoDia = await registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "Hoy mismo", proximoContacto: hoy });
    comprobar("próximo contacto el mismo día se acepta", iso((await tx.contactoCobranza.findUniqueOrThrow({ where: { id: mismoDia.id } })).proximoContacto), hoyISO);

    comprobar("tres contactos del cliente", String(await tx.contactoCobranza.count({ where: { clienteId: c.id } })), "3");
  });

  await escenario("El dominio rechaza lo inválido con mensaje claro", async (tx) => {
    const c = await clienteDePrueba(tx);
    await rechaza("nota vacía", "nota", () => registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "", proximoContacto: null }));
    await rechaza("nota de solo espacios", "nota", () => registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "   ", proximoContacto: null }));
    await rechaza("nota demasiado larga", "500", () => registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "x".repeat(501), proximoContacto: null }));
    await rechaza("próximo contacto anterior al contacto", "pasada", () =>
      registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "ok", proximoContacto: dia(-1) }),
    );
    await rechaza("cliente inexistente", "no existe", () =>
      registrarContactoEnTx(tx, { clienteId: "00000000-0000-0000-0000-000000000000", fecha: hoy, nota: "ok", proximoContacto: null }),
    );
    comprobar("no quedó nada guardado", String(await tx.contactoCobranza.count({ where: { clienteId: c.id } })), "0");
  });

  await escenario("Un cliente dado de baja admite constancia de un contacto", async (tx) => {
    const c = await tx.cliente.create({ data: { nombre: "De baja", activo: false } });
    await registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "Avisó que cerró", proximoContacto: null });
    comprobar("guardado", String(await tx.contactoCobranza.count({ where: { clienteId: c.id } })), "1");
  });

  await escenario("CHECK: próximo contacto >= fecha del contacto", async (tx) => {
    const c = await clienteDePrueba(tx);
    await violaRestriccion("la base rechaza un próximo contacto anterior", "contactos_cobranza_proximo_check", () =>
      tx.contactoCobranza.create({ data: { clienteId: c.id, fecha: hoy, nota: "x", proximoContacto: dia(-1) } }),
    );
  });

  await escenario("CHECK: la nota no puede estar vacía", async (tx) => {
    const c = await clienteDePrueba(tx);
    await violaRestriccion("la base rechaza una nota en blanco", "contactos_cobranza_nota_check", () =>
      tx.contactoCobranza.create({ data: { clienteId: c.id, fecha: hoy, nota: "   " } }),
    );
  });

  await escenario("CHECK: la nota tiene un máximo", async (tx) => {
    const c = await clienteDePrueba(tx);
    await violaRestriccion("la base rechaza 501 caracteres", "contactos_cobranza_nota_check", () =>
      tx.contactoCobranza.create({ data: { clienteId: c.id, fecha: hoy, nota: "x".repeat(501) } }),
    );
  });

  await escenario("FK: el cliente tiene que existir", async (tx) => {
    await violaRestriccion("la base rechaza un cliente inexistente", "contactos_cobranza_clienteId_fkey", () =>
      tx.contactoCobranza.create({ data: { clienteId: "00000000-0000-0000-0000-000000000000", fecha: hoy, nota: "x" } }),
    );
  });

  await escenario("Trazabilidad (8.2): quién registró el contacto", async (tx) => {
    const c = await clienteDePrueba(tx);
    const ana = await usuarioDePrueba(tx, "Ana de prueba");
    const { id } = await registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "Con usuario", proximoContacto: null, usuarioId: ana.id });
    const guardado = await tx.contactoCobranza.findUniqueOrThrow({ where: { id }, include: { usuario: { select: { nombre: true } } } });
    comprobar("guarda el usuario", String(guardado.usuarioId === ana.id), "true");
    comprobar("se lee el nombre para mostrar", String(guardado.usuario?.nombre), "Ana de prueba");

    const sin = await registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "Sin usuario", proximoContacto: null, usuarioId: null });
    comprobar("con null queda NULL", String((await tx.contactoCobranza.findUniqueOrThrow({ where: { id: sin.id } })).usuarioId), "null");
    const omitido = await registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "Omitido", proximoContacto: null });
    comprobar("sin pasar usuario queda NULL", String((await tx.contactoCobranza.findUniqueOrThrow({ where: { id: omitido.id } })).usuarioId), "null");

    await violaRestriccion("FK: un usuario inexistente se rechaza", "contactos_cobranza_usuarioId_fkey", () =>
      tx.contactoCobranza.create({ data: { clienteId: c.id, fecha: hoy, nota: "x", usuarioId: "00000000-0000-0000-0000-000000000000" } }),
    );
  });

  await escenario("Un usuario con contactos no se puede borrar (RESTRICT)", async (tx) => {
    const c = await clienteDePrueba(tx);
    const ana = await usuarioDePrueba(tx, "Ana de prueba");
    await registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "x", proximoContacto: null, usuarioId: ana.id });
    await violaRestriccion("ON DELETE RESTRICT", "contactos_cobranza_usuarioId_fkey", () => tx.usuario.delete({ where: { id: ana.id } }));
  });

  await escenario("Un cliente con contactos no se puede borrar (hay historial)", async (tx) => {
    const c = await clienteDePrueba(tx);
    await registrarContactoEnTx(tx, { clienteId: c.id, fecha: hoy, nota: "x", proximoContacto: null });
    await violaRestriccion("ON DELETE RESTRICT", "contactos_cobranza_clienteId_fkey", () => tx.cliente.delete({ where: { id: c.id } }));
  });

  await consultaDePuntaAPunta();
}

/**
 * La consulta real, con la base de verdad: ventas, pagos (uno anulado) y
 * contactos. Mira solo a los clientes de esta prueba (la base puede tener mas).
 */
async function consultaDePuntaAPunta() {
  console.log("--- Consulta: a quién llamar hoy, de punta a punta ---");
  const rotulo = `PRUEBA-REC-${Date.now()}`;
  const creados: { clientes: string[]; ventas: string[]; articulo: string | null; usuario: string | null } = {
    clientes: [],
    ventas: [],
    articulo: null,
    usuario: null,
  };

  try {
    const ids = await prisma.$transaction(async (tx) => {
      const servicio = await tx.articulo.create({
        data: { nombre: `${rotulo} servicio`, precioVenta: d(1000), ivaPct: d(0), esServicio: true },
      });
      creados.articulo = servicio.id;
      const autor = await usuarioDePrueba(tx, `${rotulo} autor`);
      creados.usuario = autor.id;

      /** Cliente con una venta de $1.000 de hace `dias` dias, y un pago opcional. */
      async function conDeuda(clave: string, dias: number, pago?: string, telefono: string | null = "351 455-6677") {
        const cliente = await tx.cliente.create({ data: { nombre: `${rotulo} ${clave}`, telefono } });
        creados.clientes.push(cliente.id);
        const venta = await registrarVentaEnTx(tx, {
          clienteId: cliente.id,
          fecha: dia(-dias),
          observaciones: null,
          entregada: false,
          items: [{ articuloId: servicio.id, cantidad: d(1) }],
          pago: pago ? { monto: d(pago), metodo: "EFECTIVO" } : null,
        });
        creados.ventas.push(venta.id);
        return { cliente, venta };
      }

      const vieja = await conDeuda("vieja", 70);
      const reciente = await conDeuda("reciente", 3, "250", null);
      const saldada = await conDeuda("saldada", 20, "1000");
      const prometio = await conDeuda("prometio", 15);
      const llamadoHoy = await conDeuda("llamado-hoy", 15);
      const promesaVencida = await conDeuda("promesa-vencida", 15);
      const pagoAnulado = await conDeuda("pago-anulado", 40);
      const anulada = await conDeuda("venta-anulada", 50);
      await tx.venta.update({ where: { id: anulada.venta.id }, data: { estado: "ANULADA" } });

      // Un pago anulado no cuenta: el saldo vuelve a ser el total.
      const pagoParcial = await registrarPagoEnTx(tx, { ventaId: pagoAnulado.venta.id, fecha: hoy, monto: d(600), metodo: "EFECTIVO", notas: null });
      await anularPagoEnTx(tx, pagoParcial.id, "Error de carga");

      await registrarContactoEnTx(tx, { clienteId: prometio.cliente.id, fecha: dia(-1), nota: "Pagará el viernes", proximoContacto: dia(3) });
      await registrarContactoEnTx(tx, { clienteId: llamadoHoy.cliente.id, fecha: hoy, nota: "No atendió", proximoContacto: null });
      await registrarContactoEnTx(tx, { clienteId: promesaVencida.cliente.id, fecha: dia(-9), nota: "Dijo que pagaba el lunes", proximoContacto: dia(-2) });
      await registrarContactoEnTx(tx, { clienteId: promesaVencida.cliente.id, fecha: dia(-8), nota: "(segunda nota)", proximoContacto: dia(-2), usuarioId: autor.id });

      return {
        vieja: vieja.cliente.id,
        reciente: reciente.cliente.id,
        saldada: saldada.cliente.id,
        prometio: prometio.cliente.id,
        llamadoHoy: llamadoHoy.cliente.id,
        promesaVencida: promesaVencida.cliente.id,
        pagoAnulado: pagoAnulado.cliente.id,
        anulada: anulada.cliente.id,
      };
    });

    const lista = await getRecordatoriosHoy();
    comprobar("no cayó al respaldo de demostración", String(estadoDemo().activo), "false");
    const mios = lista.filter((r) => r.nombre.startsWith(rotulo));
    const nombre = (r: { nombre: string }) => r.nombre.slice(rotulo.length + 1);

    // vieja (70 d, MAS_60) -> pago-anulado (40 d, HASTA_60) -> promesa-vencida (15 d, HASTA_30) -> reciente (3 d, HASTA_7)
    comprobar("aparecen y en orden", mios.map(nombre).join(","), "vieja,pago-anulado,promesa-vencida,reciente");
    comprobar("saldada no aparece", String(mios.some((r) => r.id === ids.saldada)), "false");
    comprobar("con promesa futura no aparece", String(mios.some((r) => r.id === ids.prometio)), "false");
    comprobar("llamado hoy no aparece", String(mios.some((r) => r.id === ids.llamadoHoy)), "false");
    comprobar("venta anulada no aparece", String(mios.some((r) => r.id === ids.anulada)), "false");

    const v = mios.find((r) => r.id === ids.vieja);
    comprobar("vieja: saldo, días y tramo", `${v?.saldo.toFixed(2)} ${v?.dias} ${v?.tramo}`, "1000.00 70 MAS_60");
    comprobar("vieja: sin nota", String(v?.ultimaNota), "null");
    const pa = mios.find((r) => r.id === ids.pagoAnulado);
    comprobar("pago anulado: el saldo es el total", `${pa?.saldo.toFixed(2)} ${pa?.dias} ${pa?.tramo}`, "1000.00 40 HASTA_60");
    const re = mios.find((r) => r.id === ids.reciente);
    comprobar("reciente: saldo tras pago parcial", `${re?.saldo.toFixed(2)} ${re?.dias} ${re?.tramo}`, "750.00 3 HASTA_7");
    comprobar("reciente: teléfono vacío llega como null", String(re?.telefono), "null");
    comprobar("vieja: teléfono", String(v?.telefono), "351 455-6677");
    const pv = mios.find((r) => r.id === ids.promesaVencida);
    comprobar("promesa vencida: trae la última nota", `${pv?.ultimaNota?.nota} | ${iso(pv?.ultimaNota?.fecha ?? null)} | ${iso(pv?.ultimaNota?.proximoContacto ?? null)}`, `(segunda nota) | ${iso(dia(-8))} | ${iso(dia(-2))}`);
    comprobar("etiqueta del tramo", String(v?.tramoEtiqueta), "Más de 60 días");
    comprobar("registrado por: el nombre de quien cargó la última nota", String(pv?.ultimaNota?.registradoPor), `${rotulo} autor`);
    comprobar("registrado por: sin usuario es null", String(mios.find((r) => r.id === ids.pagoAnulado)?.ultimaNota), "null");

    // Solo lo necesario: nada de costos ni márgenes en la respuesta.
    comprobar("el usuario no viaja: la nota solo trae el nombre", Object.keys(pv?.ultimaNota ?? {}).sort().join(","), "fecha,nota,proximoContacto,registradoPor");
    comprobar(
      "campos devueltos",
      Object.keys(v ?? {}).sort().join(","),
      ["dias", "id", "nombre", "saldo", "telefono", "tramo", "tramoEtiqueta", "ultimaNota"].join(","),
    );

    // Un contacto cargado ahora saca al cliente de la lista de hoy.
    await prisma.$transaction((tx) =>
      registrarContactoEnTx(tx, { clienteId: ids.vieja, fecha: hoy, nota: "Llamé: pide una semana", proximoContacto: dia(7) }),
    );
    const despues = (await getRecordatoriosHoy()).filter((r) => r.nombre.startsWith(rotulo));
    comprobar("tras llamar a 'vieja' ya no figura", despues.map(nombre).join(","), "pago-anulado,promesa-vencida,reciente");
  } finally {
    // Solo los datos de esta prueba (por id), en orden de dependencia.
    await prisma.$transaction([
      prisma.contactoCobranza.deleteMany({ where: { clienteId: { in: creados.clientes } } }),
      prisma.pago.deleteMany({ where: { ventaId: { in: creados.ventas } } }),
      prisma.ventaItem.deleteMany({ where: { ventaId: { in: creados.ventas } } }),
      prisma.movimientoStock.deleteMany({ where: { ventaId: { in: creados.ventas } } }),
      prisma.venta.deleteMany({ where: { id: { in: creados.ventas } } }),
      prisma.articulo.deleteMany({ where: { id: creados.articulo ?? "00000000-0000-0000-0000-000000000000" } }),
      prisma.cliente.deleteMany({ where: { id: { in: creados.clientes } } }),
      prisma.usuario.deleteMany({ where: { id: creados.usuario ?? "00000000-0000-0000-0000-000000000000" } }),
    ]);
    const quedan = await prisma.cliente.count({ where: { nombre: { startsWith: rotulo } } });
    comprobar("sin rastro: no queda ningún cliente de prueba", String(quedan), "0");
    comprobar("sin rastro: no queda ningún usuario de prueba", String(await prisma.usuario.count({ where: { nombre: { startsWith: rotulo } } })), "0");
  }
}

main()
  .catch((error) => {
    console.error(error);
    fallos += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log("");
    console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
    process.exit(fallos === 0 ? 0 : 1);
  });
