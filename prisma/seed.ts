/**
 * Datos de ejemplo: DOS negocios sembrados (multi-tenant).
 *
 *   - "HL Laser" (slug `hl-laser`): comercio de corte laser y rotulacion. Es el negocio de la
 *     migracion `negocio`; los tests con base lo usan.
 *   - "Taller Demo" (slug `taller-demo`): taller de sublimacion y carteleria en chapa. Nombres,
 *     precios, montos y stock distintos a proposito, para reconocer a simple vista de que
 *     negocio es cada pantalla y para probar el aislamiento (ningun dato de uno aparece en el otro).
 *
 * Sirven para tres cosas:
 *   1. Ver la app con informacion realista antes de cargar nada real.
 *   2. Revisar que las recetas estan expresadas en las unidades y los valores
 *      que el negocio realmente usa. Si los numeros del seed no se parecen a
 *      los suyos, el modelo esta mal antes de escribir la primera venta real.
 *   3. Probar el aislamiento entre negocios entrando como el dueno de cada uno.
 *
 * Cada negocio se siembra dentro de su propio contexto de negocio (`app.negocio_id` fijado con
 * `set_config(..., true)`, igual que `conNegocio` en src/lib/negocio.ts) y pasa por la misma
 * logica de dominio que las pantallas (src/lib/dominio): stock, movimientos, costos congelados
 * y numeracion quedan coherentes por negocio.
 *
 * Conexion: el seed usa el rol dueno del esquema (DATABASE_URL_MIGRACIONES, con BYPASSRLS) porque
 * crea los negocios (la app solo puede leer `negocios`) y limpia las tablas de todos. Sin esa
 * variable cae a DATABASE_URL. No usa `conNegocio` tal cual porque ese helper se niega, en
 * produccion, a correr con un rol que se salta RLS.
 *
 * Usuarios y datos fiscales de ejemplo: SOLO fuera de produccion.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import Decimal from "decimal.js";
import { registrarCompraEnTx } from "../src/lib/dominio/compras";
import { ajustarStockEnTx } from "../src/lib/dominio/stock";
import { registrarVentaEnTx } from "../src/lib/dominio/ventas";
import { crearUsuarioEnTx } from "../src/lib/dominio/auth";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_MIGRACIONES ?? process.env.DATABASE_URL ?? "" }),
});

const d = (v: number | string) => new Decimal(v);

// Usuarios de ejemplo: SOLO fuera de produccion. En produccion el seed no toca
// usuarios ni sesiones; el primer dueno se crea con `npm run usuarios:crear-dueno`.
const PRODUCCION = process.env.NODE_ENV === "production";

type Rol = "DUENO" | "EMPLEADO";
type UnidadMedida = "M2" | "M" | "KG" | "L" | "U" | "HOJA" | "ROLLO";
type Cobro = "total" | "mitad" | "nada";

/** Un negocio de ejemplo completo. Las referencias entre listas son por `clave` (o por posicion, en clientes). */
type NegocioDeEjemplo = {
  slug: string;
  nombre: string;
  usuarios: { usuario: string; clave: string; nombre: string; rol: Rol }[];
  costoHoraManoObra: string;
  margenObjetivo: string;
  /** CUIT ficticio pero valido (digito verificador correcto). Punto de venta 1. */
  fiscal: { razonSocial: string; cuit: string; domicilio: string; inicioActividades: string };
  maquinas: { clave: string; nombre: string; costoHora: number }[];
  materiales: { clave: string; nombre: string; unidad: UnidadMedida; stockMinimo: string; precioVenta?: string }[];
  clientes: { nombre: string; cuit?: string; telefono?: string; email?: string; direccion?: string }[];
  articulos: {
    clave: string;
    nombre: string;
    descripcion: string;
    precioVenta: string;
    esServicio?: boolean;
    /** Sin receta a proposito en los servicios, para que el dashboard muestre la alerta. */
    receta?: {
      notas?: string;
      componentes: ({ material: string; cantidad: string } | { maquina: string; cantidad: string } | { manoDeObra: string })[];
    };
  }[];
  /** Los materiales arrancan en 0: el stock y el costo salen de estas compras. */
  compras: {
    offset: number;
    proveedor: string;
    comprobante: string;
    notas: string | null;
    items: { material: string; cantidad: number; costoUnitario: number }[];
  }[];
  /** (cliente por posicion, [[articulo, cantidad]], cobro, dias atras), de la mas vieja a la mas nueva. */
  ventas: { cliente: number; items: [string, number][]; cobro: Cobro; offset: number }[];
  ajuste: { material: string; stockContado: string; motivo: string };
};

// ─── Negocio 1: HL Laser (corte laser y rotulacion) ────────────────────────────

