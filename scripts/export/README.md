# Data export pipeline

The portal charts under `sites/world/src/components` do not query a database at
run time. They `fetch()` static JSON committed under
`sites/world/public/data/`. This directory holds the pipeline that regenerates
those files from the database so the published series stay current instead of
drifting behind.

## What it produces

| Artifact | Source | Exporter |
|---|---|---|
| `btc-usd-daily.json`, `btc-eur-daily.json`, `btc-gbp-daily.json`, `btc-jpy-daily.json` | `exchange_rates` | `btc-fiat.ts` |
| `xau-usd-daily.json` | `precious_metals_rates` (LBMA fix) | `xau-usd.ts` |
| `us-cpi-monthly.json`, `us-cpi-core-monthly.json`, `us-ppi-monthly.json` | `inflation_rates` | `inflation.ts` |
| `btc-xau-daily.json` | derived from the fresh `btc-usd` and `xau-usd` exports | `btc-xau.ts` |
| `hardness-ratio-daily.json` | derived from the fresh `btc-usd` and `xau-usd` exports | `../hardness-ratio/build.ts` |
| `coverage.json` | freshness summary of every artifact above | `coverage.ts` |

`run-all.ts` runs them in order: database series first, then the two derived
series from those fresh files, then the coverage sidecar, then the age
assertion described below. This is what keeps a derived series from ever
drifting from its inputs.

## Two-fix days

`xau-usd-daily.json` keeps every LBMA fix, so a day with both an AM and a PM fix
carries two rows with the same date, AM first. The derived series that need one
value per day (`btc-xau`, `hardness-ratio`) keep the PM fix, the later of the
two.

## Guard

Before any exporter writes, it checks the fresh rows against what is already on
disk and aborts loudly if the export returned zero rows, if the newest date
moved backwards, or if the number of distinct dates covered shrank. This is what
stops a truncated or empty read from overwriting good history. The guard is pure
and unit tested in `guard.test.ts`.

This guard cannot detect a frozen source, and it is not meant to. If the
database has stopped changing, every exporter still returns exactly the rows it
returned last time: the row count does not drop, the newest date does not move
backwards, and the distinct-date count does not shrink. To this guard, a dead
source and a genuinely quiet day are the same observation, and it correctly
stays silent on both.

## Age assertion

A second, separate check catches what the guard above structurally cannot:
staleness. After every export, `lib/age.ts` compares each series' newest date
against that series' own expected cadence (the `CADENCE` table in that file,
with the reasoning for each threshold next to it) and fails the run if any
series is older than its cadence allows, whether or not anything else changed.
Every run prints one line per series, its row count, newest date, age in days,
threshold, and pass or fail, whether the run as a whole passes or fails, so a
run that checked nothing cannot be mistaken for a run that checked everything.
It is pure and unit tested in `age.test.ts`.

## Running it

Set the two credentials in the environment, then run the pipeline:

```bash
export ORANGE_WORLD_PROD_URL=...          # the truth-data project URL
export ORANGE_WORLD_PROD_SERVICE_KEY=...  # a service-role key with read access
bun run export:data
```

Neither value is ever committed; this is a public repository. The names match
the variables the `world-gateway` edge function already reads, so a maintainer
sets one pair of secrets.

The unit tests run without any credentials:

```bash
bun run test:data
```

## Scheduled refresh

`.github/workflows/data-refresh.yml` is meant to run the export daily and open
a pull request when the data changes. For it to work, a maintainer must set
two repository secrets with the same names as the environment variables above:

- `ORANGE_WORLD_PROD_URL`
- `ORANGE_WORLD_PROD_SERVICE_KEY`

As of this writing the scheduled run has not completed a successful export
since the workflow was added: the client currently queries a table that is not
present in the configured database, so the job fails at the export step,
before it ever reaches the guard or the age assertion. See the open pull
request that repoints the affected exporter and skips it gracefully when its
credentials are absent, so the job stays red instead of silently succeeding
(PR #15). Until that lands and the two secrets above are set and confirmed
against a real run, treat "runs the export daily" above as the design intent,
not a proven fact.
