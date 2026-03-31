"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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

  const handleCredentialResponse = useCallback(
    async (response: GoogleCredentialResponse) => {
      const payload = parseJwt(response.credential);

      // Build user object from Google's ID token
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
          user.id = authResponse.user_id;
        } catch (err) {
          console.error("Backend auth failed, proceeding in demo mode:", err);
        }
      }

      localStorage.setItem("echo_maps_user", JSON.stringify(user));
      router.push("/dashboard");
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

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-[var(--illy-blue)] to-[var(--illy-green)] bg-clip-text text-transparent">
          Echo Maps
        </h1>
        <p className="text-gray-400 mb-8">by Illy Robotics</p>

        <div className="p-8 bg-[var(--illy-surface)] rounded-xl border border-gray-800">
          <h2 className="text-xl font-semibold mb-6">Sign in to continue</h2>

          {!GOOGLE_CLIENT_ID ? (
            <div className="text-yellow-400 text-sm p-4 bg-yellow-400/10 rounded-lg">
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

          <div className="mt-6 text-sm text-gray-500">
            <p>No cameras. No wearables. Pure WiFi sensing.</p>
          </div>
        </div>

        <a
          href="/"
          className="mt-6 inline-block text-sm text-gray-500 hover:text-gray-300 transition"
        >
          ← Back to home
        </a>
      </div>
    </main>
  );
}
