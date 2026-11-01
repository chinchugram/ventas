"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { quitarLogo, subirLogo } from "@/app/configuracion/actions";
import { AvisoDemo, BloqueError, BloqueExito, BotonEnviar, NotaObligatorio, useAccion } from "@/components/form";
import { LogoMarca } from "@/components/logo-marca";
import { MAX_LOGO_BYTES } from "@/lib/marca-pura";

const TIPOS_ACEPTADOS = "image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg";

/**
 * Logo del negocio: lo ve cada usuario en la barra, el /login del negocio y los comprobantes
 * impresos. El servidor valida por contenido (PNG, JPG o SVG simple, hasta 1 MB); el aviso de
 * tamaño de acá es solo para no esperar una subida que se va a rechazar.
 */
export function LogoForm({
  nombre,
  logo,
  logoPropio,
  esModoDemo,
}: {
  nombre: string;
  logo: string | null;
  /** `true` si el logo actual lo subio el negocio (se puede quitar). */
  logoPropio: boolean;
  esModoDemo: boolean;
}) {
  const router = useRouter();
  const subida = useAccion(subirLogo);
  const baja = useAccion((_: null) => quitarLogo());
  const idArchivo = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => {
    if (!archivo) {
      setVista(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  const elegir = (f: File | null) => {
    setExito(null);
    subida.setError(null);
    baja.setError(null);
    if (f && f.size > MAX_LOGO_BYTES) {
      setArchivo(null);
      if (entrada.current) entrada.current.value = "";
      setErrorLocal(`El logo pesa ${(f.size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB y el máximo es 1 MB. Probá con una imagen más liviana.`);
      return;
    }
    setErrorLocal(null);
    setArchivo(f);
  };

  const error = errorLocal ?? subida.error ?? baja.error;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!archivo) {
          setErrorLocal("Elegí un archivo de imagen.");
          return;
        }
        const datos = new FormData();
        datos.set("logo", archivo);
        subida.enviar(datos, () => {
          setExito("Logo guardado.");
          setArchivo(null);
          if (entrada.current) entrada.current.value = "";
          router.refresh();
        });
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <NotaObligatorio />
      <div>
        <h2 className="text-base font-semibold text-slate-900">Logo</h2>
        <p className="text-sm text-slate-500">
          Se ve en la barra, en la pantalla de entrada de tu negocio y en los comprobantes impresos. No cambia el emisor fiscal.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="shrink-0 rounded-xl bg-tinta px-4 py-2" aria-live="polite">
          <LogoMarca nombre={nombre} logo={vista ?? logo} alto="h-12" />
        </div>
        <p className="min-w-0 text-sm text-slate-600">
          {vista
            ? "Así se va a ver. Falta guardar."
            : logoPropio
              ? "Es el logo actual de tu negocio."
              : logo
                ? "Es el logo por defecto de tu negocio."
                : "Todavía no cargaste un logo: se muestran las iniciales."}
        </p>
      </div>

      <div>
        <label htmlFor={idArchivo} className="mb-1 block text-sm font-medium text-slate-700">
          Archivo de imagen
        </label>
        <input
          ref={entrada}
          id={idArchivo}
          type="file"
          accept={TIPOS_ACEPTADOS}
          onChange={(e) => elegir(e.target.files?.[0] ?? null)}
          aria-describedby={`${idArchivo}-ayuda`}
          className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-700 file:mr-3 file:min-h-11 file:border-0 file:bg-slate-100 file:px-4 file:font-medium file:text-slate-800"
        />
        <p id={`${idArchivo}-ayuda`} className="mt-1 text-xs text-slate-500">
          PNG, JPG o SVG simple, hasta 1 MB. Se muestra sobre fondo oscuro: usá un logo claro o con su propio fondo.
        </p>
      </div>

      <AvisoDemo visible={esModoDemo} que="el logo" />
      <BloqueError mensaje={error} />
      <BloqueExito mensaje={exito} />
      <BotonEnviar pendiente={subida.pendiente} texto="Guardar logo" disabled={!archivo || baja.pendiente} />
      {logoPropio ? (
        <button
          type="button"
          disabled={subida.pendiente || baja.pendiente}
          onClick={() => {
            setExito(null);
            setErrorLocal(null);
            baja.enviar(null, () => {
              setExito("Logo quitado.");
              router.refresh();
            });
          }}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
        >
          {baja.pendiente ? "Quitando…" : "Quitar logo"}
        </button>
      ) : null}
    </form>
  );
}
