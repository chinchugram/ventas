# Modelo de datos

## Ideas de diseño

1. **Nada de saldos almacenados.** El saldo de un cliente y el estado de pago de una venta siempre se
   *calculan* a partir de ventas y pagos. Así es imposible que el sistema muestre una cifra que no
   cuadre con los comprobantes.

2. **El costo se congela en la venta.** `VentaItem` guarda `costoUnitarioSnapshot` y `costoTotalSnapshot`.
   Los costos de materiales cambian; la historia financiera no se reescribe.

3. **Un solo catálogo de materiales para insumo y reventa.** El vinilo que se consume en un sticker y el
   vinilo que se vende por metro usan la misma tabla; cambia si tiene receta o se vende directo.

4. **El costo de un artículo sale de su receta**, no se tipea. Un artículo sin receta tiene costo 0 y se
   reporta como "costo desconocido" para que el dueño lo sepa en lugar de creer un margen falso.

5. **Baja lógica en todos los catálogos.** `activo = false` en clientes, artículos y materiales. Ningún
   registro con historial se borra.

6. **Quién hizo qué.** Cada venta, cobro, compra y movimiento de stock guarda `usuarioId`. Es nullable:
   lo anterior a los usuarios queda en `NULL` y se muestra "—", sin inventar un autor. Los usuarios no se
   borran (FK `RESTRICT`), así que la trazabilidad no se pierde.

---

## Entidades

### `Cliente`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text | Nombre comercial o razón social |
| `cuit` | text? | Guardado como texto (conserva ceros) |
| `telefono`, `email`, `direccion`, `notas` | text? | |
| `activo` | bool | Baja lógica |
| `listaPrecioId` | uuid? FK | Lista de precios asignada (`ListaPrecio`). Null = precio de catálogo |
| `creadoEn`, `actualizadoEn` | timestamptz | |

Índice único parcial sobre `cuit` cuando no es null. Índice sobre `listaPrecioId`. Una lista asignada
no se borra (`ON DELETE RESTRICT`): la app solo la da de baja.

### `Material`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text | |
| `unidad` | enum | `M2`, `M`, `KG`, `L`, `U`, `HOJA`, `ROLLO` |
| `stockActual` | decimal(14,3) | consumption-based en el MVP |
| `stockMinimo` | decimal(14,3) | 0 = sin alerta |
| `costoUnitario` | decimal(14,4) | Costo por unidad de medida |
| `precioVenta` | decimal(14,4)? | Si se vende suelto; null = solo insumo |
| `activo` | bool | |

### `Maquina`
Recurso de producción con costo horario.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text | Plotter, láser, vinyladora, plotter de corte |
| `costoHora` | decimal(14,2) | Incluye depreciación/amortización y consumibles propios |
| `activo` | bool | |

### `Articulo`
Lo que se vende.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text | |
| `descripcion` | text? | |
| `precioVenta` | decimal(14,4) | Precio final con IVA incluido |
| `ivaPct` | decimal(5,2) | 21, 10.5, 0 |
| `esServicio` | bool | Servicio = sin consumo de stock |
| `activo` | bool | |

### `Receta` + `RecetaComponente`
`Receta` es 1:1 con `Articulo` (un producto = un estándar de consumo).

`Receta`: `id`, `articuloId` (único), `notas`, timestamps.

`RecetaComponente`:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `recetaId` | uuid FK | |
| `tipo` | enum | `MATERIAL` \| `MAQUINA` \| `MANO_OBRA` |
| `materialId` | uuid? FK | Requerido si `tipo = MATERIAL` |
| `maquinaId` | uuid? FK | Requerido si `tipo = MAQUINA` |
| `cantidad` | decimal(14,4) | m², metros, horas… |
| `costoUnitarioOverride` | decimal(14,4)? | null = usar el costo vigente del material/máquina |
| `notas` | text? | Ej: "descontar 10% por merma" |

`costo_componente = cantidad × COALESCE(costoUnitarioOverride, costo del material/máquina)`.
Una sola tabla con `tipo` discriminado en vez de dos tablas: la UI y los reportes son iguales para todos.

Restricción de integridad (CHECK en SQL de Prisma):
- `MATERIAL` → `materialId` NOT NULL, `maquinaId` NULL
- `MAQUINA` → `maquinaId` NOT NULL, `materialId` NULL
- `MANO_OBRA` → ambos NULL

`costo_hora` de `MANO_OBRA` sale de `Configuracion.clave = 'costoHoraManoObra'`.

