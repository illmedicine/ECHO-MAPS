"use client";

import Link from "next/link";
import Image from "next/image";

export default function ResearchPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const publishDate = "April 2, 2026";

  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--gh-bg)" }}>
      {/* ── Top Bar ── */}
      <nav
        className="sticky top-0 z-50 border-b backdrop-blur-md"
        style={{
          backgroundColor: "rgba(248,249,252,0.92)",
          borderColor: "var(--gh-border)",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src={`${basePath}/logo.png`}
              alt="Echo Vue"
              width={36}
              height={36}
              unoptimized
              style={{ background: "transparent" }}
            />
            <span className="font-bold text-sm tracking-tight">
              Echo Vue <span style={{ color: "var(--gh-text-muted)" }}>Research</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition hover:bg-black/5"
              style={{ color: "var(--gh-text-muted)" }}
            >
              Home
            </Link>
            <Link
              href="/dashboard"
              className="text-xs font-medium px-4 py-1.5 rounded-lg transition"
              style={{
                backgroundColor: "rgba(66,133,244,0.08)",
                color: "var(--gh-blue)",
              }}
            >
              Open Dashboard
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero Banner ── */}
      <header
        className="relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #1e3a5f 100%)",
        }}
      >
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 50%, rgba(66,133,244,0.3) 0%, transparent 50%), radial-gradient(circle at 80% 30%, rgba(99,102,241,0.2) 0%, transparent 50%)",
            }}
          />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 py-20 md:py-28 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <span
              className="text-[10px] font-bold tracking-[0.2em] uppercase px-3 py-1 rounded-full"
              style={{
                backgroundColor: "rgba(66,133,244,0.15)",
                color: "#93b8f7",
              }}
            >
              Research &amp; White Paper
            </span>
            <span
              className="text-[10px] font-medium tracking-wide uppercase px-3 py-1 rounded-full"
              style={{
                backgroundColor: "rgba(251,188,5,0.12)",
                color: "#fbd24e",
              }}
            >
              Peer Review Draft
            </span>
          </div>
          <h1
            className="text-3xl md:text-5xl font-extrabold leading-tight mb-6"
            style={{ color: "#f1f5f9" }}
          >
            Cross-Modal Spatiotemporal Fusion of WiFi CSI, Vision, and BLE for
            Device-Free Biometric Human Tracking
          </h1>
          <p
            className="text-base md:text-lg max-w-2xl mx-auto leading-relaxed mb-8"
            style={{ color: "#94a3b8" }}
          >
            How Echo Vue transforms ambient radio frequency signals into
            high-fidelity 3D rendered spatial digital twins — without cameras,
            without wearables, and without compromise.
          </p>
          <div className="flex items-center justify-center gap-6 text-sm" style={{ color: "#94a3b8" }}>
            <div className="flex items-center gap-2">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
                style={{ backgroundColor: "rgba(66,133,244,0.2)", color: "#93b8f7" }}
              >
                D
              </div>
              <div className="text-left">
                <p className="font-semibold" style={{ color: "#f1f5f9" }}>
                  DeMarkus Wilson
                </p>
                <p className="text-xs">Illy Robotic Instruments</p>
              </div>
            </div>
            <span style={{ color: "#334155" }}>|</span>
            <span className="text-xs">{publishDate}</span>
            <span style={{ color: "#334155" }}>|</span>
            <span className="text-xs">18 min read</span>
          </div>
        </div>
      </header>

      {/* ── Article Body ── */}
      <article className="max-w-3xl mx-auto px-6 py-16">
        {/* Abstract */}
        <section className="mb-16">
          <div
            className="rounded-2xl p-8 border-l-4"
            style={{
              backgroundColor: "var(--gh-surface)",
              borderLeftColor: "var(--gh-blue)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <h2 className="text-xs font-bold tracking-[0.15em] uppercase mb-4" style={{ color: "var(--gh-blue)" }}>
              Abstract
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "var(--gh-text)" }}>
              The proliferation of ambient radio frequency (RF) signals presents
              an untapped reservoir of transparent data indicators. Traditional
              human activity recognition and spatial tracking rely on
              line-of-sight visual sensors, which are highly susceptible to
              occlusion, environmental degradation, and digital manipulation. We
              present <strong>Echo Vue</strong>, a novel Generative AI rendering
              engine that utilizes cross-modal sensor fusion. By combining Wi-Fi
              Channel State Information (CSI), Bluetooth Low Energy (BLE) RSSI
              matrices, and initial visual coordinate calibration, Echo Vue
              establishes a continuous, non-intrusive biometric tether to human
              targets. We introduce the &ldquo;CSI Anchor Protocol,&rdquo; which
              solves the BLE MAC randomization problem by treating the physical
              RF multipath signature — derived from human bone density and
              micro-Doppler respiratory patterns — as the immutable ground
              truth. This paper details the system architecture and explores its
              transformative implications for healthcare telemetry, forensic
              security, and military defense.
            </p>
          </div>
        </section>

        {/* Section 1 */}
        <Section number="1" title="Introduction">
          <P>
            Modern environments are saturated with electromagnetic signals.
            Wi-Fi, cellular networks, BLE, and satellite GPS continuously
            broadcast through physical space. Yet, this dense network of signal
            and airwave data remains largely underutilized for environmental
            perception.
          </P>
          <P>
            Current computer vision paradigms face critical limitations: cameras
            require line-of-sight, operate poorly in low light, and raise severe
            privacy concerns. More critically, video data is increasingly
            vulnerable to deepfake spoofing. Conversely, pure Wi-Fi sensing
            utilizes the Orthogonal Frequency Division Multiplexing (OFDM)
            subcarriers of modern routers to detect human presence, but
            traditionally lacks the semantic awareness to identify{" "}
            <em>specific</em> individuals in crowded environments.
          </P>
          <P>
            The Echo Vue project bridges this gap. By utilizing existing, readily
            available transceivers, we transform ambient RF noise into
            high-fidelity, 2D/3D rendered spatial twins. Echo Vue hypothesizes
            that biometric RF signatures — specifically mass reflection and
            respiratory micro-vibrations — provide a verifiable cryptographic
            identity that is far more difficult to disguise or spoof than visual
            appearance.
          </P>
        </Section>

        {/* Pull Quote */}
        <PullQuote>
          Echo Vue hypothesizes that biometric RF signatures provide a verifiable
          cryptographic identity that is far more difficult to disguise or spoof
          than visual appearance.
        </PullQuote>

        {/* Section 2 */}
        <Section number="2" title="Methodology: The Echo Vue Architecture">
          <P>
            The core innovation of Echo Vue is its{" "}
            <strong>Cross-Modal Spatiotemporal Alignment</strong>, which shifts
            the computational burden from reactive sensing to predictive
            Generative AI rendering.
          </P>

          <SubSection number="2.1" title="The Visual Handshake (Cross-Modal Calibration)">
            <P>
              To overcome the &ldquo;blindness&rdquo; of raw CSI data, Echo Vue
              initiates a temporary cross-modal calibration phase. A visual
              sensor extracts 3D skeletal keypoints while the Illy Bridge
              hardware simultaneously captures the CSI tensor.
            </P>
            <P>
              The AI engine mathematically maps the visual spatial coordinates to
              the RF multipath disturbances using a cross-attention fusion
              mechanism:
            </P>
            <Equation>
              {"\\mathcal{F}_{fuse} = \\sigma \\left( W_{v} \\mathcal{V}_{k} + W_{c} \\mathcal{C}_{t} \\right)"}
            </Equation>
            <P>
              Once the neural network achieves a 95% confidence threshold mapping
              the physical form to the RF disturbance, the visual sensor is
              deactivated. The target&apos;s biomechanical profile (gait
              periodicity, mass, and bone density RF absorption) is stored as an
              immutable vector embedding.
            </P>
          </SubSection>

          <SubSection number="2.2" title="Active-Passive Sensor Fusion (The CSI Anchor Protocol)">
            <P>
              Echo Vue integrates active device emissions (BLE, GPS) with passive
              reflection (CSI). A primary challenge in modern tracking is the
              continuous 15-minute rotation of randomized BLE MAC addresses by
              iOS and Android devices, designed to prevent passive tracking.
            </P>
            <P>
              Echo Vue bypasses this via the <strong>CSI Anchor Protocol</strong>.
              The Generative Engine assumes the CSI biometric signature as the
              absolute spatial truth. When a new BLE MAC address spawns, the
              system calculates the approximate distance based on the Received
              Signal Strength Indicator (RSSI) using the log-distance path loss
              model:
            </P>
            <Equation>
              {"d = 10^{\\frac{TxPower - RSSI}{10n}}"}
            </Equation>
            <P>
              If the calculated geometric radius of the new MAC address aligns
              precisely with the spatial coordinates of the tracked CSI biometric
              mass, the AI dynamically re-tethers the new MAC to the existing
              user profile. This enables frictionless, zero-registration tracking
              without requiring app permissions.
            </P>
          </SubSection>
        </Section>

        {/* Architecture Infographic — Figure 1 */}
        <div className="my-12 rounded-2xl overflow-hidden border" style={{ borderColor: "var(--gh-border)" }}>
          <ArchitectureInfographic />
          <div
            className="px-6 py-3 text-center text-xs"
            style={{
              backgroundColor: "var(--gh-surface)",
              color: "var(--gh-text-muted)",
            }}
          >
            <strong>Figure 1.</strong> Echo Vue three-phase pipeline: Visual
            Handshake → AI Tethering &amp; RF Profile → Live No-Cam Rendering.
            All available RF perception &amp; detection methods shown.
          </div>
        </div>

        {/* Pull Quote */}
        <PullQuote>
          A person can wear a mask or digitally alter a video feed, but they
          cannot alter their bone density, physical mass, or the specific way
          their body absorbs a 5GHz Wi-Fi wave.
        </PullQuote>

        {/* Section 3 */}
        <Section number="3" title="Implications and Applications">
          <P>
            The ability to accurately monitor and render human activity without
            optical lenses or wearable sensors introduces paradigm-shifting
            capabilities across multiple sectors.
          </P>

          <SubSection number="3.1" title="Healthcare and Clinical Monitoring">
            <P>
              In hospital environments, patient telemetry currently requires
              intrusive wiring or wearable monitors. Echo Vue allows for the
              continuous, non-contact monitoring of vital statistics. By analyzing
              the micro-Doppler shifts in the Wi-Fi subcarriers, the AI can
              isolate the rhythmic displacement of a patient&apos;s chest wall.
            </P>
            <BulletList
              items={[
                {
                  label: "Continuous Vitals",
                  text: "Real-time extraction of heart rate and respiration without physical contact.",
                },
                {
                  label: "Staff Tracking",
                  text: "Monitoring nurse/physician spatial workflows during critical triage without violating HIPAA through optical recording.",
                },
              ]}
            />
          </SubSection>

          <SubSection number="3.2" title="Security, Forensics, and the Judiciary">
            <P>
              As generative video and deepfakes erode the reliability of optical
              evidence, biometric RF signatures offer a mathematically verifiable
              alternative.
            </P>
            <BulletList
              items={[
                {
                  label: "Court Admissibility",
                  text: "A person can wear a mask or digitally alter a video feed, but they cannot alter their bone density, physical mass, or the specific way their body absorbs a 5GHz Wi-Fi wave. Echo Vue's RF footprinting provides immutable forensic evidence of an individual's presence and actions within a given space.",
                },
              ]}
            />
          </SubSection>

          <SubSection number="3.3" title="Military and Defense">
            <P>
              In tactical urban environments, line-of-sight is a severe
              vulnerability. The Echo Vue engine can utilize ambient cell tower
              data and locally deployed Wi-Fi/BLE nodes to map hostile
              environments. This grants operatives a real-time, 3D-rendered view
              of enemy combatant locations, breathing patterns, and movements
              through structural walls prior to entry.
            </P>
          </SubSection>
        </Section>

        {/* Sector Grid */}
        <div className="my-12">
          <h3
            className="text-xs font-bold tracking-[0.15em] uppercase mb-6 text-center"
            style={{ color: "var(--gh-text-muted)" }}
          >
            Industry Applications
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              {
                icon: "🏥",
                title: "Healthcare",
                items: ["Non-Contact Vitals", "Patient Safety", "Staff Workflow"],
              },
              {
                icon: "🎖️",
                title: "Military & Defense",
                items: ["Through-Wall Imaging", "Urban Combat", "Personnel Tracking"],
              },
              {
                icon: "🏠",
                title: "Home & Elderly Care",
                items: ["Fall Detection", "Breathing Alerts", "Smart Routines"],
              },
              {
                icon: "🏢",
                title: "Business & Retail",
                items: ["Traffic Heatmaps", "Occupancy Analysis", "Space Mgmt"],
              },
              {
                icon: "🎓",
                title: "Universities",
                items: ["Student Flow", "Smart Classrooms", "Campus Safety"],
              },
              {
                icon: "🏭",
                title: "Industrial",
                items: ["HVAC Optimization", "Worker Safety", "Robotic Integration"],
              },
            ].map((sector) => (
              <div
                key={sector.title}
                className="rounded-xl p-4 border"
                style={{
                  backgroundColor: "var(--gh-surface)",
                  borderColor: "var(--gh-border)",
                }}
              >
                <span className="text-2xl">{sector.icon}</span>
                <h4 className="font-semibold text-sm mt-2 mb-2">{sector.title}</h4>
                <ul className="space-y-1">
                  {sector.items.map((item) => (
                    <li
                      key={item}
                      className="text-xs flex items-start gap-1.5"
                      style={{ color: "var(--gh-text-muted)" }}
                    >
                      <span style={{ color: "var(--gh-green)" }}>•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4 */}
        <Section number="4" title="Ethical Considerations and Future Work">
          <P>
            While humanity navigates the long-term biological concerns of RF
            saturation, Echo Vue proposes that we extract maximal utility from the
            airwaves already penetrating our environments.
          </P>
          <P>
            Future iterations of the Echo Vue engine will focus on integrating
            broader signal bands — such as Ultra-Wideband (UWB) and localized 5G
            millimeter-wave data — to increase the resolution of the 3D
            Generative rendering engine.
          </P>
        </Section>

        {/* Section 5 */}
        <Section number="5" title="Conclusion">
          <P>
            Echo Vue demonstrates that by aligning transparent data indicators —
            Wi-Fi CSI, BLE, and visual ground truth — we can create a robust,
            privacy-first perception engine. By treating the human body&apos;s
            interaction with the electromagnetic spectrum as a unique, trackable
            signature, we move beyond the limitations of the camera lens and into
            the future of true environmental awareness.
          </P>
        </Section>

        {/* About the Author */}
        <div
          className="mt-16 rounded-2xl p-8 border"
          style={{
            backgroundColor: "var(--gh-surface)",
            borderColor: "var(--gh-border)",
          }}
        >
          <div className="flex items-start gap-5">
            <div
              className="w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center text-2xl font-bold"
              style={{
                background: "linear-gradient(135deg, var(--gh-blue), var(--gh-accent))",
                color: "white",
              }}
            >
              D
            </div>
            <div>
              <p
                className="text-[10px] font-bold tracking-[0.15em] uppercase mb-1"
                style={{ color: "var(--gh-blue)" }}
              >
                About the Author
              </p>
              <h3 className="font-bold text-lg mb-1">DeMarkus Wilson</h3>
              <p className="text-sm mb-3" style={{ color: "var(--gh-text-muted)" }}>
                Founder &amp; CEO, Illy Robotic Instruments
              </p>
              <p className="text-sm leading-relaxed" style={{ color: "var(--gh-text-muted)" }}>
                DeMarkus Wilson is the founder of Illy Robotic Instruments and
                the architect of the Echo Vue platform. His work focuses on
                cross-modal AI systems that fuse ambient radio frequency data
                with generative rendering to create privacy-first spatial
                intelligence. Echo Vue represents a new class of environmental
                perception technology — one where the electromagnetic spectrum
                itself becomes the sensor.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div
          className="mt-12 rounded-2xl p-10 text-center"
          style={{
            background: "linear-gradient(135deg, #0f172a, #1e3a5f)",
          }}
        >
          <h3 className="text-xl font-bold mb-3" style={{ color: "#f1f5f9" }}>
            Experience Echo Vue
          </h3>
          <p className="text-sm mb-6 max-w-md mx-auto" style={{ color: "#94a3b8" }}>
            See the technology in action. Set up your first environment in
            minutes — cameras off, WiFi on.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/auth/signin"
              className="btn-primary px-8 py-3 rounded-xl font-semibold text-sm"
            >
              Get Started Free
            </Link>
            <Link
              href="/"
              className="px-8 py-3 rounded-xl font-semibold text-sm border transition"
              style={{ borderColor: "#334155", color: "#94a3b8" }}
            >
              Learn More
            </Link>
          </div>
        </div>
      </article>

      {/* Footer */}
      <footer
        className="border-t py-8 text-center"
        style={{ borderColor: "var(--gh-border)" }}
      >
        <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
          &copy; {new Date().getFullYear()} Illy Robotic Instruments &middot;{" "}
          <Link href="/" className="underline hover:no-underline">
            illyrobotics.com
          </Link>{" "}
          &middot; Echo Vue — Future-Proof Perception.
        </p>
      </footer>
    </main>
  );
}

/* ── Article Layout Components ── */

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <div className="flex items-baseline gap-3 mb-5">
        <span
          className="text-xs font-bold tabular-nums"
          style={{ color: "var(--gh-blue)" }}
        >
          {number}.
        </span>
        <h2 className="text-2xl font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SubSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8 ml-1">
      <h3 className="text-lg font-semibold mb-3">
        <span className="text-sm font-medium mr-2" style={{ color: "var(--gh-text-muted)" }}>
          {number}
        </span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[15px] leading-[1.85] mb-4"
      style={{ color: "var(--gh-text)" }}
    >
      {children}
    </p>
  );
}

