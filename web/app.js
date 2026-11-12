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
];
const SHOW_SWITCHES = [
  ["mods", "Unique mods"],
  ["chances", "Drop chances"],
  ["vaulted", "Vaulted relic lists"],
  ["resurgence", "Prime Resurgence notes"],
  ["variants", "Variant info"],
];
const CATS = [
  ["all", "All Primes"], ["weapons", "Weapons"], ["warframes", "Warframes"], ["archwing", "Archwing"],
  ["archgun", "Arch-gun"], ["archmelee", "Arch-melee"], ["companions", "Companions"], ["other", "Other"],
];
const CAT_LABEL = Object.fromEntries(CATS);
const SLOT_ORDER = ["Primary", "Secondary", "Melee"];
const TIER_ORDER = { Lith: 0, Meso: 1, Neo: 2, Axi: 3, Requiem: 4, Omnia: 5 };
const RAR = { C: "Common", U: "Uncommon", R: "Rare" };
const RAR_ORDER = { R: 0, U: 1, C: 2 };
const RAR_CHANCE = { C: "25.3% → 16.7%", U: "11% → 20%", R: "2% → 10%" };
const DEFAULT_SETTINGS = { theme: "orokin-dark", farm: "both", mainSort: "type", collapsed: {}, show: { mods: true, chances: true, vaulted: true, resurgence: true, variants: true } };
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
    hvMin: !!s.hvMin,
    settings: { ...DEFAULT_SETTINGS, ...st, collapsed: { ...(st.collapsed || {}) }, show: { ...DEFAULT_SETTINGS.show, ...(st.show || {}) } },
  };
}
let state = loadState();
const S = () => state.settings;
function save() { try { localStorage.setItem(KEY_STATE, JSON.stringify(state)); } catch (e) {} }

/* ---------- DATA ---------- */
let DATA = { items: [], relics: {} }, DATA_AT = 0, DATA_SRC = "none", DATA_OFFLINE = false;
let ITEMS = [], BYNAME = {}, BYID = {};
function setData(d, at, src) {
  DATA = d; DATA_AT = at || 0; DATA_SRC = src;
  ITEMS = (d.items || []).slice().sort((a, b) => a.n.localeCompare(b.n));
  BYNAME = {}; BYID = {};
  ITEMS.forEach(it => { delete it._units; BYNAME[it.n] = it; BYID[it.id] = it; });
}
const relicInfo = r => (DATA.relics || {})[r] || {};

let LIVE = null, LIVE_AT = 0, LIVE_OFFLINE = false;

/* ---------- CHECKBOX UNITS ----------
   Each checkbox is one "unit". An item's own parts come first, then one group per
   required weapon (e.g. "Vasto Prime #1"), each with that weapon's own parts. */
