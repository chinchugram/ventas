"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarArticulo } from "@/app/catalogo/actions";
import {
  AvisoDemo,
  BloqueError,
  BotonEnviar,
  CampoDecimal,
  CampoNotas,
  CampoSelect,
  CampoTexto,
  useAccion,
  type Opcion,
} from "@/components/form";
import { SemaforoMargen } from "@/components/ui";
import { d, fmtMoneda, fmtNumero, fmtPorcentaje } from "@/lib/money";
import { precioParaMargen, type ComponenteCosteado, type TipoComponente } from "@/lib/costing";
import {
  ALICUOTAS_IVA,
  costearBorrador,
  margenBorrador,
  NOMBRE_TIPO,
  type CatalogoCostos,
  type LineaBorrador,
  type OpcionCosto,
} from "@/lib/recetas";

type Linea = LineaBorrador & { clave: number };

export type ArticuloInicial = {
  id: string;
  nombre: string;
  descripcion: string;
  precioVenta: string;
  ivaPct: string;
  esServicio: boolean;
  lineas: LineaBorrador[];
};

const OPCIONES_IVA: Opcion[] = ALICUOTAS_IVA.map((a) => ({ valor: a, etiqueta: `${a.replace(".", ",")}%` }));

const lineaVacia = (tipo: TipoComponente, clave: number): Linea => ({
  clave,
  tipo,
  materialId: "",
  maquinaId: "",
  cantidad: "",
  override: "",
  notas: "",
});

/** Lo que viene de la base con punto se muestra con coma, como se tipea en Argentina. */
const conComa = (v: string) => v.replace(".", ",");

/**
 * Alta y edicion de un articulo con su receta. El costo y el margen se
 * recalculan en cada tecla con el mismo motor que el listado del catalogo; al
 * guardar, el servidor valida y recalcula todo de nuevo.
 */
