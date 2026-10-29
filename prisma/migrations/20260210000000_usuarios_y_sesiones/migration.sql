-- Ola 4.1: usuarios con rol y sesiones en base (reemplaza el HTTP Basic del proxy).
-- Ver src/lib/auth.ts y docs/seguridad-ola-4-auth.md.

-- El tipo enum ya restringe el rol a estos dos valores.
CREATE TYPE "Rol" AS ENUM ('DUENO', 'EMPLEADO');

CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "usuario" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "hashClave" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "ultimoFalloEn" TIMESTAMPTZ(3),
    "bloqueadoHasta" TIMESTAMPTZ(3),
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id"),
    -- Siempre en minusculas: con el indice unico, "Dueno" y "dueno" no pueden ser dos usuarios.
    CONSTRAINT "usuarios_usuario_minusculas_check" CHECK ("usuario" = lower("usuario")),
    -- Mismo formato que valida la app (src/lib/auth-pura.ts): 3 a 40 caracteres sin espacios.
    CONSTRAINT "usuarios_usuario_formato_check" CHECK ("usuario" ~ '^[a-z0-9._-]{3,40}$'),
    CONSTRAINT "usuarios_nombre_check" CHECK (length(btrim("nombre")) BETWEEN 1 AND 80),
    -- Nunca una clave en texto plano ni un hash vacio: solo el formato autodescriptivo de scrypt.
    CONSTRAINT "usuarios_hash_clave_check" CHECK ("hashClave" ~ '^scrypt\$ln=[0-9]{1,2},r=[0-9]{1,2},p=[0-9]{1,2}\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{32,}$'),
    CONSTRAINT "usuarios_intentos_fallidos_check" CHECK ("intentosFallidos" >= 0)
);

CREATE TABLE "sesiones" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usuarioId" UUID NOT NULL,
    "creadaEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renovadaEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id"),
    -- SHA-256 en hex: la base nunca guarda el token que viaja en la cookie.
    CONSTRAINT "sesiones_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "sesiones_vencimiento_check" CHECK ("expiraEn" > "creadaEn" AND "renovadaEn" >= "creadaEn")
);

CREATE UNIQUE INDEX "usuarios_usuario_key" ON "usuarios"("usuario");
CREATE UNIQUE INDEX "sesiones_tokenHash_key" ON "sesiones"("tokenHash");
CREATE INDEX "sesiones_usuarioId_idx" ON "sesiones"("usuarioId");
CREATE INDEX "sesiones_expiraEn_idx" ON "sesiones"("expiraEn");

-- RESTRICT: un usuario nunca se borra (baja logica); sus sesiones se borran al cerrar o dar de baja.
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
