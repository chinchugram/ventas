import { Aviso, Seccion } from "@/components/ui";
import { MAX_LINEAS } from "@/lib/estimacion-tiempos";
import { requierePermisoPagina } from "@/lib/permisos";
import { estimarTiempos, getArticulosParaEstimar } from "@/lib/queries/estimacion-tiempos";
import { estadoDemo } from "@/lib/respaldo";
import { EstimadorForm } from "./_componentes/estimador-form";
import { ResultadoEstimacion } from "./_componentes/resultado-estimacion";

// Estimar horas de maquina y de mano de obra de un pedido, con lo que tardaron los
// trabajos anteriores del mismo articulo (ola 6, 6.3). Pantalla propia, de solo
// lectura y sin costos: la pueden usar el dueño y el empleado (`cargarProduccion`).
// El pedido viaja en la URL (`?l=<articulo>~<cantidad>`), asi se recarga o se comparte.

export const dynamic = "force-dynamic";

type Params = { l?: string | string[] };

/** `?l=<id>~<cantidad>` (repetido) → lineas en texto crudo; la validacion es de `validarPedido`. */
function lineasDeLaUrl(params: Params) {
  const crudas = params.l === undefined ? [] : Array.isArray(params.l) ? params.l : [params.l];
  return crudas.slice(0, MAX_LINEAS + 1).map((texto) => {
    const corte = texto.indexOf("~");
    return corte < 0
      ? { articuloId: texto.trim(), cantidad: "" }
      : { articuloId: texto.slice(0, corte).trim(), cantidad: texto.slice(corte + 1) };
  });
}

export default async function EstimarTiemposPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requierePermisoPagina("cargarProduccion");
  const articulos = await getArticulosParaEstimar();
  const lineas = lineasDeLaUrl(await searchParams);

  return (
    <>
      <Seccion
        epigrafe="Producción"
        titulo="Estimar tiempos"
        descripcion="Cuántas horas de máquina y de mano de obra lleva un pedido, según trabajos anteriores."
      />

      {estadoDemo().activo ? (
        <Aviso tono="aviso" role="status" titulo="Modo demostración.">
          No hay base de datos conectada, así que no hay trabajos anteriores con los que estimar. Conectá la base para usar esta pantalla.
        </Aviso>
      ) : articulos.length === 0 ? (
        <Aviso tono="aviso" role="status" titulo="Todavía no hay con qué estimar.">
          Para estimar hace falta al menos un artículo activo en el catálogo.
        </Aviso>
      ) : (
        <div className="space-y-6 pb-8">
          <EstimadorForm articulos={articulos} inicial={lineas} />
          {lineas.length > 0 ? <Resultado lineas={lineas} /> : null}
        </div>
      )}
    </>
  );
}

async function Resultado({ lineas }: { lineas: { articuloId: string; cantidad: string }[] }) {
  const r = await estimarTiempos(lineas);
  if (!r.ok) {
    return (
      <Aviso tono="critico" role="alert" titulo="No se pudo estimar.">
        <ul className="list-disc pl-5">
          {r.errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Aviso>
    );
  }
  return <ResultadoEstimacion lineas={r.lineas} total={r.total} criterio={r.criterio} />;
}
