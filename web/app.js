/* Warframe Relic Companion — app logic.
   Plain JavaScript, no build step. Runs inside the Android WebView shell, or in
   any browser for testing. Layout and card markup follow legacy/prime-checklist.html. */
"use strict";

/* ---------- CONFIG ---------- */
const DATA_URL = "https://raw.githubusercontent.com/LowBudgetAtheon/warframe-relic-companion/main/data/relics.json";
const WS = "https://api.warframestat.us/pc";
const WS_RAW = "https://content.warframe.com/dynamic/worldState.php";
const KEY_STATE = "wrc-state-v1", KEY_DATA = "wrc-data-v1", KEY_LIVE = "wrc-live-v1";
const SCHEMA = 1;
const TRADE_LIMIT = 170;
const LIVE_REFRESH_MS = 5 * 60 * 1000;
const EDGE_PX = 16;
const PAGE_MAIN = 3;

const THEMES = [
  ["orokin-dark", "Orokin Dark", ["#0b0f14", "#d9b44a", "#4fd1c5"]],
  ["orokin-light", "Orokin Light", ["#f3eee2", "#b38b2d", "#2a8c83"]],
  ["grineer", "Grineer", ["#1b1311", "#c4452f", "#98a3ad"]],
  ["corpus", "Corpus", ["#0f1a2b", "#4aa8ff", "#f2f7fd"]],
  ["infested", "Infested", ["#131a0f", "#a6c93a", "#c95f80"]],
  ["void", "Void", ["#04080a", "#7ef2d8", "#cbfff2"]],
  ["sentient", "Sentient", ["#1e1915", "#e0cdb0", "#a57d4b"]],
  ["duviri", "Duviri", ["#e8d9b8", "#b23b24", "#c66b23"]],
];
const LIGHT_THEMES = new Set(["orokin-light", "duviri", "sd-spring"]);
const SHOW_SWITCHES = [
  ["mods", "Unique mods"],
  ["chances", "Drop chances"],
  ["vaulted", "Vaulted relic lists"],
  ["resurgence", "Prime Resurgence notes"],
  ["variants", "Variant info"],
  ["oracle", "Oracle text"],
  ["tips", "Item notes"],
  ["get", "Acquisition source"],
  ["whatsnew", "What's new pop-up"],
];
const START_PAGES = [[0, "Rotating"], [1, "Relic Runs"], [2, "Favorites"], [3, "Main"]];
const CATS = [
  ["all", "All"], ["warframes", "Warframes"], ["weapons", "Weapons"], ["vehicles", "Vehicles"], ["archweapons", "Arch-weapons"],
  ["companions", "Companions"], ["modweapons", "Modular weapons"], ["modcompanions", "Modular companions"], ["amps", "Amps"], ["tauron", "Tauron Strikes"],
];
const CAT_LABEL = Object.fromEntries(CATS);
const CAT_INTRO = {
  all: "Everything that counts toward mastery. Base holds the regular versions and their variants; Prime holds every Prime set. Tap a star to add something to Favorites.",
  warframes: "Every Warframe. Tap a card's parts as you collect them, then Mastered once it's rank 30.",
  weapons: "Primary, Secondary and Melee weapons. Variants like MK1, Vandal, Wraith and Kuva sit in their base weapon's card.",
  vehicles: "Archwings, Necramechs and K-Drives.",
  archweapons: "Arch-guns and Arch-melee, used with your Archwing and Necramech.",
  companions: "Sentinels and their weapons, Kubrows and Kavats.",
  modweapons: "Zaws from Cetus and Kitguns from Fortuna and the Necralisk. Only one piece of each counts for mastery.",
  modcompanions: "Hounds, MOAs, Predasites and Vulpaphylas, built from parts. Only one piece of each counts for mastery.",
  amps: "Operator Amps, built from parts at Cetus and Fortuna, plus the Drifter's Sirocco.",
  tauron: "The five Tektolyst Artifacts and their Tauron Strikes. These don't count toward mastery; the ticks are just for your collection.",
};
const MG_LINE = { base: "Regular versions of everything that gives mastery, with their variants in the same card.", prime: "Every Prime set, with the relics that drop its parts." };
const PRIME_CAT = { archgun: "archweapons", archmelee: "archweapons", archwing: "vehicles" };
const SLOTTED = new Set(["weapons", "archweapons"]); // slots become their own dropdowns
const SLOT_ORDER = ["Primary", "Secondary", "Melee", "Arch-gun", "Arch-melee", "Archwing", "Necramech", "K-Drive", "Sentinel", "Sentinel weapon", "Kubrows", "Kavats", "Zaws", "Kitguns", "Amps", "Sirocco"];
const TIER_ORDER = { Lith: 0, Meso: 1, Neo: 2, Axi: 3, Requiem: 4, Omnia: 5 };
const RAR = { C: "Common", U: "Uncommon", R: "Rare" };
const RAR_ORDER = { R: 0, U: 1, C: 2 };
const RAR_CHANCE = { C: "25.3% → 16.7%", U: "11% → 20%", R: "2% → 10%" };
const DEFAULT_SETTINGS = {
  theme: "orokin-dark", farm: "both", mainSort: "type", collapsed: {}, mainOpen: {}, runsOpen: {}, rotOpen: {}, hideVend: {},
  show: { mods: true, chances: true, vaulted: true, resurgence: true, variants: true, oracle: true, tips: true, get: true, whatsnew: true },
  reduceMotion: false, compact: false, textSize: 100, startPage: 3, fissMode: "normal",
};
const native = window.WRC || null; // Android bridge, absent in a normal browser

/* ---------- SMALL HELPERS ---------- */
const $ = s => document.querySelector(s);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tierOf = r => r.split(" ")[0];
const relicSort = (a, b) => (TIER_ORDER[tierOf(a)] ?? 9) - (TIER_ORDER[tierOf(b)] ?? 9) || a.localeCompare(b, undefined, { numeric: true });
const pct = n => (n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.?0+$/, "") + "%";
function ago(ms) {
  if (!ms) return "never";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  const d = Math.floor(s / 86400);
  return d + (d === 1 ? " day ago" : " days ago");
}
function left(ms) {
  let s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
const until = ms => `<span data-until="${ms}">${left(ms)}</span>`;
function fmtDate(ms) {
  try { return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return ""; }
}

/* ---------- SAVED STATE (per device) ---------- */
function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY_STATE) || "null"); } catch (e) { s = null; }
  return normaliseState(s);
}
function normaliseState(s) {
  s = s && typeof s === "object" ? s : {};
  const st = s.settings || {};
  return {
    ticks: s.ticks || {}, stars: s.stars || {}, mastered: s.mastered || {}, alerts: s.alerts || {},
    hvMin: !!s.hvMin, secrets: s.secrets || {}, banners: s.banners || {}, unlocked: s.unlocked || {}, weekly: { t: (s.weekly || {}).t || {}, c: (s.weekly || {}).c || [] },
    relicCounts: s.relicCounts || {}, partCounts: s.partCounts || {}, scanAt: s.scanAt || {}, hvOwned: !!s.hvOwned,
    building: s.building || {}, built: s.built || {}, scanFiles: s.scanFiles || {}, tourDone: !!s.tourDone, newsSeen: s.newsSeen || "",
    settings: { ...DEFAULT_SETTINGS, ...st, collapsed: { ...(st.collapsed || {}) }, mainOpen: { ...(st.mainOpen || {}) }, runsOpen: { ...(st.runsOpen || {}) }, rotOpen: { ...(st.rotOpen || {}) }, hideVend: { ...(st.hideVend || {}) }, show: { ...DEFAULT_SETTINGS.show, ...(st.show || {}) } },
  };
}
let state = loadState();
const S = () => state.settings;
function save() { try { localStorage.setItem(KEY_STATE, JSON.stringify(state)); } catch (e) {} }

/* ---------- DATA ---------- */
let DATA = { items: [], relics: {} }, DATA_AT = 0, DATA_SRC = "none", DATA_OFFLINE = false;
let ITEMS = [], BASE = [], ALL = [], GROUPS = {}, BYNAME = {}, BYID = {}; // ITEMS = Primes, BASE = everything else
function setData(d, at, src) {
  DATA = d; DATA_AT = at || 0; DATA_SRC = src;
  const byN = (a, b) => a.n.localeCompare(b.n);
  ITEMS = (d.items || []).slice().sort(byN);
  ITEMS.forEach(it => { if (PRIME_CAT[it.cat]) it.cat = PRIME_CAT[it.cat]; });
  BASE = (d.base || []).slice().sort(byN);
  GROUPS = d.groups || {};
  ALL = ITEMS.concat(BASE);
  BYNAME = {}; BYID = {};
  ALL.forEach(it => { delete it._units; if (!BYNAME[it.n]) BYNAME[it.n] = it; BYID[it.id] = it; });
}
const counts = it => it.k !== "t"; // Tauron Strikes don't count toward mastery
const grpItems = gid => BASE.filter(i => i.grp === gid);
const relicInfo = r => (DATA.relics || {})[r] || {};

let LIVE = null, LIVE_AT = 0, LIVE_OFFLINE = false;

/* ---------- CHECKBOX UNITS ----------
   Each checkbox is one "unit". An item's own parts come first, then one group per
   required weapon (e.g. "Vasto Prime #1"), each with that weapon's own parts. */
function unitsOf(it) {
  if (it._units) return it._units;
  const out = [];
  if (it.k === "m") return (it._units = []); // modular piece: its one tick is Mastered
  if (it.k === "t" || it.own) out.push({ id: slug(`${it.n}|own|1`), label: it.k === "t" ? "Collected" : "Owned", full: it.n, i: 1, c: 1, group: null, r: [], own: 1 });
  const add = (grp, p) => {
    for (let i = 1; i <= (p.c || 1); i++)
      out.push({ id: slug(`${it.n}|${grp || ""}|${p.p}|${i}`), label: p.p, full: p.full, i, c: p.c || 1, group: grp, r: p.r || [] });
  };
  (it.parts || []).forEach(p => add(null, p));
  (it.req || []).forEach(rq => {
    const sub = BYNAME[rq.n];
    for (let k = 1; k <= rq.c; k++) {
      const g = rq.c > 1 ? `${rq.n} #${k}` : rq.n;
      if (sub && sub.parts && sub.parts.length) sub.parts.forEach(p => add(g, p));
      else out.push({ id: slug(`${it.n}|${g}|built|1`), label: `${rq.n} (built)`, full: rq.n, i: 1, c: 1, group: g, r: [], whole: true });
    }
  });
  it._units = out;
  return out;
}
const isTicked = u => !!state.ticks[u.id];
function progress(it) {
  const u = unitsOf(it);
  return { n: u.length, g: u.filter(isTicked).length };
}
/* Missing parts for one item, merged by full name: [{full, n, r}] */
function missing(it) {
  const m = new Map();
  unitsOf(it).forEach(u => {
    if (isTicked(u) || u.whole) return;
    const e = m.get(u.full) || { full: u.full, n: 0, r: u.r };
    e.n++; m.set(u.full, e);
  });
  return [...m.values()];
}
/* Every distinct part of an item, with how many are still needed */
function allParts(it) {
  const m = new Map();
  unitsOf(it).forEach(u => {
    if (u.whole) return;
    const e = m.get(u.full) || { full: u.full, n: 0, total: 0, r: u.r };
    e.total++; if (!isTicked(u)) e.n++; m.set(u.full, e);
  });
  return [...m.values()];
}
const starred = () => ITEMS.filter(it => state.stars[it.id]);
const active = it => !state.mastered[it.id];

/* ---------- FOUNDRY BUILDS ----------
   building[id] = {e: end time, n: name}; built[id] = claimed from the Foundry, waiting to be mastered. */
const BUILD_H = { warframes: 72, archwing: 72 };
const buildHours = it => it.bt || BUILD_H[it.cat] || 12;
const isComplete = it => { const { n, g } = progress(it); return n > 0 && g === n; };
const buildable = it => !it.own && !it.k && (it.parts || []).length > 0;
const readyToBuild = it => buildable(it) && active(it) && isComplete(it) && !state.building[it.id] && !state.built[it.id];
function buildTag(it) {
  const b = state.building[it.id]; if (!b) return "";
  return `<span class="btag">Building <em>${b.e > Date.now() ? until(b.e) : "done"}</em></span>`;
}
function clearBuild(id) { delete state.building[id]; delete state.built[id]; }
const ownRel = r => { const n = (state.relicCounts || {})[r]; return n ? `<span class="own" title="You have ${n}">×${n}</span>` : ""; };

/* ---------- RELIC STATUS (data + live vendors) ---------- */
const RELIC_RE = /^(Lith|Meso|Neo|Axi)\s+([A-Z]\d+)\b/;
function liveRelicSet(list) {
  const s = new Set();
  (list || []).forEach(x => { const m = RELIC_RE.exec(x.n || ""); if (m) s.add(`${m[1]} ${m[2]}`); });
  return s;
}
let BARO_SET = new Set(), VARZIA_SET = new Set();
function refreshLiveSets() {
  const now = Date.now();
  BARO_SET = LIVE && LIVE.baro && LIVE.baro.active && LIVE.baro.expiry > now ? liveRelicSet(LIVE.baro.inventory) : new Set();
  VARZIA_SET = LIVE && LIVE.varzia && (!LIVE.varzia.expiry || LIVE.varzia.expiry > now) ? liveRelicSet(LIVE.varzia.inventory) : new Set();
}
/* av = drops in missions now, ba = Baro has it, rs = Varzia has it, va = vaulted */
function relicStatus(r) {
  const info = relicInfo(r);
  if (!info.v) return "av";
  if (BARO_SET.has(r)) return "ba";
  if (VARZIA_SET.has(r)) return "rs";
  if (info.b) return "ba-off";
  return "va";
}
const obtainable = r => { const s = relicStatus(r); return s === "av" || s === "ba"; };
function statusLabel(r) {
  return { av: "Available now", ba: "Baro Ki'Teer", rs: "Prime Resurgence", "ba-off": "Baro Ki'Teer only", va: "Vaulted" }[relicStatus(r)];
}
const stCls = r => ({ av: "av", ba: "ba", rs: "ba", "ba-off": "va", va: "va" }[relicStatus(r)]);
function resurgenceFrames(r) {
  const fr = (relicInfo(r).it || []).filter(n => BYNAME[n] && BYNAME[n].cat === "warframes");
  if (fr.length) return fr;
  return LIVE && LIVE.varzia ? (LIVE.varzia.inventory || []).map(x => x.n).filter(n => BYNAME[n] && BYNAME[n].cat === "warframes") : [];
}

/* ---------- FARM TEXT ---------- */
function community(r) {
  const c = DATA.community || {};
  return (c.relics || {})[r] || (c.tiers || {})[tierOf(r)] || null;
}
function farmSpot(f, withChance) {
  if (!f) return null;
  let s = `<b>${esc(f.n)}</b>${f.p ? `, ${esc(f.p)}` : ""}${f.t ? ` (${esc(f.t)})` : ""}`;
  if (f.r) s += ` · Rot ${esc(f.r)}`;
  if (withChance && typeof f.c === "number") s += ` · ${pct(f.c)}`;
  if (f.note) s += ` · ${esc(f.note)}`;
  return s;
}
function farmHTML(r) {
  const st = relicStatus(r);
  if (st === "ba") return `<div class="farm"><span class="src">Now</span><b>Baro Ki'Teer</b> has it in stock</div>`;
  if (st !== "av") return "";
  const mode = S().farm, ch = S().show.chances;
  const bf = relicInfo(r).bf, cm = community(r);
  const rates = farmSpot(bf, ch) || "Not in DE's mission drop tables";
  const comm = farmSpot(cm, false) || "No community pick yet";
  const line = (k, v) => `<div class="farm"><span class="src">${k}</span>${v}</div>`;
  if (mode === "rates") return line("By the Rates", rates);
  if (mode === "community") return line("Community", comm);
  if (bf && cm && bf.n === cm.n && (bf.p || "") === (cm.p || "")) return line("Both agree", rates);
  return line("By the Rates", rates) + line("Community", comm);
}

