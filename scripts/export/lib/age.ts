// Age assertion: the second guard.
//
// guard.ts catches truncation and regression: zero rows, the newest date
// moving backwards, or distinct dates shrinking. It cannot catch a frozen
// source. Against a database that has stopped updating, every exporter still
// returns the same rows it returned last time: the row count does not drop,
// the newest date does not move backwards, and the distinct-date count does
// not shrink. To guard.ts, a dead source and a genuinely quiet day are the
// same observation.
//
// This module fails the run when a series has not published what it should
// already have published by now, whether or not anything else changed. The
// cadences are not uniform: the BTC fiat series and the gold series update
// daily, the inflation series update monthly, and the two derived series
// inherit the stricter (larger, because business-day gaps are wider than
// calendar-day gaps) of their daily inputs.
//
// DAILY series are checked with a day-count threshold from the observation's
// own UTC day. That arithmetic is simple and was never the source of the
// OR-T1451 / OR-T1798 errors, so it is unchanged.
//
// MONTHLY series are checked differently (OR-T1800). A monthly artifact's
// newest_date is period_start, the FIRST of the covered month: that is the
// only date inflation.ts can emit. A day-count threshold measured from
// period_start cannot be both false-positive free and fast: it must sit
// above the worst healthy age (82 days, on a 31+31 month pair like July and
// August), so a source that died right after publishing month M was only
// caught 30 to 45 days after month M+1's release was actually due. Instead
// of counting days, this module asks a calendar question: is the newest
// point the most recent month whose release is already due? That question
// does not need a single global threshold sized for the worst-case pair, so
// there is no false-red slack to buy, and a dead source is caught within
// releaseLagDays of its own next release being due, not within six weeks.
//
// Pure, like guard.ts: no database, no file system, no wall clock read
// internally. The caller passes "now" in, so a test can freeze it.

export type Cadence = "daily" | "monthly";

// A discriminated union so a monthly row literally cannot carry a day count.
// The class of bug behind OR-T1451 and OR-T1798 was a day threshold applied
// to a period_start; this makes that a type error instead of a comment
// nobody reads.
export type CadenceRule =
  | { cadence: "daily"; thresholdDays: number; reason: string }
  | { cadence: "monthly"; releaseLagDays: number; reason: string };

export function isDailyRule(rule: CadenceRule): rule is Extract<CadenceRule, { cadence: "daily" }> {
  return rule.cadence === "daily";
}

export function isMonthlyRule(rule: CadenceRule): rule is Extract<CadenceRule, { cadence: "monthly" }> {
  return rule.cadence === "monthly";
}

