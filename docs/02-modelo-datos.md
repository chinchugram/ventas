# Modelo de datos

Un solo modelo para todo el sistema, tal como queda con las olas 0 a 7 integradas (ramas
`integracion-4-7` y `ola-5`) y el multi-tenant (ola 8, rama `multitenant`: `negocios`, `negocioId`, RLS y `SUPERADMIN`). La fuente de verdad es `prisma/schema.prisma`; lo que Prisma no expresa
(`CHECK`, índices únicos parciales, triggers) está en las migraciones de `prisma/migrations/`, listadas al final.

## Ideas de diseño

1. **Nada de saldos almacenados.** El saldo de un cliente y el estado de pago de una venta siempre se
   *calculan* a partir de ventas y pagos. Así es imposible que el sistema muestre una cifra que no
   cuadre con los comprobantes. Lo mismo vale para el vencimiento de un presupuesto y la antigüedad de una deuda.

2. **El costo se congela en la venta.** `VentaItem` guarda `costoUnitarioSnapshot` y `costoTotalSnapshot`.
   Los costos de materiales cambian; la historia financiera no se reescribe.

3. **Los precios se congelan donde se usan.** `VentaItem` y `PresupuestoItem` guardan el precio de cada
   línea. Un cambio posterior en el catálogo o en una lista de precios no mueve ni la venta ni el presupuesto.

4. **Un solo catálogo de materiales para insumo y reventa.** El vinilo que se consume en un sticker y el
   vinilo que se vende por metro usan la misma tabla; cambia si tiene receta o se vende directo.

5. **El costo de un artículo sale de su receta**, no se tipea. Un artículo sin receta tiene costo 0 y se
   reporta como "costo desconocido" para que el dueño lo sepa en lugar de creer un margen falso.

6. **Baja lógica en todos los catálogos.** `activo = false` en clientes, artículos, materiales, usuarios y
   listas de precios. Ningún registro con historial se borra.

7. **Quién hizo qué.** Las tablas que registran una operación guardan `usuarioId` (ver "Trazabilidad"). Es
   nullable: lo anterior a los usuarios queda en `NULL` y se muestra "—", sin inventar un autor. Los usuarios
   no se borran (FK `RESTRICT`), así que la trazabilidad no se pierde.

8. **El comprobante es una foto.** Una factura o nota de crédito copia emisor, receptor, líneas e importes
   al emitirse. Después no lee el cliente, el artículo ni la configuración: editarlos no cambia ni un byte del
   comprobante. Lo que un comprobante emitido tiene mal se corrige con una nota de crédito, nunca editándolo.

9. **Cada fila tiene dueño (multi-tenant).** Todas las tablas de datos guardan `negocioId` (ver "Negocio y
   multi-tenant"). Postgres fuerza el aislamiento con Row Level Security (una política por tabla; decisión,
   descartes y roles en `docs/03-stack-y-decisiones.md`), las restricciones únicas son **por negocio** y la app solo
   toca los datos dentro de `conNegocio(negocioId, fn)`.

## Mapa de tablas

| Grupo | Tablas |
|---|---|
| Negocios (multi-tenant) | `negocios` |
| Usuarios y acceso | `usuarios`, `sesiones` (enum `Rol`) |
| Clientes | `clientes` (con `condicionIva` y `dni`) |
| Facturación | `comprobantes`, `comprobante_items`, `comprobante_iva` |
| Catálogo y costos | `articulos`, `recetas`, `receta_componentes`, `materiales`, `maquinas`, `configuracion` |
| Ventas y cobros | `ventas`, `venta_items`, `pagos` |
| Compras y stock | `compras`, `compra_items`, `movimientos_stock` |
| Comercial | `listas_precios`, `lista_precio_items`, `presupuestos`, `presupuesto_items` |
| Cobranza | `contactos_cobranza` |
| Producción (ola 6) | `trabajos_produccion`, `trabajo_tiempos`, `trabajo_consumos` |

---

## Entidades

### Negocio y multi-tenant

#### `Negocio`
Un negocio (tenant) y dueño de todos los datos. Tabla `negocios`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `nombre` | string | "HL Laser" |
| `slug` | string | único; identificador corto ("hl-laser"). Es lo que se escribe en *Negocio* al entrar. `admin`, `api`, `login`, `www` y `app` están reservados |
| `logoUrl` | string? | opcional: ruta del propio sitio o `https`. El logo que sube el dueño no va acá: se guarda en la `configuracion` del propio negocio (`logoMime`, `logoDatos`, `logoVersion`) |
| `activo` | bool | baja lógica: un negocio no se borra. Dado de baja, nadie entra y sus sesiones dejan de valer |
| `creadoEn`, `actualizadoEn` | timestamptz | |

**RLS en `negocios`** (`20260601030100_superadmin_sesiones_rls`): la lectura es libre (el login resuelve `slug` → id antes de
tener contexto de negocio); el alta y los cambios solo con el contexto de SUPERADMIN; nunca se borra. La cantidad de usuarios de
cada negocio que ve el SUPERADMIN sale de la función `usuarios_por_negocio()` (`SECURITY DEFINER`: solo conteos y solo para SUPERADMIN;
exige que su dueño tenga `BYPASSRLS`). Los permisos de `ventas_app` sobre `negocios` y esa función se otorgan con
`scripts/crear-roles-db.sql`, que se **re-corre tras migrar** (`docs/03-stack-y-decisiones.md`).

#### `negocioId` en las demás tablas
Lo llevan las 22 tablas de datos de F1.1: `clientes`, `materiales`, `maquinas`, `articulos`, `listas_precios`,
`lista_precio_items`, `recetas`, `receta_componentes`, `ventas`, `venta_items`, `pagos`, `compras`,
`compra_items`, `movimientos_stock`, `contactos_cobranza`, `presupuestos`, `presupuesto_items`, `usuarios`,
`sesiones`, `comprobantes`, `comprobante_items` y `comprobante_iva`. `configuracion` lo lleva en su clave
compuesta `(negocioId, clave)` (F1.2) y las 3 tablas de producción de la ola 6 (`trabajos_produccion`,
`trabajo_tiempos` y `trabajo_consumos`) lo reciben en `20260601020000_negocio_produccion` (F1.3, abajo).

