---
tags: [ventas, tecnica, fiscal, pendiente]
estado: diferida
fuente: docs/06-facturacion-arca.md
---

# Integración ARCA (tarea 5.2) — DIFERIDA

Plan para pasar del emisor simulado a ARCA real. Lo hecho hoy está en [[Facturación]].

> [!warning] Fuentes sin verificar
> La guía del repo se escribió sin acceso a los dominios de ARCA. Todo dato marcado "⚠ verificar contra la fuente" en `docs/06-facturacion-arca.md` hay que confirmarlo con los manuales oficiales antes de escribir código.

## Contrato `EmisorFiscal` (`src/lib/fiscal/emisor.ts`)

```ts
interface EmisorFiscal {
  readonly ambiente: "SIMULADO" | "HOMOLOGACION" | "PRODUCCION";
  ultimoAutorizado(puntoVenta, tipo): Promise<number>;      // 0 si no hay
  solicitarCae(solicitud: SolicitudCae): Promise<ResultadoCae>;
  consultar(puntoVenta, tipo, numero): Promise<ComprobanteConsultado>;
}
```

| Situación | Expresión | Dominio |
|---|---|---|
| Aprobado | `{ aprobado: true, cae, vencimiento }` | → EMITIDO |
| Rechazado | `{ aprobado: false, observaciones }` (no excepción) | → RECHAZADO, número libre |
| **No se sabe** (timeout, 5xx, SOAP Fault) | **lanza** | queda PENDIENTE; consultar antes de reintentar |
| `consultar` no lo tiene | `{ encontrado: false }` (solo si ARCA lo dice explícito) | → RECHAZADO |
| `consultar` lo tiene | `{ encontrado: true, total… }` | total coincide → EMITIDO |

**Lo que un emisor ARCA debe garantizar**: ambiente verdadero (negarse a construirse si se confunde); `ultimoAutorizado` siempre preguntado a ARCA (lanzar si no contesta, nunca devolver 0); nunca reenviar `solicitarCae` solo; terminar bastante antes de 2 minutos; observaciones `"[codigo] mensaje"`; sin estado persistido; no loguear certificados, token ni sign.

## Arquitectura propuesta

```
Server action → dominio en dos fases (ya existe)
             → EmisorArca implements EmisorFiscal   src/lib/fiscal/emisor-arca.ts
                 ├── WSAA (TRA firmado CMS → TA {token, sign})   arca/wsaa.ts
                 └── WSFEv1 (FECompUltimoAutorizado, FECAESolicitar,
                             FECompConsultar, FEParamGet*)        arca/wsfe.ts
```

- Mapeos como **funciones puras** con pruebas; red detrás de `enviarSoap(url, accion, xml)` inyectable.
- Recomendación: XML a mano con `fetch` (5 operaciones), menos dependencias que auditar.
- TLS: si aparece "dh key too small", un `Agent` acotado a esos hosts, **nunca** desactivar verificación.
- Certificado y clave privada **nunca** en la base ni en el repo.

## Variables propuestas
| Variable | Valores |
|---|---|
| `EMISOR_FISCAL` | `arca` |
| `ARCA_AMBIENTE` | `homologacion` / `produccion` — **obligatoria, sin default** |
| `ARCA_CERT_PATH`, `ARCA_KEY_PATH`, `ARCA_KEY_PASSPHRASE` | rutas / clave |

Guardas: `produccion` con `NODE_ENV ≠ production` → error; `arca` + `PERMITIR_EMISOR_SIMULADO` → no combinable.

## Qué tiene que conseguir el dueño
1. CUIT y clave fiscal con nivel suficiente.
2. Condición IVA y actividad correctas.
3. **Punto de venta "RECE para aplicaciones y web services"** (nuevo y vacío, recomendado).
4. Certificado digital (CSR con openssl; asociarlo a `wsfe`), anotar vencimiento.
5. Repetir el certificado en **homologación** (WSASS).
6. Cargar los datos en `/configuracion`.
7. Hablar con el contador → [[Dudas para el contador]].

## Camino de salida
1. **Simulado → homologación**: `EMISOR_FISCAL=arca`, `ARCA_AMBIENTE=homologacion`; series propias; ventas ya facturadas en simulado no se refacturan.
2. **Plan de pruebas en homologación** (13 casos): TA, parámetros, B/A/C, varias alícuotas, NC, rechazos provocados, corte después del envío (→ Resolver → EMITIDO), pedido que no llegó (→ RECHAZADO), concurrencia, desfase de numeración, QR.
3. **Homologación → producción** con visto bueno del contador: primera factura chica a un cliente conocido; punto de venta nuevo (si ya tiene comprobantes, hace falta una sincronización inicial explícita y auditable).
4. **Comprobantes simulados históricos**: inmutables, sin valor. Opciones: base limpia o borrado controlado de los `SIMULADO` con respaldo previo. No mezclar demo con ventas reales.

Relacionado: [[Datos - Facturación]], [[Pendientes y deuda técnica]].
