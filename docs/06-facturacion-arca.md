# Facturación electrónica: qué hay, cómo está armada y cómo se conecta con ARCA

Este documento tiene dos públicos:

- **El dueño**: qué hace hoy el sistema con las facturas, qué NO hace y qué tiene que gestionar el día que quiera facturar de verdad.
- **Quien implemente la tarea 5.2** (integración con ARCA, diferida): el contrato exacto del emisor, cómo se mapea a los servicios web de ARCA, cómo reintentar sin duplicar números y cómo pasar de simulado a homologación a producción.

Las decisiones de modelo y las 15 dudas originales para el contador están en `docs/fiscal-5.1-decisiones.md`; acá se consolidan (sección 6).

> **Aviso sobre las fuentes (leer antes de la sección 4).** Este documento se escribió en una sesión sin salida a los dominios de ARCA/AFIP (`www.afip.gob.ar`, `www.arca.gob.ar`, `servicios1.afip.gov.ar`, `wsaahomo.afip.gov.ar` no resuelven desde ahí; hay que habilitarlos en la red de la sesión para contrastar). Todo lo que dice sobre ARCA sale de lo que se sabe de los manuales y de una búsqueda web con fuentes secundarias. **Cada dato de ARCA que no se pudo contrastar con el manual oficial está marcado con "⚠ verificar contra la fuente".** Antes de escribir código de 5.2, quien lo haga tiene que bajar los manuales de la sección 5 y confirmar esos puntos.

---

## 1. Qué se hizo en la ola 5

**Resumen**: el sistema ya factura de punta a punta (factura A/B/C y nota de crédito total) contra un **emisor simulado**. Todo lo que emite lleva `ambiente = SIMULADO` y se muestra con la marca **"SIN VALIDEZ FISCAL"**. No hay ninguna conexión con ARCA: los CAE son inventados por el simulador y no valen nada ante ARCA ni ante un cliente.

### 1.1 Qué incluye

| Pieza | Qué hace | Dónde está |
|---|---|---|
| **Modelo** | `comprobantes` (cabecera con foto del emisor y del receptor, importes, CAE), `comprobante_items` (copia de las líneas de la venta, sin costos), `comprobante_iva` (una fila por alícuota, igual que el arreglo `Iva` de ARCA). Migración `20260301000000_comprobantes`. | `prisma/migrations/20260301000000_comprobantes/migration.sql` |
| **Reglas puras** | Qué tipo toca (A/B/C), códigos ARCA, validación del receptor, importes por alícuota conciliados contra la venta con tolerancia cero (nunca se ajusta un centavo en silencio). | `src/lib/comprobantes.ts` |
| **Emisor abstracto** | Interfaz `EmisorFiscal` (sección 2) que hoy implementa el simulador y mañana implementará ARCA. | `src/lib/fiscal/emisor.ts` |
| **Emisor simulado** | Autoriza "como ARCA" (numeración correlativa, A con CUIT, sumas, C sin IVA, NC con asociado), genera un CAE determinista de 14 dígitos y vence a los 10 días. Lo "autorizado" es lo EMITIDO en `SIMULADO` en la base. | `src/lib/fiscal/emisor-simulado.ts` |
| **Selección del emisor y salvaguardas** | `EMISOR_FISCAL`, `PERMITIR_EMISOR_SIMULADO`, `NODE_ENV` (sección 1.4). | `src/lib/fiscal/index.ts` |
| **Emisión en dos fases** | (1) reservar el número y guardar PENDIENTE en una transacción corta que se confirma, (2) pedir el CAE **fuera** de toda transacción, (3) registrar el resultado en otra transacción corta. Si el emisor no responde, queda PENDIENTE y se resuelve consultándolo. | `src/lib/dominio/comprobantes.ts` |
| **Notas de crédito totales** | Copia exacta de la factura (emisor y receptor de la factura, no de hoy), misma letra y punto de venta, serie de numeración propia, asociada a la factura. Mismas dos fases. | `src/lib/dominio/notas-credito.ts` |
| **Datos fiscales del negocio** | Razón social, CUIT, condición IVA, domicilio, inicio de actividades, IIBB (opcional), punto de venta, umbral de identificación (opcional). Se guardan como claves de `Configuracion`. Sin ellos no se factura (mensaje claro de qué falta). | `src/lib/datos-fiscales.ts`, `/configuracion` |
| **Condición IVA y DNI del cliente** | `clientes.condicionIva` (por defecto Consumidor Final) y `clientes.dni` (7 u 8 dígitos). Definen el tipo de factura y cómo se identifica al receptor. | ficha de cliente |
| **Comprobante imprimible con QR** | Vista A4 (imprimir o "Guardar como PDF") con CAE, vencimiento y QR fiscal (SVG generado en el servidor). Todo sale de la foto del comprobante, nunca del cliente o la venta de hoy. | `src/app/comprobantes/[id]/imprimir`, `src/lib/qr-fiscal.ts` |
| **Listado y detalle** | Filtros por tipo, estado, ambiente y fechas (en la URL, se pueden compartir). Botón "Resolver" para un PENDIENTE. | `/comprobantes`, `/comprobantes/[id]` |
| **Reglas con la venta** | Una venta se factura una sola vez (factura vigente única); no se factura una venta anulada; una venta con factura vigente no se anula hasta que exista una nota de crédito EMITIDA. | triggers + `src/lib/dominio/ventas.ts` |

### 1.2 Pantallas

| Pantalla | Para qué | Permiso |
|---|---|---|
| `/configuracion` (sección datos fiscales) | Cargar los datos del emisor y el punto de venta. | `configuracion` (solo dueño) |
| `/clientes` (alta y edición) | Condición frente al IVA y DNI del cliente. | `editarClientes` |
| `/ventas/[id]` (panel de facturación) | Botón "Facturar" y botón "Emitir nota de crédito". | facturar: `emitirComprobante`; nota de crédito: `emitirNotaCredito` (solo dueño) |
| `/comprobantes` | Listado con filtros; resolver un PENDIENTE. | `verComprobantes`; resolver: `emitirComprobante` (una NC pendiente exige además `emitirNotaCredito`) |
| `/comprobantes/[id]` | Detalle: estado, importes, observaciones del emisor, marca de ambiente. | `verComprobantes` |
| `/comprobantes/[id]/imprimir` | Vista A4 para imprimir o guardar como PDF, con QR. | `verComprobantes` |

Permisos (`src/lib/permisos-pura.ts`): `verComprobantes` y `emitirComprobante` para dueño y empleado; `emitirNotaCredito` y `configuracion` solo para el dueño. Los comprobantes no contienen costos ni márgenes.

### 1.3 Estados y numeración (resumen; el detalle está en `fiscal-5.1-decisiones.md` §2)

- `PENDIENTE` (número reservado, sin CAE) → `EMITIDO` (CAE + vencimiento) o `RECHAZADO` (con observaciones).
- La numeración es por (ambiente, punto de venta, tipo). Número = **último autorizado según el emisor + 1**.
- Con un PENDIENTE en la serie no se emite otro número (un índice único parcial lo garantiza en la base).
- El último autorizado del emisor tiene que coincidir con el último EMITIDO de la base; si no, se frena con un mensaje claro.
- **Un RECHAZADO no consume el número**: queda como registro del intento y el reintento reutiliza ese número (por eso la unicidad es un índice parcial sobre los vigentes).
- Un EMITIDO o RECHAZADO es **inmutable** (trigger); solo los comprobantes `SIMULADO` se pueden borrar.

### 1.4 Variables de entorno y salvaguardas

| Variable | Valores | Efecto |
|---|---|---|
| `EMISOR_FISCAL` | `simulado` (por defecto) \| `arca` | `simulado` usa el simulador. `arca` hoy responde "no implementado" (`MENSAJE_ARCA_NO_IMPLEMENTADO`) y no se puede facturar. Cualquier otro valor es un error. |
| `NODE_ENV` | `production` en el servidor | Con `production` y emisor simulado, facturar queda **deshabilitado** salvo que esté `PERMITIR_EMISOR_SIMULADO=1`. |
| `PERMITIR_EMISOR_SIMULADO` | exactamente `1` | Permite usar el simulador en producción (por ejemplo, una demo). Cualquier otro valor no habilita. |