const HL_LASER: NegocioDeEjemplo = {
  slug: "hl-laser",
  nombre: "HL Laser",
  usuarios: [
    { usuario: "dueno", clave: "dueno-de-ejemplo", nombre: "Dueño de ejemplo", rol: "DUENO" },
    { usuario: "empleado", clave: "empleado-de-ejemplo", nombre: "Empleado de ejemplo", rol: "EMPLEADO" },
  ],
  costoHoraManoObra: "3500",
  margenObjetivo: "45",
  fiscal: {
    razonSocial: "HL Laser de Ejemplo S.R.L.",
    cuit: "20333333334",
    domicilio: "Av. Siempre Viva 742, Córdoba",
    inicioActividades: "2020-03-02",
  },
  maquinas: [
    { clave: "plotter", nombre: "Plotter de impresión", costoHora: 2500 },
    { clave: "laser", nombre: "Láser CO2", costoHora: 8000 },
    { clave: "viniladora", nombre: "Viniladora", costoHora: 1500 },
  ],
  materiales: [
    { clave: "vinilo", nombre: "Vinil adhesivo brillante", unidad: "M2", stockMinimo: "10", precioVenta: "9500" },
    { clave: "transportador", nombre: "Transportador (vinil transfer)", unidad: "M2", stockMinimo: "10" },
    { clave: "lamina", nombre: "Laminación brillante", unidad: "M2", stockMinimo: "8" },
    { clave: "mdf", nombre: "MDF 3mm", unidad: "M2", stockMinimo: "6" },
    { clave: "acrilico", nombre: "Acrílico opalino 3mm", unidad: "M2", stockMinimo: "4", precioVenta: "38000" },
  ],
  clientes: [
    {
      nombre: "Ferretería El Tornillo",
      cuit: "30712345671",
      telefono: "3514123456",
      email: "compras@eltornillo.com.ar",
      direccion: "Av. Colon 1234, Cordoba",
    },
    {
      nombre: "Café La Esquina",
      cuit: "20345678906",
      telefono: "3514556677",
      email: "cafe@laesquina.com",
      direccion: "Bv. San Juan 890, Cordoba",
    },
    { nombre: "Estudio Weber", telefono: "3514998877", email: "hola@estudioweber.com.ar" },
    { nombre: "Gimnasio Fuerza Total", cuit: "30555555551", telefono: "3514887766" },
  ],
  articulos: [
    // Sticker en vinil: vinilo y transportador (por unidad), plotter, viniladora y mano de obra.
    {
      clave: "sticker",
      nombre: "Sticker en vinil 10x15 cm",
      descripcion: "Vinil adhesivo + corte + aplicación. Precio por unidad.",
      precioVenta: "3500",
      receta: {
        notas: "Rendimiento 10x15 cm = 0,015 m2. Se carga 0,5 m2 por unidad por merma de corte.",
        componentes: [
          { material: "vinilo", cantidad: "0.02" },
          { material: "transportador", cantidad: "0.02" },
          { maquina: "plotter", cantidad: "0.1" },
          { maquina: "viniladora", cantidad: "0.17" },
          { manoDeObra: "0.25" },
        ],
      },
    },
    // Vinil por m2: mucho menos trabajo por m2, pero incluye solo el corte.
    {
      clave: "vinilMetro",
      nombre: "Vinil rotulado por m2",
      descripcion: "Incluye impresión, corte y aplicación. Precio por m2.",
      precioVenta: "18000",
      receta: {
        componentes: [
          { material: "vinilo", cantidad: "1" },
          { material: "transportador", cantidad: "1" },
          { maquina: "plotter", cantidad: "0.2" },
          { maquina: "viniladora", cantidad: "0.3" },
          { manoDeObra: "0.5" },
        ],
      },
    },
    // Cartel en MDF: el material pesa, y el laser se lleva buena parte del costo.
    {
      clave: "cartel",
      nombre: "Cartel en MDF 40x60 cm",
      descripcion: "Placa grabada a láser, para exhibidores y vidrieras. Precio por unidad.",
      precioVenta: "28000",
      receta: {
        componentes: [
          { material: "mdf", cantidad: "0.24" },
          { maquina: "laser", cantidad: "0.3" },
          { manoDeObra: "0.4" },
        ],
      },
    },
    // Rótulo en acrílico: el artículo con mejor margen del catálogo.
    {
      clave: "rotulo",
      nombre: "Rótulo luminoso en acrílico",
      descripcion: "Acrílico opalino + vinil. Precio por unidad.",
      precioVenta: "65000",
      receta: {
        componentes: [
          { material: "acrilico", cantidad: "0.15" },
          { material: "vinilo", cantidad: "0.1" },
          { maquina: "laser", cantidad: "0.2" },
          { maquina: "plotter", cantidad: "0.1" },
          { manoDeObra: "0.5" },
        ],
      },
    },
    // Servicio: diseño. Sin receta a proposito, para que se vea en el dashboard
    // la alerta de "articulo sin receta" y quede claro que el sistema avisa.
    {
      clave: "diseno",
      nombre: "Diseño de arte (por hora)",
      descripcion: "Diseño vectorial para plotter o láser.",
      precioVenta: "12000",
      esServicio: true,
    },
  ],
  compras: [
    {
      offset: 30,
      proveedor: "Distribuidora Gráfica Centro",
      comprobante: "FC A 0003-00012840",
      notas: "Stock inicial del taller",
      items: [
        { material: "vinilo", cantidad: 40, costoUnitario: 4000 },
        { material: "transportador", cantidad: 40, costoUnitario: 1400 },
        { material: "lamina", cantidad: 30, costoUnitario: 2100 },
        { material: "mdf", cantidad: 20, costoUnitario: 8500 },
        { material: "acrilico", cantidad: 12, costoUnitario: 24000 },
      ],
    },
    // Reposicion con aumento del vinilo: las ventas anteriores conservan el
    // costo de $4.000; las posteriores ya salen con $4.200.
    {
      offset: 12,
      proveedor: "Distribuidora Gráfica Centro",
      comprobante: "FC A 0003-00013377",
      notas: null,
      items: [
        { material: "vinilo", cantidad: 25, costoUnitario: 4200 },
        { material: "mdf", cantidad: 4, costoUnitario: 8500 },
      ],
    },
  ],
  ventas: [
    { cliente: 0, items: [["rotulo", 4]], cobro: "total", offset: 20 },
    { cliente: 1, items: [["sticker", 120], ["rotulo", 1]], cobro: "nada", offset: 15 },
    { cliente: 3, items: [["vinilMetro", 8]], cobro: "total", offset: 11 },
    { cliente: 2, items: [["rotulo", 2], ["sticker", 40]], cobro: "mitad", offset: 8 },
    { cliente: 0, items: [["cartel", 6]], cobro: "nada", offset: 6 },
    { cliente: 1, items: [["vinilMetro", 3]], cobro: "total", offset: 4 },
    { cliente: 0, items: [["sticker", 200]], cobro: "total", offset: 2 },
  ],
  ajuste: { material: "lamina", stockContado: "29.5", motivo: "Conteo: medio metro dañado al cortar" },
};

