# 05 · Respaldos de la base

Un respaldo que nunca se restauró no es un respaldo. Este documento explica cómo se generan,
dónde quedan, cómo se restauran y cómo se prueba que la restauración funciona.

## Resumen

| Qué | Cómo |
|---|---|
| Respaldo automático | Servicio `backup` de `docker-compose.yml`, uno por día |
| Dónde quedan | `./backups/<base>-AAAAMMDD-HHMMSS.sql.gz` (no se versiona) |
| Cuántos | Los 30 más recientes de cada base (`BACKUP_CONSERVAR`) |
| Respaldo a mano | `npm run db:backup` |
| Restaurar | `npm run db:restore -- backups/ARCHIVO.sql.gz` |
| Probar que se puede restaurar | `npm run test:respaldo:restaurar` |
| Exportar UN negocio | `sh scripts/exportar-negocio.sh <slug>` |
| Importar UN negocio | `sh scripts/importar-negocio.sh ARCHIVO --base NOMBRE` |
| Probar el respaldo por negocio | `npm run test:respaldo:negocio` |
| Estado del último respaldo | `src/lib/respaldo-estado.ts` (verificado por `npm run test:respaldo`). **Hoy ninguna pantalla lo muestra** (ver "Estado del último respaldo (sin aviso en pantalla)") |

## Respaldo programado

`docker compose up -d` levanta, además de `db`, el servicio `backup`: un contenedor
`postgres:17-alpine` (mismo `pg_dump` que el servidor) que corre `scripts/respaldo-programado.sh`.

En vez de cron hay un bucle simple: **cada hora** mira si el `.sql.gz` más nuevo de `./backups`
tiene más de 24 h. Si es así (o no hay ninguno), corre `scripts/backup.sh`. Ventajas para un VPS
chico:

- Si el servidor estuvo apagado a la hora del respaldo, se pone al día apenas vuelve.
- No hay que instalar ni configurar cron, ni pelear con la zona horaria del contenedor.
- Si un respaldo falla (base caída, disco lleno), lo anota en el log y reintenta a la hora.

Variables del servicio (en `docker-compose.yml`):

| Variable | Por defecto | Para qué |
|---|---|---|
| `BACKUP_DIR` | `/backups` (montado en `./backups`) | Dónde se guardan |
| `BACKUP_CADA_HORAS` | `24` | Antigüedad a partir de la cual se hace uno nuevo |
| `BACKUP_CONSERVAR` | `30` | Cuántos se conservan por base (rotación) |
| `BACKUP_REVISAR_SEGUNDOS` | `3600` | Cada cuánto revisa |

Ver qué hizo: `docker compose logs --tail 20 backup`. Ver que está corriendo: `docker compose ps backup`.

### Cómo se hace cada respaldo (`scripts/backup.sh`)

1. `pg_dump --no-owner --no-privileges` (SQL plano, restaurable con cualquier usuario) comprimido
   con gzip a un archivo `.sql.gz.tmp`.
2. Comprueba que el volcado termina con `PostgreSQL database dump complete`. Si `pg_dump` falló a
   mitad de camino, borra el temporal y sale con error: nunca queda un `.sql.gz` roto que parezca
   bueno (ni que apague el aviso de la app).
3. Renombra a `.sql.gz` y borra los más viejos de esa base, dejando los 30 últimos.

Los scripts se arreglan solos con dos entornos:

- **Con Docker**: si el servicio `db` del compose está levantado, usan `docker compose exec db`.
- **Sin Docker**: `pg_dump`/`psql` del sistema contra `DATABASE_URL` (del entorno o de `.env`;
  el `?schema=public` de Prisma se descarta). Es lo que usa el propio contenedor `backup`.

`RESPALDO_MODO=docker` o `RESPALDO_MODO=directo` fuerza uno.

### Copia fuera del servidor

`./backups` vive en el mismo disco que la base: protege de errores (un borrado, una migración mal
hecha), **no** de perder el VPS. Conviene copiar `./backups` a otro lado con lo que haya a mano
(`rclone` a un Drive, `rsync` a otra máquina, el snapshot del proveedor). Eso queda fuera de esta
etapa.

