import Link from "next/link";
import { getArticulosConMargen, getArticulosParaVender } from "@/lib/queries/catalogo";
import { getClientes } from "@/lib/queries/clientes";
import { NuevaVentaForm, type ArticuloConCostosDTO, type ArticuloDTO } from "@/components/nueva-venta-form";
import { Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { requierePermisoPagina, puedeTodo } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/**
 * Pantalla de carga de venta.
 *
 * MOCKUP: esta pantalla calcula costos, IVA y márgenes con el motor real
 * (`lib/costing.ts`). Con base de datos usa sus artículos y clientes; sin base
 * (o sin datos cargados) usa el juego de demostración, para que el flujo
 * completo se pueda mostrar siempre.
 *
 * Quien no puede ver costos y margenes (el empleado) recibe SOLO nombre, precio
 * e IVA de cada articulo: el servidor ni consulta recetas ni arma costos, asi no
 * viajan al navegador (ni como props ni en el payload de la pagina).
 */
export default async function NuevaVentaPage() {
  const usuario = await requierePermisoPagina("cargarVenta");
  const verCostos = puedeTodo(usuario, ["verCostos", "verMargenes"]);

  // Dos consultas distintas, no una con un filtro: la que no trae costos nunca los lee.
  const [conCostos, sinCostos, clientes] = await Promise.all([
    verCostos ? getArticulosConMargen() : null,
    verCostos ? null : getArticulosParaVender(),
    getClientes(),
  ]);

  const cantidadArticulos = (conCostos ?? sinCostos ?? []).length;
  const hayDatos = cantidadArticulos > 0 && clientes.length > 0;
  const esModoDemo = estadoDemo().activo || !hayDatos;

  const clientesDTO = clientes.map((c) => ({ id: c.id, nombre: c.nombre, cuit: c.cuit }));

  const base = (a: { id: string; nombre: string; descripcion: string | null; precioVenta: { toString(): string }; ivaPct: { toString(): string }; esServicio: boolean }): ArticuloDTO => ({
    id: a.id,
    nombre: a.nombre,
    descripcion: a.descripcion,
    precioVenta: a.precioVenta.toString(),
    ivaPct: a.ivaPct.toString(),
    esServicio: a.esServicio,
  });

  return (
    <>
      <Seccion
        titulo="Nueva venta"
        descripcion={verCostos ? "Costo, IVA y margen se calculan en vivo" : "Precio, IVA y total se calculan en vivo"}
        accion={
          <Link
            href="/ventas"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      {conCostos ? (
        <NuevaVentaForm
          verCostos
          articulos={conCostos.map(
            (a): ArticuloConCostosDTO => ({
              ...base(a),
              costoUnitario: a.receta.costoTotal.toString(),
              recetaConfiable: a.receta.confiable,
              receta: a.receta.componentes.map((c) => ({
                tipo: c.tipo,
                etiqueta: c.etiqueta,
                cantidad: c.cantidad.toString(),
                costoUnitario: c.costoUnitario.toString(),
                costoTotal: c.costoTotal.toString(),
              })),
            }),
          )}
          clientes={clientesDTO}
          esModoDemo={esModoDemo}
        />
      ) : (
        <NuevaVentaForm verCostos={false} articulos={(sinCostos ?? []).map(base)} clientes={clientesDTO} esModoDemo={esModoDemo} />
      )}
    </>
  );
}
