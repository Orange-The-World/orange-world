<div align="center">

# Orange the World

### Free, CC-BY 4.0 truth tables on money, prices, and the cost of living.

[![License: Apache 2.0 (code)](https://img.shields.io/badge/License-Apache%202.0-F7931A.svg)](./LICENSE)
[![License: CC-BY 4.0 (data)](https://img.shields.io/badge/Data-CC--BY%204.0-F7931A.svg)](./LICENSE-DATA.md)
[![Status: Early Development](https://img.shields.io/badge/Status-Early%20Development-yellow.svg)](#status)
[![Portal: orangethe.world](https://img.shields.io/badge/Portal-orangethe.world-success.svg)](https://orangethe.world)

[**Portal**](https://orangethe.world) ·
[**API docs**](./sites/world/src/pages/Docs.tsx) ·
[**Contributing**](./CONTRIBUTING.md) ·
[**Security**](./SECURITY.md)

</div>

---

## What this is

Orange the World is a public archive of long-arc monetary data: inflation, wages, money supply, precious-metals prices, historical money prices going back to 1209, commodity prices, tech productivity curves, and bitcoin network metrics.

Every row carries a primary-source citation. Every dataset is free under CC-BY 4.0. Every chart on the portal is rebuildable from the same API anyone else can call.

The point is not to argue. The point is to make the data so easy to see that the argument becomes unnecessary.

## What ships in this repo

- **Portal** (`sites/world/`) , the consumer-facing Vite SPA at `orangethe.world`. Charts, dataset explainers, account signup.
- **API gateway** (`supabase/functions/world-gateway/`) , the Supabase edge function that fronts the truth-data project. Validates `orw_` API keys, enforces per-key quotas, proxies dataset queries.
- **API-key issuance** (`supabase/functions/client-signup/`, `supabase/functions/client-verify-email/`) , two-step email-verified signup that mints the user's first API key.
- **API-key schema** (`supabase/migrations/`) , the `client_platform` schema tables: organizations, api_keys, api_usage.

The truth-data schemas themselves (`precious_metals_rates`, `inflation_rates`, `historical_money_prices`, etc.) live in a separate Supabase project that this repo's edge functions read from. Schemas for those datasets are tracked in the `orbi` indexer project.

## Use the data

### From the portal

Visit `orangethe.world`, click through the charts, read the tooltips. No account required for browsing.

### From the API

Sign up for a free API key at `orangethe.world/signup`. Verify your email. Use the key:

```bash
curl -H "Authorization: Bearer orw_..." \
  "https://api.orangerails.com/v1/truth/bitcoin-network?limit=5"
```

Available datasets at v0.1:

| Route | Dataset |
|---|---|
| `/v1/truth/precious-metals` | Spot gold and silver, daily |
| `/v1/truth/inflation` | CPI, PPI, core, by country |
| `/v1/truth/historical-money-prices` | Real-money price archive starting 1209 |
| `/v1/truth/bitcoin-network` | Hashrate, difficulty, block count, fee rates |
| `/v1/truth/wages` | Real wages by country, by sector |
| `/v1/truth/monetary-aggregates` | M0, M1, M2, M3 where published |
| `/v1/truth/commodity-prices` | Wheat, oil, copper, lumber |

Rate-limited free tier. Commercial customers get the same data through the [ORBI](https://github.com/Orange-The-World) commercial endpoints.

## Licensing

Code in this repo is **Apache 2.0** , see [`LICENSE`](./LICENSE).

Data served by the API and shown on the portal is **CC-BY 4.0** , see [`LICENSE-DATA.md`](./LICENSE-DATA.md). Attribution is `Orange the World, orangethe.world`. A link back is preferred.

## Self-hosting

You can stand up your own Orange the World instance. You will need:

- A Supabase project for the gateway + `client_platform` schema.
- A second Supabase project (or schema) holding the truth-data tables. This repo does not include the dataset migrations; see the `orbi` indexer project for those.
- A Cloudflare account for Pages and DNS.
- A Resend account for verification emails.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev-loop setup.

## Status

v0.1, early development. The portal renders four chart families. The API serves the seven datasets above. We are adding sources continuously. Treat the schema as stable enough to integrate against, unstable enough that a major version bump can happen.

## Related projects

Orange the World is part of the `Orange-The-World` GitHub org. Sibling projects:

- **Orange Rails** , the paid, zero-knowledge platform for Bitcoin financial data. Orange the World runs on the same architecture.
- **ORBI** , the paid Bitcoin Index API. Same data, commercial SLA, higher rate limits.

BitBooks (bookkeeping on a Bitcoin standard) and Orange Way (personal finance and books) are the first two apps consuming Orange Rails. They are not customers of Orange the World directly , Orange the World is for everyone.

## Thanks

To everyone who has published a primary-source rate table, a central-bank time series, or a historical price index in machine-readable form. This project is downstream of that work and would not exist without it.


## Upstream data attribution

Orange World data is derived from primary publishers including the Federal
Reserve Economic Data (FRED), the Bank for International Settlements (BIS),
the European Central Bank (ECB), the Bank of England, the Bank of Japan,
the Bureau of Labor Statistics, the London Bullion Market Association
(LBMA), Bitfinex, Coinbase, Kraken, and the central banks of Brazil,
Australia, Switzerland, and Canada. See `methodology.md` for the full
source list and series-construction notes.

Re-use of Orange World data under CC-BY 4.0 MUST preserve attribution to
both Orange World AND the upstream publisher of each series.
