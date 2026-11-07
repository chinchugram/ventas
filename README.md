# ventas

ERP mínimo para un comercio de corte láser e insumos de marca (stickers, cartelería, rotulación).

El dueño hoy no sabe **qué** vende, **cuánto** cobró en el mes ni **cuánto margen** tiene. Esto
resuelve exactamente eso, sin convertirse en un ERP genérico.

---

## Arranque

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env        # en Windows: copy .env.example .env

# 3. Base de datos (Postgres en Docker) y sus dos roles (una sola vez)
docker compose up -d db
docker compose exec -T db psql -U ventas -d ventas -v ON_ERROR_STOP=1 -f - < scripts/crear-roles-db.sql
docker compose exec -T db psql -U ventas -d ventas -c 'ALTER DATABASE ventas OWNER TO ventas_migrador'

# 4. Esquema + datos de ejemplo (corren con el rol migrador, DATABASE_URL_MIGRACIONES)
npm run db:generate
npm run db:deploy
npm run db:seed

# 5. Levantar
npm run dev
```

Abrir <http://localhost:3000>. Se entra por `/login` con **negocio**, usuario y clave (ver "Usuarios de ejemplo"
más abajo).

El sistema es **multi-tenant**: varios negocios comparten una base y Postgres aísla sus datos (ver "Varios negocios en una base").
Por eso el arranque usa **dos roles de base**: `ventas_app` (la app, `DATABASE_URL`) y `ventas_migrador` (migraciones,
seed y scripts, `DATABASE_URL_MIGRACIONES`). `.env.example` ya trae las dos URL para este Postgres local.

El seed (`npm run db:seed`) carga **dos negocios de ejemplo**, cada uno con su catálogo, sus usuarios y sus movimientos:

| Negocio | Identificador (`slug`) | Qué tiene |
|---|---|---|
| HL Laser | `hl-laser` | 4 clientes, 5 artículos con receta, 5 materiales, 3 máquinas, 2 compras, 7 ventas (pagadas, sin cobrar y pagadas a medias) y un ajuste por conteo |
| Taller Demo | `taller-demo` | 4 clientes, 5 artículos con receta, 6 materiales, 3 máquinas, 2 compras, 6 ventas y un ajuste por conteo (sublimación y cartelería en chapa: nombres y montos distintos, para reconocer a simple vista de qué negocio es cada pantalla) |

Compras y ventas pasan por la misma lógica que las pantallas, así que el stock de cada material coincide con su libro de
movimientos. Ningún dato de un negocio aparece en el otro.

Fuera de producción, el seed también carga datos fiscales de ejemplo (CUIT ficticio y punto de venta 1)
para poder facturar con el simulador. No carga comprobantes.

**Para limpiar los datos de ejemplo y empezar de cero:** `npm run db:reset` (borra **todos** los negocios).

### Modo demo (sin base de datos)

Si Postgres no está levantado, la app **no se rompe**: cada pantalla cae a un juego de datos de
demostración (`src/lib/demo-data.ts`). No son números escritos a mano: costos, márgenes, saldos y
totales salen del mismo motor de costeo que usa la versión con base, así que las pantallas son
coherentes entre sí. Sirve para mostrar el mockup en una reunión sin Docker.

Con base disponible, siempre se usan los datos reales: el respaldo solo entra cuando la base no
responde o la consulta falla (por ejemplo, migraciones pendientes).

### Acceso: usuarios y sesiones

Se entra por `/login` con **negocio**, usuario y clave. El negocio es su identificador corto (`slug`), por ejemplo
`hl-laser`; el mismo nombre de usuario puede existir en dos negocios. Hay tres roles:

- **`DUENO`**: todo, incluidas las notas de crédito y los datos fiscales del negocio.
- **`EMPLEADO`**: carga ventas, registra cobros, marca ventas como entregadas, ve y edita clientes,
  ve el stock (solo cantidades) y la lista de reposición (sin costos), cotiza y convierte presupuestos
  (con precios, sin costos) y registra contactos de cobranza en `/cobranzas/hoy`. No ve costos ni
  márgenes y no puede anular, tocar el catálogo, cargar compras, ver reportes ni gestionar listas de
  precios (ni asignarlas a un cliente: ese selector no le aparece). Factura las ventas desde `/ventas/[id]` y ve los
  comprobantes, pero no emite notas de crédito ni toca los datos fiscales del negocio. Su pantalla de inicio es
  `/ventas/nueva`.
- **`SUPERADMIN`**: no pertenece a ningún negocio y **no ve datos de ninguno**. Solo entra a `/admin/negocios`, donde da de alta
  negocios, crea su primer dueño y los da de baja (ve nombre, estado y cantidad de usuarios, nada más).

#### Usuarios de ejemplo (`npm run db:seed`, solo fuera de producción)

| Negocio (`slug`) | Usuario | Clave | Rol |
|---|---|---|---|
| `hl-laser` | `dueno` | `dueno-de-ejemplo` | `DUENO` |
| `hl-laser` | `empleado` | `empleado-de-ejemplo` | `EMPLEADO` |
| `taller-demo` | `dueno` | `dueno-taller-demo` | `DUENO` |
| `taller-demo` | `empleado` | `empleado-taller-demo` | `EMPLEADO` |

El seed **no** crea ningún SUPERADMIN: se crea con el comando de abajo. Los mismos nombres de usuario en los dos negocios
son a propósito: lo que decide a qué negocio se entra es el campo *Negocio* del login.

**Primer SUPERADMIN:** `npm run usuarios:crear-superadmin` pide usuario, nombre y clave (la clave no se ve al tipearla; mínimo
10 caracteres). También acepta `SUPERADMIN_USUARIO`, `SUPERADMIN_CLAVE` y `SUPERADMIN_NOMBRE`. Solo se crea desde la terminal del
servidor, nunca desde la web, y se niega si ya hay un SUPERADMIN. **Entra en `/login` escribiendo `admin` en *Negocio*** (es un
identificador reservado: ningún negocio puede llamarse así).

**Primer dueño de un negocio:** `npm run usuarios:crear-dueno -- --negocio <slug>` (por ejemplo `-- --negocio hl-laser`; también
`DUENO_NEGOCIO`). El negocio es obligatorio (con varios nunca se adivina), tiene que existir (lo crea el SUPERADMIN en
`/admin/negocios`) y estar activo. Pide usuario, nombre y clave (no se ve al tipearla, se repite para confirmar; mínimo 10
caracteres). También acepta `DUENO_USUARIO`, `DUENO_CLAVE` y `DUENO_NOMBRE`. Se niega si ya hay un dueño **en ese negocio**, aunque esté
dado de baja: los demás usuarios se crean desde `/usuarios`. Desde `/admin/negocios` el SUPERADMIN también puede crear ese primer dueño
(con una clave inicial que el dueño tiene que cambiar al entrar).

- **Sin ningún negocio ni SUPERADMIN** el sitio responde 503 con esa instrucción, en cualquier entorno: nunca
  queda abierto.
- **En producción sin base de datos** responde 503.
- **En producción se exige HTTPS.** La cookie de sesión es `Secure` y se llama
  `__Host-ventas_sesion`: por HTTP el navegador la descarta y el login vuelve siempre a `/login`.
- **En producción conviene limitar `POST /login` en el proxy** con `limit_req` de nginx (o el
  equivalente de Caddy / Cloudflare). La app no limita por IP, y cada intento cuesta un scrypt. La pausa
  por usuario ya acota la fuerza bruta. Ver "Fuera de alcance" en
  [`docs/seguridad-ola-4-auth.md`](docs/seguridad-ola-4-auth.md).
- **Sin base de datos en desarrollo** (modo demo) se entra como "Demo", un dueño simulado. Las
  acciones no escriben nada y devuelven `SIN_BASE`.
- Las sesiones duran 30 días y se renuevan con el uso. Cerrar sesión, dar de baja a un usuario,
  cambiarle el rol o reiniciarle la clave corta sus sesiones abiertas. Un negocio dado de baja no deja entrar a nadie.
- **Desde el multi-tenant, la cookie es `<negocioId>.<token>`: las sesiones abiertas con la cookie anterior (solo el token) dejan de
  valer.** Al desplegar, cada persona vuelve a entrar una vez, escribiendo el negocio. Hay que avisarlo antes (ver
  [`docs/07-multitenant-despliegue.md`](docs/07-multitenant-despliegue.md)).
- Desde el quinto fallo seguido, la cuenta queda en pausa: 30 s, luego 1 min, 2 min… hasta 15 min.
  Durante la pausa no se verifica la clave. El mensaje de error no dice si falló el negocio, el usuario o la clave.
- Los costos y márgenes no se envían al navegador del empleado: no se consultan, no solo se ocultan.

No hay variables de entorno de acceso: las únicas de la base son `DATABASE_URL` y `DATABASE_URL_MIGRACIONES`.
`BASIC_AUTH_USER` y `BASIC_AUTH_PASSWORD` ya no existen; si el servidor las tenía, se pueden retirar.

Decisiones de seguridad (claves, sesiones, cookies, qué queda fuera): ver
[`docs/seguridad-ola-4-auth.md`](docs/seguridad-ola-4-auth.md).

### Varios negocios en una base (multi-tenant)

Cada fila de las 26 tablas de datos lleva el `negocioId` de su dueño y **Postgres fuerza el aislamiento** con Row Level Security:
aunque una consulta olvide el `WHERE`, la base no devuelve ni deja escribir filas de otro negocio. Los datos de un negocio solo se
tocan dentro de `conNegocio(negocioId, fn)` (`src/lib/negocio.ts`). Detalle en
[`docs/03-stack-y-decisiones.md`](docs/03-stack-y-decisiones.md) (decisión, descartes, roles) y
[`docs/02-modelo-datos.md`](docs/02-modelo-datos.md) (`Negocio`, `negocioId`, únicos por negocio).

- **Dos roles de base, dos URL.** `DATABASE_URL` es el rol `ventas_app` (la app; sin `BYPASSRLS`, no es dueño de nada).
  `DATABASE_URL_MIGRACIONES` es `ventas_migrador` (dueño de las tablas, con `BYPASSRLS`): migraciones, seed, respaldos y los scripts de
  alta. **Nunca** va a la app. En producción la app se niega a operar con un rol que se salta RLS.
- **Crear los roles:** `psql "$ADMIN_URL" -f scripts/crear-roles-db.sql` (superusuario; idempotente; claves de desarrollo por defecto o
  `-v app_password="'…'" -v migrador_password="'…'"`). **Hay que re-correrlo después de migrar** y después de restaurar un respaldo completo:
  `ventas_app` necesita `INSERT`/`UPDATE` sobre `negocios` (el SUPERADMIN da de alta negocios) y `EXECUTE` sobre
  `usuarios_por_negocio()` (la cantidad de usuarios en `/admin/negocios`), y esa función exige que su dueño, el migrador, tenga `BYPASSRLS`.
  `psql "$DATABASE_URL_MIGRACIONES" -f scripts/verificar-roles-db.sql` lo comprueba (solo lee).
- La base tiene que ser **del migrador** (`ALTER DATABASE … OWNER TO ventas_migrador`); si no, `prisma migrate deploy` falla con "permission denied for database".
- **Migrar:** `npm run db:deploy` (usa `DATABASE_URL_MIGRACIONES`).
- **Neon:** `DATABASE_URL` con el host *pooled* (`-pooler`) y `DATABASE_URL_MIGRACIONES` con el directo. **El modo pooled está
  diseñado para funcionar (el contexto vive solo dentro de una transacción) pero NO está probado contra Neon.** Es una prueba pendiente de
  `docs/07-multitenant-despliegue.md`.
- **Desplegar sobre la base real de Neon** (HL Laser) tiene su procedimiento ensayado, con copia previa, reconciliación y vuelta atrás, en
  [`docs/07-multitenant-despliegue.md`](docs/07-multitenant-despliegue.md). No se ejecuta sin la aprobación del product owner.
- **Respaldos:** el completo cubre a todos los negocios; para devolver **uno** sin tocar a los demás existe el respaldo por negocio
  (`scripts/exportar-negocio.sh` / `importar-negocio.sh`). Ver [`docs/05-respaldos.md`](docs/05-respaldos.md).

### Probarlo desde el celular

Con la PC y el celular en la misma Wi-Fi:

```bash
npm run dev -- -H 0.0.0.0
```

Abrir `http://IP-DE-LA-PC:3000`. En desarrollo, Next bloquea los recursos de otras IP: hay que
agregar la IP de la PC en `allowedDevOrigins` de `next.config.ts` (sin eso la página se ve, pero
los botones no responden).

