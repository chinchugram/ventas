# ventas

ERP mínimo para un comercio de corte láser e insumos de marca (stickers, cartelería, rotulación).

El dueño hoy no sabe **qué** vende, **cuánto** cobró en el mes ni **cuánto margen** tiene. Esto
resuelve exactamente eso, sin convertirse en un ERP genérico.

---

## Arranque

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env        # en Windows: copy .env.example .env

# 3. Base de datos (Postgres en Docker)
docker compose up -d db

# 4. Esquema + datos de ejemplo
npm run db:generate
npm run db:deploy
npm run db:seed

# 5. Levantar
npm run dev
```

Abrir <http://localhost:3000>.

El seed carga un comercio de ejemplo con 4 clientes, 5 artículos con receta, 5 materiales,
3 máquinas, 2 compras, 7 ventas (pagadas, sin cobrar y pagadas a medias) y un ajuste por conteo,
para ver las pantallas con información realista antes de cargar nada real. Compras y ventas pasan
por la misma lógica que las pantallas, así que el stock de cada material coincide con su libro de
movimientos.

**Para limpiar los datos de ejemplo y empezar de cero:** `npm run db:reset`

### Modo demo (sin base de datos)

Si Postgres no está levantado, la app **no se rompe**: cada pantalla cae a un juego de datos de
demostración (`src/lib/demo-data.ts`). No son números escritos a mano: costos, márgenes, saldos y
totales salen del mismo motor de costeo que usa la versión con base, así que las pantallas son
coherentes entre sí. Sirve para mostrar el mockup en una reunión sin Docker.

Con base disponible, siempre se usan los datos reales: el respaldo solo entra cuando la base no
responde o la consulta falla (por ejemplo, migraciones pendientes).

### Acceso: usuarios y sesiones

Se entra por `/login` con usuario y clave. Hay dos roles:

- **`DUENO`**: todo.
- **`EMPLEADO`**: carga ventas, registra cobros, marca ventas como entregadas, ve y edita clientes,
  ve el stock (solo cantidades) y la lista de reposición (sin costos). No ve costos ni márgenes y no
  puede anular, tocar el catálogo, cargar compras ni ver reportes. Su pantalla de inicio es
  `/ventas/nueva`.

**Primer dueño:** `npm run usuarios:crear-dueno` pide usuario, nombre y clave (la clave no se ve al
tipearla y se repite para confirmar; mínimo 10 caracteres). También acepta `DUENO_USUARIO`,
`DUENO_CLAVE` y `DUENO_NOMBRE` como variables de entorno. Se niega si ya hay un dueño, aunque esté
dado de baja: los demás usuarios se crean desde `/usuarios`.

- **Sin ningún usuario** el sitio responde 503 con esa instrucción, en cualquier entorno: nunca
  queda abierto.
- **En producción sin base de datos** responde 503.
- **En producción se exige HTTPS.** La cookie de sesión es `Secure` y se llama
  `__Host-ventas_sesion`: por HTTP el navegador la descarta y el login vuelve siempre a `/login`.
- **En desarrollo**, `npm run db:seed` crea `dueno` / `dueno-de-ejemplo` y `empleado` /
  `empleado-de-ejemplo`. Solo fuera de producción.
- **Sin base de datos en desarrollo** (modo demo) se entra como "Demo", un dueño simulado. Las
  acciones no escriben nada y devuelven `SIN_BASE`.
- Las sesiones duran 30 días y se renuevan con el uso. Cerrar sesión, dar de baja a un usuario,
  cambiarle el rol o reiniciarle la clave corta sus sesiones abiertas.
- Desde el quinto fallo seguido, la cuenta queda en pausa: 30 s, luego 1 min, 2 min… hasta 15 min.
  Durante la pausa no se verifica la clave. El mensaje de error no dice si falló el usuario o la clave.
- Los costos y márgenes no se envían al navegador del empleado: no se consultan, no solo se ocultan.

No hay variables de entorno de acceso: solo `DATABASE_URL`. `BASIC_AUTH_USER` y
`BASIC_AUTH_PASSWORD` ya no existen; si el servidor las tenía, se pueden retirar.

Decisiones de seguridad (claves, sesiones, cookies, qué queda fuera): ver
[`docs/seguridad-ola-4-auth.md`](docs/seguridad-ola-4-auth.md).

### Probarlo desde el celular

Con la PC y el celular en la misma Wi-Fi:

```bash
npm run dev -- -H 0.0.0.0
```

Abrir `http://IP-DE-LA-PC:3000`. En desarrollo, Next bloquea los recursos de otras IP: hay que
agregar la IP de la PC en `allowedDevOrigins` de `next.config.ts` (sin eso la página se ve, pero
los botones no responden).

