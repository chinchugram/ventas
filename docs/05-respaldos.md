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
| Aviso en pantalla | El inicio muestra un cartel si el último respaldo tiene más de 48 h o si no hay ninguno |

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
7. Levantar la app y mirar el inicio y una venta conocida.

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

## Aviso en pantalla

`src/components/aviso-respaldo.tsx` (en el inicio) muestra un cartel ámbar si el último respaldo
tiene más de 48 h o si no hay ninguno. La lógica está en `src/lib/respaldo-estado.ts` (verificada
por `npm run test:respaldo`): mira la fecha de modificación del `.sql.gz` más nuevo de `BACKUP_DIR`.

| Variable (de la app) | Por defecto | Para qué |
|---|---|---|
| `BACKUP_DIR` | `./backups` | Directorio que mira (relativo a donde corre la app) |
| `RESPALDO_AVISO_HORAS` | `48` | Antigüedad a partir de la cual avisa; `0` apaga el aviso |

- Sin directorio de respaldos: cuenta como "nunca hubo respaldo" y avisa.
- Directorio ilegible (permisos): estado "desconocido", no avisa y la página funciona igual.
- En modo demostración (sin base) no avisa: no hay nada que respaldar.
- Si la app corre en un contenedor, montarle `./backups` (solo lectura alcanza) y apuntar
  `BACKUP_DIR` ahí.