function PullQuote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote
      className="my-12 py-8 px-8 rounded-2xl border-l-4 relative"
      style={{
        backgroundColor: "rgba(66,133,244,0.03)",
        borderLeftColor: "var(--gh-blue)",
      }}
    >
      <span
        className="absolute -top-2 left-6 text-5xl leading-none"
        style={{ color: "var(--gh-blue)", opacity: 0.15 }}
      >
        &ldquo;
      </span>
      <p className="text-lg md:text-xl font-medium italic leading-relaxed relative z-10" style={{ color: "var(--gh-text)" }}>
        {children}
      </p>
      <cite
        className="block mt-4 text-xs not-italic font-semibold"
        style={{ color: "var(--gh-text-muted)" }}
      >
        — DeMarkus Wilson, Illy Robotic Instruments
      </cite>
    </blockquote>
  );
}

function Equation({ children }: { children: string }) {
  return (
    <div
      className="my-6 py-5 px-6 rounded-xl text-center font-mono text-sm overflow-x-auto"
      style={{
        backgroundColor: "var(--gh-card)",
        border: "1px solid var(--gh-border)",
        color: "var(--gh-text)",
      }}
    >
      <code>{children}</code>
    </div>
  );
}

function BulletList({
  items,
}: {
  items: { label: string; text: string }[];
}) {
  return (
    <ul className="space-y-3 my-4 ml-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-3">
          <span
            className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: "var(--gh-blue)" }}
          />
          <div>
            <strong className="text-sm">{item.label}:</strong>{" "}
            <span className="text-sm" style={{ color: "var(--gh-text-muted)" }}>
              {item.text}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ══════════════════════════════════════════════════
   Architecture Infographic — Figure 1
   Full SVG-based diagram showing 3-phase pipeline,
   all RF perception methods, and industry verticals.
   ══════════════════════════════════════════════════ */

