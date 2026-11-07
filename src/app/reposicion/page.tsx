import Link from "next/link";
import { fmtMoneda, fmtMonedaCorta, fmtNumero } from "@/lib/money";
import { urlNuevaCompra } from "@/lib/reposicion";
import {
  DIAS_CONSUMO,
  getReposicion,
  getReposicionSinCostos,
  type LineaReposicionSinCostos,
  type MaterialReposicion,
} from "@/lib/queries/reposicion";
import type { LineaReposicion } from "@/lib/reposicion";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { estadoDemo } from "@/lib/respaldo";
import { BarraInferior, Boton, Dato, Etiqueta, Seccion, Tarjeta, Vacio } from "@/components/ui";
import { FactorForm } from "./_componentes/factor-form";

export const dynamic = "force-dynamic";

/** La linea trae costo por unidad y costo estimado (solo las arma `getReposicion`). */
function conCostos(l: LineaReposicionSinCostos): l is LineaReposicion<MaterialReposicion> {
  return "costoEstimado" in l;
}

export default async function ReposicionPage() {
  const usuario = await requierePermisoPagina("verReposicion");
  // Costos y compra sugerida solo para quien los ve y puede comprar; los demas, cantidades.
  const verCostos = puede(usuario, "verCostos");
  const puedeComprar = puede(usuario, "registrarCompra");
  const puedeConfigurar = puede(usuario, "configuracion");
  const esModoDemo = estadoDemo().activo;

  const completa = verCostos ? await getReposicion() : null;
  const reducida = completa ? null : await getReposicionSinCostos();
  const lineas: LineaReposicionSinCostos[] = completa?.lineas ?? reducida?.lineas ?? [];
  const total = completa?.total ?? null;
  const factor = (completa ?? reducida)!.factor;
  const conMinimo = (completa ?? reducida)!.conMinimo;

  const hayBarra = total !== null && puedeComprar && lineas.length > 0;

  return (
    <div className={hayBarra ? "pb-28" : undefined}>
      <Seccion
        epigrafe="Qué falta comprar"
        titulo="Reposición"
        descripcion={verCostos ? "Materiales bajo el mínimo: cuánto comprar y cuánto va a salir" : "Materiales bajo el mínimo y cuánto falta comprar"}
        accion={
          <Boton href="/materiales" variante="secundario">
            Materiales
          </Boton>
        }
      />

      {puedeConfigurar ? (
        <div className="mb-4">
          <FactorForm inicial={factor.toString()} esModoDemo={esModoDemo} />
        </div>
      ) : null}

      {lineas.length === 0 ? (
        <Vacio
          mensaje="Nada para reponer."
          hint={
            conMinimo === 0
              ? "Ningún material tiene stock mínimo cargado. Cargalo al editar cada material para recibir sugerencias."
              : "Todos los materiales con mínimo cargado están en el mínimo o por encima. Buen momento para un mate."
          }
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Tarjeta titulo="A reponer" valor={fmtNumero(lineas.length)} tono="aviso" detalle={lineas.length === 1 ? "material" : "materiales"} />
            {total ? <Tarjeta titulo="Compra estimada" valor={fmtMonedaCorta(total)} detalle="a costo actual" /> : null}
          </div>

          <ul className="space-y-2">
            {lineas.map((l) => (
              <LineaTarjeta key={l.id} linea={l} />
            ))}
          </ul>

          {total && puedeComprar ? (
            <>
              <p className="mt-3 text-center text-body-sm text-ink-muted">
                Armar compra abre Nueva compra con estas cantidades y el costo actual; podés cambiarlas antes de guardar.
              </p>
              <BarraInferior>
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">Compra sugerida</p>
                  <p className="monto leading-tight text-ink">{fmtMoneda(total)}</p>
                </div>
                <Boton href={urlNuevaCompra(lineas)} className="shrink-0">
                  Armar compra
                </Boton>
              </BarraInferior>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function LineaTarjeta({ linea: l }: { linea: LineaReposicionSinCostos }) {
  const agotado = l.stockActual.lte(0);
  return (
    <li className="tarjeta p-4">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/materiales/${l.id}`}
          className="inline-flex min-h-11 min-w-0 items-center text-body font-semibold text-ink hover:underline"
        >
          {l.nombre}
        </Link>
        <Etiqueta tono={agotado ? "critico" : "aviso"} className="shrink-0">
          {agotado ? "Sin stock" : "Bajo mínimo"}
        </Etiqueta>
      </div>

      <p className="mt-1 font-display text-body-lg font-bold text-ink tabular-nums">
        Comprar {fmtNumero(l.cantidad)} <span className="font-sans text-body font-normal text-ink-muted">{l.etiquetaUnidad}</span>
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Dato etiqueta="Stock / mínimo">
          {fmtNumero(l.stockActual)} / {fmtNumero(l.stockMinimo)}{" "}
          <span className="font-sans text-body-sm font-normal text-ink-muted">{l.etiquetaUnidad}</span>
        </Dato>
        <Dato etiqueta={`Vendido en ${DIAS_CONSUMO} días`} tono="apagado">
          {l.consumo.gt(0) ? `${fmtNumero(l.consumo)} ${l.etiquetaUnidad}` : "-"}
        </Dato>
        {conCostos(l) ? (
          <>
            <Dato etiqueta={`Costo por ${l.etiquetaUnidad}`}>{fmtMoneda(l.costoUnitario)}</Dato>
            <Dato etiqueta="Costo estimado">{fmtMoneda(l.costoEstimado)}</Dato>
          </>
        ) : null}
      </dl>
    </li>
  );
}
