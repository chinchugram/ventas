/**
 * Guia de uso (welcome kit). Fuente unica: la pinta `/ayuda` y la puede leer un
 * asistente de ayuda (`guiaComoTexto`). Si cambia una pantalla, se actualiza aca.
 *
 * Texto en voz del producto: segunda persona, frases cortas, sin jerga.
 */

export type PasoArranque = {
  titulo: string;
  texto: string;
  ruta: string;
  /** Se puede saltear sin que el resto deje de funcionar. */
  opcional?: boolean;
};

export type SeccionGuia = {
  id: string;
  titulo: string;
  resumen: string;
  ruta?: string;
  /** Solo la ve el dueño (el empleado no tiene la pantalla). */
  soloDueno?: boolean;
  puntos: string[];
};

export type Pregunta = { pregunta: string; respuesta: string };

export const MODOS =
  "La app tiene dos modos, arriba a la derecha: Simple (lo indispensable: ventas, clientes, cobranzas, artículos y la calculadora de cortes) " +
  "y Avanzado (todo: recetas y margen real, stock, compras, producción, presupuestos, facturas y reportes). Cambiar de modo no borra nada.";

export const INTRO =
  "Esta app responde tres preguntas: qué vendiste, cuánta plata entró y cuánto ganaste de verdad. " +
  "La ganancia sale de las recetas: cada artículo dice qué materiales, horas de máquina y horas de mano de obra lleva, " +
  "y con eso la app calcula el costo y el margen sola.";

/** Orden recomendado para dejar el negocio listo. Cada paso necesita los anteriores. */
export const ARRANQUE: PasoArranque[] = [
  {
    titulo: "Completá los datos del negocio",
    texto:
      "En Configuración: nombre, logo, costo de una hora de mano de obra, IVA por defecto y margen objetivo " +
      "(el margen que querés ganar; los artículos por debajo se marcan en amarillo).",
    ruta: "/configuracion",
  },
  {
    titulo: "Cargá tus máquinas",
    texto:
      "En Configuración → Agregar máquina: láser, plotter, etc., con su costo por hora " +
      "(incluí amortización, energía y consumibles). Las recetas las usan para costear.",
    ruta: "/configuracion/maquinas/nueva",
  },
  {
    titulo: "Cargá tus materiales",
    texto:
      "Lo que comprás y consumís: vinilo, acrílico, MDF, tintas. Para cada uno: unidad (m², m, kg, L, unidad, hoja, rollo), " +
      "costo unitario, stock actual y stock mínimo (para que te avise cuando falta).",
    ruta: "/materiales/nuevo",
  },
  {
    titulo: "Armá tu catálogo con recetas",
    texto:
      "Cada artículo que vendés, con su precio final (con IVA) y su receta: cuánto material, cuántas horas de máquina " +
      "y cuántas de mano de obra lleva. Sin receta el margen es desconocido (la app supone costo 0 y te avisa).",
    ruta: "/catalogo/nuevo",
  },
  {
    titulo: "Cargá tus clientes",
    texto: "Solo el nombre es obligatorio. Si vas a facturar, agregá CUIT o DNI y la condición frente al IVA.",
    ruta: "/clientes/nuevo",
  },
  {
    titulo: "Registrá tu primera venta",
    texto:
      "Elegí cliente y artículos. Al confirmar, la app congela el costo, calcula la ganancia y descuenta el stock. " +
      "Podés marcarla como entregada y registrar lo que te pagaron en el momento.",
    ruta: "/ventas/nueva",
  },
  {
    titulo: "Sumá a tu equipo",
    texto:
      "En Usuarios creás un usuario para cada empleado con una clave inicial. El empleado carga ventas, cobros, " +
      "presupuestos y producción, pero nunca ve costos ni márgenes.",
    ruta: "/usuarios/nuevo",
    opcional: true,
  },
  {
    titulo: "Completá los datos fiscales",
    texto:
      "Razón social, CUIT, condición frente al IVA, domicilio, inicio de actividades y punto de venta. " +
      "Hacen falta para emitir facturas desde una venta.",
    ruta: "/configuracion",
    opcional: true,
  },
];

/**
 * Arranque del modo simple: lo indispensable para vender. Sin máquinas, materiales ni recetas
 * (eso es del modo avanzado, para conocer el margen real).
 */
export const ARRANQUE_SIMPLE: PasoArranque[] = [
  {
    titulo: "Cargá lo que vendés",
    texto: "En Artículos: nombre, precio final (con IVA) y alícuota. La receta es opcional; la sumás cuando quieras saber tu margen.",
    ruta: "/catalogo/nuevo",
  },
  {
    titulo: "Cargá tus clientes",
    texto: "Solo el nombre es obligatorio. Si vas a facturar, agregá CUIT o DNI y la condición frente al IVA.",
    ruta: "/clientes/nuevo",
  },
  {
    titulo: "Registrá tu primera venta",
    texto: "Tocá el botón + , elegí cliente y artículos, y marcá si ya te pagaron. Lo que falte cobrar lo ves en Cobranzas.",
    ruta: "/ventas/nueva",
  },
  {
    titulo: "Poné el nombre y el logo de tu negocio",
    texto: "En Configuración. Salen en el encabezado y en los presupuestos y comprobantes.",
    ruta: "/configuracion",
    opcional: true,
  },
];

