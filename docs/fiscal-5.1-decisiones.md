# Ola 5 · 5.1 — Decisiones fiscales y dudas para el contador

Tarea 5.1: modelo de comprobantes, emisor fiscal abstracto (con un simulador) y dominio de emisión de
facturas. **No hay conexión con ARCA**: todo lo emitido lleva `ambiente = SIMULADO` y debe mostrarse
con la marca "SIN VALIDEZ FISCAL" (5.3).

Archivos: `prisma/migrations/20260301000000_comprobantes`, `src/lib/datos-fiscales.ts`,
`src/lib/comprobantes.ts`, `src/lib/fiscal/{emisor,emisor-simulado,index}.ts`,
`src/lib/dominio/comprobantes.ts`. Pruebas: `npm run test:datos-fiscales`, `npm run test:comprobantes`,
`npm run test:comprobantes:db`.

---

## 1. Modelo

| Tabla | Qué guarda |
|---|---|
| `comprobantes` | Cabecera: ambiente, tipo + código ARCA, punto de venta, número, fecha, estado, **foto del emisor** (razón social, CUIT, condición IVA, domicilio, inicio de actividades, IIBB), **foto del receptor** (nombre, tipo y número de documento ARCA, condición IVA, domicilio), neto, IVA, total, CAE, vencimiento del CAE, observaciones del emisor, `comprobanteAsociadoId` (NC), `ventaId`, `usuarioId`. |
| `comprobante_items` | Copia de cada `VentaItem` (descripción, cantidad, precio con IVA, alícuota, neto, IVA, bruto) con su orden. Sin costos. |
| `comprobante_iva` | Una fila por alícuota presente (lo que ARCA recibe en el arreglo `Iva`): alícuota, código ARCA, base imponible, importe. Ninguna en la factura C. |

`clientes` gana `condicionIva` (por defecto `CONSUMIDOR_FINAL`) y `dni` (7 u 8 dígitos, `CHECK`).

**Importes por alícuota: tabla hija y no columnas.** Columnas fijas (`neto21`, `iva21`, `neto105`…)
serían verificables con un `CHECK` de una sola fila, pero obligan a migrar para sumar una alícuota y
no se parecen a lo que pide ARCA. La tabla hija es 1:1 con el arreglo `Iva` de WSFE y se verifica con
un **trigger diferido** (al confirmar la transacción): las bases suman el neto, los importes suman el
IVA, las líneas suman el total (y en A/B también el neto y el IVA); la C no tiene alícuotas. Además
`CHECK` por fila: código ARCA coherente con la alícuota, importes ≥ 0.

**Código ARCA guardado** aunque se deduce del tipo: es lo que se informó, y un `CHECK` impide que no
coincida con el tipo.

**La foto**: el comprobante nunca lee el cliente, el artículo ni la configuración después de emitido.
Probado: editar los tres no cambia ni un byte del comprobante.

## 2. Estados, numeración y transaccionalidad (decisión clave)

Estados: `PENDIENTE` (número reservado y guardado, sin CAE) → `EMITIDO` (CAE + vencimiento) o
`RECHAZADO` (observaciones obligatorias). Un comprobante **nace PENDIENTE** (trigger).

**Dos fases.** Si todo pasara en una transacción, un corte o un error al guardar el resultado
desharía también el PENDIENTE, y ARCA podría tener autorizado un número del que la base no tiene
rastro. Por eso, con un emisor real:

1. `reservarFacturaEnTx` (transacción corta, se confirma): bloquea la venta (`FOR UPDATE`), valida todo,
   reserva el número y guarda el PENDIENTE con la foto completa.
2. `emisor.solicitarCae(...)` **fuera** de toda transacción.
3. `registrarResultadoEnTx` (otra transacción corta): PENDIENTE → EMITIDO o RECHAZADO.

`emitirFactura(prisma, ventaId, usuarioId, { emisor })` encadena las tres (para la server action de
5.5). `emitirFacturaEnTx(tx, ventaId, usuarioId, { emisor })` hace lo mismo en una sola transacción y
**solo acepta el emisor SIMULADO** (seed, pruebas). Si el emisor no responde (excepción), el
comprobante queda PENDIENTE y `resolverPendiente` lo resuelve después consultando al emisor
(`consultar`); solo actúa sobre PENDIENTES de más de 2 minutos para no pisar un pedido en curso.

