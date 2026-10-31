# Prompt de sesión: Ola 6 (productividad) con subagentes en paralelo

> Pegar este archivo completo como primer mensaje de una sesión nueva sobre `chinchugram/ventas`.
> Rama base: `staging`. Responder en español, corto y claro.

## Rol

Sos el **orquestador**. Repartís la ola 6 a subagentes en paralelo, integrás de a una tarea y cerrás
la ola solo con todo verde. Antes de empezar leé, en este orden: `README.md`,
`docs/04-checklist-olas.md` (sección "Reglas para orquestador y subagentes" y "Entorno"),
`docs/01-alcance-funcional.md` (etapa 5), `docs/02-modelo-datos.md`, `docs/03-stack-y-decisiones.md`.
Las reglas de ese checklist valen tal cual; este archivo solo las completa.

## Estado de partida

- Olas 0 a 5 y 7 hechas y en `staging`. La facturación usa emisor **simulado**.
- **No tocar la 5.2 (integración con ARCA):** el dueño la dejó para el final y no bloquea nada.
- Staging ya está desplegado en Vercel con Neon. **No migrar ni escribir contra esa base:** todo se
  prueba contra Postgres local (ver "Entorno" del checklist).
- Migraciones nuevas: rango `20260401…` (reservado para la ola 6). Hoy la última migración es
  `20260520000000_trazabilidad_ola7`; el orden de aplicación lo da el timestamp, así que el rango
  `20260401…` queda **antes** de las de la ola 7. Está bien porque las tablas nuevas no dependen de ellas,
  salvo `usuarioId`, que ya existe desde `20260210…`.

## Objetivo de la ola

Pasar de **margen estimado** (costo de receta) a **margen real**: registrar lo que de verdad se usó
en cada trabajo, compararlo con la receta y usarlo para estimar pedidos futuros.

Contexto del dominio, para no inventar: comercio de corte láser e insumos de marca. Hoy el costo de una
venta sale de la receta del artículo (`RecetaComponente`: material, máquina o mano de obra, con
`cantidad`) y se guarda en `Venta.costoTotal`. El stock se descuenta por receta al vender
(`registrarVentaEnTx`, `src/lib/dominio/ventas.ts`; consumo teórico en `src/lib/consumo-teorico.ts`).
Las máquinas (`Maquina.costoHora`) y la mano de obra (costo/hora en configuración) ya existen.

## Plan: una tarea en serie y luego tres en paralelo

### Paso 1 (en serie, primero) (R) — 6.0 Modelo de producción

Un solo subagente. Toca `prisma/schema.prisma` y crea la migración. Nadie más arranca hasta integrarlo.

- Tabla `TrabajoProduccion` (nombre sugerido): `ventaId` o `ventaItemId` (qué se produjo), `fecha`,
  `usuarioId` nullable, `notas`, `creadoEn`/`actualizadoEn`.
- Tabla de **tiempos** por trabajo: `maquinaId`, `minutos` (Decimal), y minutos de mano de obra aparte.
- Tabla de **consumos** por trabajo: `materialId`, `cantidad` real (Decimal 14,3, misma unidad del
  material). Un consumo real **no genera** movimiento de stock por sí solo: ver decisión abierta 1.
- Reglas en el SQL como `CHECK` (cantidades y minutos `>= 0`), índices por `ventaId`, `maquinaId`,
  `materialId`. Baja lógica o `Restrict`, nunca borrado en cascada de algo con historial.
- Permisos nuevos en `src/lib/permisos-pura.ts`: `cargarProduccion` (DUENO y EMPLEADO), `verMargenReal`
  (**solo DUENO**: son costos y márgenes, no pueden llegar al navegador del empleado).
- Migración en `20260401000000_produccion`. Documentar el modelo en `docs/02-modelo-datos.md`.
- Entregable: `npm run db:generate`, `npm run typecheck` y `npx prisma migrate deploy` limpios sobre
  una base local vacía **y** sobre una con el seed.

