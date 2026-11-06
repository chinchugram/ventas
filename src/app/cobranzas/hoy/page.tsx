import { Seccion, Vacio } from "@/components/ui";
import { hoyArgentinaISO } from "@/lib/acciones";
import { fmtMoneda, sumar } from "@/lib/money";
import { requierePermisoPagina } from "@/lib/permisos";
import { getRecordatoriosHoy, type RecordatorioHoy } from "@/lib/queries/recordatorios";
import { TarjetaRecordatorio } from "./_componentes/tarjeta-recordatorio";

// La lista depende del dia y de los contactos cargados: nunca se cachea.
export const dynamic = "force-dynamic";

export default async function RecordatoriosPage() {
  await requierePermisoPagina("verRecordatorios");
  const lista = await getRecordatoriosHoy();
  const hoy = hoyArgentinaISO();
  const total = sumar(...lista.map((r) => r.saldo));

  return (
    <>
      <Seccion titulo="Recordatorios" descripcion="A quién llamar hoy, de más antiguo a más reciente" />

      {lista.length === 0 ? (
        <Vacio mensaje="No hay nadie para llamar hoy" hint="Todos los saldos están al día o ya tuvieron contacto hoy." />
      ) : (
        <>
          <p className="mb-4 rounded-xl bg-white p-3 text-sm font-medium text-slate-800 ring-1 ring-slate-200">
            {lista.length} {lista.length === 1 ? "cliente" : "clientes"} para llamar hoy · total {fmtMoneda(total)}
          </p>

          <div className="space-y-6">
            {agruparPorTramo(lista).map((grupo) => (
              <section key={grupo.clave} aria-labelledby={`tramo-${grupo.clave}`}>
                <h2 id={`tramo-${grupo.clave}`} className="mb-2 text-sm font-semibold text-slate-900">
                  {grupo.etiqueta}
                  <span className="ml-1 font-normal text-slate-500">({grupo.items.length})</span>
                </h2>
                <ul className="space-y-3">
                  {grupo.items.map((r) => (
                    <li key={r.id}>
                      <TarjetaRecordatorio recordatorio={r} hoyISO={hoy} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Parte la lista en bloques por tramo, respetando el orden que ya trae la
 * consulta (los tramos llegan juntos). No reordena nada.
 */
function agruparPorTramo(lista: RecordatorioHoy[]) {
  const grupos: { clave: string; etiqueta: string; items: RecordatorioHoy[] }[] = [];
  for (const r of lista) {
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.clave === r.tramo) ultimo.items.push(r);
    else grupos.push({ clave: r.tramo, etiqueta: r.tramoEtiqueta, items: [r] });
  }
  return grupos;
}
