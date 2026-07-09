// Shared helper: linear interpolation of a value over dates.
//
// Both of the hardness-ratio constants (above-ground gold, and Bitcoin
// circulating supply) are known exactly only at a handful of anchor dates
// (year-ends for gold, halvings for Bitcoin). Between anchors the underlying
// quantity grows smoothly and continuously (gold is mined every week, blocks
// are found every ten minutes), so a linear interpolation in calendar time is
// the honest, reproducible default. We state this rule once here and reuse it
// for both series so the two are treated identically.

export type Anchor = { date: string; value: number };

// Whole days since the Unix epoch, computed in UTC so that a plain
// "YYYY-MM-DD" string maps to one stable integer regardless of local time.
export function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// Interpolate the value at a given date from sorted anchors.
//   - Before the first anchor: clamp to the first value.
//   - Between two anchors: straight-line interpolation by day fraction.
//   - After the last anchor: if slopePerDay is given, extend the line at that
//     slope (used for Bitcoin issuance after the most recent halving); if not,
//     clamp to the last value.
export function interpolateByDate(
  anchors: Anchor[],
  isoDate: string,
  slopePerDay?: number,
): number {
  const t = dayNumber(isoDate);
  const pts = anchors.map((a) => ({ t: dayNumber(a.date), value: a.value }));

  if (t <= pts[0].t) return pts[0].value;

  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      const frac = (t - a.t) / (b.t - a.t);
      return a.value + frac * (b.value - a.value);
    }
  }

  const last = pts[pts.length - 1];
  if (slopePerDay !== undefined) return last.value + slopePerDay * (t - last.t);
  return last.value;
}
