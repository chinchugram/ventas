---
tags: [ventas, fiscal, pendiente]
fuente: docs/fiscal-5.1-decisiones.md §8, docs/06-facturacion-arca.md §6
---

# Dudas para el contador

Decisiones fiscales tomadas por defecto que hay que confirmar antes de facturar de verdad. Contexto: [[Facturación]], [[Integración ARCA (tarea 5.2)]].

- [ ] **Umbral de identificación del consumidor final**: se usó $ 10.000.000 (RG 5700/2025). ¿Vigente? ¿Se compara con el total IVA incluido?
- [ ] **Redondeo**: IVA por línea y sumado por alícuota. ¿Alcanza para la tolerancia de ARCA o hay que recalcular por alícuota?
- [ ] **Precios con IVA incluido**: neto = bruto / (1 + alícuota). ¿Correcto para la A?
- [ ] **IVA 0**: hoy alícuota 0 % (código 3). ¿Es tasa 0, exento (`ImpOpEx`) o no gravado (`ImpTotConc`)?
- [ ] **Alícuotas**: catálogo con 0, 10,5, 21 y 27 %. ¿Hace falta 2,5 % o 5 %?
- [ ] **Monotributista con artículos con IVA**: se emite C por el total y se avisa. ¿Correcto?
- [ ] **Receptor monotributista o exento**: hoy recibe B con CUIT. ¿A o B? ¿Exigir CUIT es correcto?
- [ ] **FCE MiPyME**: ¿corresponde con empresas grandes sobre el umbral? Hoy no se contempla.
- [ ] **Concepto**: siempre "productos" (1). ¿El corte láser es servicio (2/3)? Pediría fechas de servicio y vencimiento.
- [ ] **Fecha**: el comprobante sale con fecha de hoy. ¿Respetar la de la venta?
- [ ] **Nota de crédito**: solo total. ¿Alcanza?
- [ ] **Moneda y tributos**: solo pesos, sin percepciones. ¿Alguna percepción (IIBB)?
- [ ] **Documento del receptor**: solo CUIT, DNI o sin identificar. ¿Clientes extranjeros?
- [ ] **Punto de venta**: confirmar número de alta para web services.
- [ ] **Vencimiento del CAE**: el simulador usa fecha + 10 días; con ARCA viene en la respuesta.
- [ ] **QR fiscal y leyenda de transparencia fiscal (factura B)**: contrastar con la especificación oficial.
