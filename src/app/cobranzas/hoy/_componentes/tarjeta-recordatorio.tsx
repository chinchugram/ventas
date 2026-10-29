import { enlaceWhatsApp, mensajeWhatsApp } from "@/lib/recordatorios-cobranza";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import type { RecordatorioHoy } from "@/lib/queries/recordatorios";
import { ContactoForm } from "./contacto-form";

const BOTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition-transform active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-marca-texto focus-visible:ring-offset-2 focus-visible:outline-none";

/**
 * Una cliente a llamar hoy: datos, ultima nota, botones de contacto y el
 * formulario para dejar constancia. Es un Server Component: lo unico que viaja
 * al navegador es el formulario (id del cliente y fecha de hoy).
 */
export function TarjetaRecordatorio({ recordatorio: r, hoyISO }: { recordatorio: RecordatorioHoy; hoyISO: string }) {
  const wa = r.telefono ? enlaceWhatsApp(r.telefono, mensajeWhatsApp(r.nombre, r.saldo)) : null;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold break-words text-slate-900">{r.nombre}</h3>
          <p className="text-sm text-slate-600">
            {r.dias === 0 ? "Debe desde hoy" : `Debe desde hace ${r.dias} ${r.dias === 1 ? "día" : "días"}`}
          </p>
        </div>
        <p className="shrink-0 text-right font-semibold tabular-nums text-amber-700">{fmtMoneda(r.saldo)}</p>
      </div>

      {r.ultimaNota ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="text-xs font-medium text-slate-600">Última nota · {fmtFecha(r.ultimaNota.fecha)}</p>
          <p className="mt-1 break-words whitespace-pre-line text-slate-800">{r.ultimaNota.nota}</p>
          {r.ultimaNota.proximoContacto ? (
            <p className="mt-1 text-xs text-slate-600">Prometió volver a contactar el {fmtFecha(r.ultimaNota.proximoContacto)}</p>
          ) : null}
          <p className="mt-1 text-xs text-slate-600">Registrado por {r.ultimaNota.registradoPor ?? "—"}</p>
        </div>
      ) : null}

      {r.telefono ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`tel:${r.telefono}`}
              className={`${BOTON} border border-slate-400 bg-white text-slate-900 hover:bg-slate-50`}
            >
              Llamar<span className="sr-only"> a {r.nombre}</span>
            </a>
            {wa?.valido ? (
              <a
                href={wa.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${BOTON} bg-emerald-700 text-white hover:bg-emerald-800`}
              >
                WhatsApp<span className="sr-only"> a {r.nombre}</span>
              </a>
            ) : null}
          </div>
          {wa && !wa.valido ? <p className="text-xs text-slate-600">WhatsApp no disponible: {wa.motivo}</p> : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-600">Sin teléfono cargado: se puede cargar en la ficha del cliente.</p>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Registrar contacto</h4>
        <ContactoForm clienteId={r.id} hoyISO={hoyISO} />
      </div>
    </article>
  );
}
