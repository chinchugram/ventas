import { redirect } from "next/navigation";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/** /admin no tiene contenido propio: lleva a la lista de negocios. */
export default async function AdminPage() {
  await requierePermisoPagina("administrarNegocios");
  redirect("/admin/negocios");
}