---

## Documentación

| Documento | Qué está |
|---|---|
| [`docs/01-alcance-funcional.md`](docs/01-alcance-funcional.md) | Qué hace el MVP, qué NO hace, y las etapas siguientes |
| [`docs/02-modelo-datos.md`](docs/02-modelo-datos.md) | Entidades, decisiones de diseño y los cálculos derivados |
| [`docs/03-stack-y-decisiones.md`](docs/03-stack-y-decisiones.md) | Stack, con el porqué de cada elección |
| [`docs/05-respaldos.md`](docs/05-respaldos.md) | Respaldo diario, restauración y prueba de restauración |
| [`docs/seguridad-ola-4-auth.md`](docs/seguridad-ola-4-auth.md) | Login, claves, sesiones y permisos: decisiones de seguridad y qué queda fuera |

---

## La idea central: el costo no se tipea, se calcula

Es lo que justifica el proyecto. El costo de un producto sale de su **receta**, que es una
lista de materiales consumidos + horas de máquina + horas de mano de obra:

```
Sticker en vinil 10x15 cm
  0,02 m2  vinil adhesivo        × $4.200   =   $84,00
  0,02 m2  transportador         × $1.400   =   $28,00
  0,10 h   plotter de impresión  × $2.500   =  $250,00
  0,17 h   viniladora            × $1.500   =  $255,00
  0,25 h   mano de obra          × $3.500   =  $875,00
                                    costo   = $1.492,00
                        se vende a          $3.500,00   margen 57,4%
```

Si mañana el vinilo sube de $4.200 a $5.100, **el costo se recalcula solo**. El margen deja de
depender de la memoria del dueño.

Un artículo sin receta tiene costo 0 y el sistema lo marca como **"sin receta"**, en vez de
mostrar un margen del 100% que es una mentira.

---

## Carga de venta

`/ventas/nueva` guarda la venta de verdad cuando hay base de datos con catálogo y clientes.
En pantalla se ven costo, IVA y margen en vivo, pero **al confirmar el servidor recalcula todo
desde la base** (precio, IVA y costo de receta del momento): el navegador solo informa qué se
vendió, cuánto y a quién. En una sola transacción:

- numera la venta correlativa por año,
- congela el costo de cada ítem,
- descuenta el stock de los materiales de cada receta (un movimiento por material; los servicios no descuentan),
- registra el pago inicial, si lo hubo.

**Nunca se frena una venta por falta de stock**: el sistema puede estar desactualizado y el pedido
ya está hecho. Se descuenta lo que hay, el movimiento deja constancia de lo que faltó y la
pantalla avisa.

`/ventas/[id]` muestra el detalle y permite **anular**: la venta queda `ANULADA` (no se borra) y
el stock vuelve exactamente como salió.

Sin base de datos (o sin datos cargados) la pantalla funciona como **simulación en modo demo**:
muestra el comprobante que se generaría, con un aviso, sin escribir nada.

En `/ventas/[id]` también se registran cobros posteriores (varios por venta, nunca más que el
saldo), se anula un pago (queda tachado con su motivo y deja de contar) y se marca la venta como
entregada. `/cobranzas` muestra quién debe, cuánto y desde cuándo.

---

## Pantallas