- `uuid NOT NULL`, FK a `negocios` con `ON DELETE RESTRICT`. Sin `DEFAULT`: toda fila nueva tiene que decir de
  qué negocio es.
- **Decisión: columna propia también en las hijas** (`venta_items`, `pagos`, `receta_componentes`,
  `comprobante_items`, ...) en lugar de heredar el negocio por la FK del padre. Cuesta una columna por fila
  y permite que RLS (F2.1) filtre sin joins. Que la hija y su padre coincidan en negocio no lo garantiza esta
  migración (queda para F1.2/F2.1).
- **`usuarios.negocioId` y `sesiones.negocioId` son nullable**: solo el `SUPERADMIN` va sin negocio. Un CHECK
  (`usuarios_superadmin_sin_negocio`) exige `rol = 'SUPERADMIN'` ⇔ `negocioId IS NULL`; el trigger de `sesiones` exige que la sesión
  tenga el negocio de su usuario. Todos los dueños y empleados tienen negocio.
- **`configuracion` lleva `negocioId` en su clave primaria `(negocioId, clave)`** (F1.2): cada negocio tiene sus propias claves
  (nombre, costo hora, datos fiscales, logo).
- **Los únicos son por negocio** (F1.2, `20260601010000_unicos_por_negocio`): `ventas(negocioId, anio, numero)`,
  `presupuestos(negocioId, anio, numero)`, `listas_precios(negocioId, nombre)`, `usuarios(negocioId, usuario)` (más un índice parcial
  que mantiene único el usuario de quienes no tienen negocio), CUIT de cliente (parcial, `(negocioId, cuit)`) y las series de
  comprobantes `(negocioId, ambiente, puntoVenta, tipo[, numero])`. Dos negocios pueden tener el mismo número de venta, el mismo CUIT de
  cliente, el mismo nombre de usuario y la misma serie fiscal.
- **El hijo es del mismo negocio que el padre**, y `negocioId` no cambia: lo garantizan triggers (`negocio_igual_al_padre`,
  `negocio_inmutable`), no claves compuestas. Un usuario sin negocio (SUPERADMIN) puede figurar como autor de filas de cualquier negocio;
  un usuario con negocio, solo de las del suyo.
- **RLS** (F2.1, `20260601020000_rls`): las 26 tablas con `negocioId` tienen `ENABLE` + `FORCE ROW LEVEL SECURITY` y una política
  `aislamiento_negocio` (`"negocioId" = app.negocio_id`). En `usuarios` y `sesiones` la política suma la rama del SUPERADMIN
  (filas con `negocioId` NULL, solo con `app.superadmin = 'on'`).
- Índices: uno por `negocioId` en cada tabla. En las grandes, `negocioId` es la primera columna de los
  compuestos, que ya cubren las consultas solo por negocio: `ventas(negocioId, fecha)` y `(negocioId, estado)`,
  `pagos(negocioId, fecha)` y `(negocioId, ventaId)`, `movimientos_stock(negocioId, materialId, creadoEn)`,
  `comprobantes(negocioId, fecha)` y `(negocioId, estado)`.
- `TrabajoProduccion`, `TrabajoTiempo` y `TrabajoConsumo` (ola 6) no existían cuando se hizo F1.1: entraron a
  `multitenant` con el merge de `staging` y reciben `negocioId` en F1.3 (ver "Producción y negocio").

#### Migración y backfill (`20260601000000_negocio`)
Crea el negocio "HL Laser" (`hl-laser`) y se lo asigna a todas las filas existentes. Por tabla: columna
nullable → `UPDATE` → `SET NOT NULL` (salvo `usuarios`) → FK → índice. En una base vacía solo queda el negocio.
Los triggers de `comprobantes`, `comprobante_items` y `comprobante_iva` (lo fiscal es inmutable) se desactivan
solo durante el `UPDATE` de cada una de esas tablas y se reactivan enseguida: asignar el dueño no cambia nada
fiscal. Prueba: `NEGOCIO_TEST_URL=postgresql://ventas:ventas@localhost:5432 sh scripts/test-negocio-migracion.sh`
(base vacía y base con datos; compara filas por tabla, `SUM(ventas.totalBruto)`, saldos de clientes y
`materiales.stockActual` antes y después) y `scripts/verificar-negocio.sql` sobre cualquier base migrada.

#### Producción y negocio (`20260601020000_negocio_produccion`, F1.3)
`trabajos_produccion`, `trabajo_tiempos` y `trabajo_consumos` llevan `negocioId` como el resto de las tablas de
datos (columna propia también en las hijas, para que RLS no necesite joins):

- `uuid NOT NULL`, sin `DEFAULT`, FK a `negocios` con `ON DELETE RESTRICT` e índice `<tabla>_negocioId_idx`. Los
  únicos (`trabajo_tiempos(trabajoId, maquinaId)`, `trabajo_consumos(trabajoId, materialId)` y el parcial
  `trabajos_produccion_vigente_key` por línea) no cambian: cuelgan de ids UUID y no pueden chocar entre negocios.
- Backfill: las filas existentes pasan al negocio `hl-laser`. Estas tablas no tienen triggers de inmutabilidad
  propios, así que no hace falta desactivar nada.
- Triggers, con el mismo patrón que el resto: `<tabla>_negocio_inmutable` en las tres (el negocio de una fila no
  se cambia) y `negocio_igual_al_padre` en cada FK: `trabajos_produccion.ventaItemId` (`venta_items`) y
  `.usuarioId` (`usuarios`; un usuario sin negocio puede figurar como autor), `trabajo_tiempos.trabajoId`
  (`trabajos_produccion`) y `.maquinaId` (`maquinas`), `trabajo_consumos.trabajoId` y `.materialId`
  (`materiales`).
