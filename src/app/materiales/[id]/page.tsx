import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { getMateriales, getMaterialesStock, tieneCostos } from "@/lib/queries/materiales";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { getMovimientos } from "@/lib/queries/compras";
import { AjusteStockForm } from "@/components/ajuste-stock-form";
import { Boton, ListaPanel, Seccion, Tarjeta, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

const TEXTO_TIPO = { COMPRA: "Compra", VENTA: "Venta", AJUSTE: "Ajuste" } as const;

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requierePermisoPagina("verStock");
  const { id } = await params;
  const verCostos = puede(usuario, "verCostos");
  // Sin permiso de ver costos, la consulta ni lee costo ni precio del material.
  const material = (verCostos ? await getMateriales() : await getMaterialesStock()).find((m) => m.id === id);
  if (!material) notFound();

  const movimientos = await getMovimientos(id, 100, !puede(usuario, "registrarCompra"));

  return (
    <>
      <Seccion
        epigrafe="Movimientos de stock"
        titulo={material.nombre}
        descripcion="Lo que entró, lo que salió y cómo quedó"
        accion={
          <div className="flex flex-wrap gap-2">
            {puede(usuario, "editarMateriales") ? (
              <Boton href={`/materiales/${material.id}/editar`} variante="secundario">
                Editar
              </Boton>
            ) : null}
            <Boton href="/materiales" variante="secundario">
              Volver
            </Boton>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Stock" valor={`${fmtNumero(material.stockActual)} ${material.unidad}`} />
        {tieneCostos(material) ? <Tarjeta titulo="Costo unitario" valor={fmtMoneda(material.costoUnitario)} /> : null}
      </div>

      {puede(usuario, "ajustarStock") ? (
        <div className="mb-4">
          <AjusteStockForm materialId={material.id} unidad={material.unidad} />
        </div>
      ) : null}

      {movimientos.length === 0 ? (
        <Vacio mensaje="Sin movimientos todavía." hint="Las compras, las ventas y los ajustes quedan registrados acá." />
      ) : (
        <ListaPanel>
          {movimientos.map((m) => {
            const entra = m.cantidad.cmp(0) > 0;
            return (
              <li key={m.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-body font-semibold text-ink">{TEXTO_TIPO[m.tipo]}</p>
                  <p className="text-body-sm break-words text-ink-muted">
                    {fmtFecha(m.fecha)}
                    {m.motivo ? ` · ${m.motivo}` : ""}
                  </p>
                  <p className="text-body-sm text-ink-muted">Registrado por {m.registradoPor ?? "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`monto-fila ${entra ? "text-ok-text" : "text-ink"}`}>
                    {entra ? "+" : ""}
                    {fmtNumero(m.cantidad)} {material.unidad}
                  </p>
                  <p className="text-body-sm text-ink-muted tabular-nums">saldo {fmtNumero(m.stockResultante)}</p>
                </div>
              </li>
            );
          })}
        </ListaPanel>
      )}
    </>
  );
}
