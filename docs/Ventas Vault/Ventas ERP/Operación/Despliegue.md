---
tags: [ventas, operacion, despliegue]
---

# Despliegue

## Entornos

| Entorno | Dónde | Notas |
|---|---|---|
| Local | `npm run dev` + Postgres en Docker | ver [[Arranque y entorno local]] |
| **Staging** | **Vercel** (rama `staging`) + **Neon** (Postgres) | la rama más actualizada del sistema |
| Objetivo original | VPS con Docker Compose (app + Postgres) | barato de operar; hoy solo la base está en Docker |

## Migraciones en Neon

Las migraciones **se aplican a mano antes de redeployar**, con la conexión directa (sin pooler):

```bash
DATABASE_URL="<DATABASE_URL_UNPOOLED>" npm run db:deploy
```

Recién después se redeploya `staging` en Vercel. Caso concreto: la migración `20260401000000_produccion` de la ola 6.

## Checklist de producción

- [ ] HTTPS obligatorio (la cookie `__Host-ventas_sesion` es `Secure`).
- [ ] Crear el primer dueño: `npm run usuarios:crear-dueno`.
- [ ] Limitar `POST /login` en el proxy inverso (`limit_req` de nginx o equivalente).
- [ ] Si hay proxy que cambie el `Host`: configurar `serverActions.allowedOrigins`.
- [ ] Respaldo diario funcionando y **copia fuera del servidor** → [[Respaldos]].
- [ ] Facturación: sin `PERMITIR_EMISOR_SIMULADO` en el servidor real del negocio (o asumir que todo sale SIN VALIDEZ FISCAL) → [[Facturación]].
- [ ] Sin datos de demo mezclados con ventas reales.
- [ ] El seed no crea usuarios en producción.

## Pendiente para containerizar la app
Activar `output: "standalone"` en `next.config.ts` y documentar el `COPY` de `.next/static`; montar `./backups` para el aviso de respaldo.
