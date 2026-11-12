import json
import sys
from pathlib import Path

import pytest

GENVM_VERSION = "v0.2.16"  # matches the contract header
ROOT = Path(__file__).resolve().parents[2]
CONTRACT = str(ROOT / "contracts" / "reserve_attestor.py")
FIXTURES = ROOT / "tests" / "fixtures"

# Fixtures are verbatim bodies fetched with curl on 2026-11-12 ~09:52 UTC (see docs/sources.md).
NOW = "2026-11-12T10:00:00Z"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


BRIDGE_USDB = fixture("bridge_usdb.json")
BRIDGE_MUSD = fixture("bridge_musd.json")
TRUEUSD = fixture("ledgerlens_trueusd.json")
SPYX = fixture("xstocks_spyx.json")
TETHER = fixture("tether_transparency.json")
RIPPLE = fixture("ripple_rlusd.html")

URL_USDB = "https://transparency.bridge.xyz/v0/stablecoins/usdb"
URL_MUSD = "https://transparency.bridge.xyz/v0/stablecoins/musd"
URL_TUSD = "https://api.real-time-reserves.ledgerlens.io/v1/chainlink/proof-of-reserves/TrueUSD"
URL_SPYX = "https://api.xstocks.fi/api/v2/public/proof-of-reserves/SPYx"
URL_TETHER = "https://app.tether.to/transparency.json"
URL_RIPPLE = "https://ripple.com/solutions/stablecoin/transparency/"

# create_feed argument sets for the real sources
FEED_USDB = dict(issuer="Bridge (Stripe)", asset="USDB", source_url=URL_USDB, kind="json",
                 reserves_field="total_reserve_amount", liabilities_field="total_onchain_amount",
                 asof_field="last_updated", date_order="", reserves_decimals=0, liabilities_decimals=0,
                 min_ratio_bps=10000, max_age_hours=24)
FEED_TUSD = dict(issuer="TrueUSD (Chainlink PoR via LedgerLens)", asset="TUSD", source_url=URL_TUSD, kind="json",
                 reserves_field="totalTrust", liabilities_field="totalToken", asof_field="updatedAt", date_order="",
                 reserves_decimals=0, liabilities_decimals=0, min_ratio_bps=10000, max_age_hours=24)
FEED_SPYX = dict(issuer="Backed / xStocks", asset="SPYx", source_url=URL_SPYX, kind="json",
                 reserves_field="sharesHeld", liabilities_field="circulatingSupply", asof_field="timestamp",
                 date_order="", reserves_decimals=0, liabilities_decimals=0, min_ratio_bps=10000, max_age_hours=48)
FEED_TETHER = dict(issuer="Tether", asset="USDT", source_url=URL_TETHER, kind="json",
                   reserves_field="data.usdt.total_assets", liabilities_field="data.usdt.total_liabilities",
                   asof_field="data.usdt.id", date_order="", reserves_decimals=0, liabilities_decimals=0,
                   min_ratio_bps=10000, max_age_hours=72)
FEED_RLUSD = dict(issuer="Ripple (Standard Custody)", asset="RLUSD", source_url=URL_RIPPLE, kind="html",
                  reserves_field="RLUSD Reserve Funds", liabilities_field="Total Circulating RLUSD",
                  asof_field="As of", date_order="MDY", reserves_decimals=0, liabilities_decimals=0,
                  min_ratio_bps=10000, max_age_hours=24 * 14)


def rlusd_answer(reserves="$2,748.0M", liabilities="$2,632.9M", asof_text="As of 11/05/2026", asof="2026-11-05",
                 found=True, **extra):
    d = {"found": found, "reserves_text": reserves, "liabilities_text": liabilities, "as_of_text": asof_text,
         "as_of": asof}
    d.update(extra)
    return json.dumps(d)


def hexaddr(a):
    return a.as_hex if hasattr(a, "as_hex") else str(a)


def mock_source(vm, url_pattern, body, status=200, llm=None, clear=True):
    if clear:
        vm.clear_mocks()
    vm.mock_web(url_pattern, {"status": status, "body": body})
    if llm is not None:
        vm.mock_llm(r"RESERVES LABEL", llm)


def edit_json(text: str, fn) -> str:
    doc = json.loads(text)
    fn(doc)
    return json.dumps(doc)


@pytest.fixture
def ra(direct_vm, direct_deploy):
    direct_vm.check_pickling = True
    direct_vm.warp(NOW)
    return direct_deploy(CONTRACT, sdk_version=GENVM_VERSION)


@pytest.fixture
def module(ra):
    return sys.modules[type(ra).__module__]


def make_feed(vm, ra, who, **over):
    args = dict(FEED_USDB)
    args.update(over)
    with vm.prank(who):
        return ra.create_feed(**args)


@pytest.fixture
def usdb(direct_vm, ra, direct_alice):
    return make_feed(direct_vm, ra, direct_alice)


@pytest.fixture
def rlusd(direct_vm, ra, direct_alice):
    return make_feed(direct_vm, ra, direct_alice, **FEED_RLUSD)


def attest(vm, ra, fid, who=None):
    if who is None:
        return ra.attest(fid)
    with vm.prank(who):
        return ra.attest(fid)


def later(vm, minutes=6, base=NOW):
    from datetime import datetime, timedelta
    t = datetime.fromisoformat(base.replace("Z", "+00:00")) + timedelta(minutes=minutes)
    vm.warp(t.isoformat().replace("+00:00", "Z"))
