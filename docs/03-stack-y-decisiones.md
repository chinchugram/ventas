# Stack y decisiones técnicas

## Decisiones tomadas

| Tema | Decisión | Motivo |
|---|---|---|
| Producto | ERP mínimo: clientes, artículos, materiales, ventas, cobranzas, 5 reportes | El dueño pidió exactamente eso. Todo lo demás es etapa 2+. |
| Comprobantes | Internos, **sin** facturación electrónica | Decisión del dueño. Se agrega ARCA después sin tocar el modelo. |
| Plataforma | Web **responsive, mobile-first** | El mostrador se atiende con el celular en la mano. Diseño mobile-first real, no un desktop comprimido. |
| Usuarios | Varios, con **login y roles** (`DUENO` / `EMPLEADO`) | Desde la etapa 3 (ola 4): cada venta, cobro y compra queda con quién la cargó. Antes, un solo usuario sin login. Ver `docs/seguridad-ola-4-auth.md`. |
| Cobranzas | Sí, cuenta corriente calculada | El negocio vende a crédito. |
| Framework | **Next.js 15** (App Router, React Server Components) | Un solo lenguaje, SSR para que el celular cargue rápido, y Server Actions que eliminan una capa entera de API REST. |
| Lenguaje | **TypeScript** estricto | El dominio es dinero: los tipos son la primera línea de defensa. |
| Base de datos | **PostgreSQL 17** | Numeración correlativa transaccional, CHECK constraints para la integridad de las recetas, aggregating de reportes. |
| ORM | **Prisma 6** | Migraciones versionadas, tipos derivados del schema, seed. |
| Dinero | `Decimal` de Prisma + `decimal.js` en el browser | **Nunca `float`.** Un redondeo mal aplicado en un subtotal se propaga al margen. |
| Validación | **Zod 4** | Un solo schema por formulario, reutilizado en el server y en el cliente. |
| UI | **Tailwind CSS 4** + componentes propios | Sin librería de UI externa: el diseño es simple, una dependencia menos que mantener. |
| Despliegue | **Docker Compose**: app + Postgres en un VPS | Un `docker compose up -d` y listo. Backup = copiar un directorio. |
| Puerto | 3000, expuesto en `0.0.0.0` | El dueño entra desde el celular por la red del negocio. |

## Por qué Next.js y no un CRUD genérico

El costo real de un ERP no está en los formularios, está en **mantenerlo barato de operar**.
Un VPS de USD 5/mes con Docker y un solo proceso es la decisión que hace posible ofrecer esto
a un comercio chico. Cualquier alternativa "moderna" (serverless, microservicios, multi-región)
multiplica el costo y la complejidad sin aportar nada a este problema.

Server Components + Server Actions significan que no existe una capa REST que mantener:
el formulario llama a una función de servidor tipada y listo.

## Por qué Postgres y no SQLite

Se ven tres razones concretas, no preferencias de gusto:

1. **Numeración correlativa de ventas.** `SELECT MAX(numero) FROM ventas WHERE anio = $1` dentro de
   una transacción no es atómico. En Postgres se resuelve con una secuencia por año o con
   `SELECT ... FOR UPDATE`, que sí es atómico. Con SQLite, dos ventas simultáneas en dos
   dispositivos arrancan con el mismo número.
2. **CHECK constraints** para garantizar que una línea de receta de tipo `MATERIAL` tenga
   `materialId` y no `maquinaId`. En el ORM se puede validar, pero la base es la última
   línea de defensa.
3. Los reportes de margen por producto y de consumo de materiales piden `GROUP BY` con
   agregación y window functions. SQLite lo puede, pero con un plan de ejecución penoso.

## Por qué el costo va "congelado" en la venta

Si el costo de un ítem se calculara siempre contra la receta vigente, un cambio de precio del vinilo
reescribiría la historia: los márgenes del mes pasado cambiarían hoy sin que nadie haya tocado
una venta. Eso vuelve inútil el reporte. Por eso `VentaItem` guarda `costoUnitarioSnapshot` y
`costoTotalSnapshot` al momento de confirmar la venta.

El costo **vigente** de la receta se usa solo para (a) mostrar el margen esperado del catálogo y
(b) sugerir precio.

## Estructura del proyecto

```
ventas/
├── docs/                     # Este documento y el modelo de datos
├── prisma/
│   ├── schema.prisma         # Fuente de la verdad del modelo
│   └── seed.ts               # Datos de ejemplo de un comercio de láser
├── src/
│   ├── app/                  # Rutas (App Router) = la UI
│   │   ├── page.tsx          # Dashboard
│   │   ├── clientes/
│   │   ├── catalogo/         # Artículos
│   │   ├── materiales/
│   │   ├── maquinas/
│   │   ├── ventas/
│   │   └── reportes/
│   ├── components/           # Componentes compartidos
│   ├── lib/
│   │   ├── prisma.ts         # Cliente singleton
│   │   ├── costing.ts        # Motor de costeo y margen (sin DB, puro y testeable)
│   │   ├── money.ts          # Aritmética decimal
│   │   └── queries/          # Lecturas agrupadas por dominio
│   └── actions/              # Server Actions: escritura
├── docker-compose.yml
└── .env.example
```

## Convenciones

- **Todo el dinero es `Decimal`.** Funciones de `lib/money.ts` para sumar y redondear. Prohibido
  `+`, `*` y template literals con números de dinero.
- **Toda consulta de negocio va en `lib/queries/`**, nunca en un componente. Los Server Components
  son finos: piden datos y renderizan.
- **Toda escritura va en `src/actions/`** como Server Action validada con Zod.
- **Nombres de dominio en español**, código en inglés. El dominio es lo que hay que entender
  sin traducciones: `costoTotalSnapshot`, `stockMinimo`, `saldoCliente`.
- Soft delete (`activo = false`) en todo catálogo. Nunca se borra algo con historial.

## Riesgos asumidos

| Riesgo | Mitigación |
|---|---|
| El dueño no carga las recetas completas | El dashboard marca "artículos sin receta" con costo desconocido. Es visible, no invisible. |
| El costo real difiere del estimado por receta | Etapa 5. En el MVP el margen es un **estándar estimado**, y así se documenta. |
| Acceso sin login (un solo usuario, en el MVP) | Resuelto en la etapa 3 (ola 4): login con usuarios, roles y sesiones guardadas en la base. Ver `docs/seguridad-ola-4-auth.md`. |
| Sin backups automáticos | Script de `pg_dump` diario agregado en la etapa 2. **Es lo primero que hay que agregar antes de cargar datos reales.** |
