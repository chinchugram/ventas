import Link from "next/link";
import { NOMBRE_TIPO, numeroFormateado } from "@/lib/comprobantes";
import { ANTIGUEDAD_MINIMA_PENDIENTE_MS } from "@/lib/dominio/comprobantes";
import { pendienteResoluble, type ComprobanteDeVenta } from "@/lib/facturacion";
import { usuarioActual } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import { estadoFacturacionDeVenta } from "@/lib/queries/comprobantes";
import { MarcaAmbiente } from "@/app/comprobantes/_componentes/marca-ambiente";
import { ResolverPendienteBoton } from "@/app/comprobantes/_componentes/resolver-pendiente-boton";
import { FacturarBoton } from "./facturar-boton";

const cual = (c: ComprobanteDeVenta) => `${NOMBRE_TIPO[c.tipo]} ${numeroFormateado(c.puntoVenta, c.numero)}`;

const CLASE_ENLACE = "inline-flex min-h-11 items-center text-sm font-medium text-slate-700 underline underline-offset-2";

/**
 * Facturacion de la venta: en que estado esta (sin factura / emitida / con nota
 * de credito / pendiente / rechazada), los avisos antes de emitir y el boton
 * para hacerlo. Componente de servidor: pide el estado ya resuelto a
 * `estadoFacturacionDeVenta` y verifica `verComprobantes` ANTES de leerlo; el
 * boton solo se pinta con `emitirComprobante` (la accion lo vuelve a exigir).
 * No consulta costos.
 */
export async function FacturarPanel({ ventaId }: { ventaId: string }) {
  const usuario = await usuarioActual();
  if (!usuario || !puede(usuario, "verComprobantes")) return null;
  const puedeEmitir = puede(usuario, "emitirComprobante");
  const puedeConfigurar = puede(usuario, "configuracion");
  const puedeEditarClientes = puede(usuario, "editarClientes");

  const f = await estadoFacturacionDeVenta(ventaId);
  if (!f) return null;
  const { resumen, avisos } = f;
  const { situacion, factura, notaCredito } = resumen;

  const bloqueado = avisos.bloqueantes.length > 0;
  // Se puede pedir una factura: la venta lo admite y ningun aviso lo impide.
  const botonVisible = puedeEmitir && resumen.puedeEmitir && !bloqueado;
  const pendienteViejo = factura?.estado === "PENDIENTE" && pendienteResoluble(factura.creadoEn, new Date(), ANTIGUEDAD_MINIMA_PENDIENTE_MS);
  const tipoPrevisto = avisos.tipoPrevisto ? NOMBRE_TIPO[avisos.tipoPrevisto] : null;

  return (
    <section aria-label="Facturación" className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Facturación</h2>

      {situacion === "VENTA_ANULADA" ? <p className="text-sm text-slate-500">La venta está anulada: no se factura.</p> : null}

      {situacion === "SIN_FACTURA" ? (
        <p className="text-sm text-slate-600">
          Esta venta todavía no tiene factura.{tipoPrevisto ? ` Saldría una ${tipoPrevisto}.` : ""}
        </p>
      ) : null}

      {(situacion === "EMITIDA" || situacion === "CON_NOTA_CREDITO") && factura ? (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {situacion === "CON_NOTA_CREDITO" ? "Con nota de crédito" : "Facturada"}
            </span>
            <MarcaAmbiente ambiente={factura.ambiente} />
          </div>
          <p className="text-slate-800">
            <span className="font-medium">{cual(factura)}</span> · {fmtFecha(factura.fecha)} · {fmtMoneda(factura.importeTotal)}
          </p>
          <Link href={`/comprobantes/${factura.id}`} className={CLASE_ENLACE}>
            Ver la factura
          </Link>
          {notaCredito ? (
            <p className="text-slate-800">
              {notaCredito.estado === "EMITIDO" ? "Anulada por la " : "Nota de crédito en curso: "}
              <Link href={`/comprobantes/${notaCredito.id}`} className="font-medium underline underline-offset-2">
                {cual(notaCredito)}
              </Link>
              {notaCredito.estado === "PENDIENTE" ? " (esperando respuesta del emisor)" : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      {situacion === "PENDIENTE" && factura ? (
        <div className="space-y-2 text-sm">
          <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
            La {cual(factura)} está pendiente: el emisor no respondió y no se sabe si la autorizó. No se puede volver a facturar esta
            venta hasta resolverla.
          </p>
          <MarcaAmbiente ambiente={factura.ambiente} />
          <div>
            <Link href={`/comprobantes/${factura.id}`} className={CLASE_ENLACE}>
              Ver el comprobante
            </Link>
          </div>
          {puedeEmitir ? (
            pendienteViejo ? (
              <ResolverPendienteBoton comprobanteId={factura.id} />
            ) : (
              <p className="text-slate-500">Se creó hace instantes: puede estar esperando respuesta. Probá de nuevo en unos minutos.</p>
            )
          ) : null}
        </div>
      ) : null}

      {situacion === "RECHAZADA" && factura ? (
        <div className="space-y-2 text-sm">
          <p className="rounded-lg bg-red-50 p-3 text-red-700">
            La {cual(factura)} fue rechazada por el emisor.
            {factura.observaciones ? <span className="mt-1 block break-words whitespace-pre-line">{factura.observaciones}</span> : null}
          </p>
          <MarcaAmbiente ambiente={factura.ambiente} />
          <p className="text-slate-600">
            Una factura rechazada no vale: se puede volver a facturar la venta
            {tipoPrevisto ? ` (saldría una ${tipoPrevisto})` : ""}.
          </p>
          <Link href={`/comprobantes/${factura.id}`} className={CLASE_ENLACE}>
            Ver el intento rechazado
          </Link>
        </div>
      ) : null}

      {resumen.puedeEmitir ? (
        <div className="mt-3 space-y-2">
          {avisos.bloqueantes.map((a) => (
            <div key={a.codigo} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="break-words">
                {a.mensaje}
                {a.codigo === "DATOS_FISCALES" && !puedeConfigurar ? " Pedile al dueño que los complete." : ""}
              </p>
              {a.codigo === "DATOS_FISCALES" && puedeConfigurar ? (
                <Link href="/configuracion" className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                  Ir a Configuración
                </Link>
              ) : null}
              {a.codigo === "RECEPTOR" && puedeEditarClientes ? (
                <Link
                  href={`/clientes/${f.clienteId}/editar`}
                  className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
                >
                  Corregir los datos del cliente
                </Link>
              ) : null}
            </div>
          ))}
          {avisos.advertencias.map((a) => (
            <p key={a} role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {a}
            </p>
          ))}
        </div>
      ) : null}

      {puedeEmitir ? (
        <div className="mt-3">
          <FacturarBoton ventaId={ventaId} visible={botonVisible} reintento={resumen.rechazos > 0} tipoPrevisto={tipoPrevisto} />
        </div>
      ) : null}
    </section>
  );
}