// Every artifact coverage.ts can produce must have a row here. A file with no
// row fails closed (see assertFresh below) rather than passing silently, so
// adding a new series without adding its cadence is a loud bug, not a gap.
export const CADENCE: Record<string, CadenceRule> = {
  "btc-usd-daily.json": {
    cadence: "daily",
    thresholdDays: 4,
    reason:
      "BTC/USD trades every day of the year. 4 days covers a 3-day weekend " +
      "or holiday gap in our own pipeline plus a day of slack.",
  },
  "btc-eur-daily.json": {
    cadence: "daily",
    thresholdDays: 4,
    reason: "Same cadence as btc-usd-daily.json: BTC/EUR trades every day.",
  },
  "btc-gbp-daily.json": {
    cadence: "daily",
    thresholdDays: 4,
    reason: "Same cadence as btc-usd-daily.json: BTC/GBP trades every day.",
  },
  "btc-jpy-daily.json": {
    cadence: "daily",
    thresholdDays: 4,
    reason: "Same cadence as btc-usd-daily.json: BTC/JPY trades every day.",
  },
  "xau-usd-daily.json": {
    cadence: "daily",
    thresholdDays: 5,
    reason:
      "The LBMA gold fix only publishes on business days, so a 3-day " +
      "weekend plus a Monday holiday is a real 4-day gap in the source " +
      "itself. 5 days leaves one more day of pipeline slack on top of that.",
  },
  "us-cpi-monthly.json": {
    cadence: "monthly",
    releaseLagDays: 35,
    reason:
      "21 days is the slowest realistic publication lag for CPI after the " +
      "covered month ends: these series come from a republisher of the " +
      "official release, and official releases have slipped well past " +
      "three weeks after the covered month during past federal shutdowns. " +
      "The extra 14 days is slip tolerance, sized to match what the old " +
      "90-day, period_start-measured threshold tolerated at its tightest " +
      "point (the 31+31 month pair), so this change costs no slip " +
      "tolerance at the worst case and stops being accidentally generous " +
      "in every other month pair. A release that slips past 35 days after " +
      "its covered month ends is a source delay, not a pipeline fault, and " +
      "is not a reason to raise this number.",
  },
  "us-cpi-core-monthly.json": {
    cadence: "monthly",
    releaseLagDays: 35,
    reason:
      "Same release calendar as us-cpi-monthly.json: both are CPI series " +
      "from the same source on the same publication schedule.",
  },
  "us-ppi-monthly.json": {
    cadence: "monthly",
    releaseLagDays: 35,
    reason:
      "Same release calendar as us-cpi-monthly.json: PPI is published by " +
      "the same source on the same monthly schedule.",
  },
  "btc-xau-daily.json": {
    cadence: "daily",
    thresholdDays: 5,
    reason:
      "Derived from btc-usd-daily.json and xau-usd-daily.json. Inherits the " +
      "stricter of its two daily inputs, which is xau-usd's business-day gap.",
  },
  "hardness-ratio-daily.json": {
    cadence: "daily",
    thresholdDays: 5,
    reason:
      "Same two inputs and the same derivation as btc-xau-daily.json, so it " +
      "inherits the same threshold.",
  },
};

// The subset of coverage.ts's SeriesCoverage this module needs. A plain shape
// rather than an import so this file has zero dependency on the file system
// or the database, directly or indirectly.
export interface SeriesInput {
  file: string;
  rows: number;
  newest_date: string | null;
}

export interface SeriesFreshness {
  file: string;
  rows: number;
  newestDate: string | null;
  cadence: Cadence | null; // null when the file has no cadence row at all
  ageDays: number | null; // daily only; always null for a monthly series
  thresholdDays: number | null; // daily only; always null for a monthly series
  expectedDate: string | null; // monthly only; the oldest newest_date that still passes
  pass: boolean;
}

