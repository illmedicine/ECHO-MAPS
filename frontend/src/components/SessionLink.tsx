"use client";

/**
 * A link whose target depends on whether the visitor is signed in. Public pages (research, case
 * study) use it so a signed-in user still gets "Dashboard" while everyone else gets a way back to
 * the public site or to sign in, instead of being pushed into the login wall. The first render is
 * the signed-out version, so the static page is correct for anonymous visitors before any script runs.
 */

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { hasValidSession } from "@/lib/api";

type Target = { href: string; label: string };

export default function SessionLink({ signedOut, signedIn, className, style }: {
  signedOut: Target;
  signedIn: Target;
  className?: string;
  style?: CSSProperties;
}) {
  const [session, setSession] = useState(false);
  useEffect(() => { setSession(hasValidSession()); }, []);
  const t = session ? signedIn : signedOut;
  return <Link href={t.href} className={className} style={style}>{t.label}</Link>;
}
