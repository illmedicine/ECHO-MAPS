import type { Metadata } from "next";
import "./globals.css";
import "./design.css";
import ChunkErrorRecover from "@/components/ChunkErrorRecover";

export const metadata: Metadata = {
  title: "Echo Vue — by Illy Robotics",
  description: "Privacy-first smart environment sensing. See your space without cameras.",
  icons: [
    { rel: "icon", url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo.png`, type: "image/png" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <ChunkErrorRecover />
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </body>
    </html>
  );
}