/* ---------- VAULT WATCH ---------- */
function itemRelics(it, onlyMissing) {
  const s = new Set();
  (onlyMissing ? missing(it) : allParts(it)).forEach(p => p.r.forEach(([r]) => s.add(r)));
  return s;
}
function alertsFor(it) {
  if (!state.stars[it.id] || !active(it)) return [];
  const out = [], now = Date.now();
  const mine = itemRelics(it, true);
  (DATA.vaultWatch || []).forEach(w => {
    const hit = (w.items || []).includes(it.n) || (w.relics || []).some(r => mine.has(r));
    if (!hit) return;
    const end = Date.parse(w.until || w.date || "");
    if (end && end < now) return;
    const resur = w.type === "resurgence";
    out.push({
      id: `${w.id || w.type}|${it.id}`, type: w.type,
      title: w.title || (resur ? "Coming back in Prime Resurgence" : "Relics may be vaulted soon"),
      text: w.note || (resur ? "This item's relics are due back through Prime Resurgence." : "Farm these relics before they leave the drop tables."),
      end,
    });
  });
  const hits = [...mine].filter(r => VARZIA_SET.has(r) && relicInfo(r).v).sort(relicSort);
  if (hits.length) {
    const end = LIVE.varzia.expiry || 0;
    const fr = [...new Set(hits.flatMap(resurgenceFrames))];
    out.push({
      id: `rs-live|${it.id}|${end}`, type: "resurgence", title: "Back in Prime Resurgence now",
      text: `Varzia is selling ${hits.join(", ")}${fr.length ? `, alongside ${fr.join(" and ")}` : ""}. They vault again when this rotation ends.`,
      end,
    });
  }
  return out;
}
function vwHTML(it) {
  const a = alertsFor(it);
  if (!a.length) return "";
  const pulse = a.some(x => !state.alerts[x.id]);
  return `<button class="vw${pulse ? " pulse" : ""}" data-vw="${it.id}" aria-label="Vault Watch">!</button>`;
}

/* ---------- ITEM CARD ---------- */
const expanded = new Set();
function cardHTML(it) {
  const { n, g } = progress(it);
  const isM = !!state.mastered[it.id], done = g === n && n > 0;
  const cls = `card${isM ? " built" : ""}${done && !isM ? " complete" : ""}${expanded.has(it.id) ? " open" : ""}`;
  let h = `<article class="${cls}" data-item="${it.id}"><div class="chead" data-exp="${it.id}">
    <div class="ctop"><div class="name">${esc(it.n)}</div>${vwHTML(it)}<button class="star${state.stars[it.id] ? " on" : ""}" data-star="${it.id}" aria-label="Star">${state.stars[it.id] ? "★" : "☆"}</button></div>
    <div class="meta"><span class="tag">${esc(it.slot || CAT_LABEL[it.cat] || "Prime")}</span>${buildTag(it)}<span class="cnt">${cntText(it)}</span></div>
    <div class="cbar"><i style="width:${isM ? 100 : n ? 100 * g / n : 0}%"></i></div></div>${primeLink(it.prime)}${rtbHTML(it)}${unitsHTML(it)}`;
  if (it.note) h += `<div class="note tip">${esc(it.note)}</div>`;
  if (it.get) h += `<div class="note get"><b>How to get:</b> ${esc(it.get)}</div>`;
  const info = !it.b || it.wiki;
  if (info) h += `<div class="more${expanded.has(it.id) ? "" : " hidden"}">${expanded.has(it.id) ? moreHTML(it) : ""}</div>`;
  h += `<div class="cfoot"><button class="builtbtn" data-mastered="${it.id}">${isM ? "Mastered ✓" : "Mastered"}</button>${info ? `<button class="expbtn" data-exp="${it.id}">${expLabel(it)}</button>` : ""}</div></article>`;
  return h;
}
const expLabel = it => expanded.has(it.id) ? "Hide info ▴" : it.b ? "Info ▾" : "Relics & info ▾";
function unitsHTML(it) {
  let h = `<ul>`, open = null;
  unitsOf(it).forEach(u => {
    if (u.group !== open) {
      if (open) h += `</ul></details></li>`;
      if (u.group) h += `<li><details class="reqw" data-grp="${esc(u.group)}"><summary>${esc(u.group)}<span class="sub" data-gcnt></span></summary><ul>`;
      open = u.group;
    }
    const sub = u.c > 1 ? `<span class="sub">${u.i} of ${u.c}</span>` : "";
    h += `<li><label><input type="checkbox" data-u="${u.id}" data-it="${it.id}"${isTicked(u) ? " checked" : ""}><span>${esc(u.label)}</span>${sub}</label></li>`;
  });
  if (open) h += `</ul></details></li>`;
  return h + `</ul>`;
}
const primeLink = pn => { const p = pn && BYNAME[pn]; return p ? `<button class="plink" data-jump="${p.id}">${esc(pn)} is in the Prime list ›</button>` : ""; };
/* A card holding several Base items: variants (Braton, MK1-Braton, Braton Vandal), or one tick per
   modular piece (Zaw strikes), or Tauron Strikes. Each item inside keeps its own id and state. */
function grpCnt(gid) {
  const all = grpItems(gid), t = all.length && all[0].k === "t";
  const got = all.filter(i => t ? isTicked(unitsOf(i)[0]) : state.mastered[i.id]).length;
  return `${got} / ${all.length} ${t ? "collected" : "mastered"}`;
}
function vsubHTML(it) {
  const { n, g } = progress(it), isM = !!state.mastered[it.id];
  let h = `<div class="vsub${isM ? " built" : ""}" data-item="${it.id}"><div class="vhead"><b>${esc(it.n)}</b>${buildTag(it)}<span class="cnt">${cntText(it)}</span></div>
    <div class="cbar"><i style="width:${isM ? 100 : n ? 100 * g / n : 0}%"></i></div>${rtbHTML(it)}${unitsHTML(it)}`;
  if (it.note) h += `<div class="note tip">${esc(it.note)}</div>`;
  if (it.get) h += `<div class="note get"><b>How to get:</b> ${esc(it.get)}${it.wiki ? ` <a href="${esc(it.wiki)}" target="_blank" rel="noopener">Wiki ↗</a>` : ""}</div>`;
  return h + `<div class="cfoot"><button class="builtbtn" data-mastered="${it.id}">${isM ? "Mastered ✓" : "Mastered"}</button></div></div>`;
}
function mrowHTML(it) {
  const t = it.k === "t", u = t && unitsOf(it)[0], on = t ? isTicked(u) : !!state.mastered[it.id];
  const box = t ? `data-u="${u.id}" data-it="${it.id}"` : `data-m="${it.id}"`;
  return `<li class="mrow${on ? " on" : ""}" data-item="${it.id}"><label><input type="checkbox" ${box}${on ? " checked" : ""}><span>${esc(it.n)}</span></label>
    ${it.get ? `<details class="mget"><summary aria-label="How to get ${esc(it.n)}">How to get ▾</summary><div class="note get"><b>How to get:</b> ${esc(it.get)}${it.wiki ? ` <a href="${esc(it.wiki)}" target="_blank" rel="noopener">Wiki ↗</a>` : ""}</div></details>` : ""}</li>`;
}
function gcardHTML(e) {
  const g = e.g, gid = e.key;
  let h = `<article class="card gcard" data-grp="${gid}"><div class="chead" style="cursor:default"><div class="ctop"><div class="name">${esc(g.n)}</div>
    <button class="star${state.stars[gid] ? " on" : ""}" data-star="${gid}" aria-label="Star">${state.stars[gid] ? "★" : "☆"}</button></div>
    <div class="meta"><span class="tag">${esc(g.slot || CAT_LABEL[g.cat] || "")}</span><span class="cnt gcnt">${grpCnt(gid)}</span></div></div>`;
  if (g.note) h += `<p class="secsub gnote">${esc(g.note)}</p>`;
  h += primeLink(g.prime);
  if (g.kind === "var") h += e.items.map(vsubHTML).join("");
  else h += `<ul class="mrows">${e.items.map(mrowHTML).join("")}</ul>`;
  return h + `</article>`;
}
const rtbHTML = it => readyToBuild(it) ? `<div class="rtb"><span>Ready to build</span><button class="chip" data-build="${it.id}">Building</button></div>` : "";
function cntText(it) {
  const { n, g } = progress(it);
  if (state.mastered[it.id]) return "Mastered ✓";
  if (it.own || it.k === "t") return g ? `${it.k === "t" ? "Collected" : "Owned"} ✓` : "";
  if (state.building[it.id] || state.built[it.id]) return "All parts ✓";
  if (n && g === n) return `${g} / ${n} parts ✓`;
  return `${g} / ${n} parts`;
}
function groupCounts(card, it) {
  card.querySelectorAll("details.reqw").forEach(d => {
    const g = d.dataset.grp, us = unitsOf(it).filter(u => u.group === g);
    const got = us.filter(isTicked).length;
    d.querySelector("[data-gcnt]").textContent = `${got} / ${us.length}`;
    d.classList.toggle("reqdone", got === us.length);
  });
}
function refreshCards(itemId) {
  const it = BYID[itemId]; if (!it) return;
  document.querySelectorAll(`[data-item="${itemId}"]`).forEach(card => {
    const { n, g } = progress(it), isM = !!state.mastered[it.id];
    card.classList.toggle("complete", g === n && n > 0 && !isM);
    card.classList.toggle("built", isM);
    card.classList.toggle("on", card.classList.contains("mrow") && (it.k === "t" ? g > 0 : isM));
    const cnt = card.querySelector(".cnt"); if (cnt) cnt.textContent = cntText(it);
    const bar = card.querySelector(".cbar i"); if (bar) bar.style.width = (isM ? 100 : n ? 100 * g / n : 0) + "%";
    card.querySelectorAll("input[data-u]").forEach(i => { i.checked = !!state.ticks[i.dataset.u]; });
    card.querySelectorAll("input[data-m]").forEach(i => { i.checked = !!state.mastered[i.dataset.m]; });
    if (!card.classList.contains("card")) return;
    groupCounts(card, it);
    const more = card.querySelector(".more");
    if (expanded.has(it.id) && more) more.innerHTML = moreHTML(it);
    const old = card.querySelector(".vw"), nu = vwHTML(it);
    if (old) old.remove();
    if (nu) card.querySelector(".star").insertAdjacentHTML("beforebegin", nu);
  });
  if (it.grp) document.querySelectorAll(`[data-grp="${it.grp}"] .gcnt`).forEach(el => { el.textContent = grpCnt(it.grp); });
}

