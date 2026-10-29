"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarCompra } from "@/app/compras/actions";
import { fmtMoneda } from "@/lib/money";
import { totalizarCompra } from "@/lib/stock";

export type MaterialOpcion = { id: string; nombre: string; unidad: string; costoUnitario: string };

type Linea = { clave: number; materialId: string; cantidad: string; costoUnitario: string };

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const numero = (v: string) => (/^\d+([.,]\d+)?$/.test(v.trim()) ? v.trim().replace(",", ".") : "0");

export function NuevaCompraForm({ materiales, esModoDemo }: { materiales: MaterialOpcion[]; esModoDemo: boolean }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy);
  const [proveedor, setProveedor] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [actualizarCosto, setActualizarCosto] = useState(true);
  const [siguiente, setSiguiente] = useState(2);
  const [lineas, setLineas] = useState<Linea[]>([{ clave: 1, materialId: "", cantidad: "", costoUnitario: "" }]);

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
      className="space-y-4"
    >
      {esModoDemo ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Modo demostración: sin base de datos conectada, la compra no se guarda.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="proveedor">Proveedor</label>
          <input id="proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="fecha">Fecha</label>
          <input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="comprobante">Nº de comprobante (opcional)</label>
          <input id="comprobante" value={comprobante} onChange={(e) => setComprobante(e.target.value)} />
        </div>
      </div>

      <ul className="space-y-2">
        {lineas.map((l, i) => {
          const unidad = materiales.find((m) => m.id === l.materialId)?.unidad;
          return (
            <li key={l.clave} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`material-${l.clave}`}>Material {i + 1}</label>
                  <select
                    id={`material-${l.clave}`}
                    value={l.materialId}
                    onChange={(e) => elegirMaterial(l.clave, e.target.value)}
                    required
                  >
                    <option value="">Elegir…</option>
                    {materiales.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre} ({m.unidad})
                      </option>
                    ))}
                  </select>
                </div>
                {lineas.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                    className="h-11 shrink-0 rounded-lg border border-slate-300 px-3 text-sm text-slate-600"
                    aria-label={`Quitar material ${i + 1}`}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`cantidad-${l.clave}`}>Cantidad{unidad ? ` (${unidad})` : ""}</label>
                  <input
                    id={`cantidad-${l.clave}`}
                    inputMode="decimal"
                    value={l.cantidad}
                    onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label htmlFor={`costo-${l.clave}`}>Costo por {unidad ?? "unidad"}</label>
                  <input
                    id={`costo-${l.clave}`}
                    inputMode="decimal"
                    value={l.costoUnitario}
                    onChange={(e) => cambiar(l.clave, { costoUnitario: e.target.value })}
                    required
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => {
          setLineas((ls) => [...ls, { clave: siguiente, materialId: "", cantidad: "", costoUnitario: "" }]);
          setSiguiente((n) => n + 1);
        }}
        className="w-full rounded-lg border border-dashed border-slate-300 bg-white py-3 text-sm font-medium text-slate-700"
      >
        + Agregar otro material
      </button>

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm font-normal text-slate-700">
        <input
          type="checkbox"
          checked={actualizarCosto}
          onChange={(e) => setActualizarCosto(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span>
          Usar estos precios como costo actual de cada material.
          <span className="block text-slate-500">Las recetas y los márgenes se recalculan solos.</span>
        </span>
      </label>

      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="sticky bottom-20 flex items-center justify-between gap-3 rounded-xl bg-tinta p-4 text-white md:bottom-4">
        <div>
          <p className="text-xs text-slate-300 uppercase">Total de la compra</p>
          <p className="text-xl font-semibold tabular-nums">{fmtMoneda(total)}</p>
        </div>
        <button
          type="submit"
          disabled={pendiente}
          className="rounded-lg bg-marca px-5 py-3 font-semibold text-tinta disabled:opacity-60"
        >
          {pendiente ? "Guardando…" : "Guardar compra"}
        </button>
      </div>
    </form>
  );
}
