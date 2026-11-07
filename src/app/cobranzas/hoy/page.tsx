import { Seccion, Tarjeta, TituloBloque, Vacio } from "@/components/ui";
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
      <Seccion epigrafe="Llamadas del día" titulo="Recordatorios" descripcion="A quién llamar hoy, de más antiguo a más reciente" />

      {lista.length === 0 ? (
        <Vacio mensaje="Hoy no hay a quién llamar." hint="Todos los saldos están al día o ya tuvieron contacto hoy. Buen momento para un mate." />
      ) : (
        <>
          <div className="mb-6">
            <Tarjeta
              titulo="Para llamar hoy"
              valor={fmtMoneda(total)}
              tono="aviso"
              detalle={`${lista.length} ${lista.length === 1 ? "cliente" : "clientes"}`}
            />
          </div>

          <div className="space-y-6">
            {agruparPorTramo(lista).map((grupo) => (
              <section key={grupo.clave} aria-labelledby={`tramo-${grupo.clave}`}>
                <TituloBloque id={`tramo-${grupo.clave}`} className="mb-2">
                  {grupo.etiqueta}
                  <span className="ml-1 font-sans text-body font-normal text-ink-muted">({grupo.items.length})</span>
                </TituloBloque>
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