---

## Documentación

| Documento | Qué está |
|---|---|
| [`docs/01-alcance-funcional.md`](docs/01-alcance-funcional.md) | Qué hace el MVP, qué NO hace, y las etapas siguientes |
| [`docs/02-modelo-datos.md`](docs/02-modelo-datos.md) | Entidades, decisiones de diseño y los cálculos derivados |
| [`docs/03-stack-y-decisiones.md`](docs/03-stack-y-decisiones.md) | Stack, con el porqué de cada elección |
| [`docs/04-checklist-olas.md`](docs/04-checklist-olas.md) | Plan por olas y su estado (incluye el épico multi-tenant, VTA-4) |
| [`docs/05-respaldos.md`](docs/05-respaldos.md) | Respaldo diario, restauración, prueba de restauración y respaldo por negocio |
| [`docs/seguridad-ola-4-auth.md`](docs/seguridad-ola-4-auth.md) | Login, claves, sesiones y permisos: decisiones de seguridad y qué queda fuera |
| [`docs/fiscal-5.1-decisiones.md`](docs/fiscal-5.1-decisiones.md) | Decisiones fiscales de la facturación (numeración, redondeo, receptor, notas de crédito) y dudas para el contador |
| [`docs/06-facturacion-arca.md`](docs/06-facturacion-arca.md) | Facturación con ARCA: qué falta para pasar del simulador a la integración real (5.2) y qué necesita el dueño |
| [`docs/07-multitenant-despliegue.md`](docs/07-multitenant-despliegue.md) | Despliegue multi-tenant sobre Neon: procedimiento con copia previa, reconciliación, roles y vuelta atrás; ensayo local y pruebas pendientes |
| [`docs/brand/`](docs/brand/README.md) | Marca Kiwitt (copia del manual: colores, tipografía, forma, voz, momentos, logo) y cómo se aplica en ventas: tokens en `src/app/globals.css`, botón sticker, estados, sonido y documentos del negocio |

