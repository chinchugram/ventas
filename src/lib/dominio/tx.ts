import type { Prisma } from "@/generated/prisma/client";

/**
 * Cliente de Prisma dentro de una transaccion. La logica de dominio recibe uno
 * de estos en vez de usar el singleton: asi la llaman las server actions (con
 * `prisma.$transaction`), el seed y los scripts de prueba, sin Next de por medio.
 */
export type Tx = Prisma.TransactionClient;
