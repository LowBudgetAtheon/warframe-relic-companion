#!/usr/bin/env node
/* Builds data/relics.json, the file every copy of the app downloads on launch.

   Sources:
   - WFCD warframe-items (raw.githubusercontent.com): every Prime item, its parts,
     which relics hold each part, stats, variants and unique mods.
   - DE's official drop tables (warframe.com/droptables): which relics drop from
     which missions, used for "By the Rates" and to tell vaulted relics apart.
   - WARFRAME Wiki (wiki.warframe.com): which weapons have an Incarnon Genesis.
   - data/community-farms.json and data/vault-watch.json in this repo, edited by hand.

   Usage: node scripts/build-data.mjs [--merge-only-on-failure]
   With that flag, if the online sources fail, the hand-edited files are still
   merged into the existing data/relics.json so they reach users. */

import fs from "node:fs/promises";
import crypto from "node:crypto";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/relics.json", ROOT);
const COMMUNITY = new URL("data/community-farms.json", ROOT);
const VAULT_WATCH = new URL("data/vault-watch.json", ROOT);
const OVERRIDES = new URL("data/overrides.json", ROOT);
const MERGE_ON_FAIL = process.argv.includes("--merge-only-on-failure");
const UA = "warframe-relic-companion-data/1.0 (+https://github.com/LowBudgetAtheon/warframe-relic-companion)";

const WFCD_BASES = [
  "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/",
  "https://raw.githubusercontent.com/WFCD/warframe-items/main/data/json/",
  "https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/",
];
const DROP_TABLE_URLS = [
  "https://www.warframe.com/droptables",
  "https://warframe-web-assets.nyc3.cdn.digitaloceanspaces.com/uploads/cms/hnfvc0o3jnfvc873njb03enrf56.html",
];
const WIKI_API = "https://wiki.warframe.com/api.php";
const SOLNODES = "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/solNodes.json";

/* file -> [category, slot, isWeapon]; earlier files win when an item appears twice */
const FILES = [
  ["Primary", "weapons", "Primary", true],
  ["Secondary", "weapons", "Secondary", true],
  ["Melee", "weapons", "Melee", true],
  ["Archwing", "archwing", "Archwing", false],
  ["Arch-Gun", "archgun", "Arch-gun", true],
  ["Arch-Melee", "archmelee", "Arch-melee", true],
  ["Warframes", "warframes", "Warframe", false],
  ["Sentinels", "companions", "Sentinel", false],
  ["SentinelWeapons", "companions", "Companion weapon", true],
  ["Pets", "companions", "Companion", false],
  ["Misc", "other", "Other", false],
];
const RELIC_RE = /^(Lith|Meso|Neo|Axi)\s+([A-Z]\d+)\b/;
const RARMAP = { Common: "C", Uncommon: "U", Rare: "R" };
const VARIANT_PRE = /^(Kuva|Tenet|Prisma|Coda|Telos|Vaykor|Rakta|Sancti|Secura|Synoid|Dex|Carmine|Mara|Mutalist|Proboscis)\s+(.+)$/;
const VARIANT_SUF = /^(.+)\s+(Vandal|Wraith)$/;