function unitsOf(it) {
  if (it._units) return it._units;
  const out = [];
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
    <div class="meta"><span class="tag">${esc(it.slot || CAT_LABEL[it.cat] || "Prime")}</span><span class="cnt">${cntText(it)}</span></div>
    <div class="cbar"><i style="width:${isM ? 100 : n ? 100 * g / n : 0}%"></i></div></div><ul>`;
  let open = null;
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
  h += `</ul>`;
  if (it.note) h += `<div class="note">${esc(it.note)}</div>`;
  if (it.get) h += `<div class="note"><b>How to get:</b> ${esc(it.get)}</div>`;
  h += `<div class="more${expanded.has(it.id) ? "" : " hidden"}">${expanded.has(it.id) ? moreHTML(it) : ""}</div>`;
  h += `<div class="cfoot"><button class="builtbtn" data-mastered="${it.id}">${isM ? "Mastered ✓" : "Mastered"}</button><button class="expbtn" data-exp="${it.id}">${expanded.has(it.id) ? "Hide info ▴" : "Relics & info ▾"}</button></div></article>`;
  return h;
}
function cntText(it) {
  const { n, g } = progress(it);
  if (state.mastered[it.id]) return "Mastered ✓";
  if (n && g === n) return "Ready to build ✓";
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
  document.querySelectorAll(`.card[data-item="${itemId}"]`).forEach(card => {
    const { n, g } = progress(it), isM = !!state.mastered[it.id];
    card.classList.toggle("complete", g === n && n > 0 && !isM);
    card.classList.toggle("built", isM);
    card.querySelector(".cnt").textContent = cntText(it);
    card.querySelector(".cbar i").style.width = (isM ? 100 : n ? 100 * g / n : 0) + "%";
    card.querySelectorAll("input[data-u]").forEach(i => { i.checked = !!state.ticks[i.dataset.u]; });
    groupCounts(card, it);
    if (expanded.has(it.id)) card.querySelector(".more").innerHTML = moreHTML(it);
    const old = card.querySelector(".vw"), nu = vwHTML(it);
    if (old) old.remove();
    if (nu) card.querySelector(".star").insertAdjacentHTML("beforebegin", nu);
  });
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
  return `<div class="relrow"><span class="rn">${esc(r)}</span><span class="rar ${rar}">${RAR[rar] || rar}</span>${ch}${tag}${kind ? "" : farmHTML(r)}</div>`;
}
function moreHTML(it) {
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

/* ---------- PAGE: MAIN ---------- */
let mainCat = "all", mainQuery = "", showMastered = false, hideDone = false;
function buildMain() {
  $("#main").innerHTML = `<header><h1><select class="titlesel" id="catSel" aria-label="Category">${CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></h1>
    <p>Every Prime set. Tap a star to add it to Favorites, tap an item for its relics and farms.</p></header>
    <section class="summary"><div class="sumrow"><span>Parts collected</span><b id="mainSum">0 / 0</b></div>
      <div class="sumsub" id="mainSub"></div><div class="bar"><i id="mainBar"></i></div>
      <input class="search" id="search" type="search" placeholder="Search Primes or parts" autocomplete="off">
      <div class="controls" id="sortCtl"><span class="ctlk">Sort</span><button class="chip" data-sort="type">By type</button><button class="chip" data-sort="az">A–Z</button></div>
      <div class="controls"><button class="chip ghost" id="showM" aria-pressed="false">Show mastered</button>
      <button class="chip ghost" id="hideD" aria-pressed="false">Hide complete</button><span class="toast" data-toast></span></div></section>
    <div id="mainList"></div>
    <footer>Relic data from the <a href="https://wiki.warframe.com/w/Void_Relic" target="_blank">WARFRAME Wiki</a>, DE's official drop tables and WFCD community data. Orokin Cells and credits aren't listed. To master an item you still have to level it to rank 30 after you build it.</footer>`;
  $("#catSel").addEventListener("change", e => { mainCat = e.target.value; renderMain(); $("#pg-main").scrollTop = 0; });
  $("#sortCtl").addEventListener("click", e => {
    const b = e.target.closest("[data-sort]"); if (!b) return;
    S().mainSort = b.dataset.sort; save(); renderMain();
  });
  // weapon slot dropdowns remember whether they're open
  $("#mainList").addEventListener("toggle", e => {
    const d = e.target; if (!d.matches || !d.matches("details.secgrp") || mainQuery) return;
    if (d.open) delete S().collapsed[d.dataset.slot]; else S().collapsed[d.dataset.slot] = 1;
    save();
  }, true);
  $("#search").addEventListener("input", e => { mainQuery = e.target.value.trim().toLowerCase(); renderMain(); });
  $("#showM").addEventListener("click", e => { showMastered = !showMastered; e.currentTarget.setAttribute("aria-pressed", showMastered); renderMain(); });
  $("#hideD").addEventListener("click", e => { hideDone = !hideDone; e.currentTarget.setAttribute("aria-pressed", hideDone); renderMain(); });
}
function mainItems() {
  const q = mainQuery;
  return ITEMS.filter(it => {
    if (mainCat !== "all" && it.cat !== mainCat) return false;
    if (state.mastered[it.id] && !showMastered) return false;
    if (hideDone) { const { n, g } = progress(it); if (n && g === n) return false; }
    if (q && !it.n.toLowerCase().includes(q) && !unitsOf(it).some(u => (u.full || "").toLowerCase().includes(q))) return false;
    return true;
  });
}
function sectionsFor(items) {
  const secs = new Map();
  const key = it => {
    if (mainCat === "all" && S().mainSort === "az") return null;
    if (mainCat === "all") return it.cat === "weapons" ? `Weapons · ${it.slot || "Other"}` : CAT_LABEL[it.cat] || "Other";
    if (it.cat === "weapons") return it.slot || "Other";
    return null;
  };
  items.forEach(it => { const k = key(it); if (!secs.has(k)) secs.set(k, []); secs.get(k).push(it); });
  const order = k => {
    if (k == null) return 0;
    const base = k.startsWith("Weapons · ") ? 0 : CATS.findIndex(c => c[1] === k) * 10;
    const slot = k.replace("Weapons · ", "");
    const si = SLOT_ORDER.indexOf(slot);
    return base + (si < 0 ? (k.startsWith("Weapons") || mainCat === "weapons" ? 5 : 0) : si);
  };
  return [...secs.entries()].sort((a, b) => order(a[0]) - order(b[0]) || String(a[0]).localeCompare(String(b[0])));
}
function renderMain() {
  const items = mainItems();
  let h = "";
  if (!ITEMS.length) h = `<p class="empty">Loading the Prime list…</p>`;
  else if (!items.length) h = `<p class="empty">${mainQuery ? "Nothing matches that search." : "Nothing left here. Everything's mastered!"}</p>`;
  else sectionsFor(items).forEach(([k, list]) => {
    const grid = `<div class="grid">${list.map(cardHTML).join("")}</div>`;
    if (k && mainCat === "weapons") {
      const open = mainQuery || !S().collapsed[k];
      h += `<details class="secgrp" data-slot="${esc(k)}"${open ? " open" : ""}><summary><h2 class="sec">${esc(k)}</h2><span class="seccnt">${list.length}</span></summary>${grid}</details>`;
    } else {
      if (k) h += `<h2 class="sec">${esc(k)}</h2>`;
      h += grid;
    }
  });
  const sc = $("#sortCtl");
  sc.classList.toggle("hidden", mainCat !== "all");
  sc.querySelectorAll("[data-sort]").forEach(b => b.setAttribute("aria-pressed", b.dataset.sort === S().mainSort));
  $("#mainList").innerHTML = h;
  $("#mainList").querySelectorAll(".card").forEach(c => groupCounts(c, BYID[c.dataset.item]));
  mainSummary();
}
function mainSummary() {
  if (!$("#mainSum")) return;
  const pool = ITEMS.filter(it => mainCat === "all" || it.cat === mainCat);
  let tot = 0, got = 0, ready = 0, mast = 0;
  pool.forEach(it => {
    if (state.mastered[it.id]) { mast++; return; }
    const { n, g } = progress(it); tot += n; got += g; if (n && g === n) ready++;
  });
  $("#mainSum").textContent = `${got} / ${tot}`;
  $("#mainBar").style.width = (tot ? 100 * got / tot : 0) + "%";
  $("#mainSub").textContent = `${pool.length - mast} item${pool.length - mast === 1 ? "" : "s"} · ${ready} ready to build${mast ? ` · ${mast} mastered${showMastered ? "" : " (hidden)"}` : ""}`;
}

/* ---------- PAGE: FAVORITES ---------- */
function buildFavs() {
  $("#favs").innerHTML = `<header><h1>Favorites</h1><p>Every item you've starred. Tap one for its relics and farms.</p></header>
    <section class="summary"><div class="sumrow"><span>Starred parts collected</span><b id="favSum">0 / 0</b></div>
      <div class="sumsub" id="favSub"></div><div class="bar"><i id="favBar"></i></div></section>
    <div id="favList"></div>
    <h2 class="sec">Trade chat helper</h2>
    <p class="secsub">"Want to buy" messages for the parts you're missing on starred items. Each one stays under ${TRADE_LIMIT} characters.</p>
    <div id="trade"></div>
    <footer>Tap Copy, then paste into trade chat. Duplicates show as x2.</footer>`;
}
function renderFavs() {
  const items = starred();
  $("#favList").innerHTML = items.length ? `<div class="grid">${items.map(cardHTML).join("")}</div>`
    : `<p class="empty">No favorites yet. Tap the ☆ on any item on the Main page.</p>`;
  $("#favList").querySelectorAll(".card").forEach(c => groupCounts(c, BYID[c.dataset.item]));
  favSummary(); renderTrade();
}
function favSummary() {
  const items = starred();
  let tot = 0, got = 0, ready = 0;
  items.filter(active).forEach(it => { const { n, g } = progress(it); tot += n; got += g; if (n && g === n) ready++; });
  $("#favSum").textContent = `${got} / ${tot}`;
  $("#favBar").style.width = (tot ? 100 * got / tot : 0) + "%";
  $("#favSub").textContent = `${items.length} starred · ${ready} ready to build`;
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
  $("#trade").innerHTML = msgs.length ? `<div class="tlist">${msgs.map((t, i) => `<div class="tmsg"><span class="num">${i + 1}</span>
      <code>${esc(t)}<span class="len">${t.length} characters</span></code><button class="chip" data-copy="${esc(t)}">Copy</button></div>`).join("")}</div>`
    : `<p class="empty">${starred().length ? "Nothing missing on your starred items." : "Star some items and their missing parts show up here."}</p>`;
}

/* ---------- PAGE: RELIC RUNS ---------- */
let runsTier = "all";
function buildRuns() {
  $("#runs").innerHTML = `<header><h1>Relic Runs</h1><p>Check this during a relic mission. Tick a part anywhere and it drops off this page.</p></header>
    <div id="runsBody"></div>
    <footer>Drop chance per refinement: Common 25.33% Intact → 16.67% Radiant · Uncommon 11% → 20% · Rare 2% → 10%. Vaulted relics can be traded with other players, or bought from Varzia when they're in Prime Resurgence.</footer>`;
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
  const hv = hvAll.filter(([r]) => tierOk(r)).sort((a, b) =>
    new Set(b[1].map(x => x.it)).size - new Set(a[1].map(x => x.it)).size || obtainable(b[0]) - obtainable(a[0]) || relicSort(a[0], b[0]));
  let h = `<div class="hvpanel${state.hvMin ? " min" : ""}" id="hvPanel"><div class="hvhead" id="hvHead"><h2 class="sec">High value${state.hvMin ? ` · ${hvAll.length}` : ""}</h2>
    <button class="minbtn" id="hvMin" aria-label="${state.hvMin ? "Expand" : "Minimize"}">${state.hvMin ? "+" : "–"}</button></div><div class="hvbody">
    <p class="secsub">Relics that hold parts for two or more different starred items.</p>`;
  h += hv.length ? `<div class="grid hv">` + hv.map(([r, l]) => {
    const n = new Set(l.map(x => x.it)).size;
    return `<article class="card"><div class="chead" style="cursor:default"><div class="name">${esc(r)}</div>
      <div class="meta"><span class="tag">${n} starred items</span><span class="st ${stCls(r)}">${statusLabel(r)}</span></div></div>
      <div class="rlist">${l.sort((a, b) => RAR_ORDER[a.rar] - RAR_ORDER[b.rar]).map(p => `<div class="rrow"><span class="pn">${esc(p.full)}</span><span class="rar ${p.rar}">${RAR[p.rar]}</span></div>`).join("")}</div></article>`;
  }).join("") + `</div>` : `<p class="empty">${starItems.length < 2 ? "Star at least two items to find relics that cover more than one." : "No relic holds parts for more than one of your starred items."}</p>`;
  h += `</div></div>`;

  // Fissures
  const needItems = starItems.length ? starItems : ITEMS.filter(active);
  const nrm = needMap(needItems);
  const needTiers = {};
  Object.keys(nrm).forEach(r => { if (obtainable(r)) needTiers[tierOf(r)] = (needTiers[tierOf(r)] || 0) + 1; });
  h += `<h2 class="sec">Void Fissures</h2><p class="secsub">Running now. Gold rows match a tier you have farmable relics to crack${starItems.length ? " for your starred items" : ""}.</p>`;
  const now = Date.now();
  const fiss = (LIVE && LIVE.fissures || []).filter(f => f.expiry > now)
    .sort((a, b) => (a.storm - b.storm) || (a.hard - b.hard) || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.expiry - b.expiry);
  if (!LIVE) h += `<p class="empty">Live fissures will show once the app can reach the worldstate.</p>`;
  else if (!fiss.length) h += `<p class="empty">No fissures in the feed right now.</p>`;
  else h += `<div class="fiss">${fiss.map(f => {
    const match = f.tier === "Omnia" ? Object.keys(needTiers).length > 0 : !!needTiers[f.tier];
    const cnt = f.tier === "Omnia" ? Object.values(needTiers).reduce((a, b) => a + b, 0) : needTiers[f.tier] || 0;
    return `<div class="frow${match ? " match" : ""}"><span class="ti">${esc(f.tier)}</span><span class="mi">${esc(f.type)}${f.hard ? `<span class="flag sp">Steel Path</span>` : ""}${f.storm ? `<span class="flag">Void Storm</span>` : ""}${match ? `<span class="flag need">${cnt} relic${cnt === 1 ? "" : "s"}</span>` : ""}<small>${esc(f.node)}</small></span><span class="tl">${until(f.expiry)}</span></div>`;
  }).join("")}</div>`;

  // Everything missing
  h += `<h2 class="sec">Every missing part</h2><p class="secsub">All relics for every part you still need, across every item you haven't mastered. Gold outline = also in High value. Teal outline = you can get it right now.</p>
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
        rs.map(([r, rar]) => `<span class="rchip ${rar}${hvSet.has(r) ? " hot" : ""}${obtainable(r) ? " av" : ""}">${esc(r)}<i>${rar}</i></span>`).join("") + `</div></div>`;
    });
    cards.push((state.stars[it.id] ? "0" : "1") + it.n + "\u0000" + c + `</article>`);
  });
  cards.sort();
  h += cards.length ? `<div class="grid">${cards.map(s => s.split("\u0000")[1]).join("")}</div>` : `<p class="empty">Nothing missing in this tier.</p>`;
  $("#runsBody").innerHTML = h;
  $("#runSum").textContent = Object.keys(allRm).length;
  $("#runSub").textContent = `${new Set(Object.values(allRm).flat().map(x => x.full)).size} different parts missing across ${ITEMS.filter(active).length} items · ${hvSet.size} high-value relic${hvSet.size === 1 ? "" : "s"}`;
  $("#hvHead").addEventListener("click", () => { state.hvMin = !state.hvMin; save(); renderRuns(); });
}

/* ---------- PAGE: ROTATING ---------- */
function vendorCard(title, tag, statusHTML, body) {
  return `<article class="card vend"><div class="chead"><div class="name">${title}</div><div class="meta"><span class="tag">${tag}</span><span>${statusHTML}</span></div></div>${body}</article>`;
}
function renderRotating() {
  const now = Date.now(), L = LIVE;
  let h = `<header><h1>Rotating</h1><p>Vendors with stock that changes. Times count down live.</p></header>`;
  if (!L) { $("#rotating").innerHTML = h + `<p class="empty">Live vendor info shows here once the app can reach the worldstate.</p>`; return; }
  const needRel = new Set(Object.keys(needMap(starred().filter(active))));
  const row = (n, pr) => `<div class="rrow"><span class="pn">${esc(n)}${needRel.has((RELIC_RE.exec(n) || []).slice(1).join(" ")) ? ` <span class="flag need">starred</span>` : ""}</span>${pr ? `<span class="pr">${pr}</span>` : ""}</div>`;
  let cards = "";
  const b = L.baro;
  if (b) {
    const here = b.active && b.expiry > now;
    const status = here ? `Leaves in ${until(b.expiry)}` : b.activation > now ? `Arrives in ${until(b.activation)}` : "Timing unknown";
    const inv = here && b.inventory && b.inventory.length
      ? `<div class="rlist">${b.inventory.map(x => row(x.n, [x.ducats ? `${x.ducats} ducats` : "", x.credits ? `${Number(x.credits).toLocaleString()} cr` : ""].filter(Boolean).join(" · "))).join("")}</div>`
      : `<div class="rlist"><span class="secsub" style="margin:0">${here ? "No inventory in the feed yet." : "His inventory shows up when he arrives."}</span></div>`;
    cards += vendorCard("Baro Ki'Teer", "Void Trader", status, `<div class="vline">${here ? "At" : "Next at"} <b>${esc(b.location || "a relay")}</b></div>${inv}`);
  }
  (L.darvo || []).filter(d => !d.expiry || d.expiry > now).forEach(d => {
    const off = d.orig ? Math.round(100 - 100 * d.sale / d.orig) : 0;
    cards += vendorCard("Darvo", "Daily deal", d.expiry ? `Ends in ${until(d.expiry)}` : "",
      `<div class="vline"><div class="big">${esc(d.n)}</div></div><div class="rlist"><div class="rrow"><span class="pn">${d.sale} platinum${d.orig ? ` <span class="sub" style="margin:0">(was ${d.orig}, ${off}% off)</span>` : ""}</span></div>${d.total ? `<div class="rrow"><span class="pn">${Math.max(0, d.total - (d.sold || 0))} of ${d.total} left</span></div>` : ""}</div>`);
  });
  if (L.teshin) {
    const t = L.teshin;
    cards += vendorCard("Teshin", "Steel Path honors", t.expiry ? `Changes in ${until(t.expiry)}` : "",
      `<div class="vline"><div class="big">${esc(t.n || "Unknown")}</div></div><div class="rlist">${t.cost ? `<div class="rrow"><span class="pn">${t.cost} Steel Essence</span></div>` : ""}<span class="secsub" style="margin:0">The weekly rotating item in his Steel Path Honors shop.</span></div>`);
  }
  const v = L.varzia;
  if (v && v.inventory && v.inventory.length) {
    const rel = v.inventory.filter(x => RELIC_RE.test(x.n)), other = v.inventory.filter(x => !RELIC_RE.test(x.n));
    cards += vendorCard("Varzia", "Prime Resurgence", v.expiry ? `Rotates in ${until(v.expiry)}` : "",
      `<div class="rlist">${other.map(x => row(x.n)).join("")}${rel.length ? `<div class="group" style="padding:6px 0 0">Relics</div>` + rel.map(x => row(x.n)).join("") : ""}</div>`);
  } else {
    cards += vendorCard("Varzia", "Prime Resurgence", "", `<div class="rlist"><span class="secsub" style="margin:0">Her stock isn't in the live feed right now.</span></div>`);
  }
  $("#rotating").innerHTML = h + `<div class="grid">${cards}</div><footer>Live info from the worldstate (PC and crossplay, which includes Xbox). Gold "starred" tags mark relics with parts for your starred items.</footer>`;
}

