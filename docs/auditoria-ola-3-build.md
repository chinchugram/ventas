# Auditoría Ola 3: build, typecheck y npm audit (tarea 3.3b)

Fecha: 2026-10-29. Rama: `ola-3.3b`, creada desde `ola-3` (commit `55692a6`, "Merge 3.1a Lógica de rango de fechas").
Alcance: solo reporte. No se modificó código, no se ejecutó `npm audit fix` y no se tocaron `package.json` ni `package-lock.json`.

## Entorno de la corrida

- La rama pedida `ola-3/3.3b` no se pudo crear: git no admite `ola-3/3.3b` mientras existe `refs/heads/ola-3`, que está checked out en `/home/user/ventas`. No se renombró ni borró esa rama. Se usó `ola-3.3b`.
- Primera corrida hecha sobre `d090ce6`, base vieja sin olas 1 y 2. Se rehizo todo sobre `ola-3` (`55692a6`) con `git reset --hard ola-3`, sin commits propios que perder. Los resultados de abajo son de la base nueva.
- `node_modules` es un symlink a `/home/user/ventas/node_modules` y `.env` es copia de la principal. Las dependencias de `package.json` y del lock son iguales entre la base vieja y la nueva (solo cambiaron scripts), así que el `node_modules` sirve.
- `src/generated/prisma` no existe en el worktree. Se generó con `npx prisma generate` (carpeta ignorada por git).
- Verificado en la base nueva: existen `src/app/cobranzas` y `src/lib/acciones.ts`.

## 1. Build

| Corrida | Resultado |
|---|---|
| `npm run build` (Turbopack, por defecto) | **Falla.** `TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root`. Causa: el symlink de `node_modules` apunta fuera del root del worktree. Es un problema del entorno, no del código. |
| `npx next build --webpack` (diagnóstico) | **Pasa.** Compiló, TypeScript OK, páginas generadas. Sin warnings en el log. |

Rutas generadas (webpack): `/`, `/catalogo`, `/catalogo/[id]`, `/catalogo/nuevo`, `/clientes`, `/clientes/[id]`, `/clientes/[id]/editar`, `/clientes/nuevo`, `/cobranzas`, `/compras`, `/compras/nueva`, `/configuracion`, `/configuracion/maquinas/[id]`, `/configuracion/maquinas/nueva`, `/materiales`, `/materiales/[id]`, `/materiales/[id]/editar`, `/materiales/nuevo`, `/reportes`, `/reposicion`, `/ventas`, `/ventas/[id]`, `/ventas/nueva` (dinámicas); `/cortes`, `/icon.png`, `/apple-icon.png`, `/manifest.webmanifest` (estáticas); `/_not-found`.

Pendiente: no verifiqué que el build con Turbopack pase con un `node_modules` real (sin symlink). Eso hace falta para que el build por defecto quede verde en un worktree.

## 2. Typecheck (`npm run typecheck`)

- Sin cliente de Prisma generado: **falla** con 18 errores. `src/lib/prisma.ts` y `prisma/seed.ts` no encuentran `src/generated/prisma/client`, y en cascada aparecen TS7006 (`any` implícito) en las queries. Causa: falta el cliente generado en el worktree, no código.
- Con `npx prisma generate` previo, sobre la base `ola-3`: **pasa** (exit 0).

## 3. npm audit (sin fix)

Resumen de `npm audit`: 9 hallazgos, 1 crítico (next), 7 altos, 1 moderado. Mismo resultado en la base vieja y en la nueva. Clasificación según `package-lock.json`.

| Paquete | Severidad | Camino en el árbol | Runtime o dev | ¿Aplica a la app? | Decisión |
|---|---|---|---|---|---|
| `prisma` 7.10.0 | high | devDependency directa. El lock la marca prod porque `@prisma/client` la declara como peer opcional | CLI de Prisma, no se carga en runtime | No | **Aceptado** mientras se aplica el patch 7.10.1 (ver sección 4). No se acepta bajar a Prisma 6. |
| `@prisma/config` 7.10.0 | high | prisma → @prisma/config | CLI | No | Igual que `prisma`. Corregido por 7.10.1. |
| `deepmerge-ts` <8.0.0 | high | @prisma/config → deepmerge-ts | CLI (lectura de `prisma.config.ts`) | No. La vulnerabilidad es por objetos recursivos; no se mergea input externo | **Aceptado**. Corregido por 7.10.1 (que trae deepmerge-ts 8.0.2). |
| `mysql2` <=3.23.0 | high (auth plugin) y moderate (zlib) | prisma → mysql2 | CLI | No. El proyecto usa `@prisma/adapter-pg` y ningún archivo importa `mysql2` | **Aceptado**. Corregido por 7.10.1 (que trae mysql2 3.24.4). |
| `next` 16.0.0 a 16.4.0 | **critical** (2), high (2), moderate y low | dependencia directa de runtime | Runtime | **Sí, en parte**, ver tabla 4.1 | **No aceptado.** Corrección: next >=16.4.1. |
| `zod` <4.6.6 | high (memoria con colecciones grandes) | dependencia directa de runtime | Runtime | **Sí.** zod valida colecciones (líneas de ventas, compras y recetas) dentro de Server Actions | **No aceptado.** Corrección no breaking: zod 4.6.6 (dentro de `^4.6.5`). |
| `sharp` <0.35.5 | high (librsvg CVE-2026-96889) | optional de `next`, usado por el optimizador de imágenes | Runtime (optional) | Solo si se procesan SVG. `dangerouslyAllowSVG` no está configurado (default `false`) | **Aceptado temporalmente**. Se corrige al subir next/sharp. |
| `source-map-js` 1.0.0 a 1.2.1 | high (DoS por source maps indexados) | postcss → source-map-js (prod, vía next) y @tailwindcss/node (dev) | Build y tooling | No. Solo parsea source maps propios en build | **Aceptado**. Corrección no breaking: >=1.2.2. |
| `fast-uri` 3.0.0 a 3.1.8 | moderate (x2) y low (x2) | ajv → fast-uri, dentro del árbol de Prisma | Árbol de Prisma | No. La app no procesa URIs de usuarios | **Aceptado**. Corrección no breaking: >=3.1.9. |

