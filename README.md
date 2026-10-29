# ventas

ERP mínimo para un comercio de corte láser e insumos de marca (stickers, cartelería, rotulación).

El dueño hoy no sabe **qué** vende, **cuánto** cobró en el mes ni **cuánto margen** tiene. Esto
resuelve exactamente eso, sin convertirse en un ERP genérico.

---

## Arranque

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env        # en Windows: copy .env.example .env

# 3. Base de datos (Postgres en Docker)
docker compose up -d db

# 4. Esquema + datos de ejemplo
npm run db:generate
npm run db:deploy
npm run db:seed

# 5. Levantar
npm run dev
```

Abrir <http://localhost:3000>.

El seed carga un comercio de ejemplo con 4 clientes, 5 artículos con receta, 5 materiales,
3 máquinas y 7 ventas (pagadas, sin cobrar y pagadas a medias) para ver las pantallas con
información realista antes de cargar nada real.

**Para limpiar los datos de ejemplo y empezar de cero:** `npm run db:reset`

### Modo demo (sin base de datos)

Si Postgres no está levantado, la app **no se rompe**: cada pantalla cae a un juego de datos de
demostración (`src/lib/demo-data.ts`). No son números escritos a mano: costos, márgenes, saldos y
totales salen del mismo motor de costeo que usa la versión con base, así que las pantallas son
coherentes entre sí. Sirve para mostrar el mockup en una reunión sin Docker.

Con base disponible, siempre se usan los datos reales: el respaldo solo entra cuando la base no
responde o la consulta falla (por ejemplo, migraciones pendientes).

### Acceso con contraseña (obligatorio al publicarlo)

La app no tiene login propio, así que `src/proxy.ts` pide usuario y contraseña (HTTP Basic) en
todo el sitio. Se configura con variables de entorno:

| Variable | Qué es |
|---|---|
| `BASIC_AUTH_USER` | Usuario. Por defecto `demo`. |
| `BASIC_AUTH_PASSWORD` | Contraseña. |

- **En producción, sin `BASIC_AUTH_PASSWORD` el sitio responde 503**: un deploy con la variable
  olvidada no queda público.
- En desarrollo, sin contraseña, el sitio queda abierto.
- Para probarlo en local con contraseña: definirla en `.env` y correr `npm run dev`.

### Probarlo desde el celular

Con la PC y el celular en la misma Wi-Fi:

```bash
npm run dev -- -H 0.0.0.0
```

Abrir `http://IP-DE-LA-PC:3000`. En desarrollo, Next bloquea los recursos de otras IP: hay que
agregar la IP de la PC en `allowedDevOrigins` de `next.config.ts` (sin eso la página se ve, pero
los botones no responden).

---

## Documentación

| Documento | Qué está |
|---|---|
| [`docs/01-alcance-funcional.md`](docs/01-alcance-funcional.md) | Qué hace el MVP, qué NO hace, y las etapas siguientes |
| [`docs/02-modelo-datos.md`](docs/02-modelo-datos.md) | Entidades, decisiones de diseño y los cálculos derivados |
| [`docs/03-stack-y-decisiones.md`](docs/03-stack-y-decisiones.md) | Stack, con el porqué de cada elección |

---

## La idea central: el costo no se tipea, se calcula

Es lo que justifica el proyecto. El costo de un producto sale de su **receta**, que es una
lista de materiales consumidos + horas de máquina + horas de mano de obra:

```
Sticker en vinil 10x15 cm
  0,02 m2  vinil adhesivo        × $4.200   =   $84,00
  0,02 m2  transportador         × $1.400   =   $28,00
  0,10 h   plotter de impresión  × $2.500   =  $250,00
  0,17 h   viniladora            × $1.500   =  $255,00
  0,25 h   mano de obra          × $3.500   =  $875,00
                                    costo   = $1.492,00
                        se vende a          $3.500,00   margen 57,4%
```

Si mañana el vinilo sube de $4.200 a $5.100, **el costo se recalcula solo**. El margen deja de
depender de la memoria del dueño.

Un artículo sin receta tiene costo 0 y el sistema lo marca como **"sin receta"**, en vez de
mostrar un margen del 100% que es una mentira.

---

## Mockup de la carga de venta

`/ventas/nueva` existe para **mostrarle el flujo al dueño y recoger opinión antes de invertir
en la persistencia**. Calcula costos, IVA, márgenes y saldo pendiente con el mismo motor que
usaría la versión real (`lib/costing.ts`), así que los números que muestra son los de verdad,
salidos de las recetas del catálogo. Lo único que no existe es el guardado.

Al apretar "Guardar venta" muestra el comprobante interno que se generaría, sin escribir nada
en la base. Hay un banner que lo dice en pantalla, para que nadie crea que se guardó.

**Para mostrar:** `npm run dev` → http://localhost:3000/ventas/nueva. Conviene tener el catálogo
con recetas cargadas (`npm run db:seed`), porque sin receta el margen sale como desconocido.