/* ---------- EXPANDED ITEM INFO ---------- */
function relRow(r, rar, kind) {
  const ch = S().show.chances ? `<span class="sub" style="margin-left:0">${RAR_CHANCE[rar] || ""}</span>` : "";
  let tag = "";
  if (kind === "va") tag = `<span class="vtag">Vaulted</span>`;
  else if (kind === "rs") {
    const fr = resurgenceFrames(r);
    tag = `<span class="rtag">Prime Resurgence</span>${fr.length ? `<span class="sub" style="margin-left:0">back with ${esc(fr.join(", "))}</span>` : ""}`;
  } else if (kind === "ba-off") tag = `<span class="vtag">Baro Ki'Teer only</span>`;
  return `<div class="relrow"><button class="rn relbtn" data-relic="${esc(r)}">${esc(r)}</button>${ownRel(r)}<span class="rar ${rar}">${RAR[rar] || rar}</span>${ch}${tag}${kind ? "" : farmHTML(r)}</div>`;
}
function moreHTML(it) {
  if (it.b) return infoHTML(it);
  const sh = S().show;
  let h = "";
  allParts(it).forEach(p => {
    const rows = p.r.slice().sort((a, b) => RAR_ORDER[b[1]] - RAR_ORDER[a[1]] || relicSort(a[0], b[0]));
    const av = rows.filter(([r]) => obtainable(r));
    const rs = rows.filter(([r]) => relicStatus(r) === "rs");
    const va = rows.filter(([r]) => ["va", "ba-off"].includes(relicStatus(r)));
    const rsShown = sh.resurgence ? rs : [];
    const vaShown = sh.vaulted ? (sh.resurgence ? va : rs.concat(va)) : [];
    h += `<div class="part"><b>${esc(p.full)}</b>${p.n === 0 ? `<span class="need">collected</span>` : p.n > 1 ? `<span class="need">need ${p.n}</span>` : ""}`;
    if (!rows.length) h += `<div class="relrow"><span class="farm">${it.src === "other" ? "Doesn't come from relics. See How to get above." : "No relic data for this part yet."}</span></div>`;
    av.forEach(([r, rar]) => { h += relRow(r, rar); });
    const rsRows = rsShown.map(([r, rar]) => relRow(r, rar, "rs")).join("");
    const vaRows = vaShown.map(([r, rar]) => relRow(r, rar, relicStatus(r) === "rs" ? "va" : relicStatus(r))).join("");
    if (rows.length && !av.length) {
      const extra = rs.length && sh.resurgence ? ` · ${rs.length} back in Prime Resurgence` : "";
      if (rsRows || vaRows) h += `<details class="vlt"><summary>All relics vaulted${extra}</summary>${rsRows}${vaRows}</details>`;
      else h += `<div class="relrow"><span class="farm">All relics vaulted.</span></div>`;
    } else if (rsRows || vaRows) {
      h += `<details class="vlt"><summary>${rs.length + va.length} more vaulted relic${rs.length + va.length === 1 ? "" : "s"}</summary>${rsRows}${vaRows}</details>`;
    }
    h += `</div>`;
  });
  return h + infoHTML(it);
}
const STAT_ROWS = [
  ["mr", "Mastery rank", v => v, 0], ["dmg", "Total damage", v => Math.round(v * 10) / 10, 1],
  ["cc", "Crit chance", v => pct(v * 100), 1], ["cd", "Crit multiplier", v => v.toFixed(1) + "x", 1],
  ["sc", "Status chance", v => pct(v * 100), 1], ["fr", "Fire / attack rate", v => Math.round(v * 100) / 100, 1],
  ["mag", "Magazine", v => v, 1], ["rl", "Reload", v => v + "s", -1], ["dispo", "Riven disposition", v => v, 0],
];
function cmpTable(a, b, an, bn) {
  if (!a || !b) return `<p class="secsub" style="margin:6px 0 0">No stat data to compare yet.</p>`;
  let rows = "";
  STAT_ROWS.forEach(([k, label, f, dir]) => {
    const x = a[k], y = b[k];
    if (x == null && y == null) return;
    if (x === y) return;
    const better = (p, q) => dir && p != null && q != null && (dir > 0 ? p > q : p < q) ? "up" : "down";
    rows += `<tr><td>${label}</td><td class="${better(x, y)}">${x == null ? "–" : f(x)}</td><td class="${better(y, x)}">${y == null ? "–" : f(y)}</td></tr>`;
  });
  if (!rows) return `<p class="secsub" style="margin:6px 0 0">Same base stats.</p>`;
  return `<table class="stats"><tr><th></th><th>${esc(an)}</th><th>${esc(bn)}</th></tr>${rows}</table>`;
}
function incText(it) {
  if (!it.inc) return `<span class="no">None</span>`;
  return `<span class="yes">Yes</span> · ${esc(it.inc.g || "Incarnon Genesis")}${it.inc.src ? ` from ${esc(it.inc.src)}` : ""}`;
}
function infoHTML(it) {
  const sh = S().show;
  const weapon = !!it.w;
  const vars = it.var || [];
  let h = "";
  if (weapon && it.inc && vars.length) {
    h += `<div class="info"><details class="cmp"><summary>Incarnon &amp; variants</summary>
      <div style="margin-top:6px"><span class="k">Incarnon</span>${incText(it)}</div>
      <div style="margin-top:4px"><span class="k">Variants</span>${vars.map(v => esc(v.n)).join(", ")}</div>`;
    vars.forEach(v => {
      h += `<div style="margin-top:8px"><span class="k">${esc(it.n)} vs ${esc(v.n)}</span>
        <div class="secsub" style="margin:2px 0 0;font-size:12px">${esc(it.n)} can take an Incarnon form${v.inc === true ? `, and so can ${esc(v.n)}` : v.inc === false ? `; ${esc(v.n)} can't` : ""}. Stats below are the normal (non-Incarnon) forms; only differences are listed.</div>
        ${cmpTable(it.s, v.s, it.n, v.n)}</div>`;
    });
    h += `</details></div>`;
  } else {
    if (weapon) h += `<div class="info"><span class="k">Incarnon</span>${incText(it)}</div>`;
    if (vars.length && sh.variants) h += `<div class="info"><span class="k">Variants</span>${vars.map(v => esc(v.n)).join(", ")}</div>`;
  }
  if (sh.mods && it.mods && it.mods.length) {
    h += `<div class="info"><span class="k">Unique mods</span><ul>${it.mods.map(m =>
      `<li><b>${esc(m.n)}</b> — ${m.src && m.src.length ? esc(m.src.join("; ")) : m.u ? `<a href="${esc(m.u)}" target="_blank" rel="noopener">see the wiki</a>` : "see the wiki"}</li>`).join("")}</ul></div>`;
  }
  if (it.wiki) h += `<div class="info"><a href="${esc(it.wiki)}" target="_blank" rel="noopener">Open on the WARFRAME Wiki ↗</a></div>`;
  return h;
}

/* ---------- PAGE: MAIN ----------
   Two dropdowns, Base then Prime, under one pinned bar: category, search and a filter button. */
let mainCat = "all", mainQuery = "", showMastered = false, hideDone = false;
const FILTER_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>`;
const catsWithItems = () => CATS.filter(([k]) => k === "all" || ALL.some(it => (it.grp && GROUPS[it.grp] ? GROUPS[it.grp].cat : it.cat) === k));
function buildMain() {
  $("#main").innerHTML = `<header><h1 id="catTitle">All</h1><p id="catIntro"></p></header>
    <div class="mbar" id="mbar"><div class="mbarrow">
      <label class="catwrap"><span class="sr">Category</span><select class="catsel" id="catSel"></select></label>
      <input class="search" id="search" type="search" placeholder="Search" autocomplete="off" aria-label="Search">
      <button class="iconbtn" id="filtBtn" aria-label="Sort and filters" aria-expanded="false">${FILTER_SVG}</button></div>
      <div class="fpanel hidden" id="fpanel">
        <div class="controls" id="sortCtl"><span class="ctlk">Sort</span><button class="chip" data-sort="type">By type</button><button class="chip" data-sort="az">A–Z</button></div>
        <div class="controls"><button class="chip ghost" id="showM" aria-pressed="false">Show mastered</button>
        <button class="chip ghost" id="hideD" aria-pressed="false">Hide complete</button></div></div></div>
    <div id="mainList"></div>
    <footer>Data from the <a href="https://wiki.warframe.com/" target="_blank">WARFRAME Wiki</a>, DE's official drop tables and WFCD community data. Resources like Orokin Cells and credits aren't listed. To master an item you still have to level it to rank 30 after you build it.</footer>`;
  fillCats();
  $("#catSel").addEventListener("change", e => { mainCat = e.target.value; renderMain(); $("#pg-main").scrollTop = 0; });
  $("#filtBtn").addEventListener("click", e => {
    const p = $("#fpanel"), open = p.classList.toggle("hidden") === false;
    e.currentTarget.setAttribute("aria-expanded", open);
  });
  $("#sortCtl").addEventListener("click", e => {
    const b = e.target.closest("[data-sort]"); if (!b) return;
    S().mainSort = b.dataset.sort; save(); renderMain();
  });
  // dropdowns (Base / Prime, weapon slots) remember whether they're open
  $("#mainList").addEventListener("toggle", e => {
    const d = e.target; if (!d.matches || mainQuery) return;
    if (d.matches("details.secgrp")) { if (d.open) delete S().collapsed[d.dataset.slot]; else S().collapsed[d.dataset.slot] = 1; save(); }
    if (d.matches("details.mgrp")) { S().mainOpen[d.dataset.mg] = d.open ? 1 : 0; save(); }
  }, true);
  $("#search").addEventListener("input", e => {
    if (secretSearch(e.target.value)) { e.target.value = ""; e.target.blur(); mainQuery = ""; renderMain(); return; }
    mainQuery = e.target.value.trim().toLowerCase(); renderMain();
  });
  $("#showM").addEventListener("click", e => { showMastered = !showMastered; e.currentTarget.setAttribute("aria-pressed", showMastered); renderMain(); });
  $("#hideD").addEventListener("click", e => { hideDone = !hideDone; e.currentTarget.setAttribute("aria-pressed", hideDone); renderMain(); });
}
function fillCats() {
  const sel = $("#catSel"); if (!sel) return;
  const list = catsWithItems();
  if (!list.some(([k]) => k === mainCat)) mainCat = "all";
  sel.innerHTML = list.map(([k, l]) => `<option value="${k}"${k === mainCat ? " selected" : ""}>${l}</option>`).join("");
}
const catOf = it => it.grp && GROUPS[it.grp] ? GROUPS[it.grp].cat : it.cat;
const slotOf = it => it.grp && GROUPS[it.grp] ? GROUPS[it.grp].slot : it.slot;
function passes(it) {
  const q = mainQuery;
  if (mainCat !== "all" && catOf(it) !== mainCat) return false;
  if (state.mastered[it.id] && !showMastered) return false;
  if (hideDone && it.k !== "m") { const { n, g } = progress(it); if (n && g === n) return false; }
  if (q && !it.n.toLowerCase().includes(q) && !(it.grp && GROUPS[it.grp] && GROUPS[it.grp].n.toLowerCase().includes(q))
    && !unitsOf(it).some(u => (u.full || "").toLowerCase().includes(q))) return false;
  return true;
}
/* Display entries: one per card. Base items in a group share one entry. */
function entriesOf(list) {
  const m = new Map();
  list.forEach(it => {
    const g = it.grp && GROUPS[it.grp], key = g ? it.grp : it.id;
    if (!m.has(key)) m.set(key, { key, g, items: [], cat: catOf(it), slot: slotOf(it), n: g ? g.n : it.n });
    m.get(key).items.push(it);
  });
  return [...m.values()].sort((a, b) => a.n.localeCompare(b.n));
}
function sectionsFor(entries) {
  const secs = new Map(), az = mainCat === "all" && S().mainSort === "az";
  const one = mainCat !== "all" && new Set(entries.map(e => e.slot)).size > 1;
  const key = e => az ? null : mainCat === "all" ? (SLOTTED.has(e.cat) ? `${CAT_LABEL[e.cat]} · ${e.slot || "Other"}` : CAT_LABEL[e.cat] || "Other") : one ? e.slot || "Other" : null;
  entries.forEach(e => { const k = key(e); if (!secs.has(k)) secs.set(k, { cat: e.cat, list: [] }); secs.get(k).list.push(e); });
  const order = (k, v) => k == null ? 0 : CATS.findIndex(c => c[0] === v.cat) * 100 + Math.max(0, SLOT_ORDER.indexOf(k.split(" · ").pop()));
  return [...secs.entries()].sort((a, b) => order(a[0], a[1]) - order(b[0], b[1]) || String(a[0]).localeCompare(String(b[0])));
}
const entryHTML = e => e.g ? gcardHTML(e) : cardHTML(e.items[0]);
const entryReady = e => e.items.some(readyToBuild);
function listHTML(mg, items) {
  const entries = entriesOf(items);
  if (!entries.length) return `<p class="empty">${mainQuery ? "Nothing matches that search." : "Nothing left here. Everything's mastered!"}</p>`;
  let h = "";
  const ready = entries.filter(entryReady);
  if (ready.length) h += `<h2 class="sec rtbsec">Ready to build</h2><div class="grid">${ready.map(entryHTML).join("")}</div>`;
  sectionsFor(entries.filter(e => !entryReady(e))).forEach(([k, v]) => {
    const grid = `<div class="grid">${v.list.map(entryHTML).join("")}</div>`;
    const ck = `${mg}:${k}`;
    if (k && SLOTTED.has(v.cat)) {
      const open = mainQuery || !S().collapsed[ck];
      h += `<details class="secgrp" data-slot="${esc(ck)}"${open ? " open" : ""}><summary><h2 class="sec">${esc(k)}</h2><span class="seccnt">${v.list.length}</span></summary>${grid}</details>`;
    } else h += (k ? `<h2 class="sec">${esc(k)}</h2>` : "") + grid;
  });
  return h;
}
function mgCount(pool) {
  const m = pool.filter(counts), got = m.filter(it => state.mastered[it.id]).length;
  return { got, tot: m.length, txt: m.length ? `${got} / ${m.length} mastered` : `${pool.filter(it => progress(it).g).length} / ${pool.length} collected` };
}
const mgPool = list => list.filter(it => mainCat === "all" || catOf(it) === mainCat);
function renderMain() {
  if (!$("#mainList")) return;
  fillCats();
  $("#catTitle").textContent = CAT_LABEL[mainCat] || "All";
  $("#catIntro").textContent = CAT_INTRO[mainCat] || "";
  let h = "";
  if (!ALL.length) h = `<p class="empty">Loading the item list…</p>`;
  else [["base", "Base", BASE], ["prime", "Prime", ITEMS]].forEach(([mg, title, list]) => {
    const pool = mgPool(list); if (!pool.length) return;
    const c = mgCount(pool), open = !!mainQuery || !!S().mainOpen[mg];
    const items = pool.filter(passes);
    h += `<details class="mgrp" data-mg="${mg}"${open ? " open" : ""}><summary><div class="mgt"><h2>${title}</h2><span class="mgc" data-mgc="${mg}">${c.txt}</span><span class="chev" aria-hidden="true">▾</span></div>
      <div class="bar"><i data-mgbar="${mg}" style="width:${c.tot ? 100 * c.got / c.tot : 0}%"></i></div><p class="secsub">${MG_LINE[mg]}</p></summary>
      <div class="mgbody">${open ? listHTML(mg, items) : ""}</div></details>`;
  });
  const sc = $("#sortCtl");
  sc.classList.toggle("hidden", mainCat !== "all");
  sc.querySelectorAll("[data-sort]").forEach(b => b.setAttribute("aria-pressed", b.dataset.sort === S().mainSort));
  $("#mainList").innerHTML = h;
  $("#mainList").querySelectorAll(".card[data-item]").forEach(c => groupCounts(c, BYID[c.dataset.item]));
}
/* A dropdown's cards are only drawn once it's opened, so a long list stays quick */
function fillMg(d) {
  const mg = d.dataset.mg, body = d.querySelector(".mgbody");
  if (!d.open || body.childElementCount) return;
  body.innerHTML = listHTML(mg, mgPool(mg === "base" ? BASE : ITEMS).filter(passes));
  body.querySelectorAll(".card[data-item]").forEach(c => groupCounts(c, BYID[c.dataset.item]));
}
function mainSummary() {
  [["base", BASE], ["prime", ITEMS]].forEach(([mg, list]) => {
    const el = document.querySelector(`[data-mgc="${mg}"]`); if (!el) return;
    const c = mgCount(mgPool(list));
    el.textContent = c.txt;
    const bar = document.querySelector(`[data-mgbar="${mg}"]`); if (bar) bar.style.width = (c.tot ? 100 * c.got / c.tot : 0) + "%";
  });
}
function jumpTo(id) {
  const it = BYID[id]; if (!it) return;
  if (mainCat !== "all" && catOf(it) !== mainCat) mainCat = "all";
  if (state.mastered[id]) showMastered = true;
  mainQuery = ""; $("#search").value = ""; hideDone = false;
  S().mainOpen[it.b ? "base" : "prime"] = 1; save();
  renderMain(); goPage(PAGE_MAIN, true);
  setTimeout(() => {
    const c = document.querySelector(`#mainList [data-item="${id}"]`); if (!c) return;
    const sg = c.closest("details.secgrp"); if (sg && !sg.open) sg.open = true;
    c.scrollIntoView({ block: "center", behavior: S().reduceMotion ? "auto" : "smooth" });
    c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 1600);
  }, 120);
}

/* ---------- PAGE: FAVORITES ---------- */
const FAV_SORTS = [["az", "A–Z"], ["done", "Closest to done"], ["vault", "Vaulting soonest"]];
function buildFavs() {
  $("#favs").innerHTML = `<header><h1>Favorites</h1><p>Every item you've starred, Base and Prime. Tap one for how to get it, its relics and farms.</p></header>
    <section class="summary"><div class="sumrow"><span>Starred parts collected</span><b id="favSum">0 / 0</b></div>
      <div class="sumsub" id="favSub"></div><div class="bar"><i id="favBar"></i></div>
      <div class="fbarrow"><span class="ctlk">Sorted <b id="favSortName"></b></span><button class="iconbtn" id="favFilt" aria-label="Sort favorites" aria-expanded="false">${FILTER_SVG}</button></div>
      <div class="fpanel hidden" id="favPanel"><div class="controls" id="favSort"><span class="ctlk">Sort</span>${FAV_SORTS.map(([k, l]) => `<button class="chip" data-fsort="${k}">${l}</button>`).join("")}</div></div></section>
    <div id="favList"></div>
    <details class="tdd" id="tradeDD"><summary><h2 class="sec">Trade chat shortcuts</h2><span class="seccnt" id="tradeCnt"></span><span class="chev" aria-hidden="true">▾</span></summary>
      <p class="secsub">Ready-made "want to buy" messages for the parts you're missing on starred Primes. Each stays under ${TRADE_LIMIT} characters.</p>
      <div id="trade"></div>
      <h3 class="sub3">Write your own</h3>
      <p class="secsub">Type what you're after, one item at a time. Pick the proper name from the suggestions; the app adds the [brackets] and splits long lists to fit chat.</p>
      <div class="controls" id="tbMode"><button class="chip" data-tbmode="WTB">WTB</button><button class="chip" data-tbmode="WTS">WTS</button></div>
      <div class="tbin"><input class="search" id="tbIn" type="text" placeholder="Add an item, e.g. ash prime systems" autocomplete="off" aria-label="Item to add" list="tbList"><datalist id="tbList"></datalist>
        <button class="chip" id="tbAdd">Add</button></div><span class="toast" data-toast></span>
      <div class="tbchips" id="tbChips"></div><div id="tbOut"></div></details>
    <footer>Tap Copy, then paste into trade chat. Duplicates show as x2.</footer>`;
  $("#favFilt").addEventListener("click", e => { const open = $("#favPanel").classList.toggle("hidden") === false; e.currentTarget.setAttribute("aria-expanded", open); });
  $("#favSort").addEventListener("click", e => { const b = e.target.closest("[data-fsort]"); if (!b) return; S().favSort = b.dataset.fsort; save(); renderFavs(); });
  $("#tradeDD").addEventListener("toggle", e => { S().tradeOpen = e.target.open ? 1 : 0; save(); });
  bindTradeBuilder();
}
const favMissing = e => e.items.filter(i => counts(i) && active(i)).reduce((a, i) => { const { n, g } = progress(i); return a + (i.k === "m" ? 1 : n - g); }, 0);
const favVault = e => { const ends = e.items.flatMap(i => alertsFor(i).map(a => a.end || 9e15)); return ends.length ? Math.min(...ends) : Infinity; };
function favEntries(list) {
  return entriesOf(list.filter(it => state.stars[it.id] || (it.grp && state.stars[it.grp])));
}
function sortFav(entries) {
  const k = S().favSort || "az";
  const by = { az: () => 0, done: (a, b) => favMissing(a) - favMissing(b), vault: (a, b) => favVault(a) - favVault(b) }[k] || (() => 0);
  return entries.sort((a, b) => by(a, b) || a.n.localeCompare(b.n));
}
function renderFavs() {
  const base = sortFav(favEntries(BASE)), prime = sortFav(favEntries(ITEMS));
  let h = "";
  if (base.length) h += `<h2 class="sec">Base</h2><div class="grid">${base.map(entryHTML).join("")}</div>`;
  if (prime.length) h += `<h2 class="sec">Prime</h2><div class="grid">${prime.map(entryHTML).join("")}</div>`;
  $("#favList").innerHTML = h || `<p class="empty">No favorites yet. Tap the ☆ on any item on the Main page.</p>`;
  $("#favList").querySelectorAll(".card[data-item]").forEach(c => groupCounts(c, BYID[c.dataset.item]));
  const sk = S().favSort || "az";
  $("#favSortName").textContent = (FAV_SORTS.find(x => x[0] === sk) || FAV_SORTS[0])[1];
  document.querySelectorAll("[data-fsort]").forEach(b => b.setAttribute("aria-pressed", b.dataset.fsort === sk));
  $("#tradeDD").open = !!S().tradeOpen;
  favSummary(); renderTrade();
}
function favSummary() {
  const items = ALL.filter(it => (state.stars[it.id] || (it.grp && state.stars[it.grp])) && counts(it));
  let tot = 0, got = 0, ready = 0;
  items.filter(active).forEach(it => { const { n, g } = progress(it); tot += n; got += g; if (readyToBuild(it)) ready++; });
  $("#favSum").textContent = `${got} / ${tot}`;
  $("#favBar").style.width = (tot ? 100 * got / tot : 0) + "%";
  $("#favSub").textContent = `${favEntries(ALL).length} starred · ${ready} ready to build`;
}
/* ---------- TRADE MESSAGE BUILDER ---------- */
const tb = { mode: "WTB", list: [] }; // list of [name, count]
const tradeNames = () => DATA.trade || [];
function properName(raw) {
  const q = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\s+/g, " ");
  if (!q) return null;
  const names = tradeNames();
  return names.find(n => n.toLowerCase() === q) || names.find(n => n.toLowerCase().startsWith(q)) || names.find(n => n.toLowerCase().includes(q)) || null;
}
function splitMsgs(prefix, tokens) {
  const msgs = []; let cur = [];
  const wrap = list => `${prefix} ${list.join(" ")}`;
  tokens.forEach(t => { if (cur.length && wrap([...cur, t]).length > TRADE_LIMIT) { msgs.push(wrap(cur)); cur = [t]; } else cur.push(t); });
  if (cur.length) msgs.push(wrap(cur));
  return msgs;
}
const msgListHTML = msgs => `<div class="tlist">${msgs.map((t, i) => `<div class="tmsg"><span class="num">${i + 1}</span>
  <code>${esc(t)}<span class="len">${t.length} characters</span></code><button class="chip" data-copy="${esc(t)}">Copy</button></div>`).join("")}</div>`;
function renderBuilder() {
  if (!$("#tbOut")) return;
  document.querySelectorAll("[data-tbmode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tbmode === tb.mode));
  $("#tbChips").innerHTML = tb.list.map(([n, c], i) => `<span class="tbchip">[${esc(n)}]${c > 1 ? ` x${c}` : ""}<button data-tbdel="${i}" aria-label="Remove ${esc(n)}">×</button></span>`).join("");
  $("#tbOut").innerHTML = tb.list.length ? msgListHTML(splitMsgs(tb.mode, tb.list.map(([n, c]) => c > 1 ? `[${n}] x${c}` : `[${n}]`))) : "";
}
function bindTradeBuilder() {
  const inp = $("#tbIn");
  inp.addEventListener("input", () => { // a few quiet suggestions, only once you've typed a little
    const q = inp.value.trim().toLowerCase();
    $("#tbList").innerHTML = q.length < 2 ? "" : tradeNames().filter(n => n.toLowerCase().includes(q)).sort((a, b) => a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q) || a.length - b.length).slice(0, 6).map(n => `<option value="${esc(n)}"></option>`).join("");
  });
  const add = () => {
    const n = properName(inp.value);
    if (!n) { say($("#tbAdd"), inp.value.trim() ? "No tradable item by that name" : "Type an item first"); return; }
    const e = tb.list.find(x => x[0] === n); if (e) e[1]++; else tb.list.push([n, 1]);
    inp.value = ""; $("#tbList").innerHTML = ""; renderBuilder();
  };
  $("#tbAdd").addEventListener("click", add);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  $("#tbMode").addEventListener("click", e => { const b = e.target.closest("[data-tbmode]"); if (!b) return; tb.mode = b.dataset.tbmode; renderBuilder(); });
  $("#tbChips").addEventListener("click", e => { const b = e.target.closest("[data-tbdel]"); if (!b) return; tb.list.splice(+b.dataset.tbdel, 1); renderBuilder(); });
  renderBuilder();
}
function tradeMessages() {
  const m = new Map();
  starred().filter(it => active(it) && it.src !== "other").forEach(it => missing(it).forEach(p => m.set(p.full, (m.get(p.full) || 0) + p.n)));
  const tokens = [...m.entries()].map(([n, c]) => c > 1 ? `[${n}] x${c}` : `[${n}]`);
  const msgs = []; let cur = [];
  const wrap = list => `WTB ${list.join(" ")} PMO`;
  tokens.forEach(t => {
    if (cur.length && wrap([...cur, t]).length > TRADE_LIMIT) { msgs.push(wrap(cur)); cur = [t]; }
    else cur.push(t);
  });
  if (cur.length) msgs.push(wrap(cur));
  return msgs;
}
function renderTrade() {
  const msgs = tradeMessages();
  if ($("#tradeCnt")) $("#tradeCnt").textContent = msgs.length;
  $("#trade").innerHTML = msgs.length ? msgListHTML(msgs)
    : `<p class="empty">${starred().length ? "Nothing missing on your starred Primes." : "Star some Primes and their missing parts show up here."}</p>`;
}

/* ---------- PAGE: RELIC RUNS ---------- */
let runsTier = "all";
function buildRuns() {
  $("#runs").innerHTML = `<header><h1>Relic Runs</h1><p>Check this during a relic mission. Tick a part anywhere and it drops off this page. Pull down to refresh.</p></header>
    <div id="runsBody"></div>
    <footer>Drop chance per refinement: Common 25.33% Intact → 16.67% Radiant · Uncommon 11% → 20% · Rare 2% → 10%. Vaulted relics can be traded with other players, or bought from Varzia when they're in Prime Resurgence.</footer>`;
}
/* Relic Runs sections are dropdowns: closed the first time, then as you left them */
function runsSec(key, title, note, body) {
  return `<details class="rot card rsec" data-runs="${key}"${S().runsOpen[key] ? " open" : ""}><summary><span class="rname">${title}</span>${note ? `<em class="rnote">${note}</em>` : ""}</summary><div class="rbody">${body}</div></details>`;
}
function needMap(items) { // relic -> [{item, full, rar, n}]
  const rm = {};
  items.forEach(it => missing(it).forEach(p => p.r.forEach(([r, rar]) => (rm[r] = rm[r] || []).push({ it: it.n, full: p.full, rar, n: p.n }))));
  return rm;
}
function renderRuns() {
  const tierOk = r => runsTier === "all" || tierOf(r) === runsTier;
  const starItems = starred().filter(active);
  const srm = needMap(starItems);
  const hvAll = Object.entries(srm).filter(([, l]) => new Set(l.map(x => x.it)).size > 1);
  const hvSet = new Set(hvAll.map(([r]) => r));
  const haveCounts = Object.keys(state.relicCounts).length > 0, own = state.hvOwned;
  const hvShown = own ? hvAll.filter(([r]) => state.relicCounts[r] > 0) : hvAll;
  const hv = hvShown.filter(([r]) => tierOk(r)).sort((a, b) =>
    new Set(b[1].map(x => x.it)).size - new Set(a[1].map(x => x.it)).size || obtainable(b[0]) - obtainable(a[0]) || relicSort(a[0], b[0]));
  let h = "", body = "";
  body = `<p class="secsub">Relics that hold parts for two or more different starred items.</p>
    <div class="controls"><button class="chip ghost" id="hvOwned" aria-pressed="${own}">Owned only</button></div>`;
  body += hv.length ? `<div class="grid hv">` + hv.map(([r, l]) => {
    const n = new Set(l.map(x => x.it)).size;
    return `<article class="card"><div class="chead" style="cursor:default"><div class="name"><button class="relbtn" data-relic="${esc(r)}">${esc(r)}</button>${ownRel(r)}</div>
      <div class="meta"><span class="tag">${n} starred items</span><span class="st ${stCls(r)}">${statusLabel(r)}</span></div></div>
      <div class="rlist">${l.sort((a, b) => RAR_ORDER[a.rar] - RAR_ORDER[b.rar]).map(p => `<div class="rrow"><span class="pn">${esc(p.full)}</span><span class="rar ${p.rar}">${RAR[p.rar]}</span></div>`).join("")}</div></article>`;
  }).join("") + `</div>` : `<p class="empty">${starItems.length < 2 ? "Star at least two items to find relics that cover more than one."
    : own && !haveCounts ? "Run an Inventory Scan in Settings to see which relics you own."
    : own && hvAll.length ? "None of the relics you own hold parts for more than one of your starred items."
    : "No relic holds parts for more than one of your starred items."}</p>`;
  h += runsSec("hv", "High value", `${hvShown.length}${own ? " owned" : ""}`, body);

  // Fissures
  const needItems = starItems.length ? starItems : ITEMS.filter(active);
  const nrm = needMap(needItems);
  const needTiers = {};
  Object.keys(nrm).forEach(r => { if (obtainable(r)) needTiers[tierOf(r)] = (needTiers[tierOf(r)] || 0) + 1; });
  const sp = S().fissMode === "sp";
  document.querySelectorAll("#fissMode [data-fmode]").forEach(b => b.setAttribute("aria-pressed", (b.dataset.fmode === "sp") === sp));
  body = `<div class="controls fisstoggle" id="fissMode"><button class="chip" data-fmode="normal" aria-pressed="${!sp}">Normal</button><button class="chip" data-fmode="sp" aria-pressed="${sp}">Steel Path</button></div>
    <p class="secsub">Running now. Gold rows match a tier you have farmable relics to crack${starItems.length ? " for your starred items" : ""}.</p>`;
  const now = Date.now();
  const fiss = (LIVE && LIVE.fissures || []).filter(f => f.expiry > now && !!f.hard === sp)
    .sort((a, b) => (a.storm - b.storm) || (a.hard - b.hard) || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.expiry - b.expiry);
  let fm = 0;
  if (!LIVE) body += `<p class="empty">Live fissures will show once the app can reach the worldstate.</p>`;
  else if (!fiss.length) body += `<p class="empty">No ${sp ? "Steel Path " : ""}fissures in the feed right now.</p>`;
  else body += `<div class="fiss">${fiss.map(f => {
    const match = f.tier === "Omnia" ? Object.keys(needTiers).length > 0 : !!needTiers[f.tier];
    const cnt = f.tier === "Omnia" ? Object.values(needTiers).reduce((a, b) => a + b, 0) : needTiers[f.tier] || 0;
    if (match) fm++;
    const flags = (f.hard ? `<span class="flag sp">Steel Path</span>` : "") + (f.storm ? `<span class="flag">Void Storm</span>` : "") + (match ? `<span class="flag need">${cnt} relic${cnt === 1 ? "" : "s"}</span>` : "");
    return `<div class="frow${match ? " match" : ""}"><span class="ti">${esc(f.tier)}</span><span class="mi"><span class="mt">${esc(f.type)}</span><small>${esc(f.node)}</small></span><span class="tl">${until(f.expiry)}</span>${flags ? `<span class="flags">${flags}</span>` : ""}</div>`;
  }).join("")}</div>`;
  h += runsSec("fiss", `Void Fissures${sp ? " · Steel Path" : ""}`, LIVE ? `${fiss.length} open${fm ? ` · ${fm} for you` : ""}` : "", body);

  // Everything missing
  body = `<p class="secsub">All relics for every part you still need, across every Prime you haven't mastered. Gold outline = also in High value. Teal outline = you can get it right now.</p>
    <section class="summary" style="margin-top:0"><div class="sumrow"><span>Relics holding a part you need</span><b id="runSum">0</b></div><div class="sumsub" id="runSub"></div>
      <div class="controls">${[["all", "All tiers"], ["Lith", "Lith"], ["Meso", "Meso"], ["Neo", "Neo"], ["Axi", "Axi"]].map(([k, l]) =>
        `<button class="chip" data-tier="${k}" aria-pressed="${k === runsTier}">${l}</button>`).join("")}</div></section>`;
  const allRm = needMap(ITEMS.filter(active));
  const cards = [];
  ITEMS.filter(active).forEach(it => {
    const ms = missing(it).filter(p => p.r.some(([r]) => tierOk(r)));
    if (!ms.length) return;
    let c = `<article class="card"><div class="chead" style="cursor:default"><div class="name">${esc(it.n)}</div><div class="meta"><span class="tag">${esc(it.slot || CAT_LABEL[it.cat])}</span><span>${ms.length} part${ms.length > 1 ? "s" : ""} missing</span></div></div>`;
    ms.forEach(p => {
      const rs = p.r.filter(([r]) => tierOk(r)).sort((a, b) => RAR_ORDER[b[1]] - RAR_ORDER[a[1]] || relicSort(a[0], b[0]));
      c += `<div class="part"><b>${esc(p.full)}</b>${p.n > 1 ? `<span class="need">need ${p.n}</span>` : ""}<div class="chips">` +
        rs.map(([r, rar]) => `<button class="rchip ${rar}${hvSet.has(r) ? " hot" : ""}${obtainable(r) ? " av" : ""}" data-relic="${esc(r)}">${esc(r)}<i>${rar}</i>${ownRel(r)}</button>`).join("") + `</div></div>`;
    });
    cards.push((state.stars[it.id] ? "0" : "1") + it.n + "\u0000" + c + `</article>`);
  });
  cards.sort();
  body += cards.length ? `<div class="grid">${cards.map(s => s.split("\u0000")[1]).join("")}</div>` : `<p class="empty">Nothing missing in this tier.</p>`;
  h += runsSec("miss", "Every missing part", `${Object.keys(allRm).length} relics`, body);
  $("#runsBody").innerHTML = h;
  $("#runSum").textContent = Object.keys(allRm).length;
  $("#runSub").textContent = `${new Set(Object.values(allRm).flat().map(x => x.full)).size} different parts missing across ${ITEMS.filter(active).length} items · ${hvSet.size} high-value relic${hvSet.size === 1 ? "" : "s"}`;
  $("#hvOwned").addEventListener("click", () => { state.hvOwned = !state.hvOwned; save(); renderRuns(); });
}

/* ---------- PAGE: ROTATING ---------- */
function rotSection(key, title, note, body) { // closed the first time, then as you left it
  if (S().hideVend[key]) return "";
  return `<details class="rot card" data-rot="${key}"${S().rotOpen[key] ? " open" : ""}><summary><span class="rname">${title}</span>${note ? `<em class="rnote">${note}</em>` : ""}</summary><div class="rbody">${body}</div></details>`;
}
function nextWeeklyReset(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.getTime();
}
function renderRotating() {
  const now = Date.now(), L = LIVE;
  let h = `<header><h1>Rotating</h1><p>Vendors and rewards that change. Tap one to open it. Pull down to refresh.</p></header>`;
  if (!L) { $("#rotating").innerHTML = h + `<p class="empty">Live vendor info shows here once the app can reach the worldstate.</p>`; return; }
  const needRel = new Set(Object.keys(needMap(starred().filter(active))));
  const row = (n, pr) => `<div class="rrow"><span class="pn">${esc(n)}${needRel.has((RELIC_RE.exec(n) || []).slice(1).join(" ")) ? ` <span class="flag need">starred</span>` : ""}</span>${pr ? `<span class="pr">${pr}</span>` : ""}</div>`;
  const msg = t => `<div class="rlist"><span class="secsub" style="margin:0">${t}</span></div>`;
  let out = "";
  const b = L.baro;
  if (b) {
    const here = b.active && b.expiry > now;
    const note = here ? `leaves in ${until(b.expiry)}` : b.activation > now ? `arrives in ${until(b.activation)}` : "";
    const inv = here && b.inventory && b.inventory.length
      ? `<div class="rlist">${b.inventory.map(x => row(x.n, [x.ducats ? `${x.ducats} ducats` : "", x.credits ? `${Number(x.credits).toLocaleString()} cr` : ""].filter(Boolean).join(" · "))).join("")}</div>`
      : msg(here ? "No inventory in the feed yet." : "His inventory shows up when he arrives.");
    out += rotSection("baro", "Void Trader", note, `<div class="vline">Baro Ki'Teer · ${here ? "at" : "next at"} <b>${esc(b.location || "a relay")}</b></div>${inv}${ducatHTML()}`);
  }
  const deals = (L.darvo || []).filter(d => !d.expiry || d.expiry > now);
  out += rotSection("darvo", "Darvo", deals[0] && deals[0].expiry ? `ends in ${until(deals[0].expiry)}` : "", deals.length ? deals.map(d => {
    const off = d.orig ? Math.round(100 - 100 * d.sale / d.orig) : 0;
    return `<div class="vline"><div class="big">${esc(d.n)}</div></div><div class="rlist"><div class="rrow"><span class="pn">${d.sale} platinum${d.orig ? ` <span class="sub" style="margin:0">(was ${d.orig}, ${off}% off)</span>` : ""}</span></div>${d.total ? `<div class="rrow"><span class="pn">${Math.max(0, d.total - (d.sold || 0))} of ${d.total} left</span></div>` : ""}</div>`;
  }).join("") : msg("No daily deal in the feed right now."));
  const t = L.teshin;
  out += rotSection("teshin", "Teshin (Steel Path Honors)", t && t.expiry ? `changes in ${until(t.expiry)}` : "", t
    ? `<div class="vline"><div class="big">${esc(t.n || "Unknown")}</div></div><div class="rlist">${t.cost ? `<div class="rrow"><span class="pn">${t.cost} Steel Essence</span></div>` : ""}<span class="secsub" style="margin:0">The weekly rotating item in his Steel Path Honors shop.</span></div>`
    : msg("His weekly item isn't in the feed right now."));
  const c = L.circuit;
  out += rotSection("circuit", "Steel Path Circuit", `resets in ${until(nextWeeklyReset())}`, c && c.length
    ? `<div class="rlist">${c.map(n => { const pr = BYNAME[n + " Prime"]; return `<div class="rrow"><span class="pn">${esc(n)} Incarnon Genesis${pr && state.stars[pr.id] ? ` <span class="flag need">starred Prime</span>` : ""}</span></div>`; }).join("")}<span class="secsub" style="margin:4px 0 0">This week's Incarnon Genesis choices from the Steel Path Circuit in Duviri.</span></div>`
    : msg("This week's choices aren't in the feed right now."));
  const v = L.varzia;
  out += rotSection("varzia", "Varzia", v && v.expiry ? `rotates in ${until(v.expiry)}` : "", v && v.inventory && v.inventory.length ? (() => {
    const rel = v.inventory.filter(x => RELIC_RE.test(x.n)), other = v.inventory.filter(x => !RELIC_RE.test(x.n));
    return `<div class="vline">Prime Resurgence</div><div class="rlist">${other.map(x => row(x.n)).join("")}${rel.length ? `<div class="group" style="padding:6px 0 0">Relics</div>` + rel.map(x => row(x.n)).join("") : ""}</div>`;
  })() : msg("Her stock isn't in the live feed right now."));
  $("#rotating").innerHTML = h + `<div class="rots">${out}</div><footer>Live info from the worldstate (PC and crossplay, which includes Xbox). Gold "starred" tags mark relics with parts for your starred items.</footer>`;
}

/* ---------- UPDATED LINE ---------- */
function renderUpdated() { // short: "Updated 18 h ago" with a dot that turns amber when offline
  const off = (DATA_OFFLINE && DATA_SRC !== "none") || LIVE_OFFLINE;
  let s;
  if (DATA_SRC === "none") s = "Loading…";
  else if (DATA.seed) s = "Starter data";
  else s = `Updated ${ago(Math.max(DATA_AT, LIVE ? LIVE_AT : 0))}`;
  $("#updated").innerHTML = `<span class="sdot${off ? " off" : ""}" role="img" aria-label="${off ? "Offline" : "Online"}"></span>${s}${off ? ` <span class="off">offline</span>` : ""}`;
}

/* ---------- DRAWER ---------- */
function renderDrawer() {
  const st = S(), sd = specialDay();
  const sw = (k, l) => `<label class="tgl"><span>${l}</span><input type="checkbox" data-show="${k}"${st.show[k] ? " checked" : ""}></label>`;
  const vend = ([k, l]) => `<label class="tgl"><span>${l}</span><input type="checkbox" data-vend="${k}"${st.hideVend[k] ? "" : " checked"}></label>`;
  $("#drawer").innerHTML = `<h2>Settings</h2>
    <details class="dsec"><summary>Appearance</summary><div class="dbody">
      <h4>Theme</h4>
      ${sd ? `<div class="sdnote">${esc(sd.label)} theme is on today. Your theme comes back tomorrow.</div>` : ""}
      <div class="themes">${THEMES.map(([k, l, sw]) => `<button class="themebtn" data-theme-set="${k}" aria-pressed="${st.theme === k}"><span class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join("")}</span>${l}</button>`).join("")}${hiddenThemeRows()}</div>
      <h4>Display</h4>
      <div class="drow"><label for="tsize">Text size</label><input id="tsize" type="range" min="85" max="130" step="5" value="${st.textSize}"><output id="tsizeOut">${st.textSize}%</output></div>
      <label class="tgl"><span>Compact cards</span><input type="checkbox" data-disp="compact"${st.compact ? " checked" : ""}></label>
      <label class="tgl"><span>Reduce motion</span><input type="checkbox" data-disp="reduceMotion"${st.reduceMotion ? " checked" : ""}></label>
    </div></details>
    <details class="dsec"><summary>Accessibility</summary><div class="dbody">
      <h4>Info shown</h4>
      ${SHOW_SWITCHES.map(([k, l]) => sw(k, l)).join("")}
      <p class="always">Always shown: current fissures, relic rarity badges and Incarnon info. Variant info always shows inside the Incarnon &amp; variants dropdown. Oracle text is the explanations under page titles and at the bottom of pages.</p>
      <h4>Rotating vendors</h4>
      ${VENDORS.map(vend).join("")}
      <h4>Best farm source</h4>
      <div class="seg"><button data-farm="rates" aria-pressed="${st.farm === "rates"}">By the Rates</button><button class="mid" data-farm="both" aria-pressed="${st.farm === "both"}" aria-label="Both">Both</button><button data-farm="community" aria-pressed="${st.farm === "community"}">Community-Driven</button></div>
      <p class="seghelp">${{ rates: "The best mission for each relic, worked out from DE's drop tables.", community: "The farm players recommend.", both: "By the Rates on top, Community-Driven below. When they agree it shows once." }[st.farm]}</p>
    </div></details>
    <details class="dsec"><summary>Import Data</summary><div class="dbody">
      <h4>Inventory Scan</h4>
      <p class="dnote">Upload a screen recording to update your relics and parts.</p>
      ${[["relics", "Relics"], ["parts", "Parts"]].map(([k, l]) => `<div class="fbrow"><span class="fblabel">${l}</span><label class="filebox${SCAN_UI.busy ? " off" : ""}"><span class="fbtn">Choose file</span><span class="fname">${esc(state.scanFiles[k] || "No file chosen")}</span><input type="file" accept="video/*" data-scan="${k}" hidden${SCAN_UI.busy ? " disabled" : ""}></label></div>`).join("")}
      <div class="controls"><button class="chip ghost" id="invBtn">View inventory</button></div>
      <div class="scanmsg${SCAN_UI.bad ? " bad" : ""}" id="scanMsg" role="status">${esc(SCAN_UI.msg)}${SCAN_UI.busy ? ` <button class="linkbtn" id="scanCancel">Cancel</button>` : ""}</div>
    </div></details>
    <div class="spacer"></div>
    <h3>Enter code</h3>
    <div class="codebox"><input id="codeIn" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Code"><button class="chip" id="codeBtn">Unlock</button></div>
    <div class="codemsg" id="codeMsg" role="status"></div>
    ${soundRow()}
    <div class="drow"><label for="startSel">Start page</label><select id="startSel" class="dsel">${START_PAGES.map(([v, l]) => `<option value="${v}"${+st.startPage === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="backup"><h3>Backup / restore</h3>
      <div class="controls"><button class="chip" id="bkCopy">Copy backup code</button><button class="chip" id="bkSave">Save backup file</button></div>
      <textarea id="bkIn" placeholder="Paste a backup code here to restore" spellcheck="false"></textarea>
      <div class="controls"><button class="chip ghost" id="bkRestore">Restore</button><label class="chip ghost filechip">Restore from file<input type="file" accept=".txt,text/plain" id="bkFile" hidden></label><span class="toast" data-toast></span></div>
      <div class="controls"><button class="chip danger" id="clearBtn">Clear data</button></div>
      <p class="fanline">Fan-made app, not affiliated with Digital Extremes. Warframe is a trademark of Digital Extremes Ltd.</p></div>
    <button class="helpbtn" id="tourBtn" aria-label="Show the tour again">?</button>`;
}
const VENDORS = [["baro", "Void Trader"], ["darvo", "Darvo"], ["teshin", "Teshin (Steel Path Honors)"], ["circuit", "Steel Path Circuit"], ["varzia", "Varzia"]];
async function saveBackupFile(btn) {
  const code = await makeBackup(), name = `relic-companion-backup-${new Date().toISOString().slice(0, 10)}.txt`;
  if (native && native.saveFile) {
    window.__wrcSaved = ok => say(btn, ok ? "Backup file saved" : "Not saved");
    native.saveFile(name, code); return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([code], { type: "text/plain" })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  say(btn, "Backup file saved");
}
const SCAN_UI = { busy: false, msg: "", bad: false }; // shared with inventory.js
function scanSay(msg, bad, busy) {
  Object.assign(SCAN_UI, { msg, bad: !!bad, busy: !!busy });
  const m = $("#scanMsg");
  if (m) { m.className = "scanmsg" + (bad ? " bad" : ""); m.innerHTML = esc(msg) + (busy ? ` <button class="linkbtn" id="scanCancel">Cancel</button>` : ""); }
  document.querySelectorAll("#drawer .filebox").forEach(f => { f.classList.toggle("off", !!busy); f.querySelector("input").disabled = !!busy; });
}

/* ---------- INVENTORY (what the last scans found) ---------- */
let invTab = "relics";
function showInventory() {
  $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card invbox"><div class="chead" style="cursor:default"><div class="name">Inventory</div>
    <div class="meta"><span class="tag">From Inventory Scan</span></div></div>
    <div class="mbody"><div class="controls" id="invTabs"><button class="chip" data-inv="relics">Relics</button><button class="chip" data-inv="parts">Parts</button></div>
    <input class="search" id="invQ" type="search" placeholder="Search" autocomplete="off">
    <div class="invsum" id="invSum"></div><div class="invlist" id="invList"></div></div>
    <button class="builtbtn" data-close>Done</button></article></div>`;
  const fill = () => {
    const isR = invTab === "relics", q = ($("#invQ").value || "").trim().toLowerCase();
    document.querySelectorAll("#invTabs [data-inv]").forEach(b => b.setAttribute("aria-pressed", b.dataset.inv === invTab));
    const all = Object.entries(isR ? state.relicCounts : state.partCounts).filter(([, n]) => n > 0);
    const rows = all.filter(([k]) => !q || k.toLowerCase().includes(q)).sort((a, b) => isR ? relicSort(a[0], b[0]) : a[0].localeCompare(b[0]));
    const at = state.scanAt[invTab], file = state.scanFiles[invTab];
    const total = all.reduce((a, [, n]) => a + n, 0);
    $("#invSum").innerHTML = all.length ? `${all.length} ${isR ? "relic" : "part"}${all.length === 1 ? "" : "s"} · ${total} in total${file ? `<br><span class="sub" style="margin:0">${esc(file)}${at ? `, scanned ${ago(at)}` : ""}</span>` : ""}` : "";
    if (!all.length) { $("#invList").innerHTML = `<p class="empty">Nothing imported yet. Upload a recording of your ${isR ? "relics" : "parts"} under Import Data in Settings.</p>`; return; }
    if (!rows.length) { $("#invList").innerHTML = `<p class="empty">Nothing matches that search.</p>`; return; }
    let h = "", grp = null;
    rows.forEach(([k, n]) => {
      const g = isR ? tierOf(k) : null;
      if (g !== grp) { h += `<div class="group">${esc(g)}</div>`; grp = g; }
      h += `<div class="invrow"><span class="pn">${esc(k)}</span>${isR ? `<span class="st ${stCls(k)}">${statusLabel(k)}</span>` : ""}<b>×${n}</b></div>`;
    });
    $("#invList").innerHTML = h;
  };
  $("#invTabs").addEventListener("click", e => { const b = e.target.closest("[data-inv]"); if (!b) return; invTab = b.dataset.inv; fill(); $("#invList").scrollTop = 0; });
  $("#invQ").addEventListener("input", fill);
  fill();
}

/* ---------- CLEAR DATA ---------- */
const CLEAR_OPTS = [["parts", "Mastery & parts"], ["relics", "Relic counts"], ["favs", "Favourites"], ["check", "Checklist"], ["settings", "Settings"], ["secrets", "Unlocked secrets & codes"]];
const WIPE_WORD = "WIPECLEAN";
function showClear() {
  const pick = new Set(); let step = 0;
  const shell = (title, body, btns) => `<div class="modal" id="modal"><article class="card clearbox"><div class="chead" style="cursor:default"><div class="name">${title}</div></div>
    <div class="mbody">${body}</div><div class="tourbtns">${btns}</div></article></div>`;
  const draw = () => {
    const names = CLEAR_OPTS.filter(([k]) => pick.has(k)).map(([, l]) => l);
    if (step === 0) $("#modalRoot").innerHTML = shell("Clear data", `<p>Choose what to clear from this phone.</p>${CLEAR_OPTS.map(([k, l]) =>
      `<label class="tgl"><span>${l}</span><input type="checkbox" data-clr="${k}"${pick.has(k) ? " checked" : ""}></label>`).join("")}`,
      `<button class="chip ghost" data-close>Cancel</button><button class="chip" data-cnext${pick.size ? "" : " disabled"}>Next</button>`);
    else if (step === 1) $("#modalRoot").innerHTML = shell("Are you sure?", `<p>This clears:</p><ul class="news">${names.map(n => `<li>${esc(n)}</li>`).join("")}</ul>
      <p>It can't be undone. If you might want it back, copy a backup code first.</p>`,
      `<button class="chip ghost" data-close>Cancel</button><button class="chip danger" data-cnext>Yes, clear it</button>`);
    else $("#modalRoot").innerHTML = shell("Confirm", `<p>Type <b>${WIPE_WORD}</b> to clear your data.</p>
      <div class="codebox"><input id="wipeIn" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Confirmation"></div>`,
      `<button class="chip ghost" data-close>Cancel</button><button class="chip danger" id="wipeGo" disabled>Clear data</button>`);
    const card = $("#modal .card");
    card.addEventListener("change", e => {
      const k = e.target.dataset.clr; if (!k) return;
      if (e.target.checked) pick.add(k); else pick.delete(k);
      card.querySelector("[data-cnext]").disabled = !pick.size;
    });
    card.addEventListener("input", e => { if (e.target.id === "wipeIn") $("#wipeGo").disabled = e.target.value !== WIPE_WORD; });
    card.addEventListener("click", e => {
      if (e.target.closest("[data-cnext]") && pick.size) { step++; draw(); if (step === 2) setTimeout(() => $("#wipeIn") && $("#wipeIn").focus(), 50); }
      if (e.target.id === "wipeGo" && $("#wipeIn").value === WIPE_WORD) { clearData(pick); closeModal(); }
    });
  };
  draw();
}
function clearData(pick) {
  if (pick.has("parts")) { state.ticks = {}; state.mastered = {}; state.building = {}; state.built = {}; state.partCounts = {}; delete state.scanFiles.parts; delete state.scanAt.parts; }
  if (pick.has("relics")) { state.relicCounts = {}; delete state.scanFiles.relics; delete state.scanAt.relics; }
  if (pick.has("favs")) { state.stars = {}; state.alerts = {}; }
  if (pick.has("check")) state.weekly = { t: {}, c: [] };
  if (pick.has("settings")) {
    state.settings = normaliseState({}).settings; state.hvMin = false;
    try { localStorage.removeItem("wrc-secret-sound"); } catch (e) {}
  }
  if (pick.has("secrets")) {
    state.unlocked = {}; state.secrets = {}; state.banners = {};
    if (!THEMES.some(t => t[0] === S().theme)) S().theme = DEFAULT_SETTINGS.theme;
  }
  save(); decoFor = undefined;
  applyDisplay(); applyTheme(); renderDrawer(); renderWeekly(); renderAll();
  if (typeof checkInfection === "function") checkInfection();
}

function applyDisplay() {
  const st = S(), b = document.body.classList;
  b.toggle("no-oracle", !st.show.oracle);
  b.toggle("no-tips", !st.show.tips);
  b.toggle("no-get", !st.show.get);
  b.toggle("compact", !!st.compact);
  b.toggle("reduce-motion", !!st.reduceMotion);
  document.documentElement.style.setProperty("--ts", String((+st.textSize || 100) / 100));
}
function applyTheme() {
  const sd = specialDay();
  const t = sd ? sd.theme : S().theme;
  document.body.dataset.theme = t;
  const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]').setAttribute("content", bg);
  if (native && native.setBarColor) try { native.setBarColor(bg, LIGHT_THEMES.has(t)); } catch (e) {}
  decorate(sd);
}

/* ---------- SPECIAL DAYS ----------
   A special day's theme replaces the chosen one for that whole day (phone's local
   date), then the chosen theme returns. Birthdays only exist once their code has
   been entered on this phone. */
const EQ_TERMS = [[485,324.96,1934.136],[203,337.23,32964.467],[199,342.08,20.186],[182,27.85,445267.112],[156,73.14,45036.886],[136,171.52,22518.443],[77,222.54,65928.934],[74,296.72,3034.906],[70,243.58,9037.513],[58,119.81,33718.147],[52,297.17,150.678],[50,21.02,2281.226],[45,247.54,29929.562],[44,325.15,31555.956],[29,60.93,4443.417],[18,155.12,67555.328],[17,288.79,4562.452],[16,198.04,62894.029],[14,199.76,31436.921],[12,95.39,14577.848],[12,287.11,31931.756],[12,320.81,34777.259],[9,227.73,1222.114],[8,15.45,16859.074]];
function equinox(year, autumn) { // Meeus, Astronomical Algorithms ch. 27: within a couple of minutes
  const Y = (year - 2000) / 1000, rad = Math.PI / 180;
  const j0 = autumn
    ? 2451810.21715 + 365242.01767 * Y - 0.11575 * Y * Y + 0.00337 * Y ** 3 + 0.00078 * Y ** 4
    : 2451623.80984 + 365242.37404 * Y + 0.05169 * Y * Y - 0.00411 * Y ** 3 - 0.00057 * Y ** 4;
  const T = (j0 - 2451545) / 36525, W = (35999.373 * T - 2.47) * rad;
  const dl = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W);
  const S = EQ_TERMS.reduce((a, [A, B, C]) => a + A * Math.cos((B + C * T) * rad), 0);
  const jde = j0 + 0.00001 * S / dl - 69 / 86400; // minus about a minute of TT-UTC difference
  return new Date((jde - 2440587.5) * 86400000);
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function specialDay(now = new Date()) {
  const m = now.getMonth() + 1, d = now.getDate(), y = now.getFullYear();
  for (const x of Object.values(state.secrets || {})) {
    if (x.type === "birthday" && x.month === m && x.day === d) return { id: x.id, theme: x.theme, label: `${x.name}'s birthday`, banner: x.message };
  }
  if (m === 12 && d === 25) return { id: "christmas", theme: "sd-christmas", label: "Christmas", fx: "snow" };
  if (m === 10 && d === 31) return { id: "halloween", theme: "sd-halloween", label: "Halloween" };
  if (m === 1 && d === 1) return { id: "newyear", theme: "sd-newyear", label: "New Year's", fx: "confetti" };
  if (m === 7 && d === 7) return { id: "d77", theme: "sd-77", label: "7/7", fx: "buddy" };
  if (sameDay(now, equinox(y, false))) return { id: "spring", theme: "sd-spring", label: "Spring equinox" };
  if (sameDay(now, equinox(y, true))) return { id: "autumn", theme: "sd-autumn", label: "Autumn equinox" };
  return null;
}
let decoFor = null;
function decorate(sd) {
  const key = sd ? sd.id : null;
  if (decoFor === key) return;
  decoFor = key;
  document.querySelectorAll(".snow,.buddy,.bdbanner").forEach(e => e.remove());
  if (!sd) return;
  if (sd.fx === "snow") document.body.insertAdjacentHTML("beforeend", `<div class="snow" aria-hidden="true"></div>`);
  if (sd.fx === "buddy") document.body.insertAdjacentHTML("beforeend", `<div class="buddy" aria-hidden="true"><svg viewBox="0 0 34 34">
    <path d="M17 2 L25 10 L22 17 L25 24 L17 32 L9 24 L12 17 L9 10 Z" fill="#e9d29a" opacity=".9"/><path d="M17 8 L22 13 L17 17 L12 13 Z M17 17 L22 21 L17 26 L12 21 Z" fill="#fbf6e6" opacity=".55"/>
    <circle class="eye" cx="17" cy="17" r="3.4" fill="#9fd6ff"/></svg></div>`);
  if (sd.fx === "confetti" && !S().reduceMotion && !sessionStorage.getItem("wrc-confetti")) {
    try { sessionStorage.setItem("wrc-confetti", "1"); } catch (e) {}
    setTimeout(confettiBurst, document.getElementById("intro") ? 2000 : 0); // after the launch animation
  }
  const yk = `${sd.id}-${new Date().getFullYear()}`;
  if (sd.banner && !state.banners[yk]) {
    state.banners[yk] = 1; save();
    document.body.insertAdjacentHTML("beforeend", `<div class="bdbanner" role="status">${esc(sd.banner)}<button aria-label="Dismiss" data-bdclose>×</button></div>`);
    document.querySelector("[data-bdclose]").addEventListener("click", e => e.target.parentElement.remove());
  }
}
function confettiBurst() {
    const cols = ["#ff3fa4", "#3ff0ff", "#b6ff3f", "#ffd23f", "#a35cff"];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement("i");
      c.className = "confetti";
      c.style.cssText = `left:${Math.random() * 100}vw;background:${cols[i % cols.length]};--dx:${(Math.random() - .5) * 120}px;--rot:${360 + Math.random() * 720}deg;--dur:${2 + Math.random() * 1.8}s;--delay:${Math.random() * .6}s`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 5000);
    }
}
function blinkBuddy() {
  const b = document.querySelector(".buddy"); if (!b) return;
  b.classList.add("blink"); setTimeout(() => b.classList.remove("blink"), 160);
}
setInterval(() => { // roll over to the next day's theme if the app stays open past midnight
  const sd = specialDay();
  if ((sd ? sd.id : null) !== decoFor) { applyTheme(); renderDrawer(); }
}, 60000);

