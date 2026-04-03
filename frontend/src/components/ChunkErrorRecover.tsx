"use client";

import { useEffect } from "react";

/**
 * Handles stale chunk errors after a new deploy.
 *
 * When GitHub Pages deploys a new build, chunk hashes change.
 * If the browser has the old build manifest cached, client-side
 * navigation will try to load old chunks that no longer exist (404).
 * This component catches those errors and forces a full page reload
 * to fetch the new manifest.
 */
export default function ChunkErrorRecover() {
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      if (
        err &&
        typeof err === "object" &&
        (err.name === "ChunkLoadError" ||
          (err.message && /loading chunk .* failed/i.test(err.message)))
      ) {
        // Prevent the error from appearing in the console
        event.preventDefault();
        // Avoid reload loops: check if we already retried recently
        const key = "chunk_reload_ts";
        const last = Number(sessionStorage.getItem(key) || 0);
        if (Date.now() - last > 10_000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
        }
      }
    };

    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  return null;
}
