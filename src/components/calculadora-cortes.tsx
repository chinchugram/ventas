"use client";

import { useEffect, useState } from "react";
import { cortesPorPlancha, precioCorte } from "@/lib/cortes";
import { d, fmtMoneda, fmtNumero } from "@/lib/money";
import { Aviso, Boton, Panel, TituloBloque } from "@/components/ui";

type Fila = { id: number; ancho: string; alto: string };

const CLAVE = "hl-cortes-v1";
const MEDIDAS_INICIALES: Fila[] = [
  { id: 1, ancho: "35", alto: "80" },
  { id: 2, ancho: "40", alto: "40" },
  { id: 3, ancho: "30", alto: "50" },
];

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
      <Panel como="section" aria-label="Plancha entera">
        <TituloBloque>Plancha entera</TituloBloque>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 mb-0">
            Precio de la plancha ($)
            <input
              inputMode="decimal"
              className="mt-1 tabular-nums"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="Ej: 85000"
            />
          </label>
          <label className="mb-0">
            Ancho (cm)
            <input
              inputMode="decimal"
              className="mt-1 tabular-nums"
              value={anchoPlancha}
              onChange={(e) => setAnchoPlancha(e.target.value)}
            />
          </label>
          <label className="mb-0">
            Alto (cm)
            <input
              inputMode="decimal"
              className="mt-1 tabular-nums"
              value={altoPlancha}
              onChange={(e) => setAltoPlancha(e.target.value)}
            />
          </label>
          <label className="col-span-2 mb-0">
            Recargo por corte / desperdicio (%)
            <input
              inputMode="decimal"
              className="mt-1 tabular-nums"
              value={recargo}
              onChange={(e) => setRecargo(e.target.value)}
            />
          </label>
        </div>
      </Panel>

      <Panel como="section" aria-label="Cortes">
        <TituloBloque>Cortes</TituloBloque>
        <ul className="space-y-3">
          {filas.map((f, i) => {
            const corte = { anchoCm: num(f.ancho), altoCm: num(f.alto) };
            const p = precioCorte(plancha, corte, recargoPct);
            const entran = cortesPorPlancha(plancha, corte);
            return (
              <li key={f.id} className="borde rounded-md border-line bg-surface-sunken p-3">
                <div className="flex items-end gap-2">
                  <label className="mb-0 min-w-0 flex-1">
                    Ancho (cm)
                    <input
                      inputMode="decimal"
                      className="mt-1 tabular-nums"
                      value={f.ancho}
                      onChange={(e) => cambiar(f.id, "ancho", e.target.value)}
                    />
                  </label>
                  <span aria-hidden="true" className="pb-3 text-ink-muted">
                    ×
                  </span>
                  <label className="mb-0 min-w-0 flex-1">
                    Alto (cm)
                    <input
                      inputMode="decimal"
                      className="mt-1 tabular-nums"
                      value={f.alto}
                      onChange={(e) => cambiar(f.id, "alto", e.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <Boton variante="fantasma-peligro" aria-label={`Quitar corte ${i + 1}`} onClick={() => setFilas((fs) => fs.filter((x) => x.id !== f.id))}>
                    Quitar
                  </Boton>
                  <div className="min-w-0 text-right">
                    <p className="text-body-sm text-ink-muted">
                      {entran > 0 ? `entran ${fmtNumero(entran)} por plancha` : "no entra en la plancha"}
                    </p>
                    <p className="monto text-ink">{p ? fmtMoneda(p) : "-"}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <Boton
          variante="secundario"
          ancho
          className="mt-3"
          onClick={() => setFilas((fs) => [...fs, { id: Date.now(), ancho: "", alto: "" }])}
        >
          Agregar medida
        </Boton>
        {!plancha.precio.gt(0) && (
          <Aviso tono="aviso" className="mt-3">
            Cargá el precio de la plancha para ver los precios.
          </Aviso>
        )}
      </Panel>
    </div>
  );
}
