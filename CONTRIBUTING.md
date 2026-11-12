# Contributing to Reserve Attestor

This repository holds one GenLayer Intelligent Contract (`contracts/reserve_attestor.py`), its
direct-mode tests, the real source fixtures they replay, and a Studionet deploy-and-seed script.

## Run the tests

You need Python 3.12.

```bash
pip install -r requirements-dev.txt   # genlayer-test 0.29.2, pytest, cloudpickle
pytest                                # runs tests/direct in direct mode, no node needed
pip install genvm-linter==0.11.0 && genvm-lint check contracts/reserve_attestor.py
```

## Add a source

1. Find a page or endpoint that shows reserves, liabilities (supply) and a report date to a plain
   `GET` with no JavaScript, cookies or key. `curl -A "Mozilla/5.0" <url>` must show the numbers.
2. Save the body in `tests/fixtures/`, record the values and the fetch time in `docs/sources.md`.
3. Add a test that registers the feed and attests it against the fixture, including
   `direct_vm.run_validator()`.
4. Optionally add it to `scripts/sources.mjs` so the seed script registers it.

## Pull requests

- Keep the contract header (`# v0.2.16` and the `Depends` line) unchanged.
- No `@staticmethod` / `@classmethod` in the contract class; helpers live at module level.
- Add or update a direct test for every behaviour change.