---

## La idea central: el costo no se tipea, se calcula

Es lo que justifica el proyecto. El costo de un producto sale de su **receta**, que es una
lista de materiales consumidos + horas de máquina + horas de mano de obra:

```
Sticker en vinil 10x15 cm
  0,02 m2  vinil adhesivo        × $4.200   =   $84,00
  0,02 m2  transportador         × $1.400   =   $28,00
  0,10 h   plotter de impresión  × $2.500   =  $250,00
  0,17 h   viniladora            × $1.500   =  $255,00
  0,25 h   mano de obra          × $3.500   =  $875,00
                                    costo   = $1.492,00
                        se vende a          $3.500,00   margen 57,4%
```

Si mañana el vinilo sube de $4.200 a $5.100, **el costo se recalcula solo**. El margen deja de
depender de la memoria del dueño.

Un artículo sin receta tiene costo 0 y el sistema lo marca como **"sin receta"**, en vez de
mostrar un margen del 100% que es una mentira.

---

## Carga de venta

`/ventas/nueva` guarda la venta de verdad cuando hay base de datos con catálogo y clientes.
En pantalla se ven costo, IVA y margen en vivo, pero **al confirmar el servidor recalcula todo
desde la base** (precio, IVA y costo de receta del momento): el navegador solo informa qué se
vendió, cuánto y a quién. En una sola transacción:

- numera la venta correlativa por año,
- congela el costo de cada ítem,
- descuenta el stock de los materiales de cada receta (un movimiento por material; los servicios no descuentan),
- registra el pago inicial, si lo hubo.

**Nunca se frena una venta por falta de stock**: el sistema puede estar desactualizado y el pedido
ya está hecho. Se descuenta lo que hay, el movimiento deja constancia de lo que faltó y la
pantalla avisa.

`/ventas/[id]` muestra el detalle y permite **anular**: la venta queda `ANULADA` (no se borra) y
el stock vuelve exactamente como salió.

Sin base de datos (o sin datos cargados) la pantalla funciona como **simulación en modo demo**:
muestra el comprobante que se generaría, con un aviso, sin escribir nada.

En `/ventas/[id]` también se registran cobros posteriores (varios por venta, nunca más que el
saldo), se anula un pago (queda tachado con su motivo y deja de contar) y se marca la venta como
entregada. `/cobranzas` muestra quién debe, cuánto y desde cuándo.

---

## Presupuestos y listas de precios

- **Listas de precios.** Cada cliente puede tener una lista asignada, desde su ficha. Tiene un
  descuento general sobre el catálogo y, si hace falta, precios específicos por artículo. Si la
  lista se da de baja, sus clientes pagan precio de catálogo hasta que se reactive. Solo el dueño
  gestiona las listas y las asigna a un cliente (permiso `gestionarListasPrecios`).
- **Precios congelados.** Un presupuesto guarda el precio de cada línea al crearlo (o al agregar
  una línea al editarlo). Si después cambian el catálogo o la lista, el presupuesto no se mueve:
  para cotizar con precios de hoy hay que duplicarlo.
- **Validez.** 15 días por defecto (se puede cambiar, hasta 365). Vale hasta `fecha + validez`,
  inclusive. "Vencido" no se guarda: se calcula cuando sigue abierto y pasó el plazo. Un vencido no
  se edita ni se convierte: se duplica.
