// Read-only: fetches every source in scripts/sources.mjs and prints what a validator would read.
// No wallet, no transaction, no GenLayer node.
//
//   node scripts/check-sources.mjs
//
// JSON feeds are parsed exactly like the contract (paths, exact decimal text). For the HTML feed
// this prints the first amount after each label, which is what the contract's anchoring check
// compares the model's answer against.

import { FEEDS } from "./sources.mjs";

const AMOUNT = /(?<![\w/.,])(US\$|USD|[$€£¥])?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?(thousand|million|billion|trillion|bn|mn|k|m|b|t)?(?![\w/])/gi;
const UNIT = { "": 0, k: 3, thousand: 3, m: 6, mn: 6, million: 6, b: 9, bn: 9, billion: 9, t: 12, trillion: 12 };

function get(doc, path) {
  let cur = doc;
  for (const tok of path.match(/[^.[\]]+|\[\d+\]/g)) {
    const key = tok.startsWith("[") ? Number(tok.slice(1, -1)) : tok;
    if (cur == null || !(key in Object(cur))) return undefined;
    cur = cur[key];
  }
  return cur;
}

function text(html) {
  return html
    .replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function firstAmountAfter(page, label) {
  const i = page.toLowerCase().indexOf(label.toLowerCase());
  if (i < 0) return null;
  const win = page.slice(i + label.length, i + label.length + 300);
  for (const m of win.matchAll(AMOUNT)) {
    if (m[1] || m[4] || m[2].includes(",") || m[3]) {
      const v = Number(m[2].replace(/,/g, "") + "." + (m[3] || "0")) * 10 ** UNIT[(m[4] || "").toLowerCase()];
      return { snippet: m[0].trim(), value: v };
    }
  }
  return null;
}

const ratio = (r, l) => (l > 0 ? Math.floor((r * 10000) / l) : null);

for (const f of FEEDS) {
  const at = new Date().toISOString();
  try {
    const res = await fetch(f.source_url, { headers: { "User-Agent": "Mozilla/5.0 (genlayer-reserve-attestor)" } });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (f.kind === "json") {
      const doc = JSON.parse(body);
      const r = get(doc, f.reserves_field), l = get(doc, f.liabilities_field), a = get(doc, f.asof_field);
      console.log(`${f.asset.padEnd(6)} ${at} reserves=${r} liabilities=${l} as_of=${a} ratio_bps≈${ratio(Number(r), Number(l))}`);
    } else {
      const page = text(body);
      const r = firstAmountAfter(page, f.reserves_field), l = firstAmountAfter(page, f.liabilities_field);
      const a = page.match(/As of [^ ]+/i)?.[0];
      console.log(`${f.asset.padEnd(6)} ${at} reserves=${r?.snippet} liabilities=${l?.snippet} as_of="${a}" ratio_bps≈${ratio(r?.value, l?.value)}`);
    }
  } catch (e) {
    console.log(`${f.asset.padEnd(6)} ${at} UNREADABLE: ${e.message}`);
  }
}
