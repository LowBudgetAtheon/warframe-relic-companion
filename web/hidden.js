/* Hidden themes, the Orokin Sale, and the Technocyte infection.
   Loaded before app.js; everything here runs only once app.js has started, and uses
   its globals (state, S, save, $, esc, applyTheme, renderDrawer, LIVE, page, native). */
"use strict";

const HIDDEN = [
  { id: "stalker", name: "Stalker", sw: ["#0a0506", "#8b0f14", "#e0d6d6"] },
  { id: "wally", name: "Man in the Wall", sw: ["#050505", "#e8e8e8", "#7a7a7a"] },
  { id: "baro", name: "Baro Ki'Teer", sw: ["#0a1233", "#d9b44a", "#5fd4e8"] },
  { id: "clem", name: "Clem", sw: ["#3b3d3a", "#a7a9a3", "#c9b18a"] },
  { id: "coda", name: "Technocyte Coda", sw: ["#c0c0c0", "#ff2bd6", "#39ff14"] },
];
const FIRST_FOUR = ["stalker", "wally", "baro", "clem"];
const IDLE_MS = 3 * 60 * 1000;         // Man in the Wall: untouched this long
const STALKER_CHANCE = 1 / 50;          // per launch
const SOUND_KEY = "wrc-secret-sound";   // the user's own sound file, kept on this phone only

const isUnlocked = id => !!(state.unlocked || {})[id];
function unlockHidden(id) {
  if (isUnlocked(id)) return false;
  state.unlocked[id] = 1;
  S().theme = id; // show it straight away; any other theme can be picked again in Settings
  save(); applyTheme(); renderDrawer();
  setTimeout(checkInfection, 1500);
  return true;
}

/* Theme list rows: unlocked hidden themes look like any other; locked ones are ????? */
function hiddenThemeRows() {
  return HIDDEN.map(h => isUnlocked(h.id)
    ? `<button class="themebtn" data-theme-set="${h.id}" aria-pressed="${S().theme === h.id}"><span class="sw">${h.sw.map(c => `<i style="background:${c}"></i>`).join("")}</span>${esc(h.name)}</button>`
    : `<div class="themebtn locked q-${h.id}" role="img" aria-label="Hidden theme"><span class="sw"><i></i><i></i><i></i></span><span class="qq">?????</span></div>`
  ).join("");
}

