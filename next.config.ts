import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solo desarrollo: permite abrir `npm run dev` desde el celular en la misma Wi-Fi.
  // Sin esto Next bloquea los recursos de dev (incluido el JS que hidrata la app)
  // y los botones no responden. Si cambia la IP de la PC, actualizarla aca.
  allowedDevOrigins: ["192.168.1.8"],
  // La app no usa `next/image`. Sin optimizador, `/_next/image` no procesa nada
  // (menos superficie: recomendacion 4.2 de docs/auditoria-ola-3.md) y, como
  // cualquier otra ruta, pide sesion (el proxy ya no la excluye).
  images: { unoptimized: true },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // `output: "standalone"` esta desactivado a proposito: hace que `next start`
  // deje de funcionar y obliga a copiar `.next/static` a mano. La app todavia
  // no se corre en Docker (solo la base), asi que `npm start` tiene que andar.
  // Cuando se containerice la app, se activa y se documenta el COPY de static.
};

export default nextConfig;
