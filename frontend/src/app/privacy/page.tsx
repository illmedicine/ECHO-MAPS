/*
 * EchoVue Privacy Policy — CSI presence sensing (opt-in).
 *
 * DRAFT TEMPLATE. This is not legal advice. It must be reviewed and approved by
 * an attorney licensed in the applicable jurisdiction (e.g., South Carolina)
 * BEFORE any data is collected from any guest. Do not represent the consented
 * sensing system as active unless it is truly running under this policy.
 */

const EFFECTIVE_DATE = "October 7, 2026";
import { CompanyFooter } from "@/components/CompanyLink";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--gh-text)" }}>{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: "var(--gh-text-muted)" }}>{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-10">
        <div className="mb-8">
          <a href="/" className="text-sm hover:underline" style={{ color: "var(--gh-blue)" }}>← Echo Vue</a>
          <h1 className="text-2xl md:text-3xl font-bold mt-3">Privacy &amp; Sensing Policy</h1>
          <p className="text-sm mt-1" style={{ color: "var(--gh-text-muted)" }}>Effective {EFFECTIVE_DATE}</p>
        </div>

        <div className="rounded-xl p-4 mb-8 text-sm" style={{ backgroundColor: "rgba(251,188,5,0.12)", border: "1px solid rgba(251,188,5,0.35)", color: "var(--gh-text)" }}>
          This policy governs an <strong>optional, opt-in</strong> Wi-Fi Channel State Information (CSI)
          sensing program. It applies only to rooms where the current guest has given explicit, written
          consent. If you have not opted in, no CSI sensing is performed for your room.
        </div>

        <Section title="1. What this technology is">
          <p>
            Echo Vue uses <strong>non-optical Wi-Fi Channel State Information (CSI)</strong>. It measures how
            ambient Wi-Fi radio signals already present in a building are reflected and altered by motion and
            large objects in a space. From those reflections it can estimate <strong>presence, a coarse count
            of occupants, and gross movement/respiration patterns</strong> (e.g., someone is moving, still, or
            their breathing has changed markedly).
          </p>
          <p>
            It does <strong>not</strong> use cameras, does not record video or still images, does not capture
            audio, and does not inspect, log, or track the content of your internet activity.
          </p>
        </Section>

        <Section title="2. Consent is optional and revocable">
          <p>
            CSI sensing is performed <strong>only with your affirmative, written opt-in</strong>, recorded
            per room and per stay. You may <strong>decline or revoke consent at any time</strong> at the front
            desk, and sensing for your room will be disabled promptly.
          </p>
          <p>
            Your choice has <strong>no effect</strong> on your room rate, your ability to stay, your deposit,
            or the level of service you receive. Staff are prohibited from pressuring any guest to opt in.
          </p>
        </Section>

        <Section title="3. What we do and do not collect">
          <p><strong>We collect, only for opted-in rooms:</strong> radio-signal reflection measurements, and
            derived signals such as motion state, an estimated occupant count, and coarse respiration/stillness
            indicators used for safety and emergency detection.</p>
          <p><strong>We do not collect:</strong> video, photographs, audio, voice, your network traffic or
            browsing, device identifiers tied to you, or any biometric template that identifies you as an
            individual.</p>
        </Section>

        <Section title="4. How the data is handled (de-identification)">
          <p>
            Sensing data is processed at the edge and reduced to the minimum needed for the safety purposes
            below. It is <strong>de-identified at the sensing layer</strong> and is <strong>not linked to your
            name, reservation, ID, or payment information</strong> in our property-management system. Records
            take the form of room-level events (for example, &ldquo;Room 104 — 3 occupants&rdquo;).
          </p>
          <p>
            We describe this data as <strong>de-identified / pseudonymous, not anonymous</strong>: because a
            room can correspond to a known guest, we treat it with the same care as personal data and apply
            the safeguards in this policy accordingly.
          </p>
          <p>
            Raw radio-wave data is processed in near-real-time and discarded. We retain only the minimum
            derived safety events, for the shortest period needed, and we do not build historical movement or
            breathing logs of guests.
          </p>
        </Section>

        <Section title="5. Why we use it (purpose limitation)">
          <p>Opted-in sensing is used <strong>only</strong> for:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Emergency medical alerts</strong> — detecting sudden prolonged cessation of movement or
              extreme respiration changes, so staff can dispatch emergency services for an unresponsive guest.</li>
            <li><strong>Life-safety occupancy</strong> — estimating occupancy to help prevent hazardous
              overcrowding and support fire-code compliance.</li>
          </ul>
          <p>
            We do <strong>not</strong> use it for marketing, profiling, surveillance of lawful guest activity,
            commercial analytics, or routine disclosure to third parties. We do not sell or share this data.
          </p>
        </Section>

        <Section title="6. Important limitations — not a medical device">
          <p>
            Echo Vue is <strong>not a certified medical device</strong> and is not a substitute for professional
            medical monitoring or emergency services. It may miss events or generate false alerts. Do not rely
            on it as a sole means of life safety.
          </p>
        </Section>

        <Section title="7. Your rights">
          <p>
            You may opt out at any time, ask whether sensing is active for your room, ask that it be disabled,
            and ask questions about this program at the front desk. Opting out is free and carries no penalty.
          </p>
        </Section>

        <Section title="8. Minors and vulnerable persons">
          <p>
            Consent must be given by the registered adult guest for the room. The program is not directed at
            identifying or profiling children or any individual.
          </p>
        </Section>

        <Section title="9. Security">
          <p>
            We apply administrative and technical safeguards to the limited derived data we process, including
            access controls and separation from identity systems. No system is perfectly secure.
          </p>
        </Section>

        <Section title="10. Changes and contact">
          <p>
            We may update this policy; material changes will be posted with a new effective date. For questions,
            opt-out requests, or complaints, contact property management at the front desk or the operator of
            this Echo Vue deployment.
          </p>
        </Section>

        <div className="rounded-xl p-4 mt-10 text-xs" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text-muted)" }}>
          <strong>Operator note (not shown to guests in final form):</strong> This is a draft template and not
          legal advice. Before collecting any data, have it reviewed and approved by an attorney licensed in the
          jurisdiction of deployment, confirm compliance with applicable wiretap/eavesdropping, consumer-protection,
          health-data, and landlord-tenant laws, and ensure the technical system actually enforces the opt-in,
          de-identification, minimization, and deletion commitments stated above.
        </div>
        <CompanyFooter />
      </div>
    </main>
  );
}