/* A pop-up card, themed per secret */
function secretPop(cls, title, body, button = "Close") {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal ${cls}" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name">${title}</div></div>
    <div class="mbody">${body}</div><button class="builtbtn" data-close>${esc(button)}</button></article></div>`;
}

/* ---------- Search phrases (Clem, Orokin Sale, the cure) ---------- */
function secretSearch(raw) {
  const q = String(raw || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  if (q === "clem") {
    if (unlockHidden("clem")) secretPop("pop-clem", "Clem", "<p>Grakata.</p><p>Clem appreciates you. Clem theme unlocked.</p>", "Grakata!");
    return true;
  }
  if (q === "orokin sale") { orokinSale(); return true; }
  if (q === "party of your lifetime" && document.body.classList.contains("infected")) { cure(); return true; }
  return false;
}

/* ---------- The Orokin Sale (inside joke) ---------- */
const CELL_SVG = `<svg viewBox="0 0 24 40" aria-hidden="true"><rect x="5" y="2" width="14" height="36" rx="7" fill="#d9b44a"/><rect x="8" y="9" width="8" height="22" rx="4" fill="#4fd1c5"/><rect x="9.5" y="11" width="2" height="18" rx="1" fill="#cffff5" opacity=".8"/><rect x="5" y="17" width="14" height="2" fill="#8a6a1c"/><rect x="5" y="21" width="14" height="2" fill="#8a6a1c"/></svg>`;
function orokinSale() {
  const calm = S().reduceMotion;
  const n = calm ? 8 : 48;
  for (let i = 0; i < n; i++) {
    const c = document.createElement("div");
    c.className = "ocell";
    c.innerHTML = CELL_SVG;
    c.style.cssText = `left:${Math.random() * 96}vw;--dur:${(calm ? 5 : 2.2) + Math.random() * 1.8}s;--delay:${Math.random() * (calm ? 2 : 1.4)}s;--rot:${(Math.random() - .5) * 720}deg;--sz:${18 + Math.random() * 16}px`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 8000);
  }
  secretPop("pop-sale", `<span class="sale-big">Orokin Sale!</span>`,
    `<div class="sale-burst">LIMITED TIME</div><p class="sale-line">Everything must go! Prices slashed across the entire Origin System!</p><p class="sale-fine">*Orokin Cells not included. Offer ends when the Orokin did.</p>`, "Shop now!");
}

/* ---------- Stalker: rare red takeover, or tap the launch logo 5 times ---------- */
const STALKER_LINES = ["I have watched you hoard their relics.", "Every Prime you build is another debt.", "The Void will not hide you forever.", "You were never alone in here."];
function stalkerTakeover(forced) {
  if (isUnlocked("stalker") || document.querySelector(".stalker-take")) return;
  const el = document.createElement("div");
  el.className = "stalker-take";
  el.setAttribute("role", "button");
  el.innerHTML = `<div class="st-line">${esc(STALKER_LINES[Math.floor(Math.random() * STALKER_LINES.length)])}</div>`;
  document.body.appendChild(el);
  let won = false;
  const win = () => {
    if (won) return; won = true;
    el.classList.add("won");
    el.innerHTML = `<div class="st-line">Your actions will have consequences.</div>`;
    unlockHidden("stalker");
    setTimeout(() => el.remove(), 3200);
  };
  el.addEventListener("click", win);
  if (forced) { win(); return; }
  setTimeout(() => { if (!won) { el.classList.add("gone"); setTimeout(() => el.remove(), 600); } }, 3500);
}
function hookIntroTaps() {
  const intro = document.getElementById("intro");
  if (!intro) return;
  let taps = 0;
  intro.addEventListener("click", e => {
    e.stopImmediatePropagation();
    taps++;
    window.__introHold = Date.now() + 900; // keep the intro up while someone is tapping
    if (taps === 5) stalkerTakeover(true);
  }, true);
}

/* ---------- Man in the Wall: leave the app untouched ---------- */
let lastTouch = Date.now();
["pointerdown", "touchstart", "keydown", "wheel", "scroll"].forEach(ev => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));
document.addEventListener("visibilitychange", () => { lastTouch = Date.now(); });
setInterval(() => {
  if (document.hidden || isUnlocked("wally") || document.getElementById("modal")) return;
  if (Date.now() - lastTouch > IDLE_MS) wallyArrives();
}, 5000);
function wallyArrives() {
  if (document.querySelector(".wally-take")) return;
  const el = document.createElement("div");
  el.className = "wally-take" + (S().reduceMotion ? " calm" : "");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="wt-static"></div><div class="wt-void"></div>`;
  document.body.appendChild(el);
  playSecretSound();
  setTimeout(() => { unlockHidden("wally"); el.classList.add("gone"); setTimeout(() => el.remove(), 1500); }, 6500);
}
function playSecretSound() {
  let src = null;
  try { src = localStorage.getItem(SOUND_KEY); } catch (e) {}
  if (!src) return;
  try { if (native && native.isSilent && native.isSilent()) return; } catch (e) {}
  try { const a = new Audio(src); a.volume = 1; a.play().catch(() => {}); } catch (e) {}
}
function soundRow() {
  let has = false;
  try { has = !!localStorage.getItem(SOUND_KEY); } catch (e) {}
  return `<div class="drow"><span>Secret sound</span><span class="sndbtns">
    <label class="chip" for="sndIn">${has ? "Change" : "Choose"}</label>${has ? `<button class="chip ghost" id="sndClear">Clear</button>` : ""}
    <input id="sndIn" type="file" accept="audio/*" hidden></span></div>
    <p class="always">Optional. An audio file from your phone that plays when something hidden happens. It stays on this phone.</p>`;
}
function bindSoundPicker(dr) {
  dr.addEventListener("change", e => {
    if (e.target.id !== "sndIn" || !e.target.files[0]) return;
    const f = e.target.files[0];
    if (f.size > 3 * 1024 * 1024) { alertNote("That file is over 3 MB. Pick a shorter clip."); return; }
    const r = new FileReader();
    r.onload = () => { try { localStorage.setItem(SOUND_KEY, r.result); } catch (err) { alertNote("Couldn't save that file on this phone."); } renderDrawer(); };
    r.readAsDataURL(f);
  });
  dr.addEventListener("click", e => { if (e.target.id === "sndClear") { try { localStorage.removeItem(SOUND_KEY); } catch (err) {} renderDrawer(); } });
}
function alertNote(t) { const m = document.getElementById("codeMsg"); if (m) { m.className = "codemsg bad"; m.textContent = t; } }

