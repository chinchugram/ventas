# Checklist por olas

Plan de trabajo para que un agente orquestador reparta tareas a subagentes en paralelo.
Cada **ola** es un conjunto de tareas **independientes entre sí** (no tocan los mismos archivos):
se lanzan juntas y, cuando todas terminan y se integran, empieza la ola siguiente.

Estado al día de hoy: **etapas 1, 2, 3, comercial (ola 7) y la etapa 4 (facturación con emisor simulado) hechas;
olas 0 a 5 y 7 cerradas, salvo la 5.2.** La etapa 4 está hecha sin ARCA real: todo comprobante es simulado y sin
validez fiscal. Pendiente de las etapas 4 a 6 de `docs/01-alcance-funcional.md`: la 5.2 (integración con ARCA,
diferida) y la ola 6 (productividad, etapa 5).

Leyenda: `[x]` hecho · `[ ]` pendiente · `(R)` toca archivos compartidos, ver "Reglas".

---

## Reglas para orquestador y subagentes

**Orquestador**
1. Por cada ola: crear una rama de ola desde la rama base (`ola-N`), lanzar un subagente por
   tarea con `isolation: "worktree"` y rama propia `ola-N-<tarea>` (con guion, por ejemplo `ola-5-5.7`), en
   paralelo. No se usa `ola-N/<tarea>`: git no admite `ola-5/5.7` si ya existe la rama `ola-5`, porque no puede
   haber a la vez una rama `ola-5` y un grupo de ramas `ola-5/...`.
2. Cada subagente recibe: el texto de su tarea, esta sección de reglas y los archivos que le
   pertenecen. Nada más: no hace falta pasarle toda la conversación.
3. Integrar de a una tarea, en el orden listado, corriendo `npm run typecheck` y los tests
   después de cada merge. Si dos tareas chocan en un archivo compartido, resolver acá, no en el subagente.
4. Cerrar la ola solo con todo verde y la lista tildada en este archivo. Recién entonces lanzar la siguiente.
5. Una tarea marcada `(R)` no corre en paralelo con otra `(R)` que toque el mismo archivo compartido.

**Subagente**
1. Trabajar **solo** en los archivos de su tarea. Si necesita tocar uno ajeno, parar y reportarlo.
2. Archivos compartidos (`prisma/schema.prisma`, `src/components/navbar.tsx`, `src/lib/demo-data.ts`,
   `README.md`, `package.json`) **no se editan** salvo que la tarea lo diga. Lo que haga falta ahí
   se devuelve al orquestador como un parche listado en el reporte final.
3. Migraciones: cada ola tiene un rango de timestamps reservado (ver cada ola) para que no
   choquen. Formato `YYYYMMDDHHMMSS_nombre`. Las restricciones van como `CHECK` en el SQL.
4. Convenciones del repo (ver `README.md`, "Decisiones"):
   - Dinero y cantidades con `Decimal` vía `src/lib/money.ts`. Nunca `number`.
   - Escrituras = server actions con `zod`, recalculando todo en el servidor. El cliente solo informa.
   - Lecturas = `src/lib/queries/*` envueltas en `conRespaldo(real, demo)`; las acciones devuelven
     un error claro si no hay base (`dbDisponible()`).
   - Baja lógica (`activo = false`), nunca borrar algo con historial.
   - Mobile-first; código en inglés solo cuando es técnico, dominio en español.
   - Lógica pura en `src/lib/*.ts` con script en `scripts/verificar-*.ts` y comando `npm run test:*`.
5. Verificar antes de reportar: `npm run typecheck`, `npm run test:*` que corresponda y, si hay
   pantalla o acción, probarla en el navegador contra Postgres local (ver "Entorno").
6. Reporte final (corto): qué hizo, archivos tocados, qué verificó y cómo, decisiones que tomó,
   parches pendientes para archivos compartidos.

