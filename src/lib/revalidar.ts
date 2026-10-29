import { revalidatePath } from "next/cache";

/** Pantallas que muestran algo que una venta (o su anulacion) cambia. */
export function revalidarVentas() {
  for (const ruta of ["/", "/ventas", "/clientes", "/materiales", "/reportes"]) revalidatePath(ruta);
}
