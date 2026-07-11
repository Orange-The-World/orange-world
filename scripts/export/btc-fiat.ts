// Export the BTC/fiat daily price series from the database.
//
// One family, four quote currencies (USD, EUR, GBP, JPY), one shape:
//   {"pair":"BTC/USD","source":"ORBI","granularity":"1d","days":N,"data":[[date,rate],...]}
//
// Source table: exchange_rates. The canonical daily close for a pair is the
// confirmed, not-superseded row at granularity 1d, product ORBI-D. One row per
// UTC day, ordered ascending. Adding a new quote currency is one line in QUOTES.

import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeClient, fetchAllRows } from "./lib/client.ts";
import { writeArtifact, type Row } from "./lib/writer.ts";
import { assertHealthy, type DataRow } from "./lib/guard.ts";
import { utcDate, readPreviousData, dataDir } from "./lib/util.ts";

export const QUOTES = ["USD", "EUR", "GBP", "JPY"] as const;
export type Quote = (typeof QUOTES)[number];

type RateRow = { bucket_ts: string; rate: number | string };

export async function exportBtcFiat(client: SupabaseClient, quote: Quote): Promise<Row[]> {
  const rows = await fetchAllRows<RateRow>(
    client,
    "exchange_rates",
    "bucket_ts",
    (q) =>
      q
        .eq("source_currency", "BTC")
        .eq("target_currency", quote)
        .eq("granularity", "1d")
        .eq("product", "ORBI-D")
        .eq("status", "CONFIRMED")
        .is("superseded_by_id", null),
  );

  // One row per UTC day. The unique constraint on the table already guarantees
  // this, but collapse defensively and keep the last write for a day.
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(utcDate(r.bucket_ts), Number(r.rate));

  const data: Row[] = [...byDay.keys()].sort().map((day) => [day, byDay.get(day)!]);

  const path = join(dataDir(), `btc-${quote.toLowerCase()}-daily.json`);
  const previous = readPreviousData(path);
  assertHealthy(`btc-${quote.toLowerCase()}`, previous, data as DataRow[]);

  writeArtifact(path, {
    pair: `BTC/${quote}`,
    source: "ORBI",
    granularity: "1d",
    days: data.length,
  }, data);

  return data;
}

export async function exportAllBtcFiat(client: SupabaseClient): Promise<void> {
  for (const quote of QUOTES) {
    const data = await exportBtcFiat(client, quote);
    console.log(`btc-${quote.toLowerCase()}: ${data.length} rows, newest ${data[data.length - 1][0]}`);
  }
}

if (import.meta.main) {
  await exportAllBtcFiat(makeClient());
}