/* ---------- UPDATED LINE ---------- */
function renderUpdated() {
  let s = "";
  if (DATA_SRC === "none") s = "Loading relic data…";
  else if (DATA.seed) s = "Starter data · full Prime list comes with the first update";
  else s = `Relic data updated ${ago(DATA_AT)}`;
  if (DATA_OFFLINE && DATA_SRC !== "none") s += ` · <span class="off">offline</span>`;
  if (LIVE) s += ` · Live ${ago(LIVE_AT)}${LIVE_OFFLINE ? ` <span class="off">(saved)</span>` : ""}`;
  $("#updated").innerHTML = s;
}

/* ---------- DRAWER ---------- */
function renderDrawer() {
  const st = S();
  $("#drawer").innerHTML = `<h2>Settings</h2>
    <h3>Theme</h3><div class="themes">${THEMES.map(([k, l, sw]) => `<button class="themebtn" data-theme-set="${k}" aria-pressed="${st.theme === k}"><span class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join("")}</span>${l}</button>`).join("")}</div>
    <h3>Show</h3>${SHOW_SWITCHES.map(([k, l]) => `<label class="tgl"><span>${l}</span><input type="checkbox" data-show="${k}"${st.show[k] ? " checked" : ""}></label>`).join("")}
    <p class="always">Always shown: current fissures, relic rarity badges and Incarnon info. Variant info always shows inside the Incarnon &amp; variants dropdown.</p>
    <h3>Best farm source</h3>
    <div class="seg"><button data-farm="rates" aria-pressed="${st.farm === "rates"}">By the Rates</button><button class="mid" data-farm="both" aria-pressed="${st.farm === "both"}" aria-label="Both">Both</button><button data-farm="community" aria-pressed="${st.farm === "community"}">Community-Driven</button></div>
    <p class="seghelp">${{ rates: "The best mission for each relic, worked out from DE's drop tables.", community: "The farm players recommend.", both: "By the Rates on top, Community-Driven below. When they agree it shows once." }[st.farm]}</p>
    <div class="spacer"></div>
    <div class="backup"><h3>Backup / restore code</h3>
      <div class="controls"><button class="chip" id="bkCopy">Copy backup code</button></div>
      <textarea id="bkIn" placeholder="Paste a backup code here to restore" spellcheck="false"></textarea>
      <div class="controls"><button class="chip ghost" id="bkRestore">Restore</button><span class="toast" data-toast></span></div>
      <p class="fanline">Fan-made app, not affiliated with Digital Extremes. Warframe is a trademark of Digital Extremes Ltd.</p></div>`;
}
function applyTheme() {
  document.body.dataset.theme = S().theme;
  const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]').setAttribute("content", bg);
  if (native && native.setBarColor) try { native.setBarColor(bg, S().theme === "orokin-light"); } catch (e) {}
}