// ─── Negocio 2: Taller Demo (sublimacion y carteleria en chapa) ────────────────
// Todo distinto de HL Laser: rubro, nombres, precios, costos, stock y clientes.

const TALLER_DEMO: NegocioDeEjemplo = {
  slug: "taller-demo",
  nombre: "Taller Demo",
  // Mismos nombres de usuario que en HL Laser (el usuario es unico por negocio, no global);
  // claves distintas para no confundir de cual se entra.
  usuarios: [
    { usuario: "dueno", clave: "dueno-taller-demo", nombre: "Dueño del Taller Demo", rol: "DUENO" },
    { usuario: "empleado", clave: "empleado-taller-demo", nombre: "Empleado del Taller Demo", rol: "EMPLEADO" },
  ],
  costoHoraManoObra: "3000",
  margenObjetivo: "38",
  fiscal: {
    razonSocial: "Taller Demo de Ejemplo S.A.",
    cuit: "30711223343",
    domicilio: "Bv. Illia 350, Córdoba",
    inicioActividades: "2022-08-01",
  },
  maquinas: [
    { clave: "prensa", nombre: "Prensa térmica", costoHora: 1800 },
    { clave: "impresora", nombre: "Impresora de sublimación", costoHora: 2200 },
    { clave: "cortadora", nombre: "Cortadora de chapa", costoHora: 5200 },
  ],
  materiales: [
    { clave: "remera", nombre: "Remera lisa blanca poliéster", unidad: "U", stockMinimo: "20" },
    { clave: "taza", nombre: "Taza blanca sublimable", unidad: "U", stockMinimo: "24", precioVenta: "3800" },
    { clave: "papel", nombre: "Papel de sublimación A3", unidad: "HOJA", stockMinimo: "100" },
    { clave: "tinta", nombre: "Tinta de sublimación", unidad: "L", stockMinimo: "4" },
    { clave: "chapa", nombre: "Chapa galvanizada cal. 24", unidad: "M2", stockMinimo: "5", precioVenta: "21000" },
    { clave: "pintura", nombre: "Pintura sintética", unidad: "L", stockMinimo: "4" },
  ],
  clientes: [
    {
      nombre: "Club Atlético Barrio Norte",
      cuit: "30445566779",
      telefono: "3515112233",
      email: "tesoreria@clubbarrionorte.org.ar",
      direccion: "Calle 9 de Julio 560, Córdoba",
    },
    { nombre: "Panadería Doña Rosa", cuit: "27334455667", telefono: "3515667788", direccion: "Av. Rafael Núñez 4100, Córdoba" },
    { nombre: "Colegio San Martín", telefono: "3515990011", email: "administracion@colegiosanmartin.edu.ar" },
    { nombre: "Constructora Ríos", cuit: "30699887761", telefono: "3515224466", email: "obras@constructorarios.com.ar" },
  ],
  articulos: [
    {
      clave: "remera",
      nombre: "Remera sublimada full color",
      descripcion: "Remera poliéster + estampa sublimada. Precio por unidad.",
      precioVenta: "9500",
      receta: {
        componentes: [
          { material: "remera", cantidad: "1" },
          { material: "papel", cantidad: "1" },
          { material: "tinta", cantidad: "0.015" },
          { maquina: "prensa", cantidad: "0.05" },
          { maquina: "impresora", cantidad: "0.03" },
          { manoDeObra: "0.2" },
        ],
      },
    },
    {
      clave: "taza",
      nombre: "Taza sublimada personalizada",
      descripcion: "Taza blanca con diseño del cliente. Precio por unidad.",
      precioVenta: "6200",
      receta: {
        componentes: [
          { material: "taza", cantidad: "1" },
          { material: "papel", cantidad: "0.5" },
          { material: "tinta", cantidad: "0.008" },
          { maquina: "prensa", cantidad: "0.03" },
          { manoDeObra: "0.1" },
        ],
      },
    },
    {
      clave: "cartelChapa",
      nombre: "Cartel de chapa 30x50 cm",
      descripcion: "Chapa cortada y pintada, para frentes de local. Precio por unidad.",
      precioVenta: "21000",
      receta: {
        componentes: [
          { material: "chapa", cantidad: "0.15" },
          { material: "pintura", cantidad: "0.05" },
          { maquina: "cortadora", cantidad: "0.25" },
          { manoDeObra: "0.5" },
        ],
      },
    },
    {
      clave: "cartelObra",
      nombre: "Cartel de obra 1x1 m",
      descripcion: "Chapa pintada con texto reflectivo, para obras. Precio por unidad.",
      precioVenta: "52000",
      receta: {
        componentes: [
          { material: "chapa", cantidad: "1.1" },
          { material: "pintura", cantidad: "0.3" },
          { maquina: "cortadora", cantidad: "0.6" },
          { manoDeObra: "1" },
        ],
      },
    },
    // Servicio sin receta a proposito (alerta "articulo sin receta" del dashboard).
    {
      clave: "estampa",
      nombre: "Diseño de estampa (por hora)",
      descripcion: "Diseño gráfico para sublimación.",
      precioVenta: "8000",
      esServicio: true,
    },
  ],
  compras: [
    {
      offset: 25,
      proveedor: "Insumos Sublimados Córdoba",
      comprobante: "FC A 0007-00004521",
      notas: "Apertura del taller",
      items: [
        { material: "remera", cantidad: 80, costoUnitario: 2800 },
        { material: "taza", cantidad: 120, costoUnitario: 1100 },
        { material: "papel", cantidad: 500, costoUnitario: 90 },
        { material: "tinta", cantidad: 6, costoUnitario: 38000 },
        { material: "chapa", cantidad: 30, costoUnitario: 9500 },
        { material: "pintura", cantidad: 12, costoUnitario: 7200 },
      ],
    },
    // Reposicion con aumento de remeras y pintura.
    {
      offset: 9,
      proveedor: "Insumos Sublimados Córdoba",
      comprobante: "FC A 0007-00004980",
      notas: null,
      items: [
        { material: "remera", cantidad: 40, costoUnitario: 3100 },
        { material: "pintura", cantidad: 6, costoUnitario: 7600 },
      ],
    },
  ],
  ventas: [
    { cliente: 0, items: [["remera", 30]], cobro: "total", offset: 18 },
    { cliente: 2, items: [["taza", 48]], cobro: "mitad", offset: 14 },
    { cliente: 3, items: [["cartelObra", 3]], cobro: "nada", offset: 10 },
    { cliente: 1, items: [["cartelChapa", 4], ["taza", 12]], cobro: "total", offset: 7 },
    { cliente: 0, items: [["remera", 60], ["taza", 36]], cobro: "nada", offset: 5 },
    { cliente: 3, items: [["cartelObra", 2], ["cartelChapa", 6]], cobro: "mitad", offset: 3 },
  ],
  ajuste: { material: "papel", stockContado: "340", motivo: "Conteo: resma húmeda descartada" },
};