Las tres se leen en un solo lugar (`entornoDelProceso()` en `src/lib/fiscal/index.ts`); la decisión es una función pura, `seleccionarEmisor(entorno)`.

Salvaguardas contra la emisión falsa:

1. **Marca "SIN VALIDEZ FISCAL"**: todo comprobante con `ambiente !== "PRODUCCION"` la muestra en el detalle, el listado y la vista imprimible/PDF (`sinValidezFiscal()` en `src/lib/facturacion.ts`). Un comprobante rechazado o pendiente además lo dice con una leyenda propia ("no tiene CAE, no es válido").
2. **Producción sin permiso explícito no factura** con el simulador.
3. **Triggers**: un comprobante de HOMOLOGACION o PRODUCCION no se puede borrar nunca; el seed falla si los encuentra (a propósito).
4. **El seed** carga datos fiscales de ejemplo (CUIT ficticio válido) solo fuera de producción.
5. **Nunca** se guardan certificados ni claves de ARCA en la base ni en el repo (contrato de la ola; ver sección 4.7).

### 1.5 Qué NO hay (a propósito)

- **Conexión con ARCA** (tarea 5.2): ni WSAA, ni WSFE, ni certificados. Todo es simulado.
- **Notas de crédito parciales**: solo total, por el mismo importe de la factura. No hay nota de débito.
- **Otras monedas**: solo pesos (`MonId` "PES", cotización 1). Sin percepciones ni otros tributos (`ImpTrib` = 0).
- **Concepto servicios**: siempre se informa "productos" (1). Si el corte láser se factura como servicio, ARCA pide fechas de servicio y vencimiento de pago: no está contemplado.
- **Factura de Crédito Electrónica MiPyME** y otros tipos (M, E, tiques, recibos).
- **Documentos distintos de CUIT, DNI o "sin identificar"** (no hay pasaporte ni CDI para extranjeros).
- **Importes exentos / no gravados** (`ImpOpEx`, `ImpTotConc`): un artículo con IVA 0 se informa como alícuota 0 % (código 3).
- **Fecha distinta de hoy**: el comprobante sale con la fecha de hoy en Argentina, no la de la venta.
- **CAEA** (CAE anticipado) ni modo contingencia.
- **Tipo de comprobante elegido a mano**: lo decide el sistema (monotributo → C; RI→RI con CUIT → A; el resto → B).
- **Envío del comprobante por mail/WhatsApp**: se imprime o se guarda como PDF desde el navegador.

### 1.6 Pruebas existentes

`npm run test:datos-fiscales`, `test:comprobantes`, `test:comprobantes:db` (más de 80 casos de la base), `test:qr`, `test:facturar`, `test:facturar:db`, `test:notas-credito`, `test:acceso` (clasifica las rutas y acciones nuevas).

---

## 2. Contrato de `EmisorFiscal`

Archivo: `src/lib/fiscal/emisor.ts`. Sin dependencias de Prisma ni de Next.

### 2.1 Firmas reales

```ts
export type AmbienteFiscal = "SIMULADO" | "HOMOLOGACION" | "PRODUCCION";
export type ConceptoArca = 1 | 2 | 3; // 1 productos, 2 servicios, 3 ambos

export type SolicitudCae = {
  cuitEmisor: string;
  puntoVenta: number;
  tipo: TipoComprobante;       // FACTURA_A..C, NOTA_CREDITO_A..C
  codigoArca: number;          // 1, 6, 11, 3, 8, 13
  numero: number;
  fecha: Date;                 // medianoche UTC (columna DATE)
  concepto: ConceptoArca;      // hoy siempre 1
  receptor: {
    docTipo: DocTipo;          // 80 CUIT, 96 DNI, 99 sin identificar
    docNro: string;            // "0" si es 99
    condicionIvaCodigo: number;// CondicionIVAReceptorId (1, 4, 5, 6)
  };
  importes: {                  // pesos
    total: Dinero; neto: Dinero; iva: Dinero;
    alicuotas: { codigo: number; base: Dinero; importe: Dinero }[]; // vacío en la C
  };
  comprobanteAsociado?: {      // solo en notas de crédito
    tipo: TipoComprobante; codigoArca: number; puntoVenta: number; numero: number;
  };
};

export type ResultadoCae =
  | { aprobado: true; cae: string; vencimiento: Date; observaciones: string[] }
  | { aprobado: false; observaciones: string[] };

export type ComprobanteConsultado =
  | { encontrado: false }
  | { encontrado: true; cae: string; vencimiento: Date; fecha: Date; total: Dinero };

export interface EmisorFiscal {
  readonly ambiente: AmbienteFiscal;
  ultimoAutorizado(puntoVenta: number, tipo: TipoComprobante): Promise<number>; // 0 si no hay
  solicitarCae(solicitud: SolicitudCae): Promise<ResultadoCae>;
  consultar(puntoVenta: number, tipo: TipoComprobante, numero: number): Promise<ComprobanteConsultado>;
}
```

Semántica de resultado (esto es lo más importante del contrato):

| Situación | Cómo se expresa | Qué hace el dominio |
|---|---|---|
| ARCA autorizó | `{ aprobado: true, cae, vencimiento, observaciones }` | PENDIENTE → EMITIDO. Las observaciones (si ARCA las mandó) se guardan. |
| ARCA rechazó | `{ aprobado: false, observaciones }` (**no** una excepción) | PENDIENTE → RECHAZADO con los motivos. El número queda libre para el reintento. |
| **No se sabe** (corte, timeout, error 5xx, SOAP Fault, respuesta ilegible) | `solicitarCae` **lanza** | El comprobante queda PENDIENTE con su número reservado. Hay que `consultar` antes de reintentar. |
| `consultar`: ARCA no lo tiene | `{ encontrado: false }` | `resolverPendiente` lo pasa a **RECHAZADO** y libera el número. |
| `consultar`: ARCA lo tiene | `{ encontrado: true, cae, vencimiento, fecha, total }` | Si el total coincide: EMITIDO con ese CAE. Si no coincide: error "revisar a mano". |

### 2.2 Qué garantiza el dominio (el emisor no tiene que preocuparse)

Todo esto vive en `src/lib/dominio/comprobantes.ts` y `notas-credito.ts`, y en la base:

- La **venta se bloquea** (`FOR UPDATE`) y se valida: no anulada, sin factura vigente, datos fiscales completos, receptor válido, importes conciliados al centavo.
- La **serie se serializa** con un advisory lock por (ambiente, punto de venta, tipo): un solo escritor por serie a la vez.
- **Un solo PENDIENTE por serie** (índice único parcial): mientras no se sepa si el anterior se autorizó, no se pide otro número.
- El número lo calcula el dominio como `emisor.ultimoAutorizado(...) + 1`, y **frena** si ese valor no coincide con el último EMITIDO de la base.
- La llamada a `solicitarCae` ocurre **fuera de toda transacción**; el resultado se registra en otra transacción corta (`registrarResultadoEnTx`, que además detecta la inconsistencia "el emisor aprobó pero la base lo tiene RECHAZADO" y la deja en el log con el CAE).
- La **foto** del emisor y del receptor se guarda antes de pedir el CAE: lo que se informa a ARCA y lo que queda en la base es lo mismo.
- `emitirFacturaEnTx` / `emitirNotaCreditoEnTx` (una sola transacción) **se niegan** con un emisor que no sea SIMULADO. Con un emisor real solo valen `emitirFactura` / `emitirNotaCredito` (dos fases).
- Con una NC: la base exige factura EMITIDA de la misma venta, ambiente y letra, y una sola NC vigente por factura.

### 2.3 Qué tiene que garantizar un emisor nuevo (ARCA)

