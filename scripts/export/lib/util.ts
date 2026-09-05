// Small shared helpers used by every exporter. Kept free of any database
// dependency so the derived-artifact and coverage scripts can run offline.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DataRow } from "./guard.ts";

// Absolute path to sites/world/public/data, resolved from this module's own
// location (scripts/export/lib) so it is stable no matter which script imports
// it or what the working directory is.
export function dataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "sites", "world", "public", "data");
}

// The UTC calendar date of a timestamp, as YYYY-MM-DD. All series bucket by UTC
// day, so this is how a bucket_ts becomes a data-row date.
export function utcDate(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// Read the "data" array of a previously committed artifact, or null if the file
// does not exist yet. Used by the guard to compare a fresh export against what
// is already on disk.
export function readPreviousData(path: string): DataRow[] | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { data: DataRow[] };
  return parsed.data ?? null;
}