**Entorno (sesión en la nube, sin Docker)**
```
mkdir -p /tmp/pgdata && chown postgres /tmp/pgdata
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pgdata -A trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata -o '-p 5432 -k /tmp' -l /tmp/pg.log start"
psql -h /tmp -U postgres -c "create user ventas superuser password 'ventas'" -c "create database ventas owner ventas"
cp .env.example .env && npx prisma migrate deploy && npm run db:seed
```
Un Postgres por worktree no hace falta: usar una base distinta por subagente
(`create database ventas_<tarea>` y `DATABASE_URL` propio) y un puerto distinto para `next dev`.
No usar `pkill -f` / `pgrep -f` con texto del comando: matan la propia shell. Usar `fuser -k <puerto>/tcp`.
`next dev` genera `AGENTS.md` y `CLAUDE.md` y modifica `next-env.d.ts`: no commitearlos.

---

## Ola 0 — Fundaciones (en serie, una sola tarea, antes de paralelizar)

Deja listo lo compartido para que la ola 1 no se pise. Migraciones reservadas: `20260110…`.

- [x] **0.1 Navegación y rutas pre-armadas (R)**: agregar al navbar las entradas que usarán las olas
      siguientes (Configuración, Cobranzas), apuntando a páginas stub. Archivo: `navbar.tsx`.
- [x] **0.2 Biblioteca de formularios (R)**: componentes reutilizables en `src/components/form/`
      (campo de texto, número decimal, select, checkbox, botón de envío con estado, bloque de error)
      y un helper de acciones (`src/lib/acciones.ts`) con `Resultado`, `SIN_BASE`, parseo de decimales
      con coma, fecha de hoy en Argentina. Hoy cada formulario repite estas piezas.
- [x] **0.3 Pruebas de acciones contra base real**: script `scripts/test-acciones.ts` (`npm run test:acciones`)
      que levanta lo mínimo para llamar a la lógica de dominio contra Postgres y verifica compra, venta,
      anulación y ajuste. Hoy esos flujos solo se probaron a mano. Extraer la lógica de las acciones a
      funciones que reciban un `tx` para poder llamarlas sin Next.
- [x] **0.4 Datos de ejemplo del stock**: que el seed deje compras y movimientos coherentes con el stock
      inicial (hoy el libro de movimientos arranca vacío). Archivo: `prisma/seed.ts`.

## Ola 1 — Altas y ediciones (paralela, 4 tareas independientes)

Sin esto el dueño no puede cargar nada propio. Cada tarea es dueña de su carpeta.
Migraciones reservadas: `20260120…` (solo si hace falta, p. ej. para índices).

- [x] **1.1 Clientes**: alta, edición y baja lógica; CUIT único (índice parcial ya existe), validación de CUIT.
      Ficha del cliente con ventas, saldo y pagos. Dueña de `src/app/clientes/**`, `src/lib/queries/clientes.ts`.
- [x] **1.2 Materiales**: alta, edición, baja lógica; unidad, mínimo, costo, precio de venta. Al editar el
      costo, mostrar qué artículos cambian de margen. Dueña de `src/app/materiales/**` (salvo `[id]` de movimientos).
- [x] **1.3 Artículos y recetas**: alta/edición de artículo y editor de receta (materiales, máquinas, mano de
      obra, override de costo), con costo y margen en vivo usando `costing.ts`. Dueña de `src/app/catalogo/**`.
- [x] **1.4 Configuración y máquinas**: página de configuración (nombre del negocio, costo/hora de mano de obra,
      IVA por defecto, margen objetivo) y ABM de máquinas. Dueña de `src/app/configuracion/**`.

Al integrar: reemplazar en `demo-data.ts` lo que cada tarea haya dejado como parche pendiente.

## Ola 2 — Cobranzas y reposición (paralela, 3 tareas)

Migraciones reservadas: `20260130…`.

- [x] **2.1 Cobranzas**: registrar pagos sobre una venta existente (varios pagos por venta, nunca más que el
      saldo), ver y anular un pago, saldo por cliente recalculado. Cambio de estado `PENDIENTE → ENTREGADA`
      en la venta. Dueña de `src/app/cobranzas/**` y de acciones nuevas en `src/app/ventas/[id]/`.
- [x] **2.2 Lista de reposición**: materiales bajo mínimo con cantidad sugerida (hasta mínimo × factor
      configurable) y costo estimado de la compra; botón que abre `Nueva compra` con las líneas cargadas.
      Cierra la etapa 2. Dueña de `src/app/reposicion/**`.