// ─── Negocio 3 (perfil "nube"): Claude (impresion 3D y regalos personalizados) ─────
// Solo se siembra con SEED_PERFIL=nube (staging en Neon). Rubro, nombres, precios y clientes propios.

const CLAUDE: NegocioDeEjemplo = {
  slug: "claude",
  nombre: "Claude",
  usuarios: [
    { usuario: "dueno", clave: "dueno-claude", nombre: "Dueño de Claude", rol: "DUENO" },
    { usuario: "empleado", clave: "empleado-claude", nombre: "Empleado de Claude", rol: "EMPLEADO" },
  ],
  costoHoraManoObra: "4000",
  margenObjetivo: "50",
  fiscal: {
    razonSocial: "Claude Impresiones 3D de Ejemplo S.A.S.",
    cuit: "30701234568",
    domicilio: "Av. Hipólito Yrigoyen 120, Córdoba",
    inicioActividades: "2023-05-15",
  },
  maquinas: [
    { clave: "impresora3d", nombre: "Impresora 3D FDM", costoHora: 1200 },
    { clave: "resina", nombre: "Impresora de resina", costoHora: 2000 },
    { clave: "lijado", nombre: "Estación de lijado y pintura", costoHora: 900 },
  ],
  materiales: [
    { clave: "pla", nombre: "Filamento PLA 1,75 mm", unidad: "KG", stockMinimo: "3", precioVenta: "28000" },
    { clave: "petg", nombre: "Filamento PETG 1,75 mm", unidad: "KG", stockMinimo: "2" },
    { clave: "resina", nombre: "Resina fotosensible", unidad: "L", stockMinimo: "1" },
    { clave: "pintura", nombre: "Pintura acrílica", unidad: "L", stockMinimo: "1" },
    { clave: "imanes", nombre: "Imanes de neodimio 10 mm", unidad: "U", stockMinimo: "50" },
  ],
  clientes: [
    { nombre: "Juguetería Mundo Chico", cuit: "30644556677", telefono: "3516001122", email: "pedidos@mundochico.com.ar", direccion: "Av. Vélez Sarsfield 321, Córdoba" },
    { nombre: "Estudio de Arquitectura Pinto", telefono: "3516334455", email: "estudio@pintoarq.com.ar" },
    { nombre: "Mariana López", telefono: "3516778899" },
    { nombre: "Agencia Eventos Cordobeses", cuit: "30688990013", telefono: "3516445566", email: "ventas@eventoscba.com" },
  ],
  articulos: [
    {
      clave: "llavero",
      nombre: "Llavero impreso 3D",
      descripcion: "Llavero personalizado en PLA con imán. Precio por unidad.",
      precioVenta: "2800",
      receta: {
        componentes: [
          { material: "pla", cantidad: "0.015" },
          { material: "imanes", cantidad: "1" },
          { maquina: "impresora3d", cantidad: "0.4" },
          { manoDeObra: "0.05" },
        ],
      },
    },
    {
      clave: "figura",
      nombre: "Figura de resina 10 cm",
      descripcion: "Figura de alto detalle, curada y pintada. Precio por unidad.",
      precioVenta: "24000",
      receta: {
        componentes: [
          { material: "resina", cantidad: "0.08" },
          { material: "pintura", cantidad: "0.02" },
          { maquina: "resina", cantidad: "1.5" },
          { maquina: "lijado", cantidad: "0.5" },
          { manoDeObra: "0.8" },
        ],
      },
    },
    {
      clave: "maqueta",
      nombre: "Maqueta de arquitectura",
      descripcion: "Maqueta en PETG a escala. Precio por unidad.",
      precioVenta: "95000",
      receta: {
        componentes: [
          { material: "petg", cantidad: "0.6" },
          { maquina: "impresora3d", cantidad: "9" },
          { maquina: "lijado", cantidad: "1.5" },
          { manoDeObra: "2" },
        ],
      },
    },
    {
      clave: "soporte",
      nombre: "Soporte de escritorio",
      descripcion: "Soporte para celular y auriculares en PLA. Precio por unidad.",
      precioVenta: "9500",
      receta: {
        componentes: [
          { material: "pla", cantidad: "0.12" },
          { maquina: "impresora3d", cantidad: "2.5" },
          { manoDeObra: "0.15" },
        ],
      },
    },
    // Servicio sin receta a proposito (alerta "articulo sin receta" del dashboard).
    {
      clave: "modelado",
      nombre: "Modelado 3D (por hora)",
      descripcion: "Diseño de piezas a medida.",
      precioVenta: "14000",
      esServicio: true,
    },
  ],
  compras: [
    {
      offset: 28,
      proveedor: "Filamentos del Sur",
      comprobante: "FC A 0002-00009120",
      notas: "Stock inicial",
      items: [
        { material: "pla", cantidad: 12, costoUnitario: 15000 },
        { material: "petg", cantidad: 6, costoUnitario: 17500 },
        { material: "resina", cantidad: 3, costoUnitario: 32000 },
        { material: "pintura", cantidad: 2, costoUnitario: 9000 },
        { material: "imanes", cantidad: 600, costoUnitario: 120 },
      ],
    },
    // Reposicion con aumento del PLA.
    {
      offset: 10,
      proveedor: "Filamentos del Sur",
      comprobante: "FC A 0002-00009544",
      notas: null,
      items: [{ material: "pla", cantidad: 6, costoUnitario: 16200 }],
    },
  ],
  ventas: [
    { cliente: 0, items: [["llavero", 150]], cobro: "total", offset: 19 },
    { cliente: 1, items: [["maqueta", 2]], cobro: "mitad", offset: 14 },
    { cliente: 2, items: [["figura", 3]], cobro: "total", offset: 9 },
    { cliente: 3, items: [["llavero", 300], ["soporte", 20]], cobro: "nada", offset: 6 },
    { cliente: 0, items: [["soporte", 12], ["figura", 2]], cobro: "total", offset: 3 },
  ],
  ajuste: { material: "petg", stockContado: "4.5", motivo: "Conteo: bobina con humedad descartada" },
};

