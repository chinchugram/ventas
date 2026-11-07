"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cargarTrabajo } from "@/app/produccion/actions";
import { BloqueError, BotonEnviar, CampoCheckbox, CampoDecimal, CampoNotas, CampoSelect, CampoTexto, useAccion } from "@/components/form";
import { Aviso, Boton, Panel } from "@/components/ui";
import { decimalOCero } from "@/lib/acciones";
import { fmtNumero } from "@/lib/money";
import { calcularAjusteDeStock, fmtMinutos } from "@/lib/produccion";
import type { LineaParaCarga } from "@/lib/queries/produccion";

// Carga del trabajo de una linea, pensada para el celular en el taller: teclado
// numerico, una fila por maquina y por material, precargada con la receta. Aca no
// hay ningun costo: ni llegan al navegador ni se calculan.

type Props = {
  ventaItemId: string;
  hoyISO: string;
  maquinas: LineaParaCarga["maquinas"];
  /** `unidad` ya viene con la etiqueta para mostrar ("m2", "kg"…). */
  materiales: LineaParaCarga["materiales"];
  sugerencia: LineaParaCarga["sugerencia"];
  recetaEnStock: LineaParaCarga["recetaEnStock"];
  yaAjustado: LineaParaCarga["yaAjustado"];
  /** Solo el dueño (`ajustarStock`): sin esto la opción ni se muestra. */
  puedeAjustarStock: boolean;
};

type FilaMaquina = { maquinaId: string; minutos: string };
type FilaMaterial = { materialId: string; cantidad: string };

/** "1.5" → "1,5": como se tipea en Argentina. */
const aEditable = (v: string) => v.replace(".", ",");

