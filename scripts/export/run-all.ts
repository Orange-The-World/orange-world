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
// a shrunken file over a good one. That guard cannot catch a frozen source: if
// nothing in the database has changed, every exporter still returns the same
// rows it returned last time, so no exporter's guard trips. The age assertion
// below is the check that can: it fails the run when a series has gone longer
// without a new data point than its own expected cadence allows.
//
// Run with:  bun scripts/export/run-all.ts
// Requires ORANGE_WORLD_PROD_URL and ORANGE_WORLD_PROD_SERVICE_KEY in the env.
// For the btc-fiat series, also set ORBI_PROD_URL and ORBI_PROD_SERVICE_KEY.
// If the ORBI credentials are absent, btc-fiat is skipped and the script exits 1.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeClient, makeOrbiClient } from "./lib/client.ts";
import { exportAllBtcFiat } from "./btc-fiat.ts";
import { exportXauUsd } from "./xau-usd.ts";
import { exportAllInflation } from "./inflation.ts";
import { exportBtcXau } from "./btc-xau.ts";
import { writeCoverage } from "./coverage.ts";
import { assertAllFresh } from "./lib/age.ts";

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
  const orbiClient = makeOrbiClient();
  let exitCode = 0;

  console.log("exporting price and index series from the database");
  if (orbiClient) {
    await exportAllBtcFiat(orbiClient);
  } else {
    console.warn(
      "ORBI_PROD_URL / ORBI_PROD_SERVICE_KEY not set;" +
        " skipping btc-fiat export (add both secrets to orange-world repo to unblock)",
    );
    exitCode = 1;
  }
  await exportXauUsd(client);
  await exportAllInflation(client);

  console.log("rebuilding derived artifacts from the fresh exports");
  exportBtcXau();
  runHardnessBuild();

  console.log("writing coverage sidecar");
  const coverage = writeCoverage(new Date().toISOString());

  console.log("checking every series against its expected cadence");
  assertAllFresh(coverage.series, new Date());

  console.log("done");
  if (exitCode !== 0) process.exit(exitCode);
}

await main();
