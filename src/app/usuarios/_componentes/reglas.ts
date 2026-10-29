// Copia minima de las reglas de `src/lib/auth-pura.ts` para los formularios (componentes
// cliente). `auth-pura` importa `node:crypto` y no se puede empaquetar para el navegador.
// Es solo una ayuda mientras se tipea: el servidor vuelve a validar todo. Si las reglas
// de `auth-pura` cambian, `npm run test:usuarios` avisa (compara las dos con ejemplos).

export const CLAVE_MIN = 10;

export function normalizarUsuario(usuario: string): string {
  return usuario.normalize("NFC").trim().toLowerCase();
}

export function usuarioValido(usuario: string): boolean {
  return /^[a-z0-9._-]{3,40}$/.test(normalizarUsuario(usuario));
}

export const AVISO_USUARIO =
  "El usuario debe tener entre 3 y 40 caracteres: letras sin acentos, números, punto, guion o guion bajo.";
