// Unit tests for the age assertion, exercised with fixtures and a frozen
// clock so they need no database and no dependency on the real wall clock.
//
// guard.test.ts proves guard.ts catches truncation and regression. It cannot
// prove staleness detection, because every one of its fixtures changes either
// the row count or the newest date, and a frozen source changes neither. This
// file supplies that missing case: a frozen "now" plus a fixture whose newest
// date has not moved, which is exactly the shape a dead source produces.

import { test, expect } from "bun:test";

import {
  assertFresh,
  assertAllFresh,
  latestDueMonthStart,
  CADENCE,
  isDailyRule,
  isMonthlyRule,
  type SeriesInput,
} from "./lib/age.ts";

const NOW = new Date("2026-09-02T06:00:00Z");

test("every artifact this pipeline can produce has a cadence row", () => {
  // Duplicated from coverage.ts's ARTIFACTS list rather than imported, so this
  // test also catches a new artifact added there with no matching cadence row
  // here: exactly the gap that let a series slip through unchecked.
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
  for (const file of ARTIFACTS) {
    expect(CADENCE[file]).toBeDefined();
  }
});

test("a series dated today passes", () => {
  const series: SeriesInput[] = [
    { file: "btc-usd-daily.json", rows: 100, newest_date: "2026-09-02" },
  ];
  const [result] = assertFresh(series, NOW);
  expect(result.pass).toBe(true);
  expect(result.ageDays).toBe(0);
});

test("a daily series exactly at its threshold still passes", () => {
  const series: SeriesInput[] = [
    { file: "btc-usd-daily.json", rows: 100, newest_date: "2026-08-29" }, // 4 days old
  ];
  const [result] = assertFresh(series, NOW);
  expect(result.ageDays).toBe(4);
  expect(result.pass).toBe(true);
});

test("a daily series past its threshold fails: this is the RED case", () => {
  const series: SeriesInput[] = [
    { file: "btc-usd-daily.json", rows: 100, newest_date: "2026-08-20" }, // 13 days old
  ];
  const [result] = assertFresh(series, NOW);
  expect(result.ageDays).toBe(13);
  expect(result.pass).toBe(false);
});

test("the daily thresholds stay at 4 and 5 days", () => {
  // The daily series measure age from the observation's own UTC day, so they
  // were never touched by the monthly period_start error and this rewrite
  // does not touch them either. Pinned so a future monthly change cannot
  // sweep them along with it.
  const usd = CADENCE["btc-usd-daily.json"];
  const xau = CADENCE["xau-usd-daily.json"];
  expect(isDailyRule(usd)).toBe(true);
  expect(isDailyRule(xau)).toBe(true);
  if (isDailyRule(usd) && isDailyRule(xau)) {
    expect(usd.thresholdDays).toBe(4);
    expect(xau.thresholdDays).toBe(5);
  }
});

test("the monthly release lag is 35 days for all three monthly artifacts", () => {
  // 21 days of real publication lag plus 14 days of slip tolerance, sized to
  // match what the old 90-day threshold tolerated at its worst alignment.
  // See the reason string in age.ts for the full arithmetic.
  for (const file of ["us-cpi-monthly.json", "us-cpi-core-monthly.json", "us-ppi-monthly.json"]) {
    const rule = CADENCE[file];
    expect(isMonthlyRule(rule)).toBe(true);
    if (isMonthlyRule(rule)) {
      expect(rule.releaseLagDays).toBe(35);
    }
  }
});

test("a monthly series stays fresh right up to the day before the next release is due, then fails exactly when it becomes due", () => {
  // July's reading (period_start 2026-07-01). August's release becomes due
  // at end-of-August (2026-09-01) plus the 35 day lag: 2026-10-06T00:00Z.
  const series: SeriesInput[] = [
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-07-01" },
  ];

  const justBeforeDue = new Date("2026-10-05T06:00:00Z");
  const [stillFresh] = assertFresh(series, justBeforeDue);
  expect(stillFresh.expectedDate).toBe("2026-07-01");
  expect(stillFresh.pass).toBe(true);

  const dueDay = new Date("2026-10-06T06:00:00Z");
  const [nowStale] = assertFresh(series, dueDay);
  expect(nowStale.expectedDate).toBe("2026-08-01");
  expect(nowStale.pass).toBe(false);
});

test("a HEALTHY monthly series can be very old and still pass: the case the old 82/83-day arithmetic existed to cover", () => {
  // Same fixture OR-T1451 added (July reading, worst 31+31 pair with August):
  // 96 days old by 2026-10-05, well past the old 90-day threshold. It still
  // passes here because pass no longer depends on age at all, only on
  // whether the next release (August's, due 2026-10-06) has come due yet.
  const series: SeriesInput[] = [
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-07-01" },
  ];
  const [result] = assertFresh(series, new Date("2026-10-05T06:00:00Z"));
  expect(result.pass).toBe(true);
  expect(result.ageDays).toBeNull();
  expect(result.cadence).toBe("monthly");
});

