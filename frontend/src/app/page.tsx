"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      {/* Hero */}
      <div className="text-center max-w-3xl">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-[var(--illy-blue)] to-[var(--illy-green)] bg-clip-text text-transparent">
          Echo Maps
        </h1>
        <p className="text-xl text-gray-400 mb-2">by Illy Robotics</p>
        <p className="text-lg text-gray-300 mb-8">
          Privacy-first environmental monitoring.
          All the insight of cameras — with none of the cameras.
        </p>

        <div className="flex gap-4 justify-center mb-12">
          <Link
            href="/auth/signin"
            className="px-8 py-3 bg-[var(--illy-blue)] rounded-lg font-semibold hover:opacity-90 transition"
          >
            Sign in with Google
          </Link>
          <Link
            href="/about"
            className="px-8 py-3 border border-gray-600 rounded-lg font-semibold hover:border-gray-400 transition"
          >
            Learn More
          </Link>
        </div>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
        <FeatureCard
          title="2D/3D Map Trace"
          description="Quick camera-assisted calibration learns your space's RF signature. Then the camera turns off — forever."
          icon="📐"
        />
        <FeatureCard
          title="Vital Signs Monitoring"
          description="Detect breathing patterns and heart rate through WiFi signals alone. Perfect for elderly care."
          icon="💓"
        />
        <FeatureCard
          title="Activity Heatmaps"
          description="30-day historical activity visualization across your environments. No wearables needed."
          icon="🗺️"
        />
      </div>

      {/* Pricing Preview */}
      <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl w-full">
        <PricingCard
          tier="Personal"
          features={["2 Places (Home/Office)", "24h 2D/3D Playback", "Basic activity detection"]}
        />
        <PricingCard
          tier="Pro"
          features={[
            "5 Places",
            "Real-time Breathing & Heart-rate alerts",
            "30-day historical heatmaps",
            "Elderly care / Health mode",
          ]}
          highlighted
        />
      </div>
    </main>
  );
}

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  );
}

function PricingCard({
  tier,
  features,
  highlighted = false,
}: {
  tier: string;
  features: string[];
  highlighted?: boolean;
}) {
  return (
    <div
      className={`p-6 rounded-xl border ${
        highlighted
          ? "border-[var(--illy-blue)] bg-[var(--illy-surface)]"
          : "border-gray-800 bg-[var(--illy-surface)]"
      }`}
    >
      <h3 className="text-xl font-bold mb-4">{tier}</h3>
      <ul className="space-y-2">
        {features.map((f) => (
          <li key={f} className="text-gray-300 text-sm flex items-center gap-2">
            <span className="text-[var(--illy-green)]">✓</span> {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
