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
// that series' own expected cadence allows, whether or not anything else
// changed. The cadences are not uniform: the BTC fiat series and the gold
// series update daily, the inflation series update monthly, and the two
// derived series inherit the stricter (larger, because business-day gaps are
// wider than calendar-day gaps) of their daily inputs.
//
// THE TWO CADENCES ARE CHECKED DIFFERENTLY, ON PURPOSE (OR-T1451).
//
// A daily series is checked by AGE: is the newest observation's own UTC day
// more than `thresholdDays` behind now. That works because a daily series'
// own day IS the thing that ages.
//
// A monthly series is checked by MONTH, not by age. The first version of
// this file measured monthly staleness with a fixed day-count threshold from
// period_start too, and that cannot be both correct and fast: period_start
// is the FIRST of the covered month, so a healthy series legitimately
// reaches 82 days old on the worst month pair (31 + 31, see the CADENCE
// reasoning below), and any threshold that does not false-red on that
// healthy case has to sit above it. A source that dies immediately after
// publishing month M is then only reported once it reaches that padded
// threshold, which is weeks after the M+1 release was actually due. The
// month never got any younger in that window; the check just was not asking
// the question that would have caught it.
//
// So this module does not ask "how many days old is the newest point". It
// asks "is the newest point the month it should be": it computes the latest
// month whose release is already due, given a per-source publication lag,
// and requires the newest period_start to be at least that month. Month
// length stops mattering (there is no false-red to buy slack against), and a
// missed release is visible the day it was due, not weeks later.
//
// Pure, like guard.ts: no database, no file system, no wall clock read
// internally. The caller passes "now" in, so a test can freeze it.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type Cadence = "daily" | "monthly";

interface DailyCadenceRule {
  cadence: "daily";
  /** How many days behind "now" the newest observation may be. */
  thresholdDays: number;
  reason: string;
}

interface MonthlyCadenceRule {
  cadence: "monthly";
  /**
   * Days after the covered month ENDS before its release is expected. This
   * is the one number this module needs per monthly source: everything else
   * (which month is due, right now) is derived from it and from `now`, so
   * there is no separately-chosen day-count threshold left to get wrong by
   * measuring from the wrong end of the month.
   */
  lagDays: number;
  reason: string;
}

export type CadenceRule = DailyCadenceRule | MonthlyCadenceRule;

// Every artifact coverage.ts can produce must have a row here. A file with
// no row fails closed (see assertFresh below) rather than passing silently,
// so adding a new series without adding its cadence is a loud bug, not a
// gap.
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
    lagDays: 21,
    reason:
      "CPI is released 2 to 3 weeks after the covered month ends. These " +
      "series come from a republisher of the official release, and official " +
      "releases have slipped well past three weeks after the covered month " +
      "during past federal shutdowns, so a red here can be a source delay " +
      "rather than a pipeline fault. That is a reason to look at the source, " +
      "not a reason to raise this number: this module no longer needs slack " +
      "for month length (see the module comment above), so widening the lag " +
      "should only ever track a real, sustained change in the source's own " +
      "publication schedule.",
  },
  "us-cpi-core-monthly.json": {
    cadence: "monthly",
    lagDays: 21,
    reason: "Same monthly release schedule as us-cpi-monthly.json.",
  },
  "us-ppi-monthly.json": {
    cadence: "monthly",
    lagDays: 21,
    reason: "Same monthly release cadence as the CPI series.",
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

// The subset of coverage.ts's SeriesCoverage this module needs. A plain
// shape rather than an import so this file has zero dependency on the file
// system or the database, directly or indirectly.
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
  /** Set only for a daily-cadence series: the day-count threshold used. */
  thresholdDays: number | null;
  /**
   * Set only for a monthly-cadence series: period_start of the latest month
   * whose release is already due. newestDate must be at least this to pass.
   */
  dueMonth: string | null;
  pass: boolean;
}

function daysBetween(newer: Date, older: Date): number {
  const ms = newer.getTime() - older.getTime();
  return Math.floor(ms / MS_PER_DAY);
}

/**
 * YYYY-MM-01 for the given UTC year and zero-indexed month, the same shape
 * period_start always takes.
 */
function periodStartString(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
}

/**
 * The period_start (YYYY-MM-01) of the latest month whose release is already
 * due, given a publication lag measured in days from the end of the covered
 * month.
 *
 * Walks backward from the month containing `now`, which can never itself be
 * due because it has not ended yet. A month's due date is `lagDays` days
 * after it ends, which is `lagDays - 1` days after the first of the
 * FOLLOWING month (the day after the month ends is day 1 of the lag, not day
 * 0), so the walk stops at the first month behind `now` whose due date has
 * already passed.
 *
 * Capped at 24 steps: a lag that cannot resolve within two years means the
 * cadence row is misconfigured, and failing loudly here is better than
 * looping.
 */
