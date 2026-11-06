-- Ola 7.1: listas de precios por cliente.
-- Una lista tiene un descuento general sobre el precio de catalogo y/o precios
-- especificos por articulo. Un cliente puede tener una lista asignada.

CREATE TABLE "listas_precios" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descuentoPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listas_precios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lista_precio_items" (
    "id" UUID NOT NULL,
    "listaPrecioId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "precio" DECIMAL(14,4) NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lista_precio_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "clientes" ADD COLUMN "listaPrecioId" UUID;

CREATE UNIQUE INDEX "listas_precios_nombre_key" ON "listas_precios"("nombre");
CREATE INDEX "listas_precios_activo_idx" ON "listas_precios"("activo");
CREATE INDEX "lista_precio_items_articuloId_idx" ON "lista_precio_items"("articuloId");
CREATE UNIQUE INDEX "lista_precio_items_listaPrecioId_articuloId_key" ON "lista_precio_items"("listaPrecioId", "articuloId");
CREATE INDEX "clientes_listaPrecioId_idx" ON "clientes"("listaPrecioId");

ALTER TABLE "lista_precio_items" ADD CONSTRAINT "lista_precio_items_listaPrecioId_fkey"
  FOREIGN KEY ("listaPrecioId") REFERENCES "listas_precios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lista_precio_items" ADD CONSTRAINT "lista_precio_items_articuloId_fkey"
  FOREIGN KEY ("articuloId") REFERENCES "articulos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_listaPrecioId_fkey"
  FOREIGN KEY ("listaPrecioId") REFERENCES "listas_precios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La base es la ultima linea de defensa.
ALTER TABLE "listas_precios" ADD CONSTRAINT "listas_precios_descuento_check"
  CHECK ("descuentoPct" >= 0 AND "descuentoPct" <= 100);
ALTER TABLE "lista_precio_items" ADD CONSTRAINT "lista_precio_items_precio_check"
  CHECK ("precio" >= 0);
