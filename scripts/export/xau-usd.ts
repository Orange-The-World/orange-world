// Export the XAU/USD daily gold price series from the database.
//
// Shape:
//   {"pair":"XAU/USD","source":"LBMA fix","granularity":"1d","days":N,"data":[[date,rate],...]}
//
// Source table: precious_metals_rates, the LBMA fix rows (source_authority
// LBMA) for gold quoted in USD.
//
// TWO FIXES PER DAY. The London market fixes gold twice on a business day, an AM
// fix and a PM fix. Both are real published prices, so both are kept: a day
// with two fixes produces two data rows carrying the same date, ordered AM then
// PM by fix timestamp. Historical days with a single fix produce one row. This
// matches the committed file exactly. Downstream derived series that need one
// value per day keep the PM fix, which is the later of the two.

import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeClient, fetchAllRows } from "./lib/client.ts";
import { writeArtifact, type Row } from "./lib/writer.ts";
import { assertHealthy, type DataRow } from "./lib/guard.ts";
import { utcDate, readPreviousData, dataDir } from "./lib/util.ts";

type MetalRow = { bucket_ts: string; rate: number | string };

export async function exportXauUsd(client: SupabaseClient): Promise<Row[]> {
  // Ordered by bucket_ts ascending, so within a day the AM fix precedes the PM
  // fix and across days the series runs oldest to newest.
  const rows = await fetchAllRows<MetalRow>(
    client,
    "precious_metals_rates",
    "bucket_ts",
    // This exporter maps rows straight to data points with no collapse step, so
    // a row duplicated or skipped at a page boundary would land in the published
    // file. id is the tiebreaker that keeps the page order total.
    "id",
    (q) =>
      q
        .eq("source_metal", "XAU")
        .eq("target_currency", "USD")
        .eq("source_authority", "LBMA")
        .eq("status", "CONFIRMED"),
  );

  // Keep one data row per fix. The date is the UTC calendar date of the fix, so
  // two fixes on the same day yield two rows with the same date.
  const data: Row[] = rows.map((r) => [utcDate(r.bucket_ts), Number(r.rate)]);

  const path = join(dataDir(), "xau-usd-daily.json");
  const previous = readPreviousData(path);
  assertHealthy("xau-usd", previous, data as DataRow[]);

  writeArtifact(path, {
    pair: "XAU/USD",
    source: "LBMA fix",
    granularity: "1d",
    days: data.length,
  }, data);

  console.log(`xau-usd: ${data.length} rows, newest ${data[data.length - 1][0]}`);
  return data;
}

if (import.meta.main) {
  await exportXauUsd(makeClient());
}
