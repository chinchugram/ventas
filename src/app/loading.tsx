// Se muestra al instante mientras la pagina nueva termina de cargar en el servidor
// (el encabezado y la barra de navegacion quedan en su lugar).
export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-24 text-slate-600">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-marca-texto" aria-hidden="true" />
      <span className="text-sm font-medium">Cargando…</span>
    </div>
  );
}
