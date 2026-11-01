---
tags: [ventas, operacion]
---

# Arranque y entorno local

## Requisitos
Node ≥ 20, Docker (para Postgres 17). Sin Docker, la app funciona en **modo demo**.

## Pasos

```bash
npm install                     # postinstall corre prisma generate
cp .env.example .env            # Windows: copy .env.example .env
docker compose up -d db         # o npm run db:up (db + backup)
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev                     # http://localhost:3000
```

Primer dueño en una base sin seed: `npm run usuarios:crear-dueno`. Con seed (desarrollo): `dueno` / `dueno-de-ejemplo`, `empleado` / `empleado-de-ejemplo`.

## Seed (`prisma/seed.ts`)
4 clientes, 5 artículos con receta, 5 materiales, 3 máquinas, 2 compras, 7 ventas (pagadas, sin cobrar y a medias) y un ajuste por conteo. Pasa por la misma lógica que las pantallas: el stock coincide con el libro de movimientos. Fuera de producción carga datos fiscales de ejemplo (CUIT ficticio 20-33333333-4, punto de venta 1). No carga comprobantes.

**Empezar de cero:** `npm run db:reset` (⚠ borra todo).

## Variables de entorno (`.env`)

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | `postgresql://ventas:ventas@localhost:5432/ventas?schema=public` |
| `EMISOR_FISCAL` | `simulado` (defecto) → [[Facturación]] |
| `PERMITIR_EMISOR_SIMULADO` | `1` para usar el simulador en producción |
| `BACKUP_DIR`, `RESPALDO_AVISO_HORAS` | aviso de respaldo → [[Respaldos]] |
| `AUTH_ESTRICTO` | `1` para que `test:auth` falle con hallazgos |

## Probar desde el celular
```bash
npm run dev -- -H 0.0.0.0
```
Abrir `http://IP-DE-LA-PC:3000` y agregar esa IP a `allowedDevOrigins` en `next.config.ts` (hoy `192.168.1.8`); sin eso la página se ve pero los botones no responden.

## Docker Compose
- `db`: `postgres:17-alpine`, usuario/clave/base `ventas`, zona `America/Argentina/Buenos_Aires`, volumen `ventas-db-data`, healthcheck.
- `backup`: respaldo diario → [[Respaldos]].
- La app **no** está containerizada todavía (`output: "standalone"` desactivado a propósito para que `npm start` funcione).

## Entorno en la nube sin Docker (subagentes)
Postgres local con `initdb`/`pg_ctl`, una base por subagente (`ventas_<tarea>`) y un puerto de `next dev` distinto. No usar `pkill -f`; usar `fuser -k <puerto>/tcp`.
