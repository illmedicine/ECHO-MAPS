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
          <Image src={`${basePath}/logo.png`} alt="Echo Vue by Illy Robotics" width={340} height={340} unoptimized style={{ background: "transparent" }} />
        </div>
        <p className="text-xl mb-8 max-w-xl mx-auto leading-relaxed">
          Your home, understood. <span style={{ color: "var(--gh-text-muted)" }}>Sense every room with WiFi — no cameras, no wearables.</span>
        </p>

        <div className="flex gap-4 justify-center mb-16">
          <Link
            href="/auth/signin"
            className="btn-primary px-8 py-3 rounded-xl font-semibold text-base"
          >
            Get Started
          </Link>
          <a
            href="#how-it-works"
            className="px-8 py-3 border rounded-xl font-semibold hover:border-[var(--gh-text-muted)] transition"
            style={{ borderColor: "var(--gh-border)" }}
          >
            Learn More
          </a>
        </div>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full mb-16">
        <FeatureCard
          title="Know Who's Home"
          description="Sense presence, movement, even breathing — all through WiFi. No cameras watching, just quiet awareness."
          icon="🏠"
          color="var(--gh-blue)"
        />
        <FeatureCard
          title="Your Home, Automated"
          description="Lights off when you leave, doors lock at bedtime, AC adjusts to who's around. It just works."
          icon="✨"
          color="var(--gh-yellow)"
        />
        <FeatureCard
          title="Peace of Mind"
          description="Check on loved ones, pets, or your space from anywhere. Private by design — your data stays yours."
          icon="💚"
          color="var(--gh-green)"
        />
      </div>

      {/* How it works */}
      <div className="max-w-4xl w-full mb-16">
        <h2 id="how-it-works" className="text-2xl font-bold text-center mb-2">How It Works</h2>
        <p className="text-sm text-center mb-8" style={{ color: "var(--gh-text-muted)" }}>Set up in minutes, works quietly forever.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: "1", title: "Walk the Room", desc: "A quick camera scan teaches Echo Vue your space", icon: "🚶" },
            { step: "2", title: "Camera Off", desc: "The camera turns off for good. WiFi takes over.", icon: "🔒" },
            { step: "3", title: "Live Awareness", desc: "Know who's where, their activity, even vital signs", icon: "💡" },
            { step: "4", title: "Automate", desc: "Lights, locks, alerts — all hands-free", icon: "🎯" },
          ].map((s) => (
            <div key={s.step} className="text-center p-5 rounded-2xl shadow-sm" style={{ backgroundColor: "var(--gh-surface)" }}>
              <div className="text-3xl mb-3">{s.icon}</div>
              <div className="text-[10px] font-bold mb-1" style={{ color: "var(--gh-blue)" }}>STEP {s.step}</div>
              <h3 className="font-semibold mb-1">{s.title}</h3>
              <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl w-full">
        <PricingCard
          tier="Personal"
          features={["10 Environments", "Presence & activity", "Vital signs", "Basic automations", "72h history"]}
        />
        <PricingCard
          tier="Pro"
          features={["50 Environments", "Vital signs & wellness", "Smart automations", "Real-time alerts", "90-day history", "Family & pet profiles"]}
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
    <div className="p-6 rounded-2xl border shadow-sm" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold mb-2" style={{ color }}>{title}</h3>
      <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>{description}</p>
    </div>
  );
}

function PricingCard({ tier, features, highlighted = false }: { tier: string; features: string[]; highlighted?: boolean }) {
  return (
    <div
      className="p-6 rounded-2xl border shadow-sm"
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