- [x] **2.3 Respaldo automático**: `db:backup` ya existe; agregar rotación programada (cron o servicio del
      compose), prueba de restauración documentada y aviso en pantalla si el último respaldo es viejo.
      Dueña de `scripts/**`, `docker-compose.yml`, `src/lib/respaldo-estado.ts`.

## Ola 3 — Reportes y calidad (paralela, 8 tareas en 3 bloques)

- [x] **3.1 Reportes con filtros** (3.1a rango de fechas, 3.1b filtro en los reportes, 3.1c CSV): rango de fechas y mes elegible en los 5 reportes, exportar a CSV.
      Dueña de `src/app/reportes/**`, `src/lib/queries/dashboard.ts`.
- [x] **3.2 Reporte de stock** (3.2a valorización/rotación, 3.2b real vs teórico, 3.2c pantalla): valorización, rotación y materiales sin movimiento; consumo real (movimientos)
      contra consumo teórico (recetas). Dueña de `src/app/reportes/stock/**`.
- [x] **3.3 Calidad** (informe en `docs/auditoria-ola-3.md`; correcciones menores aplicadas, mayores pendientes): auditoría de accesibilidad y mobile (375 px) de todas las pantallas, `npm run build`
      limpio, revisar `npm audit` y documentar. Reporta hallazgos; las correcciones a pantallas ajenas
      las aplica el orquestador.

## Ola 4 — Etapa 3: multi-usuario (saneamiento → serie → paralela)

El modelo cambia en todas partes, por eso arranca con una tarea sola. Migraciones: `20260210…` y `20260215…`.

- [x] **4.0a Dependencias de runtime**: `next` 16.4.3, `zod` 4.6.7, `prisma` 7.10.1; `npm audit` de 9 hallazgos a 0.
- [x] **4.0b Navbar accesible**: hoja "Más" como `<dialog>`, menú de escritorio completo (N1, N2, N5).
- [x] **4.1 Núcleo de autenticación (en serie, primero) (R)**: tablas `Usuario` (rol `DUENO` / `EMPLEADO`) y `Sesion`,
      login con sesión revocable (reemplaza el Basic Auth del `proxy.ts`), scrypt, pausa por fallos, cierre de sesión,
      `usuarioActual()`. Decisiones en `docs/seguridad-ola-4-auth.md`.
- [x] **4.2 Trazabilidad**: `usuarioId` en ventas, pagos, compras y movimientos de stock; "Registrado por" en los detalles.
- [x] **4.3 Permisos por rol**: `src/lib/permisos.ts`; el empleado no recibe costos ni márgenes ni anula; `npm run test:permisos`.
- [x] **4.4 Administración de usuarios**: alta, baja, rol, reseteo y clave propia; `src/app/usuarios/**`; `npm run test:usuarios`.
- [x] **4.5 Documentación**: README, modelo de datos, alcance y checklist.

## Ola 5 — Etapa 4: facturación electrónica (serie → paralela)

Requisito legal. Necesita datos del dueño: CUIT, punto de venta, certificado digital ARCA.
Migraciones: `20260301…`. Hecha con emisor simulado; la integración real (5.2) quedó diferida.

- [x] **5.0 Permisos, navegación y rutas de comprobantes**: permisos de comprobantes, entrada "Comprobantes" en el
      navbar y páginas protegidas.
- [x] **5.1 Modelo y emisor abstracto (en serie, primero) (R)**: tablas `Comprobante` (tipo, punto de venta,
      número, CAE, vencimiento CAE, estado) y una interfaz `EmisorFiscal` con una implementación simulada
      para desarrollo.
- [x] **5.1b Datos fiscales y condición del cliente**: datos fiscales del negocio en `/configuracion` (solo dueño);
      condición frente al IVA y DNI en la ficha del cliente.
- [ ] **5.2 Integración ARCA (WSAA + WSFE)**: **DIFERIDA**. Sin ARCA real todo comprobante es simulado. Ver la guía en
      [`docs/06-facturacion-arca.md`](06-facturacion-arca.md). Autenticación con certificado, solicitud de CAE, manejo de
      errores y reintentos, ambiente de homologación.
