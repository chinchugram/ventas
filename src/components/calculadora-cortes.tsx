"use client";

import { useEffect, useState } from "react";
import { cortesPorPlancha, precioCorte } from "@/lib/cortes";
import { d, fmtMoneda, fmtNumero } from "@/lib/money";

type Fila = { id: number; ancho: string; alto: string };

const CLAVE = "hl-cortes-v1";
const MEDIDAS_INICIALES: Fila[] = [
  { id: 1, ancho: "35", alto: "80" },
  { id: 2, ancho: "40", alto: "40" },
  { id: 3, ancho: "30", alto: "50" },
];

const input =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base tabular-nums focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/30";

function num(valor: string) {
  const n = Number(valor.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? d(n) : d(0);
}

export function CalculadoraCortes() {
  const [precio, setPrecio] = useState("");
  const [anchoPlancha, setAnchoPlancha] = useState("200");
  const [altoPlancha, setAltoPlancha] = useState("100");
  const [recargo, setRecargo] = useState("0");
  const [filas, setFilas] = useState<Fila[]>(MEDIDAS_INICIALES);
  const [listo, setListo] = useState(false);

  // Recuerda la ultima plancha y medidas para no cargarlas cada vez.
  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
      if (g) {
        setPrecio(g.precio ?? "");
        setAnchoPlancha(g.anchoPlancha ?? "200");
        setAltoPlancha(g.altoPlancha ?? "100");
        setRecargo(g.recargo ?? "0");
        if (Array.isArray(g.filas) && g.filas.length) setFilas(g.filas);
      }
    } catch {}
    setListo(true);
  }, []);

  useEffect(() => {
    if (!listo) return;
    try {
      localStorage.setItem(
        CLAVE,
        JSON.stringify({ precio, anchoPlancha, altoPlancha, recargo, filas }),
      );
    } catch {}
  }, [listo, precio, anchoPlancha, altoPlancha, recargo, filas]);

  const plancha = { anchoCm: num(anchoPlancha), altoCm: num(altoPlancha), precio: num(precio) };
  const recargoPct = num(recargo);

  const cambiar = (id: number, campo: "ancho" | "alto", valor: string) =>
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Plancha entera</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs text-slate-500">
            Precio de la plancha ($)
            <input
              inputMode="decimal"
              className={input}
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="Ej: 85000"
            />
          </label>
          <label className="text-xs text-slate-500">
            Ancho (cm)
            <input
              inputMode="decimal"
              className={input}
              value={anchoPlancha}
              onChange={(e) => setAnchoPlancha(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-500">
            Alto (cm)
            <input
              inputMode="decimal"
              className={input}
              value={altoPlancha}
              onChange={(e) => setAltoPlancha(e.target.value)}
            />
          </label>
          <label className="col-span-2 text-xs text-slate-500">
            Recargo por corte / desperdicio (%)
            <input
              inputMode="decimal"
              className={input}
              value={recargo}
              onChange={(e) => setRecargo(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Cortes</h2>
        <ul className="space-y-3">
          {filas.map((f) => {
            const corte = { anchoCm: num(f.ancho), altoCm: num(f.alto) };
            const p = precioCorte(plancha, corte, recargoPct);
            const entran = cortesPorPlancha(plancha, corte);
            return (
              <li key={f.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex items-end gap-2">
                  <label className="flex-1 text-xs text-slate-500">
                    Ancho (cm)
                    <input
                      inputMode="decimal"
                      className={input}
                      value={f.ancho}
                      onChange={(e) => cambiar(f.id, "ancho", e.target.value)}
                    />
                  </label>
                  <span className="pb-3 text-slate-400">×</span>
                  <label className="flex-1 text-xs text-slate-500">
                    Alto (cm)
                    <input
                      inputMode="decimal"
                      className={input}
                      value={f.alto}
                      onChange={(e) => cambiar(f.id, "alto", e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Quitar corte"
                    onClick={() => setFilas((fs) => fs.filter((x) => x.id !== f.id))}
                    className="pb-2.5 text-xl text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">
                    {entran > 0 ? `entran ${fmtNumero(entran)} por plancha` : "no entra en la plancha"}
                  </span>
                  <span className="text-xl font-bold tabular-nums text-tinta">
                    {p ? fmtMoneda(p) : "-"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() =>
            setFilas((fs) => [...fs, { id: Date.now(), ancho: "", alto: "" }])
          }
          className="mt-3 w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:border-marca hover:text-tinta"
        >
          + Agregar medida
        </button>
        {!plancha.precio.gt(0) && (
          <p className="mt-3 text-xs text-amber-700">Cargá el precio de la plancha para ver los precios.</p>
        )}
      </section>
    </div>
  );
}
