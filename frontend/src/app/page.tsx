import Link from "next/link";
import type { ReactNode } from "react";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { COMPANY_URL } from "@/components/CompanyLink";
import { HeroPair, ScreenImage } from "@/components/marketing/DeviceRenders";

const muted = { color: "var(--gh-text-muted)" } as const;

function Kicker({ children, light }: { children: ReactNode; light?: boolean }) {
  return <p className="kicker mb-3" style={{ color: light ? "#93b8f7" : "var(--gh-blue)" }}>{children}</p>;
}

function H2({ children, light }: { children: ReactNode; light?: boolean }) {
  return (
    <h2 className="font-display text-3xl md:text-5xl font-bold leading-[1.08] max-w-3xl" style={{ color: light ? "#f8fafc" : "var(--gh-text)" }}>
      {children}
    </h2>
  );
}

const STATS = [
  { value: "0", label: "cameras or images" },
  { value: "Public", label: "areas only; guest rooms never sensed" },
  { value: "Anonymous", label: "hashed ids that reset every day" },
  { value: "Honest", label: "estimates are labelled as estimates" },
];

const STEPS = [
  { n: "01", title: "Place a bridge", body: "A small WiFi sensor goes in a hallway, lobby, pool or laundry. It joins the WiFi you already have. There is nothing to calibrate and nobody to walk around the room." },
  { n: "02", title: "It senses motion", body: "The bridge reads how a body disturbs the radio signal and boils it down to a few numbers a second, on the device. Raw signal never leaves it, and no image ever exists." },
  { n: "03", title: "See it live", body: "The dashboard shows which areas are occupied right now, how many people, devices and pets passed through over time, and what the pattern suggests." },
];

const PRIVACY = [
  { t: "No camera, no images", d: "There is no camera input in the product at all. Occupancy was the goal, not identity." },
  { t: "Public areas only", d: "Hallways, lobby, pool and laundry. The backend rejects any sensing zone named like a room, suite or bathroom." },
  { t: "Features, not raw signal", d: "Each bridge reduces the radio signal to a few motion features per second before anything is sent." },
  { t: "Anonymised device counts", d: "Bluetooth addresses are hashed with a salt that changes daily. The dashboard sees counts, never addresses." },
  { t: "Estimates say so", d: "Every figure carries a likely range and a confidence level. With no usable signal, the screen says so instead of guessing." },
  { t: "Short, aggregated memory", d: "History is anonymous per-minute counts, kept 90 days. No raw radio data, no addresses, no identities." },
];

