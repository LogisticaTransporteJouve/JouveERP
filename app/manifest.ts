import type { MetadataRoute } from "next";

/** Installable web app: opens full screen (no browser bar) from the home
 *  screen. Served at /manifest.webmanifest, outside the auth proxy. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Logística y Transporte Jouve",
    short_name: "Jouve",
    description: "ERP de Logística y Transporte Jouve",
    lang: "es-AR",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#35358a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