**Numeración** por (ambiente, punto de venta, tipo), serializada con un advisory lock por serie:

- número = último autorizado **según el emisor** + 1;
- si hay un PENDIENTE en la serie, no se emite (no se sabe si se autorizó, así que no se sabe cuál es
  el próximo); lo garantiza también un índice único parcial (un solo PENDIENTE por serie);
- el último autorizado del emisor debe coincidir con el último EMITIDO de la base; si no, se frena con
  un mensaje claro (algo se autorizó sin registrarse, o al revés);
- **un RECHAZADO no ocupa el número.** ARCA no consume el número de un comprobante rechazado: el
  próximo a autorizar sigue siendo el mismo. El RECHAZADO queda como registro del intento (con el
  número intentado) y el reintento usa ese número. Por eso la unicidad de (ambiente, punto, tipo,
  número) es un **índice parcial sobre los vigentes** (PENDIENTE o EMITIDO), no sobre todas las filas.
  Es un desvío consciente de la letra del contrato: con unicidad total, después de un rechazo el
  sistema pediría N+1 y ARCA lo rechazaría siempre ("no es el próximo a autorizar").

**Concurrencia.** Dos emisiones de la misma venta: la segunda espera el bloqueo de la venta y
encuentra la factura vigente → "La venta ya está facturada (Factura B 0001-00000005)" (o "esperando
respuesta del emisor" si la primera sigue en curso). Nunca un error crudo de unique. Probado con 4
intentos simultáneos (una transacción) y 2 (dos fases), varias rondas.

## 3. Lo que impone la base (migración `20260301000000_comprobantes`)

- `CHECK`: número > 0; punto de venta 1–99999; código ARCA coherente con el tipo; importes ≥ 0;
  total = neto + IVA; la C con IVA 0; EMITIDO ⇔ CAE de 14 dígitos ⇔ vencimiento; RECHAZADO con motivo;
  NC ⇔ comprobante asociado; emisor RI ⇔ A/B y monotributo ⇔ C; documento del receptor coherente
  (80 = 11 dígitos, 96 = 7–8 dígitos, 99 = "0"); la A solo a un RI con CUIT; líneas con cantidad > 0 y
  bruto = neto + IVA; alícuota con su código.
- Índices únicos parciales: número vigente por serie; un PENDIENTE por serie; **una factura vigente por
  venta**; **una NC vigente por factura** (para 5.4: dos NC simultáneas dejan una sola).
- Triggers:
  - alta: nace PENDIENTE; no se factura una venta ANULADA; una NC solo anula una factura **EMITIDA** de
    la misma venta, ambiente y letra;
  - cambios: de un PENDIENTE solo cambian estado, CAE, vencimiento y observaciones; **EMITIDO y
    RECHAZADO son inmutables** (lo único inocuo es `actualizadoEn`);
  - líneas y alícuotas: solo se cargan con el comprobante PENDIENTE; no se modifican ni se borran sueltas;
  - borrado: solo comprobantes `SIMULADO` (datos de desarrollo); uno de homologación o producción no se
    borra nunca (el seed falla si los hay, a propósito);
  - diferido: los importes cierran con las líneas y las alícuotas;
  - `ventas`: una venta con factura vigente (PENDIENTE o EMITIDA) **no se anula** hasta que una NC
    EMITIDA la anule.

`scripts/test-integridad.sql` no se tocó: sus casos son genéricos y el `.sh` espera un número fijo de
errores. Todas las restricciones nuevas se prueban en `npm run test:comprobantes:db` (más de 80 casos,
sin dejar rastro).

## 4. Importes

- Los precios de venta son **con IVA incluido**. Se usa exactamente el cálculo de la venta
  (`costearLineaVenta`): bruto de la línea = cantidad × precio, redondeado a centavos; neto = bruto /
  (1 + alícuota), redondeado **por línea**; IVA = bruto − neto.
- Las alícuotas se agrupan sumando los netos e IVA ya redondeados de cada línea: el comprobante suma
  exactamente lo mismo que la venta.
- **Conciliación con tolerancia cero**: cada línea guardada debe coincidir con el cálculo, y la suma de
  las líneas con los totales de la venta (neto, IVA y bruto). Si algo no cierra por un centavo, se
  rechaza con un mensaje que dice qué línea o qué total y qué se esperaba. Nunca se ajusta.
- Si el IVA de una alícuota (suma por línea) se aleja más de un centavo de base × alícuota (pasa con
  muchas líneas chicas), se emite igual con la suma por línea y se **avisa**.
- Factura C: no discrimina IVA. Neto = total, IVA 0, sin alícuotas. Si la venta tenía IVA > 0, se
  **avisa** ("como monotributista, cargá tus artículos con IVA 0").
- Una venta de $ 0 no se factura. Alícuotas admitidas por ARCA: 0, 2,5, 5, 10,5, 21 y 27 (otra →
  error). Moneda: solo pesos.

## 5. Receptor

- Tipo: emisor monotributista → C; emisor RI + receptor RI con CUIT válido → A; emisor RI + cualquier
  otro → B (contrato de la ola).
- Un CUIT o DNI cargado tiene que ser válido (no se ignora en silencio).
- RI, monotributista o exento **sin CUIT** → error ("cargá su CUIT o cambiá su condición").
- Documento ARCA: CUIT (80) si lo tiene; si no, DNI (96); si no, sin identificar (99, número 0).
- Consumidor final sin identificar: el total debe ser **menor** al umbral. El umbral es
  `UMBRAL_IDENTIFICACION_POR_DEFECTO` ($ 10.000.000, ver dudas) y se puede pisar con la clave
  `fiscalUmbralIdentificacion` de `Configuracion`; la función que valida lo recibe como parámetro.
- Se informa además la condición frente al IVA del receptor con su código ARCA (1 RI, 4 exento,
  5 consumidor final, 6 monotributo).

## 6. Datos fiscales del negocio

Claves de `Configuracion`: `fiscalRazonSocial`, `fiscalCuit`, `fiscalCondicionIva` (vacía =
responsable inscripto), `fiscalDomicilio`, `fiscalInicioActividades` (ISO; se acepta dd/mm/aaaa al
tipear; no futura ni anterior a 1900), `fiscalIibb` (opcional), `fiscalPuntoVenta` (entero 1–99999) y
`fiscalUmbralIdentificacion` (opcional). `validarDatosFiscales` da un error por campo y los valores
normalizados a guardar; `faltantesParaEmitir` y `mensajeFaltantes` dicen qué falta para emitir.

El seed carga datos fiscales **de ejemplo solo fuera de producción** (CUIT ficticio válido
20-33333333-4, punto de venta 1) para poder facturar con el simulador apenas se levanta el entorno.

## 7. Emisor y salvaguardas

- `EmisorFiscal`: `ultimoAutorizado`, `solicitarCae` (rechazo = resultado, no excepción; excepción =
  "no se sabe"), `consultar`.
- Simulador: no guarda nada propio; lo "autorizado" es lo EMITIDO en `SIMULADO` en la base (acceso
  inyectado). Valida como ARCA (número correlativo, A con CUIT, sumas, C sin IVA, NC con asociado).
  CAE de 14 dígitos determinista (empieza con 7); vencimiento: fecha + 10 días. Para pruebas acepta
  forzar un rechazo o un corte.
- `EMISOR_FISCAL`: `simulado` (por defecto) | `arca` → "no implementado" | otro → error.
- `NODE_ENV=production` + simulado exige `PERMITIR_EMISOR_SIMULADO=1` (exactamente "1"); si no,
  "Facturación deshabilitada…". La decisión es una función pura (`seleccionarEmisor(entorno)`); el
  único lugar que lee `process.env` es `entornoDelProceso()`.

---

## 8. Dudas para el contador

1. **Umbral de identificación del consumidor final.** Se usó $ 10.000.000 (RG 5700/2025, a
   confirmar). ¿Es el valor vigente? ¿Se compara con el total del comprobante IVA incluido (así está)?
2. **Redondeo.** El IVA se calcula por línea (como la venta) y se suma por alícuota. ARCA valida que el
   IVA de cada alícuota sea base × alícuota con cierta tolerancia: ¿alcanza con el cálculo por línea o
   hay que recalcular por alícuota (lo que cambiaría el total de la venta en centavos)?
3. **Precios con IVA incluido.** El neto sale de bruto / (1 + alícuota). ¿Correcto para la A, donde el
   comprador ve el neto unitario?
4. **IVA 0 en un artículo.** Hoy se informa como alícuota 0 % (código 3). ¿Los artículos con IVA 0 son
   gravados a tasa 0, **exentos** (`ImpOpEx`) o **no gravados** (`ImpTotConc`)? Cambia cómo se informa.
5. **Alícuotas.** El catálogo admite 0, 10,5, 21 y 27 %. ¿Hace falta 2,5 % o 5 %?
6. **Monotributista con artículos con IVA.** Se emite C por el total y se avisa. ¿Correcto?
7. **Receptor monotributista o exento.** Hoy recibe B (contrato), identificado con CUIT. ¿Corresponde
   A o B según la normativa vigente? ¿Exigir CUIT a un exento o monotributista es correcto?
8. **Factura de Crédito Electrónica MiPyME.** Si el cliente es una empresa grande y el monto supera el
   umbral del régimen FCE, ¿corresponde FCE en lugar de factura A? Hoy no se contempla.
9. **Concepto.** Se informa siempre "productos" (1). Si se factura corte láser como **servicio** (2 o
   3), ARCA pide fechas de servicio y vencimiento de pago. ¿Qué concepto corresponde?
10. **Fecha.** El comprobante sale con la fecha de hoy aunque la venta sea de días anteriores. ARCA
    permite fechar algunos días hacia atrás. ¿Hay que respetar la fecha de la venta?
11. **Nota de crédito.** Solo total (las parciales quedan fuera de alcance). ¿Alcanza para el negocio?
12. **Moneda y tributos.** Solo pesos, sin percepciones ni otros tributos (`ImpTrib` = 0). ¿Hay alguna
    percepción (IIBB, por ejemplo) que deba figurar?
13. **Documento del receptor.** Solo CUIT, DNI o sin identificar. ¿Hay clientes extranjeros
    (pasaporte, CDI)?
14. **Punto de venta.** Debe estar dado de alta en ARCA para factura electrónica por web services
    (distinto del de "Comprobantes en línea"). Confirmar el número.
15. **Vencimiento del CAE.** El simulador usa fecha + 10 días; con ARCA viene en la respuesta.

## 9. Para las tareas siguientes

- **5.1b** (clientes y configuración): el formulario de cliente debe pedir `condicionIva` y `dni`
  (normalizar con `normalizarDni`; la base exige 7–8 dígitos sin puntos). La configuración fiscal usa
  `validarDatosFiscales` (errores por campo y `valores` listos para upsert; `""` = borrar la clave
  opcional) y el permiso `configuracion`.
- **5.3** (imprimible): marca "SIN VALIDEZ FISCAL" si `ambiente !== "PRODUCCION"`;
  `numeroFormateado(punto, número)`; todo sale de la foto del comprobante, nunca del cliente o la venta.
- **5.4** (NC): `tipoNotaCredito(factura)`; la base exige factura EMITIDA de la misma venta, ambiente y
  letra, y una sola NC vigente por factura. Falta el dominio de emisión de la NC (mismas dos fases;
  `SolicitudCae.comprobanteAsociado`).
- **5.5** (acción): `obtenerEmisorFiscal(entornoDelProceso(), accesoSimulado(prisma))`; si no `ok`,
  mostrar el error (facturación deshabilitada). Si `ok`, `emitirFactura(prisma, ventaId, usuarioId,
  { emisor })` y mostrar `mensaje` y `advertencias`. Un PENDIENTE se resuelve con `resolverPendiente`.
- **`anularVentaEnTx`** (`src/lib/dominio/ventas.ts`, no es de esta tarea): con la factura vigente, la
  base rechaza la anulación con un error crudo. Conviene verificar antes y lanzar un `ErrorDeNegocio`
  claro ("La venta tiene la Factura B …: primero hay que emitir la nota de crédito").
- **`docs/02-modelo-datos.md`**: agregar `comprobantes`, `comprobante_items`, `comprobante_iva`, los
  campos nuevos de `clientes` y la migración 11 (`20260301000000_comprobantes`).
