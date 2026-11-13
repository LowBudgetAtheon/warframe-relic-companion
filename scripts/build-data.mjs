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
const GHA = !!process.env.GITHUB_ACTIONS;
/* In GitHub Actions these show up as annotations on the run, readable without the full log */
const note = m => { log(m); if (GHA) console.log(`::notice title=Data build::${String(m).replace(/\r?\n/g, " ")}`); };
const warn = m => { log(m); if (GHA) console.log(`::warning title=Data build::${String(m).replace(/\r?\n/g, " ")}`); };
const fail = m => { console.error("[data]", m); if (GHA) console.log(`::error title=Data build failed::${String(m).replace(/\r?\n/g, " ")}`); };
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
/* WFCD data: raw GitHub first, then the @wfcd/items npm package unpacked by the workflow (WFCD_DIR) */
async function wfcd(file) {
  const errs = [];
  for (const base of WFCD_BASES) {
    try {
      const j = await get(base + encodeURIComponent(file) + ".json", "json", 2);
      if (!Array.isArray(j)) throw new Error("not a list");
      return j;
    } catch (e) { errs.push(e.message); }
  }
  if (process.env.WFCD_DIR) {
    try { return JSON.parse(await fs.readFile(`${process.env.WFCD_DIR}/${file}.json`, "utf8")); } catch (e) { errs.push(`npm copy: ${e.message}`); }
  }
  throw new Error(`WFCD ${file}.json unavailable (${errs.join(" | ")})`);
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

/* ---------- WARFRAME Wiki: how to get a Prime that isn't from relics ---------- */
const acqWhy = {};
function htmlPlain(h) {
  return h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/t[dh]>/gi, " · ").replace(/<\/tr>/gi, " | ")
    .replace(/<span class="mw-editsection[\s\S]*?<\/span>\s*<\/span>/gi, "")
    .replace(/<h\d[\s\S]*?<\/h\d>/gi, " ")
    .replace(/<sup[^>]*class="reference[\s\S]*?<\/sup>/gi, "")
    .replace(/<(span|div)[^>]*display:\s*none[^>]*>[^<]*<\/\1>/gi, "") // hidden sort keys inside currency templates
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (m, alt) => { const c = /ducat/i.test(alt) ? "Ducats" : /platinum/i.test(alt) ? "Platinum" : /credit/i.test(alt) ? "Credits" : /aya/i.test(alt) ? "Aya" : ""; return c ? ` ${c} ` : " "; })
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\[edit[^\]]*\]/gi, "").replace(/\s+/g, " ").trim()
    .replace(/\b(Credits|Ducats|Platinum|Aya) (\d[\d,.]*)\b(?! (?:Credits|Ducats|Platinum|Aya)\b)/g, "$2 $1") // "Credits 625,000" -> "625,000 Credits"
    .replace(/(\d[\d,.]*) (Credits|Ducats|Platinum|Aya) \1\b/g, "$1 $2")       // "625,000 Credits 625,000"
    .replace(/(\d[\d,.]*) \1\b/g, "$1")                                         // "675 675"
    .replace(/(\d[\d,.]*) (Credits|Ducats|Platinum|Aya) \2\b/g, "$1 $2");
}
async function wikiAcquisition(name) {
  const page = encodeURIComponent(name.replace(/ /g, "_"));
  const base = `${WIKI_API}?action=parse&page=${page}&format=json&formatversion=2&redirects=1`;
  try {
    const sj = await get(`${base}&prop=sections`);
    if (sj.error) { acqWhy[name] = `api error ${sj.error.code}`; return null; }
    const secs = (sj.parse && sj.parse.sections) || [];
    const sec = secs.find(x => /^acquisition$/i.test(strip(String(x.line || "")))) || secs.find(x => strip(String(x.line || "")).toLowerCase() === name.toLowerCase());
    if (!sec) { acqWhy[name] = `no Acquisition section (sections: ${((sj.parse && sj.parse.sections) || []).map(x => x.line).join("/").slice(0, 120)})`; return null; }
    const clean0 = h => htmlPlain(h).replace(/^Acquisition\s*/i, "").replace(/(\s*[·|]\s*)+/g, m => m.includes("|") ? ". " : ", ").replace(/^[,. ]+/, "");
    const clean = h => { const i = h.search(/<table/i); const pre = i > 0 ? clean0(h.slice(0, i)) : ""; return pre.length >= 40 ? pre : clean0(h); };
    let html = "", plain = "";
    if (/^\d+$/.test(String(sec.index))) {
      const tj = await get(`${base}&prop=text&section=${sec.index}&disablelimitreport=1&disableeditsection=1`);
      html = (tj.parse && tj.parse.text) || ""; plain = clean(html);
    }
    if (plain.length < 20) {
      // Template-made sections can't be rendered alone: cut the section out of the full page
      const fj = await get(`${base}&prop=text&disablelimitreport=1&disableeditsection=1`);
      const full = (fj.parse && fj.parse.text) || "";
      const anchor = sec.anchor || String(sec.line).replace(/ /g, "_");
      const at = full.search(new RegExp(`id="${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
      if (at >= 0) {
        const after = full.slice(at);
        const stop = after.slice(10).search(new RegExp(`<h${sec.level || 2}[\\s>]`, "i"));
        html = stop >= 0 ? after.slice(0, stop + 10) : after.slice(0, 20000);
        plain = clean(html.replace(/^[^>]*>/, "").replace(/^[\s\S]*?<\/h\d>/i, ""));
      }
    }
    if (plain.length < 20) { acqWhy[name] = `section text too short (index ${sec.index}); html starts: ${html.replace(/\s+/g, " ").slice(0, 400)}`; return null; }
    const sentences = plain.match(/[^.!?]+[.!?]+(\s|$)/g) || [plain];
    let out = "";
    for (const x of sentences) { if ((out + x).length > 260 && out) break; out += x; }
    return out.trim();
  } catch (e) { acqWhy[name] = e.message; return null; }
}
function labelFromId(itemName, seg) {
  const compact = itemName.replace(/[^A-Za-z0-9]/g, "");
  let rest = seg.toLowerCase().startsWith(compact.toLowerCase()) ? seg.slice(compact.length) : null;
  if (rest == null) {
    if (/Blueprint$/.test(seg)) return "Blueprint";
    rest = seg.replace(/Prime/g, "");
  }
  rest = rest.replace(/Component$/, "").replace(/Helmet/, "Neuroptics");
  const words = rest.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words || "Blueprint";
}

/* ---------- WARFRAME Wiki: the full Prime list, to catch items WFCD hasn't added yet ---------- */
async function wikiPrimeList() {
  const names = new Set();
  for (const cat of ["Prime", "Primes", "Prime Weapons", "Prime Warframes", "Prime Companions"]) {
    let cont = "";
    for (let page = 0; page < 10; page++) {
      try {
        const j = await get(`${WIKI_API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent("Category:" + cat)}&cmnamespace=0&cmlimit=500&format=json&formatversion=2${cont}`);
        for (const m of (j.query && j.query.categorymembers) || []) {
          const t = String(m.title).replace(/^(.+)\/Prime$/, "$1 Prime");
          if (/(^| )Prime( |$)/.test(t) && !/\//.test(t)) names.add(t);
        }
        if (!j.continue || !j.continue.cmcontinue) break;
        cont = `&cmcontinue=${encodeURIComponent(j.continue.cmcontinue)}`;
      } catch (e) { break; }
    }
  }
  return names;
}
async function wikiCategories(name) {
  const tries = [name.replace(/ /g, "_"), name.replace(/ Prime$/, "/Prime").replace(/ /g, "_")];
  for (const t of tries) {
    try {
      const j = await get(`${WIKI_API}?action=parse&page=${encodeURIComponent(t)}&prop=categories&format=json&formatversion=2&redirects=1`);
      if (j.parse) return { title: j.parse.title, cats: (j.parse.categories || []).map(c => String(c.category).replace(/_/g, " ")) };
    } catch (e) {}
  }
  return null;
}
function classify(cats) {
  const c = cats.join(" | ");
  if (/Exalted/i.test(c)) return null; // ability weapons like Regulators Prime aren't built
  if (/Cosmetic|Syandana|Armor|Skin|Glyph|Sigil|Decoration|Ephemera|Accessor|Prime Access|Resurgence|Vault|Relic|Mod\b|Event|Quest|Character|Lore|Disambiguation/i.test(c) && !/Weapons|Warframes|Sentinels|Companions/i.test(c)) return null;
  if (/Arch-?Gun/i.test(c)) return ["archgun", "Arch-gun", true];
  if (/Arch-?Melee/i.test(c)) return ["archmelee", "Arch-melee", true];
  if (/Sentinel Weapons|Robotic Weapons|Companion Weapons/i.test(c)) return ["companions", "Companion weapon", true];
  if (/Archwing/i.test(c)) return ["archwing", "Archwing", false];
  if (/Sentinels|Companions|Kubrow|Kavat|Collar/i.test(c)) return ["companions", "Companion", false];
  if (/Primary Weapons/i.test(c)) return ["weapons", "Primary", true];
  if (/Secondary Weapons/i.test(c)) return ["weapons", "Secondary", true];
  if (/Melee Weapons/i.test(c)) return ["weapons", "Melee", true];
  if (/Warframes/i.test(c)) return ["warframes", "Warframe", false];
  return null;
}

/* ---------- build ---------- */
async function build() {
  const overrides = await readJSON(OVERRIDES, {});
  const lists = {};
  const CORE = new Set(["Primary", "Secondary", "Melee", "Warframes"]);
  for (const [f] of FILES) {
    try { lists[f] = await wfcd(f); }
    catch (e) { if (CORE.has(f)) throw e; warn(`${e.message}; skipping that category`); lists[f] = []; }
  }
  const mods = await wfcd("Mods").catch(e => { log("Mods.json failed:", e.message); return []; });
  const relicList = await wfcd("Relics").catch(e => { log("Relics.json failed:", e.message); return []; });
  note(`WFCD lists: ${Object.entries(lists).map(([k, v]) => `${k}=${v.length}`).join(", ")}, Mods=${mods.length}, Relics=${relicList.length}`);

  let drops = { missions: [], relicItems: {} };
  for (const u of DROP_TABLE_URLS) {
    try { drops = parseDropTables(await get(u, "text")); if (drops.missions.length) break; } catch (e) { log("drop tables", u, "failed:", e.message); }
  }
  const dropsOk = drops.missions.length > 200;
  (dropsOk ? note : warn)(`DE drop tables: ${drops.missions.length} mission relic rows, ${Object.keys(drops.relicItems).length} relic reward names${dropsOk ? "" : " (too few, vault status falls back to WFCD)"}`);

  const wikiInc = await wikiIncarnons();
  (wikiInc.size ? note : warn)(`Wiki Incarnon Genesis names found: ${wikiInc.size}`);
  const incBase = new Set([...wikiInc, ...(overrides.incarnonBases || [])]);
  for (const list of Object.values(lists)) for (const x of list) if (/ Incarnon Genesis$/.test(x.name || "")) incBase.add(x.name.replace(/ Incarnon Genesis$/, ""));

  // every weapon by name, for variants
  const weaponsByName = {};
  for (const [f, , , isW] of FILES) if (isW) for (const x of lists[f]) if (x.name && !weaponsByName[x.name]) weaponsByName[x.name] = x;

  // pass 1: Prime items with relic-dropping parts
  const seen = new Set(), raw = [], notMasterable = [];
  for (const [f, cat, slot, isW] of FILES) {
    for (const x of lists[f]) {
      const name = x.name || "";
      if (seen.has(name) || !/(^| )Prime( |$)/.test(name) || !Array.isArray(x.components)) continue;
      seen.add(name);
      if ((overrides.exclude || []).includes(name)) continue;
      if (x.masterable === false) { notMasterable.push(name); continue; } // the app tracks mastery, so these don't belong
      raw.push({ x, cat, slot, isW });
    }
  }
  if (notMasterable.length) note(`Left out as not masterable: ${notMasterable.join(", ").slice(0, 1500)}`);
  const primeNames = new Set(raw.map(r => r.x.name));
  const primeByUnique = Object.fromEntries(raw.filter(r => r.x.uniqueName).map(r => [r.x.uniqueName, r.x.name]));

  /* Relic contents: WFCD Relics.json (every relic, vaulted ones too), then DE's tables */
  const rewardRelics = {}, rewardByUnique = {};
  const addReward = (name, relic, rar) => {
    const l = rewardRelics[name] || (rewardRelics[name] = []);
    if (!l.some(x => x[0] === relic)) l.push([relic, rar]);
  };
  for (const r of relicList) {
    const rn = relicName(r.name);
    if (!rn || !/Intact$/.test(r.name || "")) continue;
    for (const w of r.rewards || []) {
      const nm = w.item && w.item.name; if (!nm) continue;
      addReward(nm, rn, RARMAP[w.rarity] || rarOf({ chance: (w.chance || 0) / 100 }));
      if (w.item.uniqueName) rewardByUnique[w.item.uniqueName] = nm;
    }
  }
  for (const [nm, l] of Object.entries(drops.relicItems)) for (const [rn, rar] of l) addReward(nm, rn, rar);
  // each reward name belongs to the Prime item with the longest matching name
  const byLen = [...primeNames].sort((a, b) => b.length - a.length);
  const ownParts = {};
  for (const nm of Object.keys(rewardRelics)) {
    const owner = byLen.find(n => nm.startsWith(n + " "));
    if (owner) (ownParts[owner] = ownParts[owner] || []).push(nm);
  }
  const norm = t => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ALIAS = [[/helmet/g, "neuroptics"], [/component$/, ""], [/blueprint$/, ""]];
  const key = t => ALIAS.reduce((v, [re, to]) => v.replace(re, to), norm(t));
  let unmatched = 0, guessed = 0; const unmatchedIds = [], guessedNames = [], otherPrimes = [];

  const items = [];
  for (const { x, cat, slot, isW } of raw) {
    const req = new Map(), counts = new Map(), order = [], otherIds = [];
    const mine = ownParts[x.name] || [];
    const byKey = Object.fromEntries(mine.map(nm => [key(nm), nm]));
    // second chance: drop the item's own words and compare what's left ("PrimeDualKamasBlade" -> "blade")
    const words = x.name.split(/\s+/).map(norm);
    const resid = t => { let v = norm(t); for (const w of words) v = v.replace(w, ""); return ALIAS.reduce((q, [re, to]) => q.replace(re, to), v); };
    const byResid = Object.fromEntries(mine.map(nm => [resid(nm), nm]));
    for (const c of x.components) {
      const un = c.uniqueName || "";
      if (primeByUnique[un] && primeByUnique[un] !== x.name) {
        const n = primeByUnique[un]; req.set(n, (req.get(n) || 0) + (c.itemCount || 1)); continue;
      }
      if (c.name && primeNames.has(c.name) && c.name !== x.name) { req.set(c.name, (req.get(c.name) || 0) + (c.itemCount || 1)); continue; }
      let full = rewardByUnique[un] && rewardByUnique[un].startsWith(x.name + " ") ? rewardByUnique[un] : null;
      if (!full) full = byKey[key(un.split("/").pop() || "")] || null;
      if (!full && c.name) full = byKey[key(`${x.name} ${c.name}`)] || null;
      if (!full) { const rk = resid(un.split("/").pop() || ""); if (rk) full = byResid[rk] || null; }
      if (!full) {
        if (/Recipes\//.test(un)) { unmatched++; unmatchedIds.push(`${x.name}: ${un.split("/").pop()}`); otherIds.push([un.split("/").pop(), c.itemCount || 1]); }
        continue; // resources like Orokin Cells
      }
      if (!counts.has(full)) order.push(full);
      counts.set(full, (counts.get(full) || 0) + (c.itemCount || 1));
    }
    for (const nm of mine) if (!counts.has(nm)) { order.push(nm); counts.set(nm, 1); guessed++; guessedNames.push(nm); }
    order.sort((a, b) => (/ Blueprint$/.test(a) && a === `${x.name} Blueprint` ? -1 : 0) - (/ Blueprint$/.test(b) && b === `${x.name} Blueprint` ? -1 : 0));
    const parts = order.map(full => ({
      p: full.slice(x.name.length + 1), full, c: counts.get(full),
      r: rewardRelics[full].slice().sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })),
    }));
    const reqList = [...req.entries()].map(([n, c]) => ({ n, c }));
    let viaOther = false;
    if (!parts.length) {
      // Not from relics (e.g. Perita Rebellion Primes). Founders items stay out.
      if (!otherIds.length || (overrides.exclude || []).includes(x.name)) continue;
      const seenLbl = new Map();
      for (const [seg, n] of otherIds) { const l = labelFromId(x.name, seg); seenLbl.set(l, (seenLbl.get(l) || 0) + n); }
      [...seenLbl.entries()].sort((a, b) => (a[0] === "Blueprint" ? -1 : 0) - (b[0] === "Blueprint" ? -1 : 0))
        .forEach(([l, n]) => parts.push({ p: l, full: l === "Blueprint" ? `${x.name} Blueprint` : `${x.name} ${l}`, c: n, r: [] }));
      viaOther = true;
    }
    const base = x.name.replace(/ Prime$/, "");
    const it = { id: slug(x.name), n: x.name, cat, slot };
    if (x.vaulted != null) it.vaulted = !!x.vaulted;
    if (x.buildTime > 0) it.bt = Math.round(x.buildTime / 360) / 10; // Foundry build time, hours
    it.parts = parts;
    if (reqList.length) it.req = reqList;
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
    if (viaOther) {
      it.src = "other";
      it.get = await wikiAcquisition(x.name) || "Doesn't come from relics. See the wiki for how to get it.";
      otherPrimes.push(`${x.name}: ${it.get}`);
    }
    const ov = (overrides.items || {})[x.name];
    if (ov) Object.assign(it, ov);
    items.push(it);
  }
  // Cross-check against the wiki's own Prime list: add anything WFCD is missing
  {
    const wikiPrimes = await wikiPrimeList();
    if (!wikiPrimes.size) warn("Wiki Prime list came back empty; skipping the cross-check");
    const have = new Set(items.map(i => i.n)), added = [], skipped = [];
    const todo = [...wikiPrimes].filter(n => !have.has(n) && !notMasterable.includes(n) && !(overrides.exclude || []).includes(n)).sort().slice(0, 60);
    for (const n of todo) {
      const wc = await wikiCategories(n);
      const cl = wc && classify(wc.cats);
      if (!cl) { skipped.push(n); continue; }
      const [cat, slot, isW] = cl;
      const mine = Object.keys(rewardRelics).filter(nm => nm.startsWith(n + " ") && !byLen.some(o => o.length > n.length && o.startsWith(n + " ") && nm.startsWith(o + " ")));
      const parts = mine.sort((a, b) => (a === `${n} Blueprint` ? -1 : 0) - (b === `${n} Blueprint` ? -1 : 0)).map(full => ({
        p: full.slice(n.length + 1), full, c: 1, r: rewardRelics[full].slice().sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })),
      }));
      const it = { id: slug(n), n, cat, slot, parts, wiki: `https://wiki.warframe.com/w/${encodeURIComponent((wc.title || n).replace(/ /g, "_"))}`, fromWiki: 1 };
      if (!parts.length) {
        it.parts = [{ p: "Blueprint", full: `${n} Blueprint`, c: 1, r: [] }];
        it.src = "other";
        it.get = await wikiAcquisition(wc.title || n) || "Doesn't come from relics. See the wiki for how to get it.";
      }
      if (isW) { it.w = 1; it.inc = incBase.has(n.replace(/ Prime$/, "")) ? { g: `${n.replace(/ Prime$/, "")} Incarnon Genesis`, src: "the Steel Path Circuit (Duviri)" } : null; }
      const ov = (overrides.items || {})[n];
      if (ov) Object.assign(it, ov);
      items.push(it);
      added.push(`${n} [${slot}; ${parts.length ? parts.length + " relic parts" : "not from relics"}]`);
    }
    if (wikiPrimes.size) note(`Wiki cross-check: ${wikiPrimes.size} Prime pages; added ${added.length}: ${added.join(", ").slice(0, 1800)}`);
    if (skipped.length) note(`Wiki Primes skipped as not gear: ${skipped.join(", ").slice(0, 1500)}`);
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
  note(`Built ${counts.items} items (${counts.frames} Warframes), ${counts.relics} relics; ${unmatched} part IDs unmatched, ${guessed} parts with a guessed count of 1`);
  if (otherPrimes.length) note(`Non-relic Primes (${otherPrimes.length}): ${otherPrimes.join(" || ").slice(0, 3500)}`);
  if (Object.keys(acqWhy).length) warn(`Wiki how-to-get lookup failed: ${Object.entries(acqWhy).map(([k, v]) => `${k}: ${v}`).join(" || ").slice(0, 1500)}`);
  if (unmatchedIds.length) warn(`Unmatched part IDs: ${unmatchedIds.join("; ")}`);
  if (guessedNames.length) warn(`Guessed count of 1: ${guessedNames.join("; ")}`);
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
    fail(e.message);
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

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { fail(e.stack || e.message); process.exit(1); });
