# Changelog

## v0.1.0 (2026-11-12): first release

- Contract `contracts/reserve_attestor.py` (GenVM `v0.2.16`): registry of proof-of-reserves feeds attested through GenLayer consensus.
  - `create_feed`, `attest` (anyone, 5-minute interval per feed), owner-only `update_source`, `update_policy`, `set_paused`, `transfer_feed`.
  - Views: `is_backed`, `meets`, `get_backing`, `get_feed`, `list_feeds`, `get_feeds_of`, `get_history`, `get_latest`, `get_stats`, `get_limits`.
  - JSON sources parsed deterministically with exact decimal text; HTML sources located by an LLM and verified by contract code (snippet on the page, next to its label, every label occurrence consistent, units and dates parsed by the contract).
  - Statuses `FULLY_BACKED`, `UNDER_COLLATERALIZED`, `STALE`, `UNVERIFIABLE`; custom validator with ±0.5 % amount tolerance, 1 h as-of tolerance and identical status.
  - Bounded history (30), `last_good`, consecutive-failure counter; source/policy changes clear `last_good`.
- Tests: 192 direct-mode tests (`genlayer-test==0.29.2`) replaying real source bodies captured 2026-11-12.
- `genvm-lint check` (0.11.0): passes.
- Scripts: `check-sources.mjs` (read-only), `deploy-seed-studionet.mjs` (deploy + seed + attest, resumable, `DRY_RUN=1` plan). Not run against a network.
