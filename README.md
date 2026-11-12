# Reserve Attestor

**Proof-of-reserves feeds for GenLayer: validators read the issuer's own attestation source and agree on reserves vs liabilities.**

Stablecoin issuers, tokenized-asset custodians and exchanges publish their reserves on a web page or a JSON endpoint. Nobody on-chain reads them. Reserve Attestor is a registry of *attestation feeds*: anyone registers a feed (issuer, asset, source URL, where the numbers are, a minimum backing ratio, a maximum report age), and anyone can call `attest(feed_id)`. GenLayer validators each fetch the source, extract reserves, liabilities and the report's as-of time, and must agree on them. The contract computes the ratio and stores a status: `FULLY_BACKED`, `UNDER_COLLATERALIZED`, `STALE` or `UNVERIFIABLE`.

Other contracts use it as a building block with one call: `is_backed(feed_id, max_age_hours)`.

No money moves through this contract. No oracle operator, no API key, no admin.

> **Status:** built and tested locally (192 direct-mode tests, `genvm-lint` clean). **Not deployed yet.** See [Deploy in GenLayer Studio](#deploy-in-genlayer-studio) to deploy it by hand.
> dApp: [gosof32/reserve-attestor-dapp](https://github.com/gosof32/reserve-attestor-dapp)

---

## The problem

"Fully backed" is a claim on a web page. Lending markets, DEX listings, bridges and treasuries that accept a stablecoin or a tokenized stock either trust that claim blindly or pay an oracle provider to relay it. The figures are public already: Bridge publishes USDB's reserves as JSON, Ripple prints RLUSD's reserve funds on its transparency page, xStocks publishes shares held at the custodian per token. What's missing is a neutral way to read them on-chain, check them, and expose a yes/no that a contract can depend on.

## What it reads (real sources)

Built and tested against live sources, fetched with `curl` on 2026-11-12. Full details and values in [`docs/sources.md`](docs/sources.md); verbatim bodies in [`tests/fixtures/`](tests/fixtures).

| Asset | Source | Kind | Reserves / liabilities read | Ratio |
|---|---|---|---|---|
| USDB (Bridge) | `transparency.bridge.xyz/v0/stablecoins/usdb` | json | 64,207,984.97 / 64,106,445.97 | 100.15 % |
| TUSD (TrueUSD real-time attestation) | `api.real-time-reserves.ledgerlens.io/v1/chainlink/proof-of-reserves/TrueUSD` | json | 501,928,900.88 / 494,515,082.75 | 101.49 % |
| RLUSD (Ripple) | `ripple.com/solutions/stablecoin/transparency/` | html | $2,748.0M / $2,632.9M, as of 11/05/2026 | 104.37 % |
| SPYx (xStocks) | `api.xstocks.fi/api/v2/public/proof-of-reserves/SPYx` | json | 97,653.998 SPY shares / 97,488.778 SPYx | 100.16 % |

---

## How consensus works

```
attest(feed_id)                                  (anyone, at most once per 5 min per feed)
   │
   ├─ leader:     GET source_url ─► extract ─► reading {ok, reserves, liabilities, as_of, evidence}
   │                 json: walk the configured paths, exact decimal text, no model
   │                 html: strip scripts/styles ─► LLM copies the snippets ─► contract verifies & parses
   │
   ├─ validators: same read on their own ─► _agree(leader, mine)
   │                 both usable or both unusable
   │                 reserves within ±0.5 %, liabilities within ±0.5 %
   │                 as-of within 1 hour
   │                 identical status from _classify
   │
   └─ after consensus (deterministic, block time):
         _classify ─► status + ratio_bps ─► history (last 30), latest, last_good, failure counter
```

* **The model never decides anything.** For JSON sources there is no model at all. For HTML sources the model only *locates* three verbatim snippets (reserves amount, liabilities amount, as-of text). Contract code parses the numbers, applies units (`K`, `M`, `B`, `T`, `thousand` … `trillion`), parses the date, and computes the ratio and the status.
* **Validators compare numbers, not wording.** Live sources move between the leader's read and a validator's read (Bridge refreshes every ~10 minutes, TUSD stamps every response). A 0.5 % tolerance on each amount and one hour on the as-of absorbs that; the status itself must match exactly.
* **Failure is symmetric.** If the leader cannot read the source, validators must also fail to read it (for any reason) to agree on `UNVERIFIABLE`. A leader that can't read while validators can, or the reverse, gets no consensus and the transaction is retried with a new leader.

### Statuses (`_classify`)

| Status | When |
|---|---|
| `UNVERIFIABLE` | source unreachable or not 200, not JSON, a path missing, a value that isn't a number, a negative amount, **zero liabilities**, a ratio above 100× or an amount above 10¹⁵ (a units/decimals mismatch), a report dated more than 1 h in the future, an ambiguous or unparsable date, or any HTML grounding check failing |
| `STALE` | numbers verified, but the report's as-of is older than the feed's `max_age_hours` |
| `FULLY_BACKED` | `reserves × 10000 ÷ liabilities ≥ min_ratio_bps` |
| `UNDER_COLLATERALIZED` | below `min_ratio_bps` (zero reserves give ratio 0) |

`last_good` is the latest attestation whose numbers were verified (any status but `UNVERIFIABLE`). `consecutive_failures` counts `UNVERIFIABLE` attestations in a row and resets on the next verified one.

---

## Threat model

| Concern | How the contract handles it |
|---|---|
| Prompt injection on the page | Page text is fenced as untrusted, `<` `>` neutralized, size-capped (20k chars), scripts/styles/comments stripped. The model's snippet must appear on the page, **within 300 characters after its label**, and **every** occurrence of the label that is followed by an amount must show the same amount. An injected `RLUSD Reserve Funds $9,999.0B` therefore makes the attestation `UNVERIFIABLE` instead of fooling it, even if the model obeys the injection. |
| Model invents or swaps numbers | Snippet not on the page, not next to its label, or containing more than one amount → `UNVERIFIABLE`. Swapping reserves and liabilities fails the label check. |
| Model misreads the date | Contract code parses the as-of text itself (ISO, `MM/DD/YYYY` / `DD/MM/YYYY` with the feed's `date_order`, `November 5, 2026`, `5 Nov 2026`, `25.10.2026`) and the model's date must match. `11/05/2026` with no `date_order` is refused as ambiguous. |
| Floats | JSON is parsed with `parse_float=str`; amounts are exact integer micro-units (6 decimals). No floating point anywhere in the decision. |
| Units / decimals mismatch | Per-amount `decimals` (0–36) for base-unit sources. A ratio above 100× or an amount above 10¹⁵ units is refused as a units error. |
| Negative / zero liabilities | Negative amounts are refused explicitly; zero liabilities make the ratio undefined → `UNVERIFIABLE`. |
| Old reports passed off as current | `STALE` once the as-of is older than `max_age_hours`; `is_backed` also re-checks age at call time. |
| Owner games the policy | Changing the source or thresholds bumps `source_version` / `policy_version` and **clears `last_good`**, so consumers see "not backed" until a fresh attestation. Consumers who don't trust the owner's ratio use `meets(feed_id, my_min_ratio_bps, my_max_age_hours)`. |
| Spam | 5-minute minimum interval per feed, history capped at 30 entries, 25 feeds per owner, 500 feeds total. |
| SSRF / weird URLs | `https` only, public host name (no IPs, no `localhost`, no userinfo), ≤ 300 chars. |

---

## Contract API

### Write

| Method | Who | What |
|---|---|---|
| `create_feed(issuer, asset, source_url, kind, reserves_field, liabilities_field, asof_field, date_order, reserves_decimals, liabilities_decimals, min_ratio_bps, max_age_hours) -> int` | anyone | Registers a feed, returns its id. |
| `attest(feed_id) -> dict` | anyone | Runs the consensus read and stores the attestation. Reverts `[PAUSED]`, `[TOO_SOON]`, `[NOT_FOUND]`. |
| `update_source(feed_id, source_url, kind, reserves_field, liabilities_field, asof_field, date_order, reserves_decimals, liabilities_decimals)` | owner | Moves the feed; bumps `source_version`, clears `last_good`. |
| `update_policy(feed_id, min_ratio_bps, max_age_hours)` | owner | Bumps `policy_version`, clears `last_good`. |
| `set_paused(feed_id, paused)` | owner | Paused feeds can't be attested and are never "backed". |
| `transfer_feed(feed_id, new_owner)` | owner | |

### View

| Method | Returns |
|---|---|
| `is_backed(feed_id, max_age_hours) -> bool` | `true` iff the feed is live, its last verified attestation was `FULLY_BACKED` under the feed's policy, and that report is at most `max_age_hours` old **at call time**. |
| `meets(feed_id, min_ratio_bps, max_age_hours) -> bool` | The consumer's own policy against the last verified numbers. |
| `get_backing(feed_id) -> dict` | `status`, `latest_status`, `ratio_bps`, `reserves`, `liabilities`, `as_of`, `report_age_hours`, `attested_at`, thresholds, `consecutive_failures`, `backed`. |
| `get_feed(feed_id)`, `list_feeds(offset, limit)`, `get_feeds_of(owner)` | Feed config plus `latest` and `last_good`. |
| `get_history(feed_id, offset, limit)` | Attestations, newest first (≤ 30 kept). |
| `get_latest(feed_id)`, `get_stats()`, `get_limits()` | |

Each attestation stores: `n`, `status`, `reserves`, `liabilities` (decimal strings), `ratio_bps`, `as_of`, `age_hours`, `attested_at`, `error`, `evidence` (raw path values or the verbatim snippets), `evidence_hash` (sha256), `min_ratio_bps`, `max_age_hours`, `source_version`, `policy_version`, `attestor`.

### Parameters

| Parameter | Rule |
|---|---|
| `kind` | `json` or `html` |
| `reserves_field`, `liabilities_field`, `asof_field` | json: a path like `data.usdt.total_assets`, `holdings[0].quantity` or `holdings.0.quantity`. html: the label text printed before the amount (`RLUSD Reserve Funds`) and the as-of label (`As of`). |
| `date_order` | `MDY`, `DMY` or empty (only unambiguous dates accepted). |
| `*_decimals` | 0–36; the amount is divided by 10^decimals. Must be 0 for html. |
| `min_ratio_bps` | 1000–30000 (10000 = 100 %). |
| `max_age_hours` | 1–9600. Pick it from the publisher's cadence: hourly APIs 24, weekly pages 336. |
| as-of values | ISO 8601 (zone respected, naive = UTC), Unix seconds or milliseconds, or a date in text. Date-only = 00:00 UTC. |

### Using it from another contract

```python
ATTESTOR = Address("0x…")  # Reserve Attestor
USDB_FEED = 1

@gl.public.write
def deposit(self, amount: int) -> None:
    attestor = gl.get_contract_at(ATTESTOR)
    if not attestor.view().is_backed(USDB_FEED, 48):
        raise gl.vm.UserError("USDB reserves not proven in the last 48 h")
    ...
```

---

## Deploy in GenLayer Studio

The contract has not been deployed by this project. To deploy it yourself:

1. Open **https://studio.genlayer.com** and pick (or create) an account in the Studio's account panel.
2. **Contracts → New contract**, name it `reserve_attestor.py`, and paste the whole of [`contracts/reserve_attestor.py`](contracts/reserve_attestor.py). Keep the first two lines (`# v0.2.16` and the `Depends` line).
3. **Run and Debug → Deploy.** The constructor takes **no arguments**. Copy the contract address once the deploy transaction is finalized.
4. Seed the feeds: in **Write methods**, call `create_feed` once per row (strings without quotes in the Studio form; numbers as numbers):

   | # | issuer | asset | source_url | kind | reserves_field | liabilities_field | asof_field | date_order | res. dec | liab. dec | min_ratio_bps | max_age_hours |
   |---|---|---|---|---|---|---|---|---|---|---|---|---|
   | 1 | `Bridge (Stripe)` | `USDB` | `https://transparency.bridge.xyz/v0/stablecoins/usdb` | `json` | `total_reserve_amount` | `total_onchain_amount` | `last_updated` | *(empty)* | 0 | 0 | 10000 | 24 |
   | 2 | `TrueUSD (Chainlink PoR via LedgerLens)` | `TUSD` | `https://api.real-time-reserves.ledgerlens.io/v1/chainlink/proof-of-reserves/TrueUSD` | `json` | `totalTrust` | `totalToken` | `updatedAt` | *(empty)* | 0 | 0 | 10000 | 24 |
   | 3 | `Ripple (Standard Custody)` | `RLUSD` | `https://ripple.com/solutions/stablecoin/transparency/` | `html` | `RLUSD Reserve Funds` | `Total Circulating RLUSD` | `As of` | `MDY` | 0 | 0 | 10000 | 336 |
   | 4 | `Backed / xStocks` | `SPYx` | `https://api.xstocks.fi/api/v2/public/proof-of-reserves/SPYx` | `json` | `sharesHeld` | `circulatingSupply` | `timestamp` | *(empty)* | 0 | 0 | 10000 | 48 |

5. Call `attest` with `feed_id` 1, 2, 3 and 4. Each one is a non-deterministic transaction: watch the validators' votes in the Studio log, then read `get_backing(1)` … `get_backing(4)` and `is_backed(1, 24)` under **Read methods**.
6. Put the address in the dApp (`VITE_CONTRACT_ADDRESS`) and in this README.

Or with Node 20+: `npm install`, `npm run plan` (prints the exact calls, no network), then `node scripts/deploy-seed-studionet.mjs` (deploys, creates the four feeds, attests each, writes `deployments/studionet.json`; resumable; uses `PRIVATE_KEY` if set, otherwise a throwaway key funded by Studionet's faucet). `CONTRACT=0x… node scripts/deploy-seed-studionet.mjs` seeds an existing deployment.

---

## Development

```bash
pip install -r requirements-dev.txt     # genlayer-test 0.29.2, pytest, cloudpickle
pytest                                  # 192 direct-mode tests, ~7 s, no node needed
pip install genvm-linter==0.11.0 && genvm-lint check contracts/reserve_attestor.py
node scripts/check-sources.mjs          # read-only: what validators would read right now
```

The tests replay the real source bodies from `tests/fixtures/` and mock the LLM:

| Group | Covers |
|---|---|
| Registry (35) | creation, normalization, every validation rule, per-owner limit, listing, unknown feed |
| Real JSON sources (19) | USDB, TUSD, SPYx, USDT and mUSD fixtures end to end with validator agreement, paths with indexes, decimals, exponents, separators, 7 as-of formats |
| Statuses (36) | each status, threshold edges, zero reserves, fetch failures, bad shapes, bad numbers, negative / zero liabilities, decimals mismatch, future and ambiguous dates |
| HTML / LLM (26) | Ripple page end to end, two injection attacks, script-hidden text, invented and swapped numbers, garbage model output, every grounding rule, units K/M/B/T, DMY/MDY, prompt fencing and cap |
| Consensus (21) | agreement within tolerance, disagreement on numbers, as-of, status and one-sided failures, malformed and forged leader results |
| History (6) | bounded history, newest first, failure counter, `last_good`, stats |
| Consumer views (11) | `is_backed` ageing, `meets`, `get_backing`, pause, policy and source changes clearing `last_good` |
| Access (13) | rate limit, pause, owner-only calls, transfer and its limits |
| Helpers (25) | number and date parsing, JSON paths, anchoring, HTML stripping |

## Limitations

* **Not deployed.** Nothing has run on Studionet; the live behaviour of `gl.nondet.web.get` against these hosts (user agent, rate limits, geo) is untested. `scripts/check-sources.mjs` shows plain Node `fetch` works.
* **A source is only as honest as its publisher.** The contract proves "this is what the issuer's page said, and validators agree", not that the reserves exist. It is a transparency primitive, not an audit.
* **HTML pages change.** A redesign that renames a label makes the feed `UNVERIFIABLE` (never wrongly backed) until the owner calls `update_source`. A page that repeats the label next to a different amount (a historical table, say) is refused as conflicting; pick a more specific label.
* **Boundary flapping.** If the true ratio sits within 0.5 % of `min_ratio_bps`, leader and validators may compute different statuses and fail to reach consensus; the transaction is retried.
* **TUSD's `updatedAt` is the time of the response**, not of an underlying bank statement; Tether's `id` field (fixture only) is assumed to be a Unix timestamp. See `docs/sources.md`.
* **Single-figure feeds.** One reserves number and one liabilities number per feed; no per-asset breakdown, no summing across fields.
* **Studionet only** in the scripts; the contract itself is network-agnostic.

## License

MIT