## Restaurar paso a paso

> Restaurar **reemplaza todo** el contenido de la base destino. El script pide escribir el nombre
> de la base para confirmar; sin terminal (o en un script) exige `--si-estoy-seguro`.

1. Elegir el archivo: `ls -lt backups/ | head`.
2. (Recomendado) Probarlo primero en una base aparte, sin tocar la real:
   `sh scripts/probar-restauracion.sh backups/ventas-AAAAMMDD-HHMMSS.sql.gz`.
3. Frenar la app para que nadie cargue datos durante la restauración
   (el proceso de `npm start`, o su contenedor si la app corre en Docker).
4. Respaldar el estado actual, por si hay que volver atrás: `npm run db:backup`.
5. Restaurar:
   ```sh
   npm run db:restore -- backups/ventas-AAAAMMDD-HHMMSS.sql.gz
   # escribir "ventas" cuando lo pida
   ```
6. Si el respaldo es de antes de una migración nueva, aplicarla: `npm run db:deploy`.
7. **Re-correr los roles** (ver "Después de restaurar un respaldo completo" abajo) y verificarlos.
8. Levantar la app y mirar el inicio y una venta conocida.

Detalles de `scripts/restaurar.sh`:

- `--base OTRA` restaura en otra base. Si no existe, la crea y no pregunta nada (no pisa nada).
- Si existe, vacía el esquema `public` y carga el volcado **en una sola transacción**: si algo
  falla a mitad de camino, la base queda exactamente como estaba.
- Rechaza archivos que no son gzip o que no terminan como un volcado completo.
- Nunca restaura sobre la base `postgres`.

## Prueba de restauración

`npm run test:respaldo:restaurar` (o `sh scripts/probar-restauracion.sh [ARCHIVO]`):

1. Si no se le pasa archivo, genera un respaldo nuevo con `scripts/backup.sh`.
2. Lo restaura en una base nueva `<base>_restore_prueba` (nunca en la de la app).
3. Compara entre la base original y la copia: conteo de clientes, artículos, materiales, ventas,
   ítems, pagos, compras, movimientos de stock, configuración, restricciones `CHECK`, índices y
   migraciones aplicadas; suma de `ventas.totalBruto`, de `pagos.monto` y del stock de materiales.
4. Borra la base de prueba, también si algo falla. Sale con error si algún control difiere.

Si la app está cargando datos mientras corre, un control puede diferir por lo cargado después del
volcado: correrla en un momento tranquilo (o pasarle un archivo y comparar a mano).

Conviene correrla **una vez por mes** y después de cada cambio de versión de Postgres.

### Resultado de la prueba (29/10/2026)

Corrida sin Docker (Postgres 16 local, modo `directo`) contra la base de desarrollo
`ventas_respaldo`, sembrada con `prisma/seed.ts`:

```
Respaldo generado (directo): ./backups/ventas_respaldo-20261029-021351.sql.gz (12K)
La base 'ventas_respaldo_restore_prueba' no existe: se crea.
Restaurando ./backups/ventas_respaldo-20261029-021351.sql.gz en 'ventas_respaldo_restore_prueba'...
Restauracion terminada en 'ventas_respaldo_restore_prueba'.

Control                    ventas_respaldo          copia
clientes                                4              4  OK
articulos                               5              5  OK
materiales                              5              5  OK
ventas                                  7              7  OK
venta_items                             9              9  OK
pagos                                   5              5  OK
compras                                 2              2  OK
movimientos_stock                      23             23  OK
configuracion                           5              5  OK
restricciones CHECK                    14             14  OK
indices                                42             42  OK
migraciones aplicadas                   3              3  OK
suma ventas.totalBruto         2081000.00     2081000.00  OK
suma pagos.monto               1293000.00     1293000.00  OK
stock total materiales            130.910        130.910  OK

PRUEBA DE RESTAURACION OK: la copia coincide con la base original.
Base de prueba ventas_respaldo_restore_prueba borrada.
```

También se comprobó:

