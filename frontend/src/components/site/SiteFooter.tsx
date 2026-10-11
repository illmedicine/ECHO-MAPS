/** Footer for the public site: four columns on desktop, stacked on mobile. */

import Link from "next/link";
import { COMPANY_NAME, COMPANY_URL } from "@/components/CompanyLink";

const COLS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#product", label: "Illy Bridge hardware" },
      { href: "/#insights", label: "History & insights" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/case-study", label: "M6 case study" },
      { href: "/research", label: "Research" },
      { href: "/privacy", label: "Privacy & sensing policy" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/auth/signin", label: "Sign in" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    title: "Company",
    links: [{ href: COMPANY_URL, label: COMPANY_NAME, external: true }],
  },
];

export default function SiteFooter() {
  return (
    <footer className="hero-ink text-slate-300">
      <div className="page-wrap py-14 md:py-16">
        <div className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr] gap-x-6 gap-y-10">
          <div className="col-span-2 md:col-span-1 max-w-xs">
            <p className="font-display text-2xl font-bold text-white">Echo Vue</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Presence sensing from the WiFi you already have. No cameras, no images, nothing that identifies a guest.
            </p>
          </div>
          {COLS.map((c) => (
            <div key={c.title}>
              <p className="kicker text-slate-500 mb-3">{c.title}</p>
              <ul className="space-y-2.5 text-sm">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className="hover:text-white transition">{l.label}</a>
                    ) : (
                      <Link href={l.href} className="hover:text-white transition">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
          <p>&copy; {new Date().getFullYear()} <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-300">{COMPANY_NAME}</a></p>
          <p>Presence, never identity.</p>
        </div>
      </div>
    </footer>
  );
}
