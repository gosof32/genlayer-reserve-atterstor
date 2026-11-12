# Attestation sources

Every source below was fetched with `curl` (no cookies, no API key, plain `GET`) on
**2026-11-12 between 09:52 and 09:53 UTC**. The verbatim response bodies are committed in
[`tests/fixtures/`](../tests/fixtures) and are what the direct-mode tests feed to the contract.
A second, independent read with `node scripts/check-sources.mjs` at 10:03 UTC is saved in
[`check-sources-2026-11-12.txt`](check-sources-2026-11-12.txt).

The contract does the same thing a validator does: one `GET`, then deterministic parsing (JSON)
or model-located, contract-verified snippets (HTML).

## Chosen for the seed script (`scripts/sources.mjs`)

| Asset | Issuer / publisher | Kind | Source URL | Reserves | Liabilities | As-of |
|---|---|---|---|---|---|---|
| USDB | Bridge (a Stripe company), issuer transparency API | json | `https://transparency.bridge.xyz/v0/stablecoins/usdb` | `total_reserve_amount` | `total_onchain_amount` | `last_updated` |
| TUSD | TrueUSD real-time attestation (the feed behind Chainlink Proof of Reserve), served by LedgerLens | json | `https://api.real-time-reserves.ledgerlens.io/v1/chainlink/proof-of-reserves/TrueUSD` | `totalTrust` | `totalToken` | `updatedAt` |
| RLUSD | Ripple / Standard Custody transparency page | html | `https://ripple.com/solutions/stablecoin/transparency/` | label `RLUSD Reserve Funds` | label `Total Circulating RLUSD` | label `As of`, `MDY` |
| SPYx | Backed / xStocks tokenized-equity proof of reserves | json | `https://api.xstocks.fi/api/v2/public/proof-of-reserves/SPYx` | `sharesHeld` | `circulatingSupply` | `timestamp` |

### Values read (fixtures, 2026-11-12 ~09:52 UTC)

| Asset | Reserves | Liabilities | As-of (source) | Ratio (contract) | Status at 10:00 UTC |
|---|---|---|---|---|---|
| USDB | 64,207,984.97 USD | 64,106,445.97 USDB | 2026-11-12T09:50:35Z | 10015 bps (100.15 %) | FULLY_BACKED |
| TUSD | 501,928,900.88 USD | 494,515,082.75 TUSD | 2026-11-12T09:52:36.303Z | 10149 bps | FULLY_BACKED |
| RLUSD | $2,748.0M | $2,632.9M | "As of 11/05/2026" → 2026-11-05 | 10437 bps | FULLY_BACKED (max age 336 h) |
| SPYx | 97,653.99856414 SPY shares | 97,488.777516420858619 SPYx | 2026-11-12T09:40:26.319Z | 10016 bps | FULLY_BACKED |

Second read at 10:03 UTC: USDB 64,204,180.35 / 64,102,641.35 (as-of 10:00:45Z, still 10015 bps),
TUSD unchanged numbers with a new `updatedAt`, RLUSD unchanged, SPYx 97,653 / 97,488.7788 (10016 bps).
Those moves are far inside the 0.5 % validator tolerance.

### Why these four

* **Different publishers and shapes.** An issuer's own API (Bridge), an independent real-time
  attestation provider (LedgerLens / TrueUSD, the data Chainlink PoR consumes), an issuer's
  human-readable page that needs extraction (Ripple), and a non-stablecoin custodian proof
  (xStocks shares held at Alpaca vs tokens outstanding). Together they exercise every code path:
  plain paths, float-looking JSON numbers kept exact, ISO timestamps with milliseconds, and the
  HTML route with `$…M` units and a US-style date.
* **No JavaScript, no key, no cookies.** A validator's single `GET` sees the figures. Circle's
  transparency page, for comparison, renders its numbers client-side and the raw HTML has none.
* **They carry an as-of.** Staleness is a first-class status, so a source without a report time
  was not usable.

## Verified, kept as extra fixtures

| Asset | Source | Notes |
|---|---|---|
| mUSD | `https://transparency.bridge.xyz/v0/stablecoins/musd` | Same Bridge API; 37,813,753.76 / 37,762,731.072383, 10013 bps. Used in tests for `update_source`. |
| USDT | `https://app.tether.to/transparency.json` | `data.usdt.total_assets` 181,345,865,229.9862 / `data.usdt.total_liabilities` 175,878,916,674.15685265 (10310 bps). The as-of is taken from `data.usdt.id` = 1794439800 (2026-11-11T23:30:00Z). **Inference:** `id` looks like a Unix timestamp of the last balance-sheet update; Tether does not document it, so this feed is not in the seed script. |

## CORS (matters for the dApp's in-browser preview, not for validators)

Checked with an `Origin:` header on the same requests:

| Source | `Access-Control-Allow-Origin` |
|---|---|
| LedgerLens (TUSD) | `*`: the dApp can fetch it in the browser |
| Bridge, xStocks, Tether, Ripple | none: browsers block the read; validators are not affected |

## Rejected

* `api.real-time-attest.trustexplorer.io` (the older TrueUSD endpoint): DNS no longer resolves.
* Circle `circle.com/transparency`: figures are injected by JavaScript.
* First Digital `firstdigitallabs.com/transparency`: HTTP 403 to non-browser clients.
* Paxos (PYUSD/USDP) transparency pages: link to PDF reports only, no figures in the HTML.
