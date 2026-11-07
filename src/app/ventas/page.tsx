import { fmtFecha, fmtMonedaCorta as fmtMoneda, fmtNumero, sumar } from "@/lib/money";
import { ETIQUETA_ESTADO_PAGO, getVentas, getVentasSinCostos, tieneGanancia } from "@/lib/queries/ventas";
import { puede, puedeTodo, requierePermisoPagina } from "@/lib/permisos";
import { Boton, Etiqueta, Seccion, Tarjeta, TONO_ESTADO_PAGO, Vacio } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function VentasPage() {
  const usuario = await requierePermisoPagina("verVentas");
  // Ganancia y margen solo para quien puede verlos; los demas reciben un listado que ni lee el costo.
  const verMargenes = puedeTodo(usuario, ["verCostos", "verMargenes"]);
  const ventas = verMargenes ? await getVentas(50) : await getVentasSinCostos(50);
  // Las ventas de demostracion no tienen detalle: solo se enlaza con base real.
  const conDetalle = !estadoDemo().activo;

  const facturado = sumar(...ventas.map((v) => v.totalBruto));
  const pendiente = sumar(...ventas.map((v) => v.saldo));

  return (
    <>
      <Seccion
        epigrafe="Lo vendido"
        titulo="Ventas"
        descripcion={ventas.length === 0 ? "Todavía no hay ninguna." : `Las últimas ${ventas.length}, de la más nueva a la más vieja.`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        {/* El total facturado es una cifra de gestion del negocio: se reserva a quien ve margenes. */}
        {verMargenes ? <Tarjeta titulo="Facturado" valor={fmtMoneda(facturado)} /> : null}
        <Tarjeta
          titulo="Sin cobrar"
          valor={fmtMoneda(pendiente)}
          tono={pendiente.cmp(0) > 0 ? "aviso" : "ok"}
          detalle={pendiente.cmp(0) > 0 ? undefined : "todo cobrado"}
        />
      </div>

      {ventas.length === 0 ? (
        <Vacio
          mensaje="Ni una venta todavía. Buen momento para la primera."
          hint="Cargala y acá vas a ver cuánto cobraste y cuánto te dejó."
          accion={puede(usuario, "cargarVenta") ? <Boton href="/ventas/nueva">Cargar una venta</Boton> : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {ventas.map((v) => (
            <li key={v.id} className="tarjeta p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-semibold text-ink">
                    {conDetalle ? (
                      <Link href={`/ventas/${v.id}`} className="enlace inline-flex min-h-11 items-center font-mono text-mono">
                        #{v.numero}/{v.anio}
                      </Link>
                    ) : (
                      <span className="font-mono text-mono text-ink-muted">
                        #{v.numero}/{v.anio}
                      </span>
                    )}{" "}
                    · {v.clienteNombre}
                  </p>
                  <p className="text-body-sm text-ink-muted">
                    {fmtFecha(v.fecha)} · {fmtNumero(v.items)} {v.items === 1 ? "ítem" : "ítems"}
                  </p>
                </div>
                <Etiqueta tono={TONO_ESTADO_PAGO[v.estadoPago]} className="shrink-0">
                  {ETIQUETA_ESTADO_PAGO[v.estadoPago]}
                </Etiqueta>
              </div>

              <dl className={`mt-3 grid gap-x-4 gap-y-2 ${tieneGanancia(v) ? "grid-cols-3" : "grid-cols-2"}`}>
                <div>
                  <dt className="eyebrow">Total</dt>
                  <dd className="monto-fila text-ink">{fmtMoneda(v.totalBruto)}</dd>
                </div>
                {tieneGanancia(v) ? (
                  <div>
                    <dt className="eyebrow">Ganancia</dt>
                    <dd className="monto-fila text-ok-text">{fmtMoneda(v.ganancia)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="eyebrow">Saldo</dt>
                  <dd className={`monto-fila ${v.saldo.cmp(0) > 0 ? "text-aviso-text" : "text-ink-muted"}`}>
                    {v.saldo.cmp(0) > 0 ? fmtMoneda(v.saldo) : "al día"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
