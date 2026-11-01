# 07 · Despliegue multi-tenant sobre Neon

Cómo pasar la base real de Neon (hoy, un solo negocio: HL Laser) al esquema multi-tenant sin perder ni
mezclar datos. Es el cierre del épico VTA-4 (ticket VTA-21).

> **Estado.** El procedimiento está escrito y **ensayado entero contra Postgres local** (una base local hace de
> "Neon", ver "Ensayo local"). **No se ejecutó nada contra Neon ni Vercel.** El despliegue real lo decide y lo
> ejecuta el product owner (Claudio) después de leer este documento, en una ventana de mantenimiento acordada con HL Laser.
> Lo que el ensayo local no puede probar está en "Pendiente de probar en Neon".

## Qué cambia y por qué hay que ir con cuidado

- **Esquema:** tabla `negocios` y `negocioId` en las 26 tablas de datos, con el backfill al negocio `hl-laser`
  (migraciones `20260601000000` a `20260601030100`; detalle en `docs/02-modelo-datos.md`). Es un cambio que
  toca todas las filas, incluidas las fiscales (la migración desactiva unos instantes los triggers de
  inmutabilidad de `comprobantes` y los reactiva).
- **Aislamiento por RLS:** cada tabla con `negocioId` queda con `FORCE ROW LEVEL SECURITY`. Un rol que no sea
  `ventas_app` (sin `BYPASSRLS`) no ve filas sin contexto de negocio, y la app solo funciona con `ventas_app`
  (`docs/03-stack-y-decisiones.md`).
- **La app vieja no funciona sobre la base migrada** (los `INSERT` no traen `negocioId` y, con RLS, las lecturas
  vuelven vacías), **ni la app nueva sobre la base sin migrar**. Entre migrar la base real y redeployar hay una
  ventana sin servicio: por eso es una ventana de mantenimiento, con HL Laser avisado.
- **Login nuevo:** pide *Negocio*, usuario y clave. La cookie pasa a ser `<negocioId>.<token>`: **las sesiones abiertas
  con la cookie vieja (solo el token) dejan de valer** y todos vuelven a entrar una vez, escribiendo el negocio
  (`hl-laser`). Hay que avisárselo a HL Laser.

## Nombres de variables (ojo con el ticket y los documentos viejos)

| Variable | Dónde va | Rol de base | Host en Neon |
|---|---|---|---|
| `DATABASE_URL` | La app en Vercel, `.env` | `ventas_app` (sin `BYPASSRLS`) | **pooled** (`-pooler`) |
| `DATABASE_URL_MIGRACIONES` | Solo en la terminal de quien migra. **Nunca** en la app ni en Vercel | `ventas_migrador` (dueño de las tablas, con `BYPASSRLS`) | **directo** (sin `-pooler`) |

`DATABASE_URL_MIGRACIONES` es lo que el ticket y la nota de la ola 6 llaman `DATABASE_URL_UNPOOLED`: es la
conexión directa de Neon. `prisma.config.ts` usa `DATABASE_URL_MIGRACIONES` si existe y, si no, `DATABASE_URL`.
Los scripts de respaldo (`backup.sh`, `restaurar.sh`, `exportar-negocio.sh`, `importar-negocio.sh`) también.

## Antes de empezar (paso 0, no toca nada)

- [ ] **Aprobación explícita del product owner** y fecha de la ventana. HL Laser avisado: durante la ventana no
  puede cargar datos, y después tiene que entrar con *Negocio* `hl-laser`.
- [ ] Anotar, **fuera de Vercel**, los valores actuales de las variables de entorno del proyecto (sobre todo
  `DATABASE_URL`): son la vuelta atrás. Una variable "sensible" de Vercel no se puede volver a leer.
- [ ] Confirmar que ningún otro despliegue (preview, producción, otra rama) usa la misma base de Neon.
- [ ] `pg_dump`/`psql` locales de versión **igual o mayor** a la del servidor de Neon.
- [ ] Saber **quién es hoy el dueño de las tablas** en Neon:
  ```sql
  SELECT tableowner, count(*) FROM pg_tables WHERE schemaname = 'public' GROUP BY 1;
  ```
  Las migraciones hacen `ALTER TABLE`, crean triggers y `FORCE ROW LEVEL SECURITY`: tiene que correrlas el dueño.
  El procedimiento supone que es `ventas_migrador`. Si hoy es otro rol (por ejemplo el que crea Neon por
  defecto), hay que decidirlo antes de seguir (traspasar el dueño o migrar con ese rol, siempre que tenga
  `BYPASSRLS`). **No probado en Neon.**
