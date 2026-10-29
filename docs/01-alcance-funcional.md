# Alcance funcional

## Contexto

Comercio de corte láser e insumos de marca (stickers, cartelería, rotulación, señalética).
Hoy el dueño no sabe qué vende, cuánto cobró en el mes ni cuánto margen tiene.
El problema no es el stock, es el **control de pedidos, ventas, cobranzas y clientes**.

Decisión de producto: ERP **mínimo y deliberadamente acotado**. Tres objetivos, en orden:

1. Saber **qué** se vendió.
2. Saber **cuánto dinero** entró.
3. Saber **cuánto se ganó** realmente (no lo que se cree que se ganó).

---

## Etapa 1 — MVP (el alcance que se construye ahora)

### 1. Clientes
- Alta, edición, baja lógica (`activo = false`). Nunca se borra un cliente con historial.
- Datos: nombre/razón social, CUIT (opcional), teléfono, email, dirección, notas.
- Ficha del cliente con: sus ventas, su saldo pendiente, su historial de pagos.

### 2. Catálogo de artículos
Lo que el comercio **vende**: stickers, vinilos, cartelería, plotter de corte, artes, servicios.
- Código, nombre, descripción, precio de venta, IVA (%), si es producto o servicio, activo.
- Margen mostrado en el listado: precio vs costo vs margen %.

### 3. Materiales e insumos
Lo que el comercio **consume**: vinilo, papel, acrílico, MDF, tintas, lámina, transportador, etc.
- Nombre, unidad de medida (m², m, kg, L, u), stock actual, stock mínimo, costo unitario, precio de venta si se vende suelto.
- Un material puede ser: insumo de producción **y** producto de reventa. Un solo catálogo para ambos casos.

### 4. Costeo por receta — **el corazón del sistema**
Este es el módulo que justifica el proyecto. El costo real de un producto **no** se tipea a mano:
se calcula como *suma de materiales consumidos + horas de máquina + horas de mano de obra*.

- Cada artículo puede tener una **receta**: una lista de líneas de costo.
- Tipo de línea de receta:
  - `MATERIAL` → cantidad × costo unitario del material (se toma el costo actual del material).
  - `MAQUINA` → cantidad de horas × costo/hora de la máquina (plotter, láser, vinyladora, plotter de corte).
  - `MANO_OBRA` → cantidad de horas × costo/hora general.
- Costo de horas: configurable globalmente en Configuración.
- La receta es **estimación de estándar de consumo**: sirve para conocer el margen y para descontar
  stock. Para un MVP esto es suficiente y evita la complejidad de medir el consumo real por máquina.
- Cuando el costo de un material cambia, la receta se recalcula sola. Este es el objetivo de fondo:
  **el margen deja de depender de la memoria del dueño.**

### 5. Ventas (pedidos)
- Cabecera: cliente, fecha, estado (`PENDIENTE` / `ENTREGADA` / `ANULADA`), observaciones.
- Ítems: artículo, cantidad, precio unitario, IVA.
- Al confirmar la venta:
  - Se **congela el costo** de cada ítem (`costoUnitarioSnapshot`, `costoTotalSnapshot`).
    Si mañana sube el vinilo, la venta de ayer conserva el costo de ayer.
  - Se calcula `total`, `costoTotal` y **margen** de la venta.
  - Se descuenta el stock de los materiales de la receta, si corresponde.
- Numeración correlativa de venta por año.
- Estado de pago independente del estado de la venta (`pendiente de cobro` vs `entregada`).

### 6. Cobranzas
- Registro de pagos con imputación a una venta.
- Una venta admite varios pagos (parte, y luego el resto).
- Saldo por cliente = suma de ventas pendientes − pagos aplicados.
- Estados de pago calculados: `AL DIA` / `PENDIENTE`. Nunca se guarda un saldo: **siempre se calcula**, así no puede desincronizarse.

### 7. Reportes — exactamente 5, los que pidió el dueño
1. **Resumen del mes**: cuánto entró, cuántas ventas, costo total, margen y margen %.
2. **Ganancia por producto**: artículo, unidades, facturación, costo, margen $ y margen %. → *"cuánto le sale, a cuánto lo vende, cuánto gana"*.
3. **Deuda por cliente**: quién debe, cuánto y desde cuándo.
4. **Consumo de materiales**: cuánto se consumió por material, a qué costo, y qué productos lo consumieron.
   → *"en base a los materiales"*: detecta si un material se está yendo y no se está reponiendo.
5. **Productos más vendidos**: ranking por unidades y por facturación.

### 8. Dashboard
Respuesta directa a *"¿cómo va el mes?"*:
- Facturado del mes, cobrado del mes, pendiente de cobro, margen del mes.
- Últimas ventas.
- Top 5 productos.
- Alertas: stock bajo de materiales, artículos sin receta (margen desconocido).

---

## Fuera del alcance del MVP (explícitamente)

- Facturación electrónica AFIP/ARCA (decisión tomada: solo comprobantes internos).
- Órdenes de compra y gestión real de stock (entradas por compra).
- Remitos, notas de crédito.
- Contas corrientes de títulos (cheques, pagarés).
- Integración con pasarelas de pago.
- Multi-moneda.
- Números de serie o pesificación automática de artes.

---

## Etapas siguientes (en orden de prioridad real)

