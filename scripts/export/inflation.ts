// Export the US inflation index series from the database.
//
// Three artifacts, one shape:
//   {"country":"US","kind":"CPI","source":"FRED","cadence":"monthly","months":N,"data":[[date,value],...]}
//
// Source table: inflation_rates. Each monthly observation can be revised over
// time; the current value is the head of the revision chain, the row whose
// superseded_by_id is null. The data-row date is period_start, which is the
// first of the month. Adding another index is one entry in SERIES.

import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeClient, fetchAllRows } from "./lib/client.ts";
import { writeArtifact, type Row } from "./lib/writer.ts";
import { assertHealthy, type DataRow } from "./lib/guard.ts";
import { readPreviousData, dataDir } from "./lib/util.ts";

type InflationRow = {
  period_start: string;
  value: number | string;
  revision_number: number;
};

// index_kind in the table, kind label in the file, output filename.
export const SERIES = [
  { indexKind: "CPI", kind: "CPI", file: "us-cpi-monthly.json" },
  { indexKind: "CPI-core", kind: "CPI-core", file: "us-cpi-core-monthly.json" },
  { indexKind: "PPI", kind: "PPI", file: "us-ppi-monthly.json" },
] as const;

export async function exportInflationSeries(
  client: SupabaseClient,
  spec: (typeof SERIES)[number],
): Promise<Row[]> {
  const rows = await fetchAllRows<InflationRow>(
    client,
    "inflation_rates",
    "period_start",
    // period_start repeats across revisions of the same month, so the pager
    // needs a tiebreaker. Without one it could drop the highest revision row at
    // a page boundary and publish a superseded value.
    "id",
    (q) =>
      q
        .eq("country", "US")
        .eq("index_kind", spec.indexKind)
        .is("superseded_by_id", null),
  );

  // One value per month: the head-of-chain row. If more than one row survives
  // for a period, keep the highest revision number as the current value.
  const byPeriod = new Map<string, { value: number; rev: number }>();
  for (const r of rows) {
    const day = r.period_start.slice(0, 10);
    const prev = byPeriod.get(day);
    if (!prev || r.revision_number > prev.rev) {
      byPeriod.set(day, { value: Number(r.value), rev: r.revision_number });
    }
  }

  const data: Row[] = [...byPeriod.keys()].sort().map((day) => [day, byPeriod.get(day)!.value]);

  const path = join(dataDir(), spec.file);
  const previous = readPreviousData(path);
  assertHealthy(spec.file.replace(".json", ""), previous, data as DataRow[]);

  writeArtifact(path, {
    country: "US",
    kind: spec.kind,
    source: "FRED",
    cadence: "monthly",
    months: data.length,
  }, data);

  console.log(`${spec.file}: ${data.length} rows, newest ${data[data.length - 1][0]}`);
  return data;
}

export async function exportAllInflation(client: SupabaseClient): Promise<void> {
  for (const spec of SERIES) {
    await exportInflationSeries(client, spec);
  }
}

if (import.meta.main) {
  await exportAllInflation(makeClient());
}
