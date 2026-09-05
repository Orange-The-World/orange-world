// Above-ground gold stock, in troy ounces, by date.
//
// SOURCE
// ------
// World Gold Council (WGC), "How much gold has been mined?" and the annual
// Gold Demand Trends supply tables. The WGC publishes an estimate of the total
// above-ground stock of gold (all the gold ever mined and still in human
// hands) at each year-end. Above-ground stock grows only by new mine
// production; recycling merely re-circulates gold that is already counted.
//
// VERIFIED year-end anchors taken directly from the WGC:
//   end-2019: 197,576 tonnes
//   end-2023: 212,582 tonnes
//   end-2024: 216,265 tonnes
//   end-2025: 219,891 tonnes
// (gold.org/goldhub/data/how-much-gold and gold.org Gold Demand Trends.)
//
// The remaining year-ends below are the WGC's commonly published intermediate
// figures for 2020 to 2022, and for 2011 to 2018 they are rolled back from the
// end-2019 anchor using WGC / Metals Focus annual mine-production tonnages.
// As a cross-check, that roll-back lands end-2011 at 171,354 tonnes, which
// matches the WGC's own widely cited "about 171,300 tonnes mined" figure from
// that period. The end-2026 row is a projection: end-2025 plus one more year of
// recent-average mine production (about 3,650 tonnes). It is labelled below and
// only affects interpolation for dates in the first half of 2026.
//
// No dashes are used in this file per the repository's writing rule.

import { interpolateByDate, type Anchor } from "./interp.ts";

// One metric tonne of gold, in troy ounces.
//   1 tonne = 1,000,000 g; 1 troy ounce = 31.1034768 g.
export const TROY_OZ_PER_TONNE = 1_000_000 / 31.1034768; // 32,150.7466...

// Year-end above-ground stock in metric tonnes.
export const GOLD_ABOVE_GROUND_YEAR_END_TONNES: {
  year: number;
  tonnes: number;
  note: string;
}[] = [
  { year: 2011, tonnes: 171_354, note: "rolled back from 2019 anchor; matches WGC ~171,300 t" },
  { year: 2012, tonnes: 174_218, note: "WGC / Metals Focus mine production" },
  { year: 2013, tonnes: 177_294, note: "WGC / Metals Focus mine production" },
  { year: 2014, tonnes: 180_475, note: "WGC / Metals Focus mine production" },
  { year: 2015, tonnes: 183_684, note: "WGC / Metals Focus mine production" },
  { year: 2016, tonnes: 186_947, note: "WGC / Metals Focus mine production" },
  { year: 2017, tonnes: 190_456, note: "WGC / Metals Focus mine production" },
  { year: 2018, tonnes: 194_112, note: "WGC / Metals Focus mine production" },
  { year: 2019, tonnes: 197_576, note: "VERIFIED WGC year-end anchor" },
  { year: 2020, tonnes: 201_296, note: "WGC published year-end" },
  { year: 2021, tonnes: 205_238, note: "WGC published year-end" },
  { year: 2022, tonnes: 208_874, note: "WGC published year-end" },
  { year: 2023, tonnes: 212_582, note: "VERIFIED WGC year-end anchor" },
  { year: 2024, tonnes: 216_265, note: "VERIFIED WGC year-end anchor" },
  { year: 2025, tonnes: 219_891, note: "VERIFIED WGC year-end anchor" },
  { year: 2026, tonnes: 223_541, note: "PROJECTION: 2025 plus ~3,650 t recent-average production" },
];

// Fraction of above-ground gold that is monetary gold, meaning gold held as
// official reserves by central banks. From the WGC end-2025 breakdown of the
// 219,891 tonne above-ground stock, central banks hold about 38,666 tonnes,
// which is 17.6 percent. We expose this as the "monetary gold only" lens: it is
// the strict monetary share, roughly one fifth of all above-ground gold. The
// remaining four fifths sit in jewellery, private bars and coins, ETFs and
// industrial uses, which are not monetary reserves.
export const MONETARY_GOLD_FRACTION = 0.176;

// Anchor the interpolation at mid-year (July 1) of each year-end figure so that
// a "year-end" stock is reached at the boundary between years. We treat each
// published value as the stock at December 31 of that year.
const ANCHORS: Anchor[] = GOLD_ABOVE_GROUND_YEAR_END_TONNES.map((r) => ({
  date: `${r.year}-12-31`,
  value: r.tonnes * TROY_OZ_PER_TONNE,
}));

// Above-ground gold in troy ounces on a given date, interpolated between
// year-end anchors. Dates before end-2011 clamp to the 2011 value; the Bitcoin
// price series does not begin meaningfully until well after that, and the ratio
// there is vanishingly small regardless.
export function aboveGroundOzOn(isoDate: string): number {
  return interpolateByDate(ANCHORS, isoDate);
}
