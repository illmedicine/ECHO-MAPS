import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY_URL, CompanyFooter, CompanyLink } from "@/components/CompanyLink";
import { InstrumentsSketch, JourneyMapSketch, MapSketch, PrototypeSketch, SkeletonSketch } from "@/components/marketing/DaVinciSketches";
import ActivityCalendar, { type Release } from "@/components/marketing/ActivityCalendar";

export const metadata: Metadata = {
  title: "From Spectacle to Signal — The Evolution of Echo Vue | Illy Robotic Instruments",
  description:
    "Seven months of Echo Vue, drawn as a codex: the camera-built 3D skeleton and the map of dots, the six-month pause, and the rebuild around real signal at a Motel 6.",
};

const SERIF = "Georgia, 'Times New Roman', 'Iowan Old Style', serif";
const muted = { color: "var(--gh-text-muted)" } as const;

function Kicker({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return <p className="text-[11px] font-bold tracking-[0.22em] uppercase mb-2" style={{ color: light ? "#93b8f7" : "var(--gh-blue)" }}>{children}</p>;
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-3xl md:text-4xl font-bold leading-tight mb-5" style={{ fontFamily: SERIF }}>{children}</h2>;
}
function Body({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5 text-[17px] md:text-lg leading-[1.75]" style={{ fontFamily: SERIF }}>{children}</div>;
}
function PullQuote({ children }: { children: React.ReactNode }) {
  return <blockquote className="my-10 pl-6 border-l-4 text-2xl md:text-4xl italic leading-snug" style={{ borderColor: "var(--gh-blue)", fontFamily: SERIF }}>{children}</blockquote>;
}
function Plate({ n, title, children, note, dark }: { n: string; title: string; children: React.ReactNode; note: string; dark?: boolean }) {
  return (
    <figure className="my-2">
      <div className="rounded-sm overflow-hidden" style={{ boxShadow: "0 18px 50px rgba(60,40,10,0.35)", border: "10px solid #2a1d10" }}>{children}</div>
      <figcaption className="mt-3 text-xs leading-snug" style={dark ? { color: "#94a3b8" } : muted}>
        <strong style={{ color: dark ? "#e2e8f0" : "var(--gh-text)", fontFamily: SERIF }}>Plate {n}: {title}.</strong> {note}
      </figcaption>
    </figure>
  );
}

type Entry = { date: string; title: string; what: string; why: string };

/** Major release days, in order. These are the numbered flags on the calendar. */
const RELEASES: Release[] = [
  { date: "2026-03-31", title: "First commit, the Echo Vue rebrand, the calibration wizard and a Cameras tab" },
  { date: "2026-04-02", title: "The 3D skeleton from a camera, Bluetooth anchors, and the first white paper" },
  { date: "2026-04-07", title: "The live floor-plan map, presence engine and floor-plan editor" },
  { date: "2026-04-08", title: "Beacon identities and the WiFi router anchor" },
  { date: "2026-04-12", title: "The mobile room scanner, the last spring commit" },
  { date: "2026-10-06", title: "WiFi site survey and the hotel auto-setup" },
  { date: "2026-10-07", title: "Public-area sensing and the privacy policy; the camera code removed" },
  { date: "2026-10-08", title: "Bridge configuration from the dashboard and the Public Areas view" },
  { date: "2026-10-09", title: "Breathing measured from the radio spectrum; anonymised Bluetooth; people and pets" },
  { date: "2026-10-10", title: "Illy Bridge 2 firmware for the 4.0-inch wall display" },
  { date: "2026-10-11", title: "The live dashboard on the device, History, AI insights and the case study" },
];

const SPRING: Entry[] = [
  { date: "Mar 31", title: "First commit: Echo Maps", what: "A CSI sensing platform, a web dashboard, Google sign-in and a backend, all stood up in a single day. By night it had a new name, Echo Vue, a dark interface inspired by Google Home, a calibration wizard, a presence tab and a Cameras tab.", why: "Turn the WiFi in a room into a picture of the room." },
  { date: "Before the code", title: "Measure first", what: "Before a room went into Echo Vue it was measured by hand. A Klein Tools laser gave the distance to each wall, and a voltage detector found the outlets and live wiring inside them. Those numbers became room dimensions, square footage and floor plans, for homes first and then for facilities, buildings and factories.", why: "Understand the physical space before trying to sense anything in it." },
  { date: "Apr 1", title: "A face for it", what: "A light theme, a transparent logo, emoji icons and a watermark.", why: "Make a sensing tool feel like a home product, not a lab bench." },
  { date: "Apr 2", title: "The skeleton", what: "Real-time skeletal tracking from a camera using TensorFlow.js MoveNet, wired into a 3D viewer. Bluetooth discovery that named the manufacturer and operating system of nearby devices, and a protocol for tethering a Bluetooth address to a person's radio signature. The first research white paper.", why: "Know who is in the room and follow them." },
  { date: "Apr 3", title: "It follows you", what: "Cloud sync across devices, network fingerprints, an architecture infographic, and a stream of fixes to keep the 3D view alive.", why: "One home, many screens." },
  { date: "Apr 7", title: "The map", what: "A live floor-plan map with pulsing presence dots, a presence engine, household profiles and visitor tracking, a floor-plan editor, and an expanded 3D skeleton viewer. Cross-modal detection that fused camera, radio and Bluetooth.", why: "See a home as a digital twin: who, where, moving how." },
  { date: "Apr 8", title: "Anchors", what: "Editable beacon identities that remember corrections, and a WiFi router anchor for triangulation.", why: "Pin the radio picture to real positions in the room." },
  { date: "Apr 12", title: "The last spring commit", what: "A mobile room scanner for visual mapping and calibration. Then the project went quiet.", why: "Map the room with a camera, then sense it with radio." },
];

const OCTOBER: Entry[] = [
  { date: "Oct 6", title: "Back, with a clipboard", what: "A WiFi site survey and a hotel auto-setup that models a property: floors, hallways, guest rooms and amenities.", why: "Stop modelling a living room. Model a real building." },
  { date: "Oct 7", title: "The camera comes out", what: "Public-area sensing zones, a hallway per floor, a privacy policy, and continuous CSI presence sensing. Real WiFi captured on site became the beacons. All camera code was removed.", why: "The question was occupancy, not identity. A hallway should not need a face." },
  { date: "Oct 8", title: "A bridge you can leave behind", what: "Firmware that joins the property's WiFi on its own, bridges you name and assign to an area from the dashboard, a Public Areas view in place of the room list, and the 3D viewer removed.", why: "Make the device work in a building you do not live in." },
  { date: "Oct 9", title: "Breathing, measured", what: "A breathing-rate estimate from the CSI spectrum, anonymised nearby-device counts, and people and pets told apart by distinct breathing rates. Each number is labelled an estimate.", why: "Say only what the signal can support, and say so when it cannot." },
  { date: "Oct 10", title: "A second bridge", what: "Firmware for a 4.0-inch ESP32-32E wall display, and a fix that finally lit the Freenove screen.", why: "A device that looks like part of the wall." },
  { date: "Oct 11", title: "The device talks back", what: "The live dashboard on the bridge's own screen, a History page of anonymous aggregates kept for 90 days, AI-written insights, and the M6 Case Study.", why: "A readout you can read without trusting anyone." },
];

const MAP: { feature: string; then: string; now: string; why: string }[] = [
  { feature: "Presence", then: "Presences for known household members, generated by a simulated RF scan, plus the camera.", now: "Real CSI from bridges, learned per link, in public areas only.", why: "From a demonstration of the idea to an instrument that measures it." },
  { feature: "Skeleton", then: "A 3D, 33-point skeleton: 17 points seen by a laptop camera (MoveNet), the rest inferred. A generated skeleton when no camera was running.", now: "Gone. The camera code and the 3D viewer are removed.", why: "A skeleton identifies a person. The goal was occupancy." },
  { feature: "Map", then: "A live floor plan with pulsing dots and movement trails per person.", now: "Public Areas: one card per area with status, its bridge, and live insights.", why: "Per-person positions are tracking; per-area status is occupancy." },
  { feature: "Breathing", then: "A band-pass design for raw CSI on the server. In the browser, when no stream was connected, a generated sine wave near 15.5 breaths a minute.", now: "A spectrum on the device, kept only when a peak clearly stands out, shown with confidence. “No signal” otherwise.", why: "Nothing on screen should be there just to look finished." },
  { feature: "Camera", then: "A Cameras tab to register and calibrate a camera per room, pose estimation on its video, and a mobile room scanner for visual mapping.", now: "Gone from the sensing pipeline. Bridges sense by radio only; a camera is a planned, opt-in module on the Pro.", why: "Cameras identify people. A public hallway should not need one." },
  { feature: "Measuring", then: "A Klein Tools laser and voltage detector used by hand to get wall distances and find outlets, then entered as room dimensions and square footage.", now: "A hotel auto-setup that models a whole property, and a floor-plan editor where dimensions can still come from real measurements.", why: "Scale from one home to a facility without losing the physical ground truth." },
  { feature: "Heart rate", then: "Designed in, with a generated 72 bpm fallback.", now: "Not reported.", why: "It cannot be measured reliably from one WiFi link." },
  { feature: "Bluetooth", then: "Device names, manufacturers, operating systems, and tethering an address to a person.", now: "Salted, daily-rotating hashes: counts and signal strength, never addresses.", why: "A device address is a persistent identifier for a person." },
  { feature: "Profiles", then: "Household members, visitors and per-person profiles.", now: "None. Presence, never identity.", why: "Identification needs consent this product does not ask for." },
  { feature: "Hardware", then: "A browser and a webcam did the seeing.", now: "Illy Bridge 2 (4.0-inch wall plate) and Illy Bridge Pro, with a screen that shows what they are doing.", why: "A product has to run in a building, not on a laptop." },
];

export default function ResearchPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <nav className="sticky top-0 z-40 border-b backdrop-blur-md" style={{ backgroundColor: "rgba(248,249,252,0.92)", borderColor: "var(--gh-border)" }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="/dashboard" className="text-sm transition hover:opacity-80" style={muted}>← Dashboard</Link>
          <span className="text-[11px] font-bold tracking-[0.28em] uppercase hidden sm:block">Echo Vue <span style={muted}>· The Evolution Issue</span></span>
          <Link href="/dashboard/case-study" className="text-xs hover:underline" style={{ color: "var(--gh-blue)" }}>Read the M6 Case Study →</Link>
        </div>
      </nav>

      {/* ── Cover ── */}
      <header style={{ background: "radial-gradient(120% 90% at 20% 0%, #1e3a5f 0%, #0f172a 55%, #070b14 100%)" }}>
        <div className="max-w-6xl mx-auto px-6 pt-14 md:pt-20 pb-10 md:pb-14">
          <Kicker light>Research · The evolution of Echo Vue</Kicker>
          <h1 className="text-5xl md:text-7xl lg:text-[5.5rem] font-bold leading-[1.02] tracking-tight max-w-4xl" style={{ fontFamily: SERIF, color: "#f8fafc" }}>
            From Spectacle to Signal.
          </h1>
          <p className="mt-6 text-lg md:text-2xl max-w-3xl leading-snug" style={{ color: "#cbd5e1", fontFamily: SERIF }}>
            Seven months, one project, two ideas of what it means to see a room. How Echo Vue went from a glittering 3D skeleton built on a camera to a plain, honest readout on the wall.
          </p>
          <p className="mt-6 text-sm tracking-wide" style={{ color: "#94a3b8" }}>
            By <strong style={{ color: "#e2e8f0" }}>DeMarkus Wilson</strong> · Founder &amp; CEO,{" "}
            <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline" style={{ color: "#cbd5e1" }}>Illy Robotic Instruments</a>
            {" "}· Codex studies · October 2026
          </p>
          <div className="mt-10 md:mt-14">
            <Plate n="I" title="Carta del Progetto" dark note="The journey of Echo Vue drawn as a map: the spring island of prototypes, the six months in the field when testing and research carried on without new code, and the October island where it became real. Dates come from the project's own commit history.">
              <JourneyMapSketch />
            </Plate>
          </div>
        </div>
      </header>

      <article>
        {/* ── Lede ── */}
        <section className="max-w-3xl mx-auto px-6 pt-14 md:pt-20">
          <Body>
            <p>
              <span className="float-left text-7xl md:text-8xl leading-[0.82] pr-3 pt-1 font-bold" style={{ fontFamily: SERIF, color: "var(--gh-blue)" }}>T</span>
              {" "}he first commit landed on March 31, 2026. It was called Echo Maps then: a platform for sensing rooms with WiFi, big ambitions, and not much hardware. Within a day it had a new name, a dark interface borrowed from the language of Google Home, and a plan to turn the radio waves in a room into a living picture of it.
            </p>
            <p>
              Twelve days later the commits stopped. The work did not. For nearly six months I kept using and testing the tool in my own home, collecting data and presenting the research to the technical community, but not one new feature was committed. Then, on October 6, the code started again, this time in a Motel 6, and almost everything that had made the spring version look impressive came out.
            </p>
          </Body>
          <PullQuote>I stopped asking what the screen could show and started asking what I could stand behind.</PullQuote>
          <Body>
            <p>
              This is the story of that change, told as a timeline, a feature map and a set of drawings in the style of a Renaissance notebook, because the first Echo Vue was exactly the kind of thing you sketch before you know if it can be built.
            </p>
          </Body>
        </section>

        {/* ── Chapter I ── */}
        <section className="max-w-5xl mx-auto px-6 py-14 md:py-20">
          <Kicker>Chapter I · March 31 to April 12</Kicker>
          <H2>The vision.</H2>
          <p className="text-[17px] md:text-lg leading-[1.75] max-w-3xl mb-10" style={{ fontFamily: SERIF }}>
            Twelve days of building at full speed. The aim was a digital twin of a home: who is in each room, where they are standing, how they are moving, how they are breathing. Here is what got built, and what it was for.
          </p>
          <Timeline entries={SPRING} accent="#9a3b26" />
        </section>

        {/* ── Skeleton ── */}
        <section className="py-14 md:py-20" style={{ backgroundColor: "var(--gh-surface)", borderTop: "1px solid var(--gh-border)", borderBottom: "1px solid var(--gh-border)" }}>
          <div className="max-w-6xl mx-auto px-6">
            <Kicker>How it used to work</Kicker>
            <H2>The skeleton.</H2>
            <Plate n="II" title="Studio of the Digital Body" note="Seventeen points are seen by the camera, red; sixteen more are inferred, hollow. The curve at lower right is a breathing signal drawn by a formula, which the drawing says out loud. A sketch for effect, not a plot of data.">
              <SkeletonSketch />
            </Plate>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
              {[
                ["What it did", "A Cameras tab let you register and calibrate a camera for each room. Its video fed TensorFlow.js MoveNet, which found 17 body points; those were expanded to a 33-point skeleton and drawn in a 3D room, so you could watch a person walk, sit and wave as a wireframe. A mobile room scanner later used a phone camera to map the space itself."],
                ["What it was for", "To show that a space could be understood as a body in a room, and to give every other feature, from positions to activity, something concrete to hang on."],
                ["Why it is gone", "A skeleton identifies a person, and it came from a camera. A hallway only needs to know whether someone is in it. When the project moved into a public building, the camera code and the 3D viewer came out."],
              ].map(([t, b]) => (
                <div key={t} className="rounded-2xl p-5" style={{ backgroundColor: "var(--gh-bg)", border: "1px solid var(--gh-border)" }}>
                  <h3 className="font-semibold text-lg mb-1.5" style={{ fontFamily: SERIF }}>{t}</h3>
                  <p className="text-sm leading-relaxed" style={muted}>{b}</p>
                </div>
              ))}
            </div>
            <p className="text-[17px] leading-relaxed max-w-3xl mt-8" style={{ fontFamily: SERIF }}>
              One honest footnote belongs on the drawing. The original design streamed raw radio data to a server, where a band-pass filter could pull out breathing and heart-rate bands. But in the browser, whenever no live stream was connected, the vitals panel filled itself with a generated sine wave around 15.5 breaths a minute and 72 beats. It looked finished. It was a placeholder for a measurement that did not exist yet.
            </p>
          </div>
        </section>

        {/* ── Map ── */}
        <section className="max-w-6xl mx-auto px-6 py-14 md:py-20">
          <Kicker>How it used to work</Kicker>
          <H2>The map of dots.</H2>
          <Plate n="III" title="Pianta, the live floor plan" note="Presence as pulsing dots, movement as dashed trails along a hallway. The drawing carries its own caveat: the positions were demonstration data.">
            <MapSketch />
          </Plate>
          <div className="max-w-3xl mt-8">
            <Body>
              <p>
                The live floor plan was the spring version at its most seductive. Draw a plan of your home, and each person appeared as a pulsing dot, leaving a trail as they moved from room to room. It was fed by a presence engine, household profiles and visitor tracking.
              </p>
              <p>
                In the demonstration, much of that came from a simulated radio scan: a pool of imagined phones, tablets and watches placed in rooms. It was a convincing preview of what a sensed home could feel like. It was a preview, and the October rebuild exists because a preview is not a product.
              </p>
            </Body>
          </div>
        </section>

        {/* ── Instruments ── */}
        <section className="max-w-6xl mx-auto px-6 pb-14 md:pb-20">
          <Kicker>Where it started</Kicker>
          <H2>Measure first.</H2>
          <Plate n="IV" title="Strumenti" note="A handheld laser gives the distance to a wall, a voltage detector finds the outlet inside it, and the numbers become a floor plan. The figures in the drawing are illustrative.">
            <InstrumentsSketch />
          </Plate>
          <div className="max-w-3xl mt-8">
            <Body>
              <p>
                Before Echo Vue sensed a room, it had to know the room. The earliest work leaned on an ordinary tradesman&apos;s instrument, a Klein Tools laser for the distance to the walls, plus a voltage detector for finding outlets and live power inside them without opening anything up.
              </p>
              <p>
                From those readings Echo Vue learned the square footage and shape of a space, and where power and the router sat within it. That gave the radio data something physical to be read against, and it is how a home, and then a facility, a building or a factory floor, could be understood as a place rather than a list of signals.
              </p>
            </Body>
          </div>
        </section>

        {/* ── Pause ── */}
        <section className="py-16 md:py-24 text-center" style={{ background: "radial-gradient(120% 120% at 50% 0%, #1e3a5f 0%, #0f172a 60%, #070b14 100%)" }}>
          <div className="max-w-3xl mx-auto px-6">
            <Kicker light>April 12 to October 6</Kicker>
            <h2 className="text-4xl md:text-6xl font-bold leading-tight" style={{ fontFamily: SERIF, color: "#f8fafc" }}>One hundred and seventy-seven days in the field.</h2>
            <p className="mt-5 text-lg md:text-xl leading-relaxed" style={{ fontFamily: SERIF, color: "#cbd5e1" }}>
              The repository went quiet; the project did not. Through those months I kept using and testing the tool at home, collecting data, and presenting the research to the technical community. No new features were committed, which is why the calendar below shows a long stretch without a mark on it.
            </p>
          </div>
        </section>

        {/* ── Chapter II ── */}
        <section className="max-w-5xl mx-auto px-6 py-14 md:py-20">
          <Kicker>Chapter II · October 6 to October 11</Kicker>
          <H2>The motel.</H2>
          <p className="text-[17px] md:text-lg leading-[1.75] max-w-3xl mb-10" style={{ fontFamily: SERIF }}>
            Six days, and a different question. Not &ldquo;what can this show?&rdquo; but &ldquo;what can be defended in a hallway full of strangers?&rdquo; The answer shaped every commit that followed.
          </p>
          <Timeline entries={OCTOBER} accent="#4285f4" />
        </section>

        {/* ── Calendar ── */}
        <section className="py-14 md:py-20" style={{ backgroundColor: "var(--gh-surface)", borderTop: "1px solid var(--gh-border)", borderBottom: "1px solid var(--gh-border)" }}>
          <div className="max-w-6xl mx-auto px-6">
            <Kicker>The calendar</Kicker>
            <H2>When it all happened.</H2>
            <p className="text-[17px] md:text-lg leading-[1.75] max-w-3xl mb-8" style={{ fontFamily: SERIF }}>
              Every commit and every deployment, plotted on the day it happened. Look for the numbered flags: they mark the major releases listed underneath. The tinted stretch in the middle is the field-testing period, with no new feature code.
            </p>
            <ActivityCalendar releases={RELEASES} gapStart="2026-04-12" gapEnd="2026-10-06" through="2026-10-11" />
          </div>
        </section>

        {/* ── Prototypes ── */}
        <section className="py-14 md:py-20" style={{ backgroundColor: "var(--gh-surface)", borderTop: "1px solid var(--gh-border)", borderBottom: "1px solid var(--gh-border)" }}>
          <div className="max-w-6xl mx-auto px-6">
            <Kicker>The hardware</Kicker>
            <H2>From a webcam to a wall plate.</H2>
            <Plate n="V" title="Prototipi" note="Two bridges, drawn as studies: the Illy Bridge 2 wall plate with its 4.0-inch screen, and the Illy Bridge Pro with a speaker, microphones and, as planned modules, a camera and a biometric pad. See the case study for the finished renders and target prices.">
              <PrototypeSketch />
            </Plate>
            <div className="max-w-3xl mt-8">
              <Body>
                <p>
                  The spring version needed a laptop and a webcam. The October version needed something you could leave in a hallway: a small board with a radio, a processor, and a screen that tells you exactly what it is doing, down to its area, its network and its health.
                </p>
              </Body>
              <Link href="/dashboard/case-study" className="inline-block mt-6 px-6 py-3 rounded-xl text-sm font-semibold" style={{ backgroundColor: "#4285f4", color: "#fff" }}>
                See the devices and the case study →
              </Link>
            </div>
          </div>
        </section>

        {/* ── Feature map ── */}
        <section className="max-w-6xl mx-auto px-6 py-14 md:py-20">
          <Kicker>The feature map</Kicker>
          <H2>Then, now, and why.</H2>
          <p className="text-[17px] md:text-lg leading-[1.75] max-w-3xl mb-8" style={{ fontFamily: SERIF }}>
            Every major feature of the spring build, set against what replaced it, with the reason for the change.
          </p>
          <div className="overflow-x-auto rounded-2xl" style={{ border: "1px solid var(--gh-border)" }}>
            <table className="w-full text-sm" style={{ backgroundColor: "var(--gh-surface)" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--gh-card)" }}>
                  {["Feature", "Spring · the vision", "October · the instrument", "Why it changed"].map((h) => (
                    <th key={h} className="text-left p-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MAP.map((r) => (
                  <tr key={r.feature} style={{ borderTop: "1px solid var(--gh-border)" }}>
                    <td className="p-3 font-semibold align-top whitespace-nowrap" style={{ fontFamily: SERIF }}>{r.feature}</td>
                    <td className="p-3 align-top" style={muted}>{r.then}</td>
                    <td className="p-3 align-top">{r.now}</td>
                    <td className="p-3 align-top" style={muted}>{r.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── What changed ── */}
        <section className="py-14 md:py-20" style={{ backgroundColor: "#0f172a", color: "#e2e8f0" }}>
          <div className="max-w-3xl mx-auto px-6">
            <Kicker light>What changed, and why</Kicker>
            <h2 className="text-3xl md:text-5xl font-bold leading-tight mb-6" style={{ fontFamily: SERIF }}>The spectacle went first.</h2>
            <div className="space-y-5 text-[17px] md:text-lg leading-[1.75]" style={{ fontFamily: SERIF, color: "#cbd5e1" }}>
              <p>
                The spring build was the better demo. A glowing skeleton and a map of moving dots make a room feel alive, and they photograph beautifully. But a good deal of that life was borrowed: from a camera, from a simulated scan, from a formula standing in for a signal.
              </p>
              <p>
                Three things pulled it apart. <strong style={{ color: "#fff" }}>Honesty:</strong> a screen should never show a number the system did not measure. <strong style={{ color: "#fff" }}>Privacy:</strong> a camera, a skeleton and a per-person profile all identify people, and the point of the product was never who. <strong style={{ color: "#fff" }}>Reality:</strong> a bridge in a hotel hallway has to work on a network you do not control, be set up from a dashboard, and say what it is doing on its own screen.
              </p>
              <p>
                What replaced the spectacle is quieter and true to its inputs. Breathing is estimated from the radio spectrum and shown with its confidence, or not shown. People and pets are counted from distinct breathing rates and labelled as estimates. Nothing identifies anyone.
              </p>
              <p>
                Some of the spring ideas are gone for good, heart rate and the per-person skeleton among them. Others came back in a form that can be defended. The question I carry from the motel is the one in the pull quote above: not what the screen can show, but what I can stand behind.
              </p>
            </div>
            <p className="mt-8 text-sm" style={{ color: "#94a3b8" }}>
              The reasoning behind the privacy choices, and the legal questions it left open, is in the <Link href="/dashboard/case-study" className="underline hover:no-underline" style={{ color: "#cbd5e1" }}>M6 Case Study</Link>.
            </p>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-16 md:py-24 text-center" style={{ background: "radial-gradient(120% 120% at 50% 0%, #1e3a5f 0%, #0f172a 60%, #070b14 100%)" }}>
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="text-4xl md:text-6xl font-bold leading-tight" style={{ fontFamily: SERIF, color: "#f8fafc" }}>The next chapter is the building.</h2>
            <p className="mt-5 text-lg md:text-xl" style={{ fontFamily: SERIF, color: "#cbd5e1" }}>
              Illy Bridge 2 and Illy Bridge Pro are in prototype. Echo Vue is on its way from experiment to product.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
              <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="px-6 py-3 rounded-xl text-sm font-semibold" style={{ backgroundColor: "#4285f4", color: "#fff" }}>
                Talk to Illy Robotic Instruments
              </a>
              <Link href="/dashboard" className="px-6 py-3 rounded-xl text-sm font-semibold" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.2)" }}>
                See Echo Vue live
              </Link>
            </div>
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-10">
          <p className="text-[11px] leading-relaxed" style={muted}>
            The dates and feature descriptions come from the project&apos;s commit history. The drawings are illustrations in the manner of Renaissance notebooks, made for this page; figures, positions and curves in them are drawn for effect, not plotted from data.
            Echo Vue is a prototype, not a medical device or a safety-certified system. The earlier white paper that stood on this page described a camera-fusion design that is no longer part of the product.
            <CompanyLink className="hover:underline ml-1" style={{ color: "var(--gh-blue)" }}>Illy Robotic Instruments</CompanyLink>.
          </p>
        </section>
      </article>

      <CompanyFooter />
    </main>
  );
}

function Timeline({ entries, accent }: { entries: Entry[]; accent: string }) {
  return (
    <ol className="relative border-l-2 ml-2 md:ml-4 space-y-8" style={{ borderColor: accent }}>
      {entries.map((e) => (
        <li key={e.date + e.title} className="pl-7 md:pl-10 relative">
          <span className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full" style={{ backgroundColor: accent, boxShadow: "0 0 0 4px var(--gh-bg)" }} aria-hidden />
          <p className="text-xs font-bold tracking-[0.18em] uppercase" style={{ color: accent }}>{e.date}</p>
          <h3 className="text-xl md:text-2xl font-bold mt-0.5" style={{ fontFamily: SERIF }}>{e.title}</h3>
          <p className="text-[15px] leading-relaxed mt-1.5" style={{ fontFamily: SERIF }}>{e.what}</p>
          <p className="text-sm mt-2 italic" style={muted}><strong style={{ color: "var(--gh-text)", fontStyle: "normal" }}>Intention:</strong> {e.why}</p>
        </li>
      ))}
    </ol>
  );
}
