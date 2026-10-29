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

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const d = (v: number | string) => new Decimal(v);

async function main() {
  console.log("Limpiando datos de ejemplo...");
  // El orden respeta las FK. No se usa TRUNCATE CASCADE a proposito: si alguien
  // tiene datos reales en esta base, este seed tiene que fallar y no borrarlos.
  await prisma.pago.deleteMany();
  await prisma.ventaItem.deleteMany();
  await prisma.venta.deleteMany();
  await prisma.recetaComponente.deleteMany();
  await prisma.receta.deleteMany();
  await prisma.articulo.deleteMany();
  await prisma.material.deleteMany();
  await prisma.maquina.deleteMany();
  await prisma.cliente.deleteMany();

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

  console.log("Creando materiales...");
  const vinilo = await prisma.material.create({
    data: {
      nombre: "Vinil adhesivo brillante",
      unidad: "M2",
      stockActual: d("45"),
      stockMinimo: d("10"),
      costoUnitario: d("4200"),
      precioVenta: d("9500"),
    },
  });
  const transportador = await prisma.material.create({
    data: {
      nombre: "Transportador (vinil transfer)",
      unidad: "M2",
      stockActual: d("38"),
      stockMinimo: d("10"),
      costoUnitario: d("1400"),
    },
  });
  const lamina = await prisma.material.create({
    data: {
      nombre: "Laminación brillante",
      unidad: "M2",
      stockActual: d("30"),
      stockMinimo: d("8"),
      costoUnitario: d("2100"),
    },
  });
  const mdf = await prisma.material.create({
    data: {
      nombre: "MDF 3mm",
      unidad: "M2",
      stockActual: d("22"),
      stockMinimo: d("6"),
      costoUnitario: d("8500"),
    },
  });
  const acrílico = await prisma.material.create({
    data: {
      nombre: "Acrílico opalino 3mm",
      unidad: "M2",
      stockActual: d("12"),
      stockMinimo: d("4"),
      costoUnitario: d("24000"),
      precioVenta: d("38000"),
    },
  });

  console.log("Creando clientes...");
  const clientes = await Promise.all([
    prisma.cliente.create({
      data: {
        nombre: "Ferretería El Tornillo",
        cuit: "30712345678",
        telefono: "3514123456",
        email: "compras@eltornillo.com.ar",
        direccion: "Av. Colon 1234, Cordoba",
      },
    }),
    prisma.cliente.create({
      data: {
        nombre: "Café La Esquina",
        cuit: "20345678901",
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
        cuit: "30555555555",
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

  console.log("Creando ventas de ejemplo...");

  const costoDe = async (articuloId: string): Promise<Decimal> => {
    const receta = await prisma.receta.findUnique({
      where: { articuloId },
      include: { componentes: { include: { material: true, maquina: true } } },
    });
    if (!receta) return d(0);
    const costoHora = d("3500");
    return receta.componentes.reduce((acc, c) => {
      if (c.costoUnitarioOverride) return acc.plus(c.cantidad.times(c.costoUnitarioOverride));
      if (c.tipo === "MATERIAL") return acc.plus(c.cantidad.times(c.material?.costoUnitario ?? 0));
      if (c.tipo === "MAQUINA") return acc.plus(c.cantidad.times(c.maquina?.costoHora ?? 0));
      return acc.plus(c.cantidad.times(costoHora));
    }, d(0));
  };

  const hoy = new Date();
  const dia = (offset: number) => {
    const f = new Date(hoy);
    f.setDate(f.getDate() - offset);
    return new Date(Date.UTC(f.getFullYear(), f.getMonth(), f.getDate()));
  };

  // (cliente, [[articulo, cantidad]], cobrada?, offsetDias)
  const ventasDemo: {
    cliente: number;
    items: [string, number][];
    cobrada: boolean;
    parcial: boolean;
    offset: number;
  }[] = [
    { cliente: 0, items: [[sticker.id, 200]], cobrada: true, parcial: false, offset: 2 },
    { cliente: 1, items: [[vinilMetro.id, 3]], cobrada: true, parcial: false, offset: 4 },
    { cliente: 0, items: [[cartel.id, 6]], cobrada: false, parcial: false, offset: 6 },
    { cliente: 2, items: [[rotulo.id, 2], [sticker.id, 40]], cobrada: false, parcial: true, offset: 8 },
    { cliente: 3, items: [[vinilMetro.id, 8]], cobrada: true, parcial: false, offset: 11 },
    { cliente: 1, items: [[sticker.id, 120], [rotulo.id, 1]], cobrada: false, parcial: false, offset: 15 },
    { cliente: 0, items: [[rotulo.id, 4]], cobrada: true, parcial: false, offset: 20 },
  ];

  let numero = 1;
  const anio = hoy.getFullYear();

  for (const v of ventasDemo) {
    let totalBruto = d(0);
    let totalNeto = d(0);
    let totalIVA = d(0);
    let costoTotal = d(0);

    const itemsCreate: {
      articuloId: string;
      descripcion: string;
      cantidad: Decimal;
      precioUnitario: Decimal;
      ivaPct: Decimal;
      subtotalNeto: Decimal;
      subtotalIVA: Decimal;
      subtotalBruto: Decimal;
      costoUnitarioSnapshot: Decimal;
      costoTotalSnapshot: Decimal;
    }[] = [];

    for (const [articuloId, cantidad] of v.items) {
      const articulo = await prisma.articulo.findUniqueOrThrow({ where: { id: articuloId } });
      const subtotalBruto = d(cantidad).times(articulo.precioVenta).toDecimalPlaces(2);
      const subtotalNeto = subtotalBruto.div(d(1).plus(articulo.ivaPct.div(100))).toDecimalPlaces(2);
      const subtotalIVA = subtotalBruto.minus(subtotalNeto);

      const costo = await costoDe(articuloId);
      const costoTotalItem = d(cantidad).times(costo).toDecimalPlaces(2);

      totalBruto = totalBruto.plus(subtotalBruto);
      totalNeto = totalNeto.plus(subtotalNeto);
      totalIVA = totalIVA.plus(subtotalIVA);
      costoTotal = costoTotal.plus(costoTotalItem);

      itemsCreate.push({
        articuloId,
        descripcion: articulo.nombre,
        cantidad: d(cantidad),
        precioUnitario: articulo.precioVenta,
        ivaPct: articulo.ivaPct,
        subtotalNeto,
        subtotalIVA,
        subtotalBruto,
        costoUnitarioSnapshot: costo,
        costoTotalSnapshot: costoTotalItem,
      });
    }

    const venta = await prisma.venta.create({
      data: {
        numero,
        anio,
        clienteId: clientes[v.cliente]!.id,
        fecha: dia(v.offset),
        estado: v.offset <= 4 ? "PENDIENTE" : "ENTREGADA",
        totalNeto,
        totalIVA,
        totalBruto,
        costoTotal,
        items: { create: itemsCreate },
      },
    });

    if (v.cobrada) {
      await prisma.pago.create({
        data: {
          ventaId: venta.id,
          clienteId: clientes[v.cliente]!.id,
          fecha: dia(v.offset),
          monto: totalBruto,
          metodo: "EFECTIVO",
        },
      });
    } else if (v.parcial) {
      // Cobro parcial: la mitad. El estado de pago tiene que salir "Parcial".
      await prisma.pago.create({
        data: {
          ventaId: venta.id,
          clienteId: clientes[v.cliente]!.id,
          fecha: dia(v.offset - 1),
          monto: totalBruto.div(2).toDecimalPlaces(2),
          metodo: "TRANSFERENCIA",
          notas: "Anticipo 50%",
        },
      });
    }

    numero += 1;
  }

  console.log("");
  console.log("Listo.");
  console.log("  4 clientes, 5 articulos, 5 materiales, 3 maquinas, 7 ventas");
  console.log("  Para verlo: npm run dev");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
