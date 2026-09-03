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
// This module fails the run when a series' newest data point is older than
// that series' own expected cadence, whether or not anything else changed.
// The cadences are not uniform: the BTC fiat series and the gold series
// update daily, the inflation series update monthly, and the two derived
// series inherit the stricter (larger, because business-day gaps are wider
// than calendar-day gaps) of their daily inputs. Every threshold below already
// includes its own margin, with the reasoning next to the number so a future
// reader can change one line instead of rereading this whole pipeline.
//
// READ THIS BEFORE ADDING OR CHANGING A THRESHOLD. Age is measured from the
// artifact's own newest_date, and newest_date means a different thing per
// cadence. For the daily series it is the observation's own UTC day, so the
// threshold is just the widest expected gap plus slack. For the monthly series
// it is period_start, the FIRST of the covered month, because that is the only
// date inflation.ts can emit: the publication lag is measured from the END of
// that month, and the reading then stays newest for a further whole month. A
// threshold written as though the monthly date were a publication date is too
// small by roughly two months and goes red on a healthy pipeline.
//
// Pure, like guard.ts: no database, no file system, no wall clock read
// internally. The caller passes "now" in, so a test can freeze it.

export type Cadence = "daily" | "monthly";

export interface CadenceRule {
  cadence: Cadence;
  thresholdDays: number;
  reason: string;
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
    thresholdDays: 90,
    reason:
      "Measured from period_start, the FIRST of the covered month, not the " +
      "last: that is the only date inflation.ts can emit. Two things stack. " +
      "CPI is released 2 to 3 weeks after the covered month ENDS, and the " +
      "month M reading then stays the newest point for a whole month, until " +
      "M+1 is released. The age of month M's reading peaks on the day M+1 " +
      "is released, which is days(M) + days(M+1) - 1 + release lag after " +
      "period_start(M): the lag runs from the END of M+1, and the last day " +
      "of M+1 is itself days(M) + days(M+1) - 1 days after the first of M. " +
      "The worst month pairs are 31 + 31 (July with August, December with " +
      "January): 31 + 31 - 1 + 21 = 82 days, which is the age the " +
      "worst-alignment test in scripts/export/age.test.ts pins. 90 leaves " +
      "eight days of slack on top of that. 82 is reached only in those two " +
      "pairs, but every other pair except the two containing February " +
      "reaches 81, so a threshold of 80 would go red in ten months of the " +
      "twelve, not twice a year. " +
      "The 21 day lag is an assumption about the source, not a bound on " +
      "it: these series come from a republisher of the official release, " +
      "and official releases have slipped well past three weeks after the " +
      "covered month during past federal shutdowns. A 31 + 31 pair is " +
      "already 61 days old before any lag is added, so a release slipping " +
      "past 29 days puts a HEALTHY pipeline over 90, and a 35 day slip " +
      "reaches 96. That red is a source delay, not a pipeline fault, and " +
      "it is not a reason to raise this number.",
  },
  "us-cpi-core-monthly.json": {
    cadence: "monthly",
    thresholdDays: 90,
    reason: "Same monthly release schedule as us-cpi-monthly.json, and the same 82 day worst case.",
  },
  "us-ppi-monthly.json": {
    cadence: "monthly",
    thresholdDays: 90,
    reason: "Same monthly release cadence as the CPI series, and the same 82 day worst case.",
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
  ageDays: number | null;
  thresholdDays: number;
  pass: boolean;
}

function daysBetween(newer: Date, older: Date): number {
  const ms = newer.getTime() - older.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
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

  const results = series.map((s) => {
    const rule = CADENCE[s.file];
    if (!rule) {
      // A series with no cadence row is a bug in this table, not a pass.
      return {
        file: s.file,
        rows: s.rows,
        newestDate: s.newest_date,
        ageDays: null,
        thresholdDays: -1,
        pass: false,
      };
    }
    if (s.newest_date === null) {
      return {
        file: s.file,
        rows: s.rows,
        newestDate: null,
        ageDays: null,
        thresholdDays: rule.thresholdDays,
        pass: false,
      };
    }
    const ageDays = daysBetween(now, new Date(`${s.newest_date}T00:00:00Z`));
    return {
      file: s.file,
      rows: s.rows,
      newestDate: s.newest_date,
      ageDays,
      thresholdDays: rule.thresholdDays,
      pass: ageDays <= rule.thresholdDays,
    };
  });

  for (const file of Object.keys(CADENCE)) {
    if (seenFiles.has(file)) continue;
    // A cadence row exists but nothing in the input names this file: the
    // artifact was not produced at all this run (its export file is
    // missing), not merely stale. Fail closed rather than skip it.
    results.push({
      file,
      rows: 0,
      newestDate: null,
      ageDays: null,
      thresholdDays: CADENCE[file].thresholdDays,
      pass: false,
    });
  }

  return results;
}

// A run that checked nothing must not be able to read like a run that checked
// everything: print every series, on pass as well as on fail.
export function formatReport(results: SeriesFreshness[]): string {
  const lines = results.map((r) => {
    const status = r.pass ? "PASS" : "FAIL";
    const age = r.ageDays === null ? "unknown" : `${r.ageDays}d`;
    return (
      `  ${status}  ${r.file.padEnd(28)} rows=${r.rows} ` +
      `newest=${r.newestDate ?? "none"} age=${age} threshold=${r.thresholdDays}d`
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
