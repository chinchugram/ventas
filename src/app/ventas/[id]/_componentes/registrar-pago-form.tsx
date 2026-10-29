"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registrarPago } from "@/app/ventas/[id]/actions";
import {
  BloqueError,
  BloqueExito,
  BotonEnviar,
  CampoDecimal,
  CampoNotas,
  CampoSelect,
  CampoTexto,
  useAccion,
} from "@/components/form";
import { decimalOCero, esDecimal } from "@/lib/acciones";
import { d, fmtMoneda } from "@/lib/money";
import { ETIQUETA_METODO, METODOS_PAGO, montoSugerido, validarMontoContraSaldo, type MetodoPago } from "@/lib/cobranzas";

const OPCIONES_METODO = METODOS_PAGO.map((m) => ({ valor: m, etiqueta: ETIQUETA_METODO[m]! }));

/**
 * Cobro sobre una venta. El monto arranca con el saldo (el caso comun es
 * cobrar todo); el aviso de "supera el saldo" es solo una ayuda: el servidor
 * vuelve a calcular el saldo con la venta bloqueada.
 */
export function RegistrarPagoForm({ ventaId, saldo, hoy }: { ventaId: string; saldo: string; hoy: string }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(registrarPago);
  const [monto, setMonto] = useState(() => montoSugerido(d(saldo)));
  const [metodo, setMetodo] = useState<MetodoPago>("EFECTIVO");
  const [fecha, setFecha] = useState(hoy);
  const [notas, setNotas] = useState("");
  const [exito, setExito] = useState<string | null>(null);

  const aviso = monto.trim() && esDecimal(monto) ? validarMontoContraSaldo(decimalOCero(monto), d(saldo)) : null;
  const resto = decimalOCero(monto).gt(0) && !aviso ? d(saldo).minus(decimalOCero(monto)) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setExito(null);
        enviar({ ventaId, monto, metodo, fecha, notas }, () => {
          const cobrado = decimalOCero(monto);
          setExito(`Pago de ${fmtMoneda(cobrado)} registrado.`);
          // Sugiere lo que queda para el proximo cobro.
          setMonto(montoSugerido(d(saldo).minus(cobrado).abs()));
          setNotas("");
          router.refresh();
        });
      }}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">Registrar pago</h2>
      <CampoDecimal
        etiqueta="Monto"
        prefijo="$"
        valor={monto}
        alCambiar={(v) => {
          setMonto(v);
          setExito(null);
        }}
        error={aviso}
        ayuda={
          aviso
            ? undefined
            : resto && resto.gt("0.01")
              ? `Queda debiendo ${fmtMoneda(resto)}`
              : `Saldo: ${fmtMoneda(saldo)}`
        }
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <CampoSelect
          etiqueta="Método"
          valor={metodo}
          alCambiar={(v) => setMetodo(v as MetodoPago)}
          opciones={OPCIONES_METODO}
          required
        />
        <CampoTexto etiqueta="Fecha" tipo="date" valor={fecha} alCambiar={setFecha} max={hoy} required />
      </div>
      <CampoNotas
        etiqueta="Notas (opcional)"
        valor={notas}
        alCambiar={setNotas}
        filas={2}
        maxLength={500}
        placeholder="N° de transferencia, quién pagó…"
      />
      <BloqueError mensaje={error} />
      <BloqueExito mensaje={exito} />
      <BotonEnviar pendiente={pendiente} texto="Registrar pago" disabled={!!aviso} variante="marca" />
    </form>
  );
}
