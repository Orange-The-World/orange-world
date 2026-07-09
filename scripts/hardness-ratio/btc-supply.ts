// Bitcoin circulating supply, in whole BTC, by date.
//
// This is computed from the protocol's issuance schedule, not fetched from any
// service. Bitcoin issues a fixed block subsidy that halves every 210,000
// blocks. The cumulative supply at each halving is therefore exact:
//
//   Era 1 (blocks       0 to 209,999): 50    BTC per block
//     -> at block 210,000 cumulative = 210,000 * 50    = 10,500,000 BTC
//   Era 2 (blocks 210,000 to 419,999): 25    BTC per block
//     -> at block 420,000 cumulative = 10,500,000 + 210,000 * 25    = 15,750,000
//   Era 3 (blocks 420,000 to 629,999): 12.5  BTC per block
//     -> at block 630,000 cumulative = 15,750,000 + 210,000 * 12.5  = 18,375,000
//   Era 4 (blocks 630,000 to 839,999): 6.25  BTC per block
//     -> at block 840,000 cumulative = 18,375,000 + 210,000 * 6.25  = 19,687,500
//   Era 5 (blocks 840,000 to ...    ): 3.125 BTC per block
//
// The dates at which those block heights were reached are historical fact
// (VERIFIED, well-known halving dates):
//   block       0  mined 2009-01-03 (genesis)
//   block 210,000 mined 2012-11-28 (first halving)
//   block 420,000 mined 2016-07-09 (second halving)
//   block 630,000 mined 2020-05-11 (third halving)
//   block 840,000 mined 2024-04-20 (fourth halving)
//
// Between two halvings the block subsidy is constant, so cumulative supply is
// exactly linear in block height, and block height is very close to linear in
// time. We therefore interpolate cumulative supply linearly in calendar time
// between the exact halving anchors. After the most recent halving we extend
// the line at the current issuance rate:
//   3.125 BTC per block * 144 blocks per day = 450 BTC per day.
// Supply is capped at the protocol maximum of 21,000,000 BTC (not reached for
// decades). The genesis block's 50 BTC is unspendable and is left out by
// anchoring genesis at zero; at 2009 supply scales this is negligible.
//
// No dashes are used in this file per the repository's writing rule.

import { interpolateByDate, type Anchor } from "./interp.ts";

export const BTC_HALVING_ANCHORS: {
  date: string;
  height: number;
  cumulativeSupply: number;
  note: string;
}[] = [
  { date: "2009-01-03", height: 0, cumulativeSupply: 0, note: "genesis block" },
  { date: "2012-11-28", height: 210_000, cumulativeSupply: 10_500_000, note: "first halving" },
  { date: "2016-07-09", height: 420_000, cumulativeSupply: 15_750_000, note: "second halving" },
  { date: "2020-05-11", height: 630_000, cumulativeSupply: 18_375_000, note: "third halving" },
  { date: "2024-04-20", height: 840_000, cumulativeSupply: 19_687_500, note: "fourth halving" },
];

const BTC_MAX_SUPPLY = 21_000_000;

// Current-era issuance: 3.125 BTC per block, about 144 blocks per day.
const CURRENT_ERA_BTC_PER_DAY = 3.125 * 144; // 450 BTC per day

const ANCHORS: Anchor[] = BTC_HALVING_ANCHORS.map((a) => ({
  date: a.date,
  value: a.cumulativeSupply,
}));

// Circulating BTC on a given date.
export function btcSupplyOn(isoDate: string): number {
  const supply = interpolateByDate(ANCHORS, isoDate, CURRENT_ERA_BTC_PER_DAY);
  return Math.min(supply, BTC_MAX_SUPPLY);
}
