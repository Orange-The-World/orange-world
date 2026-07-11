// Unit tests for the coverage guard, exercised with fixtures so they need no
// database. These prove the guard fails on the three ways bad data could
// overwrite good data, and passes healthy refreshes.

import { test, expect } from "bun:test";

import {
  assertHealthy,
  newestDate,
  distinctDateCount,
  type DataRow,
} from "./lib/guard.ts";

const prev: DataRow[] = [
  ["2026-06-10", 1],
  ["2026-06-11", 2],
  ["2026-06-12", 3],
];

test("newestDate returns the max date", () => {
  expect(newestDate(prev)).toBe("2026-06-12");
  expect(newestDate([])).toBe(null);
});

test("distinctDateCount ignores repeated dates", () => {
  const twoFixes: DataRow[] = [
    ["2026-06-11", 1],
    ["2026-06-11", 2],
    ["2026-06-12", 3],
  ];
  expect(distinctDateCount(twoFixes)).toBe(2);
});

test("zero rows fails loudly", () => {
  expect(() => assertHealthy("x", prev, [])).toThrow(/zero rows/);
});

test("newest date moving backwards fails", () => {
  const truncated: DataRow[] = [
    ["2026-06-09", 1],
    ["2026-06-10", 2],
    ["2026-06-11", 3],
  ];
  expect(() => assertHealthy("x", prev, truncated)).toThrow(/backwards/);
});

test("fewer distinct dates fails even when newest date holds", () => {
  const holed: DataRow[] = [
    ["2026-06-10", 1],
    ["2026-06-12", 3],
  ];
  expect(() => assertHealthy("x", prev, holed)).toThrow(/coverage shrank/);
});

test("a healthy longer refresh passes", () => {
  const grown: DataRow[] = [...prev, ["2026-06-13", 4]];
  expect(() => assertHealthy("x", prev, grown)).not.toThrow();
});

test("a brand new series with no previous file passes", () => {
  expect(() => assertHealthy("x", null, prev)).not.toThrow();
});

test("dropping a duplicate-row bug while keeping every date passes", () => {
  // Mirrors the one-time btc-xau cleanup: the committed file had every row
  // duplicated; the fresh export is one clean row per date. Same distinct dates,
  // same newest date, so coverage did not regress.
  const buggyPrev: DataRow[] = [
    ["2026-06-10", 1],
    ["2026-06-10", 1],
    ["2026-06-11", 2],
    ["2026-06-11", 2],
  ];
  const clean: DataRow[] = [
    ["2026-06-10", 1],
    ["2026-06-11", 2],
  ];
  expect(() => assertHealthy("btc-xau", buggyPrev, clean)).not.toThrow();
});