| Ruta | Qué resuelve |
|---|---|
| `/` | Cómo va el mes: facturado, cobrado, costo, ganancia, márgenes, alertas |
| `/ventas` | Historial de ventas con margen y estado de pago |
| `/ventas/nueva` | Carga de venta: calcula en vivo y guarda (descuenta stock) |
| `/ventas/[id]` | Detalle de una venta, pagos y anulación |
| `/clientes` | Quién es cada cliente y cuánto debe; alta, edición y baja con CUIT validado |
| `/clientes/[id]` | Ficha: ventas, pagos y saldo del cliente |
| `/catalogo` | Costo por receta, precio, margen y precio necesario para la meta |
| `/catalogo/nuevo`, `/catalogo/[id]` | Alta y edición de artículo con editor de receta y costo/margen en vivo |
| `/materiales` | Stock, valorización y avisos de reposición |
| `/materiales/[id]` | Libro de movimientos del material y ajuste por conteo físico |
| `/reposicion` | Materiales en o bajo el mínimo: cuánto comprar (mínimo × factor), costo estimado y botón que arma la compra |
| `/cobranzas` | Quién debe, cuánto y desde cuándo; pagos recientes |
| `/materiales/nuevo`, `/materiales/[id]/editar` | Alta y edición; al cambiar el costo muestra qué artículos cambian de margen |
| `/configuracion` | Nombre del negocio, costo/hora de mano de obra, IVA por defecto, margen objetivo y máquinas |
| `/compras` | Historial de compras; `/compras/nueva` registra una (suma stock y actualiza el costo) |
| `/reportes` | Resumen, ganancia por producto, más rentables, deuda por cliente y consumo de materiales; filtro por mes o rango de fechas en la URL y botón "Exportar CSV" por reporte |
| `/reportes/stock` | Valorización del stock, materiales sin movimiento, consumo real vs teórico y rotación; mismo filtro de fechas |
| `/login` | Entrar con usuario y clave. Es la única pantalla que se ve sin sesión |
| `/usuarios` | Lista de usuarios, con alta, rol, baja y reinicio de clave (solo `DUENO`) |
| `/usuarios/nuevo` | Alta de un usuario: el dueño elige su clave inicial y se la pasa (solo `DUENO`) |
| `/usuarios/[id]` | Ficha de un usuario: cambiar rol, dar de baja o reactivar, reiniciar la clave (solo `DUENO`) |
| `/usuarios/mi-clave` | Cambiar la clave propia; la pide cualquier rol |

Desde la ola 4, el detalle de una venta (y cada cobro) y el libro de movimientos de un material
muestran "Registrado por" con quién lo cargó, y el listado de compras también. Lo anterior a los
usuarios muestra "—".

