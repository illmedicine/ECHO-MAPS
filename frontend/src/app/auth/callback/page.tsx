"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // If the user lands here directly, check auth state and redirect
    const user = localStorage.getItem("echo_maps_user");
    if (user) {
      router.push("/dashboard");
    } else {
      router.push("/auth/signin");
    }
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-gray-400">Completing sign-in...</p>
    </main>
  );
}