---

## Pantallas

| Ruta | Qué resuelve |
|---|---|
| `/` | Cómo va el mes: facturado, cobrado, costo, ganancia, márgenes, alertas |
| `/ventas` | Historial de ventas con margen y estado de pago |
| `/ventas/nueva` | **Mockup** de la carga de venta: calcula todo en vivo, todavía no guarda |
| `/clientes` | Quién es cada cliente y cuánto debe |
| `/catalogo` | Costo por receta, precio, margen y precio necesario para la meta |
| `/materiales` | Stock, valorización y avisos de reposición |
| `/reportes` | Ganancia por producto, más rentables, deuda por cliente, materiales |

Todas mobile-first: en celular las tablas se convierten en tarjetas apiladas. El dueño atiende
el mostrador con el teléfono en la mano.

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y arranque de producción |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run db:up` / `db:down` | Levantar / bajar Postgres |
| `npm run db:migrate` | Crear y aplicar una migración (desarrollo) |
| `npm run db:deploy` | Aplicar migraciones (producción) |
| `npm run db:seed` | Cargar datos de ejemplo |
| `npm run db:reset` | **Borra todo** y vuelve a migrar + sembrar |
| `npm run db:studio` | Prisma Studio, para mirar la base |
| `npm run db:backup` | `pg_dump` a `backups/`, con rotación de 30 archivos |
| `npm run test:costeo` | Verifica el motor de costeo contra 15 números conocidos |
| `npm run test:integridad` | Verifica que los CHECK constraints rechazan datos inválidos |

---

## Reglas del proyecto

Estas son las que sostienen el código. Si alguna se rompe, el sistema empieza a mentir.

1. **El dinero es `Decimal`, siempre.** Prohibido `+`, `*` o template literals con números de
   dinero. Todo pasa por `src/lib/money.ts`. Un redondeo mal aplicado en un subtotal se
   propaga al margen, y el margen es el producto.
2. **Ningún saldo se persiste.** El saldo de un cliente y el estado de pago de una venta se
   *calculan* desde ventas y pagos. No pueden quedar desincronizados porque no existen como dato.
3. **El costo se congela en la venta.** `VentaItem` guarda el costo del momento. Si no, un
   cambio de precio del vinilo reescribiría los márgenes del mes pasado.
4. **La base es la última línea de defensa.** Prisma valida en la app, pero los `CHECK`
   constraints de `prisma/migrations/` validan siempre. Verificables con
   `scripts/test-integridad.sql`.
5. **Baja lógica en todo catálogo.** `activo = false`. Nunca se borra algo con historial.
6. **Server Components finos.** Consultas en `src/lib/queries/`, escrituras en `src/actions/`
   como Server Actions con Zod. Los componentes renderizan, no saben SQL.
7. **Código en inglés, dominio en español.** `costoTotalSnapshot`, `stockMinimo`, `saldoCliente`.
   Lo que hay que entender sin traducciones es el dominio.

---

## Estado actual

**Andamiaje completo y verificado:**

- Esquema Prisma migrado, con 9 `CHECK` constraints, 2 índices parciales y configuración sembrada.
- `prisma/seed.ts` con datos de ejemplo de un comercio de láser.
- `src/lib/costing.ts`: motor de costeo y margen, puro y sin dependencias de infraestructura.
- `src/lib/money.ts`: aritmética decimal y formateo es-AR.
- Consultas del dashboard, catálogo, clientes, materiales, ventas y reportes.
- Las 6 pantallas renderizan con datos reales.
- `/ventas/nueva`: mockup funcional de la carga de venta, con márgenes reales calculados en vivo.
- `npm run test:costeo` (15 comprobaciones) y `npm run test:integridad` (10 casos) pasan.
- `npm run build` y `npm run typecheck` limpios.

**Lo que falta para que sea usable (siguiente paso):**

- [ ] Guardado real de la venta: numeración correlativa por año, ítems, costo congelado y descuento de stock
- [ ] Formularios de alta/edición de clientes, artículos, materiales y recetas
- [ ] Registro de pagos y cambio de estado de la venta
- [ ] Página de configuración (costo/hora de mano de obra, IVA, margen objetivo)
- [ ] Backup automático diario

---

## Notas

**`npm audit` reporta 4 vulnerabilidades altas.** Están en `mysql2` y `deepmerge-ts`, que son
dependencias transitivas del **CLI de Prisma** (`devDependency`), no del runtime. La de `mysql2`
no aplica: el proyecto usa PostgreSQL. La única corrección que ofrece npm es bajar a Prisma 6,
que es un retroceso. No se acepta; queda documentado.

**Sin autenticación por decisión propia** (un solo usuario). La app no expone datos públicos y
el límite es el firewall del VPS. Agregar login es la etapa 3.