/* ---------- SECRET CODES ----------
   Each secret is encrypted (AES-GCM, key from PBKDF2-SHA256 of the code) so the
   public code reveals nothing. Codes ignore capitals and spaces. Add new ones with
   scripts/add-secret.mjs (it writes web/secrets.js); the codes are never stored. */
const SEC = window.WRC_SECRETS || { salt: "", iter: 1, list: [] }; // from secrets.js
async function tryCode(raw) {
  const code = String(raw || "").toLowerCase().replace(/\s+/g, "");
  if (!code || !SEC.list.length || !window.crypto || !crypto.subtle) return null;
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(SEC.salt), iterations: SEC.iter }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  for (const x of SEC.list) {
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(x.i) }, key, unb64u(x.c));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { /* wrong code for this one */ }
  }
  return null;
}

/* ---------- BACKUP CODE ---------- */
const b64u = bytes => { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
async function makeBackup() {
  const payload = JSON.stringify({ v: 1, t: Object.keys(state.ticks), s: Object.keys(state.stars), m: Object.keys(state.mastered), a: Object.keys(state.alerts), h: state.hvMin ? 1 : 0, st: state.settings, x: state.secrets, b: state.banners, u: Object.keys(state.unlocked), w: state.weekly, rc: state.relicCounts, pc: state.partCounts, sa: state.scanAt, sf: state.scanFiles, ho: state.hvOwned ? 1 : 0, bd: state.building, bl: Object.keys(state.built) });
  const raw = new TextEncoder().encode(payload);
  if (window.CompressionStream) return "WRC1-" + b64u(await pipe(raw, new CompressionStream("deflate-raw")));
  return "WRC0-" + b64u(raw);
}
async function readBackup(code) {
  code = code.replace(/\s+/g, "");
  const m = /^WRC([01])-([A-Za-z0-9_-]+)$/.exec(code);
  if (!m) throw new Error("bad");
  let bytes = unb64u(m[2]);
  if (m[1] === "1") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  const p = JSON.parse(new TextDecoder().decode(bytes));
  if (p.v !== 1) throw new Error("bad");
  const set = arr => Object.fromEntries((arr || []).map(k => [k, 1]));
  return normaliseState({ ticks: set(p.t), stars: set(p.s), mastered: set(p.m), alerts: set(p.a), hvMin: !!p.h, settings: p.st, secrets: p.x, banners: p.b, unlocked: set(p.u), weekly: p.w, relicCounts: p.rc, partCounts: p.pc, scanAt: p.sa, scanFiles: p.sf, hvOwned: !!p.ho, building: p.bd, built: set(p.bl) });
}

/* ---------- COPY + TOAST ---------- */
async function copyText(t) {
  if (native && native.copy) { try { native.copy(t); return true; } catch (e) {} }
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
  try {
    const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch (e) { return false; }
}
function say(el, msg) {
  const host = el && el.closest(".backup, .summary, .tdd");
  const t = host && host.querySelector("[data-toast]");
  if (!t) return;
  t.textContent = msg; clearTimeout(t._t); t._t = setTimeout(() => { t.textContent = ""; }, 2500);
}

/* ---------- UNDO ----------
   Mastered, Building and scan changes show a small Undo bar for a few seconds. */
const snapState = () => JSON.stringify({ t: state.ticks, m: state.mastered, b: state.building, bl: state.built });
function offerUndo(msg, snap) {
  let bar = $("#undoBar");
  if (!bar) { bar = document.createElement("div"); bar.id = "undoBar"; bar.className = "undobar"; bar.setAttribute("role", "status"); document.body.appendChild(bar); }
  bar.innerHTML = `<span>${esc(msg)}</span><button class="linkbtn" id="undoBtn">Undo</button>`;
  bar.classList.add("show");
  clearTimeout(bar._t); bar._t = setTimeout(() => bar.classList.remove("show"), 5000);
  $("#undoBtn").onclick = () => {
    const o = JSON.parse(snap);
    Object.assign(state, { ticks: o.t, mastered: o.m, building: o.b, built: o.bl });
    save(); renderAll(); bar.classList.remove("show");
  };
}
window.offerUndo = offerUndo; window.snapState = snapState;

/* ---------- RELIC QUICK CARD ---------- */
function showRelic(r) {
  const own = (state.relicCounts || {})[r] || 0, rows = [];
  ITEMS.forEach(it => (it.parts || []).forEach(p => (p.r || []).forEach(([rn, rar]) => {
    if (rn !== r) return;
    const need = active(it) && unitsOf(it).some(u => u.full === p.full && !isTicked(u) && !u.whole);
    rows.push({ full: p.full, rar, need });
  })));
  rows.sort((a, b) => b.need - a.need || RAR_ORDER[a.rar] - RAR_ORDER[b.rar] || a.full.localeCompare(b.full));
  const st = relicStatus(r);
  $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card relcard"><div class="chead" style="cursor:default"><div class="ctop"><div class="name">${esc(r)}</div></div>
    <div class="meta"><span class="st ${stCls(r)}">${statusLabel(r)}</span><span class="cnt">${own ? `You have ${own}` : Object.keys(state.relicCounts || {}).length ? "None in your last scan" : ""}</span></div></div>
    <div class="mbody">${obtainable(r) && st !== "ba" ? `<div class="part"><b>Where to farm</b>${farmHTML(r)}</div>` : st === "ba" ? `<p>Baro Ki'Teer is selling this relic right now.</p>` : `<p>This relic is vaulted. You can trade for it, or buy it from Varzia when it's in Prime Resurgence.</p>`}
      <div class="part"><b>What's inside</b>${rows.map(x => `<div class="rrow"><span class="pn">${esc(x.full)}${x.need ? ` <span class="need">you need this</span>` : ""}</span><span class="rar ${x.rar}">${RAR[x.rar]}</span></div>`).join("") || `<p class="secsub">No part list for this relic.</p>`}</div></div>
    <button class="builtbtn" data-close>Close</button></article></div>`;
}

/* ---------- MODAL (Vault Watch) ---------- */
function openVault(itemId) {
  const it = BYID[itemId], a = alertsFor(it);
  a.forEach(x => { state.alerts[x.id] = 1; }); save();
  $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name">${esc(it.n)}</div>
    <div class="meta"><span class="tag">Vault Watch</span></div></div><div class="mbody">${a.map(x =>
      `<p><b>${esc(x.title)}</b>${x.end ? ` <span class="sub" style="margin:0">· ${x.type === "resurgence" ? "until" : "by"} ${fmtDate(x.end)}</span>` : ""}<br>${esc(x.text)}</p>`).join("")}</div>
    <button class="builtbtn" data-close>Got it</button></article></div>`;
  refreshCards(itemId);
}
let modalOnClose = null; // run once when the current pop-up closes
const closeModal = () => { $("#modalRoot").innerHTML = ""; const f = modalOnClose; modalOnClose = null; if (f) f(); };

/* ---------- TOUR + WHAT'S NEW ---------- */
const TOUR = [
  ["Welcome to Relic Companion", "Track everything that counts toward mastery: the parts you still need, which relics drop them, and where to farm them."],
  ["Four pages", "Swipe left and right, or tap the tabs: <b>Rotating</b> (vendors and weekly rewards), <b>Relic Runs</b> (what to crack and live fissures), <b>Favorites</b> and <b>Main</b> (everything that gives mastery, in Base and Prime)."],
  ["Star, tick, tap", "Tap ☆ to add an item to Favorites. Tick parts as you get them. Tap an item's name for its relics, best farms and other info."],
  ["Two side panels", "Swipe in from the left edge, or tap the menu button, for <b>Settings</b>. Swipe in from the right edge, or tap the checklist button, for your <b>daily and weekly checklist</b>."],
  ["Keep your progress safe", "Ticks are saved on this phone. Use <b>Save backup file</b> or <b>Copy backup code</b> in Settings to move them to a new phone. To see this tour again, tap the <b>?</b> at the bottom of the Settings menu."],
];
/* Update WHATS_NEW with each APK release: friends see it once after updating. */
const WHATS_NEW = {
  id: "2026-11-c",
  items: [
    "Main now covers everything that gives mastery. Base holds the regular versions, with variants like MK1 and Vandal in one card; Prime holds every Prime set. Each shows how many you've mastered.",
    "New categories: Vehicles, Arch-weapons, Modular weapons, Modular companions, Amps (with Sirocco) and Tauron Strikes.",
    "The search bar, category picker and a filter button stay pinned as you scroll. A ↑ button takes you back to the top.",
    "Favorites gets Base and Prime sections, sorting, and Trade chat shortcuts with a message builder.",
    "Tap any relic name for where to farm it and what's inside. Relic Runs and Rotating sections are dropdowns that remember how you left them.",
    "Settings are grouped into Appearance, Accessibility and Import Data. Save your backup as a file, hide Rotating vendors you don't use, and undo Mastered or scan changes.",
  ],
};
function showTour() {
  state.tourDone = true; state.newsSeen = WHATS_NEW.id; save();
  let i = 0;
  const draw = () => {
    const [t, b] = TOUR[i], last = i === TOUR.length - 1;
    $("#modalRoot").innerHTML = `<div class="modal tour" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name">${t}</div>
      <div class="meta"><span class="tag">Tour</span><span>${i + 1} / ${TOUR.length}</span></div></div>
      <div class="mbody"><p>${b}</p><div class="dots">${TOUR.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div></div>
      <div class="tourbtns">${last ? "" : `<button class="chip ghost" data-close>Skip</button>`}${i ? `<button class="chip ghost" data-tprev>Back</button>` : ""}<button class="chip" ${last ? "data-close" : "data-tnext"}>${last ? "Done" : "Next"}</button></div></article></div>`;
  };
  draw();
  const root = $("#modalRoot");
  const onClick = e => {
    if (!$("#modal") || !$("#modal").classList.contains("tour")) { root.removeEventListener("click", onClick); return; }
    if (e.target.closest("[data-tnext]")) { i = Math.min(TOUR.length - 1, i + 1); draw(); }
    if (e.target.closest("[data-tprev]")) { i = Math.max(0, i - 1); draw(); }
  };
  root.addEventListener("click", onClick);
  let x0 = null;
  root.ontouchstart = e => { x0 = e.touches[0].clientX; };
  root.ontouchend = e => {
    if (x0 == null || !$("#modal") || !$("#modal").classList.contains("tour")) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -50 && i < TOUR.length - 1) { i++; draw(); } else if (dx > 50 && i > 0) { i--; draw(); }
  };
}
function showWhatsNew() {
  state.newsSeen = WHATS_NEW.id; save();
  $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name">What's new</div></div>
    <div class="mbody"><ul class="news">${WHATS_NEW.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    <p class="secsub" style="margin:8px 0 0">You can turn this off under Settings › Info shown.</p></div>
    <button class="builtbtn" data-close>Got it</button></article></div>`;
}
function maybeNews() {
  if (state.newsSeen === WHATS_NEW.id) return;
  if (S().show.whatsnew) showWhatsNew(); else { state.newsSeen = WHATS_NEW.id; save(); }
}
const dueClaims = () => Object.keys(state.building).filter(id => state.building[id].e <= Date.now());
function showClaims(ids) {
  $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name">Foundry</div></div>
    <div class="mbody"><p>These items are ready to claim from the Foundry:</p><ul class="news">${ids.map(id => `<li>${esc((BYID[id] || {}).n || state.building[id].n || id)}</li>`).join("")}</ul></div>
    <button class="builtbtn" data-close>Got it</button></article></div>`;
  modalOnClose = () => {
    ids.forEach(id => { delete state.building[id]; state.built[id] = 1; });
    save(); renderMain(); renderFavs(); setTimeout(maybeNews, 250);
  };
}
function afterIntro() {
  if ($("#modal") || document.querySelector(".stalker-take")) return;
  if (!state.tourDone) { showTour(); return; }
  const c = dueClaims();
  if (c.length) showClaims(c); else maybeNews();
}

/* ---------- RENDER ALL ---------- */
let renderQueued = 0;
function renderAll() {
  refreshLiveSets();
  renderMain(); renderFavs(); renderRuns(); renderRotating(); renderUpdated();
}
function queueDerived() { // after a tick: refresh lists that depend on missing parts
  clearTimeout(renderQueued);
  renderQueued = setTimeout(() => { renderRuns(); renderTrade(); favSummary(); mainSummary(); }, 120);
}

/* ---------- EVENTS ---------- */
function bindEvents() {
  const pages = $("#pages");
  pages.addEventListener("toggle", e => { if (e.target.matches && e.target.matches("details.mgrp")) fillMg(e.target); }, true);
  pages.addEventListener("change", e => {
    const dk = e.target.dataset.duc;
    if (dk != null) {
      state.ducKeep = state.ducKeep || {};
      if (e.target.checked) delete state.ducKeep[dk]; else state.ducKeep[dk] = 1;
      save(); const t = $("#ducTot"); if (t) t.innerHTML = ducatTotal(); return;
    }
    const mid = e.target.dataset.m;
    if (mid) { // a modular piece: its tick is Mastered
      const snap = snapState(), it = BYID[mid];
      if (e.target.checked) { state.mastered[mid] = 1; blinkBuddy(); } else delete state.mastered[mid];
      save(); refreshCards(mid); queueDerived();
      offerUndo(`${it ? it.n : "Item"} ${e.target.checked ? "marked mastered" : "unmarked"}`, snap); return;
    }
    const u = e.target.dataset.u; if (!u) return;
    const id = e.target.dataset.it, it = BYID[id], was = it && readyToBuild(it), hadB = !!(state.building[id] || state.built[id]);
    if (e.target.checked) { state.ticks[u] = 1; blinkBuddy(); } else { delete state.ticks[u]; clearBuild(id); }
    save(); refreshCards(id); queueDerived();
    if (it && (was !== readyToBuild(it) || (hadB && !e.target.checked))) setTimeout(() => { renderMain(); renderFavs(); }, 350);
  });
  pages.addEventListener("click", async e => {
    const t = e.target;
    const star = t.closest("[data-star]");
    if (star) {
      const id = star.dataset.star;
      if (state.stars[id]) delete state.stars[id]; else state.stars[id] = 1;
      save();
      document.querySelectorAll(`[data-star="${id}"]`).forEach(b => { b.classList.toggle("on", !!state.stars[id]); b.textContent = state.stars[id] ? "★" : "☆"; });
      refreshCards(id); renderFavs(); renderRuns(); renderRotating();
      return;
    }
    const vw = t.closest("[data-vw]");
    if (vw) { openVault(vw.dataset.vw); return; }
    const da = t.closest("[data-ducall]");
    if (da) {
      state.ducKeep = {};
      if (da.dataset.ducall === "0") ducatSpares().forEach(x => { state.ducKeep[x.full] = 1; });
      save(); renderRotating(); return;
    }
    const rb = t.closest("[data-relic]");
    if (rb) { showRelic(rb.dataset.relic); return; }
    const jp = t.closest("[data-jump]");
    if (jp) { jumpTo(jp.dataset.jump); return; }
    const m = t.closest("[data-mastered]");
    if (m) {
      const id = m.dataset.mastered, snap = snapState(), it = BYID[id];
      const on = !state.mastered[id];
      if (!on) delete state.mastered[id]; else { state.mastered[id] = 1; clearBuild(id); }
      save(); renderMain(); renderFavs(); renderRuns(); renderRotating();
      offerUndo(`${it ? it.n : "Item"} ${on ? "marked mastered" : "unmarked"}`, snap);
      return;
    }
    const bb = t.closest("[data-build]");
    if (bb) {
      const it = BYID[bb.dataset.build]; if (!it) return;
      const snap = snapState();
      state.building[it.id] = { e: Date.now() + buildHours(it) * 3600e3, n: it.n };
      save(); renderMain(); renderFavs();
      offerUndo(`${it.n} is building`, snap);
      return;
    }
    const ex = t.closest("[data-exp]");
    if (ex && !t.closest("button.star, .vw")) {
      const id = ex.dataset.exp, opening = !expanded.has(id);
      const was = [...expanded];
      expanded.clear(); if (opening) expanded.add(id); // one open card at a time keeps the list short
      new Set([...was, id]).forEach(x => document.querySelectorAll(`.card[data-item="${x}"]`).forEach(card => {
        const open = expanded.has(x), more = card.querySelector(".more"); if (!more) return;
        card.classList.toggle("open", open);
        more.classList.toggle("hidden", !open);
        more.innerHTML = open ? moreHTML(BYID[x]) : "";
        card.querySelector(".expbtn").textContent = expLabel(BYID[x]);
      }));
      return;
    }
    const tier = t.closest("[data-tier]");
    if (tier) {
      runsTier = tier.dataset.tier;
      document.querySelectorAll("[data-tier]").forEach(b => b.setAttribute("aria-pressed", b === tier));
      renderRuns(); return;
    }
    const cp = t.closest("[data-copy]");
    if (cp) { const ok = await copyText(cp.dataset.copy); cp.textContent = ok ? "Copied" : "Blocked"; setTimeout(() => { cp.textContent = "Copy"; }, 1800); }
  });

  $("#runs").addEventListener("click", e => {
    const b = e.target.closest("[data-fmode]"); if (!b) return;
    S().fissMode = b.dataset.fmode; save(); renderRuns();
  });
  $("#rotating").addEventListener("toggle", e => {
    const d = e.target; if (!d.matches || !d.matches("details.rot")) return;
    S().rotOpen[d.dataset.rot] = d.open ? 1 : 0; save();
  }, true);
  $("#runs").addEventListener("toggle", e => {
    const d = e.target; if (!d.matches || !d.matches("details.rsec")) return;
    S().runsOpen[d.dataset.runs] = d.open ? 1 : 0; save();
  }, true);
  $("#tabs").addEventListener("click", e => { const a = e.target.closest("[data-page]"); if (a) goPage(+a.dataset.page, true); });
  $("#menuBtn").addEventListener("click", () => setDrawer(true));
  $("#scrim").addEventListener("click", () => { setDrawer(false); setWeekly(false); });
  $("#weeklyBtn").addEventListener("click", () => setWeekly(true));
  $("#modalRoot").addEventListener("click", e => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });

  const dr = $("#drawer");
  dr.addEventListener("click", async e => {
    const th = e.target.closest("[data-theme-set]");
    if (th) { S().theme = th.dataset.themeSet; save(); applyTheme(); dr.querySelectorAll("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", b === th)); return; }
    const f = e.target.closest("[data-farm]");
    if (f) { S().farm = f.dataset.farm; save(); renderDrawer(); renderOpenCards(); return; }
    if (e.target.id === "codeBtn") {
      const msg = $("#codeMsg"); msg.className = "codemsg"; msg.textContent = "Checking…";
      const got = await tryCode($("#codeIn").value);
      if (got && got.id) {
        if (got.type !== "unlock") { state.secrets[got.id] = got; save(); }
        msg.className = "codemsg ok"; msg.textContent = "Secret unlocked!"; $("#codeIn").value = "";
        if (got.type === "unlock") setTimeout(() => { setDrawer(false); codeUnlock(got); }, 700);
        applyTheme();
      } else { msg.className = "codemsg bad"; msg.textContent = "This code is invalid."; }
      return;
    }
    if (e.target.id === "tourBtn") { setDrawer(false); setTimeout(showTour, 250); return; }
    if (e.target.id === "clearBtn") { setDrawer(false); setTimeout(showClear, 250); return; }
    if (e.target.id === "invBtn") { setDrawer(false); setTimeout(showInventory, 250); return; }
    if (e.target.id === "scanCancel") { if (window.cancelScan) window.cancelScan(); return; }
    if (e.target.id === "bkCopy") {
      const code = await makeBackup(); const ok = await copyText(code);
      $("#bkIn").value = code; say(e.target, ok ? "Backup code copied" : "Copy blocked: the code is in the box below"); return;
    }
    if (e.target.id === "bkSave") { saveBackupFile(e.target); return; }
    if (e.target.id === "bkRestore") {
      const btn = e.target;
      let next;
      try { next = await readBackup($("#bkIn").value); } catch (err) { say(btn, "That code doesn't look right"); return; }
      if (!btn._armed) { btn._armed = 1; btn.textContent = "Tap again to replace this phone's progress"; setTimeout(() => { btn._armed = 0; btn.textContent = "Restore"; }, 4000); return; }
      state = next; save(); decoFor = undefined; renderWeekly(); applyDisplay(); applyTheme(); renderDrawer(); renderAll(); say($("#bkRestore"), "Progress restored");
    }
  });
  dr.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.show) { S().show[t.dataset.show] = t.checked; save(); applyDisplay(); renderOpenCards(); return; }
    if (t.dataset.disp) { S()[t.dataset.disp] = t.checked; save(); applyDisplay(); return; }
    if (t.dataset.vend) { if (t.checked) delete S().hideVend[t.dataset.vend]; else S().hideVend[t.dataset.vend] = 1; save(); renderRotating(); return; }
    if (t.id === "bkFile" && t.files && t.files[0]) {
      const f = t.files[0]; t.value = "";
      f.text().then(txt => { $("#bkIn").value = txt.trim(); say($("#bkRestore"), "Loaded. Tap Restore to use it"); });
      return;
    }
    if (t.id === "startSel") { S().startPage = +t.value; save(); }
    if (t.dataset.scan && t.files && t.files[0]) { const f = t.files[0]; t.value = ""; if (window.runScan) window.runScan(t.dataset.scan, f); }
  });
  dr.addEventListener("input", e => {
    if (e.target.id !== "tsize") return;
    S().textSize = +e.target.value; $("#tsizeOut").textContent = e.target.value + "%"; save(); applyDisplay();
  });
  bindSoundPicker(dr);
  dr.addEventListener("keydown", e => { if (e.target.id === "codeIn" && e.key === "Enter") $("#codeBtn").click(); });
}
function renderOpenCards() { expanded.forEach(id => refreshCards(id)); }