/* ---------- BACKUP CODE ---------- */
const b64u = bytes => { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
async function makeBackup() {
  const payload = JSON.stringify({ v: 1, t: Object.keys(state.ticks), s: Object.keys(state.stars), m: Object.keys(state.mastered), a: Object.keys(state.alerts), h: state.hvMin ? 1 : 0, st: state.settings });
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
  return normaliseState({ ticks: set(p.t), stars: set(p.s), mastered: set(p.m), alerts: set(p.a), hvMin: !!p.h, settings: p.st });
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
  const host = el && el.closest(".backup, .summary");
  const t = host && host.querySelector("[data-toast]");
  if (!t) return;
  t.textContent = msg; clearTimeout(t._t); t._t = setTimeout(() => { t.textContent = ""; }, 2500);
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
const closeModal = () => { $("#modalRoot").innerHTML = ""; };

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
  pages.addEventListener("change", e => {
    const u = e.target.dataset.u; if (!u) return;
    if (e.target.checked) state.ticks[u] = 1; else delete state.ticks[u];
    save(); refreshCards(e.target.dataset.it); queueDerived();
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
    const m = t.closest("[data-mastered]");
    if (m) {
      const id = m.dataset.mastered;
      if (state.mastered[id]) delete state.mastered[id]; else state.mastered[id] = 1;
      save(); renderMain(); renderFavs(); renderRuns();
      return;
    }
    const ex = t.closest("[data-exp]");
    if (ex && !t.closest("button.star, .vw")) {
      const id = ex.dataset.exp;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      document.querySelectorAll(`.card[data-item="${id}"]`).forEach(card => {
        const open = expanded.has(id);
        card.classList.toggle("open", open);
        const more = card.querySelector(".more");
        more.classList.toggle("hidden", !open);
        more.innerHTML = open ? moreHTML(BYID[id]) : "";
        card.querySelector(".expbtn").textContent = open ? "Hide info ▴" : "Relics & info ▾";
      });
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

  $("#tabs").addEventListener("click", e => { const a = e.target.closest("[data-page]"); if (a) goPage(+a.dataset.page, true); });
  $("#menuBtn").addEventListener("click", () => setDrawer(true));
  $("#scrim").addEventListener("click", () => setDrawer(false));
  $("#modalRoot").addEventListener("click", e => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });

  const dr = $("#drawer");
  dr.addEventListener("click", async e => {
    const th = e.target.closest("[data-theme-set]");
    if (th) { S().theme = th.dataset.themeSet; save(); applyTheme(); dr.querySelectorAll("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", b === th)); return; }
    const f = e.target.closest("[data-farm]");
    if (f) { S().farm = f.dataset.farm; save(); renderDrawer(); renderOpenCards(); return; }
    if (e.target.id === "bkCopy") {
      const code = await makeBackup(); const ok = await copyText(code);
      $("#bkIn").value = code; say(e.target, ok ? "Backup code copied" : "Copy blocked: the code is in the box below"); return;
    }
    if (e.target.id === "bkRestore") {
      const btn = e.target;
      let next;
      try { next = await readBackup($("#bkIn").value); } catch (err) { say(btn, "That code doesn't look right"); return; }
      if (!btn._armed) { btn._armed = 1; btn.textContent = "Tap again to replace this phone's progress"; setTimeout(() => { btn._armed = 0; btn.textContent = "Restore"; }, 4000); return; }
      state = next; save(); applyTheme(); renderDrawer(); renderAll(); say($("#bkRestore"), "Progress restored");
    }
  });
  dr.addEventListener("change", e => {
    const k = e.target.dataset.show; if (!k) return;
    S().show[k] = e.target.checked; save(); renderOpenCards();
  });
}
function renderOpenCards() { expanded.forEach(id => refreshCards(id)); }

/* ---------- PAGES (swipe) ---------- */
let page = PAGE_MAIN;
function goPage(i, smooth) {
  const p = $("#pages");
  p.scrollTo({ left: i * p.clientWidth, behavior: smooth ? "smooth" : "auto" });
  setTab(i);
}
function setTab(i) { page = i; document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", +a.dataset.page === i)); }
function bindPages() {
  const p = $("#pages"); let raf = 0;
  p.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const i = Math.round(p.scrollLeft / p.clientWidth); if (i !== page) setTab(i); });
  }, { passive: true });
  window.addEventListener("resize", () => { p.scrollLeft = page * p.clientWidth; });
}

