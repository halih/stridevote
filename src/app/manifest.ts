import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StrideVote",
    short_name: "StrideVote",
    description: "Canvassing dashboard for progressive campaigns.",
    start_url: "/canvass",
    display: "standalone",
    background_color: "#10151b",
    theme_color: "#185FA5",
    icons: [
      { src: "/brand/stridevote-icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/brand/stridevote-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/stridevote-icon-1024.png", sizes: "1024x1024", type: "image/png" },
    ],
  };
}