- Restaurar sobre una base existente sin terminal y sin `--si-estoy-seguro`: se niega y no toca nada.
- Confirmación con un nombre equivocado: se niega. Con el nombre correcto: restaura.
- Un volcado truncado: rechazado antes de tocar la base.
- Un volcado con un error SQL en el medio, sobre una base con datos: la carga falla y la base
  conserva todos sus datos (la transacción se deshace).
- Rotación con `BACKUP_CONSERVAR=5` y respaldos viejos simulados con `touch -d`: borra los más
  viejos de esa base y no toca los de otra base.
- `respaldo-programado.sh`: con un respaldo de menos de 24 h no hace nada; sin respaldos genera
  uno; con la base caída anota el error y sigue el bucle sin dejar archivos a medias.

Queda pendiente correr la misma prueba con Docker (modo `docker`) en el VPS: en el entorno de
desarrollo no había Docker. `docker compose config` valida el archivo.

## Varios negocios en una base: respaldo completo y respaldo por negocio

Desde el multi-tenant (VTA-4) una base guarda a **varios negocios**. Hay dos herramientas, y no
se reemplazan:

| | Respaldo completo (`backup.sh` / `restaurar.sh`) | Por negocio (`exportar-negocio.sh` / `importar-negocio.sh`) |
|---|---|---|
| Qué guarda | Toda la base: esquema, todos los negocios | Solo las filas de un `negocioId` (sin sesiones) |
| Para qué | Seguro principal; perder el servidor o la base | Devolver **un** negocio a un estado anterior sin tocar a los demás |
| Restaurar | **Reemplaza todo**: pisaría a los demás negocios | Solo toca ese negocio |

**Regla:** restaurar el respaldo completo sobre una base viva con varios negocios solo se hace si
el problema es de toda la base (y entonces todos vuelven al mismo momento). Para recuperar a un
solo negocio, **nunca** se restaura el completo encima: se restaura en una base aparte, se exporta
de ahí ese negocio y se importa en la viva.

Los scripts usan `DATABASE_URL_MIGRACIONES` (rol `ventas_migrador`, con `BYPASSRLS`) si está, y
`DATABASE_URL` si no. Con el rol de la app (`ventas_app`) las políticas RLS dejan ver una fila de
nada y `pg_dump` ni siquiera puede leer las tablas: por eso exportar/importar se niegan con ese rol.
Al restaurar el completo, `restaurar.sh` le vuelve a dar sus permisos a `ventas_app` (el volcado va
`--no-privileges`), pero **solo los básicos**: ver "Después de restaurar un respaldo completo".

### Después de restaurar un respaldo completo

El volcado no guarda permisos, y lo que `restaurar.sh` devuelve (`sql_permisos_app` en `scripts/respaldo-comun.sh`) es
`SELECT/INSERT/UPDATE/DELETE` en las tablas de datos y solo `SELECT` en `negocios`. Falta, y hay que reponer a mano:

1. `ventas_app` necesita `INSERT` y `UPDATE` sobre `negocios` (el SUPERADMIN da de alta y de baja negocios) y `EXECUTE` sobre
   `usuarios_por_negocio()`: **re-correr `scripts/crear-roles-db.sql`** como superusuario sobre esa base.
2. La función `usuarios_por_negocio()` tiene `EXECUTE` revocado a `PUBLIC` en la migración, y un volcado sin privilegios lo pierde
   (queda ejecutable por todos; solo devuelve conteos y solo si el contexto es de SUPERADMIN, pero `npm run test:rls` lo marca como falla):
   `REVOKE ALL ON FUNCTION public.usuarios_por_negocio() FROM PUBLIC;` y volver a dar `EXECUTE` a `ventas_app` (lo hace `crear-roles-db.sql`).
3. Comprobar: `psql "$DATABASE_URL_MIGRACIONES" -X -v ON_ERROR_STOP=1 -f scripts/verificar-roles-db.sql` (solo lee; falla con un mensaje
   claro si falta algo, incluido que el migrador tenga `BYPASSRLS`, de lo que depende esa función).

