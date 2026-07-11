// Regenerate every public data artifact, in dependency order, from the database.
//
// Order matters. The price and index series are exported straight from the
// database first. The two derived artifacts, BTC priced in gold and the
// hardness ratio, are then rebuilt from those fresh exports, never from the
// previously committed files, so a derived series can never drift from its
// inputs. Finally the freshness sidecar is written.
//
// Every exporter runs its own zero-rows and coverage guard before it writes, so
// a dead source or a truncated read aborts the run loudly instead of committing
// a shrunken file over a good one.
//
// Run with:  bun scripts/export/run-all.ts
// Requires ORANGE_WORLD_PROD_URL and ORANGE_WORLD_PROD_SERVICE_KEY in the env.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeClient } from "./lib/client.ts";
import { exportAllBtcFiat } from "./btc-fiat.ts";
import { exportXauUsd } from "./xau-usd.ts";
import { exportAllInflation } from "./inflation.ts";
import { exportBtcXau } from "./btc-xau.ts";
import { writeCoverage } from "./coverage.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function runHardnessBuild(): void {
  // The hardness ratio has its own build script that reads the price files this
  // pipeline just wrote. Invoke it as a child process so there is one source of
  // truth for that derivation.
  const script = join(repoRoot, "scripts", "hardness-ratio", "build.ts");
  const result = spawnSync("bun", [script], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`hardness-ratio build failed with exit code ${result.status}`);
  }
}

async function main(): Promise<void> {
  const client = makeClient();

  console.log("exporting price and index series from the database");
  await exportAllBtcFiat(client);
  await exportXauUsd(client);
  await exportAllInflation(client);

  console.log("rebuilding derived artifacts from the fresh exports");
  exportBtcXau();
  runHardnessBuild();

  console.log("writing coverage sidecar");
  writeCoverage(new Date().toISOString());

  console.log("done");
}

await main();
