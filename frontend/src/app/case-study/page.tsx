import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY_URL, CompanyFooter, CompanyLink } from "@/components/CompanyLink";
import SessionLink from "@/components/SessionLink";
import { HeroPair, ProBridge, ScreenImage, WallScene, type ScreenKind } from "@/components/marketing/DeviceRenders";

export const metadata: Metadata = {
  title: "The Home That Finally Knows You're Home — Echo Vue by Illy Robotic Instruments",
  description:
    "Three weeks at a Motel 6 led to Echo Vue: WiFi-based presence sensing in a $50 wall plate. The case study, the devices, and the privacy rules behind them.",
};

const SERIF = "Georgia, 'Times New Roman', 'Iowan Old Style', serif";
const muted = { color: "var(--gh-text-muted)" } as const;

function Kicker({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p className="text-[11px] font-bold tracking-[0.22em] uppercase mb-2" style={{ color: light ? "#93b8f7" : "var(--gh-blue)" }}>
      {children}
    </p>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-3xl md:text-4xl font-bold leading-tight mb-5" style={{ fontFamily: SERIF }}>{children}</h2>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5 text-[17px] md:text-lg leading-[1.75]" style={{ fontFamily: SERIF }}>{children}</div>;
}

function PullQuote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="my-10 pl-6 border-l-4 text-2xl md:text-4xl italic leading-snug" style={{ borderColor: "var(--gh-blue)", fontFamily: SERIF }}>
      {children}
    </blockquote>
  );
}

function Spec({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm leading-snug">
      <span style={{ color: "var(--gh-green)" }} aria-hidden>✓</span>
      <span>{children}</span>
    </li>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] mt-2 leading-snug" style={muted}>{children}</p>;
}

const SECTORS: { icon: string; name: string; line: string }[] = [
  { icon: "🏢", name: "Offices", line: "Which meeting rooms, kitchens and floors are actually in use, without badge readers or cameras." },
  { icon: "🏪", name: "Businesses", line: "Foot traffic and dwell time across lobbies, waiting rooms and shop floors, with no faces recorded." },
  { icon: "🏨", name: "Hotels", line: "Hallway, lobby, pool and laundry occupancy for housekeeping and safety. Guest rooms stay off-limits." },
  { icon: "🏥", name: "Hospitals", line: "Corridor and waiting-area occupancy in places where cameras are fraught. Echo Vue is not a medical device and makes no clinical claims." },
  { icon: "🏭", name: "Manufacturing plants", line: "Know a zone is occupied before it matters. A supplement to certified safety systems, never a replacement for them." },
  { icon: "🏠", name: "Homes", line: "A home that knows which rooms are in use. The room is the sensor; nobody has to say a word. Automations are on the roadmap." },
];

const GALLERY: { device: "e32" | "pro"; kind: ScreenKind; title: string; note: string }[] = [
  { device: "e32", kind: "dashboard", title: "Illy Bridge 2: live status", note: "Area, bridge name, network, signal and health, at a glance." },
  { device: "e32", kind: "boot", title: "Illy Bridge 2: startup", note: "The splash screen on power-up." },
  { device: "e32", kind: "setup", title: "Illy Bridge 2: setup", note: "Three steps to put it on your WiFi." },
  { device: "pro", kind: "dashboard", title: "Illy Bridge Pro: live status", note: "The same information on the Pro's colour display." },
  { device: "pro", kind: "boot", title: "Illy Bridge Pro: startup", note: "Power-up." },
  { device: "pro", kind: "networks", title: "Illy Bridge Pro: networks", note: "Pick a network right on the device." },
];

const AREAS = ["Floor 1 Hallway", "Floor 2 Hallway", "Floor 3 Hallway", "Front Desk / Lobby", "Outdoor Pool", "Terrace", "Guest Laundry", "Snack Deli", "Vending Area", "Elevator", "Stairwell"];

