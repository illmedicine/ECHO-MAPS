import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echo Vue — by Illy Robotics",
  description: "Privacy-first smart environment sensing. See your space without cameras.",
  icons: [
    { rel: "icon", url: "/ECHO-MAPS/logo.svg", type: "image/svg+xml" },
    { rel: "icon", url: "/ECHO-MAPS/favicon.svg", type: "image/svg+xml" },
  ],
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
