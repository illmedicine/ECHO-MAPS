"use client";

/**
 * Header for the public site (landing, research, case study, privacy, sign-in).
 * Sticky, translucent, with a mobile menu. Signed-in visitors see "Dashboard"; everyone else
 * sees "Sign in" and "Get started". The first render is the signed-out version so the static
 * page is right for anonymous visitors before any script runs.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { hasValidSession } from "@/lib/api";

const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#product", label: "Hardware" },
  { href: "/case-study", label: "Case study" },
  { href: "/research", label: "Research" },
];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  useEffect(() => { setSession(hasValidSession()); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur-md" style={{ backgroundColor: "rgba(255,255,255,0.86)", borderColor: "var(--gh-border)" }}>
      <div className="page-wrap h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0" onClick={() => setOpen(false)} aria-label="Echo Vue home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${basePath}/favicon.svg`} alt="" width={28} height={28} />
          <span className="leading-none">
            <span className="block font-display text-lg font-bold">Echo Vue</span>
            <span className="block kicker mt-0.5 hidden sm:block" style={{ color: "var(--gh-text-muted)", fontSize: 9 }}>by Illy Robotic Instruments</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="transition hover:opacity-70" style={{ color: "var(--gh-text-muted)" }}>{l.label}</Link>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {session ? (
            <Link href="/dashboard" className="btn-pill btn-pill-ink" style={{ minHeight: "2.4rem", padding: "0.5rem 1.2rem" }}>Open dashboard</Link>
          ) : (
            <>
              <Link href="/auth/signin" className="text-sm font-medium transition hover:opacity-70">Sign in</Link>
              <Link href="/auth/signin" className="btn-pill btn-pill-ink" style={{ minHeight: "2.4rem", padding: "0.5rem 1.2rem" }}>Get started</Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-xl"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t px-5 pb-5 pt-2" style={{ borderColor: "var(--gh-border)", backgroundColor: "rgba(255,255,255,0.98)" }}>
          <nav className="flex flex-col" aria-label="Mobile">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="py-3.5 text-base border-b" style={{ borderColor: "var(--gh-border)" }}>{l.label}</Link>
            ))}
            <Link href="/privacy" onClick={() => setOpen(false)} className="py-3.5 text-base border-b" style={{ borderColor: "var(--gh-border)" }}>Privacy &amp; sensing policy</Link>
          </nav>
          <div className="mt-4 flex flex-col gap-2.5">
            {session ? (
              <Link href="/dashboard" onClick={() => setOpen(false)} className="btn-pill btn-pill-ink">Open dashboard</Link>
            ) : (
              <>
                <Link href="/auth/signin" onClick={() => setOpen(false)} className="btn-pill btn-pill-ink">Get started</Link>
                <Link href="/auth/signin" onClick={() => setOpen(false)} className="btn-pill btn-pill-line">Sign in</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
