# Seguridad de la autenticación (ola 4.1)

Qué se decidió en el núcleo de login y sesiones, cómo se garantiza que nada quede sin verificar
y qué queda fuera de alcance. Código: `src/lib/auth-pura.ts` (puro), `src/lib/dominio/auth.ts`
(núcleo con base, sin Next), `src/lib/auth.ts` (capa de Next), `src/lib/permisos.ts`,
`src/proxy.ts`, `src/app/login/`. Pruebas: `npm run test:auth` y `npm run test:auth:db`.

## Modelo

- `usuarios`: `usuario` (único, en minúsculas), `nombre`, `rol` (`DUENO` / `EMPLEADO`, tipo enum
  de Postgres), `hashClave`, `activo` (baja lógica, nunca se borra), y el estado de la pausa por
  fallos (`intentosFallidos`, `ultimoFalloEn`, `bloqueadoHasta`).
- `sesiones`: `tokenHash` (único), `usuarioId`, `creadaEn`, `renovadaEn`, `expiraEn`.
- `CHECK` en la migración `20260210000000_usuarios_y_sesiones`: usuario en minúsculas y con
  formato `^[a-z0-9._-]{3,40}$`, nombre de 1 a 80 caracteres, hash con el formato de scrypt (nunca
  vacío ni texto plano), contador de fallos ≥ 0, `tokenHash` como SHA-256 en hex (la base no puede
  guardar el token en claro aunque un bug lo intente), vencimiento posterior a la creación. FK de
  sesiones a usuarios con `RESTRICT`: un usuario con sesiones no se puede borrar.

## Claves

- **scrypt** de `node:crypto` (sin dependencias nativas), **N = 2^15, r = 8, p = 3**: una de las
  configuraciones mínimas equivalentes de OWASP, 32 MiB por cálculo, ~0,3 s en el servidor de
  desarrollo. Corre en el pool de hilos de libuv (no bloquea el event loop).
- **Sal aleatoria de 16 bytes por clave**, hash de 64 bytes.
- **Formato autodescriptivo**: `scrypt$ln=15,r=8,p=3$<sal>$<hash>` (base64url). Cada hash guarda
  sus parámetros: si se suben, los hashes viejos siguen verificando y se **rehashean solos** en el
  siguiente login correcto (`necesitaRehash`). Al leer un hash se acotan los parámetros
  (`ln` 14–20, `r` 1–32, `p` 1–16): un valor corrupto en la base no puede pedir gigas de memoria.
- Comparación con **`timingSafeEqual`**.
- Longitud: **mínimo 10, máximo 200** caracteres (contados como caracteres, no bytes). El tope
  evita usar scrypt sobre entradas enormes; la acción además corta antes de tocar la base.
- La clave se normaliza a **NFC** antes de hashear: "José" tipeado en un iPhone y en una PC da el
  mismo hash.

## Login

- **Mensaje único** para usuario inexistente, clave incorrecta, usuario dado de baja y usuario en
  pausa: "Usuario o clave incorrectos. Si fallaste varias veces seguidas, esperá unos minutos…".
- **Tiempo parejo**: en todos esos casos se calcula scrypt (contra un hash falso de sal y hash en
  cero cuando no hay hash real), así el tiempo no revela si el usuario existe. Diferencia residual:
  un intento contra un usuario existente hace un `UPDATE` más (~1 ms frente a ~300 ms de scrypt con
  su propia variación); medirlo exigiría miles de intentos, y la pausa los limita a unos pocos por
  hora.
- **Pausa creciente por usuario, en la base** (sobrevive reinicios y sirve con varias instancias):
  los primeros 4 fallos no pausan; desde el 5.º, 30 s, 1 min, 2 min, 4 min, 8 min y **tope de
  15 min**. Nunca hay bloqueo permanente. Lo que llega durante la pausa no se verifica ni suma.
  Un login correcto pone la cuenta en cero; un día sin fallos, también. A tope, un atacante prueba
  4 claves por hora: con 10 caracteres mínimos no es un camino.
- **Intentos en paralelo**: antes de verificar, el intento se anota como fallo con un `UPDATE`
  condicionado al estado leído (compare-and-swap). Si dos intentos llegan juntos, solo uno se
  verifica; el resto recibe el mensaje genérico. Así no se pueden disparar cien claves antes de
  que se registre el primer fallo, y no se mantiene ninguna fila bloqueada (ni una conexión del
  pool ocupada) mientras corre scrypt. Probado en `test:auth:db` (10 intentos simultáneos → 1 fallo
  contado, la clave correcta dentro de la ráfaga no entra).
- Cada login **estrena token** (nunca se acepta uno que traiga el navegador: no hay fijación de
  sesión) y cierra la sesión que el navegador tuviera antes. Limpia las sesiones vencidas del
  usuario.