### Paso 2 (en paralelo, tras integrar 6.0)

Un subagente por tarea, `isolation: "worktree"`, rama `ola-6-<tarea>` (ej. `ola-6-6.1`).

**6.1 Registro de producción** — escritura y pantallas de carga.
- Propiedad: `src/lib/dominio/produccion.ts` (nuevo), `src/lib/produccion.ts` (lógica pura),
  `src/lib/queries/produccion.ts`, `src/app/produccion/**`, `scripts/verificar-produccion.ts`,
  `scripts/test-produccion.ts`.
- Desde el detalle de una venta (o desde `/produccion`) cargar un trabajo: minutos por máquina,
  minutos de mano de obra y materiales realmente usados. Precargar con la receta como sugerencia.
- Server actions con `zod`, recalculando todo en el servidor. Mobile-first: la carga la hace el
  empleado en el taller, desde el celular.
- El detalle de la venta se monta con un cambio mínimo en `src/app/ventas/[id]/page.tsx`
  (único archivo ajeno permitido; avisar en el reporte).

**6.2 Margen real** — comparación y reportes (solo dueño).
- Propiedad: `src/lib/margen-real.ts` (lógica pura), `src/lib/queries/margen-real.ts`,
  `src/app/reportes/margen-real/**`, `scripts/verificar-margen-real.ts`.
- Costo real de un trabajo = consumos reales × costo unitario del material + minutos × costo/hora de
  la máquina + minutos de mano de obra × costo/hora configurado. Comparar con el costo de receta de
  la misma venta y mostrar el desvío por artículo y por período, con filtro de fechas y exportación a
  CSV (reusar `src/lib/rango-fechas.ts` y `src/lib/csv.ts`).
- Todo con `Decimal` vía `src/lib/money.ts`. Sin trabajos cargados, la pantalla lo dice y no rompe.
- Gate de permiso `verMargenReal` en página, acción y CSV. Sumar la ruta a `scripts/test-acceso.ts`
  (el empleado no recibe costos ni márgenes) y a `scripts/auditoria-permisos.ts`.

**6.3 Tiempos por arte** — estimación de horas de máquina.
- Propiedad: `src/lib/estimacion-tiempos.ts` (lógica pura), `src/lib/queries/estimacion-tiempos.ts`,
  `src/app/produccion/estimar/**` (o un bloque en `/presupuestos/nuevo`; decidir y reportar),
  `scripts/verificar-estimacion-tiempos.ts`.
- Dado un conjunto de artículos y cantidades, estimar minutos de máquina y de mano de obra con el
  historial de trabajos del mismo artículo (mediana o promedio de los últimos N, con mínimo de
  muestras). Con pocos datos devolver "sin datos suficientes", **nunca** un número inventado.
- Es de lectura: no escribe nada. Depende solo del modelo 6.0, no del código de 6.1, así que se
  prueba sembrando trabajos directamente.

**6.4 Pendientes de accesibilidad (opcional, independiente)** — de `docs/auditoria-ola-3.md`.
- Propiedad: `src/components/navbar.tsx` y componentes de formulario. **Solo corre si nadie más toca
  el navbar en esta ola** (6.1 puede necesitar un enlace "Producción": en ese caso 6.4 espera o 6.1
  devuelve el parche del navbar al orquestador).
- Alcance: hoja "Más" accesible (foco, trampa de Tab, botón Cerrar, `<dialog>` con `showModal()`),
  `window.confirm()` de baja de máquina unificado con `boton-activo.tsx`, asterisco de obligatorio en
  formularios, montos del gráfico de ventas accesibles a lectores de pantalla.

### Paso 3 (en serie, al final) — 6.5 Documentación