// Perfil por defecto (tests y desarrollo local): dos negocios. Perfil "nube" (SEED_PERFIL=nube,
// para la base de staging en Neon): HL Laser, Claude y Demo (el Taller Demo con otro slug y nombre).
const DEMO: NegocioDeEjemplo = { ...TALLER_DEMO, slug: "demo", nombre: "Demo" };
const NEGOCIOS: NegocioDeEjemplo[] = process.env.SEED_PERFIL === "nube" ? [HL_LASER, CLAUDE, DEMO] : [HL_LASER, TALLER_DEMO];

// Perfil "cuentas" (SEED_PERFIL=cuentas): agrega DOS cuentas sin tocar nada de lo que ya hay en la base
// (no limpia, no pisa). Pensado para el entorno desplegado (que sigue siendo de desarrollo):
//   - negocio `demo`: usuario DEMO / DEMO.1234, con datos de ejemplo.
//   - negocio `hugo`: usuario HUGO / HUGO.1234, SIN datos y con el logo de HL Laser (/marca/logo.png).
// Se corre una sola vez: si el negocio ya tiene usuarios, falla en vez de duplicar.
const CUENTA_DEMO: NegocioDeEjemplo = {
  ...TALLER_DEMO,
  slug: "demo",
  nombre: "Demo",
  usuarios: [{ usuario: "DEMO", clave: "DEMO.1234", nombre: "Demo", rol: "DUENO" }],
};
const CUENTA_HUGO = {
  slug: "hugo",
  nombre: "Hugo",
  logoUrl: "/marca/logo.png",
  usuario: { usuario: "HUGO", clave: "HUGO.1234", nombre: "Hugo", rol: "DUENO" as Rol },
};
const PERFIL_CUENTAS = process.env.SEED_PERFIL === "cuentas";

