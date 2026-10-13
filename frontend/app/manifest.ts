import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** PAX-05: installable as a Progressive Web App, in the app's white look. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} · ${BRAND.longName}`,
    short_name: BRAND.name,
    description: BRAND.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