- [ ] La base tiene que ser **del migrador**: `ALTER DATABASE <base> OWNER TO ventas_migrador` (si no, `prisma migrate deploy` falla con
  "permission denied for database", visto al probar el arranque desde cero). En Neon, decidir cómo se hace con el rol que hoy es dueño.
- [ ] Los dos roles. Se crean **con SQL**, no desde la consola de Neon (un rol creado por la consola puede heredar
  de un rol con `BYPASSRLS` y se saltaría el aislamiento; `scripts/verificar-roles-db.sql` lo detecta):
  ```sh
  psql "$ADMIN_URL" -X -v ON_ERROR_STOP=1 \
       -v app_password="'CLAVE-LARGA-DE-LA-APP'" -v migrador_password="'CLAVE-LARGA-DEL-MIGRADOR'" \
       -f scripts/crear-roles-db.sql
  ```
  (Se vuelve a correr más abajo; es idempotente.) En producción **no** se usan las claves de desarrollo.

Convención de este documento, con las URL reales fuera del repo (por ejemplo en un archivo `.env.despliegue` que no se versiona):

```sh
MIG_REAL="postgresql://ventas_migrador:…@<host-directo>/<base>?sslmode=require"      # DATABASE_URL_MIGRACIONES
APP_REAL="postgresql://ventas_app:…@<host>-pooler/<base>?sslmode=require"             # DATABASE_URL
MIG_COPIA="…lo mismo, apuntando a la copia / rama…"
```

## Procedimiento

### 1. Respaldo completo de la base real

Dos capas; las dos, no una u otra:

1. **Neon:** crear una rama (branch) de la base principal desde la consola y anotar la hora. Es la restauración más
   rápida y conserva dueños y permisos.
2. **`pg_dump`** (archivo que se puede guardar fuera de Neon):
   ```sh
   DATABASE_URL_MIGRACIONES="$MIG_REAL" RESPALDO_MODO=directo sh scripts/backup.sh <base>
   ls -lh backups/<base>-*.sql.gz        # y copiarlo fuera de este equipo
   ```
   `backup.sh` rechaza un volcado incompleto. `docs/05-respaldos.md`, sección "Restaurar paso a paso".

### 2. Reconciliación "antes"

`scripts/snapshot-negocio.sql` saca una foto de lo que la migración **no debe cambiar**: filas de cada tabla, suma
de `ventas.totalBruto`, `comprobantes.importeTotal` y `pagos.monto`, minutos y costos de producción, **saldo de
cada cliente** (ventas no anuladas menos pagos no anulados) y **stock de cada material**.

```sh
psql "$MIG_REAL" -X -q -v ON_ERROR_STOP=1 -f scripts/snapshot-negocio.sql > antes_real.txt
grep -E '^(filas\|(ventas|pagos|clientes|comprobantes)\||suma_)' antes_real.txt     # para anotar en el ticket
```

### 3. La copia

Neon: crear **otra rama** desde la principal (o restaurar el respaldo de `pg_dump` en una base nueva). La copia
tiene que ser idéntica al original, y se comprueba:

```sh
psql "$MIG_COPIA" -X -q -v ON_ERROR_STOP=1 -f scripts/snapshot-negocio.sql > antes_copia.txt
diff antes_real.txt antes_copia.txt && echo "copia idéntica al original"
```

Si la copia sale de un `pg_dump` (no de una rama), crear la base vacía y cargar el volcado **con este comando, no con
`scripts/restaurar.sh`** (ver "Restaurar un respaldo del esquema anterior"):

```sh
{ echo "SET client_min_messages = warning; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"; \
  gzip -dc backups/<base>-AAAAMMDD-HHMMSS.sql.gz; } | psql "$MIG_COPIA" -X -q -v ON_ERROR_STOP=1 --single-transaction
```

### 4. Migrar la copia (todo se prueba acá primero)