const COMPARISON: { row: string; camera: string; rf: string }[] = [
  { row: "What is captured", camera: "An image of a person: face, body, clothing, what they are doing.", rf: "How a body disturbs a radio signal that is already in the room: movement, and at best a breathing rhythm. No image exists." },
  { row: "Can the person see it?", camera: "Usually. A lens is visible, and people understand what it does.", rf: "No. There is nothing to see, hear or feel, so notice has to be deliberate." },
  { row: "Does it stop at the wall?", camera: "Mostly yes: it sees what is in line of sight.", rf: "Not cleanly. Radio passes through walls, so the sensing footprint is a design decision, not a given." },
  { row: "Settled norms", camera: "Decades of signage practice, expectations and case law.", rf: "Few settled norms. People, operators and courts are still working out what this kind of data is." },
  { row: "Risk if misused", camera: "Identification and recording of what people do.", rf: "Inferring presence, routines, and health-adjacent signals about people who never knew they were measured." },
];

const GRAY: { title: string; text: React.ReactNode }[] = [
  { title: "Is it content, or just physics?", text: <>Wiretap and eavesdropping laws were written to protect the <em>content</em> of communications. CSI does not read anyone&apos;s messages; it reads how the channel itself is disturbed. Whether that falls inside or outside rules built for communications is not obvious.</> },
  { title: "Is there an expectation of privacy in a signal?", text: <>Courts have wrestled with technology that senses what people cannot, for example thermal imaging of a home in <em>Kyllo v. United States</em> (2001). That case concerned government use, and a private hotel operator is governed differently, which is part of the uncertainty. Radio that passes through walls raises the same kind of question.</> },
  { title: "Is a body's RF signature a biometric?", text: <>Biometric privacy statutes were written around things like fingerprints, face geometry and voiceprints. A pattern of breathing or movement inferred from radio is not obviously on those lists, but it is derived from a person&apos;s body. It is unclear whether it should be treated as one.</> },
  { title: "When does presence become health data?", text: <>A breathing rate is a vital sign. Collected about identifiable people, it starts to look like health information. Collected as an anonymous rhythm in a corridor, it may not. The line depends on whether anyone can be tied to the data.</> },
  { title: "Who consented?", text: <>In a public area, guests are free to walk through. Do they consent to being measured by something they cannot detect? Signage helps, but it is easy to overlook, and there is no shared standard for what an RF notice should say.</> },
  { title: "Radio does not respect room boundaries", text: <>A sensor in a hallway can pick up effects from beyond the wall. That is a practical privacy risk with no camera equivalent, and it cannot be settled by policy alone. It has to be handled in placement and in what the system is able to do.</> },
];

const DESIGN: { choice: string; why: string; how: string }[] = [
  { choice: "No images or audio in the sensing pipeline", why: "Optical and audio data identify people. The goal was occupancy, not identity.", how: "The RF sensing pipeline never captures or transmits images or audio. The Illy Bridge 2 has no camera, microphone or speaker at all. The Pro adds a speaker and microphone, and is planned to offer an optional camera and biometric scanner; those are separate modules, which are opt-in, need the explicit consent of the people they affect, and need legal review where deployed, biometrics most of all." },
  { choice: "Public areas only", why: "Guest rooms carry the strongest expectation of privacy.", how: "Hallways, lobby, pool, laundry and other common areas are the only places sensed. Guest rooms are only counted on the dashboard, never listed or read, and the backend rejects any sensing zone named like a room, suite or bathroom." },
  { choice: "Features, not raw signal", why: "Raw channel data holds far more than the question being asked.", how: "Each bridge reduces the radio signal to a few motion features per second on the device itself. Raw CSI frames never leave it." },
  { choice: "Anonymised nearby-device counts", why: "A Bluetooth address is a persistent identifier for a person's device.", how: "Addresses are hashed on the bridge with a random salt that rotates every 24 hours; only 3 bytes of the hash are kept, and the backend rejects anything that is not that shape. The dashboard sees counts and signal strength, never addresses." },
  { choice: "Estimates are labelled as estimates", why: "Overclaiming accuracy about people is an ethics problem, not only an engineering one.", how: "Breathing figures and any people-or-pets split carry an 'estimate' label. With no usable signal the screen says 'no breathing signal' or 'not counted' instead of guessing. Live presence readings are never simulated, and heart rate is not reported because it cannot be measured reliably this way." },
  { choice: "Short memory", why: "The less that is kept, the less can be misused.", how: "Live state is held in memory. For the History page the backend also keeps anonymous, aggregated counts per minute (how occupied an area was, how many devices were nearby, breathing rates with no identity attached) for 90 days, and then deletes them. It never stores raw radio data, device addresses, or anything that identifies a person, and there is no database of RF signatures." },
];