Visto en el ensayo del despliegue (VTA-21, `docs/07-multitenant-despliegue.md`): tras `restaurar.sh` de un volcado multi-tenant,
`ventas_app` quedó sin `INSERT` sobre `negocios` y `test:rls` falló en una comprobación (956 de 957 antes del `REVOKE`; 956 de 956 después).

**Un volcado anterior al multi-tenant no se restaura con `restaurar.sh`.** Al final el script hace
`GRANT … ON public."negocios"`; en un volcado de antes de la migración `negocio` esa tabla no existe, el `GRANT` falla y, como todo va en
una transacción, la restauración entera se deshace (no deja nada a medias, pero no restaura). Es el caso de la vuelta atrás de un despliegue:
se restaura con el `psql` de `docs/07-multitenant-despliegue.md` ("Vuelta atrás"). Mejora pendiente de `sql_permisos_app`: no dar permisos
sobre `negocios` si la tabla no existe, y reponer los de `negocios` (INSERT/UPDATE), la función y el `REVOKE`.

### Exportar un negocio

```sh
sh scripts/exportar-negocio.sh hl-laser                     # de la base de la app
sh scripts/exportar-negocio.sh hl-laser --base ventas_aparte
```

- Genera `backups/negocios/<slug>-<base>-AAAAMMDD-HHMMSS.negocio.sql.gz` y deja los 30 más
  recientes de cada negocio y base (`BACKUP_CONSERVAR`). La extensión `.negocio.sql.gz` y la
  carpeta aparte evitan que cuente como respaldo completo: no apaga el aviso de respaldo viejo
  (`src/lib/respaldo-estado.ts`), no lo toma la rotación de `backup.sh` ni lo acepta `restaurar.sh`.
- Es una foto consistente (una sola transacción `REPEATABLE READ`): se puede correr con la app en uso.
- Lleva, en orden de dependencias (padres antes que hijos), un `COPY` filtrado por `negocioId` de
  cada tabla: `negocios`, `usuarios`, `listas_precios`, `clientes`, `materiales`, `maquinas`,
  `articulos`, … hasta `trabajo_consumos`. **No lleva las sesiones** (credenciales vivas): al
  importar, los usuarios vuelven a entrar.
- Al final trae, por tabla, la cantidad de filas y una huella `md5` de su contenido. La importación
  las vuelve a calcular y, si algo difiere, no deja nada.
- Se niega si una tabla nueva con `negocioId` no está en la lista `TABLAS_NEGOCIO` de
  `scripts/respaldo-comun.sh` (hay que sumarla en la misma migración; así nunca queda un dato
  afuera sin avisar), si las claves foráneas no respetan ese orden o si una fila del negocio apunta
  a una de otro negocio (por ejemplo, un usuario SUPERADMIN como autor).

### Importar un negocio

```sh
sh scripts/importar-negocio.sh backups/negocios/hl-laser-....negocio.sql.gz --base ventas_aparte
sh scripts/importar-negocio.sh ARCHIVO --base ventas --reemplazar     # pisa SOLO ese negocio
```

Política: **nunca se sobreescriben datos vivos de otros negocios**.

1. `--base` es obligatorio (no hay base por defecto). La base tiene que existir y tener
   **exactamente el mismo esquema** que la de origen (misma última migración y misma cantidad):
   una base nueva se crea vacía y se migra (`npm run db:deploy`) antes de importar.
2. Si el negocio (mismo `id` o mismo `slug`) ya está en la base con datos, no importa nada. La única
   excepción es el negocio `hl-laser` vacío que trae toda base recién migrada (lo crea la migración
   inicial): sin datos propios se descarta solo.
3. `--reemplazar` borra las filas de **ese** negocio (por `negocioId`, hijos primero) y las carga de
   nuevo; los demás negocios no se tocan. Pide escribir el slug para confirmar, o `--si-estoy-seguro`
   (sin terminal y sin el flag, no hace nada). Si el slug está en la base con otro `id`, es otro
   negocio y se niega.
