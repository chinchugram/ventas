import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import * as net from "net";

// ─── Rol de la app (multi-tenant F2.1) ─────────────────────────────────────────
// Este cliente conecta con DATABASE_URL, que DEBE usar el rol `ventas_app`: sin
// SUPERUSER ni BYPASSRLS, para que las politicas RLS de cada tabla rijan siempre.
// Las tablas de datos solo se tocan dentro de `conNegocio(negocioId, fn)`
// (src/lib/negocio.ts); sin contexto de negocio la base no devuelve filas.
// Las migraciones (`prisma migrate`) y los backfills usan otra URL, la del rol
// `ventas_migrador` (DATABASE_URL_MIGRACIONES, ver .env.example): nunca la de la app.
function crearCliente(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Falta DATABASE_URL. Copia .env.example a .env y define la conexion a Postgres (rol ventas_app).",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// ─── Singleton lazy ────────────────────────────────────────────────────────────
// En Next.js dev cada hot-reload reimporta los modulos: si crearamos el cliente
// en el top-level cada recarga abriria un pool nuevo y se agotarian conexiones.
// Con un Proxy diferimos la creacion hasta el primer uso real, evitando que
// `new PrismaClient()` (y su pg.Pool interno) se dispare al importar el modulo.
// Esto es lo que impedia que `dbDisponible()` funcionara: el pool se iniciaba
// antes de que pudieramos verificar si la base estaba disponible.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function obtenerPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = crearCliente();
  }
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const instance = obtenerPrisma();
    const valor = Reflect.get(instance, prop, receiver);
    // Los metodos del cliente (findMany, create, etc.) necesitan el `this` correcto.
    return typeof valor === "function" ? valor.bind(instance) : valor;
  },
});

// ─── Verificacion de conectividad ─────────────────────────────────────────────
// Usa TCP puro (modulo `net` de Node) para verificar si el puerto de Postgres
// esta abierto. NO importa `pg` ni crea ningun pool: simplemente abre y cierra
// un socket con timeout corto. Si esto falla, no tiene sentido intentar queries.
export async function dbDisponible(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname || "localhost";
    const port = parseInt(parsed.port) || 5432;

    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port, timeout: 1500 });
      const terminar = (resultado: boolean) => {
        if (!socket.destroyed) socket.destroy();
        resolve(resultado);
      };
      socket.on("connect", () => terminar(true));
      socket.on("error", () => terminar(false));
      socket.on("timeout", () => terminar(false));
    });
  } catch {
    return false;
  }
}