### `Venta`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `numero` | int | Correlativo por año, generado en la transacción |
| `anio` | int | Parte del único |
| `clienteId` | uuid FK | |
| `fecha` | date | Fecha de la venta |
| `estado` | enum | `PENDIENTE` (pedido abierto) \| `ENTREGADA` \| `ANULADA` |
| `observaciones` | text? | |
| `totalNeto`, `totalIVA`, `totalBruto` | decimal(14,2) | `bruto = neto + IVA` |
| `costoTotal` | decimal(14,2) | Suma de los snapshots de costo |
| `usuarioId` | uuid? FK | Quién cargó la venta (`Usuario`). `NULL` = histórico, se muestra "—". FK `RESTRICT` |
| `creadoEn`, `actualizadoEn` | timestamptz | |

`numero` es único **por `anio`**, no global.

### `VentaItem`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `ventaId` | uuid FK | |
| `articuloId` | uuid FK | |
| `descripcion` | text | Copia del nombre al momento de la venta |
| `cantidad` | decimal(14,3) | |
| `precioUnitario` | decimal(14,4) | Con IVA |
| `ivaPct` | decimal(5,2) | Copia del artículo al momento de la venta |
| `subtotalNeto`, `subtotalIVA`, `subtotalBruto` | decimal(14,2) | Derivados, guardados para auditoría |
| `costoUnitarioSnapshot` | decimal(14,4) | Costo unitario **al momento de la venta** |
| `costoTotalSnapshot` | decimal(14,2) | `cantidad × costoUnitarioSnapshot` |

> `costoTotalSnapshot = 0` + `receta` vacía ⇒ margen no confiable. El dashboard lo señala.

### `Pago`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `ventaId` | uuid FK | Pago imputado a una venta concreta |
| `clienteId` | uuid FK | Desnormalizado para listar deudas rápido y validar coherencia |
| `fecha` | date | |
| `monto` | decimal(14,2) | Siempre > 0 |
| `metodo` | enum | `EFECTIVO`, `TRANSFERENCIA`, `TARJETA`, `OTRO` |
| `notas` | text? | |
| `anuladoEn` | timestamptz? | Baja lógica: el pago anulado se muestra y no cuenta en ningún saldo |
| `motivoAnulacion` | text? | Obligatorio si está anulado (CHECK) |
| `usuarioId` | uuid? FK | Quién registró el cobro (`Usuario`). `NULL` = histórico, se muestra "—". FK `RESTRICT` |

No se modelan pagos sin venta (anticipos a cuenta) en el MVP: el pedido puede tener
`estado = PENDIENTE` y el saldo a favor se maneja fuera del sistema hasta la etapa 2.

### `Compra` + `CompraItem` (etapa 2)
`Compra`: `fecha`, `proveedor` (texto libre), `comprobante?`, `notas?`, `total` (suma de subtotales),
`usuarioId?` (quién la cargó; `NULL` = histórico, FK `RESTRICT`).
`CompraItem`: `materialId`, `cantidad` (> 0), `costoUnitario`, `subtotal`.

Al registrar una compra, en una sola transacción: se guardan cabecera y líneas, se suma el stock
y se crea un `MovimientoStock` por línea. Opcionalmente el costo del material pasa a ser el de la
compra (último precio pagado = costo de reposición); las ventas viejas conservan su snapshot.

### `MovimientoStock` (etapa 2)
Libro de stock, nunca se edita. `tipo` (`COMPRA`, `VENTA` o `AJUSTE`), `cantidad` con signo,
`stockResultante` (saldo luego del movimiento, CHECK >= 0), `motivo?`, `compraId?`, `ventaId?`,
`usuarioId?` (quién hizo el movimiento o la operación que lo generó; `NULL` = histórico, FK `RESTRICT`).
`VENTA` es el descuento al confirmar una venta (uno por material de las recetas); al anularla se
crean movimientos `VENTA` de signo contrario con lo que realmente salió. Si faltaba stock, se
descuenta lo disponible (el saldo nunca es negativo) y el motivo deja constancia del faltante.
Los ajustes por conteo físico registran la diferencia como `AJUSTE` con su motivo.

### `Configuracion`
| Campo | Tipo | Notas |
|---|---|---|
| `clave` | text PK | `costoHoraManoObra`, `nombreNegocio`, `ivaDefault`, `moneda` |
| `valor` | text | Todo como texto; se castea al leer |