/* ---------- PAGES (swipe) ---------- */
/* A floating up-arrow once you've scrolled a long way down a page */
function bindUpArrow() {
  const b = document.createElement("button");
  b.id = "upBtn"; b.className = "upbtn"; b.setAttribute("aria-label", "Back to top"); b.innerHTML = "↑";
  document.body.appendChild(b);
  const cur = () => document.querySelectorAll(".page")[page];
  const check = () => { const p = cur(); b.classList.toggle("show", !!p && p.scrollTop > 900 && !drawerOpen && !weeklyOpen); };
  document.querySelectorAll(".page").forEach(p => p.addEventListener("scroll", check, { passive: true }));
  b.addEventListener("click", () => { const p = cur(); if (p) p.scrollTo({ top: 0, behavior: S().reduceMotion ? "auto" : "smooth" }); });
  window.__upCheck = check;
}
let page = PAGE_MAIN; // replaced by the start page setting at launch
function goPage(i, smooth) {
  const p = $("#pages");
  p.scrollTo({ left: i * p.clientWidth, behavior: smooth ? "smooth" : "auto" });
  setTab(i);
}
function setTab(i) { page = i; if (window.__upCheck) window.__upCheck(); document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", +a.dataset.page === i)); checkBaro(); }
function bindPages() {
  const p = $("#pages"); let raf = 0;
  p.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const i = Math.round(p.scrollLeft / p.clientWidth); if (i !== page) setTab(i); });
  }, { passive: true });
  window.addEventListener("resize", () => { p.scrollLeft = page * p.clientWidth; });
}

