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
      "M+1 is released. So the worst case for a HEALTHY series is " +
      "days(M) + days(M+1) + slowest release lag, and the worst month pairs " +
      "are 31 + 31 (July with August, December with January): " +
      "31 + 31 + 21 = 83 days. 90 leaves a week of slack on top of that. " +
      "Anything below 83 goes red on a working pipeline twice a year.",
  },
  "us-cpi-core-monthly.json": {
    cadence: "monthly",
    thresholdDays: 90,
    reason: "Same monthly release schedule as us-cpi-monthly.json, and the same 83 day worst case.",
  },
  "us-ppi-monthly.json": {
    cadence: "monthly",
    thresholdDays: 90,
    reason: "Same monthly release cadence as the CPI series, and the same 83 day worst case.",
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
export function assertFresh(series: SeriesInput[], now: Date): SeriesFreshness[] {
  return series.map((s) => {
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
