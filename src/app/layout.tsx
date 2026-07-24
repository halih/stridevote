import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StrideVote",
  description: "Canvassing dashboard for progressive campaigns.",
  applicationName: "StrideVote",
  appleWebApp: { capable: true, title: "StrideVote", statusBarStyle: "default" },
  icons: {
    icon: "/brand/stridevote-icon.svg",
    apple: "/brand/stridevote-icon-square.svg",
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