/* ---------- DRAWER GESTURES ---------- */
let drawerOpen = false;
function setDrawer(open) {
  drawerOpen = open;
  document.body.classList.toggle("drawer-open", open);
  $("#drawer").style.transform = ""; $("#scrim").style.opacity = "";
  if (!open) document.activeElement && document.activeElement.blur && document.activeElement.blur();
}
function bindDrawerGesture() {
  const dr = $("#drawer"), sc = $("#scrim");
  let mode = null, x0 = 0, y0 = 0, w = 0, dx = 0;
  document.addEventListener("touchstart", e => {
    const t = e.touches[0]; if (!t || e.touches.length > 1) return;
    x0 = t.clientX; y0 = t.clientY; dx = 0; w = dr.offsetWidth;
    if (!drawerOpen && x0 <= EDGE_PX && !e.target.closest(".menubtn") && !$("#modal")) {
      mode = "open"; document.body.classList.add("dragging"); e.preventDefault();
    } else if (drawerOpen && (e.target.closest("#drawer") || e.target === sc)) mode = "close?";
    else mode = null;
  }, { passive: false, capture: true });
  document.addEventListener("touchmove", e => {
    if (!mode) return;
    const t = e.touches[0]; dx = t.clientX - x0;
    if (mode === "close?") {
      if (Math.abs(t.clientY - y0) > Math.abs(dx) + 6) { mode = null; return; }
      if (dx < -10) { mode = "close"; document.body.classList.add("dragging"); } else return;
    }
    e.preventDefault();
    const off = mode === "open" ? Math.min(0, dx - w) : Math.min(0, dx);
    dr.style.transform = `translateX(${off}px)`;
    sc.style.opacity = String(1 + off / w);
    sc.style.pointerEvents = "auto";
  }, { passive: false, capture: true });
  const end = () => {
    if (!mode || mode === "close?") { mode = null; return; }
    document.body.classList.remove("dragging"); sc.style.pointerEvents = "";
    if (mode === "open") setDrawer(dx > w * 0.3); else setDrawer(dx > -w * 0.3);
    mode = null;
  };
  document.addEventListener("touchend", end, { capture: true });
  document.addEventListener("touchcancel", end, { capture: true });
}