function ArchitectureInfographic() {
  return (
    <div style={{ backgroundColor: "#f8faff", padding: "2rem 1rem" }}>
      <svg viewBox="0 0 1100 760" xmlns="http://www.w3.org/2000/svg" className="w-full" style={{ maxWidth: 1100, margin: "0 auto", display: "block" }}>
        <defs>
          <linearGradient id="igBg" x1="0" y1="0" x2="1100" y2="760" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f0f5ff" />
            <stop offset="100%" stopColor="#e8f0fe" />
          </linearGradient>
          <linearGradient id="igPhase1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <linearGradient id="igPhase2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id="igPhase3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <filter id="igShadow">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.10" />
          </filter>
          <marker id="igArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
          <marker id="igArrowBlue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
          </marker>
        </defs>

        {/* Background */}
        <rect width="1100" height="760" rx="16" fill="url(#igBg)" />

        {/* ── Title ── */}
        <text x="550" y="34" textAnchor="middle" fontSize="20" fontWeight="800" fill="#1e293b" fontFamily="system-ui, sans-serif">
          Echo Vue by Illy Robotics
        </text>
        <text x="550" y="54" textAnchor="middle" fontSize="12" fill="#64748b" fontFamily="system-ui, sans-serif">
          Ambient RF Perception &amp; Generative Digital Twins — Frictionless Pipeline
        </text>

        {/* ══ PHASE 1 ══ */}
        <rect x="20" y="75" width="340" height="310" rx="12" fill="white" filter="url(#igShadow)" />
        <rect x="20" y="75" width="340" height="36" rx="12" fill="url(#igPhase1)" />
        <rect x="20" y="99" width="340" height="12" fill="url(#igPhase1)" />
        <text x="190" y="98" textAnchor="middle" fontSize="12" fontWeight="700" fill="white" fontFamily="system-ui">Phase 1: Setup &amp; Fusion</text>

        {/* Camera icon */}
        <circle cx="70" cy="148" r="22" fill="#eff6ff" stroke="#3b82f6" strokeWidth="1.5" />
        <text x="70" y="153" textAnchor="middle" fontSize="18">📷</text>
        <text x="70" y="178" textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui">DensePose /</text>
        <text x="70" y="188" textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui">MediaPipe</text>

        {/* Arrow cam → router */}
        <line x1="95" y1="148" x2="130" y2="148" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#igArrow)" />

        {/* Router / ESP32 */}
        <circle cx="160" cy="148" r="22" fill="#eff6ff" stroke="#3b82f6" strokeWidth="1.5" />
        <text x="160" y="153" textAnchor="middle" fontSize="18">📡</text>
        <text x="160" y="178" textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui">ESP32-S3</text>
        <text x="160" y="188" textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui">WiFi 6 + BLE</text>

        {/* Arrow router → AI */}
        <line x1="185" y1="148" x2="220" y2="148" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#igArrow)" />

        {/* AI Engine */}
        <circle cx="250" cy="148" r="22" fill="#dbeafe" stroke="#2563eb" strokeWidth="2" />
        <text x="250" y="153" textAnchor="middle" fontSize="16">🧠</text>
        <text x="250" y="178" textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui">AI Generative</text>
        <text x="250" y="188" textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui">Backend Engine</text>

        {/* Phase 1 Detection Methods */}
        <rect x="35" y="200" width="310" height="170" rx="8" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
        <text x="190" y="218" textAnchor="middle" fontSize="9" fontWeight="700" fill="#334155" fontFamily="system-ui">RF PERCEPTION INPUTS</text>

        {/* Method chips */}
        {[
          { label: "WiFi CSI (802.11ac/ax)", desc: "52+ subcarrier amplitude & phase", y: 232, color: "#3b82f6" },
          { label: "BLE 5.x Passive Scan", desc: "RSSI, manufacturer, MAC rotation", y: 256, color: "#8b5cf6" },
          { label: "BLE Address-Type Detection", desc: "Public vs random, OS fingerprint", y: 280, color: "#a855f7" },
          { label: "CSI Multipath Reflections", desc: "Channel impulse response per antenna", y: 304, color: "#0ea5e9" },
          { label: "RF Absorption Signatures", desc: "Body mass, bone density, gait profile", y: 328, color: "#14b8a6" },
          { label: "Doppler Micro-Motion", desc: "Breathing, heartbeat, fall detection", y: 352, color: "#06b6d4" },
        ].map((m, i) => (
          <g key={i}>
            <rect x="42" y={m.y} width="8" height="8" rx="2" fill={m.color} />
            <text x="56" y={m.y + 8} fontSize="8.5" fontWeight="600" fill="#1e293b" fontFamily="system-ui">{m.label}</text>
            <text x="220" y={m.y + 8} fontSize="7.5" fill="#64748b" fontFamily="system-ui">{m.desc}</text>
          </g>
        ))}

        {/* Phase 1 bottom label */}
        <text x="190" y="383" textAnchor="middle" fontSize="8" fill="#64748b" fontFamily="system-ui" fontStyle="italic">
          Camera captures ground truth pose. CSI &amp; BLE mapped to skeletal structure.
        </text>

        {/* ══ ARROW Phase 1 → 2 ══ */}
        <line x1="365" y1="230" x2="395" y2="230" stroke="#3b82f6" strokeWidth="2" markerEnd="url(#igArrowBlue)" />

        {/* ══ PHASE 2 ══ */}
        <rect x="400" y="75" width="300" height="310" rx="12" fill="white" filter="url(#igShadow)" />
        <rect x="400" y="75" width="300" height="36" rx="12" fill="url(#igPhase2)" />
        <rect x="400" y="99" width="300" height="12" fill="url(#igPhase2)" />
        <text x="550" y="98" textAnchor="middle" fontSize="12" fontWeight="700" fill="white" fontFamily="system-ui">Phase 2: AI Tethering &amp; Profile</text>

        {/* Human silhouette with RF waves */}
        <circle cx="550" cy="170" r="40" fill="#f5f3ff" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 2" />
        <text x="550" y="178" textAnchor="middle" fontSize="36">🧍</text>
        {/* RF waves around person */}
        {[45, 90, 135, 180, 225, 270, 315, 360].map((deg, i) => {
          const r = 48;
          const cx = 550 + Math.cos((deg * Math.PI) / 180) * r;
          const cy = 170 + Math.sin((deg * Math.PI) / 180) * r;
          return <circle key={i} cx={cx} cy={cy} r="3" fill="#8b5cf6" opacity="0.4" />;
        })}
        <text x="550" y="228" textAnchor="middle" fontSize="9" fontWeight="700" fill="#5b21b6" fontFamily="system-ui">RF Profile Vector</text>

        {/* Tethering methods */}
        <rect x="415" y="245" width="270" height="125" rx="8" fill="#faf5ff" stroke="#e9d5ff" strokeWidth="1" />
        <text x="550" y="262" textAnchor="middle" fontSize="9" fontWeight="700" fill="#5b21b6" fontFamily="system-ui">CROSS-MODAL FUSION &amp; TETHERING</text>

        {[
          { icon: "🔗", label: "CSI Anchor Protocol", desc: "Re-tethers rotating BLE MACs via spatial alignment" },
          { icon: "🧬", label: "LatentCSI Deep Embedding", desc: "512-dim biometric vector: gait, mass, bone density" },
          { icon: "📊", label: "SpatialAttentionGAN", desc: "Subcarrier attention for dominant motion features" },
          { icon: "🎯", label: "95% Confidence Threshold", desc: "Camera deactivates once profile converges" },
        ].map((m, i) => (
          <g key={i}>
            <text x="425" y={280 + i * 22} fontSize="12">{m.icon}</text>
            <text x="442" y={280 + i * 22} fontSize="8.5" fontWeight="600" fill="#1e293b" fontFamily="system-ui">{m.label}</text>
            <text x="442" y={291 + i * 22} fontSize="7" fill="#64748b" fontFamily="system-ui">{m.desc}</text>
          </g>
        ))}

        <text x="550" y="383" textAnchor="middle" fontSize="8" fill="#64748b" fontFamily="system-ui" fontStyle="italic">
          LatentCSI creates deep biometric RF signature. Confidence threshold met.
        </text>

        {/* ══ ARROW Phase 2 → 3 ══ */}
        <line x1="705" y1="230" x2="735" y2="230" stroke="#8b5cf6" strokeWidth="2" markerEnd="url(#igArrowBlue)" />

        {/* ══ PHASE 3 ══ */}
        <rect x="740" y="75" width="340" height="310" rx="12" fill="white" filter="url(#igShadow)" />
        <rect x="740" y="75" width="340" height="36" rx="12" fill="url(#igPhase3)" />
        <rect x="740" y="99" width="340" height="12" fill="url(#igPhase3)" />
        <text x="910" y="98" textAnchor="middle" fontSize="12" fontWeight="700" fill="white" fontFamily="system-ui">Phase 3: Live No-Cam Mode</text>

        {/* Camera off icon */}
        <circle cx="820" cy="148" r="20" fill="#f0fdf4" stroke="#10b981" strokeWidth="1.5" />
        <text x="820" y="153" textAnchor="middle" fontSize="14">📷</text>
        <line x1="806" y1="138" x2="834" y2="158" stroke="#ef4444" strokeWidth="2.5" />
        <text x="820" y="178" textAnchor="middle" fontSize="8" fill="#059669" fontWeight="600" fontFamily="system-ui">Camera OFF</text>

        {/* Digital twin */}
        <circle cx="910" cy="148" r="20" fill="#f0fdf4" stroke="#10b981" strokeWidth="1.5" />
        <text x="910" y="153" textAnchor="middle" fontSize="16">🏠</text>
        <text x="910" y="178" textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui">Digital Twin</text>

        {/* Phone */}
        <circle cx="1000" cy="148" r="20" fill="#f0fdf4" stroke="#10b981" strokeWidth="1.5" />
        <text x="1000" y="153" textAnchor="middle" fontSize="16">📱</text>
        <text x="1000" y="178" textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui">2D/3D Render</text>

        <line x1="842" y1="148" x2="888" y2="148" stroke="#64748b" strokeWidth="1" markerEnd="url(#igArrow)" />
        <line x1="932" y1="148" x2="978" y2="148" stroke="#64748b" strokeWidth="1" markerEnd="url(#igArrow)" />

        {/* Tracking capabilities */}
        <rect x="755" y="195" width="310" height="175" rx="8" fill="#f0fdf4" stroke="#bbf7d0" strokeWidth="1" />
        <text x="910" y="213" textAnchor="middle" fontSize="9" fontWeight="700" fill="#065f46" fontFamily="system-ui">CONTINUOUS DEVICE-FREE TRACKING</text>

        {[
          { icon: "👤", label: "Multi-Person Tracking", desc: "Simultaneous RF signature discrimination" },
          { icon: "💓", label: "Non-Contact Vitals", desc: "Heart rate, breathing from micro-Doppler" },
          { icon: "🦴", label: "Skeletal Reconstruction", desc: "WaveFormer generates 3D pose from CSI" },
          { icon: "🗺️", label: "Spatial Heatmaps", desc: "Occupancy, traffic flow, dwell time" },
          { icon: "⚡", label: "Fall Detection", desc: "Sudden velocity change in CSI amplitude" },
          { icon: "🔒", label: "Privacy-First", desc: "No cameras, no wearables, no registration" },
          { icon: "🌐", label: "Through-Wall Sensing", desc: "WiFi penetrates walls — tracks across rooms" },
        ].map((m, i) => (
          <g key={i}>
            <text x="765" y={232 + i * 21} fontSize="11">{m.icon}</text>
            <text x="782" y={232 + i * 21} fontSize="8.5" fontWeight="600" fill="#1e293b" fontFamily="system-ui">{m.label}</text>
            <text x="910" y={232 + i * 21} fontSize="7.5" fill="#64748b" fontFamily="system-ui">{m.desc}</text>
          </g>
        ))}

        <text x="910" y="383" textAnchor="middle" fontSize="8" fill="#64748b" fontFamily="system-ui" fontStyle="italic">
          Tracks people/objects using ONLY WiFi CSI reflections. Non-intrusive.
        </text>

        {/* ══ BOTTOM: INDUSTRY APPLICATIONS ══ */}
        <rect x="20" y="410" width="1060" height="28" rx="8" fill="#1e293b" />
        <text x="550" y="429" textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="system-ui" letterSpacing="2">
          INDUSTRY APPLICATIONS
        </text>

        {/* Industry cards */}
        {[
          { icon: "🏥", title: "Healthcare", items: ["Non-Contact Vitals", "Patient Safety", "Fall Detection", "Staff Workflow"], color: "#ef4444", x: 20 },
          { icon: "🎖️", title: "Military & Defense", items: ["Through-Wall Imaging", "Urban Combat Recon", "Personnel Tracking", "Base Security"], color: "#f59e0b", x: 197 },
          { icon: "🏡", title: "Home & Elderly Care", items: ["Fall Detection", "Breathing Alerts", "Privacy Security", "Smart Routines"], color: "#10b981", x: 374 },
          { icon: "🏢", title: "Business & Retail", items: ["Foot Traffic Heatmaps", "Occupancy Analysis", "Productivity", "Space Mgmt"], color: "#3b82f6", x: 551 },
          { icon: "🎓", title: "Education", items: ["Student Engagement", "Smart Classrooms", "Campus Safety", "Resource Alloc."], color: "#8b5cf6", x: 728 },
          { icon: "🏭", title: "Industrial & Smart", items: ["HVAC Optimization", "Occupancy-Based", "Worker Safety", "Robotic Integration"], color: "#f97316", x: 905 },
        ].map((sector, i) => (
          <g key={i}>
            <rect x={sector.x} y="450" width="170" height="148" rx="10" fill="white" filter="url(#igShadow)" />
            <rect x={sector.x} y="450" width="170" height="4" rx="2" fill={sector.color} />
            <text x={sector.x + 85} y="478" textAnchor="middle" fontSize="22">{sector.icon}</text>
            <text x={sector.x + 85} y="496" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1e293b" fontFamily="system-ui">{sector.title}</text>
            {sector.items.map((item, j) => (
              <g key={j}>
                <circle cx={sector.x + 28} cy={512 + j * 17} r="2" fill={sector.color} />
                <text x={sector.x + 36} y={515 + j * 17} fontSize="8" fill="#475569" fontFamily="system-ui">{item}</text>
              </g>
            ))}
          </g>
        ))}

        {/* ── Bottom: Frictionless flow ── */}
        <rect x="20" y="612" width="1060" height="52" rx="10" fill="white" filter="url(#igShadow)" />
        <text x="550" y="632" textAnchor="middle" fontSize="10" fontWeight="700" fill="#1e293b" fontFamily="system-ui">
          FRICTIONLESS ONBOARDING FLOW
        </text>
        {[
          { step: "1", label: "Place Illy Bridge", icon: "📡" },
          { step: "2", label: "Camera Calibration", icon: "📷" },
          { step: "3", label: "Walk the Room", icon: "🚶" },
          { step: "4", label: "AI Learns You", icon: "🧠" },
          { step: "5", label: "Camera Off Forever", icon: "✅" },
          { step: "6", label: "Live Digital Twin", icon: "🏠" },
        ].map((s, i) => {
          const sx = 80 + i * 170;
          return (
            <g key={i}>
              <text x={sx} y="656" textAnchor="middle" fontSize="14">{s.icon}</text>
              <text x={sx + 18} y="656" textAnchor="start" fontSize="8" fill="#475569" fontFamily="system-ui">{s.label}</text>
              {i < 5 && <text x={sx + 120} y="656" textAnchor="middle" fontSize="10" fill="#94a3b8">→</text>}
            </g>
          );
        })}

        {/* Footer */}
        <text x="20" y="748" fontSize="8" fill="#94a3b8" fontFamily="system-ui">www.illyrobotics.com</text>
        <text x="1080" y="748" textAnchor="end" fontSize="8" fontWeight="700" fill="#64748b" fontFamily="system-ui">FUTURE-PROOF PERCEPTION.</text>
      </svg>
    </div>
  );
}