- Destino: `?siguiente=` solo si es una ruta interna (empieza con una sola `/`, sin `\`, sin
  caracteres de control, no vuelve a `/login`; se valida con `URL` contra un origen ficticio). Si
  no, `DUENO` → `/`, `EMPLEADO` → `/ventas/nueva`. Se valida en el proxy, en la página y en la acción.

## Sesión y cookie

- Token de **32 bytes** de `randomBytes` (base64url). La cookie lleva el token; la base guarda
  **solo su SHA-256**: quien lea la tabla o un respaldo no puede usar las sesiones. El token tiene
  256 bits de entropía, así que un hash rápido sin sal alcanza (no es una clave elegida por alguien).
- Cookie `httpOnly`, `secure` en producción, `sameSite=lax`, `path=/`. En producción se llama
  **`__Host-ventas_sesion`**: el navegador la rechaza sin `Secure`, con `Domain` o con otro `Path`,
  así un subdominio no puede pisarla. **Producción exige HTTPS** (detrás del proxy inverso del VPS):
  por HTTP el navegador descarta la cookie y el login vuelve siempre a `/login`.
- **30 días con renovación deslizante**: si pasó más de un día desde la última extensión, el proxy
  corre el vencimiento a 30 días desde ahora en la base y reenvía la cookie. Una escritura por día
  como máximo (condicionada a `renovadaEn`, así una ráfaga de pedidos escribe una sola vez). Los
  Server Components no pueden reenviar cookies; por eso renueva el proxy.
- **Vencimiento verificado en el servidor** contra `expiraEn` (no se confía en el `Max-Age` de la
  cookie). Una sesión vencida o de un usuario dado de baja se borra al encontrarla.
- **Cerrar sesión borra la fila** y la cookie (con los mismos atributos, que `__Host-` exige).
  `cerrarSesionesDeUsuario` queda lista para la baja y el cambio de clave (4.4).
- **Baja de usuario**: corta la sesión en el pedido siguiente (cada pedido consulta `activo`).

## Cómo se garantiza que nada queda sin verificar

Tres capas, de afuera hacia adentro:

1. **`src/proxy.ts`, verificación real en cada pedido.** En Next 16 el proxy corre en Node.js, así
   que consulta la base: sesión existente, no vencida, usuario activo. Su `matcher` cubre todo salvo
   `/_next/static/`, el manifiesto, los íconos y `public/marca/` (logo e íconos; se ven en `/login`).
   Por eso pasan por él **todas** las páginas, las navegaciones del cliente (RSC), los prefetch, las
   **server actions** (son POST a la ruta de la página) y los **route handlers**
   (`/reportes/export/[reporte]`). Sin sesión válida:
   - GET → 307 a `/login?siguiente=…`;
   - server action (cabecera `Next-Action`) → 401 con `x-action-redirect`, que el cliente de Next
     convierte en una navegación a `/login` (la acción no corre);
   - cualquier otro método → 303 a `/login`.
   La única ruta atendida sin sesión es `/login`. Una server action ajena invocada por POST a
   `/login` con su ID: Next la reenvía internamente a la ruta de su página con un pedido HTTP nuevo,
   que vuelve a pasar por el proxy. Ese reenvío falla: el cliente recibe 200 con cuerpo `{}`, y la
   acción NO corre ni escribe en la base (comprobado con `npm run test:acceso` para cada server action).
   `/_next/image`: `images.unoptimized` en `next.config.ts` (la app no usa `next/image`) y ya no se
   excluye del `matcher`.
2. **`usuarioActual()` / `requiereUsuario()` / `requierePermiso()` en cada página y acción.** El
   proxy no es la única defensa (un `matcher` mal editado lo saltearía), así que el código que lee
   o escribe datos verifica por su cuenta. **El layout raíz no protege**: no se vuelve a ejecutar en
   las navegaciones del cliente; solo pinta la navegación con `usuarioActual()`. API:
   - páginas (4.3): `await requierePermisoPagina("verCostos", "verMargenes")` como primera línea:
     sin sesión redirige a `/login`; con sesión pero sin alguno de los permisos, a la pantalla de
     inicio del rol (`/ventas/nueva` para `EMPLEADO`), nunca a `/login`;
   - server actions (4.3): `const permiso = await verificarPermiso("anularVenta"); if (!permiso.ok)
     return permiso;` como PRIMERA sentencia, antes de validar o leer nada (devuelve
     `{ ok: false, error }`; Next oculta el texto de los errores lanzados en producción);
   - route handlers: `usuarioActual()` + `puede(...)` y respuesta 401/403 de texto plano (el export
     CSV exige `exportarCsv`, `verReportes`, `verCostos` y `verMargenes`).
   Las 20 acciones y las 25 páginas con datos del repo lo hacen desde 4.3 (tabla de qué permiso exige
   cada una en `scripts/verificar-permisos.ts`, escrita a mano).
3. **`AUTH_ESTRICTO=1 npm run test:auth` audita las rutas**: cada `page.tsx` tiene que llamar a
   `requierePermisoPagina(...)` antes de leer datos, cada función exportada de un `actions.ts` tiene
   que empezar con `requierePermiso` / `verificarPermiso` (se lee el código, no solo se busca el
   nombre), todo archivo con `"use server"` tiene que ser un `actions.ts` auditado y cada `route.ts`
   verifica sesión y permisos. Sin `AUTH_ESTRICTO` los hallazgos son avisos. `npm run test:permisos`
   comprueba además la matriz rol × acción, invoca cada acción prohibida con un empleado real
   (sin cambios en la base) y verifica que las consultas del empleado no traen costos.

`npm run test:acceso` es la prueba de punta a punta de estas tres capas: levanta `next build && next start`
contra una base descartable (`ventas_acceso`) y pide cada ruta por HTTP, sin cookie, con un empleado, con
sesión expirada y con un usuario dado de baja. Verifica también que el HTML y el RSC que recibe el empleado
no traigan ningún costo ni margen sembrado.

Sin base o sin usuarios: en producción, sin base, el proxy responde **503** (nunca queda abierto);
con base pero **sin ningún usuario**, 503 con la instrucción `npm run usuarios:crear-dueno` (en
cualquier entorno). En desarrollo sin base, modo demo: entra un `DUENO` simulado ("Demo") y las
acciones devuelven `SIN_BASE`.

## CSRF y otros

- **Server actions** (todas las escrituras, incluidos entrar y salir): Next solo las acepta por
  POST y compara `Origin` con `Host` / `X-Forwarded-Host`; si no coinciden aborta (probado: con la
  cookie válida y `Origin: https://evil.example`, `registrarVenta` responde 500 y no guarda).
  Además la cookie es `sameSite=lax`: no viaja en POST ni `fetch` de otros sitios. Si la app queda
  detrás de un proxy que cambia el `Host`, configurar `serverActions.allowedOrigins`, nunca
  desactivar la comparación.
- **Login CSRF** (hacer entrar a la víctima en la cuenta del atacante): bloqueado por lo mismo.
- **Logout**: formulario con server action (POST, mismo origen). Un GET no cierra sesión.
- **GET sin efectos**: las páginas y el export CSV solo leen. La única escritura en un GET es la
  renovación de la sesión del propio usuario, inocua.
- **Clickjacking**: el proxy agrega `X-Frame-Options: DENY` y `Content-Security-Policy:
  frame-ancestors 'none'`, más `X-Content-Type-Options: nosniff` y `Referrer-Policy: same-origin`.
- **Datos al navegador**: el layout pasa al navbar (componente cliente) solo `{ nombre, rol }`;
  `usuarioActual()` nunca devuelve el hash ni datos de la sesión.

## Alta del primer dueño

`npm run usuarios:crear-dueno` pide usuario, nombre y clave (sin eco, con confirmación) o los toma
de `DUENO_USUARIO`, `DUENO_NOMBRE`, `DUENO_CLAVE`. Normaliza el usuario a minúsculas, exige 10
caracteres de clave y **se niega si ya hay algún dueño, aunque esté dado de baja** (lo verifica
antes de pedir la clave y otra vez dentro de la transacción, con un lock para que dos corridas
simultáneas no creen dos). El seed crea `dueno` / `dueno-de-ejemplo` y `empleado` /
`empleado-de-ejemplo` **solo si `NODE_ENV !== "production"`**; en producción no toca usuarios ni
sesiones.

## Fuera de alcance (y recomendación)

- **Límite por IP o global.** No se implementó: sin un proxy inverso de confianza la IP sale de
  `X-Forwarded-For`, que el cliente puede falsificar, y un límite global en memoria dejaría al
  dueño afuera durante un ataque. La pausa por usuario ya acota la fuerza bruta. Recomendado:
  `limit_req` de nginx (o el equivalente de Caddy / Cloudflare) sobre `POST /login` en el VPS, que
  además protege la CPU (cada intento cuesta un scrypt).
- **Bloqueo del dueño por terceros.** Un atacante que conozca el usuario puede mantenerlo en pausa
  (un intento cada 15 min). No lo deja afuera de lo que ya está abierto: las sesiones existentes
  siguen valiendo (30 días renovables), solo impide un login nuevo. Mitigación futura: cookie de
  "dispositivo conocido" que exima de la pausa por cuenta (recomendación de OWASP).
- **2FA**, **recuperación de clave** (hoy: otro dueño la cambia en 4.4, o un comando de servidor),
  **rotación del token al cambiar de rol o de clave** (4.4 debería llamar a
  `cerrarSesionesDeUsuario` en la baja, el cambio de clave y el cambio de rol), **listado y cierre
  remoto de sesiones**, **registro de auditoría de logins**.
- **Limpieza periódica** de sesiones vencidas: hoy se borran al encontrarlas y en cada login del
  usuario; no hay tarea programada (la tabla crece poco).
- **CSP completa** (scripts, estilos): solo se fijó `frame-ancestors`.
