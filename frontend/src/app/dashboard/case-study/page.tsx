import type { Metadata } from "next";
import Link from "next/link";
import { CompanyFooter, CompanyLink } from "@/components/CompanyLink";

export const metadata: Metadata = {
  title: "M6 Case Study — Echo Vue by Illy Robotic Instruments",
  description: "Three weeks at a Motel 6, the idea behind Echo Vue, and what invisible radio-frequency data taught us about privacy.",
};

const muted = { color: "var(--gh-text-muted)" } as const;

function Section({ kicker, title, children }: { kicker?: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      {kicker && <p className="text-[11px] font-bold tracking-[0.18em] uppercase mb-1.5" style={{ color: "var(--gh-blue)" }}>{kicker}</p>}
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      <div className="space-y-4 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
      <h3 className="font-semibold mb-1.5">{title}</h3>
      <div className="text-sm leading-relaxed space-y-2" style={muted}>{children}</div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl p-4 text-center" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
      <p className="text-2xl font-extrabold" style={{ color: "var(--gh-blue)" }}>{value}</p>
      <p className="text-[11px] mt-1" style={muted}>{label}</p>
    </div>
  );
}

const COMPARISON: { row: string; camera: string; rf: string }[] = [
  { row: "What is captured", camera: "An image of a person: face, body, clothing, what they are doing.", rf: "How a body disturbs a radio signal that is already in the room: movement, and at best a breathing rhythm. No image exists." },
  { row: "Can the person see it?", camera: "Usually. A lens is visible, and people understand what it does.", rf: "No. There is nothing to see, hear or feel, so notice has to be deliberate." },
  { row: "Does it stop at the wall?", camera: "Mostly yes: it sees what is in line of sight.", rf: "Not cleanly. Radio passes through walls, so the sensing footprint is a design decision, not a given." },
  { row: "Settled norms", camera: "Decades of signage practice, expectations and case law.", rf: "Few settled norms. People, operators and courts are still working out what this kind of data is." },
  { row: "Risk if misused", camera: "Identification and recording of what people do.", rf: "Inferring presence, routines, and health-adjacent signals about people who never knew they were measured." },
];

