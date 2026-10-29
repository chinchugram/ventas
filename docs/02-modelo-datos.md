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
| `creadoEn`, `actualizadoEn` | timestamptz | |

Índice único parcial sobre `cuit` cuando no es null.

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

No se modelan pagos sin venta (anticipos a cuenta) en el MVP: el pedido puede tener
`estado = PENDIENTE` y el saldo a favor se maneja fuera del sistema hasta la etapa 2.

### `Compra` + `CompraItem` (etapa 2)
`Compra`: `fecha`, `proveedor` (texto libre), `comprobante?`, `notas?`, `total` (suma de subtotales).
`CompraItem`: `materialId`, `cantidad` (> 0), `costoUnitario`, `subtotal`.

Al registrar una compra, en una sola transacción: se guardan cabecera y líneas, se suma el stock
y se crea un `MovimientoStock` por línea. Opcionalmente el costo del material pasa a ser el de la
compra (último precio pagado = costo de reposición); las ventas viejas conservan su snapshot.

### `MovimientoStock` (etapa 2)
Libro de stock, nunca se edita. `tipo` (`COMPRA`, `VENTA` o `AJUSTE`), `cantidad` con signo,
`stockResultante` (saldo luego del movimiento, CHECK >= 0), `motivo?`, `compraId?`, `ventaId?`.
`VENTA` es el descuento al confirmar una venta (uno por material de las recetas); al anularla se
crean movimientos `VENTA` de signo contrario con lo que realmente salió. Si faltaba stock, se
descuenta lo disponible (el saldo nunca es negativo) y el motivo deja constancia del faltante.
Los ajustes por conteo físico registran la diferencia como `AJUSTE` con su motivo.

### `Configuracion`
| Campo | Tipo | Notas |
|---|---|---|
| `clave` | text PK | `costoHoraManoObra`, `nombreNegocio`, `ivaDefault`, `moneda` |
| `valor` | text | Todo como texto; se castea al leer |

## Cálculos derivados (no se persisten)

```
neto_bruto  = bruto / (1 + ivaPct/100)
margen_item = (bruto - costoTotalSnapshot) / bruto
saldo_venta = venta.totalBruto - SUM(pagos.monto)
saldo_cliente = SUM(saldo_venta) sobre ventas no anuladas
costo_receta = SUM(cantidad × costo_efectivo)  --Overrides primero
precio_sugerido = costo_receta / (1 - margenObjetivo)
```

Margen objetivo por defecto: 40% (configurable). Es el número contra el que se comparan los artículos
para detectar los que se venden por debajo de su valor.
