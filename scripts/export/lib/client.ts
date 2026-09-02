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
// page on a non-unique key without deciding to. Naming a column that does not
// exist fails on the first query with a PostgREST error, which is the failure
// mode we want: loud, immediate, and impossible to mistake for good data.
//
// Known limit, stated rather than implied: this makes the read reproducible over
// UNCHANGED data. Rows inserted into the middle of the range while the pager is
// walking it can still shift later windows. These tables are filled by a nightly
// loader rather than a live write path, so that is accepted for now; keyset
// paging is the upgrade if it ever stops being true.
//
// The builder callback receives a fresh query each page so filters are reapplied
// cleanly.
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
  for (let from = 0; ; from += PAGE) {
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
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}
