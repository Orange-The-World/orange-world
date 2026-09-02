// Unit tests for the age assertion, exercised with fixtures and a frozen
// clock so they need no database and no dependency on the real wall clock.
//
// guard.test.ts proves guard.ts catches truncation and regression. It cannot
// prove staleness detection, because every one of its fixtures changes either
// the row count or the newest date, and a frozen source changes neither. This
// file supplies that missing case: a frozen "now" plus a fixture whose newest
// date has not moved, which is exactly the shape a dead source produces.

import { test, expect } from "bun:test";

import { assertFresh, assertAllFresh, CADENCE, type SeriesInput } from "./lib/age.ts";

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

test("a monthly series frozen for months fails, unlike a change-only guard", () => {
  // Mirrors a real shape: a frozen source keeps returning the same rows every
  // day, so a guard built around row-count and newest-date regression stays
  // quiet indefinitely. This is the case that guard.ts structurally cannot
  // catch and this module exists to cover.
  const series: SeriesInput[] = [
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-04-01" },
  ];
  // 95 days, past the 90 day monthly threshold.
  const ninetyFiveDaysLater = new Date("2026-07-05T06:00:00Z");
  const [result] = assertFresh(series, ninetyFiveDaysLater);
  expect(result.ageDays).toBe(95);
  expect(result.pass).toBe(false);
});

test("assertAllFresh throws naming the stale series and prints every series, pass and fail alike", () => {
  const series: SeriesInput[] = [
    { file: "btc-usd-daily.json", rows: 100, newest_date: "2026-09-02" }, // fresh
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-04-01" }, // stale
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

test("assertAllFresh does not throw when every series is fresh", () => {
  const series: SeriesInput[] = [
    { file: "btc-usd-daily.json", rows: 100, newest_date: "2026-09-02" },
    // period_start, the first of the covered month: the only shape inflation.ts
    // can emit. 63 days old at NOW, which is a normal healthy age for a monthly
    // series measured from that date.
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-07-01" },
  ];
  expect(() => assertAllFresh(series, NOW)).not.toThrow();
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

test("the monthly thresholds are 90 days, measured from period_start", () => {
  // Pinned on purpose. The number is not arbitrary and it is not a taste
  // question: see the arithmetic in the reason string in age.ts.
  for (const file of ["us-cpi-monthly.json", "us-cpi-core-monthly.json", "us-ppi-monthly.json"]) {
    expect(CADENCE[file].thresholdDays).toBe(90);
  }
});

test("the daily thresholds stay at 4 and 5 days", () => {
  // The daily series measure age from the observation's own UTC day, so they
  // were never touched by the period_start error. Pinned so a future monthly
  // change cannot sweep them along with it.
  expect(CADENCE["btc-usd-daily.json"].thresholdDays).toBe(4);
  expect(CADENCE["xau-usd-daily.json"].thresholdDays).toBe(5);
});

test("a HEALTHY monthly series at its worst alignment passes: the case 45 and 80 both got wrong", () => {
  // Nothing is broken in this scenario. The month M reading stays the newest
  // point until M+1 is released, so on the 31 + 31 month pair (July with
  // August) a working pipeline is legitimately this old on the day before the
  // slowest realistic release of the August figure.
  const series: SeriesInput[] = [
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-07-01" },
  ];
  const dayBeforeTheSlowestAugustRelease = new Date("2026-09-21T06:00:00Z");
  const [result] = assertFresh(series, dayBeforeTheSlowestAugustRelease);

  expect(result.ageDays).toBe(82);
  expect(result.pass).toBe(true);

  // And this is why the number had to move twice. Both thresholds this replaces
  // would have called a healthy pipeline stale right here.
  expect(result.ageDays).toBeGreaterThan(45);
  expect(result.ageDays).toBeGreaterThan(80);
});

test("a monthly series still goes red the day it passes 90", () => {
  // A threshold that was raised and can no longer fail is not a guard. From
  // 2026-07-01, day 90 is 2026-09-29 and day 91 is 2026-09-30.
  const series: SeriesInput[] = [
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-07-01" },
  ];

  const [atThreshold] = assertFresh(series, new Date("2026-09-29T06:00:00Z"));
  expect(atThreshold.ageDays).toBe(90);
  expect(atThreshold.pass).toBe(true);

  const [pastThreshold] = assertFresh(series, new Date("2026-09-30T06:00:00Z"));
  expect(pastThreshold.ageDays).toBe(91);
  expect(pastThreshold.pass).toBe(false);
});
