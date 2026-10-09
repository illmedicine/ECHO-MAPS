/**
 * Illy Robotic Instruments — links to the company home page.
 *
 * Every "by Illy Robotic Instruments" mention (logos, footers, credits) goes through
 * these so the URL lives in one place and always opens the company site.
 */

import type { CSSProperties, ReactNode } from "react";

export const COMPANY_URL = "https://www.illyrobotic-ai.com/";
export const COMPANY_NAME = "Illy Robotic Instruments";

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Inline text link to the company site. */
export function CompanyLink({ children, className, style }: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <a href={COMPANY_URL} {...external} className={className ?? "underline hover:no-underline"} style={style} title="Illy Robotic Instruments home page">
      {children ?? COMPANY_NAME}
    </a>
  );
}

/** Wraps a logo (the artwork carries the "by Illy Robotics" mark) so clicking it opens the company site. */
export function LogoLink({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <a href={COMPANY_URL} {...external} aria-label="Illy Robotic Instruments home page" title="Illy Robotic Instruments home page" className={className ?? "inline-block"}>
      {children}
    </a>
  );
}

/** Footer for the bottom of every page. `tone="dark"` is for the dark-background pages. */
export function CompanyFooter({ tone = "light" }: { tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <footer className="py-6 text-center text-xs" style={{ color: dark ? "#71717a" : "var(--gh-text-muted)" }}>
      Echo Vue by{" "}
      <CompanyLink className="underline hover:no-underline" style={{ color: dark ? "#a1a1aa" : "var(--gh-blue)" }} />
      <span aria-hidden> · </span>
      <CompanyLink className="hover:underline" style={{ color: dark ? "#a1a1aa" : "var(--gh-blue)" }}>illyrobotic-ai.com</CompanyLink>
    </footer>
  );
}