/** Qué hace cada pantalla. */
export const SECCIONES: SeccionGuia[] = [
  {
    id: "inicio",
    titulo: "Inicio",
    resumen: "Cómo va el mes, de un vistazo.",
    ruta: "/",
    soloDueno: true,
    puntos: [
      "Ganancia del mes contra tu margen objetivo.",
      "Facturado, cobrado, costo y lo que falta cobrar.",
      "Ventas de los últimos 14 días, últimas ventas y quién te debe.",
      "Avisos: artículos sin receta, debajo de la meta de margen y materiales con stock bajo.",
    ],
  },
  {
    id: "ventas",
    titulo: "Ventas",
    resumen: "Todo lo que vendiste.",
    ruta: "/ventas",
    puntos: [
      "Nueva venta: cliente, artículos y cantidades. El precio sale de la lista del cliente o del catálogo.",
      "Al confirmar se congela el costo: si mañana sube un material, la venta de hoy conserva su ganancia.",
      "Se descuenta el stock de los materiales de la receta (los servicios no descuentan).",
      "La venta puede quedar pendiente o entregada, y cobrada, en parte o impaga.",
      "Solo el dueño puede anular una venta; al anularla vuelve el stock.",
    ],
  },
  {
    id: "presupuestos",
    titulo: "Presupuestos",
    resumen: "Cotizaciones para tus clientes.",
    ruta: "/presupuestos",
    puntos: [
      "Los precios se congelan al guardar. Vale 15 días por defecto.",
      "Se imprime o se manda por WhatsApp con un mensaje ya armado.",
      "\"Convertir en venta\" crea la venta con esos precios, una sola vez.",
      "Uno vencido no se edita: se duplica con los precios de hoy.",
    ],
  },
  {
    id: "clientes",
    titulo: "Clientes",
    resumen: "Tus clientes, sus compras y lo que deben.",
    ruta: "/clientes",
    puntos: [
      "La ficha muestra sus ventas, su saldo y sus pagos.",
      "Desde la ficha se le asigna una lista de precios.",
      "Un cliente con historial no se borra: se da de baja y se puede reactivar.",
    ],
  },
  {
    id: "cobranzas",
    titulo: "Cobranzas y recordatorios",
    resumen: "Quién te debe y a quién llamar hoy.",
    ruta: "/cobranzas",
    puntos: [
      "Registrá pagos contra una venta; una venta admite varios pagos.",
      "El saldo nunca se tipea: siempre se calcula con ventas y pagos.",
      "Recordatorios arma la lista de a quién llamar hoy, lo más viejo primero, con enlace de WhatsApp.",
      "Dejá constancia de cada llamado y, si querés, cuándo volver a contactar.",
    ],
  },
  {
    id: "articulos",
    titulo: "Artículos y recetas",
    resumen: "Lo que vendés, a cuánto y cuánto te cuesta.",
    ruta: "/catalogo",
    soloDueno: true,
    puntos: [
      "Precio final con IVA, alícuota y si es un servicio.",
      "Receta: materiales (cantidad), máquinas (horas) y mano de obra (horas). El costo se calcula solo.",
      "Cuando cambia el costo de un material o de una hora, las recetas y los márgenes se recalculan.",
      "El semáforo compara el margen con tu meta: verde llega, amarillo no llega, rojo pierde plata.",
    ],
  },
  {
    id: "cortes",
    titulo: "Cortes",
    resumen: "Calculadora de precio de una medida.",
    ruta: "/cortes",
    soloDueno: true,
    puntos: ["A partir del precio de la plancha entera, te dice cuánto cobrar por una medida."],
  },
  {
    id: "listas",
    titulo: "Listas de precios",
    resumen: "Precios especiales para ciertos clientes.",
    ruta: "/listas-precios",
    soloDueno: true,
    puntos: [
      "Un descuento general sobre el catálogo y, si hace falta, precios fijos por artículo.",
      "Se asigna desde la ficha del cliente. Te avisa si un precio queda debajo del costo.",
    ],
  },
  {
    id: "materiales",
    titulo: "Materiales y stock",
    resumen: "Lo que hay en el taller.",
    ruta: "/materiales",
    puntos: [
      "Stock actual, mínimo y estado (ok, bajo, sin stock).",
      "Cada material tiene su libro de movimientos: qué entró, qué salió y por qué.",
      "El dueño puede ajustar el stock por conteo.",
      "Un material puede ser insumo, producto de reventa o las dos cosas.",
    ],
  },
  {
    id: "compras",
    titulo: "Compras",
    resumen: "Lo que compraste, a quién y a qué costo.",
    ruta: "/compras",
    soloDueno: true,
    puntos: [
      "Cargar una compra suma el stock de cada material.",
      "Si marcás \"usar estos precios como costo actual\", se actualiza el costo y se recalculan las recetas.",
    ],
  },
  {
    id: "reposicion",
    titulo: "Reposición",
    resumen: "Qué falta comprar.",
    ruta: "/reposicion",
    puntos: ["Lista sugerida con los materiales en o debajo del mínimo."],
  },
  {
    id: "produccion",
    titulo: "Producción",
    resumen: "Lo que realmente se usó en cada trabajo.",
    ruta: "/produccion",
    puntos: [
      "Por cada línea de venta: minutos de máquina, de mano de obra y materiales usados. Viene precargado con la receta.",
      "Se carga desde el celular en el taller, sin ver costos.",
      "Estimar tiempos usa los últimos trabajos del mismo artículo (hacen falta al menos 3).",
      "El dueño ve el margen real (lo usado contra la receta) en Reportes.",
    ],
  },
  {
    id: "comprobantes",
    titulo: "Comprobantes",
    resumen: "Facturas y notas de crédito.",
    ruta: "/comprobantes",
    puntos: [
      "La factura se emite desde una venta. La letra (A, B o C) sale de tu condición y la del cliente.",
      "Hacen falta los datos fiscales completos en Configuración.",
      "Hoy los comprobantes salen SIMULADOS, sin validez fiscal: la conexión con ARCA todavía no está activa.",
      "Solo el dueño emite notas de crédito.",
    ],
  },
  {
    id: "reportes",
    titulo: "Reportes",
    resumen: "Cuánto ganaste y qué se vende.",
    ruta: "/reportes",
    soloDueno: true,
    puntos: [
      "Resumen del período, ganancia por producto, deuda por cliente, consumo de materiales y más vendidos.",
      "Margen real (producción contra receta) y valorización del stock.",
      "Filtro por fechas y descarga en CSV para abrir en Excel.",
    ],
  },
  {
    id: "usuarios",
    titulo: "Usuarios y roles",
    resumen: "Quién puede entrar y qué ve.",
    ruta: "/usuarios",
    soloDueno: true,
    puntos: [
      "Dueño: ve y hace todo.",
      "Empleado: ventas, cobros, entregas, clientes, presupuestos, recordatorios, stock en cantidades, producción y facturas. Nunca ve costos ni márgenes.",
      "El dueño da de alta, cambia el rol, reinicia claves y da de baja usuarios.",
      "Cada uno cambia su propia clave desde su menú.",
    ],
  },
];