- Código: `src/lib/dominio/produccion.ts` recibe `negocioId` como parámetro (segundo argumento, después de `tx`) y
  filtra por él sus lecturas y bloqueos; las acciones de `src/app/produccion/actions.ts` lo sacan de
  `negocioUnico(tx)` (transitorio en F1.3; desde F3 y F4.1 las acciones usan el negocio de la sesión, `getNegocioId()`).
- Pruebas: `scripts/test-negocio-migracion.sh` aplica `20260601000000_negocio` y las posteriores sobre una base
  vacía y sobre una con datos (incluye un trabajo vigente y uno anulado, con tiempos y consumos) y compara lo
  medido y los costos congelados antes y después; `scripts/verificar-negocio.sql` exige las 26 tablas con
  `negocioId` (FK `RESTRICT`, índice y triggers en las 3 de producción); `scripts/test-unicos-negocio.sql`
  prueba que la base rechaza un trabajo, tiempo o consumo apuntando a filas de otro negocio.

### Usuarios y sesiones

#### `Usuario`
Persona que entra al sistema. Sin sesión válida no se ve nada (ver `src/lib/auth.ts`).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `negocioId` | uuid? FK | Negocio del usuario. `NULL` si y solo si el rol es `SUPERADMIN` (CHECK) |
| `usuario` | text | Nombre para entrar, en minúsculas. Formato `^[a-z0-9._-]{3,40}$`. **Único por negocio** (y entre los que no tienen negocio) |
| `nombre` | text | Para mostrar ("Laura", "Mostrador"). 1 a 80 caracteres, sin contar espacios de los extremos |
| `rol` | enum `Rol` | `DUENO`, `EMPLEADO` o `SUPERADMIN` |
| `debeCambiarClave` | bool | La clave inicial la puso otra persona (alta desde `/admin/negocios`): hasta cambiarla solo se entra a `/usuarios/mi-clave` |
| `hashClave` | text | `scrypt$ln=…,r=…,p=…$sal$hash`. Nunca sale del servidor |
| `activo` | bool | Baja lógica. Reactivar es volver a `true` |
| `intentosFallidos`, `ultimoFalloEn`, `bloqueadoHasta` | int, timestamptz? | Pausa por intentos fallidos. Está en la base, así sobrevive reinicios |
| `creadoEn`, `actualizadoEn` | timestamptz | |

CHECK en la migración `20260210000000_usuarios_y_sesiones`: `usuario` en minúsculas y con formato;
`nombre` de 1 a 80 caracteres; `hashClave` con formato scrypt (nunca vacío ni texto plano);
`intentosFallidos >= 0`.

Decisiones:
- **Nunca se borra un usuario en la app.** Dar de baja es `activo = false`: el historial (ventas, cobros,
  compras, movimientos, presupuestos, contactos y listas) sigue apuntando a él.
- **FK `RESTRICT`** desde `sesiones` y desde todas las tablas con `usuarioId`: la base rechaza borrar un
  usuario que tenga historial o sesiones. El seed es la única vía que borra usuarios, y solo fuera de
  producción, después de borrar sesiones y todo lo cargado.
- El primer dueño de un negocio se crea con `npm run usuarios:crear-dueno -- --negocio <slug>` (o desde `/admin/negocios`), que se
  niega si ya existe un dueño **en ese negocio** (aunque esté dado de baja). Los demás usuarios, incluido otro dueño, se crean desde `/usuarios`.
- El `SUPERADMIN` se crea con `npm run usuarios:crear-superadmin` (nunca desde la web), sin negocio; entra en `/login` con el negocio `admin`.

#### `Sesion`
Sesión abierta. La cookie lleva un token aleatorio de 32 bytes; la base guarda solo su SHA-256.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `tokenHash` | text, único | SHA-256 en hex (64 caracteres). El token en claro nunca se guarda |
| `negocioId` | uuid? FK | Negocio de la sesión: el de su usuario (`NULL` para el `SUPERADMIN`). La cookie es `<negocioId>.<token>` (`admin.<token>` para el SUPERADMIN) |
| `usuarioId` | uuid FK | `Usuario`. FK `RESTRICT` |
| `creadaEn` | timestamptz | |
| `renovadaEn` | timestamptz | Última extensión del vencimiento; a lo sumo una vez por día |
| `expiraEn` | timestamptz | 30 días desde la última renovación |

CHECK: `tokenHash` es 64 caracteres hex minúsculas; `expiraEn > creadaEn`; `renovadaEn >= creadaEn`.

Decisiones:
- Quien lee la tabla o un respaldo no puede usar las sesiones. Como el token tiene 256 bits de entropía,
  el hash es SHA-256 sin sal (no hace falta un hash lento).
- **Desde el multi-tenant la cookie lleva `<negocioId>.<token>`**: una cookie con la forma anterior (solo el token) no abre sesión
  y obliga a entrar de nuevo, eligiendo el negocio. El `negocioId` de la cookie es solo una pista para abrir el contexto RLS; el negocio
  que se usa sale siempre de la fila de la sesión.
- Cerrar sesión borra su fila. Dar de baja, cambiar el rol o reiniciar la clave borra todas las sesiones
  del usuario. Una sesión vencida no vale aunque exista, y se borra al encontrarla (no hay tarea programada).

#### `Rol` (enum)
`DUENO` (todo), `EMPLEADO` y `SUPERADMIN` (administra los negocios, sin negocio propio y sin ver datos de ninguno). Es el tipo `"Rol"` de Postgres. Qué puede cada rol está en
`src/lib/permisos-pura.ts`.

### Clientes