function dueMonthPeriodStart(now: Date, lagDays: number): string {
  let year = now.getUTCFullYear();
  let month0 = now.getUTCMonth();
  for (let step = 0; step < 24; step++) {
    month0 -= 1;
    if (month0 < 0) {
      month0 = 11;
      year -= 1;
    }
    const firstOfFollowingMonth = Date.UTC(year, month0 + 1, 1);
    const dueAt = firstOfFollowingMonth + (lagDays - 1) * MS_PER_DAY;
    if (dueAt <= now.getTime()) {
      return periodStartString(year, month0);
    }
  }
  throw new Error(
    `dueMonthPeriodStart found no due month within 24 months of ${now.toISOString()} ` +
      `at a ${lagDays}-day lag. The lag is almost certainly misconfigured.`,
  );
}

function freshnessFor(file: string, rows: number, newestDate: string | null, now: Date): SeriesFreshness {
  const rule = CADENCE[file];
  if (!rule) {
    // A series with no cadence row is a bug in this table, not a pass.
    return { file, rows, newestDate, ageDays: null, thresholdDays: null, dueMonth: null, pass: false };
  }

  if (rule.cadence === "daily") {
    if (newestDate === null) {
      return {
        file,
        rows,
        newestDate: null,
        ageDays: null,
        thresholdDays: rule.thresholdDays,
        dueMonth: null,
        pass: false,
      };
    }
    const ageDays = daysBetween(now, new Date(`${newestDate}T00:00:00Z`));
    return {
      file,
      rows,
      newestDate,
      ageDays,
      thresholdDays: rule.thresholdDays,
      dueMonth: null,
      pass: ageDays <= rule.thresholdDays,
    };
  }

  const dueMonth = dueMonthPeriodStart(now, rule.lagDays);
  if (newestDate === null) {
    return { file, rows, newestDate: null, ageDays: null, thresholdDays: null, dueMonth, pass: false };
  }
  const ageDays = daysBetween(now, new Date(`${newestDate}T00:00:00Z`));
  return {
    file,
    rows,
    newestDate,
    ageDays,
    thresholdDays: null,
    dueMonth,
    // Both sides are YYYY-MM-01, the only shape period_start ever takes, so
    // a lexical comparison is a chronological one.
    pass: newestDate >= dueMonth,
  };
}

// Pure: takes the coverage summary this run already produced and the current
// time, and returns a pass/fail verdict per series. Never touches the
// database, the file system, or the wall clock itself, so a test can freeze
// "now" and hand in a fixture.
//
// Walks the input list first (so every existing caller that reads by index
// sees the same series in the same order as before), then walks the CADENCE
// table and appends a failing entry for any cadence-mapped file that had no
// matching entry in the input at all. That second pass is the point:
// coverage.ts only summarizes files that exist on disk, so a series whose
// export simply did not run this time never appears in `series`, and a loop
// over `series` alone can never see it missing. A cadence row with nothing
// to match fails exactly like a zero-row or unknown-file series does, rather
// than being silently absent from the report.
export function assertFresh(series: SeriesInput[], now: Date): SeriesFreshness[] {
  const seenFiles = new Set(series.map((s) => s.file));
  const results = series.map((s) => freshnessFor(s.file, s.rows, s.newest_date, now));

  for (const file of Object.keys(CADENCE)) {
    if (seenFiles.has(file)) continue;
    results.push(freshnessFor(file, 0, null, now));
  }

  return results;
}

function thresholdLabel(r: SeriesFreshness): string {
  if (r.thresholdDays !== null) return `${r.thresholdDays}d`;
  if (r.dueMonth !== null) return `due ${r.dueMonth}`;
  return "unknown";
}

// A run that checked nothing must not be able to read like a run that
// checked everything: print every series, on pass as well as on fail.
export function formatReport(results: SeriesFreshness[]): string {
  const lines = results.map((r) => {
    const status = r.pass ? "PASS" : "FAIL";
    const age = r.ageDays === null ? "unknown" : `${r.ageDays}d`;
    return (
      `  ${status}  ${r.file.padEnd(28)} rows=${r.rows} ` +
      `newest=${r.newestDate ?? "none"} age=${age} threshold=${thresholdLabel(r)}`
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
    throw new Error(`stale source: ${failing.length} series older than their expected cadence: ${names}`);
  }
}