test("latestDueMonthStart needs no extra slack for a short month and costs no extra latency for a long pair", () => {
  // February 2026 has 28 days. Its reading becomes due-for-replacement when
  // March's release is due: end-of-March (2026-04-01) plus 35 days = 2026-05-06.
  expect(latestDueMonthStart(new Date("2026-05-05T06:00:00Z"), 35)).toBe("2026-02-01");
  expect(latestDueMonthStart(new Date("2026-05-06T06:00:00Z"), 35)).toBe("2026-03-01");
});

test("latestDueMonthStart normalises across a year boundary instead of resolving to a negative month", () => {
  // As of 2026-01-05, November 2025's release (due end-of-December plus 35
  // days = 2026-01-05T00:00Z) is the most recent one due; December's own
  // release is not due until 2026-02-05.
  expect(latestDueMonthStart(new Date("2026-01-05T06:00:00Z"), 35)).toBe("2025-11-01");
});

test("latestDueMonthStart throws rather than walking back forever when releaseLagDays is implausible", () => {
  expect(() => latestDueMonthStart(new Date("2026-09-02T06:00:00Z"), 10000)).toThrow(/implausible/);
});

test("assertAllFresh throws naming the stale series and prints every series, pass and fail alike", () => {
  const series: SeriesInput[] = [
    { file: "btc-usd-daily.json", rows: 100, newest_date: "2026-09-02" }, // fresh
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-01-01" }, // long overdue
  ];
  const logs: string[] = [];
  const original = console.log;
  console.log = (msg: string) => {
    logs.push(String(msg));
  };
  let thrown: Error | null = null;
  try {
    assertAllFresh(series, NOW);
  } catch (e) {
    thrown = e as Error;
  } finally {
    console.log = original;
  }
  expect(thrown).not.toBeNull();
  expect(thrown?.message).toMatch(/us-cpi-monthly\.json/);
  const printed = logs.join("\n");
  expect(printed).toContain("btc-usd-daily.json");
  expect(printed).toContain("us-cpi-monthly.json");
  expect(printed).toContain("PASS");
  expect(printed).toContain("FAIL");
});

test("assertAllFresh does not throw when every known series is present and fresh", () => {
  // Every cadence-mapped artifact must be present now, not just fresh: a
  // series missing from the input entirely fails closed (see the test
  // below). Build the fixture from CADENCE itself so a future artifact
  // added there does not silently leave this test passing 9 of 10.
  const dailyFresh = "2026-09-02"; // today: age 0 for every daily series.
  // period_start, the first of the covered month: the only shape
  // inflation.ts can emit. As of NOW (2026-09-02) the most recent due month
  // for a 35-day lag is 2026-06-01, so 2026-07-01 comfortably passes.
  const monthlyFresh = "2026-07-01";
  const series: SeriesInput[] = Object.entries(CADENCE).map(([file, rule]) => ({
    file,
    rows: 100,
    newest_date: rule.cadence === "daily" ? dailyFresh : monthlyFresh,
  }));
  expect(series.length).toBe(Object.keys(CADENCE).length);
  expect(() => assertAllFresh(series, NOW)).not.toThrow();
});

test("a series entirely missing from the input fails and is named, not silently skipped", () => {
  // This is the case OR-C0748 found: coverage.ts only summarizes files that
  // exist on disk, so an export that did not run this time never produces a
  // SeriesInput row at all. A check that only iterates the input can never
  // see that absence. Hand in nine of the ten known artifacts, all fresh,
  // and confirm the tenth is still reported and still fails the run.
  const omitted = "xau-usd-daily.json";
  const nineOfTen: SeriesInput[] = Object.entries(CADENCE)
    .filter(([file]) => file !== omitted)
    .map(([file, rule]) => ({
      file,
      rows: 100,
      newest_date: rule.cadence === "daily" ? "2026-09-02" : "2026-07-01",
    }));
  expect(nineOfTen.length).toBe(Object.keys(CADENCE).length - 1);

  const results = assertFresh(nineOfTen, NOW);
  const missing = results.find((r) => r.file === omitted);
  expect(missing).toBeDefined();
  expect(missing?.pass).toBe(false);
  expect(missing?.newestDate).toBeNull();

  expect(() => assertAllFresh(nineOfTen, NOW)).toThrow(new RegExp(omitted.replace(".", "\\.")));
});

test("a series with no newest date fails rather than reporting an unknown age as healthy", () => {
  const series: SeriesInput[] = [{ file: "btc-usd-daily.json", rows: 0, newest_date: null }];
  const [result] = assertFresh(series, NOW);
  expect(result.pass).toBe(false);
});

test("a file with no cadence row fails rather than passing silently", () => {
  const series: SeriesInput[] = [
    { file: "some-new-series-nobody-added-a-cadence-row-for.json", rows: 10, newest_date: "2026-09-02" },
  ];
  const [result] = assertFresh(series, NOW);
  expect(result.pass).toBe(false);
});
