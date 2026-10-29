/**
 * Datos de ejemplo: un comercio de corte laser y rotulacion.
 *
 * Sirven para dos cosas:
 *   1. Ver la app con informacion realista antes de cargar nada real.
 *   2. Revisar que las recetas estan expresadas en las unidades y los valores
 *      que el negocio realmente usa. Si los numeros del seed no se parecen a
 *      los suyos, el modelo esta mal antes de escribir la primera venta real.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import Decimal from "decimal.js";
import { registrarCompraEnTx } from "../src/lib/dominio/compras";
import { ajustarStockEnTx } from "../src/lib/dominio/stock";
import { registrarVentaEnTx } from "../src/lib/dominio/ventas";
import { crearUsuarioEnTx } from "../src/lib/dominio/auth";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const d = (v: number | string) => new Decimal(v);

// Usuarios de ejemplo: SOLO fuera de produccion. En produccion el seed no toca
// usuarios ni sesiones; el primer dueno se crea con `npm run usuarios:crear-dueno`.
const PRODUCCION = process.env.NODE_ENV === "production";
const USUARIOS_DE_EJEMPLO = [
  { usuario: "dueno", clave: "dueno-de-ejemplo", nombre: "Dueño de ejemplo", rol: "DUENO" },
  { usuario: "empleado", clave: "empleado-de-ejemplo", nombre: "Empleado de ejemplo", rol: "EMPLEADO" },
] as const;

async function main() {
  console.log("Limpiando datos de ejemplo...");
  // El orden respeta las FK. No se usa TRUNCATE CASCADE a proposito: si alguien
  // tiene datos reales en esta base, este seed tiene que fallar y no borrarlos.
  await prisma.movimientoStock.deleteMany();
  await prisma.compraItem.deleteMany();
  await prisma.compra.deleteMany();
  await prisma.pago.deleteMany();
  await prisma.ventaItem.deleteMany();
  // Ola 7: presupuestos (antes que las ventas en las que se convirtieron) y contactos de cobranza.
  await prisma.presupuestoItem.deleteMany();
  await prisma.presupuesto.deleteMany();
  await prisma.contactoCobranza.deleteMany();
  await prisma.venta.deleteMany();
  await prisma.recetaComponente.deleteMany();
  await prisma.receta.deleteMany();
  await prisma.listaPrecioItem.deleteMany();
  await prisma.articulo.deleteMany();
  await prisma.material.deleteMany();
  await prisma.maquina.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.listaPrecio.deleteMany();
  if (!PRODUCCION) {
    // Las sesiones antes que los usuarios (FK). Al final: lo de arriba no depende de usuarios.
    await prisma.sesion.deleteMany();
    await prisma.usuario.deleteMany();
  }

  if (PRODUCCION) {
    console.log("Usuarios: en produccion el seed no los toca (ver npm run usuarios:crear-dueno).");
  } else {
    console.log("Creando usuarios de ejemplo...");
    await prisma.$transaction(async (tx) => {
      for (const u of USUARIOS_DE_EJEMPLO) await crearUsuarioEnTx(tx, { ...u });
    });
  }

  console.log("Creando configuracion...");
  await prisma.configuracion.upsert({
    where: { clave: "nombreNegocio" },
    update: { valor: "HL Laser" },
    create: { clave: "nombreNegocio", valor: "HL Laser" },
  });
  await prisma.configuracion.upsert({
    where: { clave: "costoHoraManoObra" },
    update: { valor: "3500" },
    create: { clave: "costoHoraManoObra", valor: "3500" },
  });
  await prisma.configuracion.upsert({
    where: { clave: "margenObjetivo" },
    update: { valor: "45" },
    create: { clave: "margenObjetivo", valor: "45" },
  });

  console.log("Creando maquinas...");
  const plotter = await prisma.maquina.create({
    data: { nombre: "Plotter de impresión", costoHora: d(2500) },
  });
  const laser = await prisma.maquina.create({
    data: { nombre: "Láser CO2", costoHora: d(8000) },
  });
  const viniladora = await prisma.maquina.create({
    data: { nombre: "Viniladora", costoHora: d(1500) },
  });

  // Los materiales arrancan en 0: el stock y el costo salen de las compras de
  // abajo, asi el libro de movimientos explica cada unidad que hay en el taller.
  console.log("Creando materiales...");
  const vinilo = await prisma.material.create({
    data: {
      nombre: "Vinil adhesivo brillante",
      unidad: "M2",
      stockMinimo: d("10"),
      precioVenta: d("9500"),
    },
  });
  const transportador = await prisma.material.create({
    data: {
      nombre: "Transportador (vinil transfer)",
      unidad: "M2",
      stockMinimo: d("10"),
    },
  });
  const lamina = await prisma.material.create({
    data: {
      nombre: "Laminación brillante",
      unidad: "M2",
      stockMinimo: d("8"),
    },
  });
  const mdf = await prisma.material.create({
    data: {
      nombre: "MDF 3mm",
      unidad: "M2",
      stockMinimo: d("6"),
    },
  });
  const acrílico = await prisma.material.create({
    data: {
      nombre: "Acrílico opalino 3mm",
      unidad: "M2",
      stockMinimo: d("4"),
      precioVenta: d("38000"),
    },
  });

  console.log("Creando clientes...");
  const clientes = await Promise.all([
    prisma.cliente.create({
      data: {
        nombre: "Ferretería El Tornillo",
        cuit: "30712345671",
        telefono: "3514123456",
        email: "compras@eltornillo.com.ar",
        direccion: "Av. Colon 1234, Cordoba",
      },
    }),
    prisma.cliente.create({
      data: {
        nombre: "Café La Esquina",
        cuit: "20345678906",
        telefono: "3514556677",
        email: "cafe@laesquina.com",
        direccion: "Bv. San Juan 890, Cordoba",
      },
    }),
    prisma.cliente.create({
      data: {
        nombre: "Estudio Weber",
        telefono: "3514998877",
        email: "hola@estudioweber.com.ar",
      },
    }),
    prisma.cliente.create({
      data: {
        nombre: "Gimnasio Fuerza Total",
        cuit: "30555555551",
        telefono: "3514887766",
      },
    }),
  ]);

  console.log("Creando articulos con receta...");

  // Sticker en vinil: 0,5 m2 de vinilo (por unidad), transportador, laminacion
  // opcional y 6 min de plotter + 10 min de viniladora + 15 min de mano de obra.
  const sticker = await prisma.articulo.create({
    data: {
      nombre: "Sticker en vinil 10x15 cm",
      descripcion: "Vinil adhesivo + corte + aplicación. Precio por unidad.",
      precioVenta: d("3500"),
      ivaPct: d("21"),
    },
  });
  await prisma.receta.create({
    data: {
      articuloId: sticker.id,
      notas: "Rendimiento 10x15 cm = 0,015 m2. Se carga 0,5 m2 por unidad por merma de corte.",
      componentes: {
        create: [
          { tipo: "MATERIAL", materialId: vinilo.id, cantidad: d("0.02") },
          { tipo: "MATERIAL", materialId: transportador.id, cantidad: d("0.02") },
          { tipo: "MAQUINA", maquinaId: plotter.id, cantidad: d("0.1") },
          { tipo: "MAQUINA", maquinaId: viniladora.id, cantidad: d("0.17") },
          { tipo: "MANO_OBRA", cantidad: d("0.25") },
        ],
      },
    },
  });

  // Vinil por m2: mucho menos trabajo por m2, pero incluye solo el corte.
  const vinilMetro = await prisma.articulo.create({
    data: {
      nombre: "Vinil rotulado por m2",
      descripcion: "Incluye impresión, corte y aplicación. Precio por m2.",
      precioVenta: d("18000"),
      ivaPct: d("21"),
    },
  });
  await prisma.receta.create({
    data: {
      articuloId: vinilMetro.id,
      componentes: {
        create: [
          { tipo: "MATERIAL", materialId: vinilo.id, cantidad: d("1") },
          { tipo: "MATERIAL", materialId: transportador.id, cantidad: d("1") },
          { tipo: "MAQUINA", maquinaId: plotter.id, cantidad: d("0.2") },
          { tipo: "MAQUINA", maquinaId: viniladora.id, cantidad: d("0.3") },
          { tipo: "MANO_OBRA", cantidad: d("0.5") },
        ],
      },
    },
  });

  // Cartel en MDF: el material pesa, y el laser se lleva buena parte del costo.
  const cartel = await prisma.articulo.create({
    data: {
      nombre: "Cartel en MDF 40x60 cm",
      descripcion: "Placa grabada a láser, para exhibidores y vidrieras. Precio por unidad.",
      precioVenta: d("28000"),
      ivaPct: d("21"),
    },
  });
  await prisma.receta.create({
    data: {
      articuloId: cartel.id,
      componentes: {
        create: [
          { tipo: "MATERIAL", materialId: mdf.id, cantidad: d("0.24") },
          { tipo: "MAQUINA", maquinaId: laser.id, cantidad: d("0.3") },
          { tipo: "MANO_OBRA", cantidad: d("0.4") },
        ],
      },
    },
  });

  // Rótulo en acrílico: el artículo con mejor margen del catálogo.
  const rotulo = await prisma.articulo.create({
    data: {
      nombre: "Rótulo luminoso en acrílico",
      descripcion: "Acrílico opalino + vinil. Precio por unidad.",
      precioVenta: d("65000"),
      ivaPct: d("21"),
    },
  });
  await prisma.receta.create({
    data: {
      articuloId: rotulo.id,
      componentes: {
        create: [
          { tipo: "MATERIAL", materialId: acrílico.id, cantidad: d("0.15") },
          { tipo: "MATERIAL", materialId: vinilo.id, cantidad: d("0.1") },
          { tipo: "MAQUINA", maquinaId: laser.id, cantidad: d("0.2") },
          { tipo: "MAQUINA", maquinaId: plotter.id, cantidad: d("0.1") },
          { tipo: "MANO_OBRA", cantidad: d("0.5") },
        ],
      },
    },
  });

  // Servicio: diseño. Sin receta a proposito, para que se vea en el dashboard
  // la alerta de "articulo sin receta" y quede claro que el sistema avisa.
  const diseno = await prisma.articulo.create({
    data: {
      nombre: "Diseño de arte (por hora)",
      descripcion: "Diseño vectorial para plotter o láser.",
      precioVenta: d("12000"),
      ivaPct: d("21"),
      esServicio: true,
    },
  });
  void diseno;

  const hoy = new Date();
  const dia = (offset: number) => {
    const f = new Date(hoy);
    f.setDate(f.getDate() - offset);
    return new Date(Date.UTC(f.getFullYear(), f.getMonth(), f.getDate()));
  };
  // Hora del movimiento de stock: media mañana del dia de la operacion.
  const momento = (offset: number) => new Date(dia(offset).getTime() + 13 * 3600_000);

  // Todo pasa por la misma logica que usan las pantallas (src/lib/dominio), asi
  // stock, movimientos, costos congelados y numeracion quedan coherentes.
  await prisma.$transaction(
    async (tx) => {
      console.log("Creando compras...");
      await registrarCompraEnTx(tx, {
        fecha: dia(30),
        proveedor: "Distribuidora Gráfica Centro",
        comprobante: "FC A 0003-00012840",
        notas: "Stock inicial del taller",
        actualizarCosto: true,
        momento: momento(30),
        items: [
          { materialId: vinilo.id, cantidad: d(40), costoUnitario: d(4000) },
          { materialId: transportador.id, cantidad: d(40), costoUnitario: d(1400) },
          { materialId: lamina.id, cantidad: d(30), costoUnitario: d(2100) },
          { materialId: mdf.id, cantidad: d(20), costoUnitario: d(8500) },
          { materialId: acrílico.id, cantidad: d(12), costoUnitario: d(24000) },
        ],
      });
      // Reposicion con aumento del vinilo: las ventas anteriores conservan el
      // costo de $4.000; las posteriores ya salen con $4.200.
      await registrarCompraEnTx(tx, {
        fecha: dia(12),
        proveedor: "Distribuidora Gráfica Centro",
        comprobante: "FC A 0003-00013377",
        notas: null,
        actualizarCosto: true,
        momento: momento(12),
        items: [
          { materialId: vinilo.id, cantidad: d(25), costoUnitario: d(4200) },
          { materialId: mdf.id, cantidad: d(4), costoUnitario: d(8500) },
        ],
      });

      console.log("Creando ventas de ejemplo...");
      // (cliente, [[articulo, cantidad]], cobro, dias atras). Se cargan de la mas
      // vieja a la mas nueva, como habrian entrado de verdad.
      const ventasDemo: {
        cliente: number;
        items: [string, number][];
        cobro: "total" | "mitad" | "nada";
        offset: number;
      }[] = [
        { cliente: 0, items: [[rotulo.id, 4]], cobro: "total", offset: 20 },
        { cliente: 1, items: [[sticker.id, 120], [rotulo.id, 1]], cobro: "nada", offset: 15 },
        { cliente: 3, items: [[vinilMetro.id, 8]], cobro: "total", offset: 11 },
        { cliente: 2, items: [[rotulo.id, 2], [sticker.id, 40]], cobro: "mitad", offset: 8 },
        { cliente: 0, items: [[cartel.id, 6]], cobro: "nada", offset: 6 },
        { cliente: 1, items: [[vinilMetro.id, 3]], cobro: "total", offset: 4 },
        { cliente: 0, items: [[sticker.id, 200]], cobro: "total", offset: 2 },
      ];

      for (const v of ventasDemo) {
        const cliente = clientes[v.cliente]!;
        const venta = await registrarVentaEnTx(tx, {
          clienteId: cliente.id,
          fecha: dia(v.offset),
          observaciones: null,
          entregada: v.offset > 4,
          items: v.items.map(([articuloId, cantidad]) => ({ articuloId, cantidad: d(cantidad) })),
          pago: null,
          momento: momento(v.offset),
        });
        if (venta.advertencias.length > 0) throw new Error(`El seed se quedo sin stock: ${venta.advertencias.join("; ")}`);

        if (v.cobro === "total") {
          await tx.pago.create({
            data: { ventaId: venta.id, clienteId: cliente.id, fecha: dia(v.offset), monto: venta.totalBruto, metodo: "EFECTIVO" },
          });
        } else if (v.cobro === "mitad") {
          // Cobro parcial al dia siguiente: el estado de pago tiene que salir "Parcial".
          await tx.pago.create({
            data: {
              ventaId: venta.id,
              clienteId: cliente.id,
              fecha: dia(v.offset - 1),
              monto: venta.totalBruto.div(2).toDecimalPlaces(2),
              metodo: "TRANSFERENCIA",
              notas: "Anticipo 50%",
            },
          });
        }
      }

      console.log("Ajustando stock por conteo...");
      await ajustarStockEnTx(tx, {
        materialId: lamina.id,
        stockContado: d("29.5"),
        motivo: "Conteo: medio metro dañado al cortar",
      });
    },
    { timeout: 60_000 },
  );

  console.log("");
  console.log("Listo.");
  console.log("  4 clientes, 5 articulos, 5 materiales, 3 maquinas, 2 compras, 7 ventas, 1 ajuste");
  if (!PRODUCCION) {
    console.log(`  Usuarios: ${USUARIOS_DE_EJEMPLO.map((u) => `${u.usuario} / ${u.clave}`).join(", ")} (solo desarrollo)`);
  }
  console.log("  Para verlo: npm run dev");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