export default function LandingPage() {
  return (
    <div style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <SiteHeader />

      <main>
        {/* ── Cover ── */}
        <section className="hero-ink">
          <div className="page-wrap pt-14 md:pt-24 pb-10 md:pb-16">
            <Kicker light>Presence sensing without cameras</Kicker>
            <h1 className="font-display text-[2.6rem] sm:text-6xl lg:text-[5.25rem] font-bold leading-[1.02] max-w-4xl" style={{ color: "#f8fafc" }}>
              Know how a space is used. Never who is in it.
            </h1>
            <p className="font-prose mt-6 text-lg md:text-2xl leading-snug max-w-3xl" style={{ color: "#cbd5e1" }}>
              Echo Vue turns the WiFi already in your building into live occupancy for hallways, lobbies and other public areas.
              No cameras, no images, nothing that identifies a guest.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3">
              <Link href="/auth/signin" className="btn-pill btn-pill-white">Get started</Link>
              <Link href="/case-study" className="btn-pill btn-pill-ghost-dark">Read the case study</Link>
            </div>
            <p className="mt-5 text-sm">
              <Link href="/research" className="underline hover:no-underline" style={{ color: "#94a3b8" }}>or read the research behind it →</Link>
            </p>

            <HeroPair className="mt-12 md:mt-16" />
            <p className="text-[11px] mt-3" style={{ color: "#94a3b8" }}>
              Left: Illy Bridge 2 beside an ordinary light switch. Right: Illy Bridge Pro. Concept renders; the screens show the real interface with illustrative values.
            </p>

            <dl className="mt-12 md:mt-16 grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-white/10 bg-white/10">
              {STATS.map((s) => (
                <div key={s.value} className="p-5 md:p-6" style={{ backgroundColor: "rgba(7,11,20,0.55)" }}>
                  <dt className="font-display text-2xl md:text-3xl font-bold" style={{ color: "#f8fafc" }}>{s.value}</dt>
                  <dd className="text-xs md:text-sm mt-1" style={{ color: "#94a3b8" }}>{s.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how-it-works" className="page-wrap py-16 md:py-28 scroll-mt-16">
          <Kicker>How it works</Kicker>
          <H2>Three steps. No camera in any of them.</H2>
          <div className="mt-10 md:mt-14 grid grid-cols-1 md:grid-cols-3 gap-5">
            {STEPS.map((s) => (
              <div key={s.n} className="card-edit p-6 md:p-7">
                <p className="font-display text-5xl font-bold" style={{ color: "var(--gh-blue)", opacity: 0.9 }}>{s.n}</p>
                <h3 className="font-display text-2xl font-bold mt-4">{s.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed" style={muted}>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Privacy by architecture ── */}
        <section className="py-16 md:py-28" style={{ backgroundColor: "var(--gh-surface)", borderTop: "1px solid var(--gh-border)", borderBottom: "1px solid var(--gh-border)" }}>
          <div className="page-wrap">
            <Kicker>Privacy by design</Kicker>
            <H2>A policy can be broken. A system that cannot do something is harder to break.</H2>
            <div className="mt-10 md:mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-9">
              {PRIVACY.map((p) => (
                <div key={p.t} className="border-t pt-5" style={{ borderColor: "var(--gh-text)" }}>
                  <h3 className="font-display text-xl font-bold">{p.t}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed" style={muted}>{p.d}</p>
                </div>
              ))}
            </div>
            <p className="mt-10">
              <Link href="/privacy" className="text-sm font-semibold underline hover:no-underline" style={{ color: "var(--gh-blue)" }}>Read the full privacy &amp; sensing policy →</Link>
            </p>
          </div>
        </section>

        {/* ── Hardware ── */}
        <section id="product" className="page-wrap py-16 md:py-28 scroll-mt-16">
          <Kicker>The hardware</Kicker>
          <H2>A plate on the wall. The WiFi you already have.</H2>
          <p className="font-prose mt-5 text-lg max-w-2xl leading-relaxed" style={muted}>
            Two bridges, one idea: a screen that tells you exactly what it is sensing, and a radio. Neither has a camera, a microphone or a speaker.
          </p>
          <div className="mt-10 md:mt-14 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card-edit p-5 md:p-7 flex flex-col">
              <ScreenImage device="e32" kind="dashboard" className="w-full h-auto rounded-xl" />
              <div className="mt-6 flex items-baseline justify-between gap-3 flex-wrap">
                <h3 className="font-display text-2xl font-bold">Illy Bridge 2</h3>
                <p className="kicker" style={{ color: "var(--gh-blue)" }}>The wall plate</p>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed" style={muted}>4.0-inch touchscreen in a standard plate. Presence with an activity level, breathing-rate estimates when someone is still, and anonymised nearby-device counts.</p>
              <p className="mt-4 text-sm"><span className="font-display text-3xl font-bold">$50</span> <span style={muted}>target price per bridge</span></p>
            </div>
            <div className="card-edit p-5 md:p-7 flex flex-col">
              <ScreenImage device="pro" kind="dashboard" className="w-full h-auto max-h-[340px] mx-auto rounded-xl" />
              <div className="mt-6 flex items-baseline justify-between gap-3 flex-wrap">
                <h3 className="font-display text-2xl font-bold">Illy Bridge Pro</h3>
                <p className="kicker" style={{ color: "var(--gh-blue)" }}>The colour display</p>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed" style={muted}>The same sensing on a colour display, for places that want the status on show. Same privacy rules, same anonymous counts.</p>
              <p className="mt-4 text-sm"><span className="font-display text-3xl font-bold">$100</span> <span style={muted}>target price per bridge</span></p>
            </div>
          </div>
        </section>

        {/* ── Insights ── */}
        <section id="insights" className="py-16 md:py-28" style={{ backgroundColor: "var(--gh-surface)", borderTop: "1px solid var(--gh-border)" }}>
          <div className="page-wrap grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <Kicker>History &amp; insights</Kicker>
              <H2>Not just who is there now. What the pattern means.</H2>
              <ul className="mt-7 space-y-3.5 text-[16px] leading-relaxed">
                {[
                  "Estimated people, devices and pets that passed through an area, over an hour, a day or since the bridge last restarted.",
                  "Phones that rotate their Bluetooth address are recognised as one device, so counts are not inflated.",
                  "Busiest hours, how long people linger, and which areas deserve attention.",
                  "Plain-language observations written by AI from aggregated counts only. No device ids or personal data are sent.",
                ].map((t) => (
                  <li key={t} className="flex gap-3"><span aria-hidden="true" className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "var(--gh-blue)" }} /><span>{t}</span></li>
                ))}
              </ul>
            </div>
            <div className="card-edit p-6 md:p-8" aria-label="Illustrative example">
              <p className="kicker" style={muted}>Illustrative example</p>
              <p className="font-display text-xl md:text-2xl font-bold mt-3 leading-snug">About 26 people (likely 18–34) and 31 devices passed through the hallway today.</p>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                {[["~26", "people"], ["~31", "devices"], ["~1", "pet"]].map(([v, l]) => (
                  <div key={l} className="rounded-xl py-3" style={{ backgroundColor: "var(--gh-card)" }}>
                    <p className="font-display text-2xl font-bold">{v}</p>
                    <p className="text-[11px]" style={muted}>{l}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs mt-4 leading-relaxed" style={muted}>Every figure carries a likely range and a confidence level. If a period has little data, it says the counts are probably too low.</p>
            </div>
          </div>
        </section>

        {/* ── From the field ── */}
        <section className="band-ink">
          <div className="page-wrap py-16 md:py-24 text-center">
            <Kicker light>From the field</Kicker>
            <blockquote className="font-display text-2xl md:text-4xl lg:text-5xl font-bold italic leading-snug max-w-4xl mx-auto" style={{ color: "#f8fafc" }}>
              &ldquo;The fact that a signal is invisible is a reason for more care, not less.&rdquo;
            </blockquote>
            <p className="mt-5 text-sm" style={{ color: "#94a3b8" }}>DeMarkus Wilson · Founder &amp; CEO, Illy Robotic Instruments · after three weeks at a Motel 6</p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/case-study" className="btn-pill btn-pill-white">Read the M6 case study</Link>
              <Link href="/research" className="btn-pill btn-pill-ghost-dark">Read the research</Link>
            </div>
          </div>
        </section>

        {/* ── Closing ── */}
        <section className="page-wrap py-16 md:py-28 text-center">
          <h2 className="font-display text-3xl md:text-5xl font-bold leading-[1.08] max-w-3xl mx-auto">See your building the way it actually moves.</h2>
          <p className="font-prose mt-5 text-lg max-w-xl mx-auto" style={muted}>Start with one bridge in one hallway. You will know within a minute whether it is occupied.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/auth/signin" className="btn-pill btn-pill-ink">Get started</Link>
            <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="btn-pill btn-pill-line">Talk to Illy Robotic Instruments</a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
