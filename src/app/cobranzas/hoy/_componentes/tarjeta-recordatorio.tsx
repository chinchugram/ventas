import { enlaceWhatsApp, mensajeWhatsApp } from "@/lib/recordatorios-cobranza";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import type { RecordatorioHoy } from "@/lib/queries/recordatorios";
import { claseBoton } from "@/components/ui";
import { ContactoForm } from "./contacto-form";

/**
 * Una cliente a llamar hoy: datos, ultima nota, botones de contacto y el
 * formulario para dejar constancia. Es un Server Component: lo unico que viaja
 * al navegador es el formulario (id del cliente y fecha de hoy).
 */
export function TarjetaRecordatorio({ recordatorio: r, hoyISO }: { recordatorio: RecordatorioHoy; hoyISO: string }) {
  const wa = r.telefono ? enlaceWhatsApp(r.telefono, mensajeWhatsApp(r.nombre, r.saldo)) : null;

  return (
    <article className="tarjeta p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-body-lg font-bold break-words text-ink">{r.nombre}</h3>
          <p className="text-body-sm text-ink-muted">
            {r.dias === 0 ? "Debe desde hoy" : `Debe desde hace ${r.dias} ${r.dias === 1 ? "día" : "días"}`}
          </p>
        </div>
        <p className="monto-fila shrink-0 text-right text-aviso-text">{fmtMoneda(r.saldo)}</p>
      </div>

      {r.ultimaNota ? (
        <div className="mt-3 rounded-md bg-surface-sunken p-3">
          <p className="eyebrow">Última nota · {fmtFecha(r.ultimaNota.fecha)}</p>
          <p className="mt-1 text-body-sm break-words whitespace-pre-line text-ink">{r.ultimaNota.nota}</p>
          {r.ultimaNota.proximoContacto ? (
            <p className="mt-1 text-body-sm text-ink-muted">Prometió volver a contactar el {fmtFecha(r.ultimaNota.proximoContacto)}</p>
          ) : null}
          <p className="mt-1 text-body-sm text-ink-muted">Registrado por {r.ultimaNota.registradoPor ?? "—"}</p>
        </div>
      ) : null}

      {r.telefono ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <a href={`tel:${r.telefono}`} className={claseBoton({ variante: "secundario" })}>
              Llamar<span className="sr-only"> a {r.nombre}</span>
            </a>
            {wa?.valido ? (
              <a href={wa.url} target="_blank" rel="noopener noreferrer" className={claseBoton()}>
                WhatsApp<span className="sr-only"> a {r.nombre}</span>
              </a>
            ) : null}
          </div>
          {wa && !wa.valido ? <p className="text-body-sm text-ink-muted">WhatsApp no disponible: {wa.motivo}</p> : null}
        </div>
      ) : (
        <p className="mt-3 text-body-sm text-ink-muted">Sin teléfono cargado: se puede cargar en la ficha del cliente.</p>
      )}

      <div className="mt-4 border-t-(length:--border-width) border-line pt-4">
        <h4 className="eyebrow mb-3">Registrar contacto</h4>
        <ContactoForm clienteId={r.id} hoyISO={hoyISO} />
      </div>
    </article>
  );
}