#### `Cliente`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text | Nombre comercial o razón social |
| `cuit` | text? | Guardado como texto (conserva ceros). Índice único parcial sobre `(negocioId, cuit)` cuando no es null |
| `telefono`, `email`, `direccion`, `notas` | text? | |
| `activo` | bool | Baja lógica |
| `listaPrecioId` | uuid? FK | Lista de precios asignada (`ListaPrecio`). Null = precio de catálogo. FK `RESTRICT`, con índice |
| `condicionIva` | enum `CondicionIva` | Condición frente al IVA del cliente. Por defecto `CONSUMIDOR_FINAL`. Decide la letra de la factura (ver "Facturación") |
| `dni` | text? | 7 u 8 dígitos, sin puntos. CHECK `^[0-9]{7,8}$` (o null). Sin CUIT ni DNI, el consumidor final va sin identificar |
| `creadoEn`, `actualizadoEn` | timestamptz | |

Una lista asignada no se borra (`ON DELETE RESTRICT`): la app solo la da de baja. Asignarla requiere el
permiso `gestionarListasPrecios` (solo `DUENO`): el empleado no ve ni cambia ese selector.

### Catálogo y costos

#### `Material`
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

#### `Maquina`
Recurso de producción con costo horario.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text | Plotter, láser, vinyladora, plotter de corte |
| `costoHora` | decimal(14,2) | Incluye depreciación/amortización y consumibles propios |
| `activo` | bool | |

#### `Articulo`
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

#### `Receta` + `RecetaComponente`
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

#### `Configuracion`
Clave-valor. Todo se guarda como texto y se castea al leer; una clave que falta vale su default de
`src/lib/configuracion.ts`, así que una clave nueva no necesita migración (se crea con upsert la primera vez).

| Campo | Tipo | Notas |
|---|---|---|
| `negocioId` | uuid PK | Parte de la clave primaria: cada negocio tiene las suyas |
| `clave` | text PK | Ver la tabla de claves abajo |
| `valor` | text | Todo como texto; se castea al leer |

Claves de negocio (`src/lib/configuracion.ts`): `nombreNegocio`, `costoHoraManoObra`, `ivaPorDefecto`, `margenObjetivo`.

Claves fiscales (ola 5, `src/lib/datos-fiscales.ts`, `CLAVES_FISCALES`). Solo las edita el dueño en `/configuracion`:

| Clave | Valor | Notas |
|---|---|---|
| `fiscalRazonSocial` | texto | Obligatoria. Hasta 200 caracteres |
| `fiscalCuit` | 11 dígitos | Obligatoria. Validada con `validarCuit`, sin guiones |
| `fiscalCondicionIva` | `RESPONSABLE_INSCRIPTO` o `MONOTRIBUTO` | Vacía = responsable inscripto. Decide si el emisor factura A/B o C |
| `fiscalDomicilio` | texto | Obligatoria. Hasta 200 caracteres |
| `fiscalInicioActividades` | fecha ISO `aaaa-mm-dd` | Obligatoria. Se tipea como dd/mm/aaaa; no futura ni anterior a 1900 |
| `fiscalIibb` | texto | Opcional (ingresos brutos). Hasta 30 caracteres; `""` borra la clave |
| `fiscalPuntoVenta` | entero 1–99999 | Obligatoria. El de alta en ARCA para factura electrónica |
| `fiscalUmbralIdentificacion` | importe en pesos | Opcional; `""` = `UMBRAL_IDENTIFICACION_POR_DEFECTO` ($ 10.000.000, a confirmar con el contador) |

### Ventas y cobros

#### `Venta`
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
| `usuarioId` | uuid? FK | Quién cargó la venta. `NULL` = histórico, se muestra "—". FK `RESTRICT` |
| `creadoEn`, `actualizadoEn` | timestamptz | |

`numero` es único **por negocio y por `anio`**, no global. Una venta puede salir de un presupuesto (`Presupuesto.ventaId`).

Una venta con factura vigente (PENDIENTE o EMITIDA) **no se anula**: la base lo impide hasta que una nota de
crédito EMITIDA anule la factura (trigger `ventas_validar_anulacion_facturada`). Ver "Facturación".

#### `VentaItem`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `ventaId` | uuid FK | |
| `articuloId` | uuid FK | |
| `descripcion` | text | Copia del nombre al momento de la venta |
| `cantidad` | decimal(14,3) | |
| `precioUnitario` | decimal(14,4) | Con IVA. Lo decide el servidor con `resolverPrecio` (o se congela desde el presupuesto) |
| `ivaPct` | decimal(5,2) | Copia del artículo al momento de la venta |
| `subtotalNeto`, `subtotalIVA`, `subtotalBruto` | decimal(14,2) | Derivados, guardados para auditoría |
| `costoUnitarioSnapshot` | decimal(14,4) | Costo unitario **al momento de la venta** |
| `costoTotalSnapshot` | decimal(14,2) | `cantidad × costoUnitarioSnapshot` |

> `costoTotalSnapshot = 0` + `receta` vacía ⇒ margen no confiable. El dashboard lo señala.

#### `Pago`
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
| `usuarioId` | uuid? FK | Quién registró el cobro. `NULL` = histórico, se muestra "—". FK `RESTRICT` |

No se modelan pagos sin venta (anticipos a cuenta) todavía: el pedido puede tener `estado = PENDIENTE`
y el saldo a favor se maneja fuera del sistema.

### Compras y stock

#### `Compra` + `CompraItem`
`Compra`: `fecha`, `proveedor` (texto libre), `comprobante?`, `notas?`, `total` (suma de subtotales),
`usuarioId?` (quién la cargó; `NULL` = histórico, FK `RESTRICT`).
`CompraItem`: `materialId`, `cantidad` (> 0), `costoUnitario`, `subtotal`.

Al registrar una compra, en una sola transacción: se guardan cabecera y líneas, se suma el stock
y se crea un `MovimientoStock` por línea. Opcionalmente el costo del material pasa a ser el de la
compra (último precio pagado = costo de reposición); las ventas viejas conservan su snapshot.