export function ArticuloForm({
  inicial,
  catalogo,
  costoHoraManoObra,
  margenObjetivo,
  ivaDefault,
  esModoDemo,
}: {
  inicial?: ArticuloInicial;
  catalogo: CatalogoCostos;
  costoHoraManoObra: string;
  margenObjetivo: string;
  ivaDefault: string;
  esModoDemo: boolean;
}) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(guardarArticulo);

  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? "");
  const [precioVenta, setPrecioVenta] = useState(inicial ? conComa(inicial.precioVenta) : "");
  const [ivaPct, setIvaPct] = useState<string>(() => {
    const iva = inicial?.ivaPct ?? ivaDefault;
    return ALICUOTAS_IVA.find((a) => d(a).eq(d(iva))) ?? "21";
  });
  const [esServicio, setEsServicio] = useState(inicial?.esServicio ?? false);
  const [lineas, setLineas] = useState<Linea[]>(
    () =>
      inicial?.lineas.map((l, i) => ({
        ...l,
        clave: i + 1,
        cantidad: conComa(l.cantidad),
        override: conComa(l.override),
      })) ?? [],
  );
  const [siguiente, setSiguiente] = useState((inicial?.lineas.length ?? 0) + 1);

  const agregar = (tipo: TipoComponente) => {
    setLineas((ls) => [...ls, lineaVacia(tipo, siguiente)]);
    setSiguiente((n) => n + 1);
  };
  const cambiar = (clave: number, cambios: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));
  const quitar = (clave: number) => setLineas((ls) => ls.filter((l) => l.clave !== clave));

  // ─── Calculo en vivo ──────────────────────────────────────────────────────
  const costoHora = d(costoHoraManoObra);
  const meta = d(margenObjetivo);
  const receta = costearBorrador(lineas, catalogo, costoHora);
  const margen = margenBorrador(precioVenta, ivaPct, receta);
  const sugerido = precioParaMargen(receta.costoTotal, meta);
  // `costearBorrador` numera los componentes con el indice de la linea.
  const costeoDe = new Map(receta.componentes.map((c) => [c.id, c]));
  const hayMateriales = lineas.some((l) => l.tipo === "MATERIAL");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar(
          {
            id: inicial?.id,
            nombre,
            descripcion,
            precioVenta,
            ivaPct,
            esServicio,
            lineas: lineas.map(({ clave: _clave, ...l }) => l),
          },
          () => router.push("/catalogo"),
        );
      }}
      className="space-y-4"
    >
      <AvisoDemo visible={esModoDemo} que="el artículo y su receta" />

      <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <legend className="sr-only">Datos del artículo</legend>
        <CampoTexto etiqueta="Nombre" valor={nombre} alCambiar={setNombre} maxLength={120} required />
        <CampoNotas
          etiqueta="Descripción (opcional)"
          valor={descripcion}
          alCambiar={setDescripcion}
          filas={2}
          maxLength={500}
        />
        <div className="grid grid-cols-2 gap-3">
          <CampoDecimal
            etiqueta="Precio de venta ($)"
            ayuda="Final, con IVA"
            valor={precioVenta}
            alCambiar={setPrecioVenta}
            required
          />
          <CampoSelect etiqueta="IVA" valor={ivaPct} alCambiar={setIvaPct} opciones={OPCIONES_IVA} />
        </div>
        {/* Casilla propia en vez de `CampoCheckbox`: los estilos globales de
            `input` y `label` (fuera de @layer) le pisan el flex y el tamaño. */}
        <label
          style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}
          className="rounded-xl border border-slate-200 p-4 font-normal"
        >
          <input
            type="checkbox"
            checked={esServicio}
            onChange={(e) => setEsServicio(e.target.checked)}
            style={{ width: "1.25rem", height: "1.25rem", flexShrink: 0, marginTop: "0.125rem", padding: 0 }}
          />
          <span>
            Es un servicio
            <span className="block text-slate-500">
              No descuenta stock al venderse. Puede tener horas de máquina y mano de obra.
            </span>
          </span>
        </label>
      </fieldset>

      <section aria-labelledby="titulo-receta" className="space-y-2">
        <div>
          <h2 id="titulo-receta" className="text-base font-semibold text-slate-900">
            Receta
          </h2>
          <p className="text-sm text-slate-500">
            Lo que consume una unidad: materiales, horas de máquina y horas de mano de obra.
          </p>
        </div>

        {lineas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
            Sin receta: el costo queda en $0 y el margen no se puede calcular. Agregá al menos una línea.
          </p>
        ) : (
          <ul className="space-y-2">
            {lineas.map((l, i) => (
              <LineaReceta
                key={l.clave}
                numero={i + 1}
                linea={l}
                catalogo={catalogo}
                costoHoraManoObra={costoHoraManoObra}
                costeo={costeoDe.get(String(i))}
                alCambiar={(cambios) => cambiar(l.clave, cambios)}
                alQuitar={() => quitar(l.clave)}
              />
            ))}
          </ul>
        )}

        <div className="grid grid-cols-3 gap-2">
          {(["MATERIAL", "MAQUINA", "MANO_OBRA"] as const).map((tipo) => (
            <button
              key={tipo}
              type="button"
              onClick={() => agregar(tipo)}
              className="rounded-lg border border-dashed border-slate-300 bg-white px-2 py-3 text-sm font-medium text-slate-700"
            >
              + {NOMBRE_TIPO[tipo]}
            </button>
          ))}
        </div>

        {esServicio && hayMateriales ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Es un servicio: los materiales suman al costo pero no se descuentan del stock al vender.
          </p>
        ) : null}
      </section>

      <section aria-label="Costo y margen" className="rounded-xl border border-slate-200 bg-white p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Fila etiqueta="Materiales" valor={fmtMoneda(receta.costoMateriales)} />
          <Fila etiqueta="Máquinas" valor={fmtMoneda(receta.costoMaquinas)} />
          <Fila etiqueta="Mano de obra" valor={fmtMoneda(receta.costoManoObra)} />
          <Fila etiqueta="Precio sin IVA" valor={fmtMoneda(margen.precioNeto)} />
          <Fila etiqueta="Ganancia" valor={fmtMoneda(margen.ganancia)} />
          <Fila
            etiqueta={`Precio para ${fmtPorcentaje(meta)}`}
            valor={receta.confiable ? fmtMoneda(sugerido) : "-"}
          />
        </dl>
        {receta.advertencias.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {receta.advertencias.map((a) => (
              <li key={a} className="text-sm text-amber-700">
                {a}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <BloqueError mensaje={error} />

      <div className="sticky bottom-20 z-10 space-y-3 rounded-xl bg-tinta p-4 text-white md:bottom-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-300 uppercase">Costo</p>
            <p className="text-xl font-semibold tabular-nums" data-prueba="costo-total">
              {fmtMoneda(receta.costoTotal)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-300 uppercase">Margen</p>
            <div className="mt-1" data-prueba="margen">
              {receta.confiable ? (
                <SemaforoMargen margenPct={margen.margenPct} metaPct={meta} />
              ) : (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  sin receta
                </span>
              )}
            </div>
          </div>
        </div>
        <BotonEnviar
          pendiente={pendiente}
          variante="marca"
          texto={inicial ? "Guardar cambios" : "Crear artículo"}
        />
      </div>
    </form>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{etiqueta}</dt>
      <dd className="font-semibold tabular-nums text-slate-900">{valor}</dd>
    </div>
  );
}

function opcionesDe(lista: OpcionCosto[], elegido: string, sufijoCosto: (o: OpcionCosto) => string): Opcion[] {
  // Los de baja solo aparecen si ya estaban elegidos, y no se pueden volver a elegir.
  return lista
    .filter((o) => o.activo || o.id === elegido)
    .map((o) => ({
      valor: o.id,
      etiqueta: o.activo ? `${o.nombre} · ${sufijoCosto(o)}` : `${o.nombre} (de baja)`,
      deshabilitada: !o.activo,
    }));
}

function LineaReceta({
  numero,
  linea: l,
  catalogo,
  costoHoraManoObra,
  costeo,
  alCambiar,
  alQuitar,
}: {
  numero: number;
  linea: Linea;
  catalogo: CatalogoCostos;
  costoHoraManoObra: string;
  /** Costo de la linea; ausente si todavia no tiene material o maquina elegidos. */
  costeo: ComponenteCosteado | undefined;
  alCambiar: (cambios: Partial<Linea>) => void;
  alQuitar: () => void;
}) {
  const material = catalogo.materiales.find((m) => m.id === l.materialId);
  const maquina = catalogo.maquinas.find((m) => m.id === l.maquinaId);
  const elegido = l.tipo === "MATERIAL" ? material : l.tipo === "MAQUINA" ? maquina : undefined;
  const unidad = l.tipo === "MATERIAL" ? (material?.unidad ?? "") : "h";
  const vigente = l.tipo === "MANO_OBRA" ? costoHoraManoObra : elegido?.costo;
  const porUnidad = unidad ? `/${unidad}` : "";

  return (
    <li className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" data-prueba={`linea-${numero}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          {numero}. {NOMBRE_TIPO[l.tipo]}
        </p>
        <button
          type="button"
          onClick={alQuitar}
          className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm text-slate-600"
          aria-label={`Quitar línea ${numero}`}
        >
          Quitar
        </button>
      </div>

      {l.tipo === "MATERIAL" ? (
        <CampoSelect
          etiqueta="Material"
          valor={l.materialId}
          alCambiar={(materialId) => alCambiar({ materialId })}
          opciones={opcionesDe(catalogo.materiales, l.materialId, (o) => `${fmtMoneda(o.costo)}/${o.unidad}`)}
          placeholder="Elegí un material…"
          required
          error={material && !material.activo ? "Dado de baja: elegí otro o quitá la línea." : null}
        />
      ) : null}
      {l.tipo === "MAQUINA" ? (
        <CampoSelect
          etiqueta="Máquina"
          valor={l.maquinaId}
          alCambiar={(maquinaId) => alCambiar({ maquinaId })}
          opciones={opcionesDe(catalogo.maquinas, l.maquinaId, (o) => `${fmtMoneda(o.costo)}/h`)}
          placeholder="Elegí una máquina…"
          required
          error={maquina && !maquina.activo ? "Dada de baja: elegí otra o quitá la línea." : null}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <CampoDecimal
          etiqueta={l.tipo === "MATERIAL" ? "Cantidad" : "Horas"}
          sufijo={unidad || undefined}
          valor={l.cantidad}
          alCambiar={(cantidad) => alCambiar({ cantidad })}
          required
        />
        <CampoDecimal
          etiqueta="Costo fijado ($)"
          valor={l.override}
          alCambiar={(override) => alCambiar({ override })}
          placeholder="opcional"
          ayuda={vigente !== undefined ? `Vacío = vigente ${fmtMoneda(vigente)}${porUnidad}` : "Vacío = costo vigente"}
        />
      </div>

      <CampoTexto
        etiqueta="Nota (opcional)"
        valor={l.notas}
        alCambiar={(notas) => alCambiar({ notas })}
        maxLength={200}
        placeholder={l.tipo === "MATERIAL" ? "Ej.: incluye 10% de merma" : undefined}
      />

      <p className="text-sm text-slate-600 tabular-nums" data-prueba={`costo-linea-${numero}`}>
        {costeo ? (
          <>
            {fmtNumero(costeo.cantidad)}
            {unidad ? ` ${unidad}` : ""} × {fmtMoneda(costeo.costoUnitario)}
            {costeo.costoUnitarioOverride ? " (fijado)" : ""} ={" "}
            <span className="font-semibold text-slate-900">{fmtMoneda(costeo.costoTotal)}</span>
          </>
        ) : (
          <span className="text-slate-500">
            Elegí {l.tipo === "MATERIAL" ? "un material" : "una máquina"} para ver el costo.
          </span>
        )}
      </p>
    </li>
  );
}
