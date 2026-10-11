/** Shared header for the signed-in inner pages: breadcrumb, spaced kicker, serif title, subtitle. */

import Link from "next/link";
import type { ReactNode } from "react";

export default function AppPageHeader({ crumb, kicker, title, subtitle }: {
  crumb: string;
  kicker: string;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="mb-7 md:mb-10">
      <nav className="flex items-center gap-2 text-sm mb-4" aria-label="Breadcrumb" style={{ color: "var(--gh-text-muted)" }}>
        <Link href="/dashboard" className="hover:underline">Dashboard</Link>
        <span aria-hidden="true">/</span>
        <span style={{ color: "var(--gh-text)" }}>{crumb}</span>
      </nav>
      <p className="kicker" style={{ color: "var(--gh-blue)" }}>{kicker}</p>
      <h1 className="app-title text-3xl md:text-5xl mt-1.5 leading-[1.08]">{title}</h1>
      {subtitle && <p className="mt-3 text-sm md:text-base max-w-2xl leading-relaxed" style={{ color: "var(--gh-text-muted)" }}>{subtitle}</p>}
    </div>
  );
}
