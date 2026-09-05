// Write coverage.json, the freshness sidecar for the data artifacts.
//
// The existing artifacts carry a "source" but no generated-at timestamp, and
// the portal charts parse only their "data" array. Rather than change every
// artifact's shape (which would rewrite ten committed files and has to be
// justified against every consumer), freshness metadata lives in one sidecar:
// coverage.json. methodology.md already points readers at a coverage.json for
// per-series cutoff dates; this produces the file that reference expects.
//
// For each series it records the source label and the newest date covered. The
// file carries a single generated_at timestamp so a reader can see when the
// pipeline last ran. Because that timestamp changes every run, the workflow
// only commits coverage.json alongside a genuine data change, never on its own.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { dataDir } from "./lib/util.ts";

// The artifacts to summarize, in a stable order.
const ARTIFACTS = [
  "btc-usd-daily.json",
  "btc-eur-daily.json",
  "btc-gbp-daily.json",
  "btc-jpy-daily.json",
  "xau-usd-daily.json",
  "us-cpi-monthly.json",
  "us-cpi-core-monthly.json",
  "us-ppi-monthly.json",
  "btc-xau-daily.json",
  "hardness-ratio-daily.json",
];

export type SeriesCoverage = {
  file: string;
  source: string | null;
  rows: number;
  distinct_dates: number;
  newest_date: string | null;
};

function summarize(dir: string, file: string): SeriesCoverage {
  const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
    source?: string;
    data: [string, ...number[]][];
  };
  const dates = parsed.data.map((r) => r[0]);
  const distinct = new Set(dates);
  let newest: string | null = null;
  for (const d of dates) if (newest === null || d > newest) newest = d;
  return {
    file,
    source: parsed.source ?? null,
    rows: parsed.data.length,
    distinct_dates: distinct.size,
    newest_date: newest,
  };
}

export function buildCoverage(generatedAt: string): {
  generated_at: string;
  series: SeriesCoverage[];
} {
  const dir = dataDir();
  const series = ARTIFACTS.filter((f) => existsSync(join(dir, f))).map((f) => summarize(dir, f));
  return { generated_at: generatedAt, series };
}

export function writeCoverage(generatedAt: string): {
  generated_at: string;
  series: SeriesCoverage[];
} {
  const dir = dataDir();
  const payload = buildCoverage(generatedAt);
  writeFileSync(join(dir, "coverage.json"), JSON.stringify(payload, null, 2));
  for (const s of payload.series) {
    console.log(`coverage ${s.file}: newest ${s.newest_date} (${s.distinct_dates} distinct dates)`);
  }
  return payload;
}

if (import.meta.main) {
  writeCoverage(new Date().toISOString());
}
