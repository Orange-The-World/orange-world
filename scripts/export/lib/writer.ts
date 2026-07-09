// Shared JSON writer for the public data artifacts.
//
// Every artifact under sites/world/public/data is a compact JSON object with a
// small header and a "data" array of tuples. The portal charts fetch these
// files directly and parse only the "data" array, so the on-disk shape is a
// hard contract. This writer exists so that shape is produced in exactly one
// place: a new chart is a new call, not a copied block of serialization code.
//
// Two format rules are load-bearing and were reverse-engineered from the files
// already committed to the repository, then proven byte for byte by the round
// trip test in writer.test.ts:
//
//   1. Numbers keep a fractional part. A whole number is written "10.0", never
//      "10". The committed files were produced by a serializer that preserved
//      the trailing ".0", and the charts do not care, but reproducing the exact
//      bytes means a daily refresh never rewrites a file just because the
//      serializer changed. formatNumber below reproduces that.
//
//   2. Non ASCII characters in the header are escaped to a \\uXXXX sequence. One
//      artifact carries a division sign in its source label; the committed file
//      stores it escaped. escapeNonAscii reproduces that. For pure ASCII headers
//      the escape is a no op, so every other file is unaffected.
//
// The output carries no trailing newline, matching the committed files.

import { writeFileSync } from "node:fs";

// A single data cell is either a date/label string or a numeric value.
export type Cell = string | number;
export type Row = Cell[];

// Render one numeric value the way the committed artifacts render it: the
// shortest decimal that round trips, but always with at least one digit after
// the decimal point so a whole number reads as "10.0" rather than "10".
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`refusing to serialize non finite number: ${String(n)}`);
  }
  let s = String(n);
  if (!s.includes(".") && !s.includes("e") && !s.includes("E")) {
    s += ".0";
  }
  return s;
}

// Escape every character above the ASCII range to a \\uXXXX sequence, matching
// the encoder that produced the committed files. Written as a char code loop so
// this source file stays pure ASCII.
export function escapeNonAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0x7f) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else {
      out += s[i];
    }
  }
  return out;
}

function serializeCell(cell: Cell): string {
  if (typeof cell === "number") return formatNumber(cell);
  return JSON.stringify(cell);
}

function serializeRow(row: Row): string {
  return "[" + row.map(serializeCell).join(",") + "]";
}

// Serialize a full artifact: an ordered header object followed by the "data"
// array. Returns the exact bytes that will be written to disk.
export function serializeArtifact(header: Record<string, unknown>, rows: Row[]): string {
  // The header keys are emitted in insertion order, which is how the committed
  // files are ordered. escapeNonAscii is applied only to the header because the
  // data tuples are always ASCII (ISO dates and numbers).
  const headerInner = escapeNonAscii(JSON.stringify(header)).slice(1, -1);
  const data = "[" + rows.map(serializeRow).join(",") + "]";
  const prefix = headerInner.length > 0 ? headerInner + "," : "";
  return "{" + prefix + '"data":' + data + "}";
}

// Serialize and write an artifact to disk, no trailing newline.
export function writeArtifact(
  path: string,
  header: Record<string, unknown>,
  rows: Row[],
): void {
  writeFileSync(path, serializeArtifact(header, rows));
}