export function CargarTrabajoForm(p: Props) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cargarTrabajo);

  const [fecha, setFecha] = useState(p.hoyISO);
  const [maquinas, setMaquinas] = useState<FilaMaquina[]>(() =>
    p.sugerencia.maquinas.map((m) => ({ maquinaId: m.maquinaId, minutos: aEditable(m.minutos) })),
  );
  const [manoObra, setManoObra] = useState(() => (p.sugerencia.minutosManoObra === "0" ? "" : aEditable(p.sugerencia.minutosManoObra)));
  const [materiales, setMateriales] = useState<FilaMaterial[]>(() =>
    p.sugerencia.materiales.map((m) => ({ materialId: m.materialId, cantidad: aEditable(m.cantidad) })),
  );
  const [notas, setNotas] = useState("");
  const [ajustar, setAjustar] = useState(false);

  const maquinaPorId = useMemo(() => new Map(p.maquinas.map((m) => [m.id, m])), [p.maquinas]);
  const materialPorId = useMemo(() => new Map(p.materiales.map((m) => [m.id, m])), [p.materiales]);
  const sugMaquina = useMemo(() => new Map(p.sugerencia.maquinas.map((m) => [m.maquinaId, m.minutos])), [p.sugerencia.maquinas]);
  const recetaMaterial = useMemo(() => new Map(p.sugerencia.materiales.map((m) => [m.materialId, m.cantidad])), [p.sugerencia.materiales]);

  const maquinasLibres = p.maquinas.filter((m) => !maquinas.some((f) => f.maquinaId === m.id));
  const materialesLibres = p.materiales.filter((m) => !materiales.some((f) => f.materialId === m.id));

  // Diferencia contra la receta en vivo (misma cuenta que hace el servidor).
  const ajuste = useMemo(
    () =>
      calcularAjusteDeStock({
        receta: p.recetaEnStock.map((r) => ({ materialId: r.materialId, cantidad: decimalOCero(r.cantidad) })),
        real: materiales.map((m) => ({ materialId: m.materialId, cantidad: decimalOCero(m.cantidad) })),
        yaAjustado: p.yaAjustado.map((r) => ({ materialId: r.materialId, cantidad: decimalOCero(r.cantidad) })),
      }).filter((f) => !f.movimiento.isZero()),
    [p.recetaEnStock, p.yaAjustado, materiales],
  );

  const volverALaReceta = () => {
    setMaquinas(p.sugerencia.maquinas.map((m) => ({ maquinaId: m.maquinaId, minutos: aEditable(m.minutos) })));
    setManoObra(p.sugerencia.minutosManoObra === "0" ? "" : aEditable(p.sugerencia.minutosManoObra));
    setMateriales(p.sugerencia.materiales.map((m) => ({ materialId: m.materialId, cantidad: aEditable(m.cantidad) })));
  };

  return (
    <form
      aria-label="Cargar trabajo"
      onSubmit={(e) => {
        e.preventDefault();
        enviar(
          {
            ventaItemId: p.ventaItemId,
            fecha,
            minutosManoObra: manoObra,
            tiempos: maquinas,
            consumos: materiales,
            notas,
            ajustarStock: p.puedeAjustarStock && ajustar,
          },
          (r) => router.push(`/produccion/trabajo/${r.id}`),
        );
      }}
      className="space-y-4"
    >
      <Panel compacto className="space-y-3 bg-surface-sunken">
        <p className="text-body-sm text-ink">
          Cargá lo que realmente se usó. Los valores vienen precargados con la receta: corregilos con lo medido.
        </p>
        <Boton variante="secundario" onClick={volverALaReceta}>
          Volver a los valores de la receta
        </Boton>
      </Panel>

      <CampoTexto etiqueta="Fecha del trabajo" tipo="date" valor={fecha} alCambiar={setFecha} max={p.hoyISO} required />

      <fieldset className="tarjeta min-w-0 space-y-3 p-4">
        <legend className="px-1 font-display text-body-lg font-bold text-ink">Máquinas (minutos)</legend>
        {maquinas.length === 0 ? <p className="text-body-sm text-ink-muted">Sin máquinas todavía. Agregá las que se usaron.</p> : null}
        {maquinas.map((f, i) => {
          const sug = sugMaquina.get(f.maquinaId);
          return (
            <div key={f.maquinaId} className="flex items-end gap-2">
              <CampoDecimal
                className="min-w-0 flex-1"
                etiqueta={maquinaPorId.get(f.maquinaId)?.nombre ?? "Máquina"}
                sufijo="min"
                valor={f.minutos}
                alCambiar={(v) => setMaquinas(maquinas.map((x, j) => (j === i ? { ...x, minutos: v } : x)))}
                ayuda={sug !== undefined ? `Receta: ${fmtMinutos(sug)}` : "No está en la receta"}
              />
              <Boton
                variante="fantasma-peligro"
                onClick={() => setMaquinas(maquinas.filter((_, j) => j !== i))}
                aria-label={`Quitar ${maquinaPorId.get(f.maquinaId)?.nombre ?? "máquina"}`}
                className="mb-5 shrink-0 px-3"
              >
                Quitar
              </Boton>
            </div>
          );
        })}
        {maquinasLibres.length > 0 ? (
          <CampoSelect
            etiqueta="Agregar máquina"
            valor=""
            alCambiar={(id) => id && setMaquinas([...maquinas, { maquinaId: id, minutos: "" }])}
            opciones={maquinasLibres.map((m) => ({ valor: m.id, etiqueta: m.nombre }))}
            placeholder="Elegí una máquina…"
          />
        ) : null}
      </fieldset>

      <fieldset className="tarjeta min-w-0 space-y-3 p-4">
        <legend className="px-1 font-display text-body-lg font-bold text-ink">Mano de obra</legend>
        <CampoDecimal
          etiqueta="Minutos de mano de obra"
          sufijo="min"
          valor={manoObra}
          alCambiar={setManoObra}
          ayuda={
            p.sugerencia.minutosManoObra === "0" ? "La receta no trae mano de obra." : `Receta: ${fmtMinutos(p.sugerencia.minutosManoObra)}`
          }
        />
      </fieldset>

      <fieldset className="tarjeta min-w-0 space-y-3 p-4">
        <legend className="px-1 font-display text-body-lg font-bold text-ink">Materiales usados</legend>
        {materiales.length === 0 ? <p className="text-body-sm text-ink-muted">Sin materiales todavía. Agregá los que se usaron.</p> : null}
        {materiales.map((f, i) => {
          const m = materialPorId.get(f.materialId);
          const sug = recetaMaterial.get(f.materialId);
          return (
            <div key={f.materialId} className="flex items-end gap-2">
              <CampoDecimal
                className="min-w-0 flex-1"
                etiqueta={m?.nombre ?? "Material"}
                sufijo={m?.unidad}
                valor={f.cantidad}
                alCambiar={(v) => setMateriales(materiales.map((x, j) => (j === i ? { ...x, cantidad: v } : x)))}
                ayuda={sug !== undefined ? `Receta: ${fmtNumero(sug)} ${m?.unidad ?? ""}` : "No está en la receta"}
              />
              <Boton
                variante="fantasma-peligro"
                onClick={() => setMateriales(materiales.filter((_, j) => j !== i))}
                aria-label={`Quitar ${m?.nombre ?? "material"}`}
                className="mb-5 shrink-0 px-3"
              >
                Quitar
              </Boton>
            </div>
          );
        })}
        {materialesLibres.length > 0 ? (
          <CampoSelect
            etiqueta="Agregar material"
            valor=""
            alCambiar={(id) => id && setMateriales([...materiales, { materialId: id, cantidad: "" }])}
            opciones={materialesLibres.map((m) => ({ valor: m.id, etiqueta: `${m.nombre} (${m.unidad})` }))}
            placeholder="Elegí un material…"
          />
        ) : null}
      </fieldset>

      <CampoNotas etiqueta="Notas (opcional)" valor={notas} alCambiar={setNotas} filas={2} maxLength={500} placeholder="Merma, rehacer una pieza, algo a recordar…" />

      {p.puedeAjustarStock ? (
        <div className="space-y-2">
          <CampoCheckbox
            marcado={ajustar}
            alCambiar={setAjustar}
            etiqueta="Ajustar el stock por la diferencia contra la receta"
            ayuda="Opcional. Cargar el consumo NO mueve el stock por sí solo: la venta ya descontó lo de la receta. Marcá esto para sumar o restar la diferencia (real − receta)."
          />
          {ajustar ? (
            ajuste.length === 0 ? (
              <Aviso tono="info">Con estos valores no hay diferencia que ajustar.</Aviso>
            ) : (
              <Aviso tono="aviso" titulo="Ajuste de stock previsto">
                <ul aria-label="Ajuste de stock previsto">
                  {ajuste.map((f) => {
                    const m = materialPorId.get(f.materialId);
                    return (
                      <li key={f.materialId}>
                        {m?.nombre ?? "Material"}: el stock {f.movimiento.lt(0) ? "baja" : "sube"} {fmtNumero(f.movimiento.abs())} {m?.unidad}
                      </li>
                    );
                  })}
                </ul>
              </Aviso>
            )
          ) : null}
        </div>
      ) : null}

      <BloqueError mensaje={error} />
      <BotonEnviar pendiente={pendiente} texto={ajustar ? "Guardar y ajustar stock" : "Guardar trabajo"} />
    </form>
  );
}