```sh
# 4.1 Roles en la copia (si no existían a nivel servidor; los roles son del servidor, no de la base)
psql "$ADMIN_COPIA" -X -v ON_ERROR_STOP=1 -v app_password="'…'" -v migrador_password="'…'" -f scripts/crear-roles-db.sql

# 4.2 Migraciones, con el rol migrador y el host directo
DATABASE_URL="$MIG_COPIA" DATABASE_URL_MIGRACIONES="$MIG_COPIA" npm run db:deploy

# 4.3 Reconciliación "después": tiene que ser IDÉNTICA
psql "$MIG_COPIA" -X -q -v ON_ERROR_STOP=1 -f scripts/snapshot-negocio.sql > despues_copia.txt
diff antes_real.txt despues_copia.txt && echo "RECONCILIACIÓN IDÉNTICA"
psql "$MIG_COPIA" -X -q -v ON_ERROR_STOP=1 -f scripts/verificar-negocio.sql        # 26 tablas con negocioId, un solo negocio

# 4.4 RE-CORRER los roles tras migrar y verificarlos
psql "$ADMIN_COPIA" -X -v ON_ERROR_STOP=1 -v app_password="'…'" -v migrador_password="'…'" -f scripts/crear-roles-db.sql
psql "$MIG_COPIA" -X -v ON_ERROR_STOP=1 -f scripts/verificar-roles-db.sql
```

**Por qué `crear-roles-db.sql` se corre otra vez después de migrar.** `ventas_app` necesita `INSERT` y `UPDATE` sobre
`negocios` (el SUPERADMIN da de alta y de baja negocios desde la app) y `EXECUTE` sobre la función
`usuarios_por_negocio()` (la cantidad de usuarios por negocio en `/admin/negocios`). Las migraciones solo otorgan
esos permisos si `ventas_app` **ya existe** cuando se migra; si el rol se creó después, o si se restauró un respaldo
(el volcado va sin permisos), faltan. Además esa función es `SECURITY DEFINER` y **requiere que su dueño, el
migrador, tenga `BYPASSRLS`**: sin eso devuelve 0 filas. `scripts/verificar-roles-db.sql` falla con un mensaje
claro si algo de esto no está (solo lee el catálogo; se puede correr sobre la base real).

Si algo difiere o falla en este paso: **se borra la copia y no hay nada que deshacer.** No se sigue hasta que la
reconciliación sea idéntica.

### 5. Probar contra la copia