/* Android back button: close things before leaving the app */
window.wrcBack = function () {
  if ($("#modal")) { closeModal(); return true; }
  if (drawerOpen) { setDrawer(false); return true; }
  if (page !== PAGE_MAIN) { goPage(PAGE_MAIN, true); return true; }
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

/* Live worldstate: api.warframestat.us, falling back to DE's raw worldState.php */
const ms = v => { if (v == null) return 0; if (typeof v === "number") return v; if (v.$date) return +(v.$date.$numberLong || v.$date); const t = Date.parse(v); return isNaN(t) ? 0 : t; };
async function liveFromStat() {
  const q = "?language=en";
  const rs = await Promise.allSettled(["voidTrader", "dailyDeals", "steelPath", "fissures", "vaultTrader"].map(k => getJSONAny(`${WS}/${k}${q}`)));
  if (rs.every(r => r.status === "rejected")) throw new Error("warframestat unreachable");
  const v = i => rs[i].status === "fulfilled" ? rs[i].value : null;
  const vt = v(0), dd = v(1), sp = v(2), fi = v(3), vz = v(4);
  return {
    baro: vt ? { active: !!vt.active, activation: ms(vt.activation), expiry: ms(vt.expiry), location: vt.location, inventory: (vt.inventory || []).map(x => ({ n: x.item, ducats: x.ducats, credits: x.credits })) } : null,
    darvo: (Array.isArray(dd) ? dd : []).map(d => ({ n: d.item, orig: d.originalPrice, sale: d.salePrice, total: d.total, sold: d.sold, expiry: ms(d.expiry) })),
    teshin: sp && sp.currentReward ? { n: sp.currentReward.name, cost: sp.currentReward.cost, expiry: ms(sp.expiry) } : null,
    fissures: (Array.isArray(fi) ? fi : []).filter(f => !f.expired).map(f => ({ node: f.node, type: f.missionType || f.missionKey || "", tier: f.tier, expiry: ms(f.expiry), storm: !!f.isStorm, hard: !!f.isHard })),
    varzia: vz && (vz.inventory || []).length ? { expiry: ms(vz.expiry), inventory: vz.inventory.map(x => ({ n: x.item })) } : null,
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
  };
}
async function loadLive() {
  let live = null;
  try { live = await liveFromStat(); } catch (e) { try { live = await liveFromRaw(); } catch (e2) { live = null; } }
  if (live) {
    LIVE = live; LIVE_AT = Date.now(); LIVE_OFFLINE = false;
    try { localStorage.setItem(KEY_LIVE, JSON.stringify({ at: LIVE_AT, l: LIVE })); } catch (e) {}
  } else LIVE_OFFLINE = !!LIVE;
  refreshLiveSets(); renderRotating(); renderRuns(); renderUpdated(); renderOpenCards();
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
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const done = () => { if (el.classList.contains("done")) return; el.classList.add("done"); setTimeout(() => el.remove(), 500); };
  el.addEventListener("click", done);
  setTimeout(done, reduce ? 400 : 1900);
}

/* ---------- TOP BAR HEIGHT ---------- */
function trackTopbar() {
  const tb = document.querySelector(".topbar");
  const set = () => document.documentElement.style.setProperty("--toph", tb.offsetHeight + "px");
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(tb); else window.addEventListener("resize", set);
}

/* ---------- START ---------- */
applyTheme();
trackTopbar();
runIntro();
buildMain(); buildFavs(); buildRuns(); renderDrawer();
bindEvents(); bindPages(); bindDrawerGesture();
requestAnimationFrame(() => goPage(PAGE_MAIN, false));
loadCachedLive();
loadData().then(loadLive);
setInterval(loadLive, LIVE_REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - LIVE_AT > 60000) loadLive(); });