1. **`ambiente` verdadero.** `HOMOLOGACION` si habla con el servicio de pruebas, `PRODUCCION` solo si habla con el de producción. Todo lo que autoriza lleva ese ambiente. Si el ambiente se puede confundir (por ejemplo, certificado de producción contra la URL de homologación), el emisor debe **negarse a construirse**.
2. **Numeración = último autorizado + 1.** `ultimoAutorizado` tiene que devolver el verdadero último número autorizado por ARCA para ese (punto de venta, tipo), siempre consultándolo a ARCA (nunca de un caché ni de la base local). `0` si no hay ninguno. Si ARCA no contesta, **lanzar**: devolver 0 por las dudas haría que el dominio reserve el número 1 de nuevo.
3. **Un RECHAZADO no consume número.** Un rechazo de ARCA (`Resultado = R`) debe volver como `aprobado: false`; el reintento usa el mismo número. Cuidado con el caso inverso: un `A` (aprobado) **con observaciones** es aprobado y consume número.
4. **Idempotencia / consulta ante corte.**
   - `solicitarCae` **nunca debe reenviarse sola** ante un timeout o un corte: ante la duda, lanzar. El que decide es el dominio (PENDIENTE) y el que resuelve es `consultar`.
   - `consultar` devuelve `encontrado: false` **solo si ARCA respondió de forma explícita que no existe ese comprobante**. Ante cualquier incertidumbre (timeout, error de autenticación, mantenimiento, respuesta rara) tiene que **lanzar**. Motivo: `resolverPendiente` interpreta `encontrado: false` como RECHAZADO y libera el número; un falso "no encontrado" puede dejar un número autorizado por ARCA sin registro en la base. (La base lo detecta en la siguiente emisión por el control "último del emisor = último de la base", pero el daño ya está.)
   - `consultar` debe devolver el **total** autorizado; el dominio lo compara contra el de la base.
5. **Tiempo acotado.** Todo `solicitarCae` (incluido pedir un TA nuevo) tiene que terminar bastante antes de `ANTIGUEDAD_MINIMA_PENDIENTE_MS` (2 minutos, `src/lib/dominio/comprobantes.ts`). Si no, otra persona puede apretar "Resolver" mientras el pedido original sigue en vuelo, consultar antes de que ARCA termine, ver "no encontrado" y marcar RECHAZADO un comprobante que después ARCA autoriza. Ver 4.4.
6. **Los rechazos llevan texto útil.** `observaciones` es una lista de textos; el simulador usa el formato `"[codigo] mensaje"` con el código de ARCA entre corchetes. Mantenerlo (con los códigos y mensajes de `Obs` y `Errors` de ARCA).
7. **Sin estado propio persistido.** El simulador no guarda nada; el emisor de ARCA puede cachear el TA en memoria pero nada que ponga en duda "lo autorizado" (eso siempre se pregunta a ARCA).
8. **Sin efectos fuera del contrato.** No toca la base, no lee `process.env` suelto (la configuración le llega por parámetro desde `entornoDelProceso()`), no loguea certificados, claves, token ni sign.

### 2.4 Cosas que el contrato actual no cubre y 5.2 tendrá que decidir

- `SolicitudCae.comprobanteAsociado` no trae la **fecha** del comprobante asociado ni su CUIT. Si ARCA las exige en `CbtesAsoc` (⚠ verificar contra la fuente: en versiones recientes `CbteFch` y `Cuit` serían opcionales), hay que agregar `fecha` al tipo (cambio compatible hacia atrás: el dominio de NC ya tiene la factura y puede pasarla). Para el CUIT alcanza con `cuitEmisor`.
- `index.ts` hoy solo sabe construir el simulador: `obtenerEmisorFiscal(entorno, acceso)` devuelve `{ ok: true, emisor: crearEmisorSimulado(...) }` y `SeleccionEmisor` tiene `emisor: "simulado"`. Hay que ampliarlo para `arca`. Se llama desde tres lugares: `src/app/comprobantes/actions.ts` (emitir y resolver) y `src/app/ventas/[id]/actions.ts` (nota de crédito); `src/lib/queries/comprobantes.ts` usa `seleccionarEmisor` para saber si hay emisor.
- `EntornoFiscal` no tiene variable para elegir homologación o producción. Propuesta en 4.8.

---

## 3. Qué tiene que conseguir el dueño para facturar de verdad

Es todo trámite del dueño con clave fiscal; ninguno depende del sistema. Los nombres exactos de los servicios cambian con el rediseño del sitio de ARCA: ⚠ verificar contra la fuente (portal de servicios con clave fiscal).

1. **CUIT y clave fiscal** con nivel de seguridad suficiente (nivel 3 o más ⚠ verificar). La clave fiscal es de la persona o sociedad que factura; si lo hace un contador o un tercero, hay que delegar los servicios en ARCA (Administrador de Relaciones de Clave Fiscal).
2. **Condición frente al IVA y actividad correctas**: responsable inscripto o monotributista, con el domicilio fiscal y la actividad declarados. El sistema no factura como exento ni como no responsable.
3. **Alta de un punto de venta para web services.** En el servicio "Administración de puntos de venta y domicilios" (⚠ verificar nombre) se da de alta un punto de venta con el sistema **"RECE para aplicaciones y web services"** (⚠ verificar nombre exacto). Es distinto de los puntos de venta de "Comprobantes en línea" o del controlador fiscal: **un punto de venta del sistema equivocado no sirve para el web service**. El número que se da de alta es el que se carga en `/configuracion`. Conviene que sea un punto de venta **nuevo y vacío** (ver 4.9, punto de arranque de la numeración).
4. **Certificado digital.**
   - Generar en el servidor (o en una máquina de confianza) una **clave privada** y un **pedido de certificado (CSR)** con `openssl` (la clave privada **no sale** de ahí). El CSR lleva el CUIT en el campo `serialNumber` del subject (`serialNumber=CUIT 20XXXXXXXXX`) ⚠ verificar el formato exacto en la guía de ARCA.
   - Subir el CSR en **producción** al servicio "Administración de Certificados Digitales" y en **homologación** al servicio "WSASS - Autogestión Certificados Homologación" (⚠ verificar nombres), y descargar el certificado (`.crt`/`.pem`).
   - **Asociar el certificado al servicio WSFE** ("Facturación Electrónica", `wsfe`) en el "Administrador de Relaciones de Clave Fiscal" (se crea una relación entre el alias del certificado y el servicio, para el CUIT que factura) ⚠ verificar.
   - Anotar la **fecha de vencimiento** del certificado (suele durar un par de años ⚠ verificar) y poner un recordatorio con meses de anticipación (ver 4.7).
5. **Ambiente de homologación (testing).** ARCA tiene un ambiente de pruebas separado, con **sus propios certificados** (los de producción no sirven ahí y al revés), sus propias URLs (4.6) y sus propios puntos de venta. Hay que repetir el trámite del certificado en homologación (WSASS) y asociarlo a `wsfe` allá. Los comprobantes de homologación no tienen validez fiscal.
6. **Datos en `/configuracion`**: razón social, CUIT, condición IVA, domicilio, inicio de actividades, IIBB (si corresponde) y el punto de venta recién dado de alta.
7. **Hablar con el contador** (sección 6): varias decisiones dependen de normativa vigente y de cómo factura el negocio.

---

## 4. Guía de la tarea diferida 5.2: integración con ARCA

> **Estado: NO implementada.** Esta sección es un plan para quien la haga. Los nombres de operaciones, campos y URLs de ARCA salen de memoria del manual y de fuentes secundarias; la sección 5 lista dónde confirmarlos.

### 4.1 Mapa general

```
Server action (emitirFactura / emitirNotaCredito / resolverPendiente)      ← ya existen
        │
        ▼
dominio en dos fases (reservar → solicitarCae → registrar)                 ← ya existe
        │
        ▼
EmisorArca implements EmisorFiscal   ← NUEVO: src/lib/fiscal/emisor-arca.ts
   ├── WSAA  (autenticación): TRA firmado → TA {token, sign}               ← NUEVO
   └── WSFEv1 (facturación): FECompUltimoAutorizado / FECAESolicitar /
                             FECompConsultar / FEParamGet*               ← NUEVO
```

