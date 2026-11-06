---
tags: [ventas, producto, glosario]
---

# Glosario

| Término | Significado |
|---|---|
| **Artículo** | Lo que el comercio vende (sticker, cartel, servicio). Tabla `articulos`. |
| **Material** | Lo que el comercio consume o revende (vinilo, MDF, tinta). Tabla `materiales`. Un solo catálogo para insumo y reventa. |
| **Máquina** | Recurso de producción con costo por hora (plotter, láser, viniladora). |
| **Receta** | Estándar de consumo de un artículo: materiales + horas de máquina + horas de mano de obra. 1:1 con el artículo. Ver [[Costeo por receta]]. |
| **Override de costo** | Costo unitario fijo en una línea de receta que reemplaza al costo vigente del material o máquina. |
| **Sin receta** | Artículo con costo 0 y margen desconocido; se marca en vez de mostrar un falso 100 %. |
| **Snapshot / congelado** | Valor copiado en el momento de la operación que no cambia después (costo en la venta, precio en el presupuesto, foto del comprobante). |
| **Baja lógica** | `activo = false` (o `anuladoEn`). Nunca se borra algo con historial. |
| **Saldo** | Lo que debe un cliente o una venta. **Nunca se guarda**: se calcula desde ventas y pagos. |
| **Margen objetivo** | Margen de referencia (40 % por defecto) para detectar artículos vendidos por debajo de su valor y sugerir precio. |
| **Lista de precios** | Descuento general sobre catálogo y/o precios específicos por artículo, asignada a clientes. |
| **`resolverPrecio`** | Función que decide el precio de una línea: específico → catálogo − descuento → catálogo. |
| **Presupuesto** | Oferta a un cliente con precios congelados; vence (calculado) y se convierte en venta una sola vez. |
| **Contacto de cobranza** | Registro de un llamado o mensaje a un deudor, con próximo contacto opcional. |
| **Trabajo de producción** | Lo realmente usado para producir una línea de venta (minutos y materiales). |
| **Margen real** | Margen calculado con el costo real de producción en vez del de receta. |
| **Comprobante** | Factura (A/B/C) o nota de crédito. Es una **foto** inmutable. |
| **Emisor fiscal** | Interfaz que autoriza comprobantes. Hoy solo existe el **simulado**. |
| **CAE** | Código de Autorización Electrónico que da ARCA (14 dígitos). |
| **ARCA** | Agencia de Recaudación y Control Aduanero (ex AFIP). |
| **WSAA / WSFE** | Web services de ARCA: autenticación y facturación electrónica. |
| **Serie** | (ambiente, punto de venta, tipo de comprobante): unidad de numeración. |
| **Ambiente** | `SIMULADO`, `HOMOLOGACION` o `PRODUCCION`. |
| **RI** | Responsable inscripto en IVA. |
| **Ola** | Conjunto de tareas paralelizables del plan de trabajo. Ver [[Historial por olas]]. |
| **Modo demo** | La app sin base de datos: muestra datos de demostración calculados con el mismo motor. |
| **`SIN_BASE`** | Resultado que devuelven las acciones cuando no hay base de datos. |
| **`DUENO` / `EMPLEADO`** | Los dos roles. Ver [[Seguridad y permisos]]. |
