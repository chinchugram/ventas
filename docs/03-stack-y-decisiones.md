# Stack y decisiones técnicas

## Decisiones tomadas

| Tema | Decisión | Motivo |
|---|---|---|
| Producto | ERP mínimo: clientes, artículos, materiales, ventas, cobranzas, 5 reportes | El dueño pidió exactamente eso. Todo lo demás es etapa 2+. |
| Comprobantes | Internos, **sin** facturación electrónica | Decisión del dueño. Se agrega ARCA después sin tocar el modelo. |
| Plataforma | Web **responsive, mobile-first** | El mostrador se atiende con el celular en la mano. Diseño mobile-first real, no un desktop comprimido. |
| Usuarios | Varios, con **login y roles** (`DUENO` / `EMPLEADO`, y `SUPERADMIN` para la plataforma) | Desde la etapa 3 (ola 4): cada venta, cobro y compra queda con quién la cargó. Antes, un solo usuario sin login. Ver `docs/seguridad-ola-4-auth.md`. |
| Negocios | **Varios en una sola base**, aislados por Row Level Security | El producto se vende a varios negocios. Decisión y descartes en "Multi-tenant" más abajo; despliegue en `docs/07-multitenant-despliegue.md`. |
| Cobranzas | Sí, cuenta corriente calculada | El negocio vende a crédito. |
| Framework | **Next.js 16** (App Router, React Server Components) | Un solo lenguaje, SSR para que el celular cargue rápido, y Server Actions que eliminan una capa entera de API REST. |
| Lenguaje | **TypeScript** estricto | El dominio es dinero: los tipos son la primera línea de defensa. |
| Base de datos | **PostgreSQL 17** | Numeración correlativa transaccional, CHECK constraints para la integridad de las recetas, aggregating de reportes. |
| ORM | **Prisma 7** (con `@prisma/adapter-pg`) | Migraciones versionadas, tipos derivados del schema, seed. |
| Dinero | `Decimal` de Prisma + `decimal.js` en el browser | **Nunca `float`.** Un redondeo mal aplicado en un subtotal se propaga al margen. |
| Validación | **Zod 4** | Un solo schema por formulario, reutilizado en el server y en el cliente. |
| UI | **Tailwind CSS 4** + componentes propios | Sin librería de UI externa: el diseño es simple, una dependencia menos que mantener. |
| Despliegue | **Docker Compose**: app + Postgres en un VPS (desarrollo y VPS). `staging` corre en **Vercel con Neon** | Un `docker compose up -d` y listo. Backup = copiar un directorio. Para Neon (dos URL, roles, copia previa y vuelta atrás): `docs/07-multitenant-despliegue.md`. |
| Puerto | 3000, expuesto en `0.0.0.0` | El dueño entra desde el celular por la red del negocio. |

## Por qué Next.js y no un CRUD genérico

El costo real de un ERP no está en los formularios, está en **mantenerlo barato de operar**.
Un VPS de USD 5/mes con Docker y un solo proceso es la decisión que hace posible ofrecer esto
a un comercio chico. Cualquier alternativa "moderna" (serverless, microservicios, multi-región)
multiplica el costo y la complejidad sin aportar nada a este problema.

Server Components + Server Actions significan que no existe una capa REST que mantener:
el formulario llama a una función de servidor tipada y listo.

## Por qué Postgres y no SQLite

Se ven tres razones concretas, no preferencias de gusto:

1. **Numeración correlativa de ventas.** `SELECT MAX(numero) FROM ventas WHERE anio = $1` dentro de
   una transacción no es atómico. En Postgres se resuelve con una secuencia por año o con
   `SELECT ... FOR UPDATE`, que sí es atómico. Con SQLite, dos ventas simultáneas en dos
   dispositivos arrancan con el mismo número.
2. **CHECK constraints** para garantizar que una línea de receta de tipo `MATERIAL` tenga
   `materialId` y no `maquinaId`. En el ORM se puede validar, pero la base es la última
   línea de defensa.
3. Los reportes de margen por producto y de consumo de materiales piden `GROUP BY` con
   agregación y window functions. SQLite lo puede, pero con un plan de ejecución penoso.

## Por qué el costo va "congelado" en la venta

