import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StrideVote",
    short_name: "StrideVote",
    description: "Canvassing dashboard for progressive campaigns.",
    start_url: "/",
    display: "standalone",
    background_color: "#10151b",
    theme_color: "#185FA5",
    icons: [
      {
        src: "/brand/stridevote-icon-square.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
