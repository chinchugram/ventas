-- Multi-tenant F4.3 (1/2): el rol SUPERADMIN.
--
-- Va solo en su migracion: Postgres no deja USAR un valor de enum agregado en la misma
-- transaccion que lo crea (el CHECK de la migracion siguiente lo usa). Ver
-- `20260601030100_superadmin_sesiones_rls`.
ALTER TYPE "Rol" ADD VALUE 'SUPERADMIN';
