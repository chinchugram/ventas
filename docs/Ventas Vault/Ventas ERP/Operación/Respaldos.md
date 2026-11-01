---
tags: [ventas, operacion]
fuente: docs/05-respaldos.md
---

# Respaldos

> Un respaldo que nunca se restauró no es un respaldo.

| Qué | Cómo |
|---|---|
| Automático | servicio `backup` del compose, uno por día |
| Dónde | `./backups/<base>-AAAAMMDD-HHMMSS.sql.gz` (no se versiona) |
| Cuántos | los 30 más recientes por base |
| A mano | `npm run db:backup` |
| Restaurar | `npm run db:restore -- backups/ARCHIVO.sql.gz` |
| Probar | `npm run test:respaldo:restaurar` (una vez por mes y tras cambiar de versión de Postgres) |
| Aviso | cartel en el inicio si el último tiene > 48 h o no hay |

## Programado (`scripts/respaldo-programado.sh`)
Bucle en vez de cron: **cada hora** mira si el último tiene más de 24 h y, si es así, corre `backup.sh`. Se pone al día si el servidor estuvo apagado; si falla, reintenta a la hora.

Variables: `BACKUP_DIR` (`/backups`), `BACKUP_CADA_HORAS` (24), `BACKUP_CONSERVAR` (30), `BACKUP_REVISAR_SEGUNDOS` (3600).

## Cada respaldo (`scripts/backup.sh`)
1. `pg_dump --no-owner --no-privileges | gzip` a `.sql.gz.tmp`.
2. Verifica que termine en `PostgreSQL database dump complete`; si no, borra y falla.
3. Renombra y rota.

Modo `docker` (si el servicio `db` está arriba) o `directo` (`pg_dump` contra `DATABASE_URL`); se fuerza con `RESPALDO_MODO`.

> [!warning] Copia fuera del servidor
> `./backups` está en el mismo disco: protege de errores, **no** de perder el VPS. Copiar a otro lado (rclone, rsync, snapshot). Pendiente.

## Restaurar paso a paso
1. Elegir archivo: `ls -lt backups/ | head`.
2. Probarlo aparte: `sh scripts/probar-restauracion.sh backups/…`.
3. Frenar la app.
4. Respaldar el estado actual.
5. `npm run db:restore -- backups/…` (pide escribir el nombre de la base; sin terminal exige `--si-estoy-seguro`).
6. Si el respaldo es anterior a una migración: `npm run db:deploy`.
7. Levantar y revisar.

`restaurar.sh`: `--base OTRA` para otra base; carga en **una transacción** (si falla, queda como estaba); rechaza archivos no gzip o truncados; nunca sobre `postgres`.

## Prueba de restauración
Restaura en `<base>_restore_prueba` y compara conteos, CHECK, índices, migraciones y sumas (`ventas.totalBruto`, `pagos.monto`, stock). Última corrida OK: **29/10/2026** (modo directo). Pendiente: correrla con Docker en el VPS.

## Aviso en pantalla
`src/lib/respaldo-estado.ts`: mira el `.sql.gz` más nuevo de `BACKUP_DIR` (`./backups`). `RESPALDO_AVISO_HORAS` (48; `0` apaga). Directorio ilegible → no avisa. Modo demo → no avisa. Si la app se containeriza, montarle `./backups`.