const log = (...a) => console.log("[data]", ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, type = "json", tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: type === "json" ? "application/json" : "text/html,*/*" }, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return type === "json" ? await r.json() : await r.text();
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw new Error(`${url}: ${last && last.message}`);
}
async function wfcd(file) {
  let last;
  for (const base of WFCD_BASES) {
    try { return await get(base + encodeURIComponent(file) + ".json", "json", 2); } catch (e) { last = e; }
  }
  throw last;
}
const readJSON = async (u, fallback) => { try { return JSON.parse(await fs.readFile(u, "utf8")); } catch (e) { return fallback; } };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const strip = h => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const round = (v, d = 3) => typeof v === "number" ? Math.round(v * 10 ** d) / 10 ** d : undefined;
const wikiUrl = u => typeof u === "string" ? u.replace(/^https?:\/\/warframe\.fandom\.com\/wiki\//, "https://wiki.warframe.com/w/") : undefined;
function relicName(s) { const m = RELIC_RE.exec(s || ""); return m ? `${m[1]} ${m[2]}` : null; }
function rarOf(d) {
  if (RARMAP[d.rarity]) return RARMAP[d.rarity];
  const c = d.chance > 1 ? d.chance / 100 : d.chance || 0;
  return c >= 0.2 ? "C" : c >= 0.05 ? "U" : "R";
}

/* ---------- DE drop tables ---------- */
function section(html, id) {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return "";
  const j = html.indexOf("<h3", i + 10);
  return html.slice(i, j < 0 ? undefined : j);
}
function rowsOf(sec) {
  return [...sec.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => ({
    th: (/<th[^>]*>([\s\S]*?)<\/th>/.exec(m[1]) || [])[1],
    td: [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => strip(x[1])),
  }));
}
export function parseDropTables(html) {
  const missions = [];
  let node = null, rot = null;
  for (const r of rowsOf(section(html, "missionRewards"))) {
    if (r.th != null) {
      const t = strip(r.th);
      if (/^Rotation [A-C]$/.test(t)) rot = t.slice(-1); else { node = t; rot = null; }
      continue;
    }
    if (r.td.length < 2 || !node) continue;
    const relic = /^(Lith|Meso|Neo|Axi) ([A-Z]\d+) Relic$/.exec(r.td[0]);
    if (!relic) continue;
    const c = /\(([\d.]+)%\)/.exec(r.td[1]);
    missions.push({ node, rot, relic: `${relic[1]} ${relic[2]}`, chance: c ? +c[1] : 0 });
  }
  const relicItems = {}; // reward name -> [[relic, rar]]
  let cur = null;
  for (const r of rowsOf(section(html, "relicRewards"))) {
    if (r.th != null) {
      const m = /^(Lith|Meso|Neo|Axi) ([A-Z]\d+) Relic \((\w+)\)$/.exec(strip(r.th));
      cur = m && m[3] === "Intact" ? `${m[1]} ${m[2]}` : null;
      continue;
    }
    if (!cur || r.td.length < 2) continue;
    const rr = /^(Common|Uncommon|Rare)/.exec(r.td[1]);
    if (!rr) continue;
    (relicItems[r.td[0]] = relicItems[r.td[0]] || []).push([cur, RARMAP[rr[1]]]);
  }
  return { missions, relicItems };
}
export function bestFarms(missions) {
  const best = {};
  const rotRank = r => (r == null ? 0 : { A: 1, B: 2, C: 3 }[r] || 4);
  for (const m of missions) {
    if (/^Event/i.test(m.node) || /Conclave/i.test(m.node)) continue;
    const b = best[m.relic];
    if (!b || m.chance > b.chance || (m.chance === b.chance && rotRank(m.rot) < rotRank(b.rot))) best[m.relic] = m;
  }
  const out = {};
  for (const [r, m] of Object.entries(best)) {
    const p = /^(.+?)\/(.+?) \((.+)\)$/.exec(m.node);
    out[r] = p ? { n: p[2], p: p[1], t: p[3], r: m.rot || undefined, c: m.chance } : { n: m.node, r: m.rot || undefined, c: m.chance };
  }
  return out;
}

/* ---------- WARFRAME Wiki: Incarnon Genesis list ---------- */
async function wikiIncarnons() {
  const names = new Set();
  for (const page of ["Incarnon", "Incarnon_Genesis"]) {
    try {
      const j = await get(`${WIKI_API}?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2`);
      const txt = (j.parse && j.parse.wikitext) || "";
      for (const m of txt.matchAll(/([A-Z][A-Za-z0-9&'\- ]{1,24}?) Incarnon Genesis/g)) {
        const n = m[1].replace(/^.*[\[|]/, "").trim();
        if (n && !/^(The|An?|Each|Every|All|Incarnon)$/i.test(n)) names.add(n);
      }
    } catch (e) { log("wiki", page, "failed:", e.message); }
  }
  return names;
}

/* ---------- build ---------- */
async function build() {
  const overrides = await readJSON(OVERRIDES, {});
  const lists = {};
  for (const [f] of FILES) lists[f] = await wfcd(f);
  const mods = await wfcd("Mods").catch(e => { log("Mods.json failed:", e.message); return []; });
  const relicList = await wfcd("Relics").catch(e => { log("Relics.json failed:", e.message); return []; });
  log("WFCD lists loaded:", Object.entries(lists).map(([k, v]) => `${k}=${v.length}`).join(" "));

  let drops = { missions: [], relicItems: {} };
  for (const u of DROP_TABLE_URLS) {
    try { drops = parseDropTables(await get(u, "text")); if (drops.missions.length) break; } catch (e) { log("drop tables", u, "failed:", e.message); }
  }
  log("drop tables: mission relic rows", drops.missions.length, "relic reward names", Object.keys(drops.relicItems).length);
  const dropsOk = drops.missions.length > 200;

  const wikiInc = await wikiIncarnons();
  log("wiki incarnon genesis names:", wikiInc.size);
  const incBase = new Set([...wikiInc, ...(overrides.incarnonBases || [])]);
  for (const list of Object.values(lists)) for (const x of list) if (/ Incarnon Genesis$/.test(x.name || "")) incBase.add(x.name.replace(/ Incarnon Genesis$/, ""));

  // every weapon by name, for variants
  const weaponsByName = {};
  for (const [f, , , isW] of FILES) if (isW) for (const x of lists[f]) if (x.name && !weaponsByName[x.name]) weaponsByName[x.name] = x;

  // pass 1: Prime items with relic-dropping parts
  const seen = new Set(), raw = [];
  for (const [f, cat, slot, isW] of FILES) {
    for (const x of lists[f]) {
      const name = x.name || "";
      if (seen.has(name) || !/(^| )Prime( |$)/.test(name) || !Array.isArray(x.components)) continue;
      seen.add(name);
      raw.push({ x, cat, slot, isW });
    }
  }
  const primeNames = new Set(raw.map(r => r.x.name));
  const items = [];
  for (const { x, cat, slot, isW } of raw) {
    const parts = [], req = [];
    for (const c of x.components) {
      const cname = c.name || "";
      const isWhole = primeNames.has(cname) && !/\/Recipes\//.test(c.uniqueName || "");
      if (isWhole) { req.push({ n: cname, c: c.itemCount || 1 }); continue; }
      const rel = new Map();
      let full = null;
      for (const d of c.drops || []) {
        const r = relicName(d.location); if (!r) continue;
        if (!rel.has(r)) rel.set(r, rarOf(d));
        if (!full && d.type && d.type.startsWith(x.name)) full = d.type;
      }
      if (!full) full = cname === "Blueprint" ? `${x.name} Blueprint` : `${x.name} ${cname}`;
      for (const k of [full, `${x.name} ${cname}`, `${x.name} ${cname} Blueprint`]) for (const [r, rar] of drops.relicItems[k] || []) if (!rel.has(r)) rel.set(r, rar);
      if (!rel.size) continue; // resources like Orokin Cells
      const label = full.startsWith(x.name + " ") ? full.slice(x.name.length + 1) : cname;
      parts.push({ p: label, full, c: c.itemCount || 1, r: [...rel.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })) });
    }
    if (!parts.length) continue; // e.g. Founders items with no relics
    const base = x.name.replace(/ Prime$/, "");
    const it = { id: slug(x.name), n: x.name, cat, slot };
    if (x.vaulted != null) it.vaulted = !!x.vaulted;
    it.parts = parts;
    if (req.length) it.req = req;
    if (isW) {
      it.w = 1;
      it.inc = incBase.has(base) ? { g: `${base} Incarnon Genesis`, src: "the Steel Path Circuit (Duviri)" } : null;
      it.s = stats(x);
      const vars = [];
      for (const [vn, v] of Object.entries(weaponsByName)) {
        if (vn === x.name || vn === base || /Prime/.test(vn)) continue;
        const m = VARIANT_PRE.exec(vn) || VARIANT_SUF.exec(vn) || /^MK1-(.+)$/.exec(vn);
        const vb = m ? (VARIANT_SUF.test(vn) ? m[1] : m[m.length - 1]) : null;
        if (vb === base) vars.push({ n: vn, s: stats(v) });
      }
      if (vars.length) it.var = vars.sort((a, b) => a.n.localeCompare(b.n));
    }
    const um = uniqueMods(mods, base, x.name);
    if (um.length) it.mods = um;
    if (x.wikiaUrl) it.wiki = wikiUrl(x.wikiaUrl);
    const ov = (overrides.items || {})[x.name];
    if (ov) Object.assign(it, ov);
    items.push(it);
  }
  // auto notes for weapons built from other weapons
  const byName = Object.fromEntries(items.map(i => [i.n, i]));
  for (const it of items) {
    if (!it.req || it.note) continue;
    it.note = it.req.map(r => {
      const sub = byName[r.n];
      const inc = sub && sub.inc ? ` ${r.n} can take an Incarnon upgrade, so you may want to build extras instead of giving yours up.` : "";
      return `Needs ${r.c === 1 ? "a" : r.c} fully built ${r.n}${r.c > 1 ? "s" : ""}, and crafting uses ${r.c === 1 ? "it" : "them"} up.${inc}`;
    }).join(" ");
  }

  // relics
  const missionSet = new Set(drops.missions.map(m => m.relic));
  const wfcdVaulted = {};
  for (const r of relicList) { const n = relicName(r.name); if (n && r.vaulted != null) wfcdVaulted[n] = wfcdVaulted[n] || !!r.vaulted; }
  const bf = bestFarms(drops.missions);
  const relics = {};
  for (const it of items) for (const p of it.parts) for (const [r] of p.r) {
    const o = relics[r] || (relics[r] = { v: 0, it: [] });
    if (!o.it.includes(it.n)) o.it.push(it.n);
  }
  for (const [r, o] of Object.entries(relics)) {
    o.v = (dropsOk ? !missionSet.has(r) : !!wfcdVaulted[r]) ? 1 : 0;
    if (bf[r]) o.bf = bf[r];
  }

  let nodes;
  try {
    const sn = await get(SOLNODES);
    nodes = Object.fromEntries(Object.entries(sn).map(([k, v]) => [k, v.value]).filter(([, v]) => v));
  } catch (e) { log("solNodes failed:", e.message); }

  const counts = { items: items.length, frames: items.filter(i => i.cat === "warframes").length, relics: Object.keys(relics).length };
  log("built", JSON.stringify(counts));
  if (counts.items < 100 || counts.frames < 30 || counts.relics < 200) throw new Error(`sanity check failed: ${JSON.stringify(counts)}`);

  return {
    schema: 1,
    sources: { wfcdItems: true, dropTables: dropsOk, wikiIncarnon: wikiInc.size > 0 },
    items: items.sort((a, b) => a.n.localeCompare(b.n)),
    relics: Object.fromEntries(Object.entries(relics).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))),
    nodes,
  };
}

function stats(x) {
  const s = {
    mr: x.masteryReq, dmg: round(x.totalDamage, 1), cc: round(x.criticalChance), cd: round(x.criticalMultiplier, 2),
    sc: round(x.procChance), fr: round(x.fireRate, 3), mag: x.magazineSize, rl: round(x.reloadTime, 2), dispo: round(x.omegaAttenuation, 2),
  };
  Object.keys(s).forEach(k => s[k] == null && delete s[k]);
  return Object.keys(s).length ? s : undefined;
}
function uniqueMods(mods, base, full) {
  const want = new Set([base.toLowerCase(), full.toLowerCase()]);
  return mods
    .filter(m => m.compatName && want.has(String(m.compatName).toLowerCase()) && !/Riven/i.test(m.name || ""))
    .map(m => {
      const src = (m.drops || []).slice().sort((a, b) => (b.chance || 0) - (a.chance || 0)).slice(0, 3)
        .map(d => d.location + (d.chance ? ` (${(d.chance * 100).toFixed(2).replace(/\.?0+$/, "")}%)` : ""));
      return { n: m.name, src, u: wikiUrl(m.wikiaUrl) };
    })
    .filter((m, i, a) => a.findIndex(x => x.n === m.n) === i)
    .sort((a, b) => a.n.localeCompare(b.n));
}

async function curated() {
  const c = await readJSON(COMMUNITY, {});
  const v = await readJSON(VAULT_WATCH, {});
  return { community: { tiers: c.tiers || {}, relics: c.relics || {} }, vaultWatch: v.entries || [] };
}
const hashOf = d => crypto.createHash("sha256").update(JSON.stringify({ ...d, generated: undefined })).digest("hex");

async function main() {
  const prev = await readJSON(OUT, null);
  let data;
  try {
    data = { ...(await build()), ...(await curated()) };
  } catch (e) {
    console.error("[data] build failed:", e.message);
    if (!MERGE_ON_FAIL || !prev || prev.seed) process.exit(1);
    log("merging hand-edited files into the existing data instead");
    data = { ...prev, ...(await curated()) };
    delete data.generated;
  }
  const generated = prev && hashOf(prev) === hashOf(data) ? prev.generated : new Date().toISOString();
  const out = { schema: 1, generated, ...data };
  if (prev && prev.generated === generated) { log("no changes"); return; }
  await fs.writeFile(OUT, JSON.stringify(out) + "\n");
  log("wrote", OUT.pathname, (JSON.stringify(out).length / 1024).toFixed(0) + " KB");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
