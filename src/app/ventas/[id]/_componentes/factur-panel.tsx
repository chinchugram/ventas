import Link from "next/link";
import { NOMBRE_TIPO, numeroFormateado } from "@/lib/comprobantes";
import { ANTIGUEDAD_MINIMA_PENDIENTE_MS } from "@/lib/dominio/comprobantes";
import { pendienteResoluble, type ComprobanteDeVenta } from "@/lib/facturacion";
import { usuarioActual } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import { Aviso, Etiqueta, Panel, TituloBloque } from "@/components/ui";
import { estadoFacturacionDeVenta } from "@/lib/queries/comprobantes";
import { MarcaAmbiente } from "@/app/comprobantes/_componentes/marca-ambiente";
import { ResolverPendienteBoton } from "@/app/comprobantes/_componentes/resolver-pendiente-boton";
import { FacturarBoton } from "./facturar-boton";

const cual = (c: ComprobanteDeVenta) => `${NOMBRE_TIPO[c.tipo]} ${numeroFormateado(c.puntoVenta, c.numero)}`;

const CLASE_ENLACE = "enlace inline-flex min-h-11 items-center";

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
    <Panel como="section" className="mb-4 space-y-3">
      <TituloBloque className="mb-0">Facturación</TituloBloque>

      {situacion === "VENTA_ANULADA" ? <p className="text-body-sm text-ink-muted">La venta está anulada: no se factura.</p> : null}

      {situacion === "SIN_FACTURA" ? (
        <p className="text-body text-ink-muted">
          Esta venta todavía no tiene factura.{tipoPrevisto ? ` Saldría una ${tipoPrevisto}.` : ""}
        </p>
      ) : null}

      {(situacion === "EMITIDA" || situacion === "CON_NOTA_CREDITO") && factura ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Etiqueta tono="ok">{situacion === "CON_NOTA_CREDITO" ? "Con nota de crédito" : "Facturada"}</Etiqueta>
            <MarcaAmbiente ambiente={factura.ambiente} />
          </div>
          <p className="text-body text-ink">
            <span className="font-semibold">{cual(factura)}</span> · {fmtFecha(factura.fecha)} ·{" "}
            <span className="tabular-nums">{fmtMoneda(factura.importeTotal)}</span>
          </p>
          <Link href={`/comprobantes/${factura.id}`} className={CLASE_ENLACE}>
            Ver la factura
          </Link>
          {notaCredito ? (
            <p className="text-body text-ink">
              {notaCredito.estado === "EMITIDO" ? "Anulada por la " : "Nota de crédito en curso: "}
              <Link href={`/comprobantes/${notaCredito.id}`} className="enlace">
                {cual(notaCredito)}
              </Link>
              {notaCredito.estado === "PENDIENTE" ? " (esperando respuesta del emisor)" : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      {situacion === "PENDIENTE" && factura ? (
        <div className="space-y-2">
          <Aviso tono="aviso" titulo="Esperando al emisor">
            La {cual(factura)} está pendiente: el emisor no respondió y no sabemos si la autorizó. No se puede volver a facturar esta
            venta hasta resolverla.
          </Aviso>
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
              <p className="text-body-sm text-ink-muted">Se creó hace instantes: puede estar esperando respuesta. Probá de nuevo en unos minutos.</p>
            )
          ) : null}
        </div>
      ) : null}

      {situacion === "RECHAZADA" && factura ? (
        <div className="space-y-2">
          <Aviso tono="critico" titulo="El emisor rechazó la factura">
            La {cual(factura)} no quedó autorizada.
            {factura.observaciones ? <span className="mt-1 block break-words whitespace-pre-line">{factura.observaciones}</span> : null}
          </Aviso>
          <MarcaAmbiente ambiente={factura.ambiente} />
          <p className="text-body-sm text-ink-muted">
            Una factura rechazada no vale: se puede volver a facturar la venta
            {tipoPrevisto ? ` (saldría una ${tipoPrevisto})` : ""}.
          </p>
          <Link href={`/comprobantes/${factura.id}`} className={CLASE_ENLACE}>
            Ver el intento rechazado
          </Link>
        </div>
      ) : null}

      {resumen.puedeEmitir ? (
        <div className="space-y-2">
          {avisos.bloqueantes.map((a) => (
            <Aviso key={a.codigo} tono="critico" role="alert">
              <p className="break-words">
                {a.mensaje}
                {a.codigo === "DATOS_FISCALES" && !puedeConfigurar ? " Pedile al dueño que los complete." : ""}
              </p>
              {a.codigo === "DATOS_FISCALES" && puedeConfigurar ? (
                <Link href="/configuracion" className={CLASE_ENLACE}>
                  Ir a Configuración
                </Link>
              ) : null}
              {a.codigo === "RECEPTOR" && puedeEditarClientes ? (
                <Link href={`/clientes/${f.clienteId}/editar`} className={CLASE_ENLACE}>
                  Corregir los datos del cliente
                </Link>
              ) : null}
            </Aviso>
          ))}
          {avisos.advertencias.map((a) => (
            <Aviso key={a} tono="aviso" role="status">
              {a}
            </Aviso>
          ))}
        </div>
      ) : null}

      {puedeEmitir ? <FacturarBoton ventaId={ventaId} visible={botonVisible} reintento={resumen.rechazos > 0} tipoPrevisto={tipoPrevisto} /> : null}
    </Panel>
  );
}