/* ---------- PULL TO REFRESH (Rotating and Relic Runs) ---------- */
function bindPullRefresh() {
  ["#pg-rotating", "#pg-runs"].forEach(sel => {
    const pg = $(sel);
    const tip = document.createElement("div");
    tip.className = "ptr"; tip.setAttribute("aria-hidden", "true");
    pg.prepend(tip);
    let y0 = null, x0 = 0, pull = 0, busy = false;
    pg.addEventListener("touchstart", e => {
      if (busy || pg.scrollTop > 0 || drawerOpen || weeklyOpen) { y0 = null; return; }
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; pull = 0;
    }, { passive: true });
    pg.addEventListener("touchmove", e => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
      if (pull === 0 && Math.abs(dx) > Math.abs(dy)) { y0 = null; return; } // a sideways swipe between pages
      pull = Math.max(0, Math.min(90, dy / 2));
      tip.style.transform = `translateY(${pull}px)`;
      tip.style.opacity = String(Math.min(1, pull / 60));
      tip.textContent = pull >= 60 ? "Release to refresh" : "Pull to refresh";
    }, { passive: true });
    pg.addEventListener("touchend", async () => {
      if (y0 == null) return;
      y0 = null;
      if (pull < 60) { tip.style.transform = ""; tip.style.opacity = "0"; return; }
      busy = true; tip.textContent = "Refreshing…"; tip.style.transform = "translateY(60px)";
      try { await loadLive(); } catch (e) {}
      tip.textContent = "Updated"; setTimeout(() => { tip.style.transform = ""; tip.style.opacity = "0"; busy = false; }, 600);
    });
  });
}

