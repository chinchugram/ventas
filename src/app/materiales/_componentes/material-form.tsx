"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AvisoDemo,
  BloqueError,
  BotonEnviar,
  CampoDecimal,
  CampoNotas,
  CampoSelect,
  CampoTexto,
  useAccion,
} from "@/components/form";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { UNIDADES, type ArticuloSerial } from "@/lib/materiales";
import { crearMaterial, editarMaterial } from "../actions";
import { ImpactoMargen } from "./impacto-margen";

const OPCIONES_UNIDAD = UNIDADES.map((u) => ({ valor: u, etiqueta: ETIQUETA_UNIDAD[u] ?? u }));

export type ValoresMaterial = {
  nombre: string;
  unidad: string;
  stockMinimo: string;
  costoUnitario: string;
  precioVenta: string;
  notas: string;
};

type Edicion = {
  id: string;
  /** Texto con el stock y su unidad, solo para mostrar. */
  stockActual: string;
  unidadBloqueada: boolean;
  articulos: ArticuloSerial[];
  costoHoraManoObra: string;
  margenObjetivoPct: string;
};

/**
 * Formulario de material. En el alta pide stock inicial; en la edicion el stock
 * se muestra pero no se edita (cambia por compras, ventas y ajustes) y, al
 * tipear un costo nuevo, se ve en vivo como cambia el margen de cada articulo.
 */
export function MaterialForm({
  iniciales,
  edicion,
  esModoDemo,
}: {
  iniciales: ValoresMaterial;
  edicion?: Edicion;
  esModoDemo: boolean;
}) {
  const router = useRouter();
  const alta = useAccion(crearMaterial);
  const cambio = useAccion(editarMaterial);
  const { pendiente, error } = edicion ? cambio : alta;

  const [v, setV] = useState(iniciales);
  const [stockInicial, setStockInicial] = useState("");
  const campo = (clave: keyof ValoresMaterial) => (valor: string) => setV((prev) => ({ ...prev, [clave]: valor }));
  const sufijoUnidad = ETIQUETA_UNIDAD[v.unidad] ?? "";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Minimo vacio = 0 (sin alerta).
        const datos = { ...v, stockMinimo: v.stockMinimo.trim() || "0" };
        if (edicion) {
          cambio.enviar({ ...datos, id: edicion.id, costoOriginal: iniciales.costoUnitario }, () => {
            router.push("/materiales");
            router.refresh();
          });
        } else {
          alta.enviar({ ...datos, stockInicial: stockInicial || "0" }, (r) => {
            router.push(`/materiales/${r.id}`);
            router.refresh();
          });
        }
      }}
      className="space-y-4"
    >
      <AvisoDemo visible={esModoDemo} />

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <CampoTexto
          etiqueta="Nombre"
          valor={v.nombre}
          alCambiar={campo("nombre")}
          placeholder="Vinilo adhesivo brillante"
          maxLength={120}
          required
        />
        <CampoSelect
          etiqueta="Unidad de medida"
          valor={v.unidad}
          alCambiar={campo("unidad")}
          opciones={OPCIONES_UNIDAD}
          placeholder="Elegí la unidad…"
          required
          disabled={edicion?.unidadBloqueada}
          ayuda={
            edicion?.unidadBloqueada
              ? "No se puede cambiar: ya tiene movimientos o está en recetas."
              : "En qué se compra y se consume: el costo y el stock van en esta unidad."
          }
        />
        <div className="grid grid-cols-2 gap-3">
          {edicion ? (
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Stock actual</p>
              <p className="py-2.5 font-semibold tabular-nums text-slate-900">{edicion.stockActual}</p>
            </div>
          ) : (
            <CampoDecimal
              etiqueta="Stock inicial"
              valor={stockInicial}
              alCambiar={setStockInicial}
              sufijo={sufijoUnidad}
              placeholder="0"
            />
          )}
          <CampoDecimal
            etiqueta="Stock mínimo"
            valor={v.stockMinimo}
            alCambiar={campo("stockMinimo")}
            sufijo={sufijoUnidad}
            placeholder="0"
          />
        </div>
        <p className="-mt-1 text-xs text-slate-500">
          {edicion
            ? "El stock cambia con compras, ventas y ajustes por conteo (en la página del material)."
            : "Si cargás stock inicial queda registrado como un ajuste en el libro de movimientos. Mínimo 0 = sin alerta."}
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <CampoDecimal
            etiqueta="Costo unitario"
            sufijo={`$/${sufijoUnidad || "u"}`}
            valor={v.costoUnitario}
            alCambiar={campo("costoUnitario")}
            placeholder="0"
            required
          />
          <CampoDecimal
            etiqueta="Precio de venta"
            sufijo={`$/${sufijoUnidad || "u"}`}
            valor={v.precioVenta}
            alCambiar={campo("precioVenta")}
            placeholder="—"
          />
        </div>
        <p className="-mt-1 text-xs text-slate-500">
          Por {sufijoUnidad || "unidad"}. Precio de venta vacío = no se vende suelto.
          {edicion ? " Las ventas ya hechas conservan su costo." : ""}
        </p>
        <CampoNotas etiqueta="Notas" valor={v.notas} alCambiar={campo("notas")} maxLength={500} filas={2} />
      </div>

      {edicion ? (
        <ImpactoMargen
          materialId={edicion.id}
          articulos={edicion.articulos}
          costoOriginal={iniciales.costoUnitario}
          costoTipeado={v.costoUnitario}
          costoHoraManoObra={edicion.costoHoraManoObra}
          margenObjetivoPct={edicion.margenObjetivoPct}
        />
      ) : null}

      <BloqueError mensaje={error} />
      <BotonEnviar pendiente={pendiente} texto={edicion ? "Guardar cambios" : "Crear material"} variante="marca" />
    </form>
  );
}
