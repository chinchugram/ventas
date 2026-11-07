import Link from "next/link";
import { faltanteParaMinimo } from "@/lib/stock";
import { fmtMoneda, fmtMonedaCorta, fmtNumero, sumar } from "@/lib/money";
import {
  getMateriales,
  getMaterialesDeBaja,
  getMaterialesStock,
  tieneCostos,
  type MaterialDeBaja,
} from "@/lib/queries/materiales";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { Boton, Dato, Etiqueta, Seccion, Tarjeta, Vacio, type Tono } from "@/components/ui";

export const dynamic = "force-dynamic";

const TONO_ESTADO: Record<"SIN_STOCK" | "BAJO" | "OK", Tono> = {
  SIN_STOCK: "critico",
  BAJO: "aviso",
  OK: "neutro",
};

const TEXTO_ESTADO = {
  SIN_STOCK: "Sin stock",
  BAJO: "Bajo mínimo",
  OK: "En orden",
} as const;

export default async function MaterialesPage({ searchParams }: { searchParams: Promise<{ bajas?: string }> }) {
  const usuario = await requierePermisoPagina("verStock");
  // Costos, precios, valorizacion y gestion (alta, edicion, bajas, compras): cada cosa con su permiso.
  const verCostos = puede(usuario, "verCostos");
  const puedeEditar = puede(usuario, "editarMateriales");
  const puedeComprar = puede(usuario, "registrarCompra");
  const verBajas = (await searchParams).bajas === "1" && verCostos && puedeEditar;
  // Quien no ve costos recibe una lista que ni lee las columnas de plata. Las bajas traen costo: solo para quien edita.
  const [materiales, deBaja] = await Promise.all([
    verCostos ? getMateriales() : getMaterialesStock(),
    verCostos && puedeEditar ? getMaterialesDeBaja() : Promise.resolve([]),
  ]);

  const acciones = (
    <div className="flex flex-wrap gap-2">
      {puede(usuario, "verReposicion") ? (
        <Boton href="/reposicion" variante="secundario">
          Reposición
        </Boton>
      ) : null}
      {puedeComprar ? (
        <Boton href="/compras/nueva" variante="secundario">
          Registrar compra
        </Boton>
      ) : null}
      {puedeEditar ? (
        <Boton href="/materiales/nuevo">Nuevo material</Boton>
      ) : null}
    </div>
  );

  if (verBajas) {
    return (
      <>
        <Seccion
          epigrafe="Fuera de circulación"
          titulo="Materiales dados de baja"
          descripcion="No se ofrecen en compras nuevas; conservan su historial"
          accion={
            <Boton href="/materiales" variante="secundario">
              Volver
            </Boton>
          }
        />
        <ListaDeBajas materiales={deBaja} />
      </>
    );
  }

  if (materiales.length === 0) {
    return (
      <>
        <Seccion epigrafe="Lo que hay en el taller" titulo="Materiales" accion={acciones} />
        <Vacio
          mensaje="Ni un material cargado todavía."
          hint="Los materiales son la base del costeo: sin ellos, las recetas no tienen costo."
        />
        <LinkBajas cantidad={deBaja.length} />
      </>
    );
  }

  const valorTotal = sumar(...materiales.filter(tieneCostos).map((m) => m.valorInventario));
  const alertas = materiales.filter((m) => m.estado !== "OK");

  return (
    <>
      <Seccion
        epigrafe="Lo que hay en el taller"
        titulo="Materiales"
        descripcion="Lo que se consume para producir, y lo que se vende suelto"
        accion={acciones}
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        {verCostos ? <Tarjeta titulo="Valor en stock" valor={fmtMonedaCorta(valorTotal)} detalle="a costo de compra" /> : null}
        <Tarjeta
          titulo="Necesitan reposición"
          valor={fmtNumero(alertas.length)}
          tono={alertas.length > 0 ? "aviso" : "ok"}
          detalle={
            alertas.length > 0 && puede(usuario, "verReposicion") ? (
              <Link href="/reposicion" className="enlace inline-flex min-h-11 items-center">
                Ver qué comprar
              </Link>
            ) : undefined
          }
        />
      </div>

      <ul className="space-y-2">
        {materiales.map((m) => (
          <li key={m.id} className="tarjeta p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/materiales/${m.id}`} className="inline-flex min-h-11 items-center text-body font-semibold text-ink hover:underline">
                {m.nombre}
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Etiqueta tono={TONO_ESTADO[m.estado]}>{TEXTO_ESTADO[m.estado]}</Etiqueta>
                {puedeEditar ? (
                  <Link href={`/materiales/${m.id}/editar`} aria-label={`Editar ${m.nombre}`} className="enlace inline-flex min-h-11 items-center px-1">
                    Editar
                  </Link>
                ) : null}
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Dato etiqueta="Stock">
                {fmtNumero(m.stockActual)} <span className="font-sans text-body-sm font-normal text-ink-muted">{m.unidad}</span>
              </Dato>
              <Dato etiqueta="Mínimo" tono="apagado">
                {m.stockMinimo.cmp(0) > 0 ? `${fmtNumero(m.stockMinimo)} ${m.unidad}` : "-"}
              </Dato>
              {tieneCostos(m) ? (
                <>
                  <Dato etiqueta="Costo unitario">{fmtMoneda(m.costoUnitario)}</Dato>
                  <Dato etiqueta="Precio de venta" tipo={m.precioVenta ? "monto" : "texto"} tono={m.precioVenta ? "neutro" : "apagado"}>
                    {m.precioVenta ? fmtMoneda(m.precioVenta) : "solo insumo"}
                  </Dato>
                </>
              ) : null}
            </dl>

            {m.estado !== "OK" ? (
              <p className="mt-3 text-body-sm text-aviso-text">
                Faltan {fmtNumero(faltanteParaMinimo(m.stockActual, m.stockMinimo))} {m.unidad} para llegar al mínimo.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <LinkBajas cantidad={deBaja.length} />
    </>
  );
}

function LinkBajas({ cantidad }: { cantidad: number }) {
  if (cantidad === 0) return null;
  return (
    <p className="mt-4 text-center">
      <Link href="/materiales?bajas=1" className="enlace inline-flex min-h-11 items-center">
        Ver {cantidad === 1 ? "1 material dado de baja" : `${cantidad} materiales dados de baja`}
      </Link>
    </p>
  );
}

function ListaDeBajas({ materiales }: { materiales: MaterialDeBaja[] }) {
  if (materiales.length === 0) {
    return <Vacio mensaje="Ningún material dado de baja." hint="Los que des de baja aparecen acá, con su historial." />;
  }
  return (
    <ul className="space-y-2">
      {materiales.map((m) => (
        <li key={m.id} className="tarjeta p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-body font-semibold break-words text-ink-muted">{m.nombre}</p>
            <Link href={`/materiales/${m.id}/editar`} className="enlace inline-flex min-h-11 shrink-0 items-center px-1">
              Ver / reactivar
            </Link>
          </div>
          <p className="text-body-sm text-ink-muted tabular-nums">
            Stock {fmtNumero(m.stockActual)} {m.unidad} · costo {fmtMoneda(m.costoUnitario)}
          </p>
          {m.articulosQueLoUsan > 0 ? (
            <p className="mt-2 text-body-sm text-aviso-text">
              {m.articulosQueLoUsan === 1
                ? "1 artículo activo todavía lo usa en la receta."
                : `${m.articulosQueLoUsan} artículos activos todavía lo usan en la receta.`}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
