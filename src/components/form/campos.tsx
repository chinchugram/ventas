"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

// Campos controlados: reciben `valor` (siempre texto, tal como lo tipea el
// usuario) y avisan con `alCambiar`. Los numeros viajan como texto hasta la
// server action, que los valida y convierte a Decimal: nunca pasan por `number`.

type Base = {
  etiqueta: string;
  /** Texto chico debajo del campo. */
  ayuda?: ReactNode;
  /** Error de este campo; se muestra en rojo y se anuncia al lector de pantalla. */
  error?: string | null;
  className?: string;
};

type AtributosInput = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className" | "type">;

function Envoltura({
  id,
  etiqueta,
  ayuda,
  error,
  className,
  children,
}: Base & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {ayuda ? (
        <p id={`${id}-ayuda`} className="mt-1 text-xs text-slate-500">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, ayuda: unknown, error: unknown) {
  return [ayuda ? `${id}-ayuda` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function CampoTexto({
  etiqueta,
  ayuda,
  error,
  className,
  valor,
  alCambiar,
  tipo = "text",
  id: idPropio,
  ...resto
}: Base &
  AtributosInput & {
    valor: string;
    alCambiar: (valor: string) => void;
    tipo?: "text" | "email" | "tel" | "date" | "password" | "search" | "url";
  }) {
  const idAuto = useId();
  const id = idPropio ?? idAuto;
  return (
    <Envoltura id={id} etiqueta={etiqueta} ayuda={ayuda} error={error} className={className}>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, ayuda, error)}
        {...resto}
      />
    </Envoltura>
  );
}

/** Area de texto (notas, observaciones). */
export function CampoNotas({
  etiqueta,
  ayuda,
  error,
  className,
  valor,
  alCambiar,
  filas = 3,
  maxLength,
  placeholder,
}: Base & { valor: string; alCambiar: (valor: string) => void; filas?: number; maxLength?: number; placeholder?: string }) {
  const id = useId();
  return (
    <Envoltura id={id} etiqueta={etiqueta} ayuda={ayuda} error={error} className={className}>
      <textarea
        id={id}
        rows={filas}
        value={valor}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => alCambiar(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, ayuda, error)}
      />
    </Envoltura>
  );
}

/**
 * Numero decimal: teclado numerico en el celular y acepta coma ("1,5"). El
 * valor sigue siendo texto; `sufijo` muestra la unidad ("m2", "$/h", "%").
 */
export function CampoDecimal({
  etiqueta,
  ayuda,
  error,
  className,
  valor,
  alCambiar,
  sufijo,
  prefijo,
  id: idPropio,
  ...resto
}: Base &
  Omit<AtributosInput, "inputMode"> & {
    valor: string;
    alCambiar: (valor: string) => void;
    sufijo?: string;
    prefijo?: string;
  }) {
  const idAuto = useId();
  const id = idPropio ?? idAuto;
  return (
    <Envoltura id={id} etiqueta={etiqueta} ayuda={ayuda} error={error} className={className}>
      <div className="relative">
        {prefijo ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">{prefijo}</span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, ayuda, error)}
          className={`tabular-nums ${prefijo ? "pl-7" : ""} ${sufijo ? "pr-14" : ""}`}
          {...resto}
        />
        {sufijo ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">
            {sufijo}
          </span>
        ) : null}
      </div>
    </Envoltura>
  );
}

export type Opcion = { valor: string; etiqueta: string; deshabilitada?: boolean };

export function CampoSelect({
  etiqueta,
  ayuda,
  error,
  className,
  valor,
  alCambiar,
  opciones,
  placeholder,
  required,
  disabled,
}: Base & {
  valor: string;
  alCambiar: (valor: string) => void;
  opciones: Opcion[];
  /** Primera opcion vacia ("Elegí un material…"). */
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Envoltura id={id} etiqueta={etiqueta} ayuda={ayuda} error={error} className={className}>
      <select
        id={id}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, ayuda, error)}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        ) : null}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor} disabled={o.deshabilitada}>
            {o.etiqueta}
          </option>
        ))}
      </select>
    </Envoltura>
  );
}

/** Casilla con texto a la derecha; toda la tarjeta es clickeable (pulgar). */
export function CampoCheckbox({
  etiqueta,
  ayuda,
  marcado,
  alCambiar,
  className,
  disabled,
}: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  marcado: boolean;
  alCambiar: (marcado: boolean) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`mb-0 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm font-normal text-slate-700 ${className ?? ""}`}
    >
      <input
        type="checkbox"
        checked={marcado}
        disabled={disabled}
        onChange={(e) => alCambiar(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0"
      />
      <span>
        {etiqueta}
        {ayuda ? <span className="block text-slate-500">{ayuda}</span> : null}
      </span>
    </label>
  );
}
