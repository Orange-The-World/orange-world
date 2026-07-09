// Freshness and non regression guards for the export pipeline.
//
// The worst outcome for this project is a silent truncation: a source returns
// zero rows or a short read, the export writes a tiny file over a good one, the
// daily job commits it, and a chart that sells itself as a live scoreboard
// quietly loses fifteen years of history. These guards make that loud instead.
//
// Coverage is measured two ways, and a fresh export must not regress on either:
//
//   - newest date: the most recent observation must not move backwards
//   - distinct dates: the number of distinct dates covered must not shrink
//
// Distinct dates rather than raw row count is deliberate. The XAU series carries
// two fixes on some days and one on others, and the derived BTC/XAU series is
// one clean row per day, so raw row counts are not comparable across a refresh;
// the count of distinct dates covered is. A truncated or partial read still
// loses distinct dates or pulls the newest date backwards, so it is still
// caught.
//
// The functions are pure so they can be unit tested with fixtures and carry no
// dependency on the database or the file system.

// A data row is [date, ...values]; only the date (first cell) matters here.
export type DataRow = [string, ...number[]];

export function newestDate(rows: DataRow[]): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    const d = row[0];
    if (newest === null || d > newest) newest = d;
  }
  return newest;
}

export function distinctDateCount(rows: DataRow[]): number {
  const seen = new Set<string>();
  for (const row of rows) seen.add(row[0]);
  return seen.size;
}

// Throw unless the freshly exported rows are at least as complete as what was
// on disk before. A brand new series with no previous file passes as long as it
// has rows.
export function assertHealthy(
  series: string,
  previous: DataRow[] | null,
  next: DataRow[],
): void {
  if (next.length === 0) {
    throw new Error(`${series}: export returned zero rows; refusing to write an empty file`);
  }
  if (previous === null || previous.length === 0) {
    return;
  }

  const prevNewest = newestDate(previous);
  const nextNewest = newestDate(next);
  if (prevNewest !== null && nextNewest !== null && nextNewest < prevNewest) {
    throw new Error(
      `${series}: coverage went backwards; newest committed date ${prevNewest} ` +
        `but export only reaches ${nextNewest}`,
    );
  }

  const prevDistinct = distinctDateCount(previous);
  const nextDistinct = distinctDateCount(next);
  if (nextDistinct < prevDistinct) {
    throw new Error(
      `${series}: distinct-date coverage shrank from ${prevDistinct} to ${nextDistinct}; ` +
        `refusing to overwrite a longer series with a shorter one`,
    );
  }
}
