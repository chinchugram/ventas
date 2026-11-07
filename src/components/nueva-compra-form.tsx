"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarCompra } from "@/app/compras/actions";
import {
  AvisoDemo,
  CampoCheckbox,
  CampoDecimal,
  CampoSelect,
  CampoTexto,
  NotaObligatorio,
} from "@/components/form";
import { BarraInferior, Boton, TituloBloque } from "@/components/ui";
import { fmtMoneda } from "@/lib/money";
import { totalizarCompra } from "@/lib/stock";

export type MaterialOpcion = { id: string; nombre: string; unidad: string; costoUnitario: string };

type Linea = { clave: number; materialId: string; cantidad: string; costoUnitario: string };

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const numero = (v: string) => (/^\d+([.,]\d+)?$/.test(v.trim()) ? v.trim().replace(",", ".") : "0");

export type LineaInicial = { materialId: string; cantidad: string };

export function NuevaCompraForm({
  materiales,
  lineasIniciales = [],
  esModoDemo,
}: {
  materiales: MaterialOpcion[];
  /** Lineas sugeridas (por ejemplo, desde Reposicion); el costo sale del material. */
  lineasIniciales?: LineaInicial[];
  esModoDemo: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy);
  const [proveedor, setProveedor] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [actualizarCosto, setActualizarCosto] = useState(true);
  const [lineas, setLineas] = useState<Linea[]>(() => {
    const precargadas = lineasIniciales.flatMap((l, i) => {
      const material = materiales.find((m) => m.id === l.materialId);
      if (!material) return [];
      // Con coma, como lo tipearia el dueño.
      return [{ clave: i + 1, materialId: l.materialId, cantidad: l.cantidad.replace(".", ","), costoUnitario: material.costoUnitario }];
    });
    return precargadas.length > 0 ? precargadas : [{ clave: 1, materialId: "", cantidad: "", costoUnitario: "" }];
  });
  const [siguiente, setSiguiente] = useState(() => Math.max(...lineas.map((l) => l.clave)) + 1);

  const cambiar = (clave: number, cambios: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));

  const elegirMaterial = (clave: number, materialId: string) => {
    // Sugiere el costo vigente: el dueño solo lo corrige si el precio cambio.
    const costo = materiales.find((m) => m.id === materialId)?.costoUnitario ?? "";
    cambiar(clave, { materialId, costoUnitario: costo });
  };

  const total = totalizarCompra(lineas.map((l) => ({ cantidad: numero(l.cantidad), costoUnitario: numero(l.costoUnitario) })));

  const guardar = () => {
    setError(null);
    iniciar(async () => {
      const r = await registrarCompra({
        fecha,
        proveedor,
        comprobante,
        actualizarCosto,
        items: lineas.map(({ materialId, cantidad, costoUnitario }) => ({ materialId, cantidad, costoUnitario })),
      });
      if (r.ok) router.push("/compras");
      else setError(r.error);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
      className="space-y-4 pb-28"
    >
      <NotaObligatorio />
      <AvisoDemo visible={esModoDemo} que="los datos de la compra" />

      <div className="tarjeta grid gap-3 p-4 sm:grid-cols-3 sm:p-6">
        <CampoTexto etiqueta="Proveedor" valor={proveedor} alCambiar={setProveedor} className="sm:col-span-2" required />
        <CampoTexto etiqueta="Fecha" tipo="date" valor={fecha} alCambiar={setFecha} required />
        <CampoTexto etiqueta="Nº de comprobante (opcional)" valor={comprobante} alCambiar={setComprobante} className="sm:col-span-3" />
      </div>

      <section aria-labelledby="titulo-materiales-compra" className="space-y-2">
        <TituloBloque id="titulo-materiales-compra" className="mb-0">
          Qué compraste
        </TituloBloque>
        <ul className="space-y-2">
          {lineas.map((l, i) => {
            const unidad = materiales.find((m) => m.id === l.materialId)?.unidad;
            return (
              <li key={l.clave} className="tarjeta space-y-3 p-4">
                <div className="flex items-end gap-2">
                  <CampoSelect
                    className="min-w-0 flex-1"
                    etiqueta={`Material ${i + 1}`}
                    valor={l.materialId}
                    alCambiar={(materialId) => elegirMaterial(l.clave, materialId)}
                    opciones={materiales.map((m) => ({ valor: m.id, etiqueta: `${m.nombre} (${m.unidad})` }))}
                    placeholder="Elegí un material…"
                    required
                  />
                  {lineas.length > 1 ? (
                    <Boton
                      variante="fantasma-peligro"
                      onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                      aria-label={`Quitar material ${i + 1}`}
                      className="shrink-0 px-3"
                    >
                      Quitar
                    </Boton>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <CampoDecimal
                    etiqueta="Cantidad"
                    sufijo={unidad}
                    valor={l.cantidad}
                    alCambiar={(cantidad) => cambiar(l.clave, { cantidad })}
                    required
                  />
                  <CampoDecimal
                    etiqueta={`Costo por ${unidad ?? "unidad"}`}
                    prefijo="$"
                    valor={l.costoUnitario}
                    alCambiar={(costoUnitario) => cambiar(l.clave, { costoUnitario })}
                    required
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <Boton
          variante="secundario"
          ancho
          onClick={() => {
            setLineas((ls) => [...ls, { clave: siguiente, materialId: "", cantidad: "", costoUnitario: "" }]);
            setSiguiente((n) => n + 1);
          }}
        >
          + Agregar otro material
        </Boton>
      </section>

      <CampoCheckbox
        etiqueta="Usar estos precios como costo actual de cada material"
        ayuda="Las recetas y los márgenes se recalculan solos."
        marcado={actualizarCosto}
        alCambiar={setActualizarCosto}
      />

      <BarraInferior error={error}>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Total de la compra</p>
          <p className="monto leading-tight text-ink">{fmtMoneda(total)}</p>
        </div>
        <Boton type="submit" disabled={pendiente} aria-busy={pendiente || undefined} className="shrink-0">
          {pendiente ? "Guardando…" : "Guardar compra"}
        </Boton>
      </BarraInferior>
    </form>
  );
}
