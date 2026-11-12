// Deploy Reserve Attestor to GenLayer Studionet, register the real feeds and attest each one.
//
//   npm install
//   DRY_RUN=1 node scripts/deploy-seed-studionet.mjs   # print the plan, touch nothing
//   node scripts/deploy-seed-studionet.mjs             # deploy + seed + attest (or resume)
//   CONTRACT=0x... node scripts/deploy-seed-studionet.mjs   # seed an existing deployment
//   ATTEST=0 node scripts/deploy-seed-studionet.mjs    # register feeds only
//   FRESH=1 node scripts/deploy-seed-studionet.mjs     # archive the previous record, start over
//
// Signer: PRIVATE_KEY from the environment if set, otherwise a throwaway key stored in the
// git-ignored artifacts/keys.json and funded with Studionet's sim_fundAccount faucet call.
//
// Every transaction is appended to deployments/studionet.json the moment it is submitted
// (hash first, receipt later). Re-running resumes: finished steps are skipped and
// submitted-but-unconfirmed ones are awaited by hash, never re-sent.

import fs from "node:fs";
import { FEEDS, feedArgs } from "./sources.mjs";

const DRY = !!process.env.DRY_RUN;
const DO_ATTEST = process.env.ATTEST !== "0";
const KEYS = new URL("../artifacts/keys.json", import.meta.url);
const OUT = new URL("../deployments/studionet.json", import.meta.url);
const CODE = new URL("../contracts/reserve_attestor.py", import.meta.url);

if (DRY) {
  console.log("DRY RUN: no network calls, no transactions.\n");
  console.log(`1. deploy contracts/reserve_attestor.py (${fs.statSync(CODE).size} bytes), constructor args: []`);
  FEEDS.forEach((f, i) => console.log(`${i + 2}. create_feed(${JSON.stringify(feedArgs(f)).slice(1, -1)})`));
  if (DO_ATTEST) FEEDS.forEach((f, i) => console.log(`${FEEDS.length + i + 2}. attest(<feed id of ${f.asset}>)`));
  console.log(`then: read get_feed / get_backing / is_backed for each feed and save deployments/studionet.json`);
  process.exit(0);
}

const { createClient, createAccount, generatePrivateKey } = await import("genlayer-js");
const { studionet } = await import("genlayer-js/chains");

const client = createClient({ chain: studionet });
const json = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof Map ? Object.fromEntries(x) : x)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.env.FRESH && fs.existsSync(OUT)) fs.renameSync(OUT, new URL(`../artifacts/studionet-${Date.now()}.json`, import.meta.url));
const state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { transactions: [] };
const log = state.transactions;

function save(extra = {}) {
  fs.mkdirSync(new URL("../deployments/", import.meta.url), { recursive: true });
  Object.assign(state, extra, { network: "studionet", chain_id: 61999, rpc: "https://studio.genlayer.com/api", updated_at: new Date().toISOString() });
  const tmp = new URL("../deployments/studionet.json.tmp", import.meta.url);
  fs.writeFileSync(tmp, JSON.stringify(json(state), null, 2) + "\n");
  fs.renameSync(tmp, OUT);
}

function describe(receipt) {
  const r = json(receipt);
  const leader = r.consensus_data?.leader_receipt?.[0] ?? r.consensus_data?.leader_receipt ?? {};
  const execution = leader.execution_result ?? r.txExecutionResultName ?? "UNKNOWN";
  let returnValue = leader.result?.payload?.readable ?? leader.result?.payload ?? null;
  if (returnValue && typeof returnValue !== "string") returnValue = JSON.stringify(returnValue);
  return { status: r.status_name ?? r.statusName ?? r.status, consensus: r.result_name ?? r.resultName ?? r.result,
    execution, ok: execution === "SUCCESS", returnValue };
}

async function retry(fn, tries = 8) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      process.stdout.write(`(rpc retry ${i}) `);
      await sleep(4000 * i);
    }
  }
}

async function waitFinal(hash) {
  for (;;) {
    const tx = await retry(() => client.getTransaction({ hash }));
    const name = tx?.statusName ?? tx?.status_name ?? tx?.status;
    if (["FINALIZED", "CANCELED", "UNDETERMINED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"].includes(name)) return tx;
    await sleep(5000);
  }
}

async function step(key, label, fn) {
  let rec = log.find((t) => t.key === key);
  if (rec?.status === "FINALIZED") { console.log(`- ${label}: done ${String(rec.returnValue ?? "").slice(0, 160)}`); return rec; }
  if (!rec) {
    process.stdout.write(`- ${label} ... `);
    const hash = await retry(fn);
    rec = { key, label, hash, submitted_at: new Date().toISOString() };
    log.push(rec);
    save();
  } else process.stdout.write(`- ${label} (resuming ${rec.hash.slice(0, 10)}) ... `);
  Object.assign(rec, describe(await waitFinal(rec.hash)), { finished_at: new Date().toISOString() });
  save();
  console.log(`${rec.status}/${rec.consensus}/${rec.execution} ${String(rec.returnValue ?? "").slice(0, 300)}`);
  if (rec.status !== "FINALIZED") throw new Error(`"${label}" did not finalize: ${rec.status}`);
  return rec;
}

async function main() {
  let key = process.env.PRIVATE_KEY;
  if (!key) {
    if (!fs.existsSync(KEYS)) {
      fs.mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
      fs.writeFileSync(KEYS, JSON.stringify({ deployer: generatePrivateKey() }, null, 2));
    }
    key = JSON.parse(fs.readFileSync(KEYS, "utf8")).deployer;
  }
  const account = createAccount(key);
  if (!state.account) {
    if (!process.env.PRIVATE_KEY) await retry(() => client.request({ method: "sim_fundAccount", params: [account.address, 1_000_000_000_000] }));
    save({ account: account.address });
  }

  if (process.env.CONTRACT) save({ contract: process.env.CONTRACT });
  if (!state.contract) {
    const code = fs.readFileSync(CODE, "utf8");
    const d = await step("deploy", "deploy contract", () => client.deployContract({ account, code, args: [] }));
    const r = json(await retry(() => client.getTransaction({ hash: d.hash })));
    const address = r.data?.contract_address ?? r.recipient ?? r.to_address ?? r.txDataDecoded?.contractAddress;
    if (!address) throw new Error("no contract address in the deploy receipt");
    save({ contract: address });
    console.log(`  contract: ${address}`);
  }
  const C = state.contract;
  const write = (functionName, args) => () => client.writeContract({ account, address: C, functionName, args, value: 0n });
  const read = (functionName, args) => retry(() => client.readContract({ address: C, functionName, args }));

  const ids = {};
  for (const f of FEEDS) {
    const rec = await step(`feed-${f.key}`, `create_feed ${f.asset} (${f.kind}, ${f.source_url})`, write("create_feed", feedArgs(f)));
    ids[f.key] = Number(rec.returnValue);
    if (!ids[f.key]) throw new Error(`create_feed ${f.asset} returned no id`);
  }
  save({ feeds: ids });

  if (DO_ATTEST) {
    for (const f of FEEDS) {
      await step(`attest-${f.key}`, `attest #${ids[f.key]} ${f.asset} (validators read ${new URL(f.source_url).host} live)`, write("attest", [ids[f.key]]));
    }
  }

  const summary = {};
  for (const f of FEEDS) summary[f.asset] = { feed_id: ids[f.key], backing: json(await read("get_backing", [ids[f.key]])) };
  save({ final_state: summary, stats: json(await read("get_stats", [])) });
  console.log("\nDONE. Wrote deployments/studionet.json");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { save(); console.error(e); process.exit(1); });
