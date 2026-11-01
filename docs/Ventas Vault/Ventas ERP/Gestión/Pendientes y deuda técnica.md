---
tags: [ventas, gestion, pendiente]
actualizado: 2026-10-31
---

# Pendientes y deuda técnica

## Funcional
- [ ] **5.2 Integración con ARCA** (diferida) → [[Integración ARCA (tarea 5.2)]] y [[Dudas para el contador]].
- [ ] Decidir qué hacer con los comprobantes `SIMULADO` antes de facturar en producción.

## Operación
- [ ] Copia de `./backups` fuera del servidor → [[Respaldos]].
- [ ] Correr la prueba de restauración con Docker en el VPS.
- [ ] Límite de intentos por IP en el proxy inverso (`POST /login`).
- [ ] Containerizar la app (`output: "standalone"`) → [[Despliegue]].

## Seguridad (fuera de alcance de la ola 4)
- [ ] 2FA, recuperación de clave, listado/cierre remoto de sesiones, auditoría de logins.
- [ ] Cookie de "dispositivo conocido" para que un atacante no pueda mantener en pausa al dueño.
- [ ] Limpieza programada de sesiones vencidas.
- [ ] CSP completa (hoy solo `frame-ancestors`).

## Accesibilidad (de `docs/auditoria-ola-3.md`, actualizado en ola 6.4)
- [ ] Títulos `h3` en las líneas de receta.
- [ ] Reemplazar los `window.confirm()` restantes (clientes, usuarios, anular venta, facturar, marcar entregada) por confirmación en el lugar.
- [ ] Baja prioridad: avisos `sr-only` de severidad y semáforo, `aria-controls` en "Más", h2 en el listado de ventas, truncado de montos largos, error del factor de reposición asociado al input.
- [ ] No auditados: `/cortes`, `/reportes/stock` (salvo desborde), lector de pantalla real, escritorio.

## Documentación del repo desactualizada

Resuelto en `staging` con el commit `c7a65d8` (31/10/2026):

- [x] `docs/03-stack-y-decisiones.md`: Next.js 16, Prisma 7 con `@prisma/adapter-pg`, escrituras en `src/app/<modulo>/actions.ts`, estructura con `proxy.ts`, `dominio/` y `fiscal/`.
- [x] `docs/01-alcance-funcional.md`: etapa 4 "hecha con emisor simulado" y pantallas de la ola 7 con roles.
- [x] `docs/02-modelo-datos.md`: "olas 0 a 7".
- [x] Video demo: se quitó el tooling del repo (commit `2b3af97`), así que ya no hace falta commitear su documentación.

> [!note] Copia local
> La copia local de `staging` todavía está en `00524d5` (2 commits atrás) y tiene `package-lock.json` modificado y `docs/video-demo.md` sin seguimiento. Al hacer `git pull`, el `package-lock.json` local va a chocar con el del commit `2b3af97`.

## Limitaciones conocidas
- Cambio de IVA entre presupuesto y conversión: el desglose usa el IVA actual.
- No hay pagos sin venta (anticipos).
- Una venta con factura simulada vigente no se puede refacturar en otro ambiente.