### `Usuario` (ola 4)
Persona que entra al sistema. Sin sesión válida no se ve nada (ver `src/lib/auth.ts`).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `usuario` | text, único | Nombre para entrar, en minúsculas. Formato `^[a-z0-9._-]{3,40}$` |
| `nombre` | text | Para mostrar ("Laura", "Mostrador"). 1 a 80 caracteres, sin contar espacios de los extremos |
| `rol` | enum `Rol` | `DUENO` o `EMPLEADO` |
| `hashClave` | text | `scrypt$ln=…,r=…,p=…$sal$hash`. Nunca sale del servidor |
| `activo` | bool | Baja lógica. Reactivar es volver a `true` |
| `intentosFallidos`, `ultimoFalloEn`, `bloqueadoHasta` | int, timestamptz? | Pausa por intentos fallidos. Está en la base, así sobrevive reinicios |
| `creadoEn`, `actualizadoEn` | timestamptz | |

CHECK en la migración `20260210000000_usuarios_y_sesiones`: `usuario` en minúsculas y con formato;
`nombre` de 1 a 80 caracteres; `hashClave` con formato scrypt (nunca vacío ni texto plano);
`intentosFallidos >= 0`.

Decisiones:
- **Nunca se borra un usuario en la app.** Dar de baja es `activo = false`: el historial (ventas, cobros,
  compras, movimientos) sigue apuntando a él.
- **FK `RESTRICT`** desde `sesiones`, `ventas`, `pagos`, `compras` y `movimientos_stock`: la base rechaza
  borrar un usuario que tenga historial o sesiones. El seed es la única vía que borra usuarios, y solo fuera
  de producción, después de borrar sus ventas, cobros, compras y movimientos.
- El primer dueño se crea con `npm run usuarios:crear-dueno`, que se niega si ya existe un dueño (aunque
  esté dado de baja). Los demás usuarios, incluido otro dueño, se crean desde `/usuarios`.

### `Sesion` (ola 4)
Sesión abierta. La cookie lleva un token aleatorio de 32 bytes; la base guarda solo su SHA-256.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `tokenHash` | text, único | SHA-256 en hex (64 caracteres). El token en claro nunca se guarda |
| `usuarioId` | uuid FK | `Usuario`. FK `RESTRICT` |
| `creadaEn` | timestamptz | |
| `renovadaEn` | timestamptz | Última extensión del vencimiento; a lo sumo una vez por día |
| `expiraEn` | timestamptz | 30 días desde la última renovación |

CHECK: `tokenHash` es 64 caracteres hex minúsculas; `expiraEn > creadaEn`; `renovadaEn >= creadaEn`.

Decisiones:
- Quien lee la tabla o un respaldo no puede usar las sesiones. Como el token tiene 256 bits de entropía,
  el hash es SHA-256 sin sal (no hace falta un hash lento).
- Cerrar sesión borra su fila. Dar de baja, cambiar el rol o reiniciar la clave borra todas las sesiones
  del usuario. Una sesión vencida no vale aunque exista, y se borra al encontrarla (no hay tarea programada).

### `Rol` (enum)
`DUENO` (todo) y `EMPLEADO`. Es el tipo `"Rol"` de Postgres. Qué puede cada rol está en
`src/lib/permisos-pura.ts`.

### `ListaPrecio`
Descuento general sobre el catálogo y/o precios específicos por artículo, para un grupo de clientes.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text, único | El dominio no distingue mayúsculas; la base solo exige único exacto |
| `descuentoPct` | decimal(5,2) | 0 a 100 (CHECK). Se descuenta del precio de catálogo |
| `activo` | bool | Baja lógica. Una lista de baja no se aplica, aunque tenga clientes asignados |
| `creadoEn`, `actualizadoEn` | timestamptz | |

### `ListaPrecioItem`
Precio específico de un artículo dentro de una lista.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `listaPrecioId` | uuid FK | `ON DELETE CASCADE` (la app nunca borra listas) |
| `articuloId` | uuid FK | `ON DELETE RESTRICT` |
| `precio` | decimal(14,4) | Con IVA incluido, como `Articulo.precioVenta`. CHECK `>= 0` |
| `creadoEn`, `actualizadoEn` | timestamptz | |

Único `(listaPrecioId, articuloId)`: un precio por artículo por lista.