/* ---------- SIDE PANELS: settings (left) and checklist (right) ---------- */
let drawerOpen = false, weeklyOpen = false;
function setDrawer(open) {
  drawerOpen = open;
  if (open && weeklyOpen) setWeekly(false);
  document.body.classList.toggle("drawer-open", open);
  $("#drawer").style.transform = ""; $("#scrim").style.opacity = "";
  if (!open) document.activeElement && document.activeElement.blur && document.activeElement.blur();
}
function setWeekly(open) {
  weeklyOpen = open;
  if (open && drawerOpen) setDrawer(false);
  if (open) renderWeekly();
  document.body.classList.toggle("weekly-open", open);
  $("#weekly").style.transform = ""; $("#scrim").style.opacity = "";
  if (!open) document.activeElement && document.activeElement.blur && document.activeElement.blur();
}
function bindDrawerGesture() {
  const dr = $("#drawer"), wk = $("#weekly"), sc = $("#scrim");
  let mode = null, x0 = 0, y0 = 0, w = 0, dx = 0;
  document.addEventListener("touchstart", e => {
    const t = e.touches[0]; if (!t || e.touches.length > 1) return;
    x0 = t.clientX; y0 = t.clientY; dx = 0; mode = null;
    if ($("#modal")) return;
    const none = !drawerOpen && !weeklyOpen;
    if (none && x0 <= EDGE_PX && !e.target.closest(".menubtn")) { mode = "lopen"; w = dr.offsetWidth; }
    else if (none && x0 >= innerWidth - EDGE_PX && !e.target.closest(".menubtn")) { mode = "ropen"; w = wk.offsetWidth; }
    else if (drawerOpen && (e.target.closest("#drawer") || e.target === sc)) { mode = "lclose?"; w = dr.offsetWidth; }
    else if (weeklyOpen && (e.target.closest("#weekly") || e.target === sc)) { mode = "rclose?"; w = wk.offsetWidth; }
    if (mode === "lopen" || mode === "ropen") { document.body.classList.add("dragging"); e.preventDefault(); }
  }, { passive: false, capture: true });
  document.addEventListener("touchmove", e => {
    if (!mode) return;
    const t = e.touches[0]; dx = t.clientX - x0;
    if (mode.endsWith("?")) {
      if (Math.abs(t.clientY - y0) > Math.abs(dx) + 6) { mode = null; return; }
      if (mode === "lclose?" && dx < -10) mode = "lclose";
      else if (mode === "rclose?" && dx > 10) mode = "rclose";
      else return;
      document.body.classList.add("dragging");
    }
    e.preventDefault();
    let el, off;
    if (mode === "lopen") { el = dr; off = Math.min(0, dx - w); }
    else if (mode === "lclose") { el = dr; off = Math.min(0, dx); }
    else if (mode === "ropen") { el = wk; off = Math.max(0, w + dx); }
    else { el = wk; off = Math.max(0, dx); }
    el.style.transform = `translateX(${off}px)`;
    sc.style.opacity = String(1 - Math.abs(off) / w);
    sc.style.pointerEvents = "auto";
  }, { passive: false, capture: true });
  const end = () => {
    if (!mode || mode.endsWith("?")) { mode = null; return; }
    document.body.classList.remove("dragging"); sc.style.pointerEvents = "";
    if (mode === "lopen") setDrawer(dx > w * 0.3);
    else if (mode === "lclose") setDrawer(dx > -w * 0.3);
    else if (mode === "ropen") setWeekly(-dx > w * 0.3);
    else setWeekly(dx < w * 0.3);
    mode = null;
  };
  document.addEventListener("touchend", end, { capture: true });
  document.addEventListener("touchcancel", end, { capture: true });
}

/* ---------- CHECKLIST (right panel) ----------
   Ticks are stored with the reset period they were made in, so they clear on their
   own: daily at 00:00 UTC, weekly on Monday 00:00 UTC (Warframe's resets). */
