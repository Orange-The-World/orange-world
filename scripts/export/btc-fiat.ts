// Export the BTC/fiat daily price series from the database.
//
// One family, four quote currencies (USD, EUR, GBP, JPY), one shape:
//   {"pair":"BTC/USD","source":"ORBI","granularity":"1d","days":N,"data":[[date,rate],...]}
//
// Source table: exchange_rates, in the ORBI project (see lib/client.ts
// makeOrbiClient), not the orange-world project. The candidate rows for a
// pair are the confirmed, not-superseded rows at granularity 1d, product
// ORBI-D. That filter is not one row per UTC day, see pickCanonicalRow below
// for why and how one is chosen. Adding a new quote currency is one line in
// QUOTES.

import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeOrbiClient, fetchAllRows } from "./lib/client.ts";
import { writeArtifact, type Row } from "./lib/writer.ts";
import { assertHealthy, type DataRow } from "./lib/guard.ts";
import { utcDate, readPreviousData, dataDir } from "./lib/util.ts";

export const QUOTES = ["USD", "EUR", "GBP", "JPY"] as const;
export type Quote = (typeof QUOTES)[number];

type RateRow = {
  id: string;
  bucket_ts: string;
  rate: number | string;
  source_authority: string;
  fetched_at: string;
};

// Two or three confirmed, not-superseded rows can share a bucket_ts on the
// same day. Checked live against orbi-prod: this is the normal case, not an
// edge case, for every one of the four pairs. It happens because the
// ORBI-authority daily fixing job for a pair runs after the UTC day closes
// (a fresh day carries only preliminary single-source rows until then), and
// because jurisdiction-specific backfills (BANXICO, FED, BITBANK, ...) are
// written alongside the ORBI row rather than replacing it.
//
// The canonical published close is the ORBI Methodology's own answer to this
// (see "Sovereign authority precedence"): consumers doing transaction
// valuation, the default for V3/OWM/OWB, read source_authority = 'ORBI'.
// Verified live: no day in any of the four pairs ever carries more than one
// ORBI-authority row, so that filter alone is already a total order when it
// applies.
//
// It does not always apply: for a day this fresh, the nightly fixing job may
// not have reached it yet, so no ORBI row exists at all. Verified live: 7
// such days total across all four pairs, every one within the last three
// months, every one still carrying 2+ non-ORBI candidates. For those, fall
// back to the most recently fetched row, tied by id. That keeps the pick a
// pure function of the row data: never of page boundaries, and never of
// which request happened to run last.
function pickCanonicalRow(a: RateRow, b: RateRow): RateRow {
  const aOrbi = a.source_authority === "ORBI";
  const bOrbi = b.source_authority === "ORBI";
  if (aOrbi !== bOrbi) return aOrbi ? a : b;
  if (a.fetched_at !== b.fetched_at) return a.fetched_at > b.fetched_at ? a : b;
  return a.id > b.id ? a : b;
}

export async function exportBtcFiat(client: SupabaseClient, quote: Quote): Promise<Row[]> {
  const rows = await fetchAllRows<RateRow>(
    client,
    "exchange_rates",
    "bucket_ts",
    // bucket_ts is not unique here, so the pager needs a tiebreaker. id is the
    // table's uuid primary key.
    "id",
    (q) =>
      q
        .eq("source_currency", "BTC")
        .eq("target_currency", quote)
        .eq("granularity", "1d")
        .eq("product", "ORBI-D")
        .eq("status", "CONFIRMED")
        .is("superseded_by_id", null),
  );

  const byDay = new Map<string, RateRow>();
  for (const r of rows) {
    const day = utcDate(r.bucket_ts);
    const existing = byDay.get(day);
    byDay.set(day, existing ? pickCanonicalRow(r, existing) : r);
  }

  const data: Row[] = [...byDay.keys()].sort().map((day) => [day, Number(byDay.get(day)!.rate)]);

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
  const orbiClient = makeOrbiClient();
  if (!orbiClient) {
    console.error(
      "ORBI_PROD_URL and ORBI_PROD_SERVICE_KEY are required to run btc-fiat standalone",
    );
    process.exit(1);
  }
  await exportAllBtcFiat(orbiClient);
}
