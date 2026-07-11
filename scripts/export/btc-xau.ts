// Derive the BTC priced in gold series from the freshly exported price files.
//
// Shape:
//   {"pair":"BTC/XAU","unit":"troy_oz_per_btc","source":"ORBI BTC/USD <div> LBMA XAU/USD",
//    "granularity":"1d","days":N,"data":[[date,oz],...]}
// where <div> is a division sign in the committed file.
//
// This is a derived artifact, like the hardness ratio. It must be built from
// the fresh btc-usd and xau-usd exports rather than from the previously
// committed files, so it can never drift from its inputs. It reads the two
// price files this pipeline just wrote and divides them.
//
// JOIN RULE: inner join on dates present in both series, keeping every XAU fix.
// The XAU series carries up to two fixes on a day (AM and PM); each fix that
// falls on a date with a BTC price produces one row, so a two-fix day yields two
// rows carrying the same date, in the AM-then-PM order the XAU file already
// lists them. Value is troy ounces of gold per bitcoin, btc_usd / xau_usd,
// rounded to four decimals. This reproduces the committed file's shape exactly.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeArtifact, type Row } from "./lib/writer.ts";
import { assertHealthy, type DataRow } from "./lib/guard.ts";
import { readPreviousData, dataDir } from "./lib/util.ts";

// The division sign, built from a char code so this source file stays ASCII.
const DIV = String.fromCharCode(0x00f7);

function loadArray(dir: string, name: string): [string, number][] {
  const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
    data: [string, number][];
  };
  return parsed.data;
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

export function exportBtcXau(): Row[] {
  const dir = dataDir();
  // BTC has one price per day; index it by date.
  const btc = new Map<string, number>();
  for (const [day, price] of loadArray(dir, "btc-usd-daily.json")) btc.set(day, price);

  // Walk the XAU fixes in file order (dates ascending, AM before PM). Emit one
  // row per fix whose date also has a BTC price.
  const data: Row[] = [];
  for (const [day, xauPrice] of loadArray(dir, "xau-usd-daily.json")) {
    const btcPrice = btc.get(day);
    if (btcPrice === undefined) continue;
    data.push([day, round4(btcPrice / xauPrice)]);
  }

  const path = join(dir, "btc-xau-daily.json");
  const previous = readPreviousData(path);
  assertHealthy("btc-xau", previous, data as DataRow[]);

  writeArtifact(path, {
    pair: "BTC/XAU",
    unit: "troy_oz_per_btc",
    source: `ORBI BTC/USD ${DIV} LBMA XAU/USD`,
    granularity: "1d",
    days: data.length,
  }, data);

  console.log(`btc-xau: ${data.length} rows, newest ${data[data.length - 1][0]}`);
  return data;
}

if (import.meta.main) {
  exportBtcXau();
}
