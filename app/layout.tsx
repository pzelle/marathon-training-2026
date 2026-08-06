import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marathon HQ · NYC 2026",
  description:
    "Operations board for a 16-week NYC Marathon build — Strava on one side, the forecast on the other, and a scheduler that moves runs around the heat.",
};

export const viewport: Viewport = {
  themeColor: "#1d4e89",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
