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

        {/* Architecture Diagram */}
        <div className="my-12 rounded-2xl overflow-hidden border" style={{ borderColor: "var(--gh-border)" }}>
          <Image
            src={`${basePath}/logo.png`}
            alt="Echo Vue Architecture — Cross-Modal Spatiotemporal Fusion"
            width={800}
            height={400}
            className="w-full"
            unoptimized
            style={{
              backgroundColor: "#0f172a",
              objectFit: "contain",
              padding: "2rem",
            }}
          />
          <div
            className="px-6 py-3 text-center text-xs"
            style={{
              backgroundColor: "var(--gh-surface)",
              color: "var(--gh-text-muted)",
            }}
          >
            <strong>Figure 1.</strong> Echo Vue three-phase pipeline: Visual
            Handshake → AI Tethering &amp; RF Profile → Live No-Cam Rendering
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
