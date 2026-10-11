"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { CompanyFooter, LogoLink } from "@/components/CompanyLink";
import { hasValidSession, isBackendConfigured, verifyGoogleToken } from "@/lib/api";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, config: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

interface GoogleCredentialResponse {
  credential: string;
  select_by: string;
}

function parseJwt(token: string): Record<string, string> {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
  return JSON.parse(jsonPayload);
}

export default function SignInPage() {
  const router = useRouter();

  const [expired, setExpired] = useState(false);

  // Already signed in with a session the API still accepts: go straight to the dashboard.
  // An expired session stays here so the user can sign in again.
  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).has("expired"));
    if (hasValidSession()) {
      router.replace("/dashboard");
    }
  }, [router]);

  const handleCredentialResponse = useCallback(
    async (response: GoogleCredentialResponse) => {
      const payload = parseJwt(response.credential);

      // Build user object from Google's ID token
      // ALWAYS use Google sub as id — keeps localStorage scoping stable
      // regardless of whether backend is available during login
      const user: Record<string, string> = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        googleToken: response.credential,
      };

      // If backend is configured, verify token and get API JWT
      if (isBackendConfigured()) {
        try {
          const authResponse = await verifyGoogleToken(response.credential);
          user.apiToken = authResponse.access_token;
          user.backendUserId = authResponse.user_id;
        } catch (err) {
          console.error("Backend auth failed, proceeding in demo mode:", err);
        }
      }

      localStorage.setItem("echo_maps_user", JSON.stringify(user));
      router.replace("/dashboard");
    },
    [router]
  );

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      console.warn("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set");
      return;
    }

    // Load the Google Identity Services script
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        itp_support: true,
      });

      const buttonDiv = document.getElementById("google-signin-button");
      if (buttonDiv) {
        window.google?.accounts.id.renderButton(buttonDiv, {
          theme: "filled_black",
          size: "large",
          type: "standard",
          shape: "rectangular",
          text: "signin_with",
          logo_alignment: "left",
          width: Math.min(320, Math.max(200, Math.floor(buttonDiv.parentElement?.clientWidth ?? 320))),
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [handleCredentialResponse]);

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  const muted = { color: "var(--gh-text-muted)" } as const;
  const mark = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${basePath}/favicon.svg`} alt="" width={30} height={30} />
      <span className="font-display text-xl font-bold">Echo Vue</span>
    </>
  );

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      {/* Editorial panel (desktop) */}
      <section className="hero-ink hidden lg:flex flex-col justify-between p-12 xl:p-16">
        <Link href="/" className="flex items-center gap-2.5 text-white w-fit">{mark}</Link>
        <div>
          <p className="kicker mb-4" style={{ color: "#93b8f7" }}>Sign in</p>
          <h1 className="font-display text-5xl xl:text-6xl font-bold leading-[1.05]" style={{ color: "#f8fafc" }}>See how your space is used.</h1>
          <p className="font-prose mt-5 text-lg max-w-md leading-snug" style={{ color: "#cbd5e1" }}>
            Live occupancy for hallways, lobbies and other public areas. No cameras, no wearables, nothing that identifies a guest.
          </p>
        </div>
        <p className="text-xs" style={{ color: "#94a3b8" }}>Presence, never identity.</p>
      </section>

      {/* Sign-in card */}
      <section className="flex flex-col items-center justify-center px-5 py-10 sm:p-10">
        <div className="w-full max-w-md">
          <Link href="/" className="lg:hidden flex items-center justify-center gap-2.5 mb-8">{mark}</Link>

          <div className="card-edit p-7 sm:p-9" style={{ transform: "none" }}>
            <h2 className="font-display text-3xl font-bold">Sign in to continue</h2>
            <p className="text-sm mt-2" style={muted}>Use your Google account. Your rooms and settings stay where you left them.</p>

            {expired && (
              <p className="text-sm mt-5 p-3 rounded-lg" style={{ backgroundColor: "rgba(251,188,5,0.12)", color: "#8a6d00" }} role="status">
                Your session expired. Sign in again to reload live data. Your rooms and settings are kept.
              </p>
            )}

            {!GOOGLE_CLIENT_ID ? (
              <div className="text-sm mt-6 p-4 rounded-xl" style={{ backgroundColor: "rgba(245,197,66,0.12)", color: "#8a6d00" }}>
                <p className="font-semibold mb-1">OAuth not configured</p>
                <p>
                  Set <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in your environment
                  to enable Google Sign-In.
                </p>
              </div>
            ) : (
              <div className="mt-7 flex justify-center">
                <div id="google-signin-button" />
              </div>
            )}

            <p className="mt-7 text-xs text-center" style={muted}>No cameras. No wearables. Pure WiFi sensing.</p>
          </div>

          <div className="mt-6 flex items-center justify-center gap-5 text-sm" style={muted}>
            <Link href="/" className="hover:underline">&larr; Back to home</Link>
            <Link href="/privacy" className="hover:underline">Privacy</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
