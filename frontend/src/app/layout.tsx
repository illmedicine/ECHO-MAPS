import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echo Maps — Illy Robotics",
  description: "Privacy-first environmental digital twin via WiFi CSI sensing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
