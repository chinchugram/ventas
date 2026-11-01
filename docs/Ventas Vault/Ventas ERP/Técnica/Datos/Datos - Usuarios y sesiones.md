---
tags: [ventas, datos]
---

# Datos — Usuarios y sesiones

Parte de [[Modelo de datos]]. Comportamiento en [[Seguridad y permisos]].

## `Usuario` (`usuarios`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `usuario` | text único | minúsculas, `^[a-z0-9._-]{3,40}$` |
| `nombre` | text | 1–80 caracteres |
| `rol` | enum `Rol` | `DUENO` / `EMPLEADO` |
| `hashClave` | text | `scrypt$ln=…,r=…,p=…$sal$hash`; nunca sale del servidor |
| `activo` | bool | baja lógica |
| `intentosFallidos`, `ultimoFalloEn`, `bloqueadoHasta` | | pausa por fallos, persistida |
| `creadoEn`, `actualizadoEn` | timestamptz | |

- **Nunca se borra** un usuario en la app; FK `RESTRICT` desde sesiones y todas las tablas con `usuarioId`.
- Primer dueño: `npm run usuarios:crear-dueno` (se niega si ya hay un dueño, aunque esté de baja).

## `Sesion` (`sesiones`)

| Campo | Notas |
|---|---|
| `tokenHash` | SHA-256 hex (64) del token de 32 bytes; el token en claro nunca se guarda |
| `usuarioId` | FK `RESTRICT` |
| `creadaEn`, `renovadaEn`, `expiraEn` | 30 días desde la última renovación (renovación máx. 1 vez por día) |

CHECK: hash con formato hex; `expiraEn > creadaEn`; `renovadaEn >= creadaEn`.
Cerrar sesión borra la fila; baja, cambio de rol o reinicio de clave borran todas las del usuario.