export const PREGUNTAS: Pregunta[] = [
  {
    pregunta: "¿Por qué un artículo dice margen desconocido?",
    respuesta: "Porque no tiene receta. Sin receta la app no sabe cuánto cuesta y supone 0. Cargale materiales, máquinas o mano de obra.",
  },
  {
    pregunta: "Subió un material, ¿se arruinan las ventas viejas?",
    respuesta: "No. Cada venta congela su costo al confirmarse. Lo nuevo solo afecta a las ventas que vengan.",
  },
  {
    pregunta: "Me equivoqué en una venta, ¿cómo la corrijo?",
    respuesta: "El dueño la anula (vuelve el stock) y se carga de nuevo. Nada se borra: queda registro de quién hizo cada cosa.",
  },
  {
    pregunta: "¿El empleado ve cuánto gano?",
    respuesta: "No. Los costos y márgenes no llegan nunca a la pantalla del empleado.",
  },
  {
    pregunta: "¿Las facturas son válidas?",
    respuesta: "Todavía no: salen simuladas hasta que se conecte ARCA.",
  },
  {
    pregunta: "Olvidé mi clave.",
    respuesta: "El dueño te la reinicia desde Usuarios. Si sos el dueño, pedila a soporte.",
  },
];

/** La guia entera en texto plano (para un asistente de ayuda o para copiar). */
export function guiaComoTexto(): string {
  const lineas: string[] = ["# Guía de uso", "", INTRO, "", MODOS, "", "## Por dónde empezar (modo simple)"];
  ARRANQUE_SIMPLE.forEach((p, i) => lineas.push(`${i + 1}. ${p.titulo}${p.opcional ? " (opcional)" : ""}: ${p.texto} (ruta: ${p.ruta})`));
  lineas.push("", "## Por dónde empezar (modo avanzado)");
  ARRANQUE.forEach((p, i) => lineas.push(`${i + 1}. ${p.titulo}${p.opcional ? " (opcional)" : ""}: ${p.texto} (ruta: ${p.ruta})`));
  lineas.push("", "## Qué hace cada pantalla");
  for (const s of SECCIONES) {
    lineas.push("", `### ${s.titulo}${s.ruta ? ` (ruta: ${s.ruta})` : ""}${s.soloDueno ? " (solo dueño)" : ""}`, s.resumen);
    s.puntos.forEach((p) => lineas.push(`- ${p}`));
  }
  lineas.push("", "## Preguntas frecuentes");
  PREGUNTAS.forEach((q) => lineas.push("", `**${q.pregunta}**`, q.respuesta));
  return lineas.join("\n");
}