const CHECKLIST = {
  daily: [["Activities", [["sortie", "Sortie"]]]],
  weekly: [
    ["Vendors", [["palladino", "Palladino (Iron Wake)"]]],
    ["Activities", [["archon", "Archon Hunt"], ["descendia", "Descendia"], ["descendia-sp", "Descendia (Steel Path)"]]],
  ],
};
const utcDay = d => d.toISOString().slice(0, 10);
function periodKey(sec, now = new Date()) {
  if (sec === "daily") return utcDay(now);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return utcDay(d);
}
const wTicked = (sec, id) => state.weekly.t[`${sec}:${id}`] === periodKey(sec);
function resetNote(sec) { // Warframe resets at 00:00 UTC; say when that is on this phone
  const r = new Date(); r.setUTCHours(0, 0, 0, 0);
  if (sec === "weekly") r.setUTCDate(r.getUTCDate() + ((8 - r.getUTCDay()) % 7 || 7)); // next Monday
  const t = r.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sec === "daily" ? `Resets every day at ${t}.` : `Resets every ${r.toLocaleDateString(undefined, { weekday: "long" })} at ${t}.`;
}
function renderWeekly() {
  const row = (sec, id, label, custom) => `<li class="${custom ? "custom" : ""}"><label><input type="checkbox" data-w="${sec}:${id}"${wTicked(sec, id) ? " checked" : ""}>${custom
    ? `<input class="wtext" data-wedit="${id}" value="${esc(label)}" placeholder="Type your own item" aria-label="Your item">` : `<span>${esc(label)}</span>`}</label>${custom ? `<button class="wdel" data-wdel="${id}" aria-label="Remove item">×</button>` : ""}</li>`;
  const section = sec => {
    const mine = state.weekly.c.filter(x => x.sec === sec);
    const all = CHECKLIST[sec].flatMap(([, list]) => list).length + mine.length;
    const done = CHECKLIST[sec].flatMap(([, list]) => list).filter(([id]) => wTicked(sec, id)).length + mine.filter(x => wTicked(sec, x.id)).length;
    return `<section class="wsec"><div class="wsechead"><h3>${sec === "daily" ? "Daily" : "Weekly"}</h3><span class="wcount">${done} / ${all}</span></div>
      <p class="secsub">${resetNote(sec)}</p>
      ${CHECKLIST[sec].map(([g, list]) => `<div class="group">${g}</div><ul>${list.map(([id, l]) => row(sec, id, l)).join("")}</ul>`).join("")}
      ${mine.length ? `<div class="group">Your items</div><ul>${mine.map(x => row(sec, x.id, x.text, true)).join("")}</ul>` : ""}
      <button class="wadd" data-wadd="${sec}" aria-label="Add a ${sec} item">+</button></section>`;
  };
  $("#weekly").innerHTML = `<h2>Checklist</h2>${section("daily")}${section("weekly")}`;
  checklistDot();
}
/* A small dot on the checklist button while anything for today or this week is left */
function checklistDot() {
  const left = ["daily", "weekly"].some(sec => CHECKLIST[sec].flatMap(([, l]) => l).some(([id]) => !wTicked(sec, id))
    || state.weekly.c.some(x => x.sec === sec && x.text && !wTicked(sec, x.id)));
  const b = $("#weeklyBtn"); if (b) b.classList.toggle("dot", left);
}
function bindWeekly() {
  const wk = $("#weekly");
  wk.addEventListener("change", e => {
    const k = e.target.dataset.w; if (!k) return;
    const sec = k.split(":")[0];
    if (e.target.checked) { state.weekly.t[k] = periodKey(sec); blinkBuddy(); } else delete state.weekly.t[k];
    save(); renderWeekly();
  });
  wk.addEventListener("click", e => {
    const add = e.target.closest("[data-wadd]");
    if (add) {
      const id = "c" + Date.now().toString(36);
      state.weekly.c.push({ id, sec: add.dataset.wadd, text: "" }); save(); renderWeekly();
      const inp = wk.querySelector(`[data-wedit="${id}"]`); if (inp) inp.focus();
      return;
    }
    const del = e.target.closest("[data-wdel]");
    if (del) { const id = del.dataset.wdel; state.weekly.c = state.weekly.c.filter(x => x.id !== id); Object.keys(state.weekly.t).forEach(k => { if (k.endsWith(":" + id)) delete state.weekly.t[k]; }); save(); renderWeekly(); return; }
    if (e.target.matches(".wtext")) e.preventDefault(); // tapping the text edits it instead of ticking
  });
  wk.addEventListener("input", e => {
    const id = e.target.dataset.wedit; if (!id) return;
    const x = state.weekly.c.find(c => c.id === id); if (x) { x.text = e.target.value; save(); }
  });
  wk.addEventListener("focusout", e => {
    const id = e.target.dataset && e.target.dataset.wedit; if (!id) return;
    const x = state.weekly.c.find(c => c.id === id);
    if (x && !x.text.trim()) { state.weekly.c = state.weekly.c.filter(c => c !== x); save(); setTimeout(renderWeekly, 0); }
    else if (x) checklistSecret(x.text, x.sec);
  });
  wk.addEventListener("keydown", e => { if (e.target.matches(".wtext") && e.key === "Enter") e.target.blur(); });
  setInterval(() => { if (weeklyOpen && !wk.contains(document.activeElement)) renderWeekly(); else checklistDot(); }, 60000);
  checklistDot();
}

/* Android back button: close things before leaving the app */
window.wrcBack = function () {
  if ($("#modal")) { closeModal(); return true; }
  if (drawerOpen) { setDrawer(false); return true; }
  if (weeklyOpen) { setWeekly(false); return true; }
  const home = +S().startPage || 0;
  if (page !== home) { goPage(home, true); return true; }
  return false;
};

/* ---------- NETWORK ---------- */
async function fetchJSON(url, ms = 15000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
/* The Android shell can fetch hosts that don't send CORS headers (content.warframe.com) */
const pending = {}; let reqN = 0;
window.__wrcHttp = (id, ok, body) => { const p = pending[id]; if (!p) return; delete pending[id]; ok ? p.res(body) : p.rej(new Error(body)); };
function nativeGet(url) {
  return new Promise((res, rej) => {
    if (!native || !native.httpGet) return rej(new Error("no bridge"));
    const id = "r" + (++reqN); pending[id] = { res, rej };
    native.httpGet(url, id);
    setTimeout(() => { if (pending[id]) { delete pending[id]; rej(new Error("timeout")); } }, 20000);
  });
}
async function getJSONAny(url) {
  try { return await fetchJSON(url); } catch (e) { if (!native) throw e; return JSON.parse(await nativeGet(url)); }
}

function validData(d) { return d && d.schema === SCHEMA && Array.isArray(d.items) && d.items.length > 0 && d.relics; }
async function loadData() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY_DATA) || "null"); } catch (e) {}
  if (cached && validData(cached.d)) setData(cached.d, cached.at, "cache");
  else {
    try { const d = await fetchJSON("data/relics.json"); if (validData(d)) setData(d, Date.parse(d.generated) || 0, "bundled"); } catch (e) {}
  }
  renderAll();
  try {
    const d = await getJSONAny(DATA_URL + "?t=" + Math.floor(Date.now() / 60000));
    if (!validData(d)) throw new Error("bad data");
    const at = Date.now();
    DATA_OFFLINE = false;
    setData(d, at, "remote");
    try { localStorage.setItem(KEY_DATA, JSON.stringify({ at, d })); } catch (e) {}
    renderAll();
  } catch (e) {
    DATA_OFFLINE = true; renderUpdated();
  }
}

/* ---------- DUCAT TRADE-INS (under the Void Trader) ----------
   Spare Prime parts from the last Parts scan that belong to Primes you've mastered.
   Copies still needed for a Prime you haven't mastered (e.g. Bronco Prime parts for
   Akbronco Prime) are held back. Untick anything you'd rather keep. */
function ducatSpares() {
  const owned = state.partCounts || {}, reserve = new Map(), home = new Map();
  ITEMS.forEach(it => (it.parts || []).forEach(p => home.set(p.full, { it, d: p.d })));
  ITEMS.filter(active).forEach(it => unitsOf(it).forEach(u => { if (!u.whole && !u.own && u.full) reserve.set(u.full, (reserve.get(u.full) || 0) + 1); }));
  return Object.entries(owned).map(([full, n]) => {
    const h = home.get(full); if (!h || !h.d || !state.mastered[h.it.id]) return null;
    const spare = n - (reserve.get(full) || 0);
    return spare > 0 ? { full, n: spare, d: h.d, tot: spare * h.d } : null;
  }).filter(Boolean).sort((a, b) => b.tot - a.tot || a.full.localeCompare(b.full));
}
function ducatHTML() {
  const list = ducatSpares(), keep = state.ducKeep || {};
  let h = `<div class="ducats"><h4>Spare parts for Ducats</h4><p class="secsub">Parts from your last scan that belong to Primes you've mastered, minus any still needed for others. Untick anything you want to keep; trade the rest at a Relay's Ducat kiosk.</p>`;
  if (!Object.keys(state.partCounts || {}).length) return h + `<p class="empty">Upload a Parts recording under Import Data in Settings to see what you can trade in.</p></div>`;
  if (!list.length) return h + `<p class="empty">Nothing spare in your last scan from a Prime you've mastered.</p></div>`;
  h += `<div class="controls"><button class="chip ghost" data-ducall="1">Select all</button><button class="chip ghost" data-ducall="0">Select none</button></div><div class="rlist">`;
  h += list.map(x => `<label class="rrow ducrow"><input type="checkbox" data-duc="${esc(x.full)}"${keep[x.full] ? "" : " checked"}><span class="pn">${esc(x.full)}${x.n > 1 ? ` <span class="sub" style="margin:0">x${x.n}</span>` : ""}</span><span class="pr">${x.n > 1 ? `${x.d} each · ` : ""}<b>${x.tot}</b></span></label>`).join("");
  return h + `</div><div class="ductot" id="ducTot">${ducatTotal(list)}</div></div>`;
}
function ducatTotal(list = ducatSpares()) {
  const keep = state.ducKeep || {}, sel = list.filter(x => !keep[x.full]);
  const parts = sel.reduce((a, x) => a + x.n, 0), d = sel.reduce((a, x) => a + x.tot, 0);
  return `Selected: <b>${parts}</b> part${parts === 1 ? "" : "s"} · <b class="gold">${d.toLocaleString()}</b> Ducats`;
}

/* Live worldstate: api.warframestat.us, falling back to DE's raw worldState.php */
const ms = v => { if (v == null) return 0; if (typeof v === "number") return v; if (v.$date) return +(v.$date.$numberLong || v.$date); const t = Date.parse(v); return isNaN(t) ? 0 : t; };
async function liveFromStat() {
  const q = "?language=en";
  const rs = await Promise.allSettled(["voidTrader", "dailyDeals", "steelPath", "fissures", "vaultTrader", "duviriCycle"].map(k => getJSONAny(`${WS}/${k}${q}`)));
  if (rs.every(r => r.status === "rejected")) throw new Error("warframestat unreachable");
  const v = i => rs[i].status === "fulfilled" ? rs[i].value : null;
  const vt = v(0), dd = v(1), sp = v(2), fi = v(3), vz = v(4), dc = v(5);
  const hard = dc && Array.isArray(dc.choices) ? dc.choices.find(x => /hard|steel/i.test(x.category || "")) : null;
  return {
    baro: vt ? { active: !!vt.active, activation: ms(vt.activation), expiry: ms(vt.expiry), location: vt.location, inventory: (vt.inventory || []).map(x => ({ n: x.item, ducats: x.ducats, credits: x.credits })) } : null,
    darvo: (Array.isArray(dd) ? dd : []).map(d => ({ n: d.item, orig: d.originalPrice, sale: d.salePrice, total: d.total, sold: d.sold, expiry: ms(d.expiry) })),
    teshin: sp && sp.currentReward ? { n: sp.currentReward.name, cost: sp.currentReward.cost, expiry: ms(sp.expiry) } : null,
    fissures: (Array.isArray(fi) ? fi : []).filter(f => !f.expired).map(f => ({ node: f.node, type: f.missionType || f.missionKey || "", tier: f.tier, expiry: ms(f.expiry), storm: !!f.isStorm, hard: !!f.isHard })),
    varzia: vz && (vz.inventory || []).length ? { expiry: ms(vz.expiry), inventory: vz.inventory.map(x => ({ n: x.item })) } : null,
    circuit: hard && Array.isArray(hard.choices) ? hard.choices.map(String) : null,
  };
}
const HUBS = { MercuryHUB: "Larunda Relay (Mercury)", VenusHUB: "Vesper Relay (Venus)", EarthHUB: "Strata Relay (Earth)", SaturnHUB: "Kronia Relay (Saturn)", EuropaHUB: "Leonov Relay (Europa)", ErisHUB: "Kuiper Relay (Eris)", PlutoHUB: "Orcus Relay (Pluto)" };
const VOIDT = { VoidT1: "Lith", VoidT2: "Meso", VoidT3: "Neo", VoidT4: "Axi", VoidT5: "Requiem", VoidT6: "Omnia" };
const prettyPath = p => { const s = String(p || "").split("/").pop().replace(/StoreItem$/, ""); return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2"); };
const mt = s => String(s || "").replace(/^MT_/, "").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const nodeName = n => (DATA.nodes || {})[n] || n;
async function liveFromRaw() {
  const w = await getJSONAny(WS_RAW);
  const vt = (w.VoidTraders || [])[0], now = Date.now();
  const fis = [];
  (w.ActiveMissions || []).forEach(m => fis.push({ node: nodeName(m.Node), type: mt(m.MissionType), tier: VOIDT[m.Modifier] || m.Modifier, expiry: ms(m.Expiry), storm: false, hard: !!m.Hard }));
  (w.VoidStorms || []).forEach(m => fis.push({ node: nodeName(m.Node), type: "Void Storm", tier: VOIDT[m.ActiveMissionTier] || m.ActiveMissionTier, expiry: ms(m.Expiry), storm: true, hard: false }));
  const pv = (w.PrimeVaultTraders || [])[0];
  return {
    baro: vt ? { active: ms(vt.Activation) < now && ms(vt.Expiry) > now, activation: ms(vt.Activation), expiry: ms(vt.Expiry), location: HUBS[vt.Node] || nodeName(vt.Node), inventory: (vt.Manifest || []).map(x => ({ n: prettyPath(x.ItemType), ducats: x.PrimePrice, credits: x.RegularPrice })) } : null,
    darvo: (w.DailyDeals || []).map(d => ({ n: prettyPath(d.StoreItem), orig: d.OriginalPrice, sale: d.SalePrice, total: d.AmountTotal, sold: d.AmountSold, expiry: ms(d.Expiry) })),
    teshin: null,
    fissures: fis,
    varzia: pv ? { expiry: ms(pv.Expiry), inventory: (pv.Manifest || []).map(x => ({ n: prettyPath(x.ItemType) })) } : null,
    circuit: ((w.EndlessXpChoices || []).find(x => /HARD/.test(x.Category || "")) || {}).Choices || null,
  };
}
async function loadLive() {
  let live = null;
  try { live = await liveFromStat(); } catch (e) { try { live = await liveFromRaw(); } catch (e2) { live = null; } }
  if (live) {
    LIVE = live; LIVE_AT = Date.now(); LIVE_OFFLINE = false;
    try { localStorage.setItem(KEY_LIVE, JSON.stringify({ at: LIVE_AT, l: LIVE })); } catch (e) {}
  } else LIVE_OFFLINE = !!LIVE;
  refreshLiveSets(); renderRotating(); renderRuns(); renderUpdated(); renderOpenCards(); checkBaro();
  ITEMS.forEach(it => { if (state.stars[it.id]) refreshCards(it.id); });
}
function loadCachedLive() {
  try { const c = JSON.parse(localStorage.getItem(KEY_LIVE) || "null"); if (c && c.l) { LIVE = c.l; LIVE_AT = c.at; LIVE_OFFLINE = true; } } catch (e) {}
}

/* ---------- COUNTDOWNS ---------- */
setInterval(() => {
  const now = Date.now();
  document.querySelectorAll("[data-until]").forEach(s => {
    const t = +s.dataset.until; s.textContent = t > now ? left(t) : "now";
  });
}, 1000);
setInterval(renderUpdated, 30000);

/* ---------- INTRO ---------- */
function runIntro() {
  const el = $("#intro");
  const reduce = S().reduceMotion || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const done = () => { if (el.classList.contains("done")) return; el.classList.add("done"); setTimeout(() => { el.remove(); afterIntro(); }, 500); };
  const later = () => { if (Date.now() < (window.__introHold || 0)) setTimeout(later, 200); else done(); };
  setTimeout(later, reduce ? 400 : 1900);
}

/* ---------- TOP BAR HEIGHT ---------- */
function trackTopbar() {
  const tb = document.querySelector(".topbar");
  const set = () => document.documentElement.style.setProperty("--toph", tb.offsetHeight + "px");
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(tb); else window.addEventListener("resize", set);
}

/* ---------- START ---------- */
applyDisplay();
applyTheme();
trackTopbar();
runIntro();
buildMain(); buildFavs(); buildRuns(); renderDrawer();
bindEvents(); bindPages(); bindDrawerGesture(); bindWeekly(); bindPullRefresh(); bindUpArrow(); startHidden();
page = +S().startPage; if (!(page >= 0 && page <= 3)) page = PAGE_MAIN;
requestAnimationFrame(() => goPage(page, false));
loadCachedLive();
loadData().then(loadLive);
setInterval(loadLive, LIVE_REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - LIVE_AT > 60000) loadLive(); });
