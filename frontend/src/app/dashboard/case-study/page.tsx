"use client";

/** The case study moved to a public page, /case-study. This keeps the old dashboard URL working. */

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function CaseStudyMoved() {
  const router = useRouter();
  useEffect(() => { router.replace("/case-study"); }, [router]);
  return (
    <main className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <p className="text-sm">The case study has moved: <Link href="/case-study" className="underline" style={{ color: "var(--gh-blue)" }}>open it here</Link>.</p>
    </main>
  );
}
