"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { isBackendConfigured, verifyGoogleToken } from "@/lib/api";

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

  // If already authenticated, redirect to dashboard immediately
  useEffect(() => {
    const stored = localStorage.getItem("echo_maps_user");
    if (stored) {
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
          width: 320,
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [handleCredentialResponse]);

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8" style={{ backgroundColor: "var(--gh-bg)" }}>
      <div className="max-w-md w-full text-center">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image src={`${basePath}/logo.png`} alt="Echo Vue by Illy Robotics" width={374} height={374} unoptimized style={{ background: "transparent" }} />
        </div>

        <div className="p-8 rounded-2xl shadow-sm" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
          <h2 className="text-xl font-semibold mb-6">Sign in to continue</h2>

          {!GOOGLE_CLIENT_ID ? (
            <div className="text-sm p-4 rounded-xl" style={{ backgroundColor: "rgba(245,197,66,0.08)", color: "var(--gh-yellow)" }}>
              <p className="font-semibold mb-1">OAuth not configured</p>
              <p>
                Set <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in your environment
                to enable Google Sign-In.
              </p>
            </div>
          ) : (
            <div className="flex justify-center">
              <div id="google-signin-button" />
            </div>
          )}

          <p className="mt-6 text-sm" style={{ color: "var(--gh-text-muted)" }}>
            No cameras. No wearables. Pure WiFi sensing.
          </p>
        </div>

        <a
          href="/"
          className="mt-8 inline-block text-sm transition hover:opacity-80"
          style={{ color: "var(--gh-text-muted)" }}
        >
          &larr; Back to home
        </a>
      </div>
    </main>
  );
}
