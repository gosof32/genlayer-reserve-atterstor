// The real attestation sources this project was built and tested against (see docs/sources.md).
// Each entry is exactly the argument list of create_feed, in order.

export const FEEDS = [
  {
    key: "usdb",
    issuer: "Bridge (Stripe)",
    asset: "USDB",
    source_url: "https://transparency.bridge.xyz/v0/stablecoins/usdb",
    kind: "json",
    reserves_field: "total_reserve_amount",
    liabilities_field: "total_onchain_amount",
    asof_field: "last_updated",
    date_order: "",
    reserves_decimals: 0,
    liabilities_decimals: 0,
    min_ratio_bps: 10000,
    max_age_hours: 24,
  },
  {
    key: "tusd",
    issuer: "TrueUSD (Chainlink PoR via LedgerLens)",
    asset: "TUSD",
    source_url: "https://api.real-time-reserves.ledgerlens.io/v1/chainlink/proof-of-reserves/TrueUSD",
    kind: "json",
    reserves_field: "totalTrust",
    liabilities_field: "totalToken",
    asof_field: "updatedAt",
    date_order: "",
    reserves_decimals: 0,
    liabilities_decimals: 0,
    min_ratio_bps: 10000,
    max_age_hours: 24,
  },
  {
    key: "rlusd",
    issuer: "Ripple (Standard Custody)",
    asset: "RLUSD",
    source_url: "https://ripple.com/solutions/stablecoin/transparency/",
    kind: "html",
    reserves_field: "RLUSD Reserve Funds",
    liabilities_field: "Total Circulating RLUSD",
    asof_field: "As of",
    date_order: "MDY",
    reserves_decimals: 0,
    liabilities_decimals: 0,
    min_ratio_bps: 10000,
    max_age_hours: 336,
  },
  {
    key: "spyx",
    issuer: "Backed / xStocks",
    asset: "SPYx",
    source_url: "https://api.xstocks.fi/api/v2/public/proof-of-reserves/SPYx",
    kind: "json",
    reserves_field: "sharesHeld",
    liabilities_field: "circulatingSupply",
    asof_field: "timestamp",
    date_order: "",
    reserves_decimals: 0,
    liabilities_decimals: 0,
    min_ratio_bps: 10000,
    max_age_hours: 48,
  },
];

export const ARG_ORDER = [
  "issuer", "asset", "source_url", "kind", "reserves_field", "liabilities_field", "asof_field", "date_order",
  "reserves_decimals", "liabilities_decimals", "min_ratio_bps", "max_age_hours",
];

export const feedArgs = (f) => ARG_ORDER.map((k) => f[k]);
