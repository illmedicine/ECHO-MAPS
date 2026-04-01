import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echo Vue — by Illy Robotics",
  description: "Privacy-first smart environment sensing. See your space without cameras.",
  icons: [
    { rel: "icon", url: "/ECHO-MAPS/logo.png", type: "image/png" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return (
    <html lang="en">
      <body>
        {/* XL transparent logo watermark */}
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${basePath}/logo.png`}
            alt=""
            style={{
              width: 520,
              height: 520,
              opacity: 0.045,
              userSelect: "none",
            }}
          />
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </body>
    </html>
  );
}
