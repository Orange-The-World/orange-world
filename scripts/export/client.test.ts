// Unit tests for the paginating reader in lib/client.ts, exercised against a
// fake query builder so they need no database and no credentials.
//
// What is being proved: fetchAllRows returns EVERY row EXACTLY ONCE, and returns
// the same rows on a second run over unchanged data. Both properties depend on
// the pager sorting on a total order, because each page is a separate query and
// Postgres may order tied rows differently in two different queries.

import { test, expect } from "bun:test";

import { fetchAllRows } from "./lib/client.ts";

type Fixture = { id: string; bucket_ts: string; rate: number };

// 2,500 rows over only three distinct bucket_ts values. Two properties matter:
// there are more rows than one 1,000 row page, and every page boundary falls
// inside a group of rows that share a bucket_ts. That is the shape the real
// tables have.
const ROW_COUNT = 2500;

function fixture(): Fixture[] {
  const days = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const rows: Fixture[] = [];
  for (let i = 0; i < ROW_COUNT; i++) {
    rows.push({
      id: `id-${String(i).padStart(4, "0")}`,
      bucket_ts: days[i % days.length],
      rate: i,
    });
  }
  return rows;
}

// A stand in for the Supabase query builder that behaves the way Postgres is
// PERMITTED to behave: it honours the ORDER BY it was given, and for rows that
// the ORDER BY does not separate it is free to return them in any order. This
// one reverses the tie order on every second query, which is the worst case a
// planner is allowed to produce and the case no fixture had ever covered.
// maxRows models the server's OWN cap on rows per request (PostgREST's
// db-max-rows). It is applied after the requested window, so a response can be
// shorter than the range asked for with no error attached. Infinity by default:
// a test has to opt in, and every test that does not is unaffected.
function fakeClient(rows: Fixture[], maxRows = Infinity) {
  let queries = 0;
  const orderCalls: string[][] = [];

  function builder() {
    const keys: string[] = [];
    let lo = 0;
    let hi = rows.length;

    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: () => api,
      is: () => api,
      order: (col: string) => {
        keys.push(col);
        return api;
      },
      range: (from: number, to: number) => {
        lo = from;
        hi = to;
        return api;
      },
      // deno-lint-ignore no-explicit-any
      then: (resolve: any) => {
        queries += 1;
        orderCalls.push([...keys]);

        // The permutation the sort key does not pin down. Array sort is stable,
        // so tied rows keep whatever order they arrived in.
        const input = queries % 2 === 0 ? [...rows].reverse() : [...rows];
        const sorted = input.sort((a, b) => {
          for (const k of keys) {
            const av = String(a[k as keyof Fixture]);
            const bv = String(b[k as keyof Fixture]);
            if (av < bv) return -1;
            if (av > bv) return 1;
          }
          return 0;
        });

        const windowed = sorted.slice(lo, hi + 1).slice(0, maxRows);
        return resolve({ data: windowed, error: null });
      },
    };
    return api;
  }

  return {
    // deno-lint-ignore no-explicit-any
    client: { from: () => builder() } as any,
    orderCalls: () => orderCalls,
  };
}

test("every row exactly once, and the same rows twice over unchanged data", async () => {
  const rows = fixture();
  const f = fakeClient(rows);

  const first = await fetchAllRows<Fixture>(f.client, "t", "bucket_ts", "id", (q) => q);
  const second = await fetchAllRows<Fixture>(f.client, "t", "bucket_ts", "id", (q) => q);

  // Complete: nothing skipped.
  expect(first.length).toBe(ROW_COUNT);
  // Exact: nothing duplicated.
  expect(new Set(first.map((r) => r.id)).size).toBe(ROW_COUNT);
  // Reproducible: the second read is the first read, row for row and in order.
  expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
});

test("a single non-unique sort key skips and duplicates rows while the row count stays right", async () => {
  const rows = fixture();
  const f = fakeClient(rows);

  // Passing the non-unique column as its own tiebreaker reproduces the single
  // key ordering this pager used to have, so the failure mode stays visible in
  // the suite instead of becoming folklore.
  const got = await fetchAllRows<Fixture>(f.client, "t", "bucket_ts", "bucket_ts", (q) => q);

  const distinct = new Set(got.map((r) => r.id)).size;

  // This is the line that explains why nothing caught it. The pager returns the
  // right NUMBER of rows, so a count check, a newest date check and a distinct
  // date check all pass, while 499 rows are duplicates and 499 real rows are
  // missing entirely.
  expect(got.length).toBe(ROW_COUNT);
  expect(distinct).toBeLessThan(ROW_COUNT);
});

test("both the sort column and the tiebreaker reach every page query", async () => {
  const f = fakeClient(fixture());

  await fetchAllRows<Fixture>(f.client, "t", "bucket_ts", "id", (q) => q);

  const calls = f.orderCalls();
  expect(calls.length).toBeGreaterThan(1);
  for (const keys of calls) {
    expect(keys).toEqual(["bucket_ts", "id"]);
  }
});

test("an empty tiebreaker is refused instead of quietly paging on one column", async () => {
  const f = fakeClient(fixture());

  await expect(
    fetchAllRows<Fixture>(f.client, "t", "bucket_ts", "", (q) => q),
  ).rejects.toThrow(/unique tiebreaker/);
});

test("a server row cap below the page size does not truncate the export", async () => {
  const rows = fixture();

  // 400 is below the pager's 1,000 row page, so EVERY request comes back
  // short, starting with the first one. A pager that treats a short page as
  // the last page therefore stops after one request and returns 400 of 2,500
  // rows. Nothing throws, the row set is internally consistent, and the
  // exporter writes a truncated file: the right shape of answer with most of
  // the data missing.
  //
  // Note the asymmetry that makes this worth a test rather than a comment. A
  // server cap ABOVE the page size is harmless, because range() still bounds
  // the window. A cap BELOW it is invisible, and only ever shows up as missing
  // published data, never as a failure.
  const f = fakeClient(rows, 400);

  const got = await fetchAllRows<Fixture>(f.client, "t", "bucket_ts", "id", (q) => q);

  // Complete: the cap changes how many requests it takes, not how many rows
  // come back.
  expect(got.length).toBe(ROW_COUNT);
  // Exact: paging past a short page must not re-read rows it already has.
  expect(new Set(got.map((r) => r.id)).size).toBe(ROW_COUNT);
});
