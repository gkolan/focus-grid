import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FocusGrid",
    short_name: "FocusGrid",
    description:
      "A single-user, browser-local task field. Your tasks live in this browser profile only.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#1e5546",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