Si el costo de un ítem se calculara siempre contra la receta vigente, un cambio de precio del vinilo
reescribiría la historia: los márgenes del mes pasado cambiarían hoy sin que nadie haya tocado
una venta. Eso vuelve inútil el reporte. Por eso `VentaItem` guarda `costoUnitarioSnapshot` y
`costoTotalSnapshot` al momento de confirmar la venta.

El costo **vigente** de la receta se usa solo para (a) mostrar el margen esperado del catálogo y
(b) sugerir precio.

## Estructura del proyecto

```
ventas/
├── docs/                     # Este documento y el modelo de datos
├── prisma/
│   ├── schema.prisma         # Fuente de la verdad del modelo
│   └── seed.ts               # Datos de ejemplo de un comercio de láser
├── src/
│   ├── app/                  # Rutas (App Router) = la UI
│   │   ├── page.tsx          # Dashboard
│   │   ├── <modulo>/         # clientes, catalogo, materiales, ventas, compras, cobranzas,
│   │   │   ├── page.tsx      #   comprobantes, presupuestos, listas-precios, produccion,
│   │   │   └── actions.ts    #   reportes, usuarios, configuracion, login…
│   │   │                     # actions.ts = Server Actions de escritura del módulo
│   │   └── layout.tsx
│   ├── proxy.ts              # Primer filtro de acceso: sesión válida en cada pedido
│   ├── components/           # Componentes compartidos
│   └── lib/
│       ├── prisma.ts         # Cliente singleton (rol ventas_app)
│       ├── negocio.ts        # conNegocio(negocioId, fn): contexto para RLS
│       ├── costing.ts        # Motor de costeo y margen (sin DB, puro y testeable)
│       ├── money.ts          # Aritmética decimal
│       ├── queries/          # Lecturas agrupadas por dominio
│       ├── dominio/          # Reglas de negocio con transacción (ventas, pagos, stock,
│       │                     #   comprobantes…), llamadas desde las actions
│       └── fiscal/           # Emisor fiscal abstracto + emisor simulado (ARCA pendiente)
├── docker-compose.yml
└── .env.example
```

## Convenciones

- **Todo el dinero es `Decimal`.** Funciones de `lib/money.ts` para sumar y redondear. Prohibido
  `+`, `*` y template literals con números de dinero.
- **Toda consulta de negocio va en `lib/queries/`**, nunca en un componente. Los Server Components
  son finos: piden datos y renderizan.
- **Toda escritura va en `src/app/<modulo>/actions.ts`** como Server Action validada con Zod; la lógica transaccional vive en `src/lib/dominio/`.
- **Nombres de dominio en español**, código en inglés. El dominio es lo que hay que entender
  sin traducciones: `costoTotalSnapshot`, `stockMinimo`, `saldoCliente`.
- Soft delete (`activo = false`) en todo catálogo. Nunca se borra algo con historial.

## Multi-tenant: aislamiento entre negocios con RLS (épico VTA-4)

El producto se vende a varios negocios. Todos comparten **una sola base Postgres** y el aislamiento **lo fuerza Postgres**, no el
código: si una consulta olvida el `WHERE "negocioId" = …`, la base igual no devuelve (ni deja escribir) filas de otro negocio.

### Decisión y descartes

| Decisión | Por qué / qué se descartó |
|---|---|
| Una base, columna `negocioId` en cada tabla de datos | Un esquema de Postgres (o una base) por negocio se descartó: complica las migraciones (hay que repetirlas por cada negocio) y no escala con Neon. |
| Aislamiento con Row Level Security, no solo con filtros en el código | Fugar datos entre negocios es el mayor riesgo de un producto vendido. Con solo `WHERE` en ~84 lecturas de Prisma y SQL crudo, un olvido filtra datos. Con RLS un olvido devuelve vacío. |
| El negocio sale de la **sesión**, nunca de un parámetro del cliente | `getNegocioId()` lo resuelve desde la cookie y la fila de `sesiones`; la cookie `<negocioId>.<token>` solo da la pista para abrir el contexto, no otorga nada (`src/lib/auth-pura.ts`). |
| Contexto por transacción (`set_config(…, true)`), nunca `SET` de sesión | Una conexión reutilizada (pool, PgBouncer de Neon en modo *transaction*) no puede arrastrar el negocio de otro pedido. Ver "Neon en modo pooled". |
| `negocioId` también en las tablas hijas | Cuesta una columna por fila y permite que RLS filtre sin joins. Que hijo y padre sean del mismo negocio lo exigen **triggers** (`negocio_igual_al_padre`), no claves foráneas compuestas, que obligarían a cambiar todas las relaciones de Prisma. `negocioId` es inmutable. |
| Únicos por negocio | `ventas(negocioId, anio, numero)`, CUIT de cliente, usuario, lista, series de comprobantes y `Configuracion(negocioId, clave)`. Sin esto dos negocios se chocarían (`docs/02-modelo-datos.md`). |
| Un usuario pertenece a **un** negocio; el rol `SUPERADMIN` no tiene ninguno | Da de alta los negocios y su primer dueño, y no ve datos de ninguno (solo nombre, estado y cantidad de usuarios). Se crea solo desde la terminal (`npm run usuarios:crear-superadmin`) y entra al login con el negocio reservado `admin`. |
| Login por negocio | `/login` pide negocio (`slug`), usuario y clave. El mismo nombre de usuario puede repetirse entre negocios. **Las sesiones con la cookie anterior al multi-tenant dejan de valer.** |