- **Conversión en venta.** "Convertir en venta" crea la venta con los precios congelados, en una
  sola transacción, así que el total es el del presupuesto. La venta queda pendiente y sin pago, y
  el presupuesto pasa a *convertido* con el enlace a la venta. No se convierte dos veces: si
  llegan dos conversiones a la vez, la segunda falla con un mensaje y no crea otra venta.

---

## Facturación

Desde la ola 5 hay facturas (A, B y C) y notas de crédito, con el emisor **simulado**. Hoy no hay conexión con ARCA.

> **Sin ARCA, nada tiene validez fiscal.** Todo comprobante sale con ambiente `SIMULADO` y la marca **SIN VALIDEZ FISCAL**
> en pantalla y en la impresión. No es una factura válida: no sirve para presentar ante ARCA ni para entregarla como tal.
> La integración real es la tarea 5.2, diferida: ver [`docs/06-facturacion-arca.md`](docs/06-facturacion-arca.md).

**Qué hay:**

- **Facturar desde la venta.** En `/ventas/[id]`, el panel "Facturación" muestra si la venta ya tiene factura y, si no,
  el botón para emitirla. La letra sale de la condición frente al IVA del emisor y del cliente:
  - Emisor responsable inscripto: **A** a un cliente responsable inscripto con CUIT; **B** a cualquier otro cliente.
  - Emisor monotributista: **C**, que no discrimina IVA. Si la venta tenía IVA, el sistema avisa antes de emitir.
  - Un cliente responsable inscripto, monotributista o exento necesita CUIT para facturar.
  - El documento que se informa: CUIT si el cliente lo tiene; si no, DNI; si no, la factura sale sin identificar, y solo
    se admite si el total no supera el umbral de identificación del consumidor final.
- **Numeración.** Cada comprobante toma el siguiente número de su serie (ambiente, punto de venta y tipo). Un intento
  rechazado por el emisor queda como `RECHAZADO` con su motivo y **no ocupa el número**: el reintento usa el mismo.
  Si el emisor no responde, queda `PENDIENTE`: mientras haya un pendiente en la serie no se emite otro, y el panel
  ofrece "Resolver", que consulta al emisor cuando el pendiente tiene más de 2 minutos.
- **`/comprobantes`**: facturas y notas de crédito, más nuevas primero, con filtros por tipo, estado, ambiente y fechas.
  Los filtros van en la URL, así que el link de una búsqueda se puede mandar tal cual. Lo ven los dos roles y no muestra
  costos.
- **`/comprobantes/[id]`**: estado y CAE, emisor, receptor, líneas, IVA por alícuota, venta de origen y quién lo emitió.
  Un rechazo muestra el motivo del emisor.
- **Vista imprimible** (`/comprobantes/[id]/imprimir`): el comprobante en A4, con el QR fiscal y la marca SIN VALIDEZ
  FISCAL repetida en cada hoja. Para el PDF: "Imprimir" y elegir **"Guardar como PDF"** como destino.
- **Notas de crédito**: anulan el **total** de una factura emitida, desde `/ventas/[id]`. Solo el dueño las emite
  (permiso `emitirNotaCredito`) y solo él ve el botón. Una factura tiene como máximo una nota de crédito vigente, y una
  venta con factura vigente no se puede anular hasta que su nota de crédito quede emitida.
- **Datos fiscales del negocio** (`/configuracion`, solo el dueño): razón social, CUIT, condición frente al IVA
  (responsable inscripto o monotributo), domicilio, inicio de actividades, ingresos brutos (opcional), punto de venta y,
  opcional, el umbral de identificación del consumidor final. Sin los obligatorios no se factura, y la venta dice qué falta.
- **Clientes** (`/clientes`): cada cliente tiene su **condición frente al IVA** (por defecto, consumidor final) y un
  **DNI** opcional de 7 u 8 dígitos, sin puntos. Con eso se decide la letra y el documento que figuran en la factura.

**Variables de entorno** (en `.env`; si no se definen, rige el simulado):

| Variable | Valor | Qué hace |
|---|---|---|
| `EMISOR_FISCAL` | `simulado` (por defecto) | Emisor simulado, sin validez fiscal |
| `EMISOR_FISCAL` | `arca` | Reservado. Hoy responde "no implementado" y no se puede facturar |
| `PERMITIR_EMISOR_SIMULADO` | `1` | Con `NODE_ENV=production`, el simulado exige exactamente `1`. Sin esa variable, facturar queda deshabilitado y la pantalla dice por qué |

> **En producción, sin ARCA, todo comprobante sale con SIN VALIDEZ FISCAL.** `PERMITIR_EMISOR_SIMULADO=1` existe para una
> demo: no habilita comprobantes con validez. Sin base de datos no se factura.

Las decisiones fiscales (numeración, redondeo, receptor, umbral) y las dudas para el contador están en
[`docs/fiscal-5.1-decisiones.md`](docs/fiscal-5.1-decisiones.md).

---

## Pantallas

