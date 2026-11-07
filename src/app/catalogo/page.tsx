import Link from "next/link";
import { fmtMoneda, fmtNumero } from "@/lib/money";
import { configNumero, getArticulosConMargen, getConfig } from "@/lib/queries/catalogo";
import { getArticulosDeBaja } from "@/lib/queries/recetas";
import { precioParaMargen } from "@/lib/costing";
import { Aviso, Boton, Dato, Etiqueta, Plegable, Seccion, SemaforoMargen, Vacio } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/**
 * Catalogo con costo y margen.
 */
export default async function CatalogoPage() {
  await requierePermisoPagina("verCostos", "verMargenes");
  const [articulos, config, deBaja] = await Promise.all([
    getArticulosConMargen(),
    getConfig(),
    getArticulosDeBaja(),
  ]);

  const metaMargenPct = configNumero(config, "margenObjetivo", "40");

  if (articulos.length === 0) {
    return (
      <>
        <Seccion epigrafe="Lo que vendés" titulo="Artículos" accion={<BotonNuevo />} />
        <Vacio
          mensaje="Ni un artículo a la vista. Buen momento para el primero."
          hint="Empezá por los materiales: un sticker o un cartel se costean a partir de ellos."
        />
        <ListaDeBaja articulos={deBaja} />
      </>
    );
  }

  return (
    <>
      <Seccion
        epigrafe="Lo que vendés"
        titulo="Artículos"
        descripcion="Costo por receta, precio de venta y margen real"
        accion={<BotonNuevo />}
      />

      <ul className="space-y-2">
        {articulos.map((a) => {
          const sugerido = precioParaMargen(a.receta.costoTotal, metaMargenPct);
          const bajoMeta = a.margen.margenPct.cmp(metaMargenPct) < 0;

          return (
            <li key={a.id} className="tarjeta p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/catalogo/${a.id}`}
                    className="inline-flex min-h-11 items-center text-body font-semibold text-ink hover:underline"
                  >
                    {a.nombre}
                  </Link>
                  {a.esServicio ? (
                    <Etiqueta className="ml-2 align-middle">servicio</Etiqueta>
                  ) : null}
                  {a.descripcion ? <p className="text-body-sm text-ink-muted">{a.descripcion}</p> : null}
                </div>
                {a.receta.confiable ? (
                  <SemaforoMargen margenPct={a.margen.margenPct} metaPct={metaMargenPct} />
                ) : (
                  <Etiqueta tono="aviso" className="shrink-0">
                    sin receta
                  </Etiqueta>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Dato etiqueta="Costo">{fmtMoneda(a.receta.costoTotal)}</Dato>
                <Dato etiqueta="Vende">{fmtMoneda(a.margen.precioBruto)}</Dato>
                <Dato etiqueta="Ganancia" tono={a.margen.ganancia.cmp(0) >= 0 ? "ok" : "neutro"}>
                  {fmtMoneda(a.margen.ganancia)}
                </Dato>
                <Dato
                  etiqueta="Para meta"
                  tono={a.receta.confiable && bajoMeta ? "aviso" : "neutro"}
                >
                  {a.receta.confiable ? fmtMoneda(sugerido) : "-"}
                </Dato>
              </dl>

              {a.receta.confiable ? (
                <details className="mt-2">
                  <summary className="enlace inline-flex min-h-11 cursor-pointer items-center">
                    Ver receta ({a.receta.componentes.length}{" "}
                    {a.receta.componentes.length === 1 ? "componente" : "componentes"})
                  </summary>
                  <ul className="mt-1 space-y-1 border-l-(length:--border-width) border-line pl-3">
                    {a.receta.componentes.map((c) => (
                      <li key={c.id} className="text-body-sm text-ink-muted tabular-nums">
                        <span className="text-ink">{c.etiqueta}</span>: {fmtNumero(c.cantidad)} × {fmtMoneda(c.costoUnitario)}
                        {c.costoUnitarioOverride ? " (fijado)" : ""} ={" "}
                        <span className="font-semibold text-ink">{fmtMoneda(c.costoTotal)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <Aviso tono="aviso" titulo="Sin receta: no tomes decisiones con este número." className="mt-3">
                  El costo real es desconocido y el margen que se muestra es optimista.
                </Aviso>
              )}

              {a.receta.advertencias.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {a.receta.advertencias.map((adv) => (
                    <li key={adv} className="text-body-sm text-aviso-text">
                      {adv}
                    </li>
                  ))}
                </ul>
              )}

              <Boton href={`/catalogo/${a.id}`} variante="secundario" ancho className="mt-3">
                {a.receta.confiable ? "Editar artículo y receta" : "Cargar receta"}
              </Boton>
            </li>
          );
        })}
      </ul>

      <ListaDeBaja articulos={deBaja} />
    </>
  );
}

function BotonNuevo() {
  return <Boton href="/catalogo/nuevo">Nuevo artículo</Boton>;
}

/** Los dados de baja quedan al final, plegados: se abren solo para reactivarlos. */
function ListaDeBaja({ articulos }: { articulos: { id: string; nombre: string }[] }) {
  if (articulos.length === 0) return null;
  return (
    <Plegable titulo={`Dados de baja (${articulos.length})`} className="mt-6">
      <ul className="divide-y-(length:--border-width) divide-line">
        {articulos.map((a) => (
          <li key={a.id}>
            <Link href={`/catalogo/${a.id}`} className="flex min-h-11 items-center px-4 text-body text-ink-muted hover:underline">
              {a.nombre}
            </Link>
          </li>
        ))}
      </ul>
    </Plegable>
  );
}