function daysBetween(newer: Date, older: Date): number {
  const ms = newer.getTime() - older.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Walk back from the month before "now" until that month's release is
// already due: a month M's release is due once end-of-M (the first of M+1)
// plus releaseLagDays has passed. The first month found walking backwards is
// therefore the most recent month whose release is already due, so a
// healthy monthly series must have newest_date >= that month's period_start.
// Bounded at 24 months so an implausible releaseLagDays throws loudly
// instead of walking back forever.
export function latestDueMonthStart(now: Date, releaseLagDays: number): string {
  const y = now.getUTCFullYear();
  const startMonth = now.getUTCMonth() - 1; // Date.UTC normalises a negative month index.
  for (let step = 0; step < 24; step++) {
    const m = startMonth - step;
    const endOfM = Date.UTC(y, m + 1, 1);
    if (endOfM + releaseLagDays * 24 * 60 * 60 * 1000 <= now.getTime()) {
      return iso(Date.UTC(y, m, 1));
    }
  }
  throw new Error(
    `no due month found within 24 months: releaseLagDays=${releaseLagDays} is implausible`,
  );
}

function evaluate(s: SeriesInput, now: Date): SeriesFreshness {
  const rule = CADENCE[s.file];
  if (!rule) {
    // A series with no cadence row is a bug in this table, not a pass.
    return {
      file: s.file,
      rows: s.rows,
      newestDate: s.newest_date,
      cadence: null,
      ageDays: null,
      thresholdDays: null,
      expectedDate: null,
      pass: false,
    };
  }

  if (isMonthlyRule(rule)) {
    const expectedDate = latestDueMonthStart(now, rule.releaseLagDays);
    return {
      file: s.file,
      rows: s.rows,
      newestDate: s.newest_date,
      cadence: "monthly",
      ageDays: null,
      thresholdDays: null,
      expectedDate,
      pass: s.newest_date !== null && s.newest_date >= expectedDate,
    };
  }

  // daily
  if (s.newest_date === null) {
    return {
      file: s.file,
      rows: s.rows,
      newestDate: null,
      cadence: "daily",
      ageDays: null,
      thresholdDays: rule.thresholdDays,
      expectedDate: null,
      pass: false,
    };
  }
  const ageDays = daysBetween(now, new Date(`${s.newest_date}T00:00:00Z`));
  return {
    file: s.file,
    rows: s.rows,
    newestDate: s.newest_date,
    cadence: "daily",
    ageDays,
    thresholdDays: rule.thresholdDays,
    expectedDate: null,
    pass: ageDays <= rule.thresholdDays,
  };
}

// Pure: takes the coverage summary this run already produced and the current
// time, and returns a pass/fail verdict per series. Never touches the
// database, the file system, or the wall clock itself, so a test can freeze
// "now" and hand in a fixture.
//
// Walks the input list first (so every existing caller that destructures
// index 0 sees the same series in the same order as before), then walks the
// CADENCE table and appends a failing entry for any cadence-mapped file that
// had no matching entry in the input at all. That second pass is the point:
// coverage.ts only summarizes files that exist on disk, so a series whose
// export simply did not run this time never appears in `series` and a loop
// over `series` alone can never see it missing. A cadence row with nothing
// to match fails exactly like a zero-row or unknown-file series does, rather
// than being silently absent from the report.
export function assertFresh(series: SeriesInput[], now: Date): SeriesFreshness[] {
  const seenFiles = new Set(series.map((s) => s.file));

  const results = series.map((s) => evaluate(s, now));

  for (const file of Object.keys(CADENCE)) {
    if (seenFiles.has(file)) continue;
    // A cadence row exists but nothing in the input names this file: the
    // artifact was not produced at all this run (its export file is
    // missing), not merely stale. Fail closed rather than skip it.
    results.push(evaluate({ file, rows: 0, newest_date: null }, now));
  }

  return results;
}

// A run that checked nothing must not be able to read like a run that checked
// everything: print every series, on pass as well as on fail.
export function formatReport(results: SeriesFreshness[]): string {
  const lines = results.map((r) => {
    const status = r.pass ? "PASS" : "FAIL";
    if (r.cadence === "monthly") {
      return (
        `  ${status}  ${r.file.padEnd(28)} rows=${r.rows} ` +
        `newest=${r.newestDate ?? "none"} expected>=${r.expectedDate ?? "unknown"}`
      );
    }
    const age = r.ageDays === null ? "unknown" : `${r.ageDays}d`;
    const threshold = r.thresholdDays === null ? "" : ` threshold=${r.thresholdDays}d`;
    return (
      `  ${status}  ${r.file.padEnd(28)} rows=${r.rows} ` +
      `newest=${r.newestDate ?? "none"} age=${age}${threshold}`
    );
  });
  return ["age assertion (per series, on every run):", ...lines].join("\n");
}

// Print the report, then throw if anything is stale. Called from run-all.ts
// after the coverage sidecar is written.
export function assertAllFresh(series: SeriesInput[], now: Date): void {
  const results = assertFresh(series, now);
  console.log(formatReport(results));
  const failing = results.filter((r) => !r.pass);
  if (failing.length > 0) {
    const names = failing.map((r) => r.file).join(", ");
    throw new Error(
      `stale source: ${failing.length} series older than their expected cadence: ${names}`,
    );
  }
}
