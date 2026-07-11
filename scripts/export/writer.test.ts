// Proof that the shared writer reproduces the committed artifacts byte for byte.
//
// For each committed price and index file, this reads it, splits it back into
// its header and its data rows, feeds those through the shared writer, and
// asserts the result is identical to the bytes on disk. If the writer's number
// formatting, key order, non ASCII escaping, or lack of trailing newline drift,
// this test fails. It runs with no database, so it is the offline guarantee
// that a real export would land the exact shape the charts already consume.
//
// The two derived artifacts (btc-xau, hardness-ratio) are not round tripped
// here: btc-xau's committed file carries a duplicate-row artifact the fresh
// pipeline intentionally drops, and hardness-ratio is proven separately by
// re-running its own build script.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  serializeArtifact,
  formatNumber,
  escapeNonAscii,
  type Row,
} from "./lib/writer.ts";

const dataDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "sites",
  "world",
  "public",
  "data",
);

const ROUND_TRIP_FILES = [
  "btc-usd-daily.json",
  "btc-eur-daily.json",
  "btc-gbp-daily.json",
  "btc-jpy-daily.json",
  "xau-usd-daily.json",
  "us-cpi-monthly.json",
  "us-cpi-core-monthly.json",
  "us-ppi-monthly.json",
];

test("formatNumber keeps a fractional digit and the shortest form", () => {
  expect(formatNumber(10)).toBe("10.0");
  expect(formatNumber(0)).toBe("0.0");
  expect(formatNumber(22)).toBe("22.0");
  expect(formatNumber(0.07)).toBe("0.07");
  expect(formatNumber(63538.43)).toBe("63538.43");
  expect(formatNumber(330.293)).toBe("330.293");
});

test("escapeNonAscii escapes above ASCII and leaves ASCII alone", () => {
  const div = String.fromCharCode(0x00f7);
  expect(escapeNonAscii(`a ${div} b`)).toBe("a \\u00f7 b");
  expect(escapeNonAscii("plain ascii")).toBe("plain ascii");
});

for (const file of ROUND_TRIP_FILES) {
  test(`writer reproduces ${file} byte for byte`, () => {
    const original = readFileSync(join(dataDir, file), "utf8");
    const parsed = JSON.parse(original) as Record<string, unknown> & { data: Row[] };
    const { data, ...header } = parsed;
    const rebuilt = serializeArtifact(header, data);
    expect(rebuilt).toBe(original);
  });
}
