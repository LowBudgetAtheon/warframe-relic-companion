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
const PG = { profile: 0, coll: 1, home: 2, relics: 3, vendors: 4 }; // bottom bar, left to right
const PAGE_MAIN = PG.coll;

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
const LIGHT_THEMES = new Set(["orokin-light", "duviri", "sd-spring", "sd-77-solar", "sd-77-arc", "sd-77-void", "sd-77-prism"]);
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
const START_PAGES = [[PG.home, "Home"], [PG.coll, "Collection"], [PG.relics, "Relics"], [PG.vendors, "Vendors"], [PG.profile, "Profile"]];
const CATS = [
  ["all", "All"], ["warframes", "Warframes"], ["weapons", "Weapons"], ["vehicles", "Vehicles"], ["archweapons", "Arch-weapons"],
  ["companions", "Companions"], ["modweapons", "Modular weapons"], ["modcompanions", "Modular companions"], ["amps", "Amps"], ["tauron", "Tauron Strikes"],
];
const CAT_LABEL = Object.fromEntries(CATS);
const CAT_INTRO = {
  all: "Everything that counts toward mastery. Base holds the regular versions and their variants; Prime holds every Prime set. Tap an item for its own page, or its star to follow it on Home.",
  warframes: "Every Warframe. Tap a card's parts as you collect them, then Mastered once it's rank 30.",
  weapons: "Primary, Secondary and Melee weapons. Variants like MK1, Vandal, Wraith and Kuva sit in their base weapon's card.",
  vehicles: "Archwings, Necramechs, K-Drives and the Railjack's Plexus.",
  archweapons: "Arch-guns and Arch-melee, used with your Archwing and Necramech.",
  companions: "Sentinels and their weapons, Kubrows and Kavats.",
  modweapons: "Zaws from Cetus and Kitguns from Fortuna and the Necralisk. Only one piece of each counts for mastery.",
  modcompanions: "Hounds and their weapons, MOAs, Predasites and Vulpaphylas, built from parts. Only one piece of each counts for mastery.",
  amps: "Operator Amps, built from parts at Cetus and Fortuna, plus the Drifter's Sirocco.",
  tauron: "The five Tektolyst Artifacts and their Tauron Strikes. These don't count toward mastery; the ticks are just for your collection.",
};
const MG_LINE = { base: "Regular versions of everything that gives mastery, with their variants in the same card.", prime: "Every Prime set, with the relics that drop its parts." };
const PRIME_CAT = { archgun: "archweapons", archmelee: "archweapons", archwing: "vehicles" };
const SLOTTED = new Set(["weapons", "archweapons"]); // slots become their own dropdowns
const SLOT_ORDER = ["Primary", "Secondary", "Melee", "Arch-gun", "Arch-melee", "Archwing", "Necramech", "K-Drive", "Plexus", "Sentinel", "Sentinel weapon", "Kubrows", "Kavats", "Hounds", "Hound weapons", "MOAs", "Predasites", "Vulpaphylas", "Zaws", "Kitguns", "Amps", "Sirocco"];
const TIER_ORDER = { Lith: 0, Meso: 1, Neo: 2, Axi: 3, Requiem: 4, Omnia: 5 };
const RAR = { C: "Common", U: "Uncommon", R: "Rare" };
const RAR_ORDER = { R: 0, U: 1, C: 2 };
const RAR_CHANCE = { C: "25.3% → 16.7%", U: "11% → 20%", R: "2% → 10%" };
const DEFAULT_SETTINGS = {
  theme: "orokin-dark", farm: "both", mainSort: "type", collapsed: {}, mainOpen: {}, slotOpen: {}, runsOpen: {}, rotOpen: {}, hideVend: {},
  show: { mods: true, chances: true, vaulted: true, resurgence: true, variants: true, oracle: true, tips: true, get: true, whatsnew: true },
  reduceMotion: false, compact: false, textSize: 100, startPage: 2, fissMode: "normal", collMode: "all", starOnly: false, nav2: 1,
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
function shortLeft(ms) { // "3d 4h", "2h 5m", "18m": for countdowns at a glance
  const s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const shortUntil = ms => `<span data-short="${ms}">${shortLeft(ms)}</span>`;
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
  const st = { ...(s.settings || {}) };
  if (s.settings && !st.nav2) { // 1.0's four swipe pages: Rotating, Relic Runs, Favorites, Main
    st.startPage = { 0: PG.vendors, 1: PG.relics, 2: PG.coll, 3: PG.home }[st.startPage] ?? PG.home;
    st.nav2 = 1;
  }
  return {
    ticks: s.ticks || {}, stars: s.stars || {}, mastered: s.mastered || {}, alerts: s.alerts || {},
    hvMin: !!s.hvMin, d77: s.d77 || null, focus: s.focus && typeof s.focus === "object" ? s.focus : null, secrets: s.secrets || {}, banners: s.banners || {}, unlocked: s.unlocked || {}, weekly: { t: (s.weekly || {}).t || {}, c: (s.weekly || {}).c || [] },
    xm: s.xm || {}, relicCounts: s.relicCounts || {}, partCounts: s.partCounts || {}, scanAt: s.scanAt || {}, hvOwned: !!s.hvOwned,
    building: s.building || {}, built: s.built || {}, scanFiles: s.scanFiles || {}, tourDone: !!s.tourDone, newsSeen: s.newsSeen || "",
    settings: { ...DEFAULT_SETTINGS, ...st, collapsed: { ...(st.collapsed || {}) }, mainOpen: { ...(st.mainOpen || {}) }, slotOpen: { ...(st.slotOpen || {}) }, runsOpen: { ...(st.runsOpen || {}) }, rotOpen: { ...(st.rotOpen || {}) }, hideVend: { ...(st.hideVend || {}) }, show: { ...DEFAULT_SETTINGS.show, ...(st.show || {}) } },
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
  RELIC_REW = null; // Focus mode's reward lists are rebuilt from the new data
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
  BARO_SET = baroHere(LIVE && LIVE.baro, now) ? liveRelicSet(LIVE.baro.inventory) : new Set();
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
    if (rows.length && !av.length) { // nothing farmable: name the relics right away, each one tappable
      const extra = rs.length && sh.resurgence ? ` · ${rs.length} back in Prime Resurgence` : "";
      h += `<div class="relrow"><span class="farm">All relics vaulted${extra}</span></div><div class="chips vchips">${rows.map(([r, rar]) =>
        `<button class="rchip ${rar}${relicStatus(r) === "rs" ? " av" : ""}" data-relic="${esc(r)}">${esc(r)}<i>${rar}</i>${ownRel(r)}</button>`).join("")}</div>`;
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

/* ---------- PAGE: COLLECTION ----------
   One flat list: All, or Base / Prime, with a Starred filter and category chips. Each row opens
   the item's own page; sections never nest deeper than their heading. */
let mainCat = "all", mainQuery = "", showMastered = false, hideDone = false, mainSlot = ""; // mainSlot: just Primary, Secondary...
const FILTER_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>`;
const STAR_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`;
const STAR_OFF_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`;
const starSvg = on => on ? STAR_SVG : STAR_OFF_SVG;
const SORTS = [["type", "By section"], ["az", "A–Z"], ["done", "Closest to done"], ["vault", "Vaulting soonest"]];
const catsWithItems = () => CATS.filter(([k]) => k === "all" || ALL.some(it => (it.grp && GROUPS[it.grp] ? GROUPS[it.grp].cat : it.cat) === k));
const collPool = () => S().collMode === "base" ? BASE : S().collMode === "prime" ? ITEMS : ALL;
function buildMain() {
  $("#main").innerHTML = `<header class="phead"><div class="ptitle"><h1>Collection</h1><span class="pcount" id="collCnt"></span></div><p id="catIntro"></p></header>
    <div class="mbar" id="mbar"><div class="mbarrow">
      <input class="search" id="search" type="search" placeholder="Search the collection" autocomplete="off" aria-label="Search the collection">
      <button class="iconbtn" id="filtBtn" aria-label="Sort and filters" aria-expanded="false">${FILTER_SVG}</button></div>
      <div class="fpanel hidden" id="fpanel">
        <div class="controls" id="slotCtl"></div>
        <div class="controls" id="sortCtl"><span class="ctlk">Sort</span>${SORTS.map(([k, l]) => `<button class="chip" data-sort="${k}">${l}</button>`).join("")}</div>
        <div class="controls"><button class="chip ghost" id="showM" aria-pressed="false">Show mastered</button>
        <button class="chip ghost" id="hideD" aria-pressed="false">Hide complete</button></div></div>
      <div class="modegrid" role="group" aria-label="Which items"><button data-cmode="all" class="mall">All</button><button data-cmode="base">Base</button><button data-cmode="prime">Prime</button></div>
      <div class="catchips" id="catChips"></div></div>
    <div id="mainList"></div>
    <footer>Data from the <a href="https://wiki.warframe.com/" target="_blank">WARFRAME Wiki</a>, DE's official drop tables and WFCD community data. Resources like Orokin Cells and credits aren't listed. To master an item you still have to level it to rank 30 after you build it.</footer>`;
  $("#filtBtn").addEventListener("click", e => {
    const p = $("#fpanel"), open = p.classList.toggle("hidden") === false;
    e.currentTarget.setAttribute("aria-expanded", open);
  });
  $("#mbar").addEventListener("click", e => {
    const sl = e.target.closest("[data-slotf]");
    if (sl) { mainSlot = sl.dataset.slotf; renderMain(); $("#pg-coll").scrollTop = 0; return; }
    const so = e.target.closest("[data-sort]");
    if (so) { S().mainSort = so.dataset.sort; save(); renderMain(); return; }
    const md = e.target.closest("[data-cmode]");
    if (md) { S().collMode = md.dataset.cmode; save(); renderMain(); $("#pg-coll").scrollTop = 0; return; }
    const st = e.target.closest("[data-staronly]");
    if (st) { S().starOnly = !S().starOnly; save(); renderMain(); $("#pg-coll").scrollTop = 0; return; }
    const c = e.target.closest("[data-cat]");
    if (c) { mainCat = mainCat === c.dataset.cat ? "all" : c.dataset.cat; mainSlot = ""; renderMain(); $("#pg-coll").scrollTop = 0; } // tap the chosen category again for everything
  });
  $("#search").addEventListener("input", e => {
    if (secretSearch(e.target.value)) { e.target.value = ""; e.target.blur(); mainQuery = ""; renderMain(); return; }
    mainQuery = e.target.value.trim().toLowerCase(); renderMain();
  });
  $("#showM").addEventListener("click", e => { showMastered = !showMastered; e.currentTarget.setAttribute("aria-pressed", showMastered); renderMain(); });
  $("#hideD").addEventListener("click", e => { hideDone = !hideDone; e.currentTarget.setAttribute("aria-pressed", hideDone); renderMain(); });
}
const catOf = it => it.grp && GROUPS[it.grp] ? GROUPS[it.grp].cat : it.cat;
const slotOf = it => it.grp && GROUPS[it.grp] ? GROUPS[it.grp].slot : it.slot;
const isStarred = it => !!(state.stars[it.id] || (it.grp && state.stars[it.grp]));
function passes(it) {
  const q = mainQuery;
  if (mainCat !== "all" && catOf(it) !== mainCat) return false;
  if (mainSlot && slotOf(it) !== mainSlot) return false;
  if (S().starOnly && !isStarred(it)) return false;
  // searching by name finds an item even if it's mastered or complete: you asked for it
  if (state.mastered[it.id] && !showMastered && !q && !S().starOnly) return false;
  if (hideDone && !q && it.k !== "m") { const { n, g } = progress(it); if (n && g === n) return false; }
  if (q && !it.n.toLowerCase().includes(q) && !(it.grp && GROUPS[it.grp] && GROUPS[it.grp].n.toLowerCase().includes(q))
    && !unitsOf(it).some(u => (u.full || "").toLowerCase().includes(q))) return false;
  return true;
}
/* Display entries: one per row. Base items in a group share one entry. */
function entriesOf(list) {
  const m = new Map();
  list.forEach(it => {
    const g = it.grp && GROUPS[it.grp], key = g ? it.grp : it.id;
    if (!m.has(key)) m.set(key, { key, g, items: [], cat: catOf(it), slot: slotOf(it), n: g ? g.n : it.n });
    m.get(key).items.push(it);
  });
  return [...m.values()].sort((a, b) => a.n.localeCompare(b.n));
}
/* An entry's numbers: parts collected for one item, or pieces mastered (collected) for a group */
function entryStat(e) {
  if (e.g) {
    const t = e.items[0].k === "t", all = grpItems(e.key);
    const got = all.filter(i => t ? isTicked(unitsOf(i)[0]) : state.mastered[i.id]).length;
    return { got, tot: all.length, txt: `${got} / ${all.length}`, done: got === all.length && all.length > 0 };
  }
  const it = e.items[0], { n, g } = progress(it), isM = !!state.mastered[it.id];
  if (isM) return { got: 1, tot: 1, txt: "Mastered", done: true, m: true };
  if (it.k === "m") return { got: 0, tot: 1, txt: "", done: false };
  return { got: g, tot: n, txt: n ? `${g} / ${n}` : "", done: n > 0 && g === n };
}
function sectionsFor(entries) {
  const secs = new Map(), flat = S().mainSort !== "type"; // A–Z and the other sorts: one list, no headings
  const key = e => flat ? null : SLOTTED.has(e.cat) ? (e.slot || "Other") : CAT_LABEL[e.cat] || "Other";
  entries.forEach(e => { const k = key(e); if (!secs.has(k)) secs.set(k, { cat: e.cat, list: [] }); secs.get(k).list.push(e); });
  const order = (k, v) => k == null ? 0 : CATS.findIndex(c => c[0] === v.cat) * 100 + Math.max(0, SLOT_ORDER.indexOf(k));
  return [...secs.entries()].sort((a, b) => order(a[0], a[1]) - order(b[0], b[1]) || String(a[0]).localeCompare(String(b[0])));
}
const entryReady = e => e.items.some(readyToBuild);
const favMissing = e => e.items.filter(i => counts(i) && active(i)).reduce((a, i) => { const { n, g } = progress(i); return a + (i.k === "m" ? 1 : n - g); }, 0);
const favVault = e => { const ends = e.items.flatMap(i => alertsFor(i).map(a => a.end || 9e15)); return ends.length ? Math.min(...ends) : Infinity; };
function sortEntries(entries) {
  const k = S().mainSort;
  const by = { done: (a, b) => favMissing(a) - favMissing(b), vault: (a, b) => favVault(a) - favVault(b) }[k];
  return by ? entries.sort((a, b) => by(a, b) || a.n.localeCompare(b.n)) : entries;
}
function rowHTML(e) {
  const st = entryStat(e), it = e.items[0], on = !!state.stars[e.key];
  const ready = entryReady(e), b = !e.g && (buildTag(it));
  const pct = st.tot ? 100 * st.got / st.tot : 0;
  return `<div class="crow${st.m ? " m" : ""}${st.done && !st.m ? " done" : ""}" data-row="${esc(e.key)}">
    <button class="cmain" data-open="${esc(e.key)}"><span class="ctl"><b>${esc(e.n)}</b><span class="cc">${b || esc(st.txt)}</span></span>${st.tot && !st.m ? `<span class="rbar"><i style="width:${Math.max(2, pct)}%"></i></span>` : ""}</button>
    ${ready ? `<button class="chip build" data-build="${(e.items.find(readyToBuild) || it).id}">Building</button>` : ""}${!e.g ? vwHTML(it) : ""}
    <button class="star${on ? " on" : ""}" data-star="${esc(e.key)}" aria-label="${on ? "Unstar" : "Star"} ${esc(e.n)}" aria-pressed="${on}">${starSvg(on)}</button></div>`;
}
function listHTML(items) {
  const entries = sortEntries(entriesOf(items));
  if (!entries.length) return `<p class="empty">${mainQuery ? "Nothing matches that search." : S().starOnly ? "Nothing starred here yet. Tap the star on any item." : "Nothing left here. Everything's mastered!"}</p>`;
  let h = "";
  const ready = entries.filter(entryReady);
  if (ready.length) h += `<h2 class="sec rtbsec">Ready to build</h2><div class="rows">${ready.map(rowHTML).join("")}</div>`;
  sectionsFor(entries.filter(e => !entryReady(e))).forEach(([k, v]) => {
    h += (k ? `<h2 class="sec">${esc(k)}<span class="seccnt">${v.list.length}</span></h2>` : "") + `<div class="rows">${v.list.map(rowHTML).join("")}</div>`;
  });
  return h;
}
function mgCount(pool) {
  const m = pool.filter(counts), got = m.filter(it => state.mastered[it.id]).length;
  return { got, tot: m.length, txt: m.length ? `${got.toLocaleString()} / ${m.length.toLocaleString()} mastered` : `${pool.filter(it => progress(it).g).length} / ${pool.length} collected` };
}
function renderMain() {
  if (!$("#mainList")) return;
  const pool = collPool().filter(it => mainCat === "all" || catOf(it) === mainCat);
  $("#collCnt").textContent = ALL.length ? mgCount(pool).txt : "";
  $("#catIntro").textContent = CAT_INTRO[mainCat] || "";
  const cats = catsWithItems(); if (!cats.some(([k]) => k === mainCat)) mainCat = "all";
  $("#catChips").innerHTML = `<button class="chip star-chip" data-staronly aria-pressed="${!!S().starOnly}">${STAR_SVG}Starred</button>`
    + cats.filter(([k]) => k !== "all").map(([k, l]) => `<button class="chip" data-cat="${k}" aria-pressed="${mainCat === k}">${l}</button>`).join("");
  document.querySelectorAll("[data-cmode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.cmode === (S().collMode || "all")));
  // Weapons and Arch-weapons can be narrowed to one slot
  const slots = SLOTTED.has(mainCat) ? SLOT_ORDER.filter(sl => ALL.some(it => catOf(it) === mainCat && slotOf(it) === sl)) : [];
  if (!slots.includes(mainSlot)) mainSlot = "";
  $("#slotCtl").innerHTML = slots.length ? `<span class="ctlk">Show</span>` + [["", "All"], ...slots.map(sl => [sl, sl])].map(([k, l]) => `<button class="chip" data-slotf="${k}" aria-pressed="${mainSlot === k}">${l}</button>`).join("") : "";
  $("#slotCtl").classList.toggle("hidden", !slots.length);
  const busy = !!mainSlot || S().mainSort !== "type" || showMastered || hideDone; // a dot on the button while any filter is on
  $("#filtBtn").classList.toggle("on", busy);
  $("#filtBtn").setAttribute("aria-label", `Sort and filters${busy ? " (some on)" : ""}`);
  $("#sortCtl").querySelectorAll("[data-sort]").forEach(b => b.setAttribute("aria-pressed", b.dataset.sort === S().mainSort));
  $("#mainList").innerHTML = !ALL.length ? `<p class="empty">Loading the item list…</p>` : listHTML(pool.filter(passes));
}
/* ---------- MASTERY RANK ESTIMATE ----------
   Mastery points for each item marked Mastered: weapons 3,000 (Kuva, Tenet and Coda weapons
   and the Paracesis 4,000 at rank 40); Warframes, companions, Archwings and K-Drives 6,000;
   Necramechs 8,000 at rank 40. MR n needs 2,500 × n²; each Legendary rank 147,500 more. */
function masteryXP(it) {
  if (it.k === "t") return 0;
  if (/^(Kuva|Tenet|Coda) /.test(it.n) || it.n === "Paracesis") return 4000;
  if (it.slot === "Necramech") return 8000;
  if (it.w || ["weapons", "archweapons", "modweapons", "amps"].includes(it.cat)) return 3000;
  return 6000;
}
const mrNow = () => { const xp = Math.max(0, mrOwnXP() + mrAdj()); let r = 0; while (mrNeed(r + 1) <= xp) r++; return r; };
const mrNeed = r => r <= 30 ? 2500 * r * r : 2250000 + 147500 * (r - 30);
const mrLabel = r => r > 30 ? `Legendary\u00a0${r - 30}` : `MR\u00a0${r}`; // keep "MR 10" on one line
/* Mastery that doesn't come from levelling gear: Star Chart and Steel Path nodes and Junctions,
   Railjack and Drifter Intrinsics. Node totals are the wiki's (Update 42): 241 nodes worth 14,569
   points plus 13 Junctions at 1,000 each, on each chart. Every Intrinsic rank is worth 1,500. */
const XM = {
  charts: [["sc", "Star Chart"], ["sp", "Steel Path"]], NODES: 241, NODE_PTS: 14569, JUNCTIONS: 13,
  intr: [["rj", "Railjack Intrinsics", ["Tactical", "Piloting", "Gunnery", "Engineering", "Command"]],
         ["dr", "Drifter Intrinsics", ["Combat", "Riding", "Opportunity", "Endurance"]]],
};
const xmGet = (k, f) => Math.max(0, +(((state.xm || {})[k] || {})[f]) || 0);
function extraXP() {
  const out = {};
  XM.charts.forEach(([k]) => {
    const n = Math.min(XM.NODES, xmGet(k, "n")), j = Math.min(XM.JUNCTIONS, xmGet(k, "j"));
    out[k] = Math.round(n * XM.NODE_PTS / XM.NODES) + j * 1000;
  });
  XM.intr.forEach(([k, , trees]) => { out[k] = trees.reduce((a, t) => a + Math.min(10, xmGet(k, t)) * 1500, 0); });
  return out;
}
function renderMR() {
  const box = $("#mrBox"); if (!box) return;
  const m = mrStats();
  const sel = $("#mrRank"); if (sel && !sel.dataset.touched) sel.value = m.r; // start the picker at the app's own estimate
  box.innerHTML = `<div class="sumrow"><span>Estimated Mastery Rank</span><b>${mrLabel(m.r)}</b></div>
    <div class="sumsub">${m.xp.toLocaleString()} mastery points · ${(m.hi - m.xp).toLocaleString()} more to ${mrLabel(m.r + 1)}</div>
    <div class="bar"><i style="width:${m.pct}%"></i></div>
    <div class="mrsplit"><span>Items mastered (${m.n})</span><b>${m.items.toLocaleString()}</b>
      ${XM.charts.map(([k, l]) => `<span>${l}</span><b>${m.ex[k].toLocaleString()}</b>`).join("")}
      <span>Intrinsics</span><b>${(m.ex.rj + m.ex.dr).toLocaleString()}</b>
      ${m.adj ? `<span>Matched to your game</span><b>${m.adj > 0 ? "+" : "−"}${Math.abs(m.adj).toLocaleString()}</b>` : ""}</div>`;
}
/* "Match my game": the game counts things the app can't see, like ranks gained on gear you later
   sold. Matching keeps the difference between the game's total and the app's own count. */
const mrAdj = () => Math.round(+((state.xm || {}).adj) || 0);
function mrOwnXP() {
  let items = 0;
  ALL.forEach(it => { if (state.mastered[it.id]) items += masteryXP(it); });
  return items + Object.values(extraXP()).reduce((a, b) => a + b, 0);
}
function mrMatch() {
  const r = +($("#mrRank") || {}).value, left = Math.floor(+String(($("#mrLeft") || {}).value || "").replace(/[^0-9]/g, ""));
  const msg = $("#mrMsg");
  if (!(left > 0) || left > mrNeed(r + 1) - mrNeed(r)) { if (msg) { msg.className = "codemsg bad"; msg.textContent = `Type the points the game says you need for ${mrLabel(r + 1)}.`; } return; }
  state.xm = state.xm || {}; state.xm.adj = mrNeed(r + 1) - left - mrOwnXP();
  save(); renderSub(); renderProfile(); renderHome();
}
function xmSet(t, tidy) {
  const max = +t.max || 0, v = Math.max(0, Math.min(max, Math.floor(+t.value || 0)));
  state.xm = state.xm || {}; (state.xm[t.dataset.xm] = state.xm[t.dataset.xm] || {})[t.dataset.xf] = v;
  if (tidy && t.value !== "" && +t.value !== v) t.value = v;
  save(); renderMR(); renderProfile();
}
function mainSummary() { renderMR(); }
/* "Is in the Prime list" links and other jumps open the item's own page */
function jumpTo(id) {
  const it = BYID[id]; if (!it) return;
  openSub("item", it.grp && GROUPS[it.grp] ? it.grp : id);
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
  if (!$("#trade")) return;
  const msgs = tradeMessages();
  if ($("#tradeCnt")) $("#tradeCnt").textContent = msgs.length;
  $("#trade").innerHTML = msgs.length ? msgListHTML(msgs)
    : `<p class="empty">${starred().length ? "Nothing missing on your starred Primes." : "Star some Primes and their missing parts show up here."}</p>`;
}

/* ---------- PAGE: RELICS ---------- */
let runsTier = "all";
const CHEV = `<svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg>`;
const TIER_CLS = { Lith: "tC", Meso: "tU", Neo: "tR", Axi: "tR", Requiem: "tQ", Omnia: "tQ" };
function needMap(items) { // relic -> [{item, full, rar, n}]
  const rm = {};
  items.forEach(it => missing(it).forEach(p => p.r.forEach(([r, rar]) => (rm[r] = rm[r] || []).push({ it: it.n, full: p.full, rar, n: p.n }))));
  return rm;
}
/* Live fissures in the chosen mode, each with how many farmable relics of its tier hold a part
   you need (for starred items when there are any, else every unmastered Prime) */
function fissList(mode) {
  const starItems = starred().filter(active);
  const nrm = needMap(starItems.length ? starItems : ITEMS.filter(active)), needTiers = {};
  Object.keys(nrm).forEach(r => { if (obtainable(r)) needTiers[tierOf(r)] = (needTiers[tierOf(r)] || 0) + 1; });
  const sp = (mode || S().fissMode) === "sp", now = Date.now();
  const all = Object.values(needTiers).reduce((a, b) => a + b, 0);
  const list = (LIVE && LIVE.fissures || []).filter(f => f.expiry > now && (mode === "any" || !!f.hard === sp))
    .sort((a, b) => (a.storm - b.storm) || (a.hard - b.hard) || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.expiry - b.expiry)
    .map(f => ({ ...f, cnt: f.tier === "Omnia" ? all : needTiers[f.tier] || 0 }));
  return { list, sp, starItems };
}
const tierChip = t => `<span class="ti ${TIER_CLS[t] || ""}">${esc(t)}</span>`;
function fissRowHTML(f, pick) {
  const btn = pick ? `<button class="chip ghost" data-fpick="${esc(f.tier)}|${esc(f.type)}|${esc(f.node)}|${f.expiry}|${f.hard ? 1 : 0}">Pick</button>`
    : f.cnt ? `<button class="flag need" data-ftier="${esc(f.tier)}">${f.cnt} relic${f.cnt === 1 ? "" : "s"} ›</button>` : "";
  return `<div class="frow${f.cnt ? " match" : ""}">${tierChip(f.tier)}<span class="mi"><span class="mt">${esc(f.type)}${f.storm ? ` <span class="flag">Void Storm</span>` : ""}${pick && f.hard ? ` <span class="flag sp">Steel Path</span>` : ""}</span><small>${esc(f.node)}</small></span><span class="tl">${shortUntil(f.expiry)}</span>${btn}</div>`;
}
function hvList() {
  const starItems = starred().filter(active), srm = needMap(starItems);
  const hvAll = Object.entries(srm).filter(([, l]) => new Set(l.map(x => x.it)).size > 1);
  const shown = state.hvOwned ? hvAll.filter(([r]) => state.relicCounts[r] > 0) : hvAll;
  return { starItems, hvAll, hv: shown.sort((a, b) => new Set(b[1].map(x => x.it)).size - new Set(a[1].map(x => x.it)).size || obtainable(b[0]) - obtainable(a[0]) || relicSort(a[0], b[0])) };
}
function renderRuns() {
  const el = $("#runs"); if (!el) return;
  const { list, sp, starItems } = fissList();
  const owned = Object.values(state.relicCounts || {}).reduce((a, n) => a + (n > 0 ? n : 0), 0);
  const rel = list.filter(f => f.cnt).length;
  const { hvAll, hv } = hvList(), own = state.hvOwned, haveCounts = Object.keys(state.relicCounts).length > 0;
  let h = `<header class="phead"><div class="ptitle"><h1>Relics</h1><span class="pcount">${owned ? `${owned.toLocaleString()} owned` : ""}</span></div><div class="updated"></div>
    <p>Check this during relic missions. Tick a part anywhere and it drops off this page. Pull down to refresh.</p></header>
    <div class="seg2" id="fissMode" role="group" aria-label="Fissure type"><button data-fmode="normal" aria-pressed="${!sp}">Normal</button><button data-fmode="sp" aria-pressed="${sp}">Steel Path</button></div>`;
  h += `<section class="pcard"><div class="pchead"><span class="lbl">Active Fissures</span><span class="pnote">${LIVE ? `${list.length} open${rel ? ` · ${rel} relevant` : ""}` : ""}</span></div>`
    + (!LIVE ? `<p class="empty">Live fissures show once the app can reach the worldstate.</p>`
      : !list.length ? `<p class="empty">No ${sp ? "Steel Path " : ""}fissures in the feed right now.</p>`
      : `<div class="fiss">${list.map(f => fissRowHTML(f)).join("")}</div>`) + `</section>`;
  h += `<section class="pcard hvcard"><div class="pchead"><span class="lbl">High value</span><label class="mini-tgl">Owned only<input type="checkbox" id="hvOwned"${own ? " checked" : ""}></label></div>
    <p class="secsub">Relics that hold parts for two or more different starred items.</p>`
    + (hv.length ? hv.map(([r, l]) => {
      const n = state.relicCounts[r] || 0, k = new Set(l.map(x => x.it)).size;
      return `<div class="hvrow"><div class="hvt"><button class="relbtn" data-relic="${esc(r)}">${esc(r)}</button>${n ? `<span class="owned">${n} owned</span>` : ""}<span class="st ${stCls(r)}">${statusLabel(r)}</span><span class="hvn">${k} starred items</span></div>
        <div class="hvp">${l.sort((a, b) => RAR_ORDER[a.rar] - RAR_ORDER[b.rar] || a.full.localeCompare(b.full)).map(p => esc(p.full) + (p.rar === "R" ? " (Rare)" : "")).join(" · ")}</div></div>`;
    }).join("") : `<p class="empty">${starItems.length < 2 ? "Star at least two items to find relics that cover more than one."
      : own && !haveCounts ? "Import your relics under Profile › Import data to see which ones you own."
      : own && hvAll.length ? "None of the relics you own hold parts for more than one of your starred items."
      : "No relic holds parts for more than one of your starred items."}</p>`) + `</section>`;
  const allRm = needMap(ITEMS.filter(active));
  h += `<button class="pcard linkrow" data-sub="missing"><span><b>Every missing part</b><small>${Object.keys(allRm).length} relics hold a part you need, and the best one for each</small></span>${CHEV}</button>`;
  h += `<footer>Drop chance per refinement: Common 25.33% Intact → 16.67% Radiant · Uncommon 11% → 20% · Rare 2% → 10%. Vaulted relics can be traded with other players, or bought from Varzia when they're in Prime Resurgence.</footer>`;
  el.innerHTML = h; renderUpdated();
}
/* Every missing part: its own page, opened from Relics */
function missingHTML() {
  const tierOk = r => runsTier === "all" || tierOf(r) === runsTier;
  const hvSet = new Set(hvList().hvAll.map(([r]) => r));
  const allRm = needMap(ITEMS.filter(active));
  let h = `<p class="secsub">All relics for every part you still need, across every Prime you haven't mastered. Gold outline = also in High value. Teal outline = you can get it right now.</p>
    <section class="summary" style="margin-top:0"><div class="sumrow"><span>Relics holding a part you need</span><b>${Object.keys(allRm).length}</b></div>
      <div class="sumsub">${new Set(Object.values(allRm).flat().map(x => x.full)).size} different parts missing across ${ITEMS.filter(active).length} items · ${hvSet.size} high-value relic${hvSet.size === 1 ? "" : "s"}</div>
      <div class="controls">${[["all", "All tiers"], ["Lith", "Lith"], ["Meso", "Meso"], ["Neo", "Neo"], ["Axi", "Axi"]].map(([k, l]) =>
        `<button class="chip" data-tier="${k}" aria-pressed="${k === runsTier}">${l}</button>`).join("")}</div></section>`;
  const cards = [];
  ITEMS.filter(active).forEach(it => {
    const ms = missing(it).filter(p => p.r.some(([r]) => tierOk(r)));
    if (!ms.length) return;
    let c = `<article class="card"><div class="chead" style="cursor:default"><div class="name"><button class="linkname" data-open="${it.id}">${esc(it.n)}</button></div><div class="meta"><span class="tag">${esc(it.slot || CAT_LABEL[it.cat])}</span><span>${ms.length} part${ms.length > 1 ? "s" : ""} missing</span></div></div>`;
    ms.forEach(p => {
      const rs = p.r.filter(([r]) => tierOk(r)).sort((a, b) => RAR_ORDER[b[1]] - RAR_ORDER[a[1]] || relicSort(a[0], b[0]));
      c += `<div class="part"><b>${esc(p.full)}</b>${p.n > 1 ? `<span class="need">need ${p.n}</span>` : ""}<div class="chips">` +
        rs.map(([r, rar]) => `<button class="rchip ${rar}${hvSet.has(r) ? " hot" : ""}${obtainable(r) ? " av" : ""}" data-relic="${esc(r)}">${esc(r)}<i>${rar}</i>${ownRel(r)}</button>`).join("") + `</div></div>`;
    });
    cards.push([(state.stars[it.id] ? "0" : "1") + it.n, c + `</article>`]);
  });
  cards.sort((a, b) => a[0].localeCompare(b[0]));
  return h + (cards.length ? `<div class="grid">${cards.map(x => x[1]).join("")}</div>` : `<p class="empty">Nothing missing in this tier.</p>`);
}

/* ---------- PAGE: VENDORS ---------- */
/* The Steel Path Circuit's Incarnon Genesis weeks (wiki, 2026): nine groups of five that repeat */
const CIRCUIT_WEEKS = [
  ["Braton", "Lato", "Skana", "Paris", "Kunai"], ["Boar", "Gammacor", "Angstrum", "Gorgon", "Anku"],
  ["Bo", "Latron", "Furis", "Furax", "Strun"], ["Lex", "Magistar", "Boltor", "Bronco", "Ceramic Dagger"],
  ["Torid", "Dual Toxocyst", "Dual Ichor", "Miter", "Atomos"], ["Ack & Brunt", "Soma", "Vasto", "Nami Solo", "Burston"],
  ["Zylok", "Sibear", "Dread", "Despair", "Hate"], ["Dera", "Sybaris", "Cestra", "Sicarus", "Okina"],
  ["Vectis", "Stug", "Ballistica", "Destreza", "Obex"],
];
function circuitWeek(choices) {
  const norm = s => String(s).toLowerCase().replace(/ incarnon genesis$/, "").trim();
  const have = new Set((choices || []).map(norm));
  if (have.size) {
    let best = -1, hit = 0;
    CIRCUIT_WEEKS.forEach((w, i) => { const n = w.filter(x => have.has(x.toLowerCase())).length; if (n > hit) { hit = n; best = i; } });
    if (hit >= 2) return best + 1;
  }
  // without the feed: count weeks from one we know (the week of Monday 19 October 2026 was week 8)
  const wk = Math.floor((Date.now() - Date.UTC(2026, 9, 19)) / (7 * 864e5));
  return (((7 + wk) % 9) + 9) % 9 + 1;
}
function rotSection(key, title, sub, note, body) { // closed the first time, then as you left it
  if (S().hideVend[key]) return "";
  return `<details class="vrow" data-rot="${key}"${S().rotOpen[key] ? " open" : ""}><summary><span class="vn"><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span>${note ? `<em class="vt">${note}</em>` : ""}</summary><div class="rbody">${body}</div></details>`;
}
function nextWeeklyReset(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.getTime();
}
const whenText = ms => { try { return new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
function renderRotating() {
  const el = $("#rotating"); if (!el) return;
  const now = Date.now(), L = LIVE;
  let h = `<header class="phead"><div class="ptitle"><h1>Vendors</h1></div><div class="updated"></div><p>Vendors and rewards that change. Tap one to open it. Pull down to refresh.</p></header>`;
  if (!L) { el.innerHTML = h + `<p class="empty">Live vendor info shows here once the app can reach the worldstate.</p>`; renderUpdated(); return; }
  const needRel = new Set(Object.keys(needMap(starred().filter(active))));
  const row = (n, pr) => `<div class="rrow"><span class="pn">${esc(n)}${needRel.has((RELIC_RE.exec(n) || []).slice(1).join(" ")) ? ` <span class="flag need">starred</span>` : ""}</span>${pr ? `<span class="pr">${pr}</span>` : ""}</div>`;
  const msg = t => `<div class="rlist"><span class="secsub" style="margin:0">${t}</span></div>`;
  const b = L.baro;
  if (b && !S().hideVend.baro) {
    const here = baroHere(b, now), soon = !here && b.activation > now;
    const inv = here && b.inventory && b.inventory.length
      ? `<details class="vinv"${S().rotOpen.baroInv ? " open" : ""} data-rot="baroInv"><summary>His stock · ${b.inventory.length} item${b.inventory.length === 1 ? "" : "s"}</summary><div class="rlist">${b.inventory.map(x => row(x.n, [x.ducats ? `${x.ducats} ducats` : "", x.credits ? `${Number(x.credits).toLocaleString()} cr` : ""].filter(Boolean).join(" · "))).join("")}</div></details>`
      : here ? msg("No inventory in the feed yet.") : "";
    h += `<section class="pcard baro"><div class="pchead"><span class="lbl">Void Trader</span><em class="pnote">${here ? "leaves in" : soon ? "arrives in" : ""}</em></div>
      <div class="bbig"><span class="bcount">${here ? shortUntil(b.expiry) : soon ? shortUntil(b.activation) : "—"}</span><span class="when">${esc(here ? `until ${whenText(b.expiry)}` : soon ? whenText(b.activation) : "")}</span></div>
      <div class="vline">Baro Ki'Teer · ${here ? "at" : "next at"} <b>${esc(b.location || "a relay")}</b></div>${inv}${ducatHTML()}</section>`;
  }
  let rows = "";
  const deals = (L.darvo || []).filter(d => !d.expiry || d.expiry > now);
  rows += rotSection("darvo", "Darvo's Deal", "", deals[0] && deals[0].expiry ? shortUntil(deals[0].expiry) : "", deals.length ? deals.map(d => {
    const off = d.orig ? Math.round(100 - 100 * d.sale / d.orig) : 0;
    return `<div class="vline"><div class="big">${esc(d.n)}</div></div><div class="rlist"><div class="rrow"><span class="pn">${d.sale} platinum${d.orig ? ` <span class="sub" style="margin:0">(was ${d.orig}, ${off}% off)</span>` : ""}</span></div>${d.total ? `<div class="rrow"><span class="pn">${Math.max(0, d.total - (d.sold || 0))} of ${d.total} left</span></div>` : ""}</div>`;
  }).join("") : msg("No daily deal in the feed right now."));
  const t = L.teshin;
  rows += rotSection("teshin", "Teshin", "Steel Path Honors", t && t.expiry ? shortUntil(t.expiry) : "", t
    ? `<div class="vline"><div class="big">${esc(t.n || "Unknown")}</div></div><div class="rlist">${t.cost ? `<div class="rrow"><span class="pn">${t.cost} Steel Essence</span></div>` : ""}<span class="secsub" style="margin:0">The weekly rotating item in his Steel Path Honors shop.</span></div>`
    : msg("His weekly item isn't in the feed right now."));
  const c = L.circuit;
  rows += rotSection("circuit", "Steel Path Circuit", `Incarnon Genesis · Week ${circuitWeek(c)}`, shortUntil(nextWeeklyReset()), c && c.length
    ? `<div class="rlist">${c.map(n => { const pr = BYNAME[n + " Prime"]; return `<div class="rrow"><span class="pn">${esc(n)} Incarnon Genesis${pr && state.stars[pr.id] ? ` <span class="flag need">starred Prime</span>` : ""}</span></div>`; }).join("")}<span class="secsub" style="margin:4px 0 0">This week's Incarnon Genesis choices from the Steel Path Circuit in Duviri.</span></div>`
    : msg("This week's choices aren't in the feed right now."));
  const v = L.varzia;
  rows += rotSection("varzia", "Varzia", "Prime Resurgence", v && v.expiry ? shortUntil(v.expiry) : "", v && v.inventory && v.inventory.length ? (() => {
    const rel = v.inventory.filter(x => RELIC_RE.test(x.n)), other = v.inventory.filter(x => !RELIC_RE.test(x.n));
    return `<div class="rlist">${other.map(x => row(x.n)).join("")}${rel.length ? `<div class="group" style="padding:6px 0 0">Relics</div>` + rel.map(x => row(x.n)).join("") : ""}</div>`;
  })() : msg("Her stock isn't in the live feed right now."));
  if (rows) h += `<section class="pcard vlist">${rows}</section>`;
  el.innerHTML = h + `<footer>Live info from the worldstate (PC and crossplay, which includes Xbox). Gold "starred" tags mark relics with parts for your starred items.</footer>`;
  renderUpdated();
}

/* ---------- MASTERY NUMBERS (Profile, Home, the Mastery page) ---------- */
function mrStats() {
  let items = 0, n = 0;
  ALL.forEach(it => { if (state.mastered[it.id]) { items += masteryXP(it); n++; } });
  const ex = extraXP(), adj = mrAdj(), xp = Math.max(0, items + Object.values(ex).reduce((a, b) => a + b, 0) + adj);
  let r = 0; while (mrNeed(r + 1) <= xp) r++;
  const lo = mrNeed(r), hi = mrNeed(r + 1);
  return { items, n, ex, adj, xp, r, lo, hi, pct: Math.min(100, 100 * (xp - lo) / (hi - lo)) };
}

/* ---------- PAGE: HOME ---------- */
const GEAR_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>`;
const FOCUS_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>`;
function checklistStats(sec) {
  const base = CHECKLIST[sec].flatMap(([, list]) => list), mine = state.weekly.c.filter(x => x.sec === sec && x.text);
  return { all: base.length + mine.length, done: base.filter(([id]) => wTicked(sec, id)).length + mine.filter(x => wTicked(sec, x.id)).length };
}
const miniBar = (got, tot, cls) => `<span class="bar${cls ? " " + cls : ""}"><i style="width:${tot ? Math.max(2, 100 * got / tot) : 0}%"></i></span>`;
function renderHome(force) {
  const el = $("#home"); if (!el) return;
  // don't wipe a relic name half typed into Focus mode when the live feed refreshes
  const ae = document.activeElement;
  if (!force && state.focus && ae && el.contains(ae) && ae.matches("input[type=text]")) return;
  document.body.classList.toggle("focusing", !!state.focus);
  if (state.focus) { el.innerHTML = focusHTML(); return; }
  let h = `<header class="phead"><div class="ptitle"><h1 class="brand">Relic Companion</h1><button class="iconbtn plain" data-act="settings" aria-label="Settings">${GEAR_SVG}</button></div><div class="updated"></div></header>`;
  // Right now: live fissures your relics fit
  const { list } = fissList("any"), rel = list.filter(f => f.cnt);
  h += `<section class="pcard hot"><div class="pchead"><span class="lbl gold">Right now</span><button class="focusbtn" data-fx="start">${FOCUS_SVG}Focus mode</button></div>`
    + (!LIVE ? `<p class="empty">Live fissures show once the app can reach the worldstate.</p>`
      : !rel.length ? `<p class="secsub" style="margin:0">No fissures fit your relics right now. Everything that's running is on the Relics page.</p>`
      : `<div class="fiss">${rel.slice(0, 3).map(f => fissRowHTML(f)).join("")}</div>${rel.length > 3 ? `<button class="linkbtn more" data-go="${PG.relics}">${rel.length - 3} more on the Relics page</button>` : ""}`) + `</section>`;
  // Void Trader and checklist side by side
  const b = LIVE && LIVE.baro, here = b && baroHere(b), soon = b && !here && b.activation > Date.now();
  const spares = Object.keys(state.partCounts || {}).length ? ducatSpares() : null;
  const d = checklistStats("daily"), w = checklistStats("weekly");
  h += `<div class="hgrid">
    <button class="pcard tile" data-go="${PG.vendors}"><span class="lbl">Void Trader</span><span class="big baro">${here ? shortUntil(b.expiry) : soon ? shortUntil(b.activation) : "—"}</span>
      <small>${here ? "until he leaves" : soon ? "until he arrives" : "No visit in the feed"}${spares ? ` · ${spares.length} spare part${spares.length === 1 ? "" : "s"} to trade` : ""}</small></button>
    <button class="pcard tile" data-act="checklist"><span class="lbl">Checklist</span>
      <span class="trow"><span>Daily</span><span>${d.done} / ${d.all}</span></span>${miniBar(d.done, d.all, "teal")}
      <span class="trow"><span>Weekly</span><span>${w.done} / ${w.all}</span></span>${miniBar(w.done, w.all, "teal")}</button></div>`;
  const m = mrStats();
  h += `<button class="pcard tile wide" data-go="${PG.profile}"><span class="trow"><span class="lbl">Mastery Rank</span><b class="rank">${mrLabel(m.r)}</b></span>${miniBar(m.xp - m.lo, m.hi - m.lo)}<small>${(m.hi - m.xp).toLocaleString()} points to ${mrLabel(m.r + 1)}</small></button>`;
  // Starred: closest to done first
  const st = sortStarred(entriesOf(ALL.filter(it => isStarred(it) && (it.grp ? true : active(it)))));
  h += `<section class="pcard"><div class="pchead"><span class="lbl">Starred</span>${st.length ? `<button class="linkbtn" data-act="starred">See all</button>` : ""}</div>`
    + (st.length ? `<div class="srows">${st.slice(0, 5).map(e => { const s = entryStat(e); return `<button class="srow" data-open="${esc(e.key)}"><span class="trow"><b>${esc(e.n)}</b><span>${esc(s.txt)}</span></span>${miniBar(s.got, s.tot)}</button>`; }).join("")}</div>`
      : `<p class="secsub" style="margin:0">Tap the star on anything in Collection to follow it here.</p>`) + `</section>`;
  el.innerHTML = h; renderUpdated();
}
const sortStarred = list => list.filter(e => !entryStat(e).m).sort((a, b) => favMissing(a) - favMissing(b) || a.n.localeCompare(b.n));

/* ---------- PAGE: PROFILE ---------- */
const ICONS = {
  inv: `<path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3"/>`, imp: `<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>`,
  trade: `<path d="M4 5h16v11H8l-4 4z"/>`, foundry: `<path d="M3 20V11l5 3v-3l5 3V5h4l1.5 15z"/><path d="M3 20h18"/><path d="M7 17h2M12 17h2"/>`,
  set: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>`,
  bk: `<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>`,
};
const liRow = (attr, ic, t, sub) => `<button class="li" ${attr}><svg class="lic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[ic]}</svg><span class="lit">${t}<small>${sub}</small></span>${CHEV}</button>`;
function foundryCounts() {
  const ready = ALL.filter(readyToBuild).length, building = Object.keys(state.building).length, built = Object.keys(state.built).length;
  return { ready, building, built };
}
function renderProfile() {
  const el = $("#profile"); if (!el) return;
  const m = mrStats(), fc = foundryCounts();
  const rc = Object.values(state.relicCounts || {}).reduce((a, n) => a + (n > 0 ? n : 0), 0), pc = Object.values(state.partCounts || {}).reduce((a, n) => a + (n > 0 ? n : 0), 0);
  const fbits = [fc.building && `${fc.building} building`, fc.ready && `${fc.ready} ready to build`, fc.built && `${fc.built} to master`].filter(Boolean);
  el.innerHTML = `<header class="phead"><div class="ptitle"><h1>Profile</h1></div></header>
    <button class="pcard hot mrcard" data-sub="mastery"><span class="lbl gold">Mastery Rank</span>
      <span class="trow"><b class="rank big">${mrLabel(m.r)}</b><span class="mnext">→ ${mrLabel(m.r + 1)}</span></span>${miniBar(m.xp - m.lo, m.hi - m.lo, "thick")}
      <small>${(m.hi - m.xp).toLocaleString()} points to go</small>
      <span class="mrsplit"><span>Items (${m.n})</span><b>${m.items.toLocaleString()}</b><span>Star Chart + Steel Path</span><b>${(m.ex.sc + m.ex.sp).toLocaleString()}</b><span>Intrinsics</span><b>${(m.ex.rj + m.ex.dr).toLocaleString()}</b>${m.adj ? `<span>Matched to your game</span><b>${m.adj > 0 ? "+" : "−"}${Math.abs(m.adj).toLocaleString()}</b>` : ""}</span>
      <span class="tapmore">Edit Star Chart, Intrinsics and Match my game ›</span></button>
    <div class="pcard list">${liRow(`data-act="inventory"`, "inv", "Inventory", rc || pc ? `${rc.toLocaleString()} relics · ${pc.toLocaleString()} Prime parts` : "Nothing imported yet")}
      ${liRow(`data-sub="import"`, "imp", "Import data", "Relics, parts or the Codex")}
      ${liRow(`data-sub="trade"`, "trade", "Trade chat shortcuts", "WTB and WTS messages")}
      ${liRow(`data-sub="foundry"`, "foundry", "Foundry", fbits.join(" · ") || "Nothing building")}</div>
    <div class="pcard list">${liRow(`data-act="settings"`, "set", "Settings", "Theme, text size, info switches")}
      ${liRow(`data-act="backup"`, "bk", "Backup and codes", "Save, restore, enter a code")}</div>`;
}

/* ---------- SUB-PAGES (open over a page, with a back arrow) ---------- */
let SUB = null;
function masteryHTML() {
  const num = (k, f, max, label) => `<div class="drow xmrow"><label for="xm-${k}-${f}">${label}</label><input id="xm-${k}-${f}" type="number" inputmode="numeric" min="0" max="${max}" value="${xmGet(k, f) || ""}" placeholder="0" data-xm="${k}" data-xf="${f}"><span class="xmmax">/ ${max}</span></div>`;
  return `<div class="summary mrbox" id="mrBox"></div>
    <p class="dnote">Items count once you mark them Mastered. Add the rest below; your profile in the game shows how much of each chart you've cleared.</p>
    ${XM.charts.map(([k, l]) => `<div class="xmhead"><h4>${l}</h4><button class="chip ghost" data-xmall="${k}">All done</button></div>${k === "sp" ? `<p class="dnote">Got the Steel Path? Then the Star Chart is done: tapping All done there fills it in.</p>` : ""}${num(k, "n", XM.NODES, "Nodes cleared")}${num(k, "j", XM.JUNCTIONS, "Junctions won")}`).join("")}
    ${XM.intr.map(([k, l, trees]) => `<div class="xmhead"><h4>${l}</h4><button class="chip ghost" data-xmall="${k}">All maxed</button></div>${trees.map(t => num(k, t, 10, t)).join("")}`).join("")}
    <p class="dnote">Each node pays once the first time you clear it, and again on the Steel Path; each Junction pays 1,000. Every Intrinsic rank pays 1,500, up to rank 10 in each tree. Node points vary a little from node to node, so partial charts are an estimate.</p>
    <div class="xmhead"><h4>Match my game</h4>${mrAdj() ? `<button class="chip ghost" id="mrClear">Undo</button>` : ""}</div>
    <p class="dnote">The game also counts things the app can't see, like ranks gained on gear you levelled and then sold. Enter your rank and the points your profile says you need for the next one, then tap Match. The app keeps the difference; if you later fix a tick that caused it, match again.</p>
    <div class="drow xmrow"><label for="mrRank">Your rank</label><select id="mrRank">${Array.from({ length: 81 }, (_, r) => `<option value="${r}"${r === mrNow() ? " selected" : ""}>${mrLabel(r)}</option>`).join("")}</select></div>
    <div class="drow xmrow"><label for="mrLeft">Points to next</label><input id="mrLeft" type="text" inputmode="numeric" placeholder="97,862"></div>
    <button class="chip" id="mrGo">Match</button><p class="codemsg" id="mrMsg"></p>`;
}
function importHTML() {
  return `<h4>Inventory Scan</h4>
    <p class="dnote">Upload a screen recording to update your relics, parts or mastery. For Mastery, record the Codex sorted by rank.</p>
    ${[["relics", "Relics"], ["parts", "Parts"], ["mastery", "Mastery"]].map(([k, l]) => `<div class="fbrow"><span class="fblabel">${l}</span><label class="filebox${SCAN_UI.busy ? " off" : ""}"><span class="fbtn">Choose file</span><span class="fname">${esc(state.scanFiles[k] || "No file chosen")}</span><input type="file" accept="video/*" data-scan="${k}" hidden${SCAN_UI.busy ? " disabled" : ""}></label></div>`).join("")}
    <div class="controls"><button class="chip ghost" data-act="inventory">View inventory</button></div>
    <div class="scanmsg${SCAN_UI.bad ? " bad" : ""}" id="scanMsg" role="status">${esc(SCAN_UI.msg)}${SCAN_UI.busy ? ` <button class="linkbtn" id="scanCancel">Cancel</button>` : ""}</div>`;
}
function tradeHTML() {
  return `<p class="secsub">Ready-made "want to buy" messages for the parts you're missing on starred Primes. Each stays under ${TRADE_LIMIT} characters.</p>
    <div id="trade"></div>
    <h3 class="sub3">Write your own</h3>
    <p class="secsub">Type what you're after, one item at a time. Pick the proper name from the suggestions; the app adds the [brackets] and splits long lists to fit chat.</p>
    <div class="controls" id="tbMode"><button class="chip" data-tbmode="WTB">WTB</button><button class="chip" data-tbmode="WTS">WTS</button></div>
    <div class="tbin"><input class="search" id="tbIn" type="text" placeholder="Add an item, e.g. ash prime systems" autocomplete="off" aria-label="Item to add" list="tbList"><datalist id="tbList"></datalist>
      <button class="chip" id="tbAdd">Add</button></div><span class="toast" data-toast></span>
    <div class="tbchips" id="tbChips"></div><div id="tbOut"></div>
    <footer>Tap Copy, then paste into trade chat. Duplicates show as x2.</footer>`;
}
function foundryHTML() {
  const rowOf = (it, extra) => `<div class="crow"><button class="cmain" data-open="${esc(it.grp && GROUPS[it.grp] ? it.grp : it.id)}"><span class="ctl"><b>${esc(it.n)}</b><span class="cc">${extra}</span></span></button></div>`;
  const ready = ALL.filter(readyToBuild), building = Object.keys(state.building).map(id => BYID[id]).filter(Boolean), built = Object.keys(state.built).map(id => BYID[id]).filter(Boolean);
  let h = `<p class="secsub">Items with every part ticked, what you've started building, and what's waiting to be levelled. Build timers count down here and on each item.</p>`;
  h += `<h2 class="sec rtbsec">Ready to build<span class="seccnt">${ready.length}</span></h2>` + (ready.length ? `<div class="rows">${ready.map(it => rowOf(it, "All parts ✓").replace("</button></div>", `</button><button class="chip build" data-build="${it.id}">Building</button></div>`)).join("")}</div>` : `<p class="empty">Nothing ready yet.</p>`);
  h += `<h2 class="sec">Building<span class="seccnt">${building.length}</span></h2>` + (building.length ? `<div class="rows">${building.map(it => rowOf(it, state.building[it.id].e > Date.now() ? `ready in ${shortUntil(state.building[it.id].e)}` : "ready to claim")).join("")}</div>` : `<p class="empty">Nothing in the Foundry.</p>`);
  h += `<h2 class="sec">Claimed, not mastered yet<span class="seccnt">${built.length}</span></h2>` + (built.length ? `<div class="rows">${built.map(it => rowOf(it, "Level it to 30, then mark it Mastered").replace("</button></div>", `</button><button class="chip ghost" data-mastered="${it.id}">Mastered</button></div>`)).join("")}</div>` : `<p class="empty">Nothing waiting.</p>`);
  return h;
}
const SUBS = {
  item: k => {
    const g = GROUPS[k];
    if (g) { const e = entriesOf(grpItems(k))[0]; return e ? { title: g.slot || CAT_LABEL[g.cat] || g.n, html: `<div class="grid one">${gcardHTML(e)}</div>` } : null; }
    const it = BYID[k]; if (!it) return null;
    expanded.clear(); expanded.add(it.id); // the item page always shows its relics and info
    return { title: it.slot || CAT_LABEL[it.cat] || "Item", html: `<div class="grid one">${cardHTML(it)}</div>`, after: () => document.querySelectorAll("#subWrap .card[data-item]").forEach(c => groupCounts(c, BYID[c.dataset.item])) };
  },
  missing: () => ({ title: "Every missing part", html: missingHTML() }),
  mastery: () => ({ title: "Mastery Rank", html: masteryHTML(), after: renderMR }),
  import: () => ({ title: "Import data", html: importHTML() }),
  trade: () => ({ title: "Trade chat shortcuts", html: tradeHTML(), after: () => { bindTradeBuilder(); renderTrade(); } }),
  foundry: () => ({ title: "Foundry", html: foundryHTML() }),
};
function openSub(kind, arg) {
  SUB = { kind, arg };
  if (!renderSub()) return;
  $("#subBody").scrollTop = 0;
  document.body.classList.add("sub-open"); $("#sub").setAttribute("aria-hidden", "false");
  if (window.__upCheck) window.__upCheck();
}
function renderSub() {
  if (!SUB) return false;
  const r = SUBS[SUB.kind] && SUBS[SUB.kind](SUB.arg);
  if (!r) { closeSub(); return false; }
  $("#subTitle").textContent = r.title; $("#subWrap").innerHTML = r.html;
  if (r.after) r.after();
  return true;
}
function closeSub() {
  if (!SUB) return;
  SUB = null; expanded.clear();
  document.body.classList.remove("sub-open"); $("#sub").setAttribute("aria-hidden", "true");
  if (window.__upCheck) window.__upCheck();
}
const subIs = (...k) => SUB && k.includes(SUB.kind);

/* ---------- FOCUS MODE ----------
   A relic mission from start to finish: pick the fissure, type the squad's relics, then pick
   the reward you got. On endless missions every round is logged and nothing is ticked until
   the run summary is saved, so mistakes are easy to fix. */
const ENDLESS_RE = /survival|defen[cs]e|excavation|interception|disruption|alchemy|cascade|armageddon|flood|conjunction/i;
let RELIC_REW = null; // relic -> [{full, rar, d}]
function relicRewards(r) {
  if (!RELIC_REW) {
    RELIC_REW = {};
    ITEMS.forEach(it => (it.parts || []).forEach(p => (p.r || []).forEach(([rn, rar]) => (RELIC_REW[rn] = RELIC_REW[rn] || []).push({ full: p.full, rar, d: p.d || 0 }))));
    Object.values(RELIC_REW).forEach(l => { if (l.length < 6 && !l.some(x => x.full === "Forma Blueprint")) l.push({ full: "Forma Blueprint", rar: "C", d: 0 }); });
  }
  return RELIC_REW[r] || [];
}
const FOCUS_RAR = { C: 0, U: 1, R: 2 }; // the reward list goes Common, Uncommon, Rare
const partNeeded = full => ALL.some(it => active(it) && unitsOf(it).some(u => u.full === full && !u.whole && !isTicked(u)));
const DUC = () => { const m = {}; ITEMS.forEach(it => (it.parts || []).forEach(p => { m[p.full] = p.d || 0; })); return m; };
function focusRewards(relics) {
  const m = new Map();
  relics.filter(Boolean).forEach(r => relicRewards(r).forEach(x => {
    const e = m.get(x.full) || { ...x, from: [] }; if (!e.from.includes(r)) e.from.push(r); m.set(x.full, e);
  }));
  return [...m.values()].sort((a, b) => FOCUS_RAR[a.rar] - FOCUS_RAR[b.rar] || a.full.localeCompare(b.full));
}
const fsave = () => { save(); renderHome(true); };
function focusStart() {
  state.focus = { m: null, slots: ["", "", "", ""], round: 1, log: [], stage: "setup", started: Date.now(), extra: [], pick: null };
  fsave(); goPage(PG.home, false); $("#pg-home").scrollTop = 0;
}
function focusHead(F, title) {
  return `<header class="phead fhead"><div class="ptitle"><h1 class="ftitle"><span class="livedot" aria-hidden="true"></span>${title || "Focus"}${F.m && F.m.endless && F.stage !== "summary" ? `<span class="fround">· Round ${F.round}</span>` : ""}</h1>
    ${F.stage === "summary" ? "" : `<button class="chip ghost" data-fx="end">End</button>`}</div></header>`;
}
function focusHTML() {
  const F = state.focus;
  if (F.stage === "reward") return focusRewardHTML(F);
  if (F.stage === "summary") return focusSummaryHTML(F);
  let h = focusHead(F);
  // the mission
  if (F.m) {
    h += `<section class="pcard"><div class="pchead"><span class="lbl">Mission</span><button class="linkbtn" data-fx="mission">Change</button></div>
      <div class="frow">${tierChip(F.m.tier)}<span class="mi"><span class="mt">${esc(F.m.type || "Relic mission")}</span><small>${esc(F.m.node || "")}</small></span>${F.m.exp > Date.now() ? `<span class="tl">${shortUntil(F.m.exp)}</span>` : ""}</div>
      <label class="tgl"><span>Endless: pick a reward every round</span><input type="checkbox" id="fxEndless"${F.m.endless ? " checked" : ""}></label></section>`;
  } else {
    const { list } = fissList("any");
    h += `<section class="pcard"><div class="pchead"><span class="lbl">Which mission?</span></div>
      ${list.length ? `<div class="fiss">${list.map(f => fissRowHTML(f, true)).join("")}</div>` : `<p class="secsub">No fissures in the live feed right now.</p>`}
      <p class="secsub" style="margin:10px 0 6px">Or just pick the relic tier:</p>
      <div class="controls">${["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"].map(t => `<button class="chip ghost" data-fxtier="${t}">${t}</button>`).join("")}</div></section>`;
  }
  // the squad's relics
  const n = F.slots.filter(Boolean).length;
  h += `<section class="pcard"><div class="pchead"><span class="lbl">Squad relics</span><span class="pnote">${n} of 4</span></div><div class="slots">`
    + F.slots.map((r, i) => {
      const who = i ? String(i + 1) : "You", own = !i && r && state.relicCounts[r] ? `<small>${state.relicCounts[r]} owned</small>` : "";
      return r ? `<div class="slot"><span class="who${i ? "" : " me"}">${who}</span><b>${esc(r)}</b>${own}<button class="x" data-fxclr="${i}" aria-label="Remove ${esc(r)}">×</button></div>`
        : `<div class="slot open"><label class="who${i ? "" : " me"}" for="fxs${i}">${who}</label><input id="fxs${i}" data-fxslot="${i}" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="${i ? "Their relic" : "Your relic"}, e.g. ${F.m && F.m.tier && F.m.tier !== "Omnia" && F.m.tier !== "Requiem" ? F.m.tier : "Lith"} A13"></div><div class="sug" id="fxsug${i}"></div>`;
    }).join("") + `</div></section>
    <p class="secsub">Type the relic each squadmate equipped. Fewer than four is fine.</p>`;
  const rw = focusRewards(F.slots), need = rw.filter(x => partNeeded(x.full));
  if (n) h += `<section class="pcard hot"><div class="trow"><span>Rewards in play<small>${rw.length} possible · ${need.length} you need</small></span>${need.length ? `<b class="gold">${esc(need[0].full)}${need.length > 1 ? ` +${need.length - 1}` : ""}</b>` : ""}</div></section>`;
  h += `<button class="bigbtn" data-fx="go"${n ? "" : " disabled"}>${F.round > 1 || F.log.length ? "Pick your reward" : "Start"}</button>`;
  return h;
}
function rewardRowsHTML(list, picked, name) {
  const duc = DUC();
  return list.map(x => {
    const need = partNeeded(x.full), spare = !need && duc[x.full];
    return `<label class="rw${need ? " needrow" : ""}"><input type="radio" name="${name}" value="${esc(x.full)}"${picked === x.full ? " checked" : ""}><span class="n">${esc(x.full)}<small>${esc(x.from.join(" · "))}${spare ? ` · <span class="duc">spare, ${duc[x.full]} ducats</span>` : ""}</small></span>${need ? `<span class="needtag">Need</span>` : ""}<span class="rar ${x.rar}">${x.rar}</span></label>`;
  }).join("");
}
function focusRewardHTML(F) {
  const list = focusRewards(F.slots), endless = F.m && F.m.endless;
  let h = focusHead(F);
  h += `<div class="squad">${F.slots.map((r, i) => r ? `<span class="sq${i ? "" : " me"}">${esc(r.replace(/^(Lith|Meso|Neo|Axi|Requiem) /, ""))}</span>` : "").join("")}<button class="linkbtn" data-fx="edit">Edit squad</button></div>`;
  h += `<section class="pcard rwcard"><div class="pchead"><span class="lbl hi">Which reward did you get?</span><span class="pnote">${list.length} possible</span></div>${rewardRowsHTML(list, F.pick, "fxrw")}</section>`;
  h += endless ? `<button class="bigbtn" data-fx="next">Next round</button><p class="secsub center">Saves the reward you chose and clears the relics, ready for the next set.</p>`
    : `<button class="bigbtn" data-fx="done">Done</button><p class="secsub center">Ticks the part you got and takes your relic off your count.</p>`;
  if (endless && F.log.length) h += `<section class="pcard"><span class="lbl">This run</span>${F.log.map(l => `<div class="trow"><span class="muted">Round ${l.round}</span><span>${esc(l.pick || "Nothing picked")}</span></div>`).join("")}</section>`;
  return h;
}
function focusSummaryHTML(F) {
  const mins = Math.max(1, Math.round((Date.now() - F.started) / 60000)), rounds = F.log.length;
  let h = focusHead(F, "Run summary");
  h += `<p class="secsub">${F.m ? `${esc(F.m.tier)} ${esc(F.m.type || "")}${F.m.node ? ` · ${esc(F.m.node)}` : ""} · ` : ""}${rounds} round${rounds === 1 ? "" : "s"} · ${mins}m</p>`;
  const rar = n => { for (const l of F.log) for (const x of focusRewards(l.relics)) if (x.full === n) return x.rar; return ""; };
  h += `<section class="pcard"><div class="pchead"><span class="lbl hi">What you got</span><span class="pnote">check before saving</span></div>`
    + F.log.map((l, i) => l.pick
      ? `<div class="rd"><span class="r">Round ${l.round}</span><span class="n">${esc(l.pick)}</span>${partNeeded(l.pick) ? `<span class="needtag">Need</span>` : ""}${rar(l.pick) ? `<span class="rar ${rar(l.pick)}">${rar(l.pick)}</span>` : ""}<button class="x" data-fxdel="${i}" aria-label="Remove ${esc(l.pick)}">×</button></div>`
      : `<div class="rd"><span class="r">Round ${l.round}</span><span class="n muted">Nothing picked</span><button class="chip ghost" data-fxre="${i}">Pick</button></div>`).join("")
    + F.extra.map((n, i) => `<div class="rd"><span class="r">Added</span><span class="n">${esc(n)}</span><button class="x" data-fxdelx="${i}" aria-label="Remove ${esc(n)}">×</button></div>`).join("")
    + `<div class="addrow"><input id="fxAdd" type="text" list="fxParts" placeholder="Add a part you got" autocomplete="off" aria-label="Add a part you got"><datalist id="fxParts"></datalist><button class="chip" data-fx="add">Add</button></div></section>`;
  const got = F.log.filter(l => l.pick).length + F.extra.length, opened = F.log.filter(l => l.relics[0]).length;
  h += `<section class="pcard"><div class="trow"><span>Rewards</span><b>${got}</b></div><div class="trow"><span>Relics you opened</span><b>${opened}</b></div>
    <p class="secsub" style="margin:6px 0 0">Saving ticks the Prime parts you got and takes the relics you opened off your counts.</p></section>
    <div class="btnrow"><button class="bigbtn ghost" data-fx="back">Back</button><button class="bigbtn" data-fx="save">Save and finish</button></div>`;
  return h;
}
/* Tick one copy of a part (the first unticked one on an item you haven't mastered), or count it as
   a spare when every copy is already ticked. Forma and other non-parts are just logged. */
function applyReward(full) {
  const cand = []; ALL.forEach(it => unitsOf(it).forEach(u => { if (u.full === full && !u.whole && !isTicked(u)) cand.push([it, u]); }));
  const hit = cand.find(([it]) => active(it)) || cand[0];
  if (hit) { state.ticks[hit[1].id] = 1; return true; }
  if (DUC()[full] != null) { state.partCounts[full] = (state.partCounts[full] || 0) + 1; return true; }
  return false;
}
function useRelic(r) { if (r && state.relicCounts[r] > 0) state.relicCounts[r]--; }
function focusFinish(entries, extra) {
  const snap = snapState();
  let n = 0;
  entries.forEach(l => { if (l.pick && applyReward(l.pick)) n++; useRelic(l.relics[0]); });
  extra.forEach(p => { if (applyReward(p)) n++; });
  state.focus = null; save(); renderAll();
  offerUndo(n ? `Saved ${n} reward${n === 1 ? "" : "s"} from your run` : "Run finished", snap);
}
function focusSuggest(i, q) {
  const box = $("#fxsug" + i); if (!box) return;
  const F = state.focus, tier = F.m && !["Omnia"].includes(F.m.tier) ? F.m.tier : null;
  const norm = s => s.toLowerCase().replace(/\s+/g, " ").trim();
  q = norm(q);
  if (!q) { box.innerHTML = ""; return; }
  const names = Object.keys(DATA.relics || {}).filter(r => (!tier || tierOf(r) === tier) && (norm(r).includes(q) || norm(r.split(" ").slice(1).join(" ")).startsWith(q)));
  const own = r => !i ? state.relicCounts[r] || 0 : 0;
  names.sort((a, b) => own(b) - own(a) || relicSort(a, b));
  box.innerHTML = names.slice(0, 6).map(r => { const rare = relicRewards(r).find(x => x.rar === "R"); return `<button class="sugrow" data-fxpick="${i}|${esc(r)}"><b>${esc(r)}</b><span>${own(r) ? `${own(r)} owned · ` : ""}${rare ? esc(rare.full) : ""}</span></button>`; }).join("")
    || `<p class="secsub" style="margin:6px 12px">No ${tier ? tier + " " : ""}relic by that name.</p>`;
}
function focusClick(t) {
  const F = state.focus;
  const fx = t.closest("[data-fx]");
  if (fx) {
    const k = fx.dataset.fx;
    if (k === "start") { focusStart(); return true; }
    if (!F) return true;
    if (k === "end") {
      if (F.m && F.m.endless && (F.log.length || F.pick)) { if (F.pick) { F.log.push({ round: F.round, pick: F.pick, relics: F.slots.slice() }); F.pick = null; } F.stage = "summary"; fsave(); }
      else { state.focus = null; fsave(); }
      return true;
    }
    if (k === "mission") { F.m = null; fsave(); return true; }
    if (k === "go") { if (F.slots.some(Boolean)) { F.stage = "reward"; fsave(); $("#pg-home").scrollTop = 0; } return true; }
    if (k === "edit") { F.stage = "setup"; fsave(); return true; }
    if (k === "next") {
      F.log.push({ round: F.round, pick: F.pick, relics: F.slots.slice() });
      F.round++; F.pick = null; F.slots = ["", "", "", ""]; F.stage = "setup"; fsave(); $("#pg-home").scrollTop = 0;
      setTimeout(() => { const i = $("#fxs0"); if (i) i.focus(); }, 60);
      return true;
    }
    if (k === "done") { focusFinish([{ round: F.round, pick: F.pick, relics: F.slots.slice() }], []); return true; }
    if (k === "back") { F.stage = "reward"; if (F.log.length && !F.slots.some(Boolean)) { const l = F.log.pop(); F.slots = l.relics; F.pick = l.pick; F.round = l.round; } fsave(); return true; }
    if (k === "save") { focusFinish(F.log, F.extra); return true; }
    if (k === "add") {
      const v = ($("#fxAdd").value || "").trim(), all = [...new Set([...Object.keys(DUC()), "Forma Blueprint"])];
      const name = all.find(n => n.toLowerCase() === v.toLowerCase()) || all.find(n => n.toLowerCase().startsWith(v.toLowerCase()) && v.length > 2);
      if (name) { F.extra.push(name); fsave(); } else if (v) say(fx, "No part by that name");
      return true;
    }
    return true;
  }
  if (!F) return false;
  const fp = t.closest("[data-fpick]");
  if (fp) { const [tier, type, node, exp, hard] = fp.dataset.fpick.split("|"); F.m = { tier, type, node, exp: +exp, sp: hard === "1", endless: ENDLESS_RE.test(type) }; fsave(); return true; }
  const ftr = t.closest("[data-fxtier]");
  if (ftr) { F.m = { tier: ftr.dataset.fxtier, type: "", node: "", exp: 0, endless: false }; fsave(); return true; }
  const pk = t.closest("[data-fxpick]");
  if (pk) { const [i, r] = pk.dataset.fxpick.split("|"); F.slots[+i] = r; fsave(); const nx = document.querySelector("[data-fxslot]"); if (nx) nx.focus(); return true; }
  const cl = t.closest("[data-fxclr]");
  if (cl) { F.slots[+cl.dataset.fxclr] = ""; fsave(); return true; }
  const dl = t.closest("[data-fxdel]");
  if (dl) { F.log[+dl.dataset.fxdel].pick = null; fsave(); return true; }
  const dx = t.closest("[data-fxdelx]");
  if (dx) { F.extra.splice(+dx.dataset.fxdelx, 1); fsave(); return true; }
  const re = t.closest("[data-fxre]");
  if (re) { focusRepick(+re.dataset.fxre); return true; }
  return false;
}
/* Summary: pick a reward for a round you skipped */
function focusRepick(i) {
  const F = state.focus, l = F.log[i];
  $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name">Round ${l.round}</div><div class="meta"><span class="tag">${esc(l.relics.filter(Boolean).join(" · ") || "No relics logged")}</span></div></div>
    <div class="mbody rwcard">${rewardRowsHTML(focusRewards(l.relics), null, "fxre")}</div><div class="tourbtns"><button class="chip ghost" data-close>Cancel</button><button class="chip" id="fxReOk">Use this</button></div></article></div>`;
  $("#fxReOk").onclick = () => { const c = document.querySelector('input[name="fxre"]:checked'); if (c) { l.pick = c.value; fsave(); } closeModal(); };
}

/* ---------- UPDATED LINE ---------- */
function renderUpdated() { // short: "Updated 18 h ago" with a dot that turns amber when offline
  const off = (DATA_OFFLINE && DATA_SRC !== "none") || LIVE_OFFLINE;
  let s;
  if (DATA_SRC === "none") s = "Loading…";
  else if (DATA.seed) s = "Starter data";
  else s = `Updated ${ago(Math.max(DATA_AT, LIVE ? LIVE_AT : 0))}`;
  const html = `<span class="sdot${off ? " off" : ""}" role="img" aria-label="${off ? "Offline" : "Online"}"></span>${s}${off ? ` <span class="off">offline</span>` : ""}`;
  document.querySelectorAll(".updated").forEach(el => { el.innerHTML = html; });
}

/* ---------- DRAWER ---------- */
function renderDrawer() {
  const st = S(), sd = specialDay();
  const sw = (k, l) => `<label class="tgl"><span>${l}</span><input type="checkbox" data-show="${k}"${st.show[k] ? " checked" : ""}></label>`;
  const vend = ([k, l]) => `<label class="tgl"><span>${l}</span><input type="checkbox" data-vend="${k}"${st.hideVend[k] ? "" : " checked"}></label>`;
  $("#drawer").innerHTML = `<h2>Settings</h2>
    <details class="dsec"><summary>Appearance</summary><div class="dbody">
      <h4>Theme</h4>
      ${sd ? `<div class="sdnote">${sd.dev ? `${esc(sd.label)} theme is on from Dev tools. Pick Off there to get your theme back.` : `${esc(sd.label)} theme is on today. Your theme comes back tomorrow.`}</div>` : ""}
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
      <h4>Vendors</h4>
      ${VENDORS.map(vend).join("")}
      <h4>Best farm source</h4>
      <div class="seg"><button data-farm="rates" aria-pressed="${st.farm === "rates"}">By the Rates</button><button class="mid" data-farm="both" aria-pressed="${st.farm === "both"}" aria-label="Both">Both</button><button data-farm="community" aria-pressed="${st.farm === "community"}">Community-Driven</button></div>
      <p class="seghelp">${{ rates: "The best mission for each relic, worked out from DE's drop tables.", community: "The farm players recommend.", both: "By the Rates on top, Community-Driven below. When they agree it shows once." }[st.farm]}</p>
    </div></details>
    ${devSecHTML()}
    <div class="spacer"></div>
    <h3 id="codeSec">Enter code</h3>
    <div class="codebox"><input id="codeIn" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Code"><button class="chip" id="codeBtn">Unlock</button></div>
    <div class="codemsg" id="codeMsg" role="status"></div>
    ${soundRow()}
    <div class="drow"><label for="startSel">Start page</label><select id="startSel" class="dsel">${START_PAGES.map(([v, l]) => `<option value="${v}"${+st.startPage === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="backup" id="bkSec"><h3>Backup / restore</h3>
      <div class="controls"><button class="chip" id="bkCopy">Copy backup code</button><button class="chip" id="bkSave">Save backup file</button></div>
      <textarea id="bkIn" placeholder="Paste a backup code here to restore" spellcheck="false"></textarea>
      <div class="controls"><button class="chip ghost" id="bkRestore">Restore</button><label class="chip ghost filechip">Restore from file<input type="file" accept=".txt,text/plain" id="bkFile" hidden></label><span class="toast" data-toast></span></div>
      <div class="controls"><button class="chip danger" id="clearBtn">Clear data</button></div>
      <p class="fanline">${native && native.version ? `Version ${esc(native.version())} · ` : ""}Fan-made app, not affiliated with Digital Extremes. Warframe is a trademark of Digital Extremes Ltd.</p></div>
    <button class="helpbtn" id="tourBtn" aria-label="Show the tour again">?</button>`;
}
const VENDORS = [["baro", "Void Trader"], ["darvo", "Darvo's Deal"], ["teshin", "Teshin (Steel Path Honors)"], ["circuit", "Steel Path Circuit"], ["varzia", "Varzia"]];
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
  document.querySelectorAll(".filebox").forEach(f => { f.classList.toggle("off", !!busy); f.querySelector("input").disabled = !!busy; });
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
    if (!all.length) { $("#invList").innerHTML = `<p class="empty">Nothing imported yet. Upload a recording of your ${isR ? "relics" : "parts"} under Profile › Import data.</p>`; return; }
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
// in calendar order; equinoxes move a little each year
const SPECIAL_DAYS = [
  { id: "newyear", theme: "sd-newyear", label: "New Year's", fx: "confetti", m: 1, d: 1 },
  { id: "spring", theme: "sd-spring", label: "Spring equinox", eq: "spring", fx: "spring" },
  { id: "d77", theme: "sd-77", label: "7/7", fx: "d77", m: 7, d: 7 },
  { id: "autumn", theme: "sd-autumn", label: "Autumn equinox", eq: "autumn", fx: "autumn" },
  { id: "halloween", theme: "sd-halloween", label: "Halloween", m: 10, d: 31 },
  { id: "christmas", theme: "sd-christmas", label: "Christmas", fx: "snow", m: 12, d: 25 },
];
const birthdayDays = () => Object.values(state.secrets || {}).filter(x => x && x.type === "birthday")
  .map(x => ({ id: x.id, theme: x.theme, label: `${x.name}'s birthday`, banner: x.message, m: x.month, d: x.day }));
/* 7/7: the theme follows the subclass picked today (none yet: the plain starry one) */
const D77 = [
  ["solar", "Solar", "Burn bright.", ["#fff4e3", "#f28a1d", "#e2b23c"]], ["arc", "Arc", "Strike fast.", ["#eef3f9", "#2f8cff", "#9cc8ff"]],
  ["void", "Void", "Bend the dark.", ["#f3edf9", "#7a3fd6", "#c4a3f2"]], ["stasis", "Stasis", "Hold the moment.", ["#0f1f2e", "#9fe2ff", "#e6f7ff"]],
  ["strand", "Strand", "Weave your path.", ["#0b100a", "#a6ff3c", "#e6ffd0"]], ["prism", "Prismatic", "Light and Dark, in balance.", ["#f7f4ee", "#d9b45a", "#24232b"]],
];
const localDay = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const d77Pick = () => state.d77 && state.d77.day === localDay() && D77.some(x => x[0] === state.d77.pick) ? state.d77.pick : null;
const withPick = x => x && x.id === "d77" ? { ...x, theme: d77Pick() ? "sd-77-" + d77Pick() : "sd-77", sub: d77Pick() } : x;
const decoKey = sd => sd ? sd.id + (sd.sub ? ":" + sd.sub : "") : null;
function specialDay(now = new Date()) {
  const forced = typeof devDay === "function" ? devDay() : null; // Dev tools can switch one on by hand
  if (forced) return withPick(forced);
  const m = now.getMonth() + 1, d = now.getDate(), y = now.getFullYear();
  const hit = [...birthdayDays(), ...SPECIAL_DAYS].find(x => x.eq ? sameDay(now, equinox(y, x.eq === "autumn")) : x.m === m && x.d === d);
  return withPick(hit) || null;
}
let decoFor = null;
function decorate(sd) {
  const key = decoKey(sd);
  if (decoFor === key) return;
  decoFor = key;
  document.querySelectorAll(".snow,.buddy,.bdbanner").forEach(e => e.remove());
  stopFall(); stopD77();
  if (!sd) return;
  if (FALL[sd.fx]) startFall(sd.fx);
  if (sd.fx === "d77") { startD77(sd.sub); if (!sd.sub && !$("#intro") && !$("#modal") && !d77Asked) setTimeout(showD77Picker, 500); }
  if (sd.fx === "snow") document.body.insertAdjacentHTML("beforeend", `<div class="snow" aria-hidden="true"></div>`);

  if (sd.fx === "confetti" && !S().reduceMotion && (sd.dev || !sessionStorage.getItem("wrc-confetti"))) {
    if (!sd.dev) try { sessionStorage.setItem("wrc-confetti", "1"); } catch (e) {}
    setTimeout(confettiBurst, document.getElementById("intro") ? 2000 : 0); // after the launch animation
  }
  const yk = `${sd.id}-${new Date().getFullYear()}`;
  if (sd.banner && (sd.dev || !state.banners[yk])) { // a Dev tools preview doesn't use up the real day's banner
    if (!sd.dev) { state.banners[yk] = 1; save(); }
    document.body.insertAdjacentHTML("beforeend", `<div class="bdbanner" role="status">${esc(sd.banner)}<button aria-label="Dismiss" data-bdclose>×</button></div>`);
    document.querySelector("[data-bdclose]").addEventListener("click", e => e.target.parentElement.remove());
  }
}
/* ---------- FALLING LEAVES AND PETALS (equinoxes) ----------
   Drawn in a layer behind the pages, so they drift through the gaps between cards and never
   cover any text. Spring: a few green leaves and cherry blossom petals, with the odd gust of
   wind. Autumn: a steady fall of red, orange, yellow and brown leaves. */
const LEAF_SVG = {
  leaf: c => `<svg viewBox="0 0 24 24"><path d="M12 1.5C5.5 8 5 15.5 12 22.5c7-7 6.5-14.5 0-21z" fill="${c}"/><path d="M12 4v18M12 11l-3-2.5M12 15l3.2-2.6" stroke="rgba(0,0,0,.22)" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`,
  petal: c => `<svg viewBox="0 0 20 20"><path d="M10 19C4.2 14.2 3.2 7 6.8 1.8c1.2 1.5 2 2.1 3.2 2.1s2-.6 3.2-2.1C16.8 7 15.8 14.2 10 19z" fill="${c}"/><path d="M10 17V7" stroke="rgba(160,40,80,.18)" stroke-width="1" fill="none"/></svg>`,
  maple: c => `<svg viewBox="0 0 24 24"><path d="M12 1.5l1.7 4.3 3.4-1.7-.9 4.6 4.6.6-3.6 3 1.9 3.6-4.5-.9-.9 4.6-1.7-3.5-1.7 3.5-.9-4.6-4.5.9 1.9-3.6-3.6-3 4.6-.6-.9-4.6 3.4 1.7z" fill="${c}"/><path d="M12 18v5" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
};
const FALL = {
  spring: { every: 1900, max: 5, gust: true, dur: [10, 15], pick: () => Math.random() < .55
    ? ["petal", ["#f7c3d2", "#f4a9bf", "#fbd7e1", "#f1b0c6"], 10, 15] : ["leaf", ["#6dbb55", "#8fcf63", "#4f9a3e", "#a3d977"], 14, 21] },
  autumn: { every: 620, max: 16, dur: [8, 13], pile: true, pick: () => [Math.random() < .55 ? "maple" : "leaf",
    ["#b8321e", "#d4521c", "#e8862a", "#eab531", "#c96a24", "#8b4a22", "#6f3a1d", "#a8261c"], 15, 24] },
};
let fallTimer = 0, gustTimer = 0, fallKind = null;
const rnd = (a, b) => a + Math.random() * (b - a);
function dropOne(cfg, layer, wind) {
  if (layer.childElementCount >= cfg.max + (wind ? 14 : 0)) return;
  const [shape, cols, s0, s1] = cfg.pick(), size = rnd(s0, s1);
  const el = document.createElement("i");
  el.className = "fall";
  const dur = wind ? rnd(4.5, 6.5) : rnd(cfg.dur[0], cfg.dur[1]);
  el.style.cssText = `left:${rnd(-10, wind ? 70 : 100)}vw;width:${size}px;height:${size}px;--dur:${dur}s;--dx:${wind ? rnd(140, 260) : rnd(-60, 60)}px;--rot:${rnd(-540, 540)}deg;--sway:${rnd(14, 34)}px;--swd:${rnd(2.2, 3.8)}s`;
  el.innerHTML = `<b>${LEAF_SVG[shape](cols[Math.floor(Math.random() * cols.length)])}</b>`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), dur * 1000 + 200);
}
function startFall(kind) {
  const cfg = FALL[kind]; if (!cfg) return;
  fallKind = kind;
  const layer = document.createElement("div");
  layer.className = "fxbg"; layer.setAttribute("aria-hidden", "true");
  document.body.prepend(layer);
  if (cfg.pile) leafPiles(cfg);
  if (S().reduceMotion) { // still, a few lying where they fell
    for (let i = 0; i < 7; i++) { dropOne(cfg, layer); }
    layer.querySelectorAll(".fall").forEach(el => { el.classList.add("still"); el.style.top = rnd(8, 92) + "vh"; });
    return;
  }
  for (let i = 0; i < Math.ceil(cfg.max / 3); i++) setTimeout(() => dropOne(cfg, layer), rnd(0, cfg.every * 2));
  fallTimer = setInterval(() => { if (!document.hidden) dropOne(cfg, layer); }, cfg.every);
  if (cfg.gust) { // now and then a gust blows a flurry across
    const gust = () => {
      gustTimer = setTimeout(() => {
        if (!document.hidden) for (let i = 0; i < 12; i++) setTimeout(() => dropOne(cfg, layer, true), i * 190);
        gust();
      }, rnd(16e3, 34e3));
    };
    gust();
  }
}
function stopFall() {
  clearInterval(fallTimer); clearTimeout(gustTimer); fallKind = null;
  document.querySelectorAll(".fxbg,.leafpile").forEach(e => e.remove());
}
/* Autumn: a few small piles and a thin scatter of leaves resting on top of the bottom bar */
function leafPiles(cfg) {
  const nav = $("#bnav"); if (!nav) return;
  const box = document.createElement("div");
  box.className = "leafpile"; box.setAttribute("aria-hidden", "true");
  const leaf = (x, y, size) => {
    const [shape, cols] = cfg.pick();
    return `<i style="left:${x}%;bottom:${y}px;width:${size}px;height:${size}px;transform:rotate(${rnd(-180, 180)}deg)">${LEAF_SVG[shape](cols[Math.floor(Math.random() * cols.length)])}</i>`;
  };
  let h = "";
  for (let i = 0; i < 16; i++) h += leaf(rnd(1, 97), rnd(-4, 1), rnd(8, 12)); // the thin blanket
  [rnd(4, 22), rnd(40, 58), rnd(76, 94)].forEach(cx => { // three small piles, heaped in the middle
    for (let i = 0; i < 15; i++) { const off = rnd(-1, 1) * rnd(0, 6); h += leaf(cx + off, Math.max(-3, 9 - Math.abs(off) * 1.5 + rnd(-3, 2)), rnd(10, 15)); }
  });
  box.innerHTML = h;
  nav.appendChild(box);
}
/* ---------- 7/7 (Bungie Day) ----------
   Pick a subclass on the day's first launch; each has its own look. Everyone gets drifting stars,
   the odd shooting star and a little companion flying past, all behind the pages. The buddy is
   an original design (a round probe with a visor); tap it to pick again. */
const BUDDY_SVG = `<svg viewBox="0 0 44 44" aria-hidden="true"><g class="bfins"><path d="M9.5 22c-3.4.2-5-2.6-3.2-5.4" /><path d="M34.5 22c3.4.2 5-2.6 3.2-5.4" /></g>
  <line x1="22" y1="10" x2="22" y2="5.5" class="bant"/><circle cx="22" cy="4.6" r="2" class="btip"/>
  <circle cx="22" cy="22" r="12" class="bbody"/><path d="M12.6 25.5a12 12 0 0 0 18.8 0" class="bbelly"/>
  <rect x="13" y="18.2" width="18" height="6.6" rx="3.3" class="bvisor"/><g class="beyewrap"><rect x="19" y="19.6" width="6" height="3.8" rx="1.9" class="eye"/></g></svg>`;
let d77Timers = [], d77Raf = 0, d77Asked = false, d77Off = null;
const d77Every = (fn, a, b) => { const go = () => d77Timers.push(setTimeout(() => { if (!document.hidden) fn(); go(); }, rnd(a, b))); go(); };
function startD77(sub) {
  // the buddy: tap it to change subclass
  document.body.insertAdjacentHTML("beforeend", `<button class="buddy" aria-label="Change your subclass">${BUDDY_SVG}</button>`);
  const bud = $(".buddy");
  bud.addEventListener("click", () => { buddyReact("spin"); setTimeout(showD77Picker, 250); });
  d77Every(() => { const e = bud.querySelector(".beyewrap"); if (!e) return; e.style.transform = `translateX(${rnd(-4, 4).toFixed(1)}px)`; setTimeout(() => { e.style.transform = ""; }, 1400); }, 5e3, 11e3);
  // the sky behind the pages
  const sky = document.createElement("div");
  sky.className = "fxbg d77sky"; sky.setAttribute("aria-hidden", "true");
  sky.innerHTML = `<div class="stars s1"></div><div class="stars s2"></div>`;
  document.body.prepend(sky);
  const still = S().reduceMotion;
  if (!still) {
    d77Every(() => { // a shooting star
      const st = document.createElement("i"); st.className = "shoot";
      st.style.cssText = `left:${rnd(10, 90)}vw;top:${rnd(4, 45)}vh;--len:${rnd(70, 140)}px;--ang:${rnd(18, 42)}deg`;
      sky.appendChild(st); setTimeout(() => st.remove(), 1400);
    }, 7e3, 18e3);
    d77Every(() => { // the little companion flies past
      const f = document.createElement("i"); f.className = "flyby" + (Math.random() < .5 ? " rtl" : "");
      f.style.cssText = `top:${rnd(15, 70)}vh;--rise:${rnd(-80, 80)}px`; f.innerHTML = BUDDY_SVG;
      sky.appendChild(f); setTimeout(() => f.remove(), 4200);
    }, 22e3, 50e3);
  }
  if (sub) d77Extras(sub, sky, still);
}
function d77Extras(sub, sky, still) {
  if (sub === "solar" && !still) { // embers drifting up, and now and then a burst of sparks
    d77Every(() => { if (sky.querySelectorAll(".ember").length > 10) return;
      const e = document.createElement("i"); e.className = "ember"; const d = rnd(6, 11);
      e.style.cssText = `left:${rnd(2, 98)}vw;--d:${d}s;--dx:${rnd(-50, 50)}px;--sz:${rnd(5, 9)}px`; sky.appendChild(e); setTimeout(() => e.remove(), d * 1000); }, 700, 1300);
    d77Every(() => { const x = rnd(10, 90), y = rnd(25, 85);
      for (let i = 0; i < 7; i++) { const k = document.createElement("i"); k.className = "spark";
        k.style.cssText = `left:${x}vw;top:${y}vh;--ang:${rnd(0, 360)}deg;--dist:${rnd(18, 46)}px`; sky.appendChild(k); setTimeout(() => k.remove(), 900); } }, 6e3, 14e3);
  }
  if (sub === "arc" && !still) d77Every(() => { // a crackle runs along a card edge on screen
    const cards = [...document.querySelectorAll(".page .pcard, .page .card, .subpage .card")].filter(c => { const r = c.getBoundingClientRect(); return r.bottom > 40 && r.top < innerHeight - 80 && r.width > 0; });
    const c = cards[Math.floor(Math.random() * cards.length)]; if (!c) return;
    // a jagged bolt runs along one edge of the card (on the border, clear of the words)
    const w = c.offsetWidth, h = c.offsetHeight, side = Math.floor(Math.random() * 4), pts = [];
    const n = Math.max(6, Math.round((side % 2 ? h : w) / 26));
    for (let i = 0; i <= n; i++) {
      const f = i / n, j = i && i < n ? rnd(-3.5, 3.5) : 0;
      pts.push(side === 0 ? [f * w, j] : side === 2 ? [f * w, h + j] : side === 1 ? [w + j, f * h] : [j, f * h]);
    }
    const z = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    z.setAttribute("class", "zap"); z.setAttribute("viewBox", `-6 -6 ${w + 12} ${h + 12}`);
    z.innerHTML = `<polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ")}"/>`;
    c.classList.add("zapped"); c.appendChild(z); setTimeout(() => { z.remove(); c.classList.remove("zapped"); }, 520);
  }, 3500, 8000);
  if (sub === "void") sky.insertAdjacentHTML("beforeend", `<div class="horizon"></div><div class="breath"></div>`);
  if (sub === "prism") prismSky(sky, still);
}
/* Prismatic: an ever-present pearly glow with a few golden glints, and dark tendrils creeping in from
   every edge, reaching for the middle and being pushed back: never winning, never gone. */
function prismSky(sky, still) {
  sky.insertAdjacentHTML("beforeend", `<div class="pearl"></div><div class="dusk"></div><svg class="tendrils"><defs><filter id="tdblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter></defs><g filter="url(#tdblur)"></g></svg>`);
  for (let i = 0; i < 7; i++) { const g = document.createElement("i"); g.className = "glint"; g.style.cssText = `left:${rnd(8, 92)}vw;top:${rnd(10, 85)}vh;--d:${rnd(3, 7)}s;--delay:${rnd(0, 5)}s`; sky.appendChild(g); }
  const svg = sky.querySelector(".tendrils"), grp = svg.querySelector("g");
  let W = 0, H = 0;
  const size = () => { W = innerWidth; H = innerHeight; svg.setAttribute("viewBox", `0 0 ${W} ${H}`); };
  size(); addEventListener("resize", size); d77Off = () => removeEventListener("resize", size);
  // spread around the four edges; each one leans in toward somewhere near the middle
  const T = Array.from({ length: 12 }, (_, i) => {
    const side = i % 4;
    return { side, t: (Math.floor(i / 4) + rnd(.15, .85)) / 3, aim: [rnd(.3, .7), rnd(.3, .7)], w: rnd(26, 46), reach: rnd(.42, .62),
      phase: rnd(0, 6.3), speed: rnd(.07, .14), wob: rnd(.12, .22), curl: rnd(-1, 1) < 0 ? -1 : 1, el: null };
  });
  T.forEach(t => { t.el = document.createElementNS("http://www.w3.org/2000/svg", "path"); grp.appendChild(t.el); });
  const draw = time => {
    const s = time / 1000;
    T.forEach(t => {
      const bx = [t.t * W, W + 6, t.t * W, -6][t.side], by = [-6, t.t * H, H + 6, t.t * H][t.side];
      const tx = t.aim[0] * W, ty = t.aim[1] * H;
      // it reaches in and is pushed back by the Light: never wins, never leaves
      const ext = t.reach * (.4 + .6 * (.5 + .5 * Math.sin(s * t.speed * 2 + t.phase)));
      const dx = tx - bx, dy = ty - by, full = Math.min(Math.hypot(dx, dy), t.side % 2 ? W * .55 : H * .32);
      const len = full * ext, ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy), nx = -uy, ny = ux;
      const N = 30, L = [], R = [];
      for (let k = 0; k <= N; k++) {
        const f = k / N, d = f * len;
        // a slow S-bend along the body, curling harder toward the tip
        const bend = (Math.sin(f * 4.2 - s * .9 + t.phase) * .55 + t.curl * f * f * 1.4) * t.wob * len * f;
        const cx = bx + ux * d + nx * bend, cy = by + uy * d + ny * bend, hw = t.w * Math.pow(1 - f, 1.25) / 2 + .6;
        L.push(`${(cx + nx * hw).toFixed(1)},${(cy + ny * hw).toFixed(1)}`); R.unshift(`${(cx - nx * hw).toFixed(1)},${(cy - ny * hw).toFixed(1)}`);
      }
      t.el.setAttribute("d", `M${L.join(" L")} L${R.join(" L")} Z`);
      t.el.setAttribute("opacity", (.32 + .45 * ext / t.reach).toFixed(2));
    });
    if (!still && grp.isConnected) d77Raf = requestAnimationFrame(draw);
  };
  d77Raf = requestAnimationFrame(draw);
}
function stopD77() {
  d77Timers.forEach(clearTimeout); d77Timers = []; cancelAnimationFrame(d77Raf); if (d77Off) { d77Off(); d77Off = null; }
  document.querySelectorAll(".d77sky, .buddy").forEach(e => e.remove());
  document.querySelectorAll(".zap").forEach(e => e.remove()); document.querySelectorAll(".zapped").forEach(e => e.classList.remove("zapped"));
}
function showD77Picker() {
  d77Asked = true;
  const cur = d77Pick();
  $("#modalRoot").innerHTML = `<div class="modal d77pick" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name d77greet">Eyes up, Guardian</div><div class="meta"><span class="tag">7/7</span><span class="cnt">Choose your Light. It themes the app for the rest of today.</span></div></div>
    <div class="mbody"><div class="subgrid">${D77.map(([k, n, line, c]) => `<button class="subpick${cur === k ? " on" : ""}" data-d77="${k}" style="--c0:${c[0]};--c1:${c[1]};--c2:${c[2]}"><span class="sw"><i></i><i></i><i></i></span><b>${n}</b><small>${line}</small></button>`).join("")}</div>
    <p class="secsub" style="margin:10px 0 0">Changed your mind? Tap the little buddy on the bottom bar to pick again.</p></div></article></div>`;
}
function pickD77(k) {
  state.d77 = { day: localDay(), pick: k }; save(); closeModal();
  decoFor = undefined; applyTheme(); renderDrawer();
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
function blinkBuddy() { buddyReact("blink"); }
/* The 7/7 buddy reacts: blink on a tick, a spin on Mastered, a hop on Building, a wiggle on a star */
function buddyReact(kind) {
  const b = document.querySelector(".buddy"); if (!b) return;
  const cls = "r-" + kind, ms = { blink: 180, spin: 900, hop: 700, wiggle: 600 }[kind] || 400;
  b.classList.remove(cls); void b.offsetWidth; b.classList.add(cls); setTimeout(() => b.classList.remove(cls), ms);
}
setInterval(() => { // roll over to the next day's theme if the app stays open past midnight
  if (decoKey(specialDay()) !== decoFor) { applyTheme(); renderDrawer(); }
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
  const payload = JSON.stringify({ v: 1, t: Object.keys(state.ticks), s: Object.keys(state.stars), m: Object.keys(state.mastered), a: Object.keys(state.alerts), h: state.hvMin ? 1 : 0, st: state.settings, x: state.secrets, b: state.banners, u: Object.keys(state.unlocked), w: state.weekly, rc: state.relicCounts, pc: state.partCounts, sa: state.scanAt, sf: state.scanFiles, ho: state.hvOwned ? 1 : 0, bd: state.building, bl: Object.keys(state.built), xm: state.xm });
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
  return normaliseState({ ticks: set(p.t), stars: set(p.s), mastered: set(p.m), alerts: set(p.a), hvMin: !!p.h, settings: p.st, secrets: p.x, banners: p.b, unlocked: set(p.u), weekly: p.w, relicCounts: p.rc, partCounts: p.pc, scanAt: p.sa, scanFiles: p.sf, hvOwned: !!p.ho, building: p.bd, built: set(p.bl), xm: p.xm });
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
const snapState = () => JSON.stringify({ t: state.ticks, m: state.mastered, b: state.building, bl: state.built, rc: state.relicCounts, pc: state.partCounts });
function offerUndo(msg, snap) {
  let bar = $("#undoBar");
  if (!bar) { bar = document.createElement("div"); bar.id = "undoBar"; bar.className = "undobar"; bar.setAttribute("role", "status"); document.body.appendChild(bar); }
  bar.innerHTML = `<span>${esc(msg)}</span><button class="linkbtn" id="undoBtn">Undo</button>`;
  bar.classList.add("show");
  clearTimeout(bar._t); bar._t = setTimeout(() => bar.classList.remove("show"), 5000);
  $("#undoBtn").onclick = () => {
    const o = JSON.parse(snap);
    Object.assign(state, { ticks: o.t, mastered: o.m, building: o.b, built: o.bl });
    if (o.rc) state.relicCounts = o.rc; if (o.pc) state.partCounts = o.pc;
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

/* The relics behind a fissure's "N relics" flag: farmable ones of that tier holding parts you
   need (for starred items when there are any, like the flag itself). Omnia takes every tier. */
function showTierRelics(tier) {
  const starItems = starred().filter(active), nm = needMap(starItems.length ? starItems : ITEMS.filter(active));
  const list = Object.keys(nm).filter(r => obtainable(r) && (tier === "Omnia" || tierOf(r) === tier)).sort(relicSort);
  $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card relcard"><div class="chead" style="cursor:default"><div class="ctop"><div class="name">${esc(tier)} relics</div></div>
    <div class="meta"><span class="tag">${list.length} to crack</span><span class="cnt">for your ${starItems.length ? "starred items" : "unmastered Primes"}</span></div></div>
    <div class="mbody">${list.map(r => `<div class="part"><b><button class="relbtn" data-relic="${esc(r)}">${esc(r)}</button>${ownRel(r)}</b>${nm[r].sort((a, b) => RAR_ORDER[b.rar] - RAR_ORDER[a.rar]).map(x =>
      `<div class="rrow"><span class="pn">${esc(x.full)}</span><span class="rar ${x.rar}">${RAR[x.rar]}</span></div>`).join("")}</div>`).join("") || `<p class="secsub">Nothing in this tier right now.</p>`}</div>
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
  ["The bottom bar", "<b>Home</b> sits in the middle with what matters right now. <b>Collection</b> holds everything that gives mastery, <b>Relics</b> has live fissures and what to crack, <b>Vendors</b> has Baro and the weekly rotations, and <b>Profile</b> has your Mastery Rank, inventory and settings."],
  ["Star, tick, tap", "Tap the star on anything in Collection to follow it on Home. Tap an item for its own page: tick parts as you get them, and see its relics and best farms."],
  ["Focus mode", "Starting a relic mission? Tap <b>Focus mode</b> on Home, type the squad's relics, then pick the reward you got. Endless runs log every round and give you a summary to check at the end."],
  ["Keep your progress safe", "Swipe in from the right edge for your daily and weekly checklist. Ticks are saved on this phone: use <b>Profile › Backup and codes</b> to move them to a new phone. To see this tour again, tap the <b>?</b> at the bottom of Settings."],
];
/* Update WHATS_NEW with each APK release: friends see it once after updating. */
const WHATS_NEW = {
  id: "2026-11-v1.1",
  items: [
    "Version 1.1: a new layout. The bottom bar has Profile, Collection, Home, Relics and Vendors, with Home in the middle.",
    "Home shows what matters right now: fissures your relics fit, Baro's countdown, your checklist, Mastery Rank and starred items.",
    "Focus mode: enter the squad's relics and pick the reward you got. Endless missions log every round, with a summary you can fix before saving.",
    "Collection is one list with All, Base and Prime, a Starred filter and category chips. Tap anything for its own page.",
    "Profile holds Mastery Rank, Inventory, Import data, Trade chat shortcuts and a Foundry page. Settings is just settings now.",
    "Relics shows every active fissure at once, and Vendors puts the Void Trader up top with his Ducat list.",
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
    <p class="secsub" style="margin:8px 0 0">You can turn this off under Settings › Accessibility.</p></div>
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
    save(); renderAll(); setTimeout(maybeNews, 250);
  };
}
function afterIntro() {
  if ($("#modal") || document.querySelector(".stalker-take")) return;
  if (!state.tourDone) { showTour(); return; }
  const sd = specialDay();
  if (sd && sd.id === "d77" && !sd.sub && !d77Asked) { showD77Picker(); modalOnClose = () => setTimeout(afterIntro, 300); return; }
  const c = dueClaims();
  if (c.length) showClaims(c); else maybeNews();
}

/* ---------- RENDER ALL ---------- */
let renderQueued = 0;
function renderAll() {
  refreshLiveSets();
  renderMain(); renderHome(); renderProfile(); renderRuns(); renderRotating(); renderUpdated(); renderMR(); renderTrade();
  if (subIs("missing", "foundry", "import")) renderSub();
}
function queueDerived() { // after a tick: refresh lists that depend on missing parts
  clearTimeout(renderQueued);
  renderQueued = setTimeout(() => { renderMain(); renderRuns(); renderTrade(); renderHome(); renderProfile(); mainSummary(); if (subIs("missing", "foundry")) renderSub(); }, 120);
}

/* ---------- EVENTS ---------- */
/* Pages and sub-pages share the same handlers: an item page works like any list */
function bindContent(root) {
  root.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "hvOwned") { state.hvOwned = t.checked; save(); renderRuns(); return; }
    if (t.id === "fxEndless" && state.focus && state.focus.m) { state.focus.m.endless = t.checked; fsave(); return; }
    if (t.name === "fxrw" && state.focus) { state.focus.pick = t.value; save(); return; }
    const dk = t.dataset.duc;
    if (dk != null) {
      state.ducKeep = state.ducKeep || {}; state.ducPick = state.ducPick || {};
      if (t.dataset.near) { if (t.checked) state.ducPick[dk] = 1; else delete state.ducPick[dk]; }
      else if (t.checked) delete state.ducKeep[dk]; else state.ducKeep[dk] = 1;
      save(); const tt = $("#ducTot"); if (tt) tt.innerHTML = ducatTotal(); return;
    }
    const mid = t.dataset.m;
    if (mid) { // a modular piece: its tick is Mastered
      const snap = snapState(), it = BYID[mid];
      if (t.checked) { state.mastered[mid] = 1; blinkBuddy(); } else delete state.mastered[mid];
      save(); refreshCards(mid); queueDerived();
      offerUndo(`${it ? it.n : "Item"} ${t.checked ? "marked mastered" : "unmarked"}`, snap); return;
    }
    const u = t.dataset.u; if (!u) return;
    const id = t.dataset.it, it = BYID[id], hadB = !!(state.building[id] || state.built[id]);
    if (t.checked) { state.ticks[u] = 1; blinkBuddy(); } else { delete state.ticks[u]; clearBuild(id); }
    save(); refreshCards(id); queueDerived();
    if (it && hadB && !t.checked && subIs("item")) setTimeout(renderSub, 350);
  });
  root.addEventListener("click", async e => {
    const t = e.target;
    if (focusClick(t)) return;
    const go = t.closest("[data-go]");
    if (go) { goPage(+go.dataset.go, true); return; }
    const act = t.closest("[data-act]");
    if (act) { doAct(act.dataset.act); return; }
    const sb = t.closest("[data-sub]");
    if (sb) { openSub(sb.dataset.sub); return; }
    const star = t.closest("[data-star]");
    if (star) {
      const id = star.dataset.star;
      if (state.stars[id]) delete state.stars[id]; else { state.stars[id] = 1; buddyReact("wiggle"); }
      save();
      document.querySelectorAll(`[data-star="${id}"]`).forEach(b => {
        const on = !!state.stars[id];
        b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
        if (b.closest(".crow")) b.innerHTML = starSvg(on); else b.textContent = on ? "★" : "☆";
      });
      refreshCards(id); renderHome(); renderRuns(); renderRotating(); renderTrade();
      if (S().starOnly) setTimeout(renderMain, 250);
      return;
    }
    const vw = t.closest("[data-vw]");
    if (vw) { openVault(vw.dataset.vw); return; }
    if (t.closest("[data-ducpanel]")) { ducPanel = !ducPanel; renderRotating(); return; }
    const dopt = t.closest("[data-ducopt]");
    if (dopt) { S()[dopt.dataset.ducopt] = !S()[dopt.dataset.ducopt]; save(); renderRotating(); return; }
    const da = t.closest("[data-ducall]");
    if (da) {
      state.ducKeep = {}; state.ducPick = {};
      ducatSpares().forEach(x => { if (da.dataset.ducall === "0") state.ducKeep[x.full] = 1; else if (x.near) state.ducPick[x.full] = 1; });
      save(); renderRotating(); return;
    }
    const fm = t.closest("[data-fmode]");
    if (fm) { S().fissMode = fm.dataset.fmode; save(); renderRuns(); return; }
    const ft = t.closest("[data-ftier]");
    if (ft) { showTierRelics(ft.dataset.ftier); return; }
    const rb = t.closest("[data-relic]");
    if (rb) { showRelic(rb.dataset.relic); return; }
    const jp = t.closest("[data-jump]");
    if (jp) { jumpTo(jp.dataset.jump); return; }
    const op = t.closest("[data-open]");
    if (op) { openSub("item", op.dataset.open); return; }
    const m = t.closest("[data-mastered]");
    if (m) {
      const id = m.dataset.mastered, snap = snapState(), it = BYID[id];
      const on = !state.mastered[id];
      if (!on) delete state.mastered[id]; else { state.mastered[id] = 1; clearBuild(id); buddyReact("spin"); }
      save(); renderAll(); if (subIs("item")) renderSub();
      offerUndo(`${it ? it.n : "Item"} ${on ? "marked mastered" : "unmarked"}`, snap);
      return;
    }
    const bb = t.closest("[data-build]");
    if (bb) {
      const it = BYID[bb.dataset.build]; if (!it) return;
      const snap = snapState();
      state.building[it.id] = { e: Date.now() + buildHours(it) * 3600e3, n: it.n }; buddyReact("hop");
      save(); renderAll(); if (subIs("item")) renderSub();
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
    if (tier) { runsTier = tier.dataset.tier; renderSub(); return; }
    const cp = t.closest("[data-copy]");
    if (cp) { const ok = await copyText(cp.dataset.copy); cp.textContent = ok ? "Copied" : "Blocked"; setTimeout(() => { cp.textContent = "Copy"; }, 1800); return; }
    settingsClick(e);
  });
  root.addEventListener("toggle", e => {
    const d = e.target; if (!d.matches || !d.matches("details[data-rot]")) return;
    S().rotOpen[d.dataset.rot] = d.open ? 1 : 0; save();
  }, true);
  root.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.fxslot != null) { focusSuggest(+t.dataset.fxslot, t.value); return; }
    if (t.id === "fxAdd") {
      const q = t.value.trim().toLowerCase();
      $("#fxParts").innerHTML = q.length < 2 ? "" : [...Object.keys(DUC()), "Forma Blueprint"].filter(n => n.toLowerCase().includes(q)).slice(0, 8).map(n => `<option value="${esc(n)}"></option>`).join("");
      return;
    }
    settingsInput(e);
  });
  root.addEventListener("keydown", e => {
    const t = e.target;
    if (t.dataset && t.dataset.fxslot != null && e.key === "Enter") { // Enter takes the first suggestion
      e.preventDefault(); const first = $("#fxsug" + t.dataset.fxslot + " [data-fxpick]"); t.blur(); if (first) first.click(); return;
    }
    if (t.id === "fxAdd" && e.key === "Enter") { e.preventDefault(); t.blur(); const b = document.querySelector('[data-fx="add"]'); if (b) b.click(); }
  });
}
function doAct(a) {
  if (a === "settings") { setDrawer(true); return; }
  if (a === "backup") { setDrawer(true); setTimeout(() => { const el = $("#codeSec"); if (el) el.scrollIntoView({ block: "start", behavior: S().reduceMotion ? "auto" : "smooth" }); }, 280); return; }
  if (a === "checklist") { setWeekly(true); return; }
  if (a === "inventory") { showInventory(); return; }
  if (a === "starred") { S().starOnly = true; mainCat = "all"; save(); renderMain(); goPage(PG.coll, true); $("#pg-coll").scrollTop = 0; }
}
/* Settings-like controls that live on the Mastery and Import data pages as well as in the menu */
async function settingsClick(e) {
  const t = e.target;
  const xa = t.closest("[data-xmall]");
  if (xa) { // quick-select: a whole chart cleared, or every Intrinsic tree at 10
    const k = xa.dataset.xmall; state.xm = state.xm || {};
    const fill = key => { state.xm[key] = key === "rj" || key === "dr" ? Object.fromEntries(XM.intr.find(x => x[0] === key)[2].map(t => [t, 10])) : { n: XM.NODES, j: XM.JUNCTIONS }; };
    fill(k); if (k === "sp") fill("sc"); // the Steel Path only unlocks once the Star Chart is done
    save(); renderSub(); renderProfile(); renderHome(); return;
  }
  if (t.id === "mrGo") { mrMatch(); return; }
  if (t.id === "mrClear") { delete state.xm.adj; save(); renderSub(); renderProfile(); renderHome(); return; }
  if (t.id === "scanCancel") { if (window.cancelScan) window.cancelScan(); }
}
function settingsInput(e) {
  if (e.target.dataset.xm) xmSet(e.target, false); // the estimate updates as you type
  if (e.target.id === "mrRank") e.target.dataset.touched = 1;
}
function bindEvents() {
  bindContent($("#pages")); bindContent($("#sub"));
  $("#sub").addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.xm) { xmSet(t, true); return; }
    if (t.dataset.scan && t.files && t.files[0]) { const f = t.files[0]; t.value = ""; if (window.runScan) window.runScan(t.dataset.scan, f); }
  });
  $("#subBack").addEventListener("click", closeSub);
  $("#bnav").addEventListener("click", e => { const b = e.target.closest("[data-page]"); if (b) goPage(+b.dataset.page, true); });
  $("#scrim").addEventListener("click", () => { setDrawer(false); setWeekly(false); });
  $("#modalRoot").addEventListener("click", e => {
    const sp = e.target.closest("[data-d77]"); if (sp) { pickD77(sp.dataset.d77); return; }
    if (e.target.id === "modal" || e.target.closest("[data-close]")) { closeModal(); return; }
    const rb = e.target.closest("[data-relic]"); if (rb && !e.target.closest(".relcard .ctop")) { showRelic(rb.dataset.relic); return; }
    const op = e.target.closest("[data-open]"); if (op) { closeModal(); openSub("item", op.dataset.open); }
  });

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
        if (got.type === "devkit") setTimeout(() => { devRefresh(); const d = $("#devSec"); if (d) d.scrollIntoView({ block: "start", behavior: "smooth" }); }, 700);
        applyTheme();
      } else { msg.className = "codemsg bad"; msg.textContent = "This code is invalid."; }
      return;
    }
    if (e.target.id === "tourBtn") { setDrawer(false); setTimeout(showTour, 250); return; }
    if (e.target.id === "clearBtn") { setDrawer(false); setTimeout(showClear, 250); return; }
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
  });
  dr.addEventListener("input", e => {
    if (e.target.id !== "tsize") return;
    S().textSize = +e.target.value; $("#tsizeOut").textContent = e.target.value + "%"; save(); applyDisplay();
  });
  bindSoundPicker(dr); bindDevTools(dr);
  dr.addEventListener("keydown", e => { if (e.target.id === "codeIn" && e.key === "Enter") $("#codeBtn").click(); });
}
function renderOpenCards() { expanded.forEach(id => refreshCards(id)); }

/* ---------- PAGES (bottom bar) ---------- */
/* A floating up-arrow once you've scrolled a long way down a page */
function bindUpArrow() {
  const b = document.createElement("button");
  b.id = "upBtn"; b.className = "upbtn"; b.setAttribute("aria-label", "Back to top"); b.innerHTML = "↑";
  document.body.appendChild(b);
  const cur = () => SUB ? $("#subBody") : document.querySelectorAll(".page")[page];
  const check = () => { const p = cur(); b.classList.toggle("show", !!p && p.scrollTop > 900 && !drawerOpen && !weeklyOpen); };
  document.querySelectorAll(".page, #subBody").forEach(p => p.addEventListener("scroll", check, { passive: true }));
  b.addEventListener("click", () => { const p = cur(); if (p) p.scrollTo({ top: 0, behavior: S().reduceMotion ? "auto" : "smooth" }); });
  window.__upCheck = check;
}
let page = PG.home; // replaced by the start page setting at launch
function goPage(i, smooth) {
  closeSub();
  const p = $("#pages");
  if (i === page && smooth) { const pg = document.querySelectorAll(".page")[i]; if (pg) pg.scrollTo({ top: 0, behavior: S().reduceMotion ? "auto" : "smooth" }); } // tapping the tab you're on goes back to the top
  p.scrollTo({ left: i * p.clientWidth, behavior: "auto" });
  setTab(i);
}
function setTab(i) {
  page = i; if (window.__upCheck) window.__upCheck();
  document.querySelectorAll("#bnav [data-page]").forEach(b => { const on = +b.dataset.page === i; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
  checkBaro();
}
function bindPages() {
  const p = $("#pages");
  window.addEventListener("resize", () => { p.scrollLeft = page * p.clientWidth; });
}

/* ---------- PULL TO REFRESH (Home, Relics and Vendors) ---------- */
function bindPullRefresh() {
  ["#pg-vendors", "#pg-relics", "#pg-home"].forEach(sel => {
    const pg = $(sel);
    const tip = document.createElement("div");
    tip.className = "ptr"; tip.setAttribute("aria-hidden", "true");
    pg.prepend(tip);
    let y0 = null, x0 = 0, pull = 0, busy = false;
    pg.addEventListener("touchstart", e => {
      if (busy || pg.scrollTop > 0 || drawerOpen || weeklyOpen || (sel === "#pg-home" && state.focus)) { y0 = null; return; }
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
  if (open) renderMR();
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
  return left;
}
function bindWeekly() {
  const wk = $("#weekly");
  wk.addEventListener("change", e => {
    const k = e.target.dataset.w; if (!k) return;
    const sec = k.split(":")[0];
    if (e.target.checked) { state.weekly.t[k] = periodKey(sec); blinkBuddy(); } else delete state.weekly.t[k];
    save(); renderWeekly(); renderHome();
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
  if (SUB) { closeSub(); return true; }
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
  let list = Object.entries(owned).map(([full, n]) => {
    const h = home.get(full); if (!h || !h.d || !state.mastered[h.it.id]) return null;
    const spare = n - (reserve.get(full) || 0);
    return spare > 0 ? { full, n: spare, d: h.d, tot: spare * h.d, it: h.it } : null;
  }).filter(Boolean);
  // How close each mastered Prime's spares come to a whole set
  const by = new Map(list.map(x => [x.full, x]));
  const short = it => (it.parts || []).filter(p => (by.get(p.full) || { n: 0 }).n < (p.c || 1));
  const setOf = new Map();
  list.forEach(x => { if (!setOf.has(x.it)) setOf.set(x.it, short(x.it)); });
  // "Hide complete sets": when the spares make a whole set, leave them for selling as a set
  if (S().ducHideSets) list = list.filter(x => setOf.get(x.it).length > 0);
  // "Nearly complete": one more part would make a whole set to sell, so hold those back
  if (S().ducNear) list.forEach(x => { const m = setOf.get(x.it); if (m.length === 1 && (x.it.parts || []).length > 1) x.near = m[0].p; });
  return list.sort(S().ducAZ ? (a, b) => a.full.localeCompare(b.full) : (a, b) => b.tot - a.tot || a.full.localeCompare(b.full));
}
// A row is ticked unless you unticked it; a flagged near-set row starts unticked unless you ticked it
const ducOn = x => x.near ? !!(state.ducPick || {})[x.full] : !(state.ducKeep || {})[x.full];
let ducPanel = false;
function ducatHTML() {
  const list = ducatSpares();
  let h = `<div class="ducats"><h4>Spare parts for Ducats</h4><p class="secsub">Parts from your last scan that belong to Primes you've mastered, minus any still needed for others. Untick anything you want to keep; trade the rest at a Relay's Ducat kiosk.</p>`;
  if (!Object.keys(state.partCounts || {}).length) return h + `<p class="empty">Import a Parts recording under Profile › Import data to see what you can trade in.</p></div>`;
  const opts = [["ducAZ", "A–Z"], ["ducHideSets", "Hide complete sets"], ["ducNear", "Nearly complete"]];
  const on = opts.filter(([k]) => S()[k]).length;
  h += `<div class="controls ducctl"><button class="chip ghost" data-ducall="1">Select all</button><button class="chip ghost" data-ducall="0">Select none</button>
    <button class="iconbtn ducfilt" data-ducpanel aria-label="Sort and filters${on ? ` (${on} on)` : ""}" aria-expanded="${ducPanel}">${FILTER_SVG}${on ? `<span class="fdot" aria-hidden="true"></span>` : ""}</button></div>
    <div class="fpanel${ducPanel ? "" : " hidden"}"><div class="controls">${opts.map(([k, l]) => `<button class="chip ghost" data-ducopt="${k}" aria-pressed="${!!S()[k]}">${l}</button>`).join("")}</div>
    ${S().ducNear ? `<p class="dnote">Flagged parts are one part away from a whole set you could sell instead. They start unticked.</p>` : ""}</div>`;
  if (!list.length) return h + `<p class="empty">${S().ducHideSets ? "Nothing spare outside complete sets." : "Nothing spare in your last scan from a Prime you've mastered."}</p></div>`;
  h += `<div class="rlist">` + list.map(x => `<label class="rrow ducrow${x.near ? " near" : ""}"><input type="checkbox" data-duc="${esc(x.full)}"${x.near ? ` data-near="1"` : ""}${ducOn(x) ? " checked" : ""}>
    <span class="pn">${esc(x.full)}${x.n > 1 ? ` <span class="sub" style="margin:0">x${x.n}</span>` : ""}${x.near ? `<span class="neartag">1 part from a full set · needs ${esc(x.near)}</span>` : ""}</span>
    <span class="pr">${x.n > 1 ? `${x.d} each · ` : ""}<b>${x.tot}</b></span></label>`).join("");
  return h + `</div><div class="ductot" id="ducTot">${ducatTotal(list)}</div></div>`;
}
function ducatTotal(list = ducatSpares()) {
  const sel = list.filter(ducOn);
  const parts = sel.reduce((a, x) => a + x.n, 0), d = sel.reduce((a, x) => a + x.tot, 0);
  return `Selected: <b>${parts}</b> part${parts === 1 ? "" : "s"} · <b class="gold">${d.toLocaleString()}</b> Ducats`;
}

/* Live worldstate: api.warframestat.us, falling back to DE's raw worldState.php */
/* Is Baro at a relay right now? Go by his arrival and leaving times, not the feed's "active"
   flag, which can lag behind or be missing when the data comes from the cache. */
function baroHere(b, now = Date.now()) {
  if (!b) return false;
  if (b.activation && b.expiry) return b.activation <= now && now < b.expiry;
  return !!b.active && (!b.expiry || b.expiry > now);
}
const ms = v => { if (v == null) return 0; if (typeof v === "number") return v; if (v.$date) return +(v.$date.$numberLong || v.$date); const t = Date.parse(v); return isNaN(t) ? 0 : t; };
async function liveFromStat() {
  const q = "?language=en";
  const rs = await Promise.allSettled(["voidTrader", "dailyDeals", "steelPath", "fissures", "vaultTrader", "duviriCycle"].map(k => getJSONAny(`${WS}/${k}${q}`)));
  if (rs.every(r => r.status === "rejected")) throw new Error("warframestat unreachable");
  const v = i => rs[i].status === "fulfilled" ? rs[i].value : null;
  const vt0 = v(0), dd = v(1), sp = v(2), fi = v(3), vz = v(4), dc = v(5), t0 = Date.now();
  const vt = Array.isArray(vt0) ? vt0.find(t => ms(t.activation) <= t0 && t0 < ms(t.expiry)) || vt0[0] : vt0; // some feed versions list traders
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
let liveBusy = false, baroTimer = 0;
async function loadLive() {
  if (liveBusy) return; liveBusy = true;
  let live = null;
  try { live = await liveFromStat(); } catch (e) { try { live = await liveFromRaw(); } catch (e2) { live = null; } }
  // warframestat can lag behind Baro's arrival (still showing last visit, or no inventory yet):
  // then take Baro from DE's own worldstate
  const now = Date.now(), b = live && live.baro;
  if (live && (!b || !(baroHere(b, now) && (b.inventory || []).length)) && (!b || !b.activation || b.activation <= now || b.expiry <= now)) {
    try { const raw = await liveFromRaw(); if (raw.baro && (baroHere(raw.baro, now) || !b)) live.baro = raw.baro; } catch (e) {}
  }
  liveBusy = false;
  // refresh again just after Baro arrives, if the app is open then
  clearTimeout(baroTimer);
  const nb = (live || LIVE || {}).baro;
  if (nb && nb.activation > now && nb.activation - now < 2 ** 31 - 1) baroTimer = setTimeout(loadLive, nb.activation - now + 90e3);
  if (live) {
    LIVE = live; LIVE_AT = Date.now(); LIVE_OFFLINE = false;
    try { localStorage.setItem(KEY_LIVE, JSON.stringify({ at: LIVE_AT, l: LIVE })); } catch (e) {}
  } else LIVE_OFFLINE = !!LIVE;
  refreshLiveSets(); renderRotating(); renderRuns(); renderHome(); renderUpdated(); renderOpenCards(); checkBaro();
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
  document.querySelectorAll("[data-short]").forEach(s => { const t = +s.dataset.short; s.textContent = t > now ? shortLeft(t) : "now"; });
}, 1000);
setInterval(renderUpdated, 30000);
// keep the live feed current while the app is open, and when it comes back to the front
setInterval(() => { if (!document.hidden) loadLive(); }, 10 * 60e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - LIVE_AT > 5 * 60e3) loadLive(); });

/* ---------- INTRO ---------- */
function runIntro() {
  const el = $("#intro");
  const reduce = S().reduceMotion || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const done = () => { if (el.classList.contains("done")) return; el.classList.add("done"); setTimeout(() => { el.remove(); afterIntro(); }, 500); };
  const later = () => { if (Date.now() < (window.__introHold || 0)) setTimeout(later, 200); else done(); };
  const sd = specialDay(); if (sd && sd.id === "d77" && !reduce) el.classList.add("d77"); // a burst of Light on the launch logo
  setTimeout(later, reduce ? 400 : 1900);
}

/* ---------- BOTTOM BAR HEIGHT ---------- */
function trackNav() {
  const nav = $("#bnav");
  const set = () => document.documentElement.style.setProperty("--navh", nav.offsetHeight + "px");
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(nav); else window.addEventListener("resize", set);
}

/* ---------- START ---------- */
applyDisplay();
applyTheme();
trackNav();
runIntro();
buildMain(); renderDrawer();
bindEvents(); bindPages(); bindDrawerGesture(); bindWeekly(); bindPullRefresh(); bindUpArrow(); startHidden();
page = +S().startPage; if (!(page >= 0 && page <= 4)) page = PG.home;
requestAnimationFrame(() => goPage(page, false));
loadCachedLive();
loadData().then(loadLive);
setInterval(loadLive, LIVE_REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - LIVE_AT > 60000) loadLive(); });