| Pieza | Cómo funciona |
|---|---|
| Contexto | `conNegocio(negocioId, fn)` (`src/lib/negocio.ts`): abre una transacción Prisma, ejecuta `SELECT set_config('app.negocio_id', $1, true)` (equivale a `SET LOCAL`) y corre `fn(tx)`. **Toda** lectura/escritura de datos pasa por ahí. |
| Políticas | Migración `20260601020000_rls`: en cada una de las 26 tablas con `negocioId`, `ENABLE` + `FORCE ROW LEVEL SECURITY` y una política `aislamiento_negocio` `FOR ALL` con `USING` y `WITH CHECK` iguales: `"negocioId" = NULLIF(current_setting('app.negocio_id', true), '')::uuid`. |
| Falla cerrado | Sin `app.negocio_id` la comparación es contra `NULL`: no se ve ni se escribe nada. El `NULLIF` evita que el `''` que deja Postgres tras la transacción rompa con "invalid input syntax for type uuid". |
| SUPERADMIN | `conSuperadmin` declara `app.superadmin = 'on'` (también por transacción). En `usuarios` y `sesiones` la política suma una rama: con esa marca se ven y escriben las filas con `negocioId` NULL (la cuenta y las sesiones del SUPERADMIN); un contexto de negocio nunca las ve, y el de SUPERADMIN no ve ni toca usuarios, sesiones ni datos de ningún negocio. Un CHECK exige `rol = 'SUPERADMIN'` ⇔ sin negocio (`20260601030100_superadmin_sesiones_rls`). |
| `negocios` | Tabla global **con RLS** desde esa migración: la lectura es libre (el login resuelve slug → id antes de tener contexto); el alta y los cambios solo con `app.superadmin = 'on'`; nunca `DELETE` (baja lógica). |
| `usuarios_por_negocio()` | Función `SECURITY DEFINER` que devuelve solo conteos (usuarios y activos por negocio) y solo responde con `app.superadmin = 'on'`. Corre con los permisos de su dueño, el migrador: **requiere que el migrador tenga `BYPASSRLS`**; si no, devuelve 0 filas (falla cerrado, nunca datos de más). Sin `EXECUTE` para `PUBLIC`. |
| Tablas nuevas | Cada migración que cree una tabla con `negocioId` debe traer su `ENABLE/FORCE RLS`, la política y el `GRANT` a `ventas_app` (no hay `DEFAULT PRIVILEGES` a propósito). `npm run test:rls` falla si una tabla con `negocioId` no tiene RLS. |

### Dos roles de base y dos `DATABASE_URL`

Un superusuario o un rol con `BYPASSRLS` **se salta las políticas** (aunque la tabla tenga `FORCE`), así que la
app nunca debe conectarse con uno.

| Rol | Para qué | Atributos | Variable |
|---|---|---|---|
| `ventas_app` | La app en runtime | `NOSUPERUSER NOBYPASSRLS`, no es dueño de nada; `SELECT/INSERT/UPDATE/DELETE` en las tablas de datos; en `negocios` `SELECT/INSERT/UPDATE` (nunca `DELETE`; escribir exige contexto de SUPERADMIN por RLS); `EXECUTE` sobre `usuarios_por_negocio()`; sin acceso a `_prisma_migrations` | `DATABASE_URL` |
| `ventas_migrador` | `prisma migrate deploy`, backfills, siembra, los scripts de alta y de respaldo | Dueño de la base y de las tablas, `BYPASSRLS` | `DATABASE_URL_MIGRACIONES` |

