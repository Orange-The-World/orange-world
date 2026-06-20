# Orange World methodology

Orange World publishes long-history truth tables for hard money (BTC, gold,
silver) priced against the world's fiat currencies. Each series is derived
from primary sources and licensed for re-use under CC-BY 4.0 (see
LICENSE-DATA).

## Series construction

### Bitcoin price history

- **2010-07-17 to 2013-09-30** — Mt. Gox daily close, hand-curated archive.
- **2013-10-01 to present** — Bitfinex daily close, fall-back to Coinbase
  Pro and Kraken when Bitfinex was offline. Composite priority: Bitfinex →
  Coinbase Pro → Kraken → Bitstamp.
- All series are in UTC. Daily candles are the [00:00, 00:00) bucket.

### Gold and silver price history

- **1971-08-15 onward** — London PM fix (LBMA) daily close, USD.
- Pre-1971 monthly USD averages from the Federal Reserve Economic Data
  (FRED) historical series.
- Cross-currency rates are derived from central-bank daily fixings
  (Frankfurter, ECB, Federal Reserve, BoE, BoJ, etc.).

### Purchasing-power series

- USD CPI: FRED `CPIAUCSL` (CPI for all urban consumers, all items).
- EUR HICP: ECB statistical data warehouse.
- Long-history "purchasing power of a dollar since 1913": derived from
  FRED `CPIAUCSL` (1947-) spliced with the Bureau of Labor Statistics
  historical 1913-1946 series.

## Upstream data sources

Orange World stands on the shoulders of these open data publishers.
Re-use of Orange World data MUST preserve attribution to BOTH Orange World
AND the upstream publisher listed here:

- **Federal Reserve Economic Data (FRED)** — Federal Reserve Bank of St. Louis.
- **Bureau of Labor Statistics (BLS)** — U.S. Department of Labor.
- **Bank for International Settlements (BIS)** — exchange-rate statistics.
- **European Central Bank (ECB)** — Statistical Data Warehouse.
- **Frankfurter API** — open exchange-rate facade over ECB.
- **Federal Reserve Board** — H.10 foreign exchange rates.
- **Bank of England (BoE)** — Statistical Database.
- **Bank of Japan (BoJ)** — time-series data search.
- **Banco Central do Brasil (BCB)** — historical exchange rates.
- **Reserve Bank of Australia (RBA)** — F11 historical AUD/USD.
- **Swiss National Bank (SNB)** — interest rates and currency.
- **Bank of Canada (BoC)** — Valet API.
- **OurWorldInData (OWID)** — long-history CPI compilation.
- **London Bullion Market Association (LBMA)** — gold/silver fix archive.
- **Bitfinex, Coinbase, Kraken, Bitstamp** — historical BTC OHLCV (used
  under each exchange's API terms; Orange World republishes daily-bucket
  aggregates only, not tick data).

## Coverage and freshness

See `coverage.json` in this repo for the per-series cutoff dates and the
median age of the most recent observation. Truth tables refresh nightly
when upstream publishers update.

## Errata

When an observation is corrected upstream, Orange World re-publishes the
affected series with the same filename. Significant restatements are
logged in `CHANGELOG.md`.
