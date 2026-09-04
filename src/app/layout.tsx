import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StrideVote",
  description: "Canvassing dashboard for progressive campaigns.",
  applicationName: "StrideVote",
  appleWebApp: { capable: true, title: "StrideVote", statusBarStyle: "default" },
  icons: {
    // favicon.ico is emitted automatically from src/app/favicon.ico.
    icon: { url: "/brand/stridevote-icon.svg", type: "image/svg+xml" },
    // iOS ignores SVG touch icons, so this must stay a PNG.
    apple: { url: "/brand/stridevote-icon-180.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#10151b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