### `Presupuesto`
Oferta de precios a un cliente. No guarda costos ni márgenes.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `numero` | int | Correlativo por año, generado en la transacción. CHECK `> 0` |
| `anio` | int | Parte del único |
| `clienteId` | uuid FK | |
| `fecha` | date | Día de emisión (hoy en Argentina) |
| `validezDias` | int | Por defecto 15. CHECK `> 0`; el dominio acepta hasta 365 |
| `observaciones` | text? | |
| `estado` | enum | `ABIERTO` (por defecto), `CONVERTIDO`, `ANULADO`. "Vencido" no es un estado guardado |
| `ventaId` | uuid? FK único | Venta en la que se convirtió. Null si no está convertido |
| `duplicadoDeId` | uuid? FK | Presupuesto del que es copia (con precios de hoy) |
| `creadoEn`, `actualizadoEn` | timestamptz | |

Único `(anio, numero)`. CHECK `(estado = 'CONVERTIDO') = (ventaId IS NOT NULL)`.

### `PresupuestoItem`
Línea congelada del presupuesto.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `presupuestoId` | uuid FK | `ON DELETE CASCADE` |
| `articuloId` | uuid FK | `ON DELETE RESTRICT` |
| `descripcion` | text | Copia del nombre del artículo al momento del presupuesto |
| `cantidad` | decimal(14,3) | CHECK `> 0` |
| `precioUnitario` | decimal(14,4) | Con IVA incluido, congelado. CHECK `>= 0` |
| `ivaPct` | decimal(5,2) | Copia del artículo. CHECK entre 0 y 100 |

### `ContactoCobranza`
Llamado o mensaje a un cliente. Solo guarda lo que pasó y lo que se prometió.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `clienteId` | uuid FK | |
| `fecha` | date | Día del contacto (hoy en Argentina) |
| `nota` | text | CHECK: no vacía (sin contar espacios) y hasta 500 caracteres |
| `proximoContacto` | date? | Cuándo volver a llamar. CHECK: no puede ser anterior a `fecha` |
| `creadoEn` | timestamptz | Desempata dos contactos del mismo día: manda el último cargado |

Índice `(clienteId, fecha)`. Sin `usuarioId` todavía (ola 4).

## Decisiones de la ola 7

- **Totales de presupuesto no se persisten.** Se calculan con `totalizarPresupuesto`, el mismo motor
  que la venta. El bruto del presupuesto es el de la venta que sale de convertirlo, y la conversión
  lo verifica antes de cerrar la transacción.
- **"Vencido" se calcula.** Un presupuesto abierto vence cuando hoy es posterior a `fecha + validezDias`.
  El estado guardado no lo tiene, así que no puede quedar desincronizado (igual que los saldos).
- **Precios congelados.** Al crear, y al agregar una línea al editar, el precio sale de `resolverPrecio`.
  Después no cambia: al editar, las líneas que ya estaban conservan su precio, salvo que cambie el cliente
  (entonces se reprecia todo).
- **Numeración por año.** Presupuestos y ventas tienen cada uno su correlativo por año. Los presupuestos
  usan un lock de transacción propio, así que no esperan a las ventas ni al revés.
- **`ventaId` único.** Una venta sale de un solo presupuesto. La CHECK impide un presupuesto `CONVERTIDO`
  sin venta y una venta colgada de un presupuesto que no está convertido.
- **La conversión no se repite.** `convertirPresupuestoEnTx` bloquea la fila (`FOR UPDATE`) y revisa el
  estado antes de crear la venta. La CHECK es la red final.
- **Saldo y antigüedad de los recordatorios: derivados.** Salen de ventas y pagos no anulados, igual que
  `/cobranzas`: la antigüedad es desde la venta impaga más vieja del cliente. `ContactoCobranza` no guarda
  saldo ni antigüedad, solo el contacto.

## Cálculos derivados (no se persisten)

```
neto_bruto  = bruto / (1 + ivaPct/100)
margen_item = (bruto - costoTotalSnapshot) / bruto
saldo_venta = venta.totalBruto - SUM(pagos.monto)
saldo_cliente = SUM(saldo_venta) sobre ventas no anuladas
costo_receta = SUM(cantidad × costo_efectivo)  --Overrides primero
precio_sugerido = costo_receta / (1 - margenObjetivo)

-- Listas de precios y presupuestos (ola 7)
precio_linea      = resolverPrecio: específico → catálogo − descuento → catálogo
valido_hasta      = presupuesto.fecha + validezDias
vencido           = estado = ABIERTO AND hoy > valido_hasta
total_presupuesto = totalizarPresupuesto(líneas)   -- neto, IVA y bruto; sin costos
```

Margen objetivo por defecto: 40% (configurable). Es el número contra el que se comparan los artículos
para detectar los que se venden por debajo de su valor.