#### `MovimientoStock`
Libro de stock, nunca se edita. `tipo` (`COMPRA`, `VENTA` o `AJUSTE`), `cantidad` con signo,
`stockResultante` (saldo luego del movimiento, CHECK >= 0), `motivo?`, `compraId?`, `ventaId?`,
`usuarioId?` (quién hizo el movimiento o la operación que lo generó; `NULL` = histórico, FK `RESTRICT`).
`VENTA` es el descuento al confirmar una venta (uno por material de las recetas); al anularla se
crean movimientos `VENTA` de signo contrario con lo que realmente salió (`ventaId` apunta a la venta
para poder revertirlo exactamente). Si faltaba stock, se descuenta lo disponible (el saldo nunca es
negativo) y el motivo deja constancia del faltante.
Los ajustes por conteo físico registran la diferencia como `AJUSTE` con su motivo.

### Comercial

#### `ListaPrecio`
Descuento general sobre el catálogo y/o precios específicos por artículo, para un grupo de clientes.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text, único por negocio | El dominio no distingue mayúsculas; la base solo exige único exacto dentro del negocio |
| `descuentoPct` | decimal(5,2) | 0 a 100 (CHECK). Se descuenta del precio de catálogo |
| `activo` | bool | Baja lógica. Una lista de baja no se aplica, aunque tenga clientes asignados |
| `usuarioId` | uuid? FK | Quién la creó. `NULL` = histórico, se muestra "—". FK `RESTRICT` |
| `creadoEn`, `actualizadoEn` | timestamptz | |

#### `ListaPrecioItem`
Precio específico de un artículo dentro de una lista.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `listaPrecioId` | uuid FK | `ON DELETE CASCADE` (la app nunca borra listas) |
| `articuloId` | uuid FK | `ON DELETE RESTRICT` |
| `precio` | decimal(14,4) | Con IVA incluido, como `Articulo.precioVenta`. CHECK `>= 0` |
| `creadoEn`, `actualizadoEn` | timestamptz | |

Único `(listaPrecioId, articuloId)`: un precio por artículo por lista.

#### `Presupuesto`
Oferta de precios a un cliente. No guarda costos ni márgenes.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `numero` | int | Correlativo por año, generado en la transacción. CHECK `> 0` |
| `anio` | int | Parte del único |
| `clienteId` | uuid FK | |
| `fecha` | date | Día de emisión (hoy en Argentina) |
| `validezDias` | int | Por defecto 15. CHECK `> 0`; el dominio acepta hasta 365. Vale hasta `fecha + validezDias`, inclusive |
| `observaciones` | text? | |
| `estado` | enum | `ABIERTO` (por defecto), `CONVERTIDO`, `ANULADO`. "Vencido" no es un estado guardado |
| `ventaId` | uuid? FK único | Venta en la que se convirtió. Null si no está convertido |
| `duplicadoDeId` | uuid? FK | Presupuesto del que es copia (con precios de hoy) |
| `usuarioId` | uuid? FK | Quién lo creó. `NULL` = histórico. No cambia al editarlo; el duplicado queda a nombre de quien duplica. FK `RESTRICT` |
| `creadoEn`, `actualizadoEn` | timestamptz | |

Único `(negocioId, anio, numero)`. CHECK `(estado = 'CONVERTIDO') = (ventaId IS NOT NULL)`.

#### `PresupuestoItem`
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

### Cobranza

#### `ContactoCobranza`
Llamado o mensaje a un cliente. Solo guarda lo que pasó y lo que se prometió; el saldo y la antigüedad
se calculan desde ventas y pagos.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `clienteId` | uuid FK | |
| `fecha` | date | Día del contacto (hoy en Argentina) |
| `nota` | text | CHECK: no vacía (sin contar espacios) y hasta 500 caracteres |
| `proximoContacto` | date? | Cuándo volver a llamar. CHECK: no puede ser anterior a `fecha` |
| `usuarioId` | uuid? FK | Quién lo registró. `NULL` = histórico. FK `RESTRICT` |
| `creadoEn` | timestamptz | Desempata dos contactos del mismo día: manda el último cargado |

Índices `(clienteId, fecha)` y `usuarioId`.

### Facturación

Las tres tablas se escriben solo al emitir (ver "Decisiones de la ola 5"). El comprobante es una **foto**: emisor,
receptor, líneas e importes se copian de la venta, del cliente y de `Configuracion` en el momento de emitir.

Enums:

| Enum | Valores | Notas |
|---|---|---|
| `CondicionIva` | `CONSUMIDOR_FINAL`, `RESPONSABLE_INSCRIPTO`, `MONOTRIBUTO`, `EXENTO` | Condición del cliente (`clientes.condicionIva`) y del emisor (foto). El emisor solo puede ser RI o monotributo |
| `TipoComprobante` | `FACTURA_A`, `FACTURA_B`, `FACTURA_C`, `NOTA_CREDITO_A`, `NOTA_CREDITO_B`, `NOTA_CREDITO_C` | La letra sale de la condición del emisor y del receptor |
| `AmbienteFiscal` | `SIMULADO`, `HOMOLOGACION`, `PRODUCCION` | `SIMULADO` es lo que emite hoy el emisor simulado. Toda fila `SIMULADO` lleva la marca "SIN VALIDEZ FISCAL" |
| `EstadoComprobante` | `PENDIENTE`, `EMITIDO`, `RECHAZADO` | `PENDIENTE` = número reservado, sin CAE. `RECHAZADO` = el emisor no lo autorizó |