const DESIGN: { choice: string; why: string; how: string }[] = [
  { choice: "No camera, no images", why: "Optical data identifies people. The goal was occupancy, not identity.", how: "There is no camera input in the product. The presence pipeline never captures or transmits images or audio." },
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
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm transition hover:opacity-80" style={muted}>← Dashboard</Link>
          <span className="text-sm font-semibold">Echo Vue <span style={muted}>M6 Case Study</span></span>
          <Link href="/privacy" className="text-xs hover:underline" style={{ color: "var(--gh-blue)" }}>Privacy &amp; Sensing Policy</Link>
        </div>
      </nav>

      <header style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #1e3a5f 100%)" }}>
        <div className="max-w-4xl mx-auto px-6 py-16 md:py-24 text-center">
          <div className="flex items-center justify-center gap-2 mb-5 flex-wrap">
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase px-3 py-1 rounded-full" style={{ backgroundColor: "rgba(66,133,244,0.15)", color: "#93b8f7" }}>Case study</span>
            <span className="text-[10px] font-medium tracking-wide uppercase px-3 py-1 rounded-full" style={{ backgroundColor: "rgba(251,188,5,0.12)", color: "#fbd24e" }}>Field notes · not legal advice</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold leading-tight mb-5" style={{ color: "#f1f5f9" }}>M6 Case Study: Sensing Without Seeing</h1>
          <p className="text-base md:text-lg max-w-2xl mx-auto leading-relaxed mb-6" style={{ color: "#94a3b8" }}>
            Three weeks at a Motel 6, the idea behind Echo Vue, and what invisible radio-frequency data taught me about privacy.
          </p>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            DeMarkus Wilson · Founder &amp; CEO, <a href="https://www.illyrobotic-ai.com/" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline" style={{ color: "#cbd5e1" }}>Illy Robotic Instruments</a> · October 2026
          </p>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-6 py-12">
        <Section kicker="Summary" title="What this is">
          <p>
            I spent three weeks at a Motel 6. Being on site, around the hallways, the front desk, the pool and the laundry, is where I decided to build Echo Vue:
            a way to understand how a space is being used from the WiFi signals that are already there, with no camera involved.
          </p>
          <p>
            Building it taught me something I did not expect. The hard problem was not the signal processing. It was that <strong>radio-frequency data sits in a legal and ethical gray area</strong>:
            it is invisible, it is passive, it is not a picture, and the rules we have for cameras and recordings do not clearly describe it.
            This page is an account of the questions that raised, the choices I made in response, and the standards Illy Robotic Instruments holds itself to.
          </p>
          <p className="text-sm" style={muted}>
            Motel 6 is named as the setting where I worked and observed. This is my own account and Illy Robotic Instruments&apos; position, not the view of Motel 6 or its owners.
            I am not a lawyer, and nothing here is legal advice.
          </p>
        </Section>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
          <Stat value="3 weeks" label="on site" />
          <Stat value="11" label="public areas in scope (3 floors)" />
          <Stat value="120" label="guest rooms never sensed" />
          <Stat value="0" label="cameras or images" />
        </div>

        <Section kicker="The problem" title="A building that cannot see itself, and should not">
          <p>
            A property like this has plenty it would like to know: which hallway is busy, whether the laundry is in use, whether the lobby is empty at 3 a.m.
            The usual answer is a camera. A camera answers those questions and many others, including who someone is, what they are carrying and what they are doing.
            For a question about <em>occupancy</em>, that is far more than is needed, and far more than a guest walking down a corridor has agreed to.
          </p>
          <p>
            WiFi offers a different route. Every router fills a space with radio waves, and a body moving through them subtly changes how they arrive.
            That change, called channel state information (CSI), can reveal that someone is there and moving, and sometimes the slow rhythm of breathing, without ever forming an image.
          </p>
        </Section>

        <Section kicker="What I learned" title="Why invisible data is different">
          <p>I had assumed that no image meant no problem. The more I looked, the less true that felt:</p>
          <div className="overflow-x-auto rounded-2xl" style={{ border: "1px solid var(--gh-border)" }}>
            <table className="w-full text-sm" style={{ backgroundColor: "var(--gh-surface)" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--gh-card)" }}>
                  <th className="text-left p-3 font-semibold w-32"> </th>
                  <th className="text-left p-3 font-semibold">Camera (optical)</th>
                  <th className="text-left p-3 font-semibold">Radio-frequency sensing</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((r) => (
                  <tr key={r.row} style={{ borderTop: "1px solid var(--gh-border)" }}>
                    <td className="p-3 font-medium align-top">{r.row}</td>
                    <td className="p-3 align-top" style={muted}>{r.camera}</td>
                    <td className="p-3 align-top" style={muted}>{r.rf}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The difference that mattered most is <strong>transparency</strong>. A camera announces itself. A radio-frequency sensor does not, and the person being sensed has no way to notice, object or opt out unless the operator builds that in.
            When something is invisible, the ethical burden moves entirely onto the people who deploy it.
          </p>
        </Section>

        <Section kicker="The gray areas" title="Questions the law does not clearly answer">
          <p>
            These are open questions, not conclusions. They are what I ran into when I tried to find out whether this kind of sensing was clearly allowed, clearly prohibited, or neither.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Is it content, or just physics?">
              <p>
                Wiretap and eavesdropping laws were written to protect the <em>content</em> of communications. CSI does not read anyone&apos;s messages; it reads how the channel itself is disturbed.
                Whether that falls inside or outside rules built for communications is not obvious.
              </p>
            </Card>
            <Card title="Is there an expectation of privacy in a signal?">
              <p>
                Courts have wrestled with technology that senses what people cannot, for example thermal imaging of a home in <em>Kyllo v. United States</em> (2001).
                That case concerned government use, and a private hotel operator is governed differently, which is part of the uncertainty. Radio that passes through walls raises the same kind of question.
              </p>
            </Card>
            <Card title="Is a body's RF signature a biometric?">
              <p>
                Biometric privacy statutes were written around things like fingerprints, face geometry and voiceprints. A pattern of breathing or movement inferred from radio is not obviously on those lists, but it is derived from a person&apos;s body.
                It is unclear whether it should be treated as one.
              </p>
            </Card>
            <Card title="When does presence become health data?">
              <p>
                A breathing rate is a vital sign. Collected about identifiable people, it starts to look like health information. Collected as an anonymous rhythm in a corridor, it may not.
                The line depends on whether anyone can be tied to the data.
              </p>
            </Card>
            <Card title="Who consented?">
              <p>
                In a public area, guests are free to walk through. Do they consent to being measured by something they cannot detect? Signage helps, but it is easy to overlook, and there is no shared standard for what an RF notice should say.
              </p>
            </Card>
            <Card title="Radio does not respect room boundaries">
              <p>
                A sensor in a hallway can pick up effects from beyond the wall. That is a practical privacy risk with no camera equivalent, and it cannot be settled by policy alone. It has to be handled in placement and in what the system is able to do.
              </p>
            </Card>
          </div>
          <p>
            None of this had a clean answer I could point to. So I stopped asking what I could get away with and started asking what a person who did not know they were being sensed would reasonably want me to have done.
            I decided to design for the strictest plausible interpretation.
          </p>
        </Section>

        <Section kicker="What we built" title="Privacy by architecture, not by promise">
          <p>
            A policy can be broken; an architecture that cannot do something is harder to break. These are the choices made in Echo Vue, and the reason behind each:
          </p>
          <div className="space-y-3">
            {DESIGN.map((d) => (
              <div key={d.choice} className="rounded-2xl p-4" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
                <p className="font-semibold">{d.choice}</p>
                <p className="text-sm mt-1" style={muted}><strong style={{ color: "var(--gh-text)" }}>Why:</strong> {d.why}</p>
                <p className="text-sm mt-1" style={muted}><strong style={{ color: "var(--gh-text)" }}>How:</strong> {d.how}</p>
              </div>
            ))}
          </div>
          <p className="text-sm" style={muted}>
            One honest caveat: the reference bridge hardware includes a microphone. The presence firmware does not record or transmit audio, but the hardware being present is itself something I treat as a risk to engineer out, not just to promise about.
            Likewise, keeping guest rooms out of scope depends on where bridges are placed, with a name check on the backend as a backstop, not a guarantee on its own.
          </p>
        </Section>

        <Section kicker="Our commitments" title="How Illy Robotic Instruments approaches AI and transmission-frequency privacy">
          <p>
            <CompanyLink /> builds sensing and AI products. We believe the people who build technology that can observe others owe those people more than legal compliance, particularly while the law is still catching up. We commit to:
          </p>
          <ol className="space-y-3 list-decimal pl-5">
            <li><strong>Notice and consent first.</strong> Sensing should never be invisible to the people it measures. Deployments need clear notice, and we treat consent as a condition of operating, not an afterthought.</li>
            <li><strong>Public spaces only.</strong> We do not sense private rooms. Where the physics of radio could reach them, we design placement and software to keep them out.</li>
            <li><strong>Collect the minimum.</strong> Derived features instead of raw signal, anonymised identifiers instead of addresses, and short memory instead of archives.</li>
            <li><strong>Presence, never identity.</strong> Echo Vue answers whether anyone is there and how busy a space is. It is not built to identify anyone: even the nearby-device hint uses ids that reset daily and says only that a device has been around for a while.</li>
            <li><strong>Honesty about what AI can and cannot tell.</strong> Estimates are labelled as estimates. When the signal is not good enough, the system says so rather than inventing a number, and live presence readings are never simulated.</li>
            <li><strong>Human accountability.</strong> Operators decide where sensing happens: a bridge only senses the area it is placed in and assigned to. They remain responsible for how it is used. A model&apos;s output is an input to a human decision, not a replacement for it.</li>
            <li><strong>Open to scrutiny.</strong> We publish how the system works, including its limits, and we welcome legal, ethical and technical review. We expect deployments to have legal review in their own jurisdiction before they go live.</li>
          </ol>
          <p>
            Our view is simple: the fact that a signal is invisible is a reason for more care, not less.
          </p>
        </Section>

        <Section kicker="Still open" title="What responsible deployment still requires">
          <p>Echo Vue is a prototype, and a case study is not a compliance programme. Before anything like it is used on real guests, these remain to be done:</p>
          <ul className="space-y-2 list-disc pl-5">
            <li>Review by an attorney in the jurisdiction of use, covering wiretap and eavesdropping, consumer-protection, biometric and health-data rules, and landlord and guest rights.</li>
            <li>Plain-language notice in the places that are sensed, and a way for guests and staff to ask questions or object.</li>
            <li>A written retention and access policy, including how requests from third parties would be handled.</li>
            <li>A formal privacy impact assessment and independent testing of the accuracy claims made about breathing and occupancy.</li>
            <li>A conversation with regulators, researchers and privacy advocates, because the standards for this kind of sensing should not be written by the people who profit from it alone.</li>
          </ul>
        </Section>

        <Section kicker="Takeaways" title="What three weeks taught me">
          <ul className="space-y-2 list-disc pl-5">
            <li><strong>Invisible is not the same as unregulated, or harmless.</strong> Design for the strictest reasonable reading.</li>
            <li><strong>Architecture beats policy.</strong> What a system cannot do is a stronger guarantee than what it promises not to do.</li>
            <li><strong>Accuracy is an ethical issue.</strong> Overclaiming what a sensor can tell about people is a form of harm.</li>
            <li><strong>The burden follows the invisibility.</strong> When subjects cannot see the sensor, the builder must do the work of notice, restraint and honesty for them.</li>
          </ul>
          <div className="rounded-2xl p-5 mt-6" style={{ backgroundColor: "rgba(66,133,244,0.07)", border: "1px solid var(--gh-border)" }}>
            <p className="font-semibold mb-1">Read the policy, or talk to us</p>
            <p className="text-sm" style={muted}>
              The operational details are in the <Link href="/privacy" className="underline hover:no-underline" style={{ color: "var(--gh-blue)" }}>Privacy &amp; Sensing Policy</Link>.
              To discuss this work, visit <CompanyLink>Illy Robotic Instruments</CompanyLink>.
            </p>
          </div>
        </Section>
      </article>

      <CompanyFooter />
    </main>
  );
}