4. Todo va en **una transacción**; si falla algo (incluida la verificación de filas y huella), la
   base queda como estaba. Durante la carga se deshabilitan los triggers de usuario de las tablas del
   negocio (los de `comprobantes` solo admiten altas `PENDIENTE`; las FK siguen activas) y se vuelven
   a habilitar antes de confirmar. Eso toma un candado exclusivo breve sobre esas tablas: hacerlo con
   la app frenada, o mejor en una base aparte.

### Recuperar un negocio de producción (procedimiento)

1. Elegir el respaldo completo anterior al problema: `ls -lt backups/ | head`.
2. Restaurarlo en una base aparte (nunca sobre la viva):
   `sh scripts/restaurar.sh backups/ventas-AAAAMMDD-HHMMSS.sql.gz --base ventas_recuperada`.
3. Exportar el negocio de esa base: `sh scripts/exportar-negocio.sh <slug> --base ventas_recuperada`.
4. Frenar la app, hacer un respaldo completo del estado actual (`npm run db:backup`) y un export
   del negocio tal cual está (por si hay que volver atrás).
5. Importar en la viva: `sh scripts/importar-negocio.sh ARCHIVO --base ventas --reemplazar`.
6. Levantar la app, mirar el inicio y una venta conocida. Borrar `ventas_recuperada`.

También sirve para mover un negocio a otra base (importar sin `--reemplazar` en una base donde no
está) o para sacar una copia de un cliente.

### Prueba

`npm run test:respaldo:negocio` arma una base con **dos negocios** (el del seed, con facturas y una
nota de crédito emitidas, y una copia modificada) y otra vacía, y comprueba: exportar A e importarlo
en la vacía reproduce exactamente sus datos (filas y huella de las 26 tablas, y totales de ventas,
pagos, stock y comprobantes); importar o reemplazar A no cambia ni una fila de B; las negativas
(negocio presente, archivo truncado o de otro esquema, datos alterados, sin `--base`, rol sujeto a
RLS, `restaurar.sh` rechazando una exportación de negocio, tabla nueva fuera de la lista); la rotación;
y que el respaldo completo restaura a los dos negocios y le devuelve sus permisos a `ventas_app`.

Necesita un rol que pueda crear bases (`RESPALDO_ADMIN_URL` = superusuario, solo para
`CREATE/DROP DATABASE`) además de `DATABASE_URL_MIGRACIONES`; `RESPALDO_URL_APP` (opcional) prueba
que exportar se niega con `ventas_app`. Local sin Docker: Postgres en el puerto que sea, con
`pg_dump`/`psql`/`node` en el PATH. Lo mismo vale para `npm run test:respaldo:restaurar`, que crea
una base de prueba: correrlo con un rol con `CREATEDB` (en el compose, el superusuario del contenedor).

## Estado del último respaldo (sin aviso en pantalla)

`src/lib/respaldo-estado.ts` calcula si el último respaldo completo es viejo: mira la fecha de modificación del `.sql.gz` más nuevo de
`BACKUP_DIR` y lo compara con un umbral (48 h). Con varios negocios el estado es **de la base** (el respaldo completo cubre a todos),
no de un negocio, y **no cuenta** las exportaciones `*.negocio.sql.gz`. La lógica está verificada por `npm run test:respaldo`.

**Hoy no hay ninguna pantalla que lo muestre:** el cartel ámbar del inicio que existía antes ya no está en el código, y nada importa
`respaldo-estado.ts`. Hasta que se vuelva a mostrar (queda como mejora), el control es mirar a mano: `ls -lt backups/ | head` y
`docker compose logs --tail 20 backup`.

| Variable (de la lógica) | Por defecto | Para qué |
|---|---|---|
| `BACKUP_DIR` | `./backups` | Directorio que mira (relativo a donde corre la app) |
| `RESPALDO_AVISO_HORAS` | `48` | Antigüedad a partir de la cual el estado es "viejo"; `0` lo apaga |

- Sin directorio de respaldos: cuenta como "nunca hubo respaldo".
- Directorio ilegible (permisos): estado "desconocido".
- Si la app corre en un contenedor y se vuelve a mostrar el estado, montarle `./backups` (solo lectura alcanza) y apuntar
  `BACKUP_DIR` ahí.