/* ---------- Baro: visit Rotating while he's here ---------- */
function checkBaro() {
  if (isUnlocked("baro") || page !== 0 || !LIVE || !LIVE.baro) return;
  const b = LIVE.baro, now = Date.now();
  if (b.active && b.expiry > now) {
    if (unlockHidden("baro")) secretPop("pop-baro", "A gift from the Void Trader", "<p>Baro Ki'Teer noticed you browsing his wares, and left something gilded behind.</p><p>Baro Ki'Teer theme unlocked.</p>", "Accept");
  }
}

/* ---------- Technocyte Coda: the infection, and its cure ---------- */
let infectTimer = 0;
function checkInfection() {
  const on = FIRST_FOUR.every(isUnlocked) && !isUnlocked("coda");
  document.body.classList.toggle("infected", on);
  const s = document.getElementById("search");
  if (s) s.placeholder = on ? "Search Primes or parts \u2592 p\u2592rty \u2592f y\u2592ur l\u2592fet\u2592me \u2592" : "Search Primes or parts";
  clearInterval(infectTimer);
  if (!on) { document.querySelectorAll(".infect").forEach(x => x.remove()); return; }
  const spread = () => {
    const cards = [...document.querySelectorAll(".page .card")].filter(c => c.getBoundingClientRect().bottom > 0 && c.getBoundingClientRect().top < innerHeight);
    if (!cards.length || document.querySelectorAll(".infect").length > 40) return;
    const c = cards[Math.floor(Math.random() * cards.length)];
    const px = document.createElement("i");
    px.className = "infect";
    px.style.cssText = `left:${Math.random() * 90}%;top:${Math.random() * 85}%;--s:${6 + Math.floor(Math.random() * 4) * 4}px`;
    c.appendChild(px);
  };
  for (let i = 0; i < 12; i++) spread();
  infectTimer = setInterval(spread, S().reduceMotion ? 6000 : 1800);
}
function cure() {
  clearInterval(infectTimer);
  document.querySelectorAll(".infect").forEach(x => x.classList.add("subside"));
  document.body.classList.add("curing");
  setTimeout(() => {
    document.querySelectorAll(".infect").forEach(x => x.remove());
    document.body.classList.remove("curing");
    unlockHidden("coda");
    checkInfection();
    secretPop("pop-coda", "TECHNOCYTE.EXE", `<p>C:\\&gt; party_of_your_lifetime.exe</p><p>Infection contained. A new look has been installed.</p>`, "OK");
  }, 1400);
}

/* Called once by app.js after it has started */
function startHidden() {
  hookIntroTaps();
  checkInfection();
  if (!isUnlocked("stalker") && Math.random() < STALKER_CHANCE) setTimeout(() => stalkerTakeover(false), 4000 + Math.random() * 16000);
}