| Ruta | Qué resuelve |
|---|---|
| `/` | Cómo va el mes: facturado, cobrado, costo, ganancia, márgenes, alertas |
| `/ventas` | Historial de ventas con margen y estado de pago |
| `/ventas/nueva` | Carga de venta: calcula en vivo y guarda (descuenta stock) |
| `/ventas/[id]` | Detalle de una venta, pagos, anulación, facturación y nota de crédito (solo `DUENO`) |
| `/comprobantes` | Facturas y notas de crédito, con filtros por tipo, estado, ambiente y fechas (en la URL) |
| `/comprobantes/[id]` | Detalle de un comprobante: estado y CAE, foto del emisor y del receptor, líneas, IVA y venta de origen |
| `/comprobantes/[id]/imprimir` | Vista para imprimir o "Guardar como PDF", con QR fiscal y la marca SIN VALIDEZ FISCAL |
| `/clientes` | Quién es cada cliente y cuánto debe; alta, edición y baja con CUIT validado. Cada cliente puede tener una lista de precios (la asigna solo el dueño), su condición frente al IVA y su DNI |
| `/clientes/[id]` | Ficha: ventas, pagos y saldo del cliente |
| `/catalogo` | Costo por receta, precio, margen y precio necesario para la meta |
| `/catalogo/nuevo`, `/catalogo/[id]` | Alta y edición de artículo con editor de receta y costo/margen en vivo |
| `/materiales` | Stock, valorización y avisos de reposición |
| `/materiales/[id]` | Libro de movimientos del material y ajuste por conteo físico |
| `/reposicion` | Materiales en o bajo el mínimo: cuánto comprar (mínimo × factor), costo estimado y botón que arma la compra |
| `/cobranzas` | Quién debe, cuánto y desde cuándo; pagos recientes |
| `/cobranzas/hoy` | A quién llamar hoy, ordenado por antigüedad y monto; registrar contacto y enlace de WhatsApp |
| `/listas-precios` | Listas de precios: descuento general y precios por artículo; alta, edición y baja (solo `DUENO`) |
| `/listas-precios/nueva`, `/listas-precios/[id]` | Alta y edición de una lista, con advertencia de precios por debajo del costo (solo `DUENO`) |
| `/presupuestos` | Presupuestos, con filtro por estado (abiertos, vencidos, convertidos, anulados) |
| `/presupuestos/nuevo`, `/presupuestos/[id]`, `/presupuestos/[id]/editar`, `/presupuestos/[id]/imprimir` | Alta, detalle (convertir en venta, duplicar, anular), edición mientras esté abierto y vigente, y vista para imprimir o mandar por WhatsApp |
| `/materiales/nuevo`, `/materiales/[id]/editar` | Alta y edición; al cambiar el costo muestra qué artículos cambian de margen |
| `/cortes` | Calculadora de cortes: precio de una medida a partir del precio de la plancha entera (solo `DUENO`, usa costos) |
| `/configuracion` | Nombre del negocio, costo/hora de mano de obra, IVA por defecto, margen objetivo y máquinas, y los datos fiscales del negocio para facturar (solo `DUENO`) |
| `/configuracion/maquinas/nueva`, `/configuracion/maquinas/[id]` | Alta y edición de una máquina con su costo por hora (solo `DUENO`) |
| `/compras` | Historial de compras; `/compras/nueva` registra una (suma stock y actualiza el costo) |
| `/reportes` | Resumen, ganancia por producto, más rentables, deuda por cliente y consumo de materiales; filtro por mes o rango de fechas en la URL y botón "Exportar CSV" por reporte |
| `/reportes/stock` | Valorización del stock, materiales sin movimiento, consumo real vs teórico y rotación; mismo filtro de fechas |
| `/produccion` | Líneas de venta sin cargar y trabajos cargados; carga de lo realmente usado (minutos de máquina, mano de obra y materiales), mobile-first. Dueño y empleado, sin costos |
| `/produccion/cargar/[ventaItemId]`, `/produccion/trabajo/[id]` | Carga precargada con la receta; detalle de un trabajo (real contra receta), anular para corregir y, solo el dueño, ajustar el stock por la diferencia |
| `/produccion/estimar` | Estimación de minutos de máquina y de mano de obra de un pedido con la mediana de los últimos trabajos del mismo artículo. Sin datos suficientes lo dice, no inventa |
| `/reportes/margen-real` | Costo real contra costo de receta por artículo, por período y los trabajos con más desvío; CSV en `/reportes/margen-real/export` (solo `DUENO`) |
| `/login` | Entrar con usuario y clave. Es la única pantalla que se ve sin sesión |
| `/usuarios` | Lista de usuarios, con alta, rol, baja y reinicio de clave (solo `DUENO`) |
| `/usuarios/nuevo` | Alta de un usuario: el dueño elige su clave inicial y se la pasa (solo `DUENO`) |
| `/usuarios/[id]` | Ficha de un usuario: cambiar rol, dar de baja o reactivar, reiniciar la clave (solo `DUENO`) |
| `/usuarios/mi-clave` | Cambiar la clave propia; la pide cualquier rol |

Desde la ola 4, el detalle de una venta (y cada cobro) y el libro de movimientos de un material
muestran "Registrado por" con quién lo cargó, y el listado de compras también. Desde la ola 5, el detalle de un comprobante muestra "Emitido por". Desde la ola 7 (integrada
con la 4), el detalle de un presupuesto y cada contacto de `/cobranzas/hoy` muestran "Registrado por", y
la ficha de una lista de precios muestra "Creada por". Lo anterior a los usuarios muestra "—".

