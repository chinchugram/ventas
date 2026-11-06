# Contexto del proyecto

**Todo está en DESARROLLO. No hay clientes ni usuarios reales.** HL Laser es el negocio de prueba/demo, nadie lo usa en producción.

Esto vale también para `staging` en Vercel y la base de Neon: son entornos de desarrollo, con datos de prueba.

Consecuencias para quien trabaje acá (humano o IA):

- No hablar de "ventana de mantenimiento", "avisar a HL Laser", "sesiones abiertas de clientes" ni "pérdida de datos de clientes": no existen.
- No frenar el trabajo por procedimientos pensados para producción (aprobaciones, respaldos obligatorios, ensayos en copia) cuando el dato es descartable. Si la base de Neon se puede recrear, se recrea.
- Sí pedir confirmación antes de acciones destructivas sobre datos que el dueño del proyecto (Claudio) haya cargado a mano y quiera conservar.
- Cuando el proyecto salga a producción con clientes reales, actualizar este archivo y volver a aplicar el rigor de `docs/07-multitenant-despliegue.md`.
