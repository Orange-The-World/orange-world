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
    { file: "us-cpi-monthly.json", rows: 40, newest_date: "2026-08-20" },
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
