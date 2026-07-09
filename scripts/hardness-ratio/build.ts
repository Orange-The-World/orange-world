// Build-time generator for the Hardness Ratio daily series.
//
// The Hardness Ratio answers a single question: what is the total market value
// of all Bitcoin as a fraction of the total market value of all above-ground
// gold?
//
//   hardness_ratio(t) = (btc_supply(t) * btc_usd(t))
//                       / (above_ground_gold_oz(t) * xau_usd(t))
//
// It reads two static price series already shipped in this repository, joins
// them by date, applies the two committed constants (above-ground gold and
// Bitcoin issuance), and writes public/data/hardness-ratio-daily.json.
//
// JOIN RULE
// ---------
// Inner join on dates present in BOTH the BTC/USD and XAU/USD series. Bitcoin
// does not trade before its price history starts, and the London gold market
// does not fix on weekends and holidays, so an inner join keeps only the days
// on which both sides genuinely have a price. That is the conservative default:
// we never invent a gold price for a day the market was shut, nor a Bitcoin
// price for a day before the series begins.
//
// The XAU series carries up to two LBMA fixes per calendar day (AM and PM). We
// keep one value per date, the last fix listed for that date, which is the PM
// fix.
//
// Run with:  bun scripts/hardness-ratio/build.ts
//
// No dashes are used in this file per the repository's writing rule.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  aboveGroundOzOn,
  MONETARY_GOLD_FRACTION,
  TROY_OZ_PER_TONNE,
  GOLD_ABOVE_GROUND_YEAR_END_TONNES,
} from "./gold-above-ground.ts";
import { btcSupplyOn, BTC_HALVING_ANCHORS } from "./btc-supply.ts";

type PriceFile = { data: [string, number][] };

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "sites", "world", "public", "data");

function loadPrices(name: string): Map<string, number> {
  const raw = JSON.parse(readFileSync(join(dataDir, name), "utf8")) as PriceFile;
  const map = new Map<string, number>();
  // Later entries for the same date overwrite earlier ones, so for XAU this
  // keeps the PM fix. For BTC every date is already unique.
  for (const [day, price] of raw.data) map.set(day, price);
  return map;
}

const btc = loadPrices("btc-usd-daily.json");
const xau = loadPrices("xau-usd-daily.json");

// Inner join: dates present in both, sorted ascending.
const commonDays = [...btc.keys()].filter((d) => xau.has(d)).sort();

const rows: [string, number, number][] = [];
for (const day of commonDays) {
  const btcUsd = btc.get(day)!;
  const xauUsd = xau.get(day)!;
  const supply = btcSupplyOn(day);
  const aboveGroundOz = aboveGroundOzOn(day);

  const btcMarketValue = supply * btcUsd;
  const goldMarketValueAll = aboveGroundOz * xauUsd;
  const goldMarketValueMonetary = goldMarketValueAll * MONETARY_GOLD_FRACTION;

  const ratioAll = btcMarketValue / goldMarketValueAll;
  const ratioMonetary = btcMarketValue / goldMarketValueMonetary;

  // Round to 6 significant-ish decimals to keep the file small but exact enough
  // to reproduce the headline percentage.
  rows.push([day, round(ratioAll), round(ratioMonetary)]);
}

function round(x: number): number {
  return Math.round(x * 1e8) / 1e8;
}

const out = {
  series: "hardness-ratio",
  title: "Bitcoin market value as a fraction of all above-ground gold",
  unit: "fraction (btc_market_value / gold_market_value)",
  formula:
    "(btc_circulating_supply * btc_usd) / (above_ground_gold_troy_oz * xau_usd)",
  columns: ["date", "ratio_all_gold", "ratio_monetary_gold_only"],
  join: "inner join on dates present in both btc-usd-daily.json and xau-usd-daily.json; XAU uses the PM fix when a date has two fixes",
  inputs: ["/data/btc-usd-daily.json", "/data/xau-usd-daily.json"],
  constants: {
    troy_oz_per_tonne: TROY_OZ_PER_TONNE,
    monetary_gold_fraction: MONETARY_GOLD_FRACTION,
    monetary_gold_note:
      "central bank official reserves, about 17.6 percent of above-ground stock per the WGC end-2025 breakdown",
    gold_above_ground_year_end_tonnes: GOLD_ABOVE_GROUND_YEAR_END_TONNES,
    btc_halving_anchors: BTC_HALVING_ANCHORS,
  },
  sources: [
    "Above-ground gold: World Gold Council, How much gold has been mined, and Gold Demand Trends supply tables (gold.org).",
    "Bitcoin supply: derived from the protocol halving schedule (deterministic).",
    "Prices: this repository's btc-usd-daily.json (ORBI) and xau-usd-daily.json (LBMA fix).",
  ],
  license: "CC-BY 4.0",
  days: rows.length,
  data: rows,
};

const outPath = join(dataDir, "hardness-ratio-daily.json");
writeFileSync(outPath, JSON.stringify(out));

const first = rows[0];
const last = rows[rows.length - 1];
console.log(`wrote ${outPath}`);
console.log(`rows: ${rows.length}`);
console.log(`first: ${first[0]}  ratio_all=${first[1]}  ratio_monetary=${first[2]}`);
console.log(`last:  ${last[0]}  ratio_all=${last[1]}  ratio_monetary=${last[2]}`);
console.log(
  `last as percent: all gold = ${(last[1] * 100).toFixed(2)}%  monetary gold = ${(last[2] * 100).toFixed(2)}%`,
);
