// Shared read only client for the truth data project.
//
// The datasets that back the charts live in a separate Supabase project (the
// same upstream the world-gateway edge function proxies to). The export reads
// that project directly with a service role key, paginating past PostgREST's
// per request row cap so a fifteen year daily series comes back whole.
//
// Credentials come from the environment and nowhere else. This is a public
// repository; no URL, key, or project ref is ever committed. The two variables
// below share the names the gateway already uses so a maintainer sets one pair
// of secrets, not two:
//
//   ORANGE_WORLD_PROD_URL          the truth data project URL
//   ORANGE_WORLD_PROD_SERVICE_KEY  a service role key with read access
//
// Set both in the environment before running any exporter.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `missing required environment variable ${name}; ` +
        `set it to run the export (see scripts/export/README notes)`,
    );
  }
  return v;
}

export function makeClient(): SupabaseClient {
  const url = requireEnv("ORANGE_WORLD_PROD_URL");
  const key = requireEnv("ORANGE_WORLD_PROD_SERVICE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// PostgREST returns at most a page of rows per request, so a full series is
// walked in fixed size windows. Read this before changing it: each window is a
// SEPARATE query, and Postgres guarantees a total order only when the sort key
// is unique. Rows that share the same orderColumn value may come back in a
// different relative order in two different queries, and when that happens at a
// page boundary one row is returned twice and another is never returned at all.
//
// So the sort key is always a PAIR: the caller's orderColumn, then uniqueColumn,
// a column that is unique within the table. The pair is a total order, which is
// what makes paging deterministic and the row set complete. Ordering by
// orderColumn ALONE is only stable when that column is itself unique, which is
// true for none of the tables these exporters read.
//
// uniqueColumn is a required argument and not a default, so a new caller cannot
// page on a non-unique key without deciding to. Two limits on that sentence,
// both found in review and written down rather than left to be rediscovered:
//
//   1. That is a compile time rule, and nothing in this repository compiles
//      scripts/export today. There is no tsc and no typecheck script, and lint
//      covers only the portal. So a caller that omits the tiebreaker is caught
//      at RUNTIME: the build callback lands in the uniqueColumn slot, is truthy,
//      and the guard below throws on uniqueColumn.trim(). Loud, but loud in the
//      nightly refresh rather than on the pull request that introduced it.
//   2. The guard below rejects only an empty or whitespace string. An existing
//      but NON UNIQUE column passed as the tiebreaker is accepted in silence and
//      reinstates the exact skip or duplicate bug this pager exists to remove.
//      Catching that needs schema knowledge this script does not have, so it is
//      the caller's responsibility: pick a primary key or a unique index, not a
//      second sort key that happens to be handy.
//
// Naming a column that does not exist fails on the first query with a PostgREST
// error, which is the failure mode we want: loud, immediate, and impossible to
// mistake for good data.
//
// Known limit, stated rather than implied: this makes the read reproducible over
// UNCHANGED data. Rows inserted into the middle of the range while the pager is
// walking it can still shift later windows. These tables are filled by a nightly
// loader rather than a live write path, so that is accepted for now; keyset
// paging is the upgrade if it ever stops being true.
//
// The builder callback receives a fresh query each page so filters are reapplied
// cleanly.
//
// TERMINATION. The loop stops on an EMPTY response, not a short one, and the
// offset advances by the number of rows actually RECEIVED rather than by PAGE.
// Both halves are required and neither is correct alone (OR-T1528).
//
// Stopping on a short page assumes the only reason a response can be short is
// that the table ran out. PostgREST does not have to agree: it enforces its own
// maximum rows per request (db-max-rows) on the server. If that cap is below
// PAGE then EVERY response is short, starting with the first, so the loop stops
// after one request and returns a fraction of the table. Nothing throws, the
// rows that come back are internally consistent, and a count check, a newest
// date check and a distinct date check all pass while most of the data is
// missing. Note the asymmetry: a cap ABOVE PAGE is harmless, because range()
// still bounds the window. A cap BELOW it is invisible, and only ever surfaces
// as missing published data, never as a failure.
//
// Advancing by PAGE while terminating on empty would be WORSE than the bug it
// replaces. With a server cap of 400, the first request returns rows 0 to 399
// and the next would ask for row 1000 onward, silently dropping 600 rows out of
// the middle of the range and still returning a plausible looking file.
// Advancing by page.length is correct whatever the cap is, and is identical to
// the old behaviour when there is no cap. The cost is one extra request per
// table: the one that comes back empty.
const PAGE = 1000;

export async function fetchAllRows<T>(
  client: SupabaseClient,
  table: string,
  orderColumn: string,
  uniqueColumn: string,
  build: (q: ReturnType<SupabaseClient["from"]>) => unknown,
): Promise<T[]> {
  if (!uniqueColumn || uniqueColumn.trim() === "") {
    throw new Error(
      `fetchAllRows on ${table} needs a unique tiebreaker column: ` +
        `paging on ${orderColumn} alone can skip or duplicate rows`,
    );
  }
  const out: T[] = [];
  for (let from = 0; ; ) {
    // deno-lint-ignore no-explicit-any
    let q: any = client.from(table).select("*");
    q = build(q);
    q = q.order(orderColumn, { ascending: true });
    if (uniqueColumn !== orderColumn) {
      q = q.order(uniqueColumn, { ascending: true });
    }
    q = q.range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) {
      throw new Error(`query on ${table} failed: ${error.message}`);
    }
    const page = (data ?? []) as T[];
    // More rows than the window asked for means range() is not being honoured
    // at all. Advancing by page.length would then walk past rows the next
    // request re-reads, so the pager would return overlapping pages while every
    // count still looked plausible. Refuse rather than guess.
    if (page.length > PAGE) {
      throw new Error(
        `query on ${table} returned ${page.length} rows for a ${PAGE} row window: ` +
          `range() is not being honoured, so paging cannot be trusted`,
      );
    }
    if (page.length === 0) break;
    out.push(...page);
    from += page.length;
  }
  return out;
}