// ─── Siembra ───────────────────────────────────────────────────────────────────

/**
 * Corre `fn` en una transaccion con el negocio declarado (`app.negocio_id`, transaction-local),
 * como `conNegocio`. Con el rol de la app (sin BYPASSRLS) las politicas RLS tambien rigen aca:
 * el seed no puede escribir filas de otro negocio.
 */
async function conNegocioSeed<T>(negocioId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.negocio_id', ${negocioId}, true)`;
      return fn(tx);
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

function fallar(que: string): never {
  throw new Error(`El seed referencia ${que} que no existe.`);
}

async function limpiar() {
  console.log("Limpiando datos de ejemplo (todos los negocios)...");
  // El orden respeta las FK. No se usa TRUNCATE CASCADE a proposito: si alguien
  // tiene datos reales en esta base, este seed tiene que fallar y no borrarlos.
  // Corre con el rol migrador (BYPASSRLS): borra las filas de todos los negocios.
  await prisma.movimientoStock.deleteMany();
  await prisma.compraItem.deleteMany();
  await prisma.compra.deleteMany();
  await prisma.pago.deleteMany();
  // Ola 5: comprobantes antes que las ventas (FK RESTRICT); las notas de credito
  // antes que sus facturas. Un trigger impide borrar uno que no sea SIMULADO:
  // con comprobantes reales el seed falla, que es lo que tiene que pasar.
  await prisma.comprobante.deleteMany({ where: { comprobanteAsociadoId: { not: null } } });
  await prisma.comprobante.deleteMany();
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
}

/** Alta del usuario solo si no existe en el negocio (el perfil "cuentas" se puede repetir sin romper). */
async function asegurarUsuario(negocioId: string, u: { usuario: string; clave: string; nombre: string; rol: Rol }) {
  await conNegocioSeed(negocioId, async (tx) => {
    const existe = await tx.usuario.findFirst({ where: { negocioId, usuario: u.usuario.toLowerCase() }, select: { id: true } });
    if (existe) return console.log(`  Usuario ${u.usuario} ya existe: se deja como esta.`);
    await crearUsuarioEnTx(tx, { ...u, negocioId });
    console.log(`  Usuario ${u.usuario} creado.`);
  });
}

/** Negocio sin datos: solo el negocio (con su logo), la configuracion minima y su dueno. */
async function sembrarVacio(def: typeof CUENTA_HUGO) {
  const negocio = await prisma.negocio.upsert({
    where: { slug: def.slug },
    update: { nombre: def.nombre, logoUrl: def.logoUrl, activo: true },
    create: { nombre: def.nombre, slug: def.slug, logoUrl: def.logoUrl },
    select: { id: true },
  });
  console.log(`\n== ${def.nombre} (${def.slug}), sin datos ==`);
  await asegurarUsuario(negocio.id, def.usuario);
  await conNegocioSeed(negocio.id, async (tx) => {
    await tx.configuracion.upsert({
      where: { negocioId_clave: { negocioId: negocio.id, clave: "nombreNegocio" } },
      update: { valor: def.nombre },
      create: { negocioId: negocio.id, clave: "nombreNegocio", valor: def.nombre },
    });
  });
}

async function sembrarNegocio(def: NegocioDeEjemplo, { conUsuarios = !PRODUCCION } = {}) {
  // `negocios` es la tabla global (sin RLS). El de HL Laser ya lo crea la migracion; se resuelve por slug.
  const negocio = await prisma.negocio.upsert({
    where: { slug: def.slug },
    update: { nombre: def.nombre, activo: true },
    create: { nombre: def.nombre, slug: def.slug },
    select: { id: true },
  });
  const negocioId = negocio.id;
  console.log(`\n== ${def.nombre} (${def.slug}) ==`);

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
  await conNegocioSeed(negocioId, async (tx) => {
    if (conUsuarios) {
      console.log("Creando usuarios de ejemplo...");
      for (const u of def.usuarios) await crearUsuarioEnTx(tx, { ...u, negocioId });
    }

    console.log("Creando configuracion...");
    const config: Record<string, string> = {
      nombreNegocio: def.nombre,
      costoHoraManoObra: def.costoHoraManoObra,
      margenObjetivo: def.margenObjetivo,
    };
    if (!PRODUCCION) {
      // Datos fiscales de EJEMPLO (ola 5), solo fuera de produccion, para poder
      // facturar con el emisor simulado apenas se levanta el entorno. El CUIT es
      // ficticio pero valido (digito verificador correcto). En produccion los
      // carga el dueno en Configuracion.
      Object.assign(config, {
        fiscalRazonSocial: def.fiscal.razonSocial,
        fiscalCuit: def.fiscal.cuit,
        fiscalCondicionIva: "RESPONSABLE_INSCRIPTO",
        fiscalDomicilio: def.fiscal.domicilio,
        fiscalInicioActividades: def.fiscal.inicioActividades,
        fiscalPuntoVenta: "1",
      });
    }
    for (const [clave, valor] of Object.entries(config)) {
      await tx.configuracion.upsert({ where: { negocioId_clave: { negocioId, clave } }, update: { valor }, create: { negocioId, clave, valor } });
    }

    console.log("Creando maquinas...");
    const maquinas = new Map<string, string>();
    for (const m of def.maquinas) {
      const creada = await tx.maquina.create({ data: { negocioId, nombre: m.nombre, costoHora: d(m.costoHora) } });
      maquinas.set(m.clave, creada.id);
    }

    // Los materiales arrancan en 0: el stock y el costo salen de las compras de
    // abajo, asi el libro de movimientos explica cada unidad que hay en el taller.
    console.log("Creando materiales...");
    const materiales = new Map<string, string>();
    for (const m of def.materiales) {
      const creado = await tx.material.create({
        data: {
          negocioId,
          nombre: m.nombre,
          unidad: m.unidad,
          stockMinimo: d(m.stockMinimo),
          ...(m.precioVenta ? { precioVenta: d(m.precioVenta) } : {}),
        },
      });
      materiales.set(m.clave, creado.id);
    }
    const material = (clave: string) => materiales.get(clave) ?? fallar(`el material "${clave}"`);
    const maquina = (clave: string) => maquinas.get(clave) ?? fallar(`la maquina "${clave}"`);

    console.log("Creando clientes...");
    const clientes = [];
    for (const c of def.clientes) clientes.push(await tx.cliente.create({ data: { negocioId, ...c } }));

    console.log("Creando articulos con receta...");
    const articulos = new Map<string, string>();
    for (const a of def.articulos) {
      const creado = await tx.articulo.create({
        data: {
          negocioId,
          nombre: a.nombre,
          descripcion: a.descripcion,
          precioVenta: d(a.precioVenta),
          ivaPct: d("21"),
          ...(a.esServicio ? { esServicio: true } : {}),
        },
      });
      articulos.set(a.clave, creado.id);
      if (!a.receta) continue;
      await tx.receta.create({
        data: {
          negocioId,
          articuloId: creado.id,
          ...(a.receta.notas ? { notas: a.receta.notas } : {}),
          componentes: {
            create: a.receta.componentes.map((c) =>
              "material" in c
                ? { negocioId, tipo: "MATERIAL" as const, materialId: material(c.material), cantidad: d(c.cantidad) }
                : "maquina" in c
                  ? { negocioId, tipo: "MAQUINA" as const, maquinaId: maquina(c.maquina), cantidad: d(c.cantidad) }
                  : { negocioId, tipo: "MANO_OBRA" as const, cantidad: d(c.manoDeObra) },
            ),
          },
        },
      });
    }

    console.log("Creando compras...");
    for (const c of def.compras) {
      await registrarCompraEnTx(tx, negocioId, {
        fecha: dia(c.offset),
        proveedor: c.proveedor,
        comprobante: c.comprobante,
        notas: c.notas,
        actualizarCosto: true,
        momento: momento(c.offset),
        items: c.items.map((i) => ({ materialId: material(i.material), cantidad: d(i.cantidad), costoUnitario: d(i.costoUnitario) })),
      });
    }

    console.log("Creando ventas de ejemplo...");
    for (const v of def.ventas) {
      const cliente = clientes[v.cliente] ?? fallar(`el cliente #${v.cliente}`);
      const venta = await registrarVentaEnTx(tx, negocioId, {
        clienteId: cliente.id,
        fecha: dia(v.offset),
        observaciones: null,
        entregada: v.offset > 4,
        items: v.items.map(([clave, cantidad]) => ({
          articuloId: articulos.get(clave) ?? fallar(`el articulo "${clave}"`),
          cantidad: d(cantidad),
        })),
        pago: null,
        momento: momento(v.offset),
      });
      if (venta.advertencias.length > 0) throw new Error(`El seed se quedo sin stock (${def.slug}): ${venta.advertencias.join("; ")}`);

      if (v.cobro === "total") {
        await tx.pago.create({
          data: {
            negocioId,
            ventaId: venta.id,
            clienteId: cliente.id,
            fecha: dia(v.offset),
            monto: venta.totalBruto,
            metodo: "EFECTIVO",
          },
        });
      } else if (v.cobro === "mitad") {
        // Cobro parcial al dia siguiente: el estado de pago tiene que salir "Parcial".
        await tx.pago.create({
          data: {
            negocioId,
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
    await ajustarStockEnTx(tx, negocioId, {
      materialId: material(def.ajuste.material),
      stockContado: d(def.ajuste.stockContado),
      motivo: def.ajuste.motivo,
    });
  });

  console.log(
    `  ${def.clientes.length} clientes, ${def.articulos.length} articulos, ${def.materiales.length} materiales, ` +
      `${def.maquinas.length} maquinas, ${def.compras.length} compras, ${def.ventas.length} ventas, 1 ajuste`,
  );
}

async function main() {
  if (PERFIL_CUENTAS) {
    // Solo agrega: no limpia nada (hl-laser, claude y lo que haya cargado quedan como estan).
    // Si `demo` ya tiene datos (p. ej. lo creo el perfil "nube"), no se vuelven a sembrar: solo se agrega DEMO.
    const demo = await prisma.negocio.findUnique({ where: { slug: CUENTA_DEMO.slug }, select: { id: true } });
    const tieneDatos = demo ? (await prisma.cliente.count({ where: { negocioId: demo.id } })) > 0 : false;
    if (demo && tieneDatos) {
      console.log(`\n== ${CUENTA_DEMO.nombre} (${CUENTA_DEMO.slug}): ya tiene datos, solo se agrega el usuario ==`);
      for (const u of CUENTA_DEMO.usuarios) await asegurarUsuario(demo.id, u);
    } else {
      await sembrarNegocio(CUENTA_DEMO, { conUsuarios: true });
    }
    await sembrarVacio(CUENTA_HUGO);
    console.log("\nListo. Entrar en /login:");
    console.log(`  negocio ${CUENTA_DEMO.slug}: DEMO / DEMO.1234 (con datos de ejemplo)`);
    console.log(`  negocio ${CUENTA_HUGO.slug}: HUGO / HUGO.1234 (sin datos, logo de HL Laser)`);
    return;
  }

  await limpiar();

  if (PRODUCCION) {
    console.log("Usuarios: en produccion el seed no los toca (ver npm run usuarios:crear-dueno).");
  }
  for (const def of NEGOCIOS) await sembrarNegocio(def);

  console.log("");
  console.log(`Listo: ${NEGOCIOS.length} negocios (${NEGOCIOS.map((n) => n.slug).join(", ")}).`);
  if (!PRODUCCION) {
    console.log("  Para entrar, el login pide negocio (slug), usuario y clave (solo desarrollo):");
    for (const n of NEGOCIOS) {
      console.log(`    ${n.slug}: ${n.usuarios.map((u) => `${u.usuario} / ${u.clave}`).join(", ")}`);
    }
  }
  console.log('  Verificar: psql "$DATABASE_URL_MIGRACIONES" -v ON_ERROR_STOP=1 -f scripts/check-seed.sql');
  console.log("  Para verlo: npm run dev");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