### 4.1 Detalle de las advisories de next

| Advisory | Severidad | Condición para explotar | ¿Aplica hoy? |
|---|---|---|---|
| RCE no autenticada en Image Optimization con SVG | critical | Requiere `images.dangerouslyAllowSVG: true` | No, por config. Pero ver hallazgo 4.2. |
| RCE no autenticada en funciones `use cache` que devuelven typed arrays | critical | Usar `use cache` | No. No hay `use cache` en `src`. |
| SSRF en Image Optimization | high | Requiere `images.remotePatterns` o `domains` | No. No están configurados. |
| DoS en App Router con Server Actions | high | Tener Server Actions | **Sí.** Hay 9 archivos con `"use server"` (`src/app/*/actions.ts`, `reposicion/actions.ts`). `experimental.serverActions.bodySizeLimit` está en 2mb, lo que acota pero no elimina el riesgo. |
| Cache poisoning de SSG/ISR en self-hosted | moderate | `next start` en un VPS | Sí, en teoría. La app se sirve con `next start`. Rutas estáticas: `/cortes`, íconos y manifest. Riesgo bajo en una app de un usuario. |
| Fuga de Draft Mode y de cache entre root params con `use cache`; bypass de `dynamicParams` en rutas de metadata | moderate | `use cache`, `draftMode` o rutas de metadata dinámicas | No. No se usan (`use cache`, `draftMode` y `unstable_cache` sin resultados en `src`; solo hay `icon.png` estático). |
| Fuga de información en el endpoint MCP del dev server | low | Solo `next dev` | No, no es producción. |

### 4.2 Hallazgo nuevo (no es una advisory, pero afecta a la superficie de next)

`src/proxy.ts` excluye `_next/image` del matcher del Basic Auth. Next sirve `/_next/image` por defecto en `next start`, así que el optimizador de imágenes queda accesible sin contraseña. La app no usa `next/image` (solo hay un `<img>` en la navbar), así que el endpoint no hace falta y solo amplía la superficie de las advisories de Image Optimization. Sugerencia para quien corresponda: `images: { unoptimized: true }` en `next.config.ts`, o quitar la exclusión del matcher. No se modificó.

## 4. Corrección a la nota del README

La nota del README dice que la única corrección que ofrece npm para las altas de Prisma es bajar a Prisma 6. **Eso no es correcto para la versión actual.** Consulta de solo lectura al registro:

- `prisma@7.10.1` (patch dentro de `^7.10.0`) depende de `mysql2@3.24.4` y de `@prisma/config@7.10.1`.
- `@prisma/config@7.10.1` depende de `deepmerge-ts@8.0.2`.

Las tres versiones están fuera de los rangos vulnerables. La corrección es un patch no breaking dentro de Prisma 7, sin retroceso. Lo que sigue sin aceptarse es bajar a Prisma 6. Este punto no se aplicó: queda como recomendación.

Otras dos correcciones a la nota:

- Dice que las dependencias son devDependency. En el lock, `prisma`, `@prisma/config`, `mysql2` y `deepmerge-ts` aparecen como prod porque `@prisma/client` declara `prisma` como peer opcional. Se instalan con `npm ci --omit=dev`, aunque la app no las carga en runtime.
- La nota habla de 4 altas. Hoy son 7 altas y 1 crítica. Las 4 de la nota son `@prisma/config`, `deepmerge-ts`, `mysql2` y `prisma`. Lo nuevo es `next` (crítico y altas), `zod`, `sharp` y `source-map-js` (altas), más `fast-uri` (moderada).

## 5. Resumen de decisiones

- **Aceptado, sin impacto en runtime**: `prisma`, `@prisma/config`, `deepmerge-ts`, `mysql2`, `fast-uri`, `source-map-js`. Se corrigen con `prisma@7.10.1` (cubre los primeros cuatro) y con updates no breaking de `source-map-js` (>=1.2.2) y `fast-uri` (>=3.1.9).
- **Aceptado temporalmente con condición**: `sharp` (solo si se procesan SVG).
- **No aceptado, corregir**:
  - `next` a >=16.4.1. Es semver-compatible con `^16.3.6`. 16.4.1 existe en el registro, y el rango crítico termina en 16.4.0. No verifiqué su changelog. Corrige las advisories de Server Actions y las de Image Optimization.
  - `zod` a 4.6.6 (dentro de `^4.6.5`, no breaking). Corrige la advisory de memoria con colecciones grandes, que sí aplica porque zod valida las líneas de las Server Actions.
- **Rechazado**: bajar a Prisma 6. Se mantiene la decisión de la nota.

## 6. Otros hallazgos

- `docs/03-stack-y-decisiones.md` dice Prisma 6, mientras `package.json` tiene Prisma 7. Conviene resolver esa discrepancia.
- Quedó sin verificar el build con Turbopack sin symlink y el changelog de next 16.4.1.
