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

// PostgREST returns at most a page of rows per request. Walk the full result in
// fixed size windows, ordered by the given column so paging is stable, and
// return every row. The builder callback receives a fresh query each page so
// filters are reapplied cleanly.
const PAGE = 1000;

export async function fetchAllRows<T>(
  client: SupabaseClient,
  table: string,
  orderColumn: string,
  build: (q: ReturnType<SupabaseClient["from"]>) => unknown,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    // deno-lint-ignore no-explicit-any
    let q: any = client.from(table).select("*");
    q = build(q);
    q = q.order(orderColumn, { ascending: true }).range(from, from + PAGE - 1);
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