Todas mobile-first: en celular las tablas se convierten en tarjetas apiladas. El dueño atiende
el mostrador con el teléfono en la mano.

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y arranque de producción |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run db:up` / `db:down` | Levantar / bajar Postgres |
| `npm run db:migrate` | Crear y aplicar una migración (desarrollo) |
| `npm run db:deploy` | Aplicar migraciones (producción). Usa `DATABASE_URL_MIGRACIONES` (rol `ventas_migrador`) si está definida |
| `npm run db:seed` | Cargar los **dos negocios de ejemplo** (`hl-laser` y `taller-demo`) con sus usuarios (solo fuera de producción); corre con el migrador y **borra los datos de todos los negocios** antes de sembrar |
| `npm run db:reset` | **Borra todo** (todos los negocios) y vuelve a migrar + sembrar |
| `npm run db:studio` | Prisma Studio, para mirar la base |
| `npm run usuarios:crear-superadmin` | Crea el primer SUPERADMIN (pide usuario, nombre y clave); entra en `/login` con el negocio `admin`. Se niega si ya hay uno. Ver "Acceso" |
| `npm run usuarios:crear-dueno -- --negocio <slug>` | Crea el primer dueño de **ese negocio** (pide usuario, nombre y clave); se niega si el negocio ya tiene un dueño. Ver "Acceso" |
| `npm run db:backup` | `pg_dump` a `backups/`, con rotación de 30 archivos (el servicio `backup` del compose lo hace solo, una vez por día) |
| `npm run db:restore -- ARCHIVO` | Restaura un respaldo (pide confirmar si pisa una base existente). Ver `docs/05-respaldos.md` |
| `npm run test:respaldo` / `test:respaldo:restaurar` | Lógica del estado del último respaldo (`src/lib/respaldo-estado.ts`) / prueba de restauración de punta a punta en una base descartable |
| `npm run test:respaldo:negocio` | Respaldo y restauración de **un** negocio: exportar A e importarlo reproduce sus datos, no cambia nada de B, las negativas y que el respaldo completo restaura a los dos negocios. Necesita `RESPALDO_ADMIN_URL` (ver `docs/05-respaldos.md`) |
| `npm run test:rls` | Aislamiento por RLS contra Postgres local con los dos roles: por cada tabla con `negocioId`, ver/modificar/insertar entre negocios, sin contexto, el SUPERADMIN, y que el contexto no se filtra entre transacciones ni conexiones. Necesita `DATABASE_URL` (`ventas_app`) y `DATABASE_URL_MIGRACIONES` |
| `npm run test:negocios` | Administración de negocios del SUPERADMIN (alta, primer dueño, baja y reactivación, permisos) y los scripts `crear-superadmin` / `crear-dueno --negocio` |
| `npm run test:unicos-negocio` / `test:negocio` / `test:facturacion-negocios` / `test:concurrencia-negocios` / `test:login-negocios` / `test:marca` | Piezas del multi-tenant: únicos y triggers por negocio / migración `negocio` con datos / facturación por negocio / candados y numeración concurrentes / login por negocio y SUPERADMIN / marca (nombre y logo) por negocio |
| `npm run test:cierre` | **Suite de cierre del épico multi-tenant:** `typecheck`, `build`, `test:costeo`, `test:stock`, `test:permisos`, `test:rls`, `test:negocios`, `test:respaldo:negocio`, `test:acceso` y `npm audit`. Variables: `DATABASE_URL`, `DATABASE_URL_MIGRACIONES`, `ACCESO_URL_ADMIN` y `RESPALDO_ADMIN_URL` (superusuario local, solo para crear bases de prueba). Si la computadora está en UTC, entre las 21:00 y las 24:00 de Argentina `test:acceso` falla por la fecha de hoy: correr con `TZ=America/Argentina/Buenos_Aires` |
| `npm run ensayo:despliegue` | Ensayo local completo del despliegue multi-tenant (copia, migración, reconciliación, roles, humo y vuelta atrás) contra Postgres local. Necesita `ENSAYO_HOST` y `ENSAYO_PORT`. Ver `docs/07-multitenant-despliegue.md` |
| `npm run test:cobranzas` / `test:cobranzas:db` / `test:reposicion` | Cobros y lista de reposición |
| `npm run test:costeo` | Verifica el motor de costeo contra 15 números conocidos |
| `npm run test:stock` | Verifica las cuentas de compras y stock contra números conocidos |
| `npm run test:integridad` | Verifica que los CHECK constraints rechazan datos inválidos. `scripts/test-integridad.sql` ahora espera 12 errores (uno por restricción) y 1 INSERT aceptado |
| `npm run test:acciones` | Compra, venta, anulación y ajuste contra Postgres real (en transacciones que se deshacen) |
| `npm run test:cuit` / `test:recetas` / `test:materiales` / `test:configuracion` | Lógica pura de cada pantalla de altas |
| `npm run test:rango-fechas` / `test:reportes-rango` | Rango de fechas (zona Argentina, bordes de mes y bisiestos) / totales de los reportes contra SQL con filtros del seed |
| `npm run test:csv` | Armado del CSV (separador `;`, decimales con coma, BOM, escape y neutralización de fórmulas) |
| `npm run test:stock-reporte` / `test:consumo` | Valorización, rotación y sin movimiento / consumo real vs teórico, con números armados a mano |
| `npm run test:clientes` / `test:articulos` / `test:materiales:db` / `test:configuracion:db` | Las mismas altas contra Postgres real, sin dejar rastro |
| `npm run test:precios` | Verifica `resolverPrecio` sin base: precio específico, descuento general, lista inactiva y catálogo |
| `npm run test:precios:db` | Lo mismo contra Postgres real: venta de un cliente con lista, override de precio y ABM de listas (en transacciones que se deshacen) |
| `npm run test:presupuestos` | Lógica pura de presupuestos: vencimiento y sus bordes de fecha, totales, precios al editar, cantidades y mensaje de WhatsApp |
| `npm run test:presupuestos:db` | Presupuestos contra Postgres real: alta, numeración, edición, conversión en venta (incluida la concurrencia) y los CHECK. Borra lo que crea |
| `npm run test:recordatorios` | Lógica pura de recordatorios: a quién llamar hoy, orden por tramo y monto, teléfonos argentinos y enlace de WhatsApp |
| `npm run test:recordatorios:db` | Registro de contactos y la consulta "a quién llamar hoy" contra Postgres real. Borra sus datos de prueba al terminar |
| `npm run test:auth` / `test:auth:db` | Login sin base (claves, pausa por fallos, sesiones, cookies, y que cada página y acción verifica sesión) / el mismo núcleo contra Postgres real, con el alta del dueño |
| `npm run test:permisos` | Matriz rol × acción y qué permiso exige cada acción y página, más acciones reales invocadas con un empleado contra Postgres |
| `npm run test:usuarios` | Administración de usuarios (alta, baja, rol, reinicio de clave, clave propia) contra Postgres de desarrollo o de prueba; se niega con `NODE_ENV=production` |
| `npm run test:produccion` / `test:produccion:db` | Registro de producción: sugerencia desde la receta, validación, costo real, ajuste de stock idempotente / el mismo flujo contra Postgres real (un vigente por línea, costos congelados, CHECK). Sin rastro |
| `npm run test:margen-real` / `test:margen-real:db` | Margen real con cuentas a mano (desvíos, nulos, CSV) / contra Postgres real con trabajos sembrados (rango de fechas, anulados) |
| `npm run test:estimacion-tiempos` / `test:estimacion-tiempos:db` | Mediana, mínimo de muestras y totales de la estimación / contra Postgres real con trabajos sembrados |
| `npm run test:acceso` | Autorización por HTTP contra la app de producción (`next build && next start` en el puerto 3103) y una base descartable `ventas_acceso` con los dos negocios del seed y la app corriendo con `ventas_app`: rutas sin sesión, empleado, sesión expirada o de baja, que el HTML y el RSC del empleado no traigan costos ni márgenes, y el **aislamiento entre negocios** (dueño y empleado de cada uno intentan ver y tocar lo del otro con ids reales); al final corre `test:rls`. Reconstruye `.next`. Ver el encabezado de `scripts/test-acceso.ts` |
| `npm run test:datos-fiscales` | Validación y normalización de los datos fiscales del negocio: cada campo con sus bordes y lo que falta para emitir. Sin base |
| `npm run test:comprobantes` | Lógica pura de facturación: letras y códigos ARCA, documento del receptor y umbral, importes por alícuota con sus redondeos, factura C, guarda de producción y emisor simulado con acceso en memoria. Sin base |
| `npm run test:comprobantes:db` | Emisión contra Postgres real: A, B y C con sus estados, la foto, numeración por serie, un rechazo que reusa el número, un corte que deja `PENDIENTE`, los CHECK, índices y triggers de la migración, y dos emisiones simultáneas. No deja rastro |
| `npm run test:qr` | Armado del QR fiscal (JSON, URL e importe) contra un ejemplo escrito a mano según la especificación, no el oficial de ARCA. Sin base |
| `npm run test:facturar` | Lógica pura de "Facturar desde la venta" y del listado: filtros de la URL, estado de facturación derivado, avisos antes de emitir y la marca SIN VALIDEZ FISCAL. Sin base |
| `npm run test:facturar:db` | Las server actions de facturación con sesiones reales de dueño, empleado y sin sesión; doble pedido simultáneo; producción sin `PERMITIR_EMISOR_SIMULADO`. Borra lo que crea |
| `npm run test:notas-credito` | Notas de crédito contra Postgres real: una venta facturada no se anula sin NC, letra y asociación, la NC copia la foto de la factura, una sola NC por factura, y el permiso (solo dueño). Borra lo que crea |

---

## Reglas del proyecto

Estas son las que sostienen el código. Si alguna se rompe, el sistema empieza a mentir.

1. **El dinero es `Decimal`, siempre.** Prohibido `+`, `*` o template literals con números de
   dinero. Todo pasa por `src/lib/money.ts`. Un redondeo mal aplicado en un subtotal se
   propaga al margen, y el margen es el producto.
2. **Ningún saldo se persiste.** El saldo de un cliente y el estado de pago de una venta se
   *calculan* desde ventas y pagos. No pueden quedar desincronizados porque no existen como dato.
3. **El costo se congela en la venta.** `VentaItem` guarda el costo del momento. Si no, un
   cambio de precio del vinilo reescribiría los márgenes del mes pasado.
4. **La base es la última línea de defensa.** Prisma valida en la app, pero los `CHECK`
   constraints de `prisma/migrations/` validan siempre. Verificables con
   `scripts/test-integridad.sql`.
5. **Baja lógica en todo catálogo.** `activo = false`. Nunca se borra algo con historial.
6. **Server Components finos.** Consultas en `src/lib/queries/`; escrituras como Server Actions
   con Zod en `src/app/**/actions.ts`, que validan y delegan en `src/lib/dominio/` (funciones que
   reciben un `tx`, probadas sin Next por `npm run test:acciones`). Las piezas comunes de las
   acciones (`Resultado`, `SIN_BASE`, decimales con coma, fecha de hoy en Argentina) están en
   `src/lib/acciones.ts`, y las de los formularios en `src/components/form/`. Los componentes
   renderizan, no saben SQL.
7. **Código en inglés, dominio en español.** `costoTotalSnapshot`, `stockMinimo`, `saldoCliente`.
   Lo que hay que entender sin traducciones es el dominio.
8. **El precio de una línea de venta lo decide el servidor.** Sale de `resolverPrecio`
   (`src/lib/precios.ts`), en este orden: precio específico del cliente para ese artículo →
   precio de catálogo menos el descuento general de su lista → precio de catálogo. Una lista
   inactiva se ignora por completo. El navegador manda solo artículo y cantidad: al confirmar,
   el servidor recalcula el precio. La única excepción es convertir un presupuesto, que usa los
   precios congelados en él.
9. **El comprobante es una foto.** Emisor, receptor, líneas e importes se copian al emitir y no cambian después.
   Lo que un comprobante emitido tiene mal se corrige con una nota de crédito, nunca editándolo. Lo garantizan los
   triggers de la base, no solo la app.

---

## Estado actual

**Andamiaje completo y verificado:**

- Esquema Prisma migrado, con sus `CHECK`, índices parciales y triggers (también los de facturación), y configuración sembrada.
- `prisma/seed.ts` con datos de ejemplo de un comercio de láser.
- `src/lib/costing.ts`: motor de costeo y margen, puro y sin dependencias de infraestructura.
- `src/lib/money.ts`: aritmética decimal y formateo es-AR.
- Consultas del dashboard, catálogo, clientes, materiales, ventas y reportes.
- Las 6 pantallas renderizan con datos reales.
- `/ventas/nueva`: carga de venta que guarda, congela costos y descuenta stock; `/ventas/[id]` permite anularla.
- `npm run test:costeo` (15 comprobaciones) pasa, y `npm run test:integridad` espera 12 errores y 1 INSERT aceptado.
- `npm run build` y `npm run typecheck` limpios.

**Lo que falta para que sea usable (siguiente paso):**

- [x] Guardado real de la venta: numeración correlativa por año, ítems, costo congelado y descuento de stock
- [x] Formularios de alta/edición de clientes, artículos, materiales y recetas (ola 1 de `docs/04-checklist-olas.md`)
- [x] Registro de pagos sobre ventas existentes, anulación de pagos y cambio de estado (ola 2)
- [x] Página de configuración (costo/hora de mano de obra, IVA, margen objetivo) y máquinas (ola 1)
- [x] Backup automático diario (ola 2): servicio `backup` del compose y restauración probada. El aviso en pantalla de "respaldo viejo" ya no se muestra (su pantalla se retiró; la lógica de `src/lib/respaldo-estado.ts` sigue verificada). Ver `docs/05-respaldos.md`
- [x] Lista de reposición sugerida (ola 2): cierra la etapa 2
- [x] Reportes con filtro de fechas y exportación a CSV, reporte de stock y auditoría de accesibilidad (ola 3). Hallazgos pendientes en `docs/auditoria-ola-3.md`
- [x] Listas de precios por cliente (ola 7.1)
- [x] Presupuestos que se convierten en venta (ola 7.2)
- [x] Recordatorios de cobranza: a quién llamar hoy (ola 7.3)
- [x] Login con usuarios y roles, permisos por rol, trazabilidad (quién cargó cada venta, cobro, compra y movimiento) y administración de usuarios (ola 4)
- [x] Integración 4+7 (rama `integracion-4-7`): permisos de las pantallas de la ola 7, trazabilidad de presupuestos, contactos de cobranza y listas de precios, y `npm run test:acceso`
- [x] Productividad (ola 6, etapa 5): registro de producción por línea de venta, margen real contra receta (solo dueño), estimación de tiempos por arte y pendientes de accesibilidad
- [x] Facturación con emisor simulado (ola 5, etapa 4): facturar desde la venta, listado y detalle de comprobantes, vista imprimible con QR, notas de crédito totales y datos fiscales. La integración con ARCA (5.2) está diferida
- [x] Multi-tenant (épico VTA-4): varios negocios en una base con aislamiento por RLS, login por negocio, SUPERADMIN y `/admin/negocios`, marca por negocio, respaldo por negocio y test de aislamiento por HTTP. **Código y documentación cerrados; el despliegue sobre la base real de Neon está preparado y ensayado en local pero NO ejecutado** (decide y ejecuta el product owner: `docs/07-multitenant-despliegue.md`)

El plan completo, por olas y pensado para repartir a subagentes en paralelo, está en
`docs/04-checklist-olas.md`.

**Las olas 4 y 7 están integradas**, con las pantallas de la ola 7 clasificadas en la matriz de
permisos: `gestionarListasPrecios`, solo dueño; `verPresupuestos`, `cargarPresupuesto`,
`convertirPresupuesto`, `verRecordatorios` y `registrarContactoCobranza`, dueño y empleado. Las
tablas de la ola 7 tienen `usuarioId` (nullable, histórico en "—"). La advertencia de precios por debajo
del costo en `/listas-precios/[id]` usa costos de receta: como la pantalla es solo del dueño, solo la ve él.
`npm run test:acceso` verifica por HTTP que el empleado no reciba costos ni márgenes en las rutas que clasifica.

**La ola 5 (facturación) está integrada** en `ola-5`, salvo la 5.2 (integración con ARCA), que está **diferida**: hasta
entonces, todo comprobante es simulado y sin validez fiscal. El estado de cada tarea está en `docs/04-checklist-olas.md`.

**La ola 6 (productividad) está integrada** en `ola-6`. Pasa de margen estimado (costo de receta) a **margen real**:
- **Producción por línea de venta** (`/produccion`): minutos de máquina, minutos de mano de obra y materiales realmente usados.
  Un trabajo vigente por línea; corregir = anular y recargar. Los costos unitarios quedan congelados al cargar.
- **El consumo real no mueve el stock.** El stock sigue bajando por receta al vender; el dueño puede ajustar la diferencia
  (movimiento `AJUSTE` explícito y confirmado, nunca doble descuento).
- **Permisos:** `cargarProduccion` (dueño y empleado, sin costos) y `verMargenReal` (solo dueño).
- **Margen real** en `/reportes/margen-real` y **estimación de tiempos** en `/produccion/estimar`.
- La migración `20260401000000_produccion` hay que aplicarla a mano en Neon antes de redeployar (ver "Despliegue" en `docs/04-checklist-olas.md`).

**El multi-tenant (épico VTA-4) está integrado** en `multitenant` (migraciones `20260601000000` a `20260601030100`). Cambia el esquema de
todas las tablas, activa RLS y exige los dos roles de base, así que **no se despliega sobre Neon sin seguir
[`docs/07-multitenant-despliegue.md`](docs/07-multitenant-despliegue.md)**: respaldo, copia, migración con el rol migrador, reconciliación
idéntica (filas, totales, saldos y stock antes y después), `crear-roles-db.sql` re-corrido, humo y vuelta atrás. Las sesiones abiertas con la
cookie vieja dejan de valer (todos vuelven a entrar escribiendo el negocio, `hl-laser`). **Sigue pendiente la prueba contra Neon en modo
pooled** (host `-pooler`): se probó solo en Postgres local. Comandos de cierre: `npm run test:rls`, `npm run test:acceso` y, juntos con el resto, `npm run test:cierre`.

---

## Notas

**`npm audit` no reporta vulnerabilidades.** Desde la tarea 4.0a (`next` 16.4.3, `zod` 4.6.7,
`prisma` 7.10.1) el resultado es 0. Las que había antes se corrigieron con esas actualizaciones dentro
de los rangos de `package.json`; no hizo falta bajar a Prisma 6. Detalle en `docs/auditoria-ola-3.md`, parte 3.

**Acceso con usuarios y roles** (desde la ola 4). Ya no hay contraseña compartida ni HTTP Basic: cada
persona entra con su usuario. Ver "Acceso: usuarios y sesiones" más arriba.
