// Se muestra al instante mientras la pagina nueva termina de cargar en el servidor
// (el encabezado y la barra de navegacion quedan en su lugar). Esqueleto con los tokens de la marca:
// bloques `surface-sunken` dentro de tarjetas, que laten suave (con movimiento reducido, quietos).
export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Cargando…</span>
      <div aria-hidden="true" className="space-y-4">
        <div className="space-y-2">
          <Bloque className="h-4 w-28" />
          <Bloque className="h-8 w-48" />
        </div>
        <div className="tarjeta space-y-3 p-5 sm:p-6">
          <Bloque className="h-4 w-32" />
          <Bloque className="h-9 w-40" />
          <Bloque className="h-3 w-full rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="tarjeta space-y-2 p-3 sm:p-4">
              <Bloque className="h-3 w-16" />
              <Bloque className="h-7 w-24" />
            </div>
          ))}
        </div>
        <div className="tarjeta space-y-3 p-4 sm:p-5">
          <Bloque className="h-4 w-36" />
          <Bloque className="h-24 w-full" />
        </div>
      </div>
      <p className="text-center text-body-sm text-ink-muted" aria-hidden="true">
        Cargando…
      </p>
    </div>
  );
}

function Bloque({ className }: { className: string }) {
  return <div className={`animate-latido rounded-sm bg-surface-sunken ${className}`} />;
}