export default function CaseStudyPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <nav className="sticky top-0 z-40 border-b backdrop-blur-md" style={{ backgroundColor: "rgba(248,249,252,0.92)", borderColor: "var(--gh-border)" }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <SessionLink signedOut={{ href: "/", label: "← Echo Vue" }} signedIn={{ href: "/dashboard", label: "← Dashboard" }} className="text-sm transition hover:opacity-80" style={muted} />
          <span className="text-[11px] font-bold tracking-[0.28em] uppercase hidden sm:block">Echo Vue <span style={muted}>· The Sensing Issue</span></span>
          <Link href="/privacy" className="text-xs hover:underline" style={{ color: "var(--gh-blue)" }}>Privacy &amp; Sensing Policy</Link>
        </div>
      </nav>

      {/* ── Cover ── */}
      <header style={{ background: "radial-gradient(120% 90% at 20% 0%, #1e3a5f 0%, #0f172a 55%, #070b14 100%)" }}>
        <div className="max-w-6xl mx-auto px-6 pt-14 md:pt-20 pb-10 md:pb-14">
          <Kicker light>Cover story · The future of the smart home</Kicker>
          <h1 className="text-5xl md:text-7xl lg:text-[5.5rem] font-bold leading-[1.02] tracking-tight max-w-4xl" style={{ fontFamily: SERIF, color: "#f8fafc" }}>
            The Home That Finally Knows You&apos;re Home.
          </h1>
          <p className="mt-6 text-lg md:text-2xl max-w-3xl leading-snug" style={{ color: "#cbd5e1", fontFamily: SERIF }}>
            Smart homes promised to understand us, and mostly learned our voices. Echo Vue listens to something else: the room itself.
            A $50 plate on the wall, the WiFi you already have, and an AI that knows a hallway is busy without ever seeing a face.
          </p>
          <p className="mt-6 text-sm tracking-wide" style={{ color: "#94a3b8" }}>
            By <strong style={{ color: "#e2e8f0" }}>DeMarkus Wilson</strong> · Founder &amp; CEO,{" "}
            <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline" style={{ color: "#cbd5e1" }}>Illy Robotic Instruments</a>
            {" "}· Concept renders · October 2026
          </p>

          <HeroPair className="mt-10 md:mt-14" />
          <p className="text-[11px] mt-3" style={{ color: "#94a3b8" }}>
            Left: Illy Bridge 2, mounted beside an ordinary light switch. Right: Illy Bridge Pro. Concept renders of pre-production housings; the screens show the real interface with illustrative values.
          </p>
        </div>
      </header>

      <article>
        {/* ── Lede ── */}
        <section className="max-w-3xl mx-auto px-6 pt-14 md:pt-20">
          <Body>
            <p>
              <span className="float-left text-7xl md:text-8xl leading-[0.82] pr-3 pt-1 font-bold" style={{ fontFamily: SERIF, color: "var(--gh-blue)" }}>A</span>
              {" "}motel is one of the most honest buildings in America. Every door opens onto a stranger&apos;s night, and every hallway, lobby and laundry room is a place where those strangers briefly overlap.
              I spent three weeks inside that overlap at a Motel 6. What I came away with was not a complaint. It was a question: why do buildings know so much about their bookings and so little about how their own spaces are actually used?
            </p>
            <p>
              The usual answer is a camera. I didn&apos;t want a camera. Nobody walking to the ice machine signed up for one. So I started from a different idea: the building was already full of a signal that moves when people do. It was the WiFi.
            </p>
          </Body>
          <PullQuote>The smartest room in the building shouldn&apos;t need an eye.</PullQuote>
        </section>

        {/* ── Google Home ── */}
        <section className="max-w-3xl mx-auto px-6 pb-14">
          <Kicker>IoT meets AI</Kicker>
          <H2>Google Home was the idea. This is the home.</H2>
          <Body>
            <p>
              The first wave of the smart home taught our houses to hear us. Say a word and a light comes on. It was a good trick and it was always a little backward: the home waited to be told.
            </p>
            <p>
              Echo Vue flips it. The room is the sensor. Walk into a hallway and the system already knows it&apos;s occupied, how much is moving, and, when someone is still, the slow rhythm of their breathing.
              The Internet of Things gave us devices that report. AI gives them the ability to understand. Echo Vue puts both behind one plate on the wall, with no camera and nothing to wear.
            </p>
            <p>If Google Home was the promise, this is the delivery.</p>
          </Body>
        </section>

        {/* ── Meet the bridges ── */}
        <section className="py-14 md:py-20" style={{ backgroundColor: "var(--gh-surface)", borderTop: "1px solid var(--gh-border)", borderBottom: "1px solid var(--gh-border)" }}>
          <div className="max-w-6xl mx-auto px-6">
            <Kicker>The hardware</Kicker>
            <H2>Meet the bridges.</H2>

            {/* Standard */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 items-center mt-8">
              <div>
                <WallScene className="w-full h-auto rounded-2xl" />
                <Caption>Illy Bridge 2 in a standard two-gang wall plate, shown next to a single light switch for scale. Concept render.</Caption>
              </div>
              <div>
                <div className="flex items-baseline gap-3 flex-wrap mb-1">
                  <h3 className="text-3xl font-bold" style={{ fontFamily: SERIF }}>Illy Bridge 2</h3>
                  <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "var(--gh-blue)" }}>The wall plate</span>
                </div>
                <p className="text-5xl font-bold mb-1" style={{ fontFamily: SERIF }}>$50 <span className="text-sm font-normal" style={muted}>target price per bridge</span></p>
                <p className="text-[17px] leading-relaxed mt-4" style={{ fontFamily: SERIF }}>
                  It&apos;s a light switch that thinks. A 4.0-inch touchscreen set into a standard plate, finished to match the switches around it, so it reads as part of the wall, or as part of the construction.
                  It has no camera, no microphone and no speaker. What it has is a radio, a processor and a screen that tells you exactly what it is doing.
                </p>
                <ul className="mt-5 space-y-2">
                  <Spec>4.0-inch 480×320 touchscreen</Spec>
                  <Spec>WiFi presence sensing with an activity level</Spec>
                  <Spec>Breathing-rate estimates when someone is still</Spec>
                  <Spec>Anonymised nearby-device counts</Spec>
                  <Spec>Wall-plate housing that fits a standard two-gang box (concept)</Spec>
                  <Spec>No camera · no microphone · no speaker</Spec>
                </ul>
              </div>
            </div>

            {/* Pro */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 items-center mt-16 md:mt-24">
              <div className="lg:order-2">
                <ProBridge className="w-full h-auto max-w-[360px] mx-auto" />
                <Caption>Illy Bridge Pro in a graphite housing: camera* and microphones on top, colour display, biometric pad*, speaker grille below. Concept render.</Caption>
              </div>
              <div className="lg:order-1">
                <div className="flex items-baseline gap-3 flex-wrap mb-1">
                  <h3 className="text-3xl font-bold" style={{ fontFamily: SERIF }}>Illy Bridge Pro</h3>
                  <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "var(--gh-blue)" }}>The one with a voice</span>
                </div>
                <p className="text-5xl font-bold mb-1" style={{ fontFamily: SERIF }}>$100 <span className="text-sm font-normal" style={muted}>target price per bridge</span></p>
                <p className="text-[17px] leading-relaxed mt-4" style={{ fontFamily: SERIF }}>
                  For spaces that want more than sensing. A colour display, a speaker and a microphone are built in, with room on the roadmap for a biometric scanner* and a camera* for sites that need to know who is walking in.
                  The Pro does everything the wall plate does, and then it talks back.
                </p>
                <ul className="mt-5 space-y-2">
                  <Spec>Everything in Illy Bridge 2</Spec>
                  <Spec>Colour LCD (240×320)</Spec>
                  <Spec>Built-in speaker and microphone</Spec>
                  <Spec>Planned modules: biometric scanner* and camera*</Spec>
                  <Spec>Desk, shelf or wall stand</Spec>
                </ul>
                <p className="text-xs mt-4 leading-relaxed" style={muted}>
                  *Planned premium modules. They are not part of today&apos;s prototype firmware. Anything capable of identifying a person is opt-in, needs the explicit consent of the people it affects, and needs legal review where it is deployed; biometrics most of all.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Screens ── */}
        <section className="max-w-6xl mx-auto px-6 py-14 md:py-20">
          <Kicker>The screens</Kicker>
          <H2>Every screen, in high definition.</H2>
          <p className="text-[17px] leading-relaxed max-w-3xl mb-8" style={{ fontFamily: SERIF }}>
            The interface is deliberately plain: a dark screen, big readable values, and nothing it can&apos;t back up. These are redrawn from the device firmware, pixel for pixel, with illustrative values.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-5">
            {GALLERY.map((g) => (
              <figure key={g.title} className={g.device === "e32" ? "md:col-span-2" : "md:col-span-2"}>
                <div className="rounded-xl overflow-hidden" style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.25)", border: "6px solid #14171c", background: "#000" }}>
                  <ScreenImage device={g.device} kind={g.kind} className={g.device === "pro" ? "w-full h-auto max-h-[340px] mx-auto" : "w-full h-auto"} />
                </div>
                <figcaption className="mt-2.5">
                  <p className="text-sm font-semibold">{g.title}</p>
                  <p className="text-xs" style={muted}>{g.note}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* ── Who it's for ── */}
        <section className="py-14 md:py-20" style={{ backgroundColor: "var(--gh-surface)", borderTop: "1px solid var(--gh-border)", borderBottom: "1px solid var(--gh-border)" }}>
          <div className="max-w-6xl mx-auto px-6">
            <Kicker>Where it goes</Kicker>
            <H2>Built for every room that has people in it.</H2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
              {SECTORS.map((s) => (
                <div key={s.name} className="rounded-2xl p-5" style={{ backgroundColor: "var(--gh-bg)", border: "1px solid var(--gh-border)" }}>
                  <p className="text-3xl mb-2">{s.icon}</p>
                  <h3 className="text-xl font-bold mb-1" style={{ fontFamily: SERIF }}>{s.name}</h3>
                  <p className="text-sm leading-relaxed" style={muted}>{s.line}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── The math ── */}
        <section className="max-w-3xl mx-auto px-6 py-14 md:py-20">
          <Kicker>The math</Kicker>
          <H2>Eleven areas. Eleven bridges. $550.</H2>
          <Body>
            <p>
              Take the property I spent those three weeks in, as Echo Vue models it: a hallway on each of three floors, plus the lobby, pool, terrace, laundry, snack deli, vending area, elevator and stairwell. That is eleven public areas.
              At $50 a bridge, one per area, the whole building costs $550, with no footage to store and no guest ever photographed.
            </p>
          </Body>
          <div className="flex flex-wrap gap-2 mt-5">
            {AREAS.map((a) => (
              <span key={a} className="text-xs px-3 py-1.5 rounded-full" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>{a}</span>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            <div className="rounded-2xl p-5" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
              <p className="text-xs font-bold tracking-widest uppercase" style={muted}>Illy Bridge 2</p>
              <p className="text-4xl font-bold mt-1" style={{ fontFamily: SERIF }}>$50</p>
              <p className="text-xs mt-1" style={muted}>11 × $50 = $550</p>
            </div>
            <div className="rounded-2xl p-5" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
              <p className="text-xs font-bold tracking-widest uppercase" style={muted}>Illy Bridge Pro</p>
              <p className="text-4xl font-bold mt-1" style={{ fontFamily: SERIF }}>$100</p>
              <p className="text-xs mt-1" style={muted}>For the spots that need a voice: 11 × $100 = $1,100</p>
            </div>
          </div>
          <p className="text-xs mt-4" style={muted}>Target prices for a pre-production prototype, per bridge, before any power supply, installation or service. They are not an offer and may change. Illustrative: assumes one bridge per area.</p>
        </section>

        {/* ── The case study: gray areas ── */}
        <section className="py-14 md:py-20" style={{ backgroundColor: "#0f172a", color: "#e2e8f0" }}>
          <div className="max-w-5xl mx-auto px-6">
            <Kicker light>The case study</Kicker>
            <h2 className="text-3xl md:text-5xl font-bold leading-tight mb-6" style={{ fontFamily: SERIF }}>The part nobody put in the brochure.</h2>
            <div className="max-w-3xl space-y-5 text-[17px] md:text-lg leading-[1.75]" style={{ fontFamily: SERIF, color: "#cbd5e1" }}>
              <p>
                Building it taught me something I did not expect. The hard problem was not the signal processing. It was that <strong style={{ color: "#fff" }}>radio-frequency data sits in a legal and ethical gray area</strong>:
                it is invisible, it is passive, it is not a picture, and the rules we have for cameras and recordings do not clearly describe it.
              </p>
              <p>
                The difference that mattered most is <strong style={{ color: "#fff" }}>transparency</strong>. A camera announces itself. A radio-frequency sensor does not, and the person being sensed has no way to notice, object or opt out unless the operator builds that in.
                When something is invisible, the ethical burden moves entirely onto the people who deploy it.
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl mt-10" style={{ border: "1px solid rgba(148,163,184,0.25)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: "rgba(148,163,184,0.12)" }}>
                    <th className="text-left p-3 font-semibold w-32"> </th>
                    <th className="text-left p-3 font-semibold">Camera (optical)</th>
                    <th className="text-left p-3 font-semibold">Radio-frequency sensing</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((r) => (
                    <tr key={r.row} style={{ borderTop: "1px solid rgba(148,163,184,0.2)" }}>
                      <td className="p-3 font-medium align-top">{r.row}</td>
                      <td className="p-3 align-top" style={{ color: "#94a3b8" }}>{r.camera}</td>
                      <td className="p-3 align-top" style={{ color: "#94a3b8" }}>{r.rf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="text-2xl font-bold mt-14 mb-2" style={{ fontFamily: SERIF }}>Questions the law does not clearly answer</h3>
            <p className="text-sm mb-6 max-w-3xl" style={{ color: "#94a3b8" }}>These are open questions, not conclusions: what I ran into when I tried to find out whether this kind of sensing was clearly allowed, clearly prohibited, or neither.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {GRAY.map((g) => (
                <div key={g.title} className="rounded-2xl p-5" style={{ backgroundColor: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.2)" }}>
                  <h4 className="font-semibold mb-1.5">{g.title}</h4>
                  <p className="text-sm leading-relaxed" style={{ color: "#94a3b8" }}>{g.text}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 max-w-3xl text-[17px] leading-[1.75]" style={{ fontFamily: SERIF, color: "#cbd5e1" }}>
              None of this had a clean answer I could point to. So I stopped asking what I could get away with and started asking what a person who did not know they were being sensed would reasonably want me to have done.
              I decided to design for the strictest plausible interpretation.
            </p>
          </div>
        </section>

        {/* ── Design choices ── */}
        <section className="max-w-4xl mx-auto px-6 py-14 md:py-20">
          <Kicker>Privacy by architecture</Kicker>
          <H2>Sense, don&apos;t watch.</H2>
          <p className="text-[17px] leading-relaxed mb-8" style={{ fontFamily: SERIF }}>
            A policy can be broken; an architecture that cannot do something is harder to break. These are the choices made in Echo Vue, and the reason behind each.
          </p>
          <div className="space-y-3">
            {DESIGN.map((d) => (
              <div key={d.choice} className="rounded-2xl p-5" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
                <p className="font-semibold text-lg" style={{ fontFamily: SERIF }}>{d.choice}</p>
                <p className="text-sm mt-1.5" style={muted}><strong style={{ color: "var(--gh-text)" }}>Why:</strong> {d.why}</p>
                <p className="text-sm mt-1" style={muted}><strong style={{ color: "var(--gh-text)" }}>How:</strong> {d.how}</p>
              </div>
            ))}
          </div>
          <p className="text-sm mt-5 leading-relaxed" style={muted}>
            One honest caveat: keeping guest rooms out of scope depends on where bridges are placed, with a name check on the backend as a backstop, not a guarantee on its own.
          </p>
        </section>

        {/* ── Commitments ── */}
        <section className="py-14 md:py-20" style={{ backgroundColor: "var(--gh-surface)", borderTop: "1px solid var(--gh-border)", borderBottom: "1px solid var(--gh-border)" }}>
          <div className="max-w-3xl mx-auto px-6">
            <Kicker>Our commitments</Kicker>
            <H2>Ethics isn&apos;t a feature. It&apos;s the floor.</H2>
            <Body>
              <p>
                <CompanyLink /> builds sensing and AI products. The people who build technology that can observe others owe those people more than legal compliance, particularly while the law is still catching up. We commit to:
              </p>
              <ol className="space-y-4 list-decimal pl-6">
                <li><strong>Notice and consent first.</strong> Sensing should never be invisible to the people it measures. Deployments need clear notice, and consent is a condition of operating, not an afterthought.</li>
                <li><strong>Public spaces only.</strong> We do not sense private rooms. Where the physics of radio could reach them, we design placement and software to keep them out.</li>
                <li><strong>Collect the minimum.</strong> Derived features instead of raw signal, anonymised identifiers instead of addresses, and short memory instead of archives.</li>
                <li><strong>Presence, never identity.</strong> Echo Vue answers whether anyone is there and how busy a space is. It is not built to identify anyone: even the nearby-device hint uses ids that reset daily and says only that a device has been around for a while.</li>
                <li><strong>Honesty about what AI can and cannot tell.</strong> Estimates are labelled as estimates. When the signal is not good enough, the system says so rather than inventing a number, and live presence readings are never simulated.</li>
                <li><strong>Human accountability.</strong> Operators decide where sensing happens: a bridge only senses the area it is placed in and assigned to. They remain responsible for how it is used. A model&apos;s output is an input to a human decision, not a replacement for it.</li>
                <li><strong>Open to scrutiny.</strong> We publish how the system works, including its limits, and we welcome legal, ethical and technical review. We expect deployments to have legal review in their own jurisdiction before they go live.</li>
              </ol>
              <p className="italic">The fact that a signal is invisible is a reason for more care, not less.</p>
            </Body>
          </div>
        </section>

        {/* ── Still open ── */}
        <section className="max-w-3xl mx-auto px-6 py-14 md:py-20">
          <Kicker>Still open</Kicker>
          <H2>What responsible deployment still requires.</H2>
          <p className="text-[17px] leading-relaxed mb-4" style={{ fontFamily: SERIF }}>Echo Vue is a prototype, and a case study is not a compliance programme. Before anything like it is used on real guests, these remain to be done:</p>
          <ul className="space-y-2.5 list-disc pl-6 text-[17px] leading-relaxed" style={{ fontFamily: SERIF }}>
            <li>Review by an attorney in the jurisdiction of use, covering wiretap and eavesdropping, consumer-protection, biometric and health-data rules, and landlord and guest rights.</li>
            <li>Plain-language notice in the places that are sensed, and a way for guests and staff to ask questions or object.</li>
            <li>A written retention and access policy, including how requests from third parties would be handled.</li>
            <li>A formal privacy impact assessment and independent testing of the accuracy claims made about breathing and occupancy.</li>
            <li>A conversation with regulators, researchers and privacy advocates, because the standards for this kind of sensing should not be written by the people who profit from it alone.</li>
          </ul>
        </section>

        {/* ── CTA ── */}
        <section className="py-16 md:py-24 text-center" style={{ background: "radial-gradient(120% 120% at 50% 0%, #1e3a5f 0%, #0f172a 60%, #070b14 100%)" }}>
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="text-4xl md:text-6xl font-bold leading-tight" style={{ fontFamily: SERIF, color: "#f8fafc" }}>Your building already has the signal.</h2>
            <p className="mt-5 text-lg md:text-xl" style={{ fontFamily: SERIF, color: "#cbd5e1" }}>
              Illy Bridge 2 from $50. Illy Bridge Pro from $100. Coming as Echo Vue moves from prototype to product.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
              <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="px-6 py-3 rounded-xl text-sm font-semibold" style={{ backgroundColor: "#4285f4", color: "#fff" }}>
                Talk to Illy Robotic Instruments
              </a>
              <SessionLink signedOut={{ href: "/auth/signin", label: "Sign in to see Echo Vue live" }} signedIn={{ href: "/dashboard", label: "See Echo Vue live" }} className="px-6 py-3 rounded-xl text-sm font-semibold" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.2)" }} />
            </div>
          </div>
        </section>

        {/* ── Fine print ── */}
        <section className="max-w-3xl mx-auto px-6 py-10">
          <p className="text-[11px] leading-relaxed" style={muted}>
            Devices are shown as concept renders of pre-production housings, not photographs of finished products. Prices are targets for a prototype, not offers, and may change; availability is not guaranteed.
            Echo Vue is not a medical device and is not a safety-certified system. Illustrative screen values are not real measurements.
            Motel 6 is named as the setting where I worked and observed. This is my own account and Illy Robotic Instruments&apos; position, not the view of Motel 6 or its owners.
            Google Home is a trademark of Google LLC; Illy Robotic Instruments is not affiliated with or endorsed by Google. I am not a lawyer, and nothing here is legal advice.
          </p>
        </section>
      </article>

      <CompanyFooter />
    </main>
  );
}
