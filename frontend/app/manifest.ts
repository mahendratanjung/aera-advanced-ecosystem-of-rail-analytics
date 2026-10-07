import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** PAX-05: installable as a Progressive Web App. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} · ${BRAND.longName}`,
    short_name: BRAND.name,
    description: BRAND.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#050e1f",
    theme_color: "#050e1f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