- `DATABASE_URL` de la copia con el rol `ventas_app`, la del host **pooled**, y `DATABASE_URL_MIGRACIONES` directa:
  ```sh
  DATABASE_URL="$APP_COPIA" DATABASE_URL_MIGRACIONES="$MIG_COPIA" npm run test:rls
  ```
  **Hoy `test:rls`, el humo y `test:acceso` se niegan a correr contra un host que no sea local**, a propósito. Habilitar
  esa excepción para una rama de Neon es una decisión del product owner y **no está hecha** (ver "Pendiente de probar en
  Neon"). Lo que sí corre a mano sobre la copia de Neon es `verificar-negocio.sql` y `verificar-roles-db.sql` (solo leen).
- Los tests de la app (`test:acceso`, `test:rls` y el resto de la suite de cierre) corren en la computadora de desarrollo,
  contra Postgres local, con el código que se va a desplegar. Con eso, y el ensayo de "Ensayo local", se cubre el
  comportamiento; la copia de Neon cubre los datos reales (reconciliación) y los permisos.
- Humo contra una copia local de los datos (`scripts/smoke-despliegue.ts`): ver "Ensayo local".

### 6. Repetir en la base real (ventana de mantenimiento)

Solo con la aprobación del product owner y HL Laser avisado, y **solo si la copia pasó el paso 4 completo**.

1. Pedir a HL Laser que no cargue datos desde este momento.
2. **Respaldo final** (paso 1 otra vez, rama de Neon y `pg_dump`) y reconciliación "antes" final
   (`antes_real.txt` nuevo: es contra el que se compara).
3. Migrar: `DATABASE_URL="$MIG_REAL" DATABASE_URL_MIGRACIONES="$MIG_REAL" npm run db:deploy`.
4. `diff antes_real.txt despues_real.txt` **idéntico**, `verificar-negocio.sql` en verde. Si no, **vuelta atrás** (abajo), sin redeployar.
5. Correr `crear-roles-db.sql` y `verificar-roles-db.sql` sobre la base real (con claves de producción).
6. Alta del SUPERADMIN, desde la terminal y con la conexión del migrador:
   `DATABASE_URL_MIGRACIONES="$MIG_REAL" npm run usuarios:crear-superadmin` (ver README, "Acceso").

### 7. Redeploy de `staging` en Vercel y verificación

1. En el proyecto de Vercel: `DATABASE_URL` = la URL de `ventas_app` **pooled**; **no** definir `DATABASE_URL_MIGRACIONES`
   ni `PERMITIR_ROL_CON_BYPASS_RLS`. (`conNegocio` se niega a correr en producción con un rol que se salta RLS.)
2. Redeploy de `staging` (el código con las migraciones ya aplicadas).
3. Verificar, con los datos reales:
   - entrar a `/login` con *Negocio* `hl-laser`, el usuario y la clave de siempre;
   - el inicio y `/ventas`: cantidad de ventas y totales iguales a `antes_real.txt`; saldos de unos clientes conocidos;
   - **una venta** de punta a punta (cargar, ver que descuenta stock) y anularla después, para que no quede en los totales
     (la venta anulada conserva su número);
   - entrar como SUPERADMIN (*Negocio* `admin`) y ver `hl-laser` en `/admin/negocios`.
4. Anotar la reconciliación idéntica y la verificación en el ticket VTA-21.

### 8. Cierre

Dejar la rama/respaldo de Neon del paso 1 y el `.sql.gz` **al menos 30 días**. Borrar la copia de pruebas. Si hay
que crear el dueño de otro negocio: `npm run usuarios:crear-dueno -- --negocio <slug>` o desde `/admin/negocios`.

## Vuelta atrás

Cuándo y cómo, según dónde se detecta el problema:

| Dónde | Qué hacer |
|---|---|
| En la copia (pasos 3 a 5) | Borrar la copia. La base real no se tocó. |
| En la real, durante la migración o antes de redeployar | Restaurar el respaldo del paso 6.2 (abajo). Vercel no se tocó: sigue con su `DATABASE_URL` y su código anteriores. |
| Después del redeploy (login o venta mal) | **Base y código vuelven juntos**: restaurar el respaldo, volver `DATABASE_URL` al valor anotado en el paso 0 y promover el despliegue anterior de Vercel. La app vieja no funciona sobre la base migrada. |

**Restaurar.** Preferido: restaurar la rama de Neon del paso 1 (conserva dueños y permisos). Alternativa, con el `.sql.gz`:
conectarse **con el mismo rol que era dueño de las tablas antes de migrar** (el volcado va `--no-owner`: las tablas quedan
del rol que restaura, y la app vieja necesita poder leerlas) y correr:

```sh
{ echo "SET client_min_messages = warning; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"; \
  gzip -dc backups/<base>-AAAAMMDD-HHMMSS.sql.gz; } | psql "$URL_DEL_DUENO_ORIGINAL" -X -q -v ON_ERROR_STOP=1 --single-transaction
```

Todo va en una transacción: si falla a mitad de camino, la base queda como estaba (migrada). Después: foto contra `antes_real.txt`
(`diff`), `SELECT count(*) FROM _prisma_migrations` igual al de antes (12 migraciones, las anteriores al multi-tenant) y
`SELECT to_regclass('public.negocios')` en `NULL`. Los roles `ventas_app` y `ventas_migrador` pueden quedar: no estorban.

**Lo que se pierde.** Restaurar vuelve a la hora del respaldo: lo que HL Laser cargó entre el respaldo y la vuelta atrás se
pierde (se rescata a mano de la base migrada antes de restaurar, o se vuelve a cargar). Por eso la ventana pide no cargar
datos y por eso conviene decidir rápido, mirando la reconciliación y el humo.

### Restaurar un respaldo del esquema anterior (por qué no `restaurar.sh`)

`scripts/restaurar.sh` termina dando permisos a `ventas_app` con `GRANT … ON public."negocios"`. En un volcado
**anterior al multi-tenant** esa tabla no existe: el `GRANT` falla y, como todo va en una transacción, la restauración
entera se deshace (no deja nada a medias, pero no restaura). Para esos volcados (la copia del paso 3 y la vuelta atrás)
usar el `psql` de arriba. Con un volcado **ya multi-tenant** `restaurar.sh` sí sirve, y después hay que correr
`crear-roles-db.sql`, `REVOKE ALL ON FUNCTION public.usuarios_por_negocio() FROM PUBLIC` y `verificar-roles-db.sql`:
el volcado pierde los permisos y deja la función ejecutable por todos (lo vio `test:rls` en el ensayo). Ambas son mejoras
pendientes de `scripts/respaldo-comun.sh` (`sql_permisos_app`); no se tocó ese archivo en este ticket.

## Ensayo local

`scripts/ensayo-despliegue.sh` recorre todo el procedimiento contra Postgres local (se niega a correr con un host remoto):

```sh
ENSAYO_HOST=/tmp/pgsock7 ENSAYO_PORT=5477 sh scripts/ensayo-despliegue.sh      # npm run ensayo:despliegue
```

Qué hace, en orden: (0) arma la base "Neon simulada" con el esquema **anterior** al multi-tenant (las 12 migraciones previas,
registradas por Prisma como en Neon) y datos (`scripts/test-negocio-datos.sql`: ventas, pagos, facturas emitidas, producción…)
con un dueño de clave real; (1) respaldo con `backup.sh`; (2) copia restaurando el respaldo y reconciliación copia = original;
(3) en la copia: `db:deploy` con el migrador, reconciliación antes/después, `verificar-negocio.sql`, `crear-roles-db.sql` otra vez,
`verificar-roles-db.sql`, `test:rls` con `ventas_app` y `scripts/smoke-despliegue.ts` (login con *Negocio*, cookie vieja rechazada, totales
vistos por la app iguales a los de antes, una venta que se deshace) y reconciliación "sin rastro"; (4) lo mismo sobre la base "real"
simulada; (5) vuelta atrás: restaurar el respaldo del paso 1 sobre la base "real" y reconciliar.

Resultado del 01/11/2026 (Postgres 16 local, sockets; ventas del dato de prueba: 3, `suma_ventas_totalBruto` 4235.00):

```
RECONCILIACION IDENTICA (copia == original, antes de migrar): 26 tablas, 35 lineas
RECONCILIACION IDENTICA (copia, antes == despues de migrar): 26 tablas, 35 lineas
verificar-negocio.sql OK / verificar-roles-db.sql OK
test:rls: 956/956 comprobaciones OK
RECONCILIACION IDENTICA (copia, despues de test:rls (no deja rastro)): 26 tablas, 35 lineas
HUMO OK (login, cookie vieja rechazada, 3 ventas y 4235.0000 vistos por ventas_app, una venta registrada y deshecha)
RECONCILIACION IDENTICA (copia, despues del humo (no deja rastro)): 26 tablas, 35 lineas
RECONCILIACION IDENTICA (real, antes == despues de migrar): 26 tablas, 35 lineas
RECONCILIACION IDENTICA (real restaurada == antes de migrar): 26 tablas, 35 lineas
migraciones registradas tras la vuelta atras: 12 / tabla negocios existe: f
```

La reconciliación de saldos y stock está dentro de esas 35 líneas (una por cliente y por material, más las sumas). En Neon el
número de filas será otro; lo que importa es que `antes` y `después` sean idénticos.

## Pendiente de probar en Neon

Nada de esto se probó (no hay acceso desde el entorno de desarrollo, y no corresponde sin la aprobación del product owner):

1. **Neon en modo pooled.** `conNegocio` abre siempre una transacción interactiva y usa `set_config(…, true)` precisamente
   para sobrevivir al pooler (PgBouncer en modo *transaction*), y `test:rls` lo prueba en Postgres local, **pero nunca se
   corrió contra el host `-pooler` de Neon**. Hay que correr `npm run test:rls` contra una **rama de pruebas** de Neon con
   `DATABASE_URL` pooled (y la directa en `DATABASE_URL_MIGRACIONES`). Los scripts hoy se niegan a correr con un host
   remoto; habilitarlo para esa prueba (por ejemplo con una variable explícita que pida el nombre de la rama) es una decisión
   del product owner. Hasta entonces, el primer ingreso real es esa prueba: por eso el paso 7 verifica login y venta.
2. **Dueño de las tablas y `BYPASSRLS` en Neon.** Que las tablas actuales sean de `ventas_migrador` (o cómo traspasarlas),
   que Neon deje otorgar `BYPASSRLS` a `ventas_migrador` desde SQL y que `ventas_app` no lo herede por el rol con que se
   cree. `scripts/verificar-roles-db.sql` lo comprueba y es de solo lectura.
3. Las ramas de Neon (crear y restaurar) y la restauración con `pg_dump` sobre Neon con el rol dueño original.
4. El tiempo real de la migración con los datos de HL Laser (en el ensayo son segundos con datos de prueba) y el tamaño de la ventana.
5. Las variables de Vercel (que `staging` tome la nueva `DATABASE_URL` y que ningún otro despliegue use la base).
6. `sslmode=require` y el resto de los parámetros de las URL de Neon con `psql`, `pg_dump` y Prisma.
