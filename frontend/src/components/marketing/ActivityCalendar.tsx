/**
 * ActivityCalendar — the project's real commits and deployments, plotted on a calendar.
 *
 * Each month is a normal calendar. A day with activity shows how many commits (blue) and
 * deployments (green) happened; major-release days carry a numbered flag that is explained
 * in the list underneath. Days in the field-testing stretch are tinted so the gap reads as
 * "work happening off the keyboard", not as an empty space.
 *
 * Data: frontend/src/lib/activity.json, refreshed with `node scripts/update-activity.mjs`.
 */

import activity from "@/lib/activity.json";

export interface Release {
  date: string; // YYYY-MM-DD
  title: string;
}

type Dep = { pages?: number; api?: number; db?: number; other?: number };
const commits = activity.commits as Record<string, number>;
const deployments = activity.deployments as Record<string, Dep>;
const deployCount = (d?: Dep) => (d ? Object.values(d).reduce((a, b) => a + (b ?? 0), 0) : 0);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BLUE = "#4285f4";
const GREEN = "#1e9e5a";
const AMBER = "#d98e04";

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function ActivityCalendar({ releases, gapStart, gapEnd, through }: {
  releases: Release[];
  /** First and last day of the field-testing stretch (no commits), YYYY-MM-DD. */
  gapStart: string;
  gapEnd: string;
  /** Last day with data; later days are shown faded. */
  through: string;
}) {
  const flag = new Map(releases.map((r, i) => [r.date, i + 1]));
  const months: { y: number; m: number }[] = [];
  for (let m = 2; m <= 9; m++) months.push({ y: 2026, m });

  const totalCommits = Object.values(commits).reduce((a, b) => a + b, 0);
  const totalDeploys = Object.values(deployments).reduce((a, d) => a + deployCount(d), 0);
  const activeDays = new Set([...Object.keys(commits), ...Object.keys(deployments)]).size;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          [String(totalCommits), "commits", BLUE],
          [String(totalDeploys), "deployments", GREEN],
          [String(activeDays), "days with activity", "var(--gh-text)"],
          ["177", "days of field testing", AMBER],
        ].map(([v, l, c]) => (
          <div key={l} className="rounded-2xl p-4 text-center" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
            <p className="text-3xl font-bold" style={{ color: c, fontFamily: "Georgia, serif" }}>{v}</p>
            <p className="text-[11px] mt-1" style={{ color: "var(--gh-text-muted)" }}>{l}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs mb-5" style={{ color: "var(--gh-text-muted)" }}>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BLUE }} /> commits</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: GREEN }} /> deployments (GitHub Pages and the API)</span>
        <span className="flex items-center gap-1.5"><span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: AMBER }}>1</span> major release, see the list below</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: "rgba(217,142,4,0.14)", border: "1px dashed rgba(217,142,4,0.6)" }} /> field testing and research, no feature commits</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {months.map(({ y, m }) => {
          const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
          const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          const prefix = `${y}-${String(m + 1).padStart(2, "0")}`;
          const mc = Object.entries(commits).filter(([d]) => d.startsWith(prefix)).reduce((a, [, v]) => a + v, 0);
          const md = Object.entries(deployments).filter(([d]) => d.startsWith(prefix)).reduce((a, [, v]) => a + deployCount(v), 0);
          const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
          while (cells.length % 7) cells.push(null);
          const wholeMonthInGap = iso(y, m, 1) > gapStart && iso(y, m, days) < gapEnd;

          return (
            <section key={prefix} className="rounded-2xl p-4" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} aria-label={`${MONTHS[m]} ${y}: ${mc} commits, ${md} deployments`}>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg font-bold" style={{ fontFamily: "Georgia, serif" }}>{MONTHS[m]} <span className="font-normal text-sm" style={{ color: "var(--gh-text-muted)" }}>{y}</span></h3>
                <p className="text-[11px]" style={{ color: "var(--gh-text-muted)" }}>
                  <span style={{ color: BLUE }}>{mc} commits</span> · <span style={{ color: GREEN }}>{md} deploys</span>
                </p>
              </div>
              <div className="grid grid-cols-7 gap-1 text-[10px] mb-1" style={{ color: "var(--gh-text-muted)" }}>
                {DOW.map((d) => <span key={d} className="text-center">{d}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((d, i) => {
                  if (d === null) return <span key={i} />;
                  const date = iso(y, m, d);
                  const c = commits[date] ?? 0;
                  const dp = deployCount(deployments[date]);
                  const f = flag.get(date);
                  const inGap = date > gapStart && date < gapEnd;
                  const future = date > through;
                  const active = c > 0 || dp > 0;
                  return (
                    <div
                      key={i}
                      title={`${MONTHS[m]} ${d}: ${c} commit${c === 1 ? "" : "s"}, ${dp} deployment${dp === 1 ? "" : "s"}${f ? ` · ${releases[f - 1].title}` : ""}${inGap ? " · field testing and research" : ""}`}
                      className="rounded-md p-1 min-h-[54px] md:min-h-[62px] flex flex-col justify-between"
                      style={{
                        backgroundColor: active ? "var(--gh-bg)" : inGap ? "rgba(217,142,4,0.10)" : "transparent",
                        border: f ? `2px solid ${AMBER}` : active ? "1px solid var(--gh-border)" : inGap ? "1px dashed rgba(217,142,4,0.45)" : "1px solid var(--gh-border)",
                        opacity: future ? 0.35 : 1,
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-[11px] leading-none" style={{ color: active ? "var(--gh-text)" : "var(--gh-text-muted)", fontWeight: active ? 700 : 400 }}>{d}</span>
                        {f && (
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold text-white -mt-0.5" style={{ backgroundColor: AMBER }}>{f}</span>
                        )}
                      </div>
                      {active && (
                        <div className="space-y-0.5 text-[10px] leading-none font-semibold">
                          {c > 0 && <p style={{ color: BLUE }}><span aria-hidden>● </span>{c}</p>}
                          {dp > 0 && <p style={{ color: GREEN }}><span aria-hidden>■ </span>{dp}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {wholeMonthInGap && (
                <p className="text-[11px] mt-3 leading-snug" style={{ color: "#8a5a00" }}>
                  Field testing at home, data collection and research presentations. No feature commits this month.
                </p>
              )}
            </section>
          );
        })}
      </div>

      <h3 className="text-xl font-bold mt-10 mb-4" style={{ fontFamily: "Georgia, serif" }}>The major releases</h3>
      <ol className="space-y-2.5">
        {releases.map((r, i) => {
          const c = commits[r.date] ?? 0;
          const dp = deployCount(deployments[r.date]);
          const [, mm, dd] = r.date.split("-").map(Number);
          return (
            <li key={r.date + r.title} className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: AMBER }}>{i + 1}</span>
              <p className="text-sm leading-relaxed">
                <strong>{MONTHS[mm - 1].slice(0, 3)} {dd}</strong> · {r.title}
                <span className="ml-2 text-xs" style={{ color: "var(--gh-text-muted)" }}>
                  <span style={{ color: BLUE }}>{c} commits</span> · <span style={{ color: GREEN }}>{dp} deployments</span>
                </span>
              </p>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] mt-4" style={{ color: "var(--gh-text-muted)" }}>
        Snapshot from the repository and GitHub&apos;s deployments API as of {new Date(activity.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. A deployment is one publish to GitHub Pages or the hosted API.
      </p>
    </div>
  );
}
