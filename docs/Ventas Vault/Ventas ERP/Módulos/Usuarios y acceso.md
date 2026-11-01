---
tags: [ventas, modulo, seguridad]
rutas: [/login, /usuarios, /usuarios/mi-clave]
ola: 4
---

# Usuarios y acceso (ola 4, etapa 3)

Detalle técnico en [[Seguridad y permisos]]. Datos en [[Datos - Usuarios y sesiones]].

## Roles

- **`DUENO`**: todo, incluidas notas de crédito y datos fiscales.
- **`EMPLEADO`**: carga ventas, registra cobros, marca entregadas, ve/edita clientes, ve stock (cantidades) y reposición (sin costos), cotiza y convierte presupuestos, registra contactos de cobranza, carga producción, factura y ve comprobantes. **No ve costos ni márgenes** (no se consultan, no solo se ocultan), no anula, no toca catálogo, compras, reportes, listas de precios ni configuración. Inicio: `/ventas/nueva`.

## Pantallas
- `/login`: única pantalla pública.
- `/usuarios` (dueño): lista, alta (el dueño elige la clave inicial y se la pasa), cambio de rol, baja/reactivación, reinicio de clave.
- `/usuarios/mi-clave`: cada uno cambia la suya (pide la actual).

## Primer dueño

```bash
npm run usuarios:crear-dueno
# o con variables: DUENO_USUARIO, DUENO_NOMBRE, DUENO_CLAVE
```
Pide usuario, nombre y clave (sin eco, con confirmación, mínimo 10 caracteres). Se niega si ya hay un dueño, aunque esté de baja.

## Comportamiento

- **Sin ningún usuario**: 503 con la instrucción, en cualquier entorno. Nunca queda abierto.
- **Producción sin base**: 503. **Producción exige HTTPS** (cookie `__Host-ventas_sesion`, `Secure`).
- **Desarrollo**: el seed crea `dueno` / `dueno-de-ejemplo` y `empleado` / `empleado-de-ejemplo`.
- **Sin base en desarrollo**: se entra como "Demo" (dueño simulado), acciones devuelven `SIN_BASE`.
- Sesiones de 30 días renovables; cerrar sesión, baja, cambio de rol o reinicio de clave cortan las sesiones abiertas.
- Desde el 5.º fallo seguido: pausa de 30 s, 1, 2, 4, 8 min… tope 15 min. Mensaje de error genérico.

No hay variables de entorno de acceso (solo `DATABASE_URL`); `BASIC_AUTH_*` ya no existen.

Pruebas: `test:auth(:db)`, `test:permisos`, `test:usuarios`, `test:acceso`.