Estado al día de hoy. El detalle de tareas y su orden de ejecución está en `docs/04-checklist-olas.md`.

| Etapa | Estado | Qué resuelve | Por qué |
|---|---|---|---|
| **2 — Stock real** | **Hecha.** Compras, libro de movimientos, ajuste por conteo, ventas que descuentan stock y anulación, lista de reposición sugerida | Compras, movimientos de entrada/salida, alertas por stock mínimo | Hoy el dueño compra a ciegas. El MVP solo le avisa si el stock *virtual* baja del mínimo. |
| **3 — Multi-usuario** | **Hecha.** Login con usuarios y roles (`DUENO` / `EMPLEADO`), sesiones en base, permisos por rol, trazabilidad (quién cargó cada venta, cobro, compra y movimiento de stock) y administración de usuarios | Login, roles y registro de quién hizo cada cosa | Cuando el negocio crezca o para no perder trazabilidad. |
| **4 — Facturación electrónica** | Pendiente (ola 5) | Factura A/B ante ARCA, CAE, certificado digital | Requisito legal/comercial. El modelo ya está preparado: falta el emisor. |
| **5 — Productividad** | Pendiente (ola 6) | Costeo real por máquina/consumo medido, tiempos por arte | Pasa de margen estimado a margen real. Es el salto de calidad. |
| **6 — Comercial** | **Hecha** (ola 7). Sin roles hasta la ola 4 | Listas de precios, presupuestos que se convierten en venta, recordatorios de cobranza | Antes de perder un cliente por no llamar al que debe. |

Las **altas y ediciones** (clientes, materiales, artículos, recetas, configuración) y los **cobros
sobre ventas existentes**, que hacían falta antes de las etapas 3 a 6, ya están hechos (olas 1 y 2
del checklist).

**Etapa 3 (hecha, ola 4) incluye:**

- Dos roles: `DUENO` (todo) y `EMPLEADO` (cargar ventas, registrar cobros, marcar entregada, clientes,
  stock en cantidades y reposición sin costos). Su pantalla de inicio es `/ventas/nueva`.
- Login en `/login` con sesiones guardadas en la base (revocables), claves con hash, pausa creciente tras
  fallos y cookie `httpOnly` (`Secure` en producción).
- Permisos por rol en cada pantalla, acción y exportación. Los costos y márgenes no llegan al navegador
  del empleado.
- Trazabilidad: "Registrado por" en ventas, cobros, compras y movimientos de stock.
- Administración de usuarios por el dueño: alta, baja lógica y reactivación, cambio de rol y reinicio de
  clave. Cada usuario cambia su propia clave.

**Queda fuera de la etapa 3** (ver `docs/seguridad-ola-4-auth.md`): 2FA, recuperación de clave (hoy la
cambia otro dueño o un comando del servidor), límite de intentos por IP, auditoría de logins y listado o
cierre remoto de sesiones.


## Etapa 6 — Comercial (hecha en la ola 7)

Tres funciones. Ninguna manda nada sola: quien usa la app decide cada envío.

### Listas de precios por cliente
- Una lista (`/listas-precios`) tiene un descuento general sobre el catálogo y, si hace falta, precios
  específicos por artículo. Se asigna a clientes desde su ficha.
- Al cargar una venta se muestra el precio que le toca a ese cliente. El servidor lo recalcula al confirmar.
- Dar de baja una lista no la borra: sus clientes vuelven a pagar precio de catálogo.
- **No hace:** vigencia por fechas, escalas por cantidad ni listas en otra moneda.

### Presupuestos (`/presupuestos`)
- Se arma para un cliente con artículos y cantidades. El precio de cada línea se congela al momento.
- Vale 15 días por defecto. Un presupuesto vencido no se edita ni se convierte: se duplica con los precios de hoy.
- "Convertir en venta" crea la venta con los precios del presupuesto, pendiente y sin pago. Un
  presupuesto se convierte una sola vez.
- Vista para imprimir y enlace de WhatsApp con un mensaje precargado (número, total y validez).
- **No hace:** no registra si el cliente aceptó o rechazó (no hay seguimiento de aprobación); no reserva
  stock ni cambia precios; no guarda costos ni márgenes; no manda WhatsApp solo (arma el enlace y lo envía quien usa la app).

### Recordatorios de cobranza (`/cobranzas/hoy`)
- Lista de a quién llamar hoy: clientes con saldo, sin un próximo contacto prometido a futuro y no contactados hoy.
  Va ordenada por antigüedad (lo más viejo primero) y, dentro de cada tramo, por monto.
- Cada tarjeta muestra el saldo, los días desde la venta impaga más vieja, el último contacto y un enlace
  de WhatsApp con mensaje precargado (nombre y saldo).
- Registrar un contacto: fecha de hoy, nota y próximo contacto opcional.
- **No hace:** no envía mensajes ni llama, no hace recordatorios automáticos ni por fecha, y no modifica
  ventas ni pagos. La lista se arma al abrir la pantalla.

Las tres pantallas todavía no tienen roles: se clasifican en la ola 4 (ver `README.md`).

---

## Fuera de alcance permanente

Stock por depósito/multi-sucursal, multi-idioma, marketplace propio, liquidación de sueldos, contabilidad completa
(asientos, balances, libro diario). Si alguna vez se pide, es **otro producto**, no una extensión de este.