#### `Comprobante`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `ambiente` | enum `AmbienteFiscal` | |
| `tipo` | enum `TipoComprobante` | |
| `codigoArca` | int | Código ARCA del tipo: factura A 1, B 6, C 11; nota de crédito A 3, B 8, C 13. CHECK coherente con `tipo` |
| `puntoVenta` | int | CHECK 1–99999 |
| `numero` | int | CHECK `> 0`. Único vigente por (negocio, ambiente, punto de venta, tipo) |
| `fecha` | date | Hoy en Argentina al emitir |
| `estado` | enum `EstadoComprobante` | Por defecto `PENDIENTE` (y un comprobante solo nace así) |
| `emisorRazonSocial`, `emisorDomicilio` | text | Foto. No vacíos (CHECK) |
| `emisorCuit` | text | Foto. 11 dígitos (CHECK) |
| `emisorCondicionIva` | enum `CondicionIva` | Foto. CHECK: RI o monotributo. RI emite A/B; monotributo emite C |
| `emisorInicioActividades` | date | Foto |
| `emisorIibb` | text? | Foto. Opcional |
| `receptorNombre` | text | Foto. No vacío (CHECK) |
| `receptorDocTipo` | int | Código ARCA: 80 CUIT, 96 DNI, 99 sin identificar. CHECK con el formato del número |
| `receptorDocNro` | text | 11 dígitos (80), 7–8 (96), o `"0"` (99) |
| `receptorCondicionIva` | enum `CondicionIva` | Foto |
| `receptorDomicilio` | text? | Foto. Opcional |
| `importeNeto`, `importeIva`, `importeTotal` | decimal(14,2) | Todos ≥ 0. CHECK: total = neto + IVA. En la C, el neto es el total e IVA = 0 |
| `cae` | text? | 14 dígitos. Solo (y siempre) en `EMITIDO` (CHECK) |
| `caeVencimiento` | date? | Solo (y siempre) en `EMITIDO` (CHECK) |
| `observaciones` | text? | En `RECHAZADO` es el motivo del emisor, obligatorio (CHECK) |
| `comprobanteAsociadoId` | uuid? FK | Solo en notas de crédito: la factura que anulan. Obligatorio en la NC, prohibido en la factura, y nunca apunta a sí mismo (CHECK) |
| `ventaId` | uuid FK | `RESTRICT` |
| `usuarioId` | uuid? FK | Quien emitió. `NULL` = histórico, se muestra "—". `RESTRICT` |
| `creadoEn` | timestamptz(3) | |
| `actualizadoEn` | timestamptz(3) | Lo único que cambia en un `EMITIDO` o `RECHAZADO` (Prisma lo toca en cada update) |

CHECK (además de los de arriba): la factura C no discrimina IVA (`importeIva = 0`); la A solo a un RI identificado
con CUIT; "EMITIDO" ⇔ CAE ⇔ vencimiento; "RECHAZADO" siempre con motivo; la NC ⇔ comprobante asociado.

Índices: `ventaId`, `comprobanteAsociadoId`, `usuarioId`, `fecha`, `estado`. Únicos **parciales**:

| Índice | Columnas | Condición | Para qué |
|---|---|---|---|
| `comprobantes_numero_vigente_key` | (negocioId, ambiente, puntoVenta, tipo, numero) | `estado IN (PENDIENTE, EMITIDO)` | Un número vigente por serie. Un `RECHAZADO` no ocupa el número |
| `comprobantes_un_pendiente_por_serie_key` | (negocioId, ambiente, puntoVenta, tipo) | `estado = PENDIENTE` | Mientras un intento no se resuelve, no se sabe cuál es el próximo número |
| `comprobantes_factura_vigente_por_venta_key` | (ventaId) | factura y vigente | Una sola factura vigente por venta |
| `comprobantes_nc_vigente_por_factura_key` | (comprobanteAsociadoId) | NC y vigente | Una sola nota de crédito vigente por factura (la NC es total) |

Triggers:

- **Alta** (`comprobantes_validar_alta`): nace `PENDIENTE`. No se factura una venta `ANULADA`. Una NC solo
  anula una factura **EMITIDA** de la misma venta, ambiente y letra.
- **Cambio** (`comprobantes_validar_cambio`): de un `PENDIENTE` solo cambian `estado`, `cae`, `caeVencimiento` y
  `observaciones`. `EMITIDO` y `RECHAZADO` son inmutables.
- **Baja** (`comprobantes_validar_baja`): solo los `SIMULADO` (datos de desarrollo). Uno de homologación o
  producción no se borra nunca; el seed falla si hay alguno, a propósito.
- **Detalle** (`comprobante_items_validar_detalle`, `comprobante_iva_validar_detalle`): las líneas y alícuotas se
  cargan solo mientras el comprobante está `PENDIENTE`, no se modifican y no se borran sueltas (solo en cascada).
- **Importes** (`comprobantes_verificar_importes`, **diferido**: se verifica al confirmar la transacción): las líneas
  suman el total; en A y B, las alícuotas y las líneas cierran con neto e IVA; en la C no hay alícuotas.
- **Venta** (`ventas_validar_anulacion_facturada`, sobre `ventas`): una venta con factura vigente no se anula
  hasta que una NC `EMITIDA` la anule.

#### `ComprobanteItem`
Copia de cada línea de la venta, con su orden. Sin costos: un comprobante no lleva costos ni márgenes.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `comprobanteId` | uuid FK | `ON DELETE CASCADE` |
| `orden` | int | Posición en el comprobante (1, 2, …). Único por comprobante. CHECK `> 0` |
| `descripcion` | text | Copia del nombre del artículo |
| `cantidad` | decimal(14,3) | CHECK `> 0` |
| `precioUnitario` | decimal(14,4) | Con IVA incluido, como en la venta. CHECK `>= 0` |
| `ivaPct` | decimal(5,2) | CHECK entre 0 y 100 |
| `subtotalNeto`, `subtotalIva`, `subtotalBruto` | decimal(14,2) | CHECK: bruto = neto + IVA, todos ≥ 0 |

