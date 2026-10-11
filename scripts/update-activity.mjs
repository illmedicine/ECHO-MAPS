#!/usr/bin/env node
/**
 * Snapshots commit and deployment activity per day for the Research page activity calendar.
 *
 *   node scripts/update-activity.mjs
 *
 * Needs git and an authenticated GitHub CLI (`gh`). Writes frontend/src/lib/activity.json.
 * Days are in the local time of the latest commit's author offset, so a commit and the
 * deployment it triggers land on the same day.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);

// Local-time offset of the latest commit, e.g. "-04:00" -> -240 minutes.
const latest = run("git", ["log", "-1", "--format=%aI"]);
const m = /([+-])(\d\d):(\d\d)$/.exec(latest);
const offsetMin = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;

const dayLocal = (iso) => new Date(new Date(iso).getTime() + offsetMin * 60000).toISOString().slice(0, 10);

const commits = {};
for (const line of run("git", ["log", "--format=%aI"]).split("\n").filter(Boolean)) {
  const d = line.slice(0, 10); // already local to the author
  commits[d] = (commits[d] ?? 0) + 1;
}

const kinds = { "github-pages": "pages", "main - echo-maps-api": "api", "main - echo-maps-db": "db" };
const deployments = {};
const rows = run("gh", ["api", `repos/${repo}/deployments?per_page=100`, "--paginate", "-q", '.[] | [.created_at, .environment] | @tsv']);
for (const row of rows.split("\n").filter(Boolean)) {
  const [created, env] = row.split("\t");
  const d = dayLocal(created);
  const k = kinds[env] ?? "other";
  deployments[d] = deployments[d] ?? {};
  deployments[d][k] = (deployments[d][k] ?? 0) + 1;
}

const sum = (o, f = (v) => v) => Object.values(o).reduce((a, v) => a + f(v), 0);
const out = {
  generatedAt: new Date().toISOString(),
  repo,
  offsetMinutes: offsetMin,
  totals: { commits: sum(commits), deployments: sum(deployments, (v) => Object.values(v).reduce((a, b) => a + b, 0)) },
  commits,
  deployments,
};

const file = join(root, "frontend", "src", "lib", "activity.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${file}: ${out.totals.commits} commits, ${out.totals.deployments} deployments`);
