---
tags: [ventas, modulo]
rutas: [/cobranzas, /cobranzas/hoy, /clientes]
---

# Cobranzas y clientes

Datos: [[Datos - Clientes]], [[Datos - Ventas y cobros]], [[Datos - Comercial y cobranza]].

## Clientes (`/clientes`, `/clientes/[id]`)

- Alta, edición y baja lógica; CUIT validado y único; condición frente al IVA y DNI (para la factura).
- Lista de precios asignable **solo por el dueño** (`gestionarListasPrecios`; el empleado no ve el selector).
- Ficha: ventas, pagos y saldo.

## Cobros

- Varios pagos por venta, **nunca más que el saldo**.
- Anular un pago (solo dueño): queda tachado con su motivo y deja de contar.
- Métodos: efectivo, transferencia, tarjeta, otro.
- **El saldo siempre se calcula**, nunca se guarda.

## `/cobranzas`

Quién debe, cuánto y desde cuándo; pagos recientes. Lógica en `src/lib/cobranzas.ts`.

## Recordatorios: `/cobranzas/hoy` (ola 7.3)

- **A quién llamar hoy**: clientes con saldo, sin un próximo contacto prometido a futuro y no contactados hoy.
- Orden: por antigüedad (lo más viejo primero) y, dentro de cada tramo, por monto.
- Cada tarjeta: saldo, días desde la venta impaga más vieja, último contacto y **enlace de WhatsApp** con mensaje precargado (nombre y saldo). Normaliza teléfonos argentinos.
- Registrar contacto: fecha de hoy, nota y próximo contacto opcional. "Registrado por".
- **No envía nada solo**, no modifica ventas ni pagos.

Código: `src/lib/recordatorios-cobranza.ts`, `src/lib/dominio/recordatorios.ts`, `src/lib/dominio/pagos.ts`. Pruebas: `test:cobranzas(:db)`, `test:recordatorios(:db)`, `test:clientes`, `test:cuit`.