- [x] **5.3 Comprobante imprimible/PDF**: Factura A/B con QR fiscal, a partir de una venta.
- [x] **5.4 Notas de crédito**: anulación fiscal total de una factura emitida, con emisor simulado. No esperó a la 5.2.
- [x] **5.5 Facturar desde la venta y listado**: botón "Facturar" en `/ventas/[id]`, `/comprobantes` con filtros, detalle
      y resolución de pendientes.
- [x] **5.6 Guía de facturación con ARCA**: `docs/06-facturacion-arca.md`, qué falta para la integración real y qué necesita el dueño.
- [x] **5.7 Documentación de la ola 5**: README, modelo de datos, esta lista y `docs/fiscal-5.1-decisiones.md` al día.

## Ola 6 — Etapa 5: productividad (paralela, 3 tareas)

Migraciones: `20260401…`.

- [ ] **6.1 Registro de producción**: tiempos y consumos reales por trabajo (máquina, minutos, material medido).
- [ ] **6.2 Margen real**: comparar costo de receta contra costo real y mostrar desvíos por artículo.
- [ ] **6.3 Tiempos por arte**: estimar horas de máquina de un pedido a partir de trabajos anteriores.

## Ola 7 — Etapa 6: comercial (paralela, 3 tareas)

Migraciones: `20260501…` (7.1), `20260510…` (7.2), `20260515…` (7.3), `20260520…` (trazabilidad de la
ola 7, 8.2). Integrada con la ola 4 en "Integración 4+7".

- [x] **7.1 Listas de precios por cliente**: `ListaPrecio`, `ListaPrecioItem`, `resolverPrecio`
      (`src/lib/precios.ts`), override de precio en `registrarVentaEnTx`, pantallas `/listas-precios/**`.
- [x] **7.2 Presupuestos** que se convierten en venta con un clic (reusa `registrarVentaEnTx`, precios
      congelados, sin doble conversión).
- [x] **7.3 Recordatorios de cobranza** (7.3a lógica y datos, 7.3b pantalla `/cobranzas/hoy`): a quién llamar
      hoy, por antigüedad y monto, con enlace de WhatsApp.
- [x] **7.4 Documentación**.

> Límite conocido (7.2): si cambia el IVA de un artículo entre el presupuesto y la conversión, el total
> coincide pero el desglose neto/IVA usa el IVA actual (la conversión avisa).

## Integración 4+7 (hecha)

Ola 4 (multi-usuario) y ola 7 (comercial) unidas en `integracion-4-7`.

- [x] **8.1 Permisos de la ola 7**: `gestionarListasPrecios` (solo `DUENO`), `verPresupuestos`, `cargarPresupuesto`,
      `convertirPresupuesto`, `verRecordatorios` y `registrarContactoCobranza` (`DUENO` y `EMPLEADO`), en
      `src/lib/permisos-pura.ts`. Cada server action y página de listas, presupuestos y `/cobranzas/hoy` las exige.
      La asignación de lista de precios a un cliente también la exige: el empleado no ve ese selector.
- [x] **8.2 Trazabilidad de la ola 7**: `usuarioId` nullable en `Presupuesto`, `ContactoCobranza` y `ListaPrecio`
      (migración `20260520000000_trazabilidad_ola7`). Histórico en `NULL`, se muestra "—".
- [x] **8.3 `npm run test:acceso`**: regresión de autorización por HTTP contra `next build && next start`, con
      una base descartable. Cubre las rutas de la ola 7 y que el empleado no reciba costos ni márgenes.
- [x] **8.4 Documentación**: README, modelo de datos, esta lista y `docs/seguridad-ola-4-auth.md`.

---

## Hecho

- [x] Etapa 1 — MVP: clientes, catálogo, materiales, recetas, ventas, cobranzas (solo lectura), 5 reportes, dashboard.
- [x] Acceso con usuario y contraseña (HTTP Basic) para todo el sitio. *Reemplazado en la ola 4 por login con usuarios y roles.*
- [x] Calculadora de cortes por plancha.
- [x] Etapa 2 — compras con actualización de costo, libro de movimientos, ajuste por conteo físico.
- [x] Etapa 2 — ventas persistidas: numeración por año, costo congelado, descuento de stock, pago inicial, anulación.