- Local: `psql "$ADMIN_URL" -f scripts/crear-roles-db.sql` (idempotente; claves de desarrollo `ventas_app` / `ventas_migrador`,
  o `-v app_password="'…'" -v migrador_password="'…'"`). La base tiene que ser del migrador (`ALTER DATABASE … OWNER TO ventas_migrador`;
  si no, `prisma migrate deploy` falla con "permission denied for database"). Migrar con esa URL: `npm run db:deploy`.
- **`scripts/crear-roles-db.sql` hay que re-correrlo después de migrar y después de restaurar un respaldo completo.** Las migraciones
  otorgan permisos a `ventas_app` solo si el rol ya existe al migrar, y el volcado de `pg_dump` va sin permisos. `ventas_app` necesita
  `INSERT`/`UPDATE` sobre `negocios` y `EXECUTE` sobre `usuarios_por_negocio()`. `scripts/verificar-roles-db.sql` (solo lee) comprueba el
  resultado, incluido que el migrador tenga `BYPASSRLS`, que `ventas_app` no lo herede y que la función no sea ejecutable por `PUBLIC`.
- `src/lib/prisma.ts` usa `DATABASE_URL` (rol de la app). `conNegocio` verifica una vez por proceso que el rol no se salte RLS:
  en producción es un error (salvo `PERMITIR_ROL_CON_BYPASS_RLS=1`, solo para emergencias), en desarrollo un aviso.
- `prisma.config.ts` usa `DATABASE_URL_MIGRACIONES` si existe y, si no, `DATABASE_URL`: `npm run db:deploy`, `db:seed` y los scripts
  de alta (`usuarios:crear-dueno`, `usuarios:crear-superadmin`) toman solos la URL del migrador. `DATABASE_URL_MIGRACIONES` no va nunca a la app ni a Vercel.
- En Neon: `DATABASE_URL` con el host *pooled* (`-pooler`) y `DATABASE_URL_MIGRACIONES` con el directo (lo que otros documentos llaman
  `DATABASE_URL_UNPOOLED`). El despliegue está en `docs/07-multitenant-despliegue.md`.

### Neon en modo pooled

`set_config('app.negocio_id', …, true)` solo vive hasta el fin de la **transacción**. Por eso `conNegocio` usa siempre una
transacción interactiva (una sola conexión de punta a punta, también detrás de PgBouncer en modo transaction) y nunca `SET`
de sesión. `npm run test:rls` comprueba contra Postgres local: que la conexión queda sin contexto tras `COMMIT` y tras `ROLLBACK`
(pool de 1 conexión, forzando la reutilización), que 40 `conNegocio` concurrentes mezclando A y B ven siempre solo lo suyo y que
las consultas sueltas posteriores sobre el pool no ven nada.

**Pendiente de probar en Neon, NO probado:** nunca se corrió contra el host `-pooler` de Neon. Hay que correr `npm run test:rls`
apuntando a una **rama de Neon de pruebas** (no a producción) con `DATABASE_URL` pooled. Los scripts de prueba se niegan hoy a correr
contra un host que no sea local, a propósito: habilitarlo para esa prueba es una decisión del product owner. Hasta entonces, la primera
verificación real es el login y una venta en `staging` tras el despliegue (`docs/07-multitenant-despliegue.md`, pasos 5 a 7).

## Riesgos asumidos

| Riesgo | Mitigación |
|---|---|
| El dueño no carga las recetas completas | El dashboard marca "artículos sin receta" con costo desconocido. Es visible, no invisible. |
| El costo real difiere del estimado por receta | Etapa 5. En el MVP el margen es un **estándar estimado**, y así se documenta. |
| Acceso sin login (un solo usuario, en el MVP) | Resuelto en la etapa 3 (ola 4): login con usuarios, roles y sesiones guardadas en la base. Ver `docs/seguridad-ola-4-auth.md`. |
| Sin backups automáticos | Script de `pg_dump` diario agregado en la etapa 2. **Es lo primero que hay que agregar antes de cargar datos reales.** |