Archivos esperables (sugerencia, no obligación): `src/lib/fiscal/emisor-arca.ts` (el `EmisorFiscal`), `src/lib/fiscal/arca/wsaa.ts` (TRA, firma CMS, caché del TA), `src/lib/fiscal/arca/wsfe.ts` (cliente SOAP y mapeos), `src/lib/fiscal/arca/errores.ts` (clasificación de errores). Mantener la lógica de mapeo (nuestro modelo ↔ campos de WSFE) como **funciones puras** con pruebas, igual que `comprobantes.ts`, y la parte de red detrás de una función inyectable `enviarSoap(url, accion, xml)` para poder probar sin red.

Decisiones tecnológicas que 5.2 debe tomar y documentar (no se resolvieron acá):

- **Cliente SOAP**: armar el XML a mano y mandarlo con `fetch` (pocas operaciones, control total de timeouts y de qué se loguea) o usar una librería (`soap`, SDK de terceros). Recomendación: XML a mano para las 5 operaciones que se usan; menos dependencias que auditar para algo que maneja credenciales.
- **Firma CMS del TRA**: con `openssl cms -sign` por `child_process`, o con `node-forge`/`pkijs` en proceso. Cualquiera sirve; lo importante es que la clave privada no se escriba a disco en claro fuera de lo previsto ni aparezca en logs.
- **TLS**: ⚠ verificar contra la fuente: en el pasado los servidores de ARCA usaron parámetros Diffie-Hellman chicos que OpenSSL 3 / Node reciben como "dh key too small" y obligaron a bajar el nivel de seguridad solo para esos hosts. Si pasa, resolverlo con un `Agent` acotado a esos hostnames, **nunca** desactivando la verificación del certificado ni de forma global.

### 4.2 WSAA: autenticación (ticket de acceso, TA)

WSAA es el servicio que entrega el **ticket de acceso (TA)** para usar un servicio de negocio (acá `wsfe`). Un TA tiene un `token` y un `sign` y una vigencia; WSFE exige ambos más el CUIT en cada llamada.

Pasos:

1. **Armar el TRA** (Ticket de Requerimiento de Acceso), un XML `loginTicketRequest` con: `uniqueId` (entero), `generationTime`, `expirationTime` y `service` = `wsfe`. Las fechas van en ISO 8601 con zona horaria de Argentina; el `generationTime` suele ponerse unos minutos atrás y el `expirationTime` unos minutos adelante para tolerar diferencias de reloj ⚠ verificar los márgenes admitidos.
2. **Firmarlo** en formato **CMS (PKCS#7)** con la clave privada y el certificado del dueño, y codificar el resultado en base64.
3. **Enviarlo** a la operación `loginCms` del WSAA (SOAP) con ese base64 como `in0`.
4. **Leer la respuesta**: un XML `loginTicketResponse` con `credentials/token`, `credentials/sign` y `header/expirationTime`.

Reglas operativas:

- **Vigencia**: el TA dura unas 12 horas ⚠ verificar. Se **cachea en memoria** y se renueva **antes** de que venza (por ejemplo, con 10 minutos de margen) y también si una llamada a WSFE responde error de token vencido o inválido (una sola vez, no en bucle).
- **No pedir un TA por cada factura.** ARCA no permite pedir un TA nuevo para el mismo servicio y certificado mientras el anterior sigue vigente (responde algo del estilo "ya posee un TA válido", `alreadyAuthenticated`) ⚠ verificar el texto y el código. Por eso el caché es obligatorio, no una optimización.
- **Un solo pedido de TA a la vez** (single-flight): si dos facturas llegan juntas con el TA vencido, la segunda espera la promesa de la primera en vez de pedir otro.
- **El TA no se guarda en la base ni en archivos del repo** (es una credencial). Queda en memoria del proceso. Consecuencia a tener en cuenta: tras reiniciar el servidor con un TA todavía vigente, el pedido de uno nuevo podría fallar con el error de arriba hasta que venza el anterior. Si en las pruebas de homologación pasa seguido, la mitigación aceptable es guardarlo en un archivo **fuera del repo, con permisos 0600**, con la misma vigencia (es mucho menos sensible que la clave privada); es una decisión que debe tomar y anotar quien implemente.
- **Reloj del servidor** sincronizado (NTP): un reloj corrido hace que ARCA rechace el TRA por fecha.
- **Errores de WSAA** (certificado no asociado al servicio, certificado vencido o inválido, CUIT que no coincide, TRA mal firmado): son errores de **configuración**, no transitorios. No se reintentan en bucle; se muestran con un mensaje claro ("el certificado no está autorizado para facturación electrónica") y se loguean sin datos sensibles.

### 4.3 WSFEv1: cómo se mapea cada método de `EmisorFiscal`

Todas las llamadas llevan `Auth { Token, Sign, Cuit }` (el CUIT del emisor, `cuitEmisor`).

| `EmisorFiscal` | Operación WSFEv1 | Entrada | Salida que importa | Notas |
|---|---|---|---|---|
| `ultimoAutorizado(puntoVenta, tipo)` | `FECompUltimoAutorizado` | `PtoVta`, `CbteTipo` = `CODIGO_ARCA[tipo]` | `CbteNro` (0 si no hay) | Devolver `CbteNro`. Es de **solo lectura**: se puede reintentar. Cualquier error o timeout → lanzar. |
| `solicitarCae(solicitud)` | `FECAESolicitar` | `FeCAEReq` armado según 4.4 | `Resultado` (`A`/`R`/`P`), `CAE`, `CAEFchVto`, `Observaciones`, `Errors`, `Events` | Un solo comprobante por pedido (`CantReg` = 1). **No se reintenta sola**. Ver 4.5. |
| `consultar(puntoVenta, tipo, numero)` | `FECompConsultar` | `FeCompConsReq { CbteTipo, CbteNro, PtoVta }` | `ResultGet { CodAutorizacion, FchVto, CbteFch, ImpTotal, ... }` | De solo lectura. "No existe" tiene un código de error específico (⚠ verificar: el que dice que no hay datos en los registros; se recuerda como 602): solo ese caso es `encontrado: false`. |
| (a futuro, validación y arranque) | `FEParamGetTiposCbte`, `FEParamGetTiposDoc`, `FEParamGetTiposIva`, `FEParamGetTiposMonedas`, `FEParamGetPtosVenta` | `Auth` | listas de códigos | Para un chequeo de arranque/diagnóstico: que los códigos que usamos (1, 3, 6, 8, 11, 13; 80, 96, 99; 3, 4, 5, 6, 8, 9; "PES") existan y que el punto de venta figure y esté habilitado para WS. |
| (a futuro, receptor) | `FEParamGetCondicionIvaReceptor` (parámetro agregado con la RG 5616) | `Auth` (y la clase de comprobante ⚠ verificar) | lista de `Id`/`Desc` válidos por clase | Para validar `condicionIvaCodigo` contra lo que ARCA acepta para A/B/C. ⚠ verificar si el nombre y los parámetros son esos. |
| (diagnóstico) | `FEDummy` | — | estado de AppServer / DbServer / AuthServer | Sin autenticación. Útil para el chequeo "¿está andando ARCA?" y para distinguir mantenimiento de un error propio. |

### 4.4 `FECAESolicitar`: mapeo de campos

Un pedido con **un** comprobante:

`FeCAEReq { FeCabReq { CantReg = 1, PtoVta, CbteTipo }, FeDetReq { FECAEDetRequest { ... } } }`

| Campo de WSFE | Sale de | Detalle |
|---|---|---|
| `FeCabReq.CantReg` | constante `1` | Un comprobante por pedido (evita el resultado parcial `P`). |
| `FeCabReq.PtoVta` | `solicitud.puntoVenta` | Entero 1–99999. Tiene que ser un punto de venta de tipo web service. |
| `FeCabReq.CbteTipo` | `solicitud.codigoArca` | 1 Factura A, 6 Factura B, 11 Factura C, 3 NC A, 8 NC B, 13 NC C. |
| `Concepto` | `solicitud.concepto` | Hoy 1 (productos). Con 2 o 3 pide además `FchServDesde`, `FchServHasta`, `FchVtoPago`. |
| `DocTipo` | `solicitud.receptor.docTipo` | 80 CUIT, 96 DNI, 99 sin identificar. |
| `DocNro` | `solicitud.receptor.docNro` | Numérico (entero largo): convertir el texto; con `DocTipo` 99 va `0`. |
| `CbteDesde`, `CbteHasta` | `solicitud.numero` | Los dos iguales (un solo comprobante). Debe ser el próximo: último autorizado + 1. |
| `CbteFch` | `solicitud.fecha` | Texto `yyyyMMdd` tomado de la fecha UTC del `Date` (`toISOString().slice(0,10)` sin guiones), **sin pasar por la zona horaria local**. Con concepto productos, ARCA acepta fechas dentro de una ventana de unos días alrededor de hoy ⚠ verificar (5 días para productos). El sistema usa hoy en Argentina (`hoyArgentina`). |
| `ImpTotal` | `importes.total` | Con 2 decimales, punto decimal, sin separador de miles. Debe cumplir `ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA`. |
| `ImpTotConc` | `0` | No gravado: hoy no se usa (dudas del contador 4). |
| `ImpNeto` | `importes.neto` | Neto gravado. **En la C**: el total (sin discriminar IVA). |
| `ImpOpEx` | `0` | Exento: hoy no se usa. |
| `ImpTrib` | `0` | Sin otros tributos ni percepciones. |
| `ImpIVA` | `importes.iva` | 0 en la C. |
| `MonId` | `"PES"` | Pesos. |
| `MonCotiz` | `1` | Cotización de pesos. |
| `Iva { AlicIva[] }` | `importes.alicuotas` | Una `AlicIva` por alícuota: `Id` = `codigo` (3: 0 %, 9: 2,5 %, 8: 5 %, 4: 10,5 %, 5: 21 %, 6: 27 %), `BaseImp` = `base`, `Importe` = `importe`. **No se manda** en la C. ARCA valida que la suma de `BaseImp` sea `ImpNeto` y la de `Importe` sea `ImpIVA`, y que cada importe sea coherente con base × alícuota dentro de una tolerancia (⚠ verificar cuál; ver duda 2 del contador). |
| `CbtesAsoc { CbteAsoc[] }` | `solicitud.comprobanteAsociado` | **Solo en notas de crédito**: `Tipo` = `comprobanteAsociado.codigoArca`, `PtoVta`, `Nro`; y `Cuit` (el del emisor) y `CbteFch` si hacen falta (ver 2.4). La factura A/B/C no lleva `CbtesAsoc`. |
| `CondicionIVAReceptorId` | `solicitud.receptor.condicionIvaCodigo` | **Obligatorio desde la RG 5616/2024** (vigente desde abril de 2025 según fuentes secundarias; ⚠ verificar contra la fuente). Nuestros códigos: 1 RI, 4 exento, 5 consumidor final, 6 monotributo (`CODIGO_CONDICION_IVA_RECEPTOR`). La tabla de ARCA tiene más valores (por ejemplo, sujeto no categorizado, proveedor/cliente del exterior, monotributista social) y restringe cuáles valen para cada clase de comprobante (⚠ verificar; la A exige receptor RI/monotributo). Si falta o no es válido, ARCA rechaza (código 10242 según fuentes secundarias, ⚠ verificar). |
| `Tributos`, `Opcionales`, `Compradores`, `PeriodoAsoc`, `FchServ*`, `FchVtoPago` | no se envían | Fuera de alcance de la ola 5. |

**Respuesta a mapear a `ResultadoCae`:**

| En la respuesta de ARCA | Se traduce a |
|---|---|
| `FeDetResp.Resultado = "A"` + `CAE` + `CAEFchVto` (`yyyyMMdd`) | `{ aprobado: true, cae, vencimiento: <Date medianoche UTC>, observaciones: <Obs> }`. Las `Observaciones` de un aprobado se guardan (el comprobante igual vale). |
| `Resultado = "R"` | `{ aprobado: false, observaciones: <Obs con "[Code] Msg"> }`. |
| `Resultado = "P"` (parcial) | No debería ocurrir con `CantReg = 1`. Tratarlo como "no se sabe": **lanzar**. |
| Nodo `Errors` a nivel de la respuesta, sin detalle del comprobante (error de autenticación, de formato, de punto de venta no habilitado, "no es el próximo a autorizar") | ARCA dice que **no procesó** el pedido. Se puede traducir a `aprobado: false` con el texto del error (queda RECHAZADO y libera el número), siempre que el error sea inequívoco. Los errores de autenticación/TA son de configuración y conviene mostrarlos como error, no como rechazo del comprobante (decisión a documentar). |
| SOAP Fault, HTTP 5xx, timeout, corte de conexión, XML ilegible, cualquier duda | **Lanzar** (queda PENDIENTE y se consulta). |

El `Date` del vencimiento debe quedar como **medianoche UTC del día informado**, igual que el resto de las fechas (`caeVencimiento` es una columna `DATE`). No convertir a hora local.

**Códigos de error de ARCA.** El simulador usa códigos entre corchetes (`[10016]` número no es el próximo, `[10013]` factura A sin CUIT, `[10048]`, `[10018]`, `[10071]`, `[10197]`) para que los mensajes se parezcan a los reales. **No se contrastaron con el catálogo oficial**: tratarlos como ilustrativos y reemplazarlos por los verdaderos al implementar ⚠ verificar contra la fuente.

### 4.5 Reintentos, timeouts y errores

**Principio rector**: `FECAESolicitar` no tiene clave de idempotencia. La defensa contra el duplicado es el número correlativo: reenviar el mismo número después de un éxito perdido daría "no es el próximo a autorizar", pero **no se debe depender de eso**; se debe **consultar antes de reintentar**.

| Operación | ¿Se reintenta? | Cómo |
|---|---|---|
| Pedir TA (WSAA) | Sí, poco | Hasta 2 intentos con espera corta, dentro del tiempo total. Un error de configuración (certificado) no se reintenta. |
| `FECompUltimoAutorizado`, `FECompConsultar`, `FEParamGet*`, `FEDummy` | Sí | Son lecturas: 2 o 3 intentos con espera creciente. Si siguen fallando, lanzar. |
| `FECAESolicitar` | **No** (nunca automático) | Un intento. Ante cualquier incertidumbre: lanzar → PENDIENTE → **consultar** (`resolverPendiente` o el botón "Resolver" del listado). Solo después de que la consulta diga `encontrado: false` el número queda libre y se puede pedir otra vez. |

Reglas que no se negocian:

1. **Siempre consultar antes de reintentar un PENDIENTE.** La interfaz ya lo fuerza: un PENDIENTE bloquea la serie y la vía de salida es `resolverPendiente`.
2. **Nunca pedir un número nuevo mientras haya un PENDIENTE en la serie.** Ya lo garantizan el dominio y el índice único parcial; el emisor de ARCA no debe tener un "reintento interno con otro número".
3. **Timeouts**: conexión corta (unos 10 s) y respuesta total acotada (por ejemplo 30–45 s por llamada), de modo que `solicitarCae` completo (con una renovación de TA si hace falta) termine **muy por debajo de 2 minutos** (`ANTIGUEDAD_MINIMA_PENDIENTE_MS`). Si hiciera falta más, hay que subir esa constante en el dominio, no dejar que el pedido siga vivo más allá.
4. **Doble verificación en `resolverPendiente`**: el dominio compara el total de ARCA con el de la base; si difieren, frena con "revisar a mano". No saltearlo.
5. **Si la base queda con el RECHAZADO y ARCA autorizó** (carrera rara), la siguiente emisión se frena sola por el control "último autorizado ≠ último EMITIDO" y `registrarResultadoEnTx` deja el CAE en el log. Es una situación para resolver a mano con el contador; el sistema no la corrige solo.

**Clasificación de errores** (a documentar en el código y en un mensaje para el usuario):

| Tipo | Ejemplos | Qué hace el sistema |
|---|---|---|
| Rechazo del comprobante | `Resultado = R`, observaciones de validación | RECHAZADO con los motivos; el usuario corrige y reintenta (mismo número). |
| Configuración | certificado vencido o no asociado a `wsfe`, CUIT que no coincide, punto de venta no habilitado para WS, falta de permisos de clave fiscal | Mensaje claro al dueño; nada se reintenta en bucle. |
| Transitorio | timeout, 5xx, mantenimiento, corte | Lecturas se reintentan; `solicitarCae` deja PENDIENTE. |
| Inconsistencia | último autorizado ≠ último EMITIDO, total distinto al consultar | Se frena y se avisa: revisar a mano. |

**Ventanas de mantenimiento.** ARCA anuncia ventanas de mantenimiento de sus servicios (típicamente de madrugada o fines de semana ⚠ verificar). Durante una, las llamadas fallan o devuelven errores de servicio: se ve como "transitorio" y el comprobante queda PENDIENTE. Con ARCA caído conviene que la pantalla lo diga ("ARCA no responde: probá más tarde") en vez de dejar al usuario con un PENDIENTE sin explicación. Un `FEDummy` puede ayudar a distinguirlo.

**Logs**: registrar, sin secretos, la operación, `puntoVenta`, `tipo`, `numero`, duración, `Resultado`, y los códigos de error de ARCA. **Nunca** token, sign, clave privada, ni el XML completo con credenciales.

### 4.6 URLs de referencia

Fuentes secundarias (⚠ verificar contra la fuente oficial antes de usarlas en código; ARCA ha migrado dominios, de `afip.gob.ar` a `arca.gob.ar`, y los servicios de negocio siguen publicándose bajo `afip.gov.ar`):

| Servicio | Homologación | Producción |
|---|---|---|
| WSAA (login) | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` (WSDL: `?WSDL`) | `https://wsaa.afip.gov.ar/ws/services/LoginCms` ⚠ verificar |
| WSFEv1 | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` (WSDL: `?WSDL`) | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` |

Las URLs tienen que ser **configuración del emisor, atadas al ambiente**, no valores sueltos en el código: un emisor `HOMOLOGACION` solo puede usar las de homologación. Descargar el WSDL oficial de cada ambiente y contrastar espacios de nombres y acciones SOAP antes de armar el XML.

### 4.7 Dónde guardar el certificado y la clave privada

Contrato de la ola: **nunca en la base ni en el repo**.

- **Archivos fuera del repo**, en el servidor, en un directorio que no sea parte del checkout (por ejemplo `/etc/ventas/arca/`), con dueño el usuario que corre la app y permisos `0600` para la clave (`0644` o más cerrado para el certificado). Las rutas llegan por variables de entorno (propuestas en 4.8).
- Alternativa si la app corre en Docker (el despliegue previsto es Docker Compose en un VPS, `docs/03-stack-y-decisiones.md`): montar el directorio como volumen de **solo lectura**, o usar secretos de Docker. No copiar la clave dentro de la imagen.
- Variables de entorno con el PEM en base64 solo si el servidor no tiene disco apropiado; recordar que las variables aparecen en `docker inspect` y en volcados de entorno.
- **`.gitignore`**: hoy ya ignora `.env`, `.env*.local` y `*.pem`. Al implementar 5.2 agregar también `*.key`, `*.crt`, `*.csr`, `*.p12`, `*.pfx` y la carpeta que se use para pruebas locales (por ejemplo `/certs/`). (Este documento no modifica `.gitignore`.)
- **Respaldos** (`docs/05-respaldos.md`): los respaldos de la base **no** contienen la clave, y por eso hay que respaldar la clave privada y el certificado **aparte**, cifrados, en un lugar distinto al servidor. Perder la clave privada obliga a generar un certificado nuevo (CSR nuevo y reasociación a `wsfe`).
- **Rotación y vencimiento**: el certificado vence ⚠ verificar el plazo. Sin certificado vigente no se puede facturar. Poner un recordatorio con 60–90 días de anticipación; el emisor puede leer la fecha de vencimiento del certificado al arrancar y avisar en pantalla (o en el log) cuando falten menos de 60 días. Para rotar: generar clave y CSR nuevos, obtener el certificado, asociarlo a `wsfe`, desplegar los archivos nuevos, probar en homologación si se puede, y recién después retirar el viejo.
- **El TA** (token/sign) vive solo en memoria del proceso (4.2); no se persiste en la base ni se loguea.
- **Logs y errores**: ninguna excepción que se propague a la interfaz puede contener rutas con secretos, la clave, el token o el sign.
- **Permisos de la app**: la clave la lee solo el emisor de ARCA; nadie más en el código toca esas variables.

### 4.8 Cómo se pasa de SIMULADO a HOMOLOGACIÓN y a PRODUCCIÓN

Variables **propuestas** (no existen hoy; las existentes están en 1.4):

| Variable | Valores | Para qué |
|---|---|---|
| `EMISOR_FISCAL` | `simulado` \| `arca` | Ya existe. `arca` pasa a construir el `EmisorArca`. |
| `ARCA_AMBIENTE` | `homologacion` \| `produccion` | **Sin valor por defecto y obligatorio** con `EMISOR_FISCAL=arca`: nunca asumir producción por omisión. Define `ambiente` del emisor y las URLs. |
| `ARCA_CERT_PATH`, `ARCA_KEY_PATH` | rutas | Certificado y clave privada (4.7). |
| `ARCA_KEY_PASSPHRASE` (opcional) | texto | Si la clave tiene contraseña. |

Guardas sugeridas en `seleccionarEmisor` (función pura, con pruebas como las actuales): con `arca` sin `ARCA_AMBIENTE` o con un valor desconocido → error claro; `produccion` con `NODE_ENV` distinto de `production` → error (evita facturar de verdad desde una máquina de desarrollo con el certificado real); faltan los archivos o están vencidos → error claro; **no** se puede combinar `arca` con `PERMITIR_EMISOR_SIMULADO` (esa variable sigue aplicando solo al simulador).

Pasos:

1. **Simulado → homologación** (desarrollo/staging):
   - `EMISOR_FISCAL=arca`, `ARCA_AMBIENTE=homologacion`, certificado de **homologación**, punto de venta de homologación en `/configuracion`.
   - Los comprobantes nuevos salen con `ambiente = HOMOLOGACION`, siguen con la marca "SIN VALIDEZ FISCAL" y sus propias series de numeración. Los SIMULADO viejos quedan como están.
   - Una venta que ya tiene factura vigente SIMULADA no se puede refacturar en otro ambiente (el índice "una factura vigente por venta" no distingue ambiente); para probar, usar ventas nuevas.
2. **Plan de pruebas en homologación** (hacerlo entero antes de producción):
   1. WSAA: obtener TA; renovarlo; forzar un TA vencido y ver que se renueva; error claro con un certificado no asociado.
   2. `FEDummy` y `FEParamGet*`: los códigos que usamos existen; el punto de venta figura.
   3. Factura B a consumidor final sin identificar (por debajo del umbral) y con DNI.
   4. Factura A a un responsable inscripto con CUIT (en homologación se pueden usar CUIT de prueba; ⚠ verificar cuáles acepta el padrón de pruebas).
   5. Factura C (si el emisor es monotributista; si no, requiere un emisor de prueba monotributista).
   6. Venta con varias alícuotas (21 % y 10,5 %), artículo con IVA 0 y con muchas líneas chicas (para ver si ARCA objeta el redondeo por línea; dudas 2 y 3).
   7. Nota de crédito total de una factura emitida (verifica `CbtesAsoc`).
   8. Rechazos provocados: receptor A sin CUIT, `CondicionIVAReceptorId` inválido, importes que no cierran, fecha fuera de ventana. Verificar que queda RECHAZADO, que el número se reutiliza y que el mensaje es legible.
   9. **Corte en medio del pedido**: cortar la red (o un proxy que tire la respuesta) justo después del envío; debe quedar PENDIENTE; "Resolver" debe encontrar el comprobante y pasarlo a EMITIDO con el CAE correcto.
   10. **Pedido que nunca llegó**: cortar antes del envío; "Resolver" debe pasar a RECHAZADO y liberar el número.
   11. Dos facturas simultáneas de ventas distintas en la misma serie (la segunda debe esperar o pedir reintento, nunca repetir número) y dos clics sobre la misma venta.
   12. `ultimoAutorizado` distinto del último EMITIDO de la base (por ejemplo, alguien facturó en homologación con otra herramienta): el sistema debe frenar con el mensaje claro y no emitir.
   13. Escanear el QR de un comprobante de homologación y de producción con la herramienta de validación de ARCA (ver duda del QR) y revisar el imprimible.
3. **Homologación → producción** (solo con el visto bueno del contador y del dueño):
   - Certificado de **producción** asociado a `wsfe`; punto de venta real "RECE para aplicaciones y web services"; datos reales en `/configuracion`; `EMISOR_FISCAL=arca`, `ARCA_AMBIENTE=produccion`, `NODE_ENV=production`; **sin** `PERMITIR_EMISOR_SIMULADO`.
   - Primera factura real por un monto chico, a un cliente conocido, verificándola en el servicio de consulta de comprobantes de ARCA y escaneando el QR; si hay que deshacerla, con una nota de crédito.
   - **Punto de arranque de la numeración.** El dominio exige que el último autorizado de ARCA sea igual al último EMITIDO de la base. En una serie de producción **nueva** (punto de venta nuevo, sin comprobantes), ARCA dice 0 y la base dice 0: arranca en 1. Si el punto de venta ya tiene comprobantes en ARCA, el sistema se frena en la primera emisión ("el emisor tiene autorizada… hasta el número N, pero el sistema registra hasta el 0"). Por eso se recomienda un punto de venta nuevo; si no es posible, 5.2 tiene que prever un mecanismo explícito y auditable de "sincronización inicial" (no relajar el control en silencio).
4. **Qué pasa con los comprobantes simulados históricos.**
   - Quedan en la base como `SIMULADO`, **inmutables** (EMITIDO y RECHAZADO no se modifican), con la marca "SIN VALIDEZ FISCAL" y sin ningún valor ante ARCA. No se pasan a producción ni se "convierten".
   - Sus ventas figuran como facturadas (hay una factura vigente) aunque la factura sea simulada: **no se pueden refacturar con un comprobante real** mientras exista esa factura vigente, y el emisor real no puede emitir la nota de crédito que la deshaga (la NC tiene que salir por el mismo ambiente). Las dos salidas son: (a) empezar producción con una base limpia de ventas de prueba, o (b) un procedimiento controlado, **con respaldo previo** (`docs/05-respaldos.md`), que borre los comprobantes SIMULADO (el trigger de baja los permite, y solo ellos) para liberar las ventas reales. Elegir antes de salir a producción y no mezclar datos de demostración con ventas reales.
   - El simulador sigue siendo útil en desarrollo y en demos (con `PERMITIR_EMISOR_SIMULADO=1` si el servidor está en producción); jamás debe quedar activo en el servidor real del negocio.

---

## 5. Fuentes oficiales

### 5.1 Qué se pudo y qué no se pudo verificar

- **No se pudo abrir ninguna página oficial.** Los pedidos a `www.afip.gob.ar` fallaron con "no se resuelve el nombre del host"; tampoco resuelven `www.arca.gob.ar`, `servicios1.afip.gov.ar` ni `wsaahomo.afip.gov.ar`. Para contrastar, hay que permitir esos dominios en la red de la sesión (o abrir los enlaces a mano).
- Se hizo una **búsqueda web** (fuentes secundarias y buscador). Lo que confirmó, y con qué grado de confianza:
  - Existen las páginas oficiales de webservices de factura electrónica y el manual del desarrollador (con versión 4.x del manual; la copia indexada indica 4.5, revisión de 2026) y una página de "Homologación Externa".
  - La URL de WSFEv1 de homologación (`wswhomo.afip.gov.ar/wsfev1/service.asmx`) y la del WSAA de homologación (`wsaahomo.afip.gov.ar/ws/services/LoginCms`) aparecen en proyectos de terceros (repositorios y paquetes npm), **no** en la documentación oficial.
  - La RG 5616/2024 y el campo `CondicionIVAReceptorId` aparecen en notas de terceros, **no** en el manual oficial.
- Todo lo demás de la sección 4 (operaciones, campos, tablas de códigos, vigencias, textos de error, nombres de servicios de la clave fiscal) es **conocimiento previo no contrastado**: "⚠ verificar contra la fuente".

### 5.2 Documentos y páginas a consultar

| Tema | URL | Estado |
|---|---|---|
| Webservices de factura electrónica (índice de manuales, WSDL, ejemplos) | https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp (copia histórica: https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp) | Aparece en el buscador; ⚠ verificar contra la fuente |
| Manual del desarrollador de WSFEv1 (RG 4291): `FECAESolicitar`, `FECompUltimoAutorizado`, `FECompConsultar`, `FEParamGet*`, códigos de error | https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf | Aparece en el buscador; ⚠ verificar contra la fuente (bajar la versión vigente) |
| WSAA: autenticación y autorización (TRA, CMS, TA), manual del desarrollador | https://www.afip.gob.ar/ws/documentacion/wsaa.asp | Dirección recordada; ⚠ verificar contra la fuente |
| Portal de servicios web / catálogo de webservices | https://www.afip.gob.ar/ws/ y https://www.arca.gob.ar/ws/ | ⚠ verificar contra la fuente |
| Homologación (pruebas), certificados de testing, WSASS | https://www.arca.gob.ar/fe/ayuda/webservice.asp (copia: https://www.afip.gob.ar/fe/ayuda/webservice.asp) | Aparece en el buscador como "Homologación Externa"; ⚠ verificar contra la fuente |
| Especificación del código QR (RG 4892) | https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf (página: https://www.afip.gob.ar/fe/qr/) | **No se pudo leer** (`src/lib/qr-fiscal.ts` ya lo advierte); ⚠ verificar contra la fuente |
| RG 4291 (factura electrónica por web services) | https://www.afip.gob.ar/ws/ (buscar "RG 4291") o el Boletín Oficial | ⚠ verificar contra la fuente |
| RG 5616/2024 (condición frente al IVA del receptor) | Boletín Oficial / sitio de ARCA | Solo fuentes secundarias; ⚠ verificar contra la fuente |
| Umbral de identificación del consumidor final | Buscar la resolución general vigente en el sitio de ARCA (el código cita RG 5700/2025) | ⚠ verificar contra la fuente (sección 6, duda 1) |

Fuentes secundarias que se consultaron (no oficiales, solo para orientarse):

- Repositorio `afipwsfeclient` (URLs de WSFE): https://github.com/tecnocode-sa/afipwsfeclient
- Paquete npm `afip-apis` (URLs de homologación y certificados de testing): https://npmjs.com/package/afip-apis
- Wiki NetArcaWs, análisis del WSDL de homologación: https://github.com/ARSASWebDesign/NetArcaWs/wiki/Plan-de-servicios-y-documentaci%C3%B3n
- Nota sobre `CondicionIVAReceptorId` (RG 5616): https://app.spomsolutions.com/blog/condicion-iva-receptor-rg-5616

### 5.3 Qué cosas del QR siguen sin contrastar

`src/lib/qr-fiscal.ts` arma el QR según la especificación **tal como se la recuerda**, sin haber podido leer el PDF. Antes de producción hay que verificar contra el PDF oficial: nombres y orden de los campos (`ver`, `fecha`, `cuit`, `ptoVta`, `tipoCmp`, `nroCmp`, `importe`, `moneda`, `ctz`, `tipoDocRec`, `nroDocRec`, `tipoCodAut`, `codAut`), el tipo de cada uno (números vs texto), el formato de `importe` (13 enteros y 2 decimales), la URL base del QR (hoy `https://www.afip.gob.ar/fe/qr/?p=`; si ARCA migró el dominio, puede cambiar) y el ejemplo oficial para agregarlo como caso de `scripts/verificar-qr.ts`. Además, escanear un QR real contra el validador de ARCA.

---

## 6. Dudas para el contador

Consolidado de las 15 dudas de `docs/fiscal-5.1-decisiones.md` §8, más las del QR, la leyenda de transparencia fiscal y lo que apareció al escribir este documento. Hoy el sistema factura solo de forma simulada, así que ninguna bloquea el uso actual, pero **todas hay que cerrarlas antes de pasar a homologación y producción**.

Marca: **[NORMATIVA]** = depende de normativa vigente que cambia (resoluciones generales de ARCA, leyes), hay que confirmar la versión vigente a la fecha de salida a producción. **[NEGOCIO]** = depende de cómo factura el negocio.

### Identificación del receptor y tipo de comprobante

1. **Umbral de identificación del consumidor final.** [NORMATIVA] Se usó $ 10.000.000 (`UMBRAL_IDENTIFICACION_POR_DEFECTO`, que el código atribuye a la RG 5700/2025 con "a confirmar"). ¿Es el vigente? ¿Se compara con el total del comprobante con IVA incluido (así está)? ¿Hay montos o medios de pago que cambien la regla? Se puede cambiar sin tocar código con la clave `fiscalUmbralIdentificacion`.
2. **Receptor monotributista o exento.** [NORMATIVA] Hoy recibe factura B (contrato de la ola) y se le exige CUIT. ¿Corresponde A o B según la normativa vigente? (Un monotributista como receptor suele corresponder a factura A.) ¿Exigir CUIT a un exento o monotributista es correcto?
3. **Factura de Crédito Electrónica MiPyME.** [NORMATIVA] Si el cliente es una empresa grande y el monto supera el umbral del régimen FCE, ¿corresponde FCE en lugar de factura A? Hoy no se contempla.
4. **Documento del receptor.** [NEGOCIO] Solo CUIT, DNI o sin identificar. ¿Hay clientes extranjeros (pasaporte, CDI, otros)?
5. **`CondicionIVAReceptorId`.** [NORMATIVA] Se informan 1 (RI), 4 (exento), 5 (consumidor final) y 6 (monotributo). ARCA tiene más valores (por ejemplo sujeto no categorizado, del exterior, monotributista social) y limita cuáles valen según la clase de comprobante. ¿Alcanzan los cuatro con los clientes reales? ¿Qué condición corresponde a clientes especiales (cooperativas, entidades sin fines de lucro, etc.)?

### Importes, IVA y redondeo

6. **Redondeo.** El IVA se calcula por línea (como la venta) y se suma por alícuota. ARCA valida que el IVA de cada alícuota sea base × alícuota con cierta tolerancia. ¿Alcanza con el cálculo por línea o hay que recalcular por alícuota (lo que cambiaría el total de la venta en centavos)? El sistema avisa cuando la diferencia supera un centavo.
7. **Precios con IVA incluido.** El neto sale de bruto / (1 + alícuota). ¿Es correcto para la factura A, donde el comprador ve el neto unitario?
8. **IVA 0 en un artículo.** [NORMATIVA] Hoy se informa como alícuota 0 % (código 3). ¿Los artículos con IVA 0 son gravados a tasa 0, **exentos** (`ImpOpEx`) o **no gravados** (`ImpTotConc`)? Cambia cómo se informa y los totales.
9. **Alícuotas.** [NORMATIVA] El catálogo de artículos admite 0, 10,5, 21 y 27 %; el sistema reconoce además 2,5 y 5 %. ¿Hace falta alguna de esas dos?
10. **Monotributista con artículos con IVA.** [NEGOCIO] Se emite factura C por el total y se avisa ("cargá tus artículos con IVA 0"). ¿Es correcto?
11. **Moneda y tributos.** [NEGOCIO] Solo pesos, sin percepciones ni otros tributos (`ImpTrib` = 0). ¿Hay alguna percepción (IIBB, por ejemplo) o ventas en moneda extranjera que deban figurar?

### Concepto, fecha y comprobantes asociados

12. **Concepto.** [NEGOCIO/NORMATIVA] Se informa siempre "productos" (1). Si se factura el corte láser como **servicio** (2) o productos y servicios (3), ARCA pide fechas de servicio y vencimiento de pago. ¿Qué concepto corresponde a cada tipo de venta?
13. **Fecha.** [NORMATIVA] El comprobante sale con la fecha de hoy aunque la venta sea de días anteriores. ARCA permite fechar algunos días hacia atrás. ¿Hay que respetar la fecha de la venta? ¿Cuántos días admite hoy?
14. **Nota de crédito.** [NEGOCIO] Solo total (las parciales quedan fuera de alcance). ¿Alcanza? ¿Hace falta nota de débito? ¿Plazos para anular una factura con una nota de crédito?

### Emisor, punto de venta y CAE

15. **Punto de venta.** [NEGOCIO] Debe estar dado de alta en ARCA para factura electrónica por web services ("RECE para aplicaciones y web services"), distinto del de "Comprobantes en línea". Confirmar el número y que sea un punto de venta nuevo (ver 4.8, punto de arranque de la numeración).
16. **Vencimiento del CAE.** El simulador usa fecha + 10 días; con ARCA viene en la respuesta. Confirmar qué implica un CAE vencido para el negocio (no debería haber comprobantes EMITIDO con CAE vencido, pero conviene saber qué se hace).
17. **Condición del emisor.** [NEGOCIO] Solo responsable inscripto o monotributo (exento no factura con este sistema). Confirmar la condición y la categoría del dueño, y si cambia durante la vida del sistema (recategorización, pase a RI): la foto del emisor se toma en cada comprobante, pero el tipo de factura cambia (C ↔ A/B).
18. **Ingresos brutos.** [NORMATIVA] Se imprime el número de IIBB si está cargado. ¿Hay que informar algo más (convenio multilateral, jurisdicción, percepciones)?

### QR fiscal

19. **Formato exacto del QR.** [NORMATIVA] `src/lib/qr-fiscal.ts` se escribió sin poder leer la especificación oficial (RG 4892): nombres y orden de campos, tipos (`cuit`, `nroDocRec`, `codAut` como números; `tipoCodAut` "E"), `importe` con dos decimales, `moneda` "PES", `ctz` 1, fecha `YYYY-MM-DD`, y la URL base. ¿El contador (o ARCA, escaneando el QR) puede confirmar que valida? Probar con el validador de ARCA antes de producción.
20. **QR en comprobantes no productivos.** Hoy el comprobante SIMULADO muestra un QR que **no valida** en ARCA, junto a la marca "SIN VALIDEZ FISCAL". ¿Preferís que los comprobantes no productivos no lleven QR para evitar confusiones con un cliente?

### Leyenda de transparencia fiscal (factura B)

21. **Régimen de Transparencia Fiscal al Consumidor.** [NORMATIVA] La factura B imprime la leyenda "Régimen de Transparencia Fiscal al Consumidor", el **IVA contenido** (el IVA de la factura) y "Otros impuestos nacionales indirectos: $ 0,00" (`LEYENDA_TRANSPARENCIA` en `src/app/comprobantes/[id]/_componentes/etiquetas.ts`; el código aclara "verificar con el contador": el texto exacto y la norma — Ley 27.743 y resoluciones de ARCA sobre IVA contenido y otros impuestos nacionales indirectos — cambian con la normativa). Preguntas: ¿esa leyenda es obligatoria para este negocio? ¿El texto y los rubros son los vigentes? ¿El sistema debería calcular "otros impuestos nacionales indirectos" en lugar de informar 0,00? ¿Aplica también a la factura C o a la A?

### Cómo usar esta lista

Antes de la reunión con el contador, imprimir esta sección con las respuestas por escrito. Cada respuesta que cambie una regla se traduce en un cambio chico y localizado: las reglas fiscales están en `src/lib/comprobantes.ts` (tipo, receptor, alícuotas, importes), `src/lib/datos-fiscales.ts` (umbral), `src/lib/qr-fiscal.ts` y `etiquetas.ts` (QR y leyenda), y en `solicitud.concepto` del dominio (concepto y fecha). Anotar las respuestas y la fecha en `docs/fiscal-5.1-decisiones.md`.