#### `ComprobanteIva`
Una fila por alícuota presente: lo que ARCA recibe como arreglo `Iva`. La factura C no tiene filas.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `comprobanteId` | uuid FK | `ON DELETE CASCADE` |
| `alicuotaPct` | decimal(5,2) | Único por comprobante. Valores admitidos: 0, 2,5, 5, 10,5, 21, 27 |
| `codigoArca` | int | Coherente con la alícuota: 0 % → 3, 2,5 % → 9, 5 % → 8, 10,5 % → 4, 21 % → 5, 27 % → 6 (CHECK) |
| `baseImponible`, `importe` | decimal(14,2) | Base = neto gravado de la alícuota; importe = IVA. CHECK ≥ 0 |

---

## Trazabilidad (`usuarioId`)

Las tablas que registran una operación de un empleado o dueño tienen `usuarioId`. Todas siguen el mismo criterio:
nullable (lo histórico queda en `NULL` y se muestra "—"), FK `RESTRICT` a `usuarios`, con índice.

| Tabla | Quién queda registrado |
|---|---|
| `ventas` | Quien cargó la venta |
| `pagos` | Quien registró el cobro |
| `compras` | Quien cargó la compra |
| `movimientos_stock` | Quien hizo el movimiento, o la operación que lo generó (venta, anulación, ajuste) |
| `presupuestos` | Quien lo creó |
| `contactos_cobranza` | Quien registró el contacto |
| `listas_precios` | Quien la creó |
| `comprobantes` | Quien emitió la factura o la nota de crédito. Histórico (NULL) = "—" |
| `trabajos_produccion` | Quien cargó el trabajo |

Se muestra como "Registrado por" en el detalle de venta y de cada cobro, en el libro de movimientos de un
material, en el listado de compras, en el detalle de presupuesto y en cada contacto de `/cobranzas/hoy`. En las listas de precios,
"Creada por" aparece en la ficha de la lista. En cada comprobante, "Emitido por" muestra quién lo emitió.

---

## Decisiones de la ola 7 (comercial)

- **Totales de presupuesto no se persisten.** Se calculan con `totalizarPresupuesto`, el mismo motor
  que la venta. El bruto del presupuesto es el de la venta que sale de convertirlo, y la conversión
  lo verifica antes de cerrar la transacción.
- **"Vencido" se calcula.** Un presupuesto abierto vence cuando hoy es posterior a `fecha + validezDias`.
  El estado guardado no lo tiene, así que no puede quedar desincronizado (igual que los saldos). Un
  presupuesto abierto vencido sigue `ABIERTO`.
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

## Decisiones de la ola 6 (producción y margen real)

Objetivo: pasar de **margen estimado** (costo de receta, congelado en `venta_items.costoTotalSnapshot`) a
**margen real**: registrar lo que de verdad se usó en cada trabajo y compararlo con la receta.

### Tablas

- `trabajos_produccion`: un trabajo = lo producido para **una línea de venta** (`ventaItemId`, FK `RESTRICT`).
  Guarda `fecha`, `minutosManoObra`, `costoHoraManoObraSnapshot`, `notas`, `usuarioId` (quién lo cargó) y la baja
  lógica (`anuladoEn` + `motivoAnulacion`, siempre juntos). Vigente hay **uno solo por línea** (índice único
  parcial `WHERE anuladoEn IS NULL`); para corregirlo se anula y se vuelve a cargar. Nunca se borra.
- `trabajo_tiempos`: minutos de una máquina en un trabajo (`maquinaId`, `minutos`, `costoHoraSnapshot`). Una fila
  por máquina y trabajo. Los minutos de mano de obra van en el trabajo, aparte.
- `trabajo_consumos`: material realmente usado (`materialId`, `cantidad` en la unidad del material,
  `costoUnitarioSnapshot`). Una fila por material y trabajo.
- `CHECK`: minutos, cantidades y costos `>= 0`. Todas las FK son `RESTRICT` (nada se borra en cascada).

### Decisiones (asumidas con el dueño)

1. **El consumo real no mueve stock.** El stock sigue bajando por receta al vender. Al cargar un consumo real se
   ofrece un ajuste por la diferencia contra la receta (movimiento `AJUSTE` explícito, con confirmación); nunca
   se descuenta dos veces.
2. **Producción por línea de venta** (`VentaItem`), porque el desvío se mide por artículo.
3. **Quién carga:** `cargarProduccion` (dueño y empleado: sin costos). **Quién ve el margen real:**
   `verMargenReal`, solo el dueño.
4. **Costos congelados al cargar** (`*Snapshot`): igual que el costo de la venta, un cambio posterior de precio
   del material, de la máquina o de la mano de obra no reescribe el margen real de lo ya producido. Los pone el
   servidor; el cliente nunca los manda.

Costo real de un trabajo = `Σ cantidad × costoUnitarioSnapshot` (materiales) + `Σ minutos / 60 × costoHoraSnapshot`
(máquinas) + `minutosManoObra / 60 × costoHoraManoObraSnapshot`. Desvío = costo real − costo de receta de la línea.
No se persiste: se calcula.

## Decisiones de la ola 5 (facturación)

Detalle fiscal y dudas para el contador: [`docs/fiscal-5.1-decisiones.md`](fiscal-5.1-decisiones.md).

- **Emisión en dos fases.** Si todo pasara en una transacción, un corte o un error al guardar el resultado
  desharía también el `PENDIENTE`, y ARCA podría haber autorizado un número que la base no tiene. Por eso,
  con un emisor real: (1) una transacción corta reserva el número y guarda el `PENDIENTE` con la foto completa,
  y se confirma; (2) el CAE se pide **fuera** de toda transacción; (3) otra transacción corta pasa el
  comprobante a `EMITIDO` o `RECHAZADO`. Si el paso 2 no responde, el `PENDIENTE` queda y se resuelve después
  consultando al emisor. `emitirFactura` recorre estas tres fases; `emitirFacturaEnTx` hace todo en una sola
  transacción y solo acepta el emisor simulado (seed y pruebas).
