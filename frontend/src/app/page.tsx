"use client";

import Link from "next/link";
import Image from "next/image";

export default function Home() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      {/* Hero */}
      <div className="text-center max-w-3xl">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image src={`${basePath}/logo.svg`} alt="Echo Vue" width={80} height={80} unoptimized />
        </div>
        <h1 className="text-5xl font-bold mb-2">
          <span className="text-[var(--gh-blue)]">Echo</span>{" "}
          <span className="text-[var(--gh-green)]">Vue</span>
        </h1>
        <p className="text-lg text-[var(--gh-text-muted)] mb-1">by Illy Robotics</p>
        <p className="text-base text-[var(--gh-text)] mb-8 max-w-xl mx-auto">
          See your space without cameras. Automate your world with WiFi sensing.
        </p>

        <div className="flex gap-4 justify-center mb-16">
          <Link
            href="/auth/signin"
            className="px-8 py-3 bg-[var(--gh-blue)] rounded-full font-semibold hover:opacity-90 transition text-white"
          >
            Get Started
          </Link>
          <Link
            href="/about"
            className="px-8 py-3 border border-[var(--gh-border)] rounded-full font-semibold hover:border-[var(--gh-text-muted)] transition"
          >
            Learn More
          </Link>
        </div>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full mb-16">
        <FeatureCard
          title="Smart Sensing"
          description="WiFi CSI detects presence, movement, and vital signs — no cameras, no wearables, total privacy."
          icon="📡"
          color="var(--gh-blue)"
        />
        <FeatureCard
          title="Automations"
          description="IFTTT-style workflows: lights off when you leave, doors lock when no one's home, AC adjusts to occupancy."
          icon="⚡"
          color="var(--gh-yellow)"
        />
        <FeatureCard
          title="Energy & Security"
          description="Reduce energy bills in factories, secure facilities by activity, identify personnel by RF signatures."
          icon="🛡️"
          color="var(--gh-green)"
        />
      </div>

      {/* How it works */}
      <div className="max-w-4xl w-full mb-16">
        <h2 className="text-2xl font-bold text-center mb-8">How Echo Vue Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: "1", title: "Calibrate", desc: "Quick camera trace learns your space's WiFi signature", icon: "📐" },
            { step: "2", title: "Camera Off", desc: "Camera turns off forever. WiFi CSI takes over.", icon: "📴" },
            { step: "3", title: "Detect", desc: "AI maps presence, movement, breathing, heart rate", icon: "🧠" },
            { step: "4", title: "Automate", desc: "Trigger actions — lights, locks, HVAC, alerts", icon: "🔁" },
          ].map((s) => (
            <div key={s.step} className="text-center p-4 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)" }}>
              <div className="text-3xl mb-2">{s.icon}</div>
              <div className="text-xs text-[var(--gh-blue)] font-bold mb-1">STEP {s.step}</div>
              <h3 className="font-semibold mb-1">{s.title}</h3>
              <p className="text-xs text-[var(--gh-text-muted)]">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl w-full">
        <PricingCard
          tier="Personal"
          features={["2 Spaces", "Activity detection", "Basic automations", "24h playback"]}
        />
        <PricingCard
          tier="Pro"
          features={["10 Spaces", "Vital signs monitoring", "Advanced automations & IFTTT", "30-day history", "Personnel identification"]}
          highlighted
        />
      </div>

      {/* Footer */}
      <footer className="mt-20 text-center text-xs text-[var(--gh-text-muted)] pb-8">
        &copy; {new Date().getFullYear()} Illy Robotics. Echo Vue — Privacy-first smart environment sensing.
      </footer>
    </main>
  );
}

function FeatureCard({ title, description, icon, color }: { title: string; description: string; icon: string; color: string }) {
  return (
    <div className="p-6 rounded-2xl border" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold mb-2" style={{ color }}>{title}</h3>
      <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>{description}</p>
    </div>
  );
}

function PricingCard({ tier, features, highlighted = false }: { tier: string; features: string[]; highlighted?: boolean }) {
  return (
    <div
      className="p-6 rounded-2xl border"
      style={{
        backgroundColor: "var(--gh-surface)",
        borderColor: highlighted ? "var(--gh-blue)" : "var(--gh-border)",
      }}
    >
      <h3 className="text-xl font-bold mb-4">{tier}</h3>
      <ul className="space-y-2">
        {features.map((f) => (
          <li key={f} className="text-sm flex items-center gap-2" style={{ color: "var(--gh-text)" }}>
            <span style={{ color: "var(--gh-green)" }}>✓</span> {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