README (sección de la ola 6 y comandos `npm run test:*` nuevos), `docs/01-alcance-funcional.md`
(etapa 5 hecha), `docs/02-modelo-datos.md`, `docs/04-checklist-olas.md` tildado, `package.json`
(scripts `test:produccion`, `test:margen-real`, `test:estimacion-tiempos` y sus `:db`),
`src/lib/demo-data.ts` si alguna pantalla nueva necesita respaldo en modo demo, y el enlace en
`src/components/navbar.tsx`. Estos archivos compartidos los edita **solo el orquestador** con los
parches que devuelvan los subagentes.

## Decisiones abiertas (preguntarle al dueño antes de codificar, no suponer)

1. **¿El consumo real descuenta stock?** Hoy el stock baja por receta al vender. Si además se carga
   consumo real, descontar dos veces sería un error. Opción recomendada: el consumo real **no** toca
   el stock; al cargarlo se ofrece un ajuste por la diferencia contra la receta (movimiento
   `AJUSTE` explícito, con confirmación). Resolver con el dueño y dejarlo escrito en el modelo de datos.
2. **¿Se carga producción por venta o por línea?** Una venta con varios artículos puede tener un
   solo trabajo. Recomendado: por línea de venta (`VentaItem`), porque el desvío se mide por artículo.
3. **¿Quién carga?** Recomendado: empleado y dueño; el margen real lo ve solo el dueño.

Si el dueño no está disponible, tomar las opciones recomendadas, dejarlas anotadas en
`docs/02-modelo-datos.md` y marcarlas como supuesto en el reporte final.

## Reglas que no se negocian (resumen)

- Dinero y cantidades con `Decimal` vía `src/lib/money.ts`. Nunca `number`.
- Escrituras = server actions con `zod`; el servidor recalcula todo, el cliente solo informa.
- Lecturas = `src/lib/queries/*` con `conRespaldo(real, demo)`; acciones con `dbDisponible()`.
- Baja lógica, nunca borrar algo con historial. Trazabilidad con `usuarioId`.
- Permisos: toda página, acción y exportación nueva se clasifica en `src/lib/permisos-pura.ts`.
  El empleado no recibe costos ni márgenes.
- Lógica pura en `src/lib/*.ts` con `scripts/verificar-*.ts` y `npm run test:*`; pruebas con base en
  `scripts/test-*.ts` y `:db`.
- Un subagente no edita archivos compartidos (`prisma/schema.prisma`, `navbar.tsx`, `demo-data.ts`,
  `README.md`, `package.json`): devuelve un parche en su reporte. Excepción: 6.0 con el schema.
- Base propia por subagente (`create database ventas_<tarea>`) y puerto propio para `next dev`.
  No usar `pkill -f` ni `pgrep -f`: usar `fuser -k <puerto>/tcp`.

## Verificación

Cada subagente, antes de reportar: `npm run typecheck`, los `npm run test:*` de su tarea contra
Postgres local, y si hay pantalla, probarla en el navegador (375 px y escritorio) con rol dueño **y**
empleado.

El orquestador, después de **cada** merge: `npm run typecheck`, los tests de la tarea integrada, y al
cierre `npm run build`, `npm run test:acceso`, `npm run test:permisos`, `npm run test:stock`,
`npm run test:costeo` y `npm audit`. Todo verde antes de tildar la ola.

## Reporte final de cada subagente (corto)

Qué hizo · archivos tocados · qué verificó y cómo · decisiones que tomó · parches pendientes para
archivos compartidos.

## Cierre

- Integrar a una rama `ola-6` desde `staging`, de a una tarea y en este orden: 6.0, 6.1, 6.2, 6.3, 6.4,
  6.5. Luego mergear `ola-6` a `staging` con `--no-ff`.
- Tildar la ola 6 en `docs/04-checklist-olas.md` y actualizar el README.
- **Despliegue:** la migración nueva se aplica a mano sobre Neon con
  `DATABASE_URL="<DATABASE_URL_UNPOOLED>" npm run db:deploy`, y recién después se redeploya `staging`
  en Vercel. Si no, la app queda sin las tablas nuevas. Avisarle al dueño; no tocar su base desde
  la sesión.
- No abrir PR salvo que el dueño lo pida.