- **Un RECHAZADO no ocupa el número.** ARCA no consume el número de un comprobante rechazado: el próximo a
  autorizar sigue siendo el último autorizado + 1. Por eso la unicidad del número es un índice parcial sobre
  los vigentes (`PENDIENTE` o `EMITIDO`), no sobre todas las filas. El reintento reusa el número. Es un desvío
  consciente de la letra del contrato: con unicidad total, después de un rechazo el sistema pediría N+1 y ARCA
  lo rechazaría siempre.
- **Numeración por serie.** Un advisory lock por (ambiente, punto de venta, tipo) serializa la emisión. Si hay
  un `PENDIENTE` en la serie, no se emite.
- **Una factura vigente por venta, una NC vigente por factura.** Dos pedidos simultáneos de la misma venta: uno
  gana el bloqueo de la venta y el otro recibe un mensaje claro ("La venta ya está facturada…"), nunca un error
  crudo de unicidad.
- **Claves fiscales en `Configuracion`.** Los datos del negocio (emisor) se guardan como claves de texto, sin
  tabla propia: son pocos, los edita solo el dueño y se validan con `src/lib/datos-fiscales.ts`. La lista de
  claves está en la sección `Configuracion` de este documento.
- **Trazabilidad.** `comprobantes.usuarioId` registra quién emitió la factura o la nota de crédito (la acción
  sale del usuario de la sesión). Como en el resto del modelo, lo histórico queda en `NULL` y se muestra "—".
- **Foto, no referencia.** Lo que un comprobante muestra (emisor, receptor, líneas, importes) sale solo de la
  propia fila y de sus hijas. Una NC copia la foto de su factura, no lee la venta actual.

## Migraciones (en orden)

Están en `prisma/migrations/`. Cada una tiene su encabezado con el porqué.

1. `20260101000000_init`: esquema inicial. Clientes, materiales, máquinas, artículos, recetas y sus
   componentes, ventas, ítems de venta, pagos y configuración. Índice único parcial de CUIT y los primeros `CHECK`.
2. `20260102000000_stock_real`: compras, líneas de compra y libro de movimientos de stock (enum `TipoMovimiento`).
3. `20260103000000_movimientos_de_venta`: `movimientos_stock.ventaId`, para revertir exactamente lo descontado al anular.
4. `20260130010000_pagos_anulables`: `pagos.anuladoEn` y `pagos.motivoAnulacion` (baja lógica del pago).
5. `20260210000000_usuarios_y_sesiones`: enum `Rol`, tablas `usuarios` y `sesiones`, con sus `CHECK`.
6. `20260215000000_trazabilidad_usuario`: `usuarioId` en `ventas`, `pagos`, `compras` y `movimientos_stock`.
7. `20260501000000_listas_precios`: `listas_precios`, `lista_precio_items` y `clientes.listaPrecioId`.
8. `20260510000000_presupuestos`: enum `EstadoPresupuesto`, `presupuestos` y `presupuesto_items`.
9. `20260515000000_contactos_cobranza`: `contactos_cobranza`.
10. `20260520000000_trazabilidad_ola7`: `usuarioId` en `presupuestos`, `contactos_cobranza` y `listas_precios`.
11. `20260301000000_comprobantes`: enums `CondicionIva`, `TipoComprobante`, `AmbienteFiscal` y `EstadoComprobante`;
    tablas `comprobantes`, `comprobante_items` y `comprobante_iva`; `clientes.condicionIva` y `clientes.dni`. Con sus
    `CHECK`, índices parciales y triggers (ver "Facturación").
12. `20260601000000_negocio`: tabla `negocios`, negocio "HL Laser" y `negocioId` (con FK e índices) en las 22
    tablas de datos, con backfill (ver "Negocio y multi-tenant").
13. `20260401000000_produccion`: `trabajos_produccion`, `trabajo_tiempos` y `trabajo_consumos`, con sus `CHECK`,
    índice único parcial del trabajo vigente por línea y FK `RESTRICT`. Va antes de las de la ola 7: solo depende
    de tablas anteriores.
14. `20260601020000_negocio_produccion`: `negocioId` (backfill a `hl-laser`, FK `RESTRICT`, índice y triggers de
    negocio) en las 3 tablas de producción (ver "Producción y negocio").
15. `20260601010000_unicos_por_negocio`: únicos por negocio, `configuracion` con clave `(negocioId, clave)` y triggers de "el hijo es
    del mismo negocio que el padre" y `negocioId` inmutable (ver "Negocio y multi-tenant").
16. `20260601020000_rls`: Row Level Security (`ENABLE` + `FORCE` y la política `aislamiento_negocio`) en las 26 tablas con
    `negocioId`, y permisos de `ventas_app` si el rol ya existe.
17. `20260601030000_rol_superadmin`: valor `SUPERADMIN` del enum `Rol` (va solo: Postgres no deja usar un valor de enum creado en la
    misma transacción).
18. `20260601030100_superadmin_sesiones_rls`: `usuarios.debeCambiarClave`, CHECK `usuarios_superadmin_sin_negocio`, `sesiones.negocioId`
    nullable con su trigger, políticas de `usuarios` y `sesiones` con la rama del SUPERADMIN, RLS en `negocios` y la función
    `usuarios_por_negocio()`.

El orden de aplicación es el del nombre (timestamp): `20260601010000` y `20260601020000_negocio_produccion` van antes de
`20260601020000_rls`. Prisma aplica el orden lexicográfico del nombre de carpeta.

---

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

-- Facturación (ola 5)
situacion_facturacion = derivarFacturacion(comprobantes de la venta, anulada):
    VENTA_ANULADA | SIN_FACTURA | PENDIENTE | RECHAZADA | EMITIDA | CON_NOTA_CREDITO
```

Margen objetivo por defecto: 40% (configurable). Es el número contra el que se comparan los artículos
para detectar los que se venden por debajo de su valor.