Todas mobile-first: en celular las tablas se convierten en tarjetas apiladas. El dueño atiende
el mostrador con el teléfono en la mano.

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y arranque de producción |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run db:up` / `db:down` | Levantar / bajar Postgres |
| `npm run db:migrate` | Crear y aplicar una migración (desarrollo) |
| `npm run db:deploy` | Aplicar migraciones (producción) |
| `npm run db:seed` | Cargar datos de ejemplo |
| `npm run db:reset` | **Borra todo** y vuelve a migrar + sembrar |
| `npm run db:studio` | Prisma Studio, para mirar la base |
| `npm run usuarios:crear-dueno` | Crea el primer dueño (pide usuario, nombre y clave); se niega si ya hay un dueño. Ver "Acceso" |
| `npm run db:backup` | `pg_dump` a `backups/`, con rotación de 30 archivos (el servicio `backup` del compose lo hace solo, una vez por día) |
| `npm run db:restore -- ARCHIVO` | Restaura un respaldo (pide confirmar si pisa una base existente). Ver `docs/05-respaldos.md` |
| `npm run test:respaldo` / `test:respaldo:restaurar` | Lógica del aviso de respaldo viejo / prueba de restauración de punta a punta en una base descartable |
| `npm run test:cobranzas` / `test:cobranzas:db` / `test:reposicion` | Cobros y lista de reposición |
| `npm run test:costeo` | Verifica el motor de costeo contra 15 números conocidos |
| `npm run test:stock` | Verifica las cuentas de compras y stock contra números conocidos |
| `npm run test:integridad` | Verifica que los CHECK constraints rechazan datos inválidos |
| `npm run test:acciones` | Compra, venta, anulación y ajuste contra Postgres real (en transacciones que se deshacen) |
| `npm run test:cuit` / `test:recetas` / `test:materiales` / `test:configuracion` | Lógica pura de cada pantalla de altas |
| `npm run test:rango-fechas` / `test:reportes-rango` | Rango de fechas (zona Argentina, bordes de mes y bisiestos) / totales de los reportes contra SQL con filtros del seed |
| `npm run test:csv` | Armado del CSV (separador `;`, decimales con coma, BOM, escape y neutralización de fórmulas) |
| `npm run test:stock-reporte` / `test:consumo` | Valorización, rotación y sin movimiento / consumo real vs teórico, con números armados a mano |
| `npm run test:clientes` / `test:articulos` / `test:materiales:db` / `test:configuracion:db` | Las mismas altas contra Postgres real, sin dejar rastro |
| `npm run test:auth` / `test:auth:db` | Login sin base (claves, pausa por fallos, sesiones, cookies, y que cada página y acción verifica sesión) / el mismo núcleo contra Postgres real, con el alta del dueño |
| `npm run test:permisos` | Matriz rol × acción y qué permiso exige cada acción y página, más acciones reales invocadas con un empleado contra Postgres |
| `npm run test:usuarios` | Administración de usuarios (alta, baja, rol, reinicio de clave, clave propia) contra Postgres de desarrollo o de prueba; se niega con `NODE_ENV=production` |

---

## Reglas del proyecto

Estas son las que sostienen el código. Si alguna se rompe, el sistema empieza a mentir.

1. **El dinero es `Decimal`, siempre.** Prohibido `+`, `*` o template literals con números de
   dinero. Todo pasa por `src/lib/money.ts`. Un redondeo mal aplicado en un subtotal se
   propaga al margen, y el margen es el producto.
2. **Ningún saldo se persiste.** El saldo de un cliente y el estado de pago de una venta se
   *calculan* desde ventas y pagos. No pueden quedar desincronizados porque no existen como dato.
3. **El costo se congela en la venta.** `VentaItem` guarda el costo del momento. Si no, un
   cambio de precio del vinilo reescribiría los márgenes del mes pasado.
4. **La base es la última línea de defensa.** Prisma valida en la app, pero los `CHECK`
   constraints de `prisma/migrations/` validan siempre. Verificables con
   `scripts/test-integridad.sql`.
5. **Baja lógica en todo catálogo.** `activo = false`. Nunca se borra algo con historial.
6. **Server Components finos.** Consultas en `src/lib/queries/`; escrituras como Server Actions
   con Zod en `src/app/**/actions.ts`, que validan y delegan en `src/lib/dominio/` (funciones que
   reciben un `tx`, probadas sin Next por `npm run test:acciones`). Las piezas comunes de las
   acciones (`Resultado`, `SIN_BASE`, decimales con coma, fecha de hoy en Argentina) están en
   `src/lib/acciones.ts`, y las de los formularios en `src/components/form/`. Los componentes
   renderizan, no saben SQL.
7. **Código en inglés, dominio en español.** `costoTotalSnapshot`, `stockMinimo`, `saldoCliente`.
   Lo que hay que entender sin traducciones es el dominio.

---

## Estado actual

**Andamiaje completo y verificado:**

- Esquema Prisma migrado, con 9 `CHECK` constraints, 2 índices parciales y configuración sembrada.
- `prisma/seed.ts` con datos de ejemplo de un comercio de láser.
- `src/lib/costing.ts`: motor de costeo y margen, puro y sin dependencias de infraestructura.
- `src/lib/money.ts`: aritmética decimal y formateo es-AR.
- Consultas del dashboard, catálogo, clientes, materiales, ventas y reportes.
- Las 6 pantallas renderizan con datos reales.
- `/ventas/nueva`: carga de venta que guarda, congela costos y descuenta stock; `/ventas/[id]` permite anularla.
- `npm run test:costeo` (15 comprobaciones) y `npm run test:integridad` (10 casos) pasan.
- `npm run build` y `npm run typecheck` limpios.

**Lo que falta para que sea usable (siguiente paso):**

- [x] Guardado real de la venta: numeración correlativa por año, ítems, costo congelado y descuento de stock
- [x] Formularios de alta/edición de clientes, artículos, materiales y recetas (ola 1 de `docs/04-checklist-olas.md`)
- [x] Registro de pagos sobre ventas existentes, anulación de pagos y cambio de estado (ola 2)
- [x] Página de configuración (costo/hora de mano de obra, IVA, margen objetivo) y máquinas (ola 1)
- [x] Backup automático diario (ola 2): servicio `backup` del compose, restauración probada y aviso en pantalla. Ver `docs/05-respaldos.md`
- [x] Lista de reposición sugerida (ola 2): cierra la etapa 2
- [x] Reportes con filtro de fechas y exportación a CSV, reporte de stock y auditoría de accesibilidad (ola 3). Hallazgos pendientes en `docs/auditoria-ola-3.md`
- [x] Login con usuarios y roles, permisos por rol, trazabilidad (quién cargó cada venta, cobro, compra y movimiento) y administración de usuarios (ola 4)

El plan completo, por olas y pensado para repartir a subagentes en paralelo, está en
`docs/04-checklist-olas.md`.

---

## Notas

**`npm audit` no reporta vulnerabilidades.** Desde la tarea 4.0a (`next` 16.4.3, `zod` 4.6.7,
`prisma` 7.10.1) el resultado es 0. Las que había antes se corrigieron con esas actualizaciones dentro
de los rangos de `package.json`; no hizo falta bajar a Prisma 6. Detalle en `docs/auditoria-ola-3.md`, parte 3.

**Acceso con usuarios y roles** (desde la ola 4). Ya no hay contraseña compartida ni HTTP Basic: cada
persona entra con su usuario. Ver "Acceso: usuarios y sesiones" más arriba.
