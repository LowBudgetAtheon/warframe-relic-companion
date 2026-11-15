/* Inventory Scan: reads relic and Prime part names off a screen recording, on the phone.
   Text reading uses Tesseract (bundled in vendor/tesseract/ by the APK build), loaded only
   when a scan starts. Nothing leaves the phone.

   How a scan works:
   1. Take a frame about every half second (up to 60), skipping frames that barely changed.
   2. Crop to the bright part of the picture (the TV, if the clip was filmed with a phone),
      scale it up, and turn it into dark text on white with a local-contrast threshold,
      so it works with any in-game UI colour.
   3. Read the words, then match them to the names the app already knows. Blur makes
      S/8/B, O/0 and I/1 look alike, so those are treated as the same shape, and the
      screen's A–Z order settles any tie.
   4. Each tile shows up in several frames; the count it shows most often wins. */
(function () {
  const TESS = "vendor/tesseract/";
  const STEP_S = 0.5, MAX_FRAMES = 60, OCR_W = 2560;
  let worker = null, cancelled = false;

  /* ---------- small helpers (also used by the tests) ---------- */
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  // letters that blur into each other collapse to one shape
  const CORE = { "0": "O", Q: "O", D: "O", "©": "O", "@": "O", "1": "I", L: "I", "!": "I", "|": "I", J: "I", T: "I", "7": "I", "5": "S", "8": "S", B: "S", "$": "S", "2": "Z", "6": "G", "9": "G", "4": "A" };
  const WIDE = { ...CORE, E: "F", P: "F", R: "F", H: "N", M: "N", U: "O", V: "Y", C: "O", K: "X" }; // for long names, where the rest of the word carries it
  const shape = (s, wide) => String(s).toUpperCase().split("").map(c => (wide ? WIDE : CORE)[c] || c).join("");
  const letters = (s, digits) => String(s).toUpperCase().replace(digits ? /[^A-Z0-9 ]+/g : /[^A-Z ]+/g, digits ? " " : "").replace(/\s+/g, " ").trim();
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const box = w => ({ x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
  const mode = (list, low) => { // most common value; ties go to the larger number (or smaller, with low)
    const c = new Map(); list.forEach(v => c.set(v, (c.get(v) || 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1] || (low ? a[0] - b[0] : b[0] - a[0]))[0][0];
  };

  /* Count badges: "x12" on relics, a bare "3" on Prime parts. */
  function countOf(w, needX) {
    const t = String(w.text).replace(/[()\[\]{}|.,:;'"`]/g, "");
    let m = /^[xX×%*+]\s*([0-9OoIlSB]{1,3})$/.exec(t);
    if (!m && !needX && (w.conf == null || w.conf >= 90)) m = /^([0-9]{1,2})$/.exec(t);
    if (!m) return 0;
    const n = +m[1].replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
    return n > 0 && n < 1000 ? n : 0;
  }
  /* The badge sits above a tile's name, at the tile's left. Pick, for each name, the
     nearest badge above it in the same column. */
  function badgeFor(nameBox, badges, h, used) {
    const w = nameBox.x1 - nameBox.x0, cx = (nameBox.x0 + nameBox.x1) / 2;
    let best = null, bd = Infinity;
    badges.forEach((b, i) => {
      if (used.has(i)) return;
      const bx = (b.x0 + b.x1) / 2, dy = nameBox.y0 - b.y1;
      if (dy < 0 || dy > 9 * h) return;
      if (bx < nameBox.x0 - Math.max(w, 5 * h) * 0.8 || bx > cx + h) return;
      if (dy < bd) { bd = dy; best = i; }
    });
    if (best == null) return 0;
    used.add(best);
    return badges[best].n;
  }

  /* ---------- relics ---------- */
  const TIERS = ["LITH", "MESO", "NEO", "AXI"], TIER_NAME = { LITH: "Lith", MESO: "Meso", NEO: "Neo", AXI: "Axi" };
  function tierOfWord(t) {
    const u = String(t).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (u.length < 2 || u.length > 5) return null;
    const d = TIERS.map(x => [x, lev(u, x)]).sort((a, b) => a[1] - b[1]);
    if (d[0][1] > (d[0][0].length > 3 ? 2 : 1) || d[0][1] === d[1][1]) return null;
    return d[0][0];
  }
  function relicIndex(names) { // shape key -> [real names]
    const idx = new Map();
    names.forEach(n => {
      const m = /^(Lith|Meso|Neo|Axi) ([A-Z]\d+)$/.exec(n); if (!m) return;
      const k = m[1].toUpperCase() + " " + shape(m[2]);
      (idx.get(k) || idx.set(k, []).get(k)).push(n);
    });
    return idx;
  }
  /* One frame: [{name or [candidates], n (0 = shown but not owned), y, x}] in reading order */
  function relicsInFrame(words, idx, ownedAt) {
    const ws = words.filter(w => String(w.text).trim());
    const h = median(ws.map(w => w.bbox.y1 - w.bbox.y0)) || 20;
    const badges = ws.map(w => ({ ...box(w), n: countOf(w, true) })).filter(b => b.n);
    const hits = [];
    ws.forEach((w, i) => {
      const tier = tierOfWord(w.text); if (!tier) return;
      // the code is the next word on the same line, or glued on ("LithA1")
      let code = null, end = w;
      const glued = /^[A-Za-z]{3,4}([A-Za-z0-9!|$©@]{2,3})$/.exec(w.text);
      const nx = ws.find(o => o !== w && o.bbox.x0 > w.bbox.x0 && o.bbox.x0 - w.bbox.x1 < 1.5 * h &&
        Math.abs((o.bbox.y0 + o.bbox.y1) / 2 - (w.bbox.y0 + w.bbox.y1) / 2) < 0.6 * h);
      if (nx && /^[A-Za-z0-9!|$©@]{2,3}$/.test(String(nx.text).replace(/[.,:;'"`]/g, ""))) { code = String(nx.text).replace(/[.,:;'"`]/g, ""); end = nx; }
      else if (glued && tierOfWord(w.text.slice(0, w.text.length - glued[1].length))) code = glued[1];
      if (!code) return;
      const cands = idx.get(tier + " " + shape(code));
      if (!cands) return;
      const nb = { x0: w.bbox.x0, y0: Math.min(w.bbox.y0, end.bbox.y0), x1: end.bbox.x1 + 2.2 * h, y1: Math.max(w.bbox.y1, end.bbox.y1) };
      hits.push({ cands, box: nb });
    });
    hits.sort((a, b) => (Math.abs(a.box.y0 - b.box.y0) < h ? a.box.x0 - b.box.x0 : a.box.y0 - b.box.y0));
    const used = new Set();
    return hits.map(hh => {
      let n = badgeFor(hh.box, badges, h, used);
      if (!n) n = ownedAt ? (ownedAt(hh.box, h) ? 1 : 0) : 1;
      return { cands: hh.cands, n };
    });
  }
  /* Settle look-alike names (Lith S4 / Lith B4) using the screen's A–Z order. */
  function settleOrder(list, cmp) {
    const out = list.map(x => (x.cands.length === 1 ? x.cands[0] : null));
    for (let i = 0; i < list.length; i++) {
      if (out[i]) continue;
      let lo = null, hi = null;
      for (let j = i - 1; j >= 0; j--) if (out[j]) { lo = out[j]; break; }
      for (let j = i + 1; j < list.length; j++) if (list[j].cands.length === 1) { hi = list[j].cands[0]; break; }
      const fit = list[i].cands.filter(c => (!lo || cmp(lo, c) <= 0) && (!hi || cmp(c, hi) <= 0));
      out[i] = (fit.length === 1 ? fit : []).concat(null)[0];
    }
    return out;
  }

  /* ---------- Prime parts ---------- */
  function partIndex(names, digits) {
    const byFirst = new Map();
    names.forEach(full => {
      const L = letters(full, digits), first = L.split(" ")[0];
      (byFirst.get(first) || byFirst.set(first, []).get(first)).push({ full, L, S: shape(L, true) });
    });
    return byFirst;
  }
  /* Group words into name blocks: words on one line, then lines stacked under each other. */
  function blocksOf(ws, h) {
    const segs = [];
    ws.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0).forEach(w => {
      const cy = (w.bbox.y0 + w.bbox.y1) / 2;
      const s = segs.find(s => Math.abs(s.cy - cy) < 0.55 * h && w.bbox.x0 - s.x1 < 1.1 * h && w.bbox.x0 >= s.x0);
      if (s) { s.words.push(w); s.x1 = Math.max(s.x1, w.bbox.x1); s.y0 = Math.min(s.y0, w.bbox.y0); s.y1 = Math.max(s.y1, w.bbox.y1); }
      else segs.push({ words: [w], x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, cy });
    });
    segs.sort((a, b) => a.y0 - b.y0);
    const blocks = [];
    segs.forEach(s => {
      const cx = (s.x0 + s.x1) / 2;
      const b = blocks.find(b => s.y0 - b.y1 < 0.9 * h && s.y0 - b.y1 > -0.3 * h &&
        Math.abs(cx - (b.x0 + b.x1) / 2) < 0.35 * Math.max(b.x1 - b.x0, s.x1 - s.x0) + h);
      if (b) { b.segs.push(s); b.x0 = Math.min(b.x0, s.x0); b.x1 = Math.max(b.x1, s.x1); b.y1 = Math.max(b.y1, s.y1); }
      else blocks.push({ segs: [s], x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1 });
    });
    return blocks.map(b => ({ box: b, text: b.segs.map(s => s.words.map(w => w.text).join(" ")).join(" ") }));
  }
  function matchPart(text, idx, cache, digits) {
    const L = letters(text, digits);
    if (cache.has(L)) return cache.get(L);
    let best = null, bd = Infinity;
    const toks = L.split(" ").filter(Boolean);
    toks.slice(0, 3).forEach((tok, ti) => {
      idx.forEach((list, first) => {
        if (Math.abs(first.length - tok.length) > 2 || lev(shape(tok, true), shape(first, true)) > (first.length > 5 ? 2 : 1)) return;
        const tail = toks.slice(ti).join(" "), S = shape(tail, true);
        list.forEach(c => {
          const d = lev(S, c.S);
          if (d < bd || (d === bd && best && c.L.length > best.L.length)) { bd = d; best = c; }
        });
      });
    });
    const ok = best && bd <= Math.max(2, Math.floor(best.L.length * 0.22)) ? best.full : null;
    cache.set(L, ok);
    return ok;
  }
  function partsInFrame(words, idx, cache) {
    const ws = words.filter(w => String(w.text).trim());
    const h = median(ws.filter(w => /[a-z]{3}/i.test(w.text)).map(w => w.bbox.y1 - w.bbox.y0)) || 20;
    const badges = ws.map(w => ({ ...box(w), n: countOf(w, false) })).filter(b => b.n);
    const named = ws.filter(w => /[A-Za-z]{2}/.test(w.text));
    const used = new Set(), out = [];
    blocksOf(named, h).forEach(b => {
      const full = matchPart(b.text, idx, cache); if (!full) return;
      out.push({ full, n: badgeFor(b.box, badges, h, used) || 1 });
    });
    return out;
  }

  /* ---------- Codex: which items show the mastery icon ----------
     Each Codex tile has its name on a white bar, and a green mastery icon in its top-right
     corner once the item is mastered. Find the icons as small green blobs, then give each
     one to the name below and to the left of it. */
  function greenBlobs(img) {
    const W = img.width, H = img.height, d = img.data, step = 2, w = Math.ceil(W / step), h = Math.ceil(H / step);
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = ((y * step) * W + x * step) * 4, r = d[k], g = d[k + 1], b = d[k + 2];
      if (g > 140 && g > r + 40 && b > 90) m[y * w + x] = 1;
    }
    const out = [], seen = new Uint8Array(w * h), st = [];
    for (let i = 0; i < w * h; i++) {
      if (!m[i] || seen[i]) continue;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0; st.push(i); seen[i] = 1;
      while (st.length) {
        const j = st.pop(), x = j % w, y = (j / w) | 0; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const q of [j - 1, j + 1, j - w, j + w]) if (q >= 0 && q < w * h && m[q] && !seen[q] && Math.abs((q % w) - x) <= 1) { seen[q] = 1; st.push(q); }
      }
      out.push({ x0: x0 * step, y0: y0 * step, x1: (x1 + 1) * step, y1: (y1 + 1) * step, n: n * step * step });
    }
    return out;
  }
  // a Codex name sits on a white bar: most of the pixels around its text are bright
  function onLabel(img, b, h) {
    const W = img.width, d = img.data, x0 = Math.max(0, Math.round(b.x0 - 0.4 * h)), x1 = Math.min(W - 1, Math.round(b.x1 + 0.4 * h));
    const y0 = Math.max(0, Math.round(b.y0 - 0.25 * h)), y1 = Math.min(img.height - 1, Math.round(b.y1 + 0.25 * h));
    let n = 0, br = 0;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { const k = (y * W + x) * 4; n++; if (d[k] + d[k + 1] + d[k + 2] > 540) br++; }
    return n && br / n > 0.35;
  }
  function masteryInFrame(words, img, idx, cache) {
    const ws = words.filter(w => /[A-Za-z0-9]{2}/.test(w.text));
    const h = median(ws.map(w => w.bbox.y1 - w.bbox.y0)) || 20;
    const blocks = blocksOf(ws, h).filter(b => onLabel(img, b.box, h)).map(b => ({ ...b, n: matchPart(b.text, idx, cache, true) })).filter(b => b.n);
    if (!blocks.length) return [];
    // tile width: the usual gap between names on the same row
    // tile width: for each name, the gap to the nearest name to its right on the same row
    const gaps = [];
    blocks.forEach(a => {
      let g = Infinity;
      blocks.forEach(b => { const dx = b.box.x0 - a.box.x0; if (dx > 3 * h && Math.abs(b.box.y0 - a.box.y0) < 2 * h && dx < g) g = dx; });
      if (g < Infinity) gaps.push(g);
    });
    const S = gaps.length >= 3 ? median(gaps) : img.width * 0.12;
    const icons = greenBlobs(img).filter(c => { const cw = c.x1 - c.x0, ch = c.y1 - c.y0; return cw > 0.05 * S && cw < 0.3 * S && ch > 0.05 * S && ch < 0.3 * S && cw / ch < 2.2 && ch / cw < 2.2; });
    const got = new Set();
    icons.forEach(c => {
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      let best = null, bd = Infinity;
      blocks.forEach((b, i) => {
        const dy = b.box.y0 - cy;
        if (cx < b.box.x0 - 0.15 * S || cx > b.box.x0 + 1.15 * S || dy < 0.3 * S || dy > 1.4 * S) return;
        if (dy < bd) { bd = dy; best = i; }
      });
      if (best != null) got.add(best);
    });
    // a tile whose top is cut off (under the header or the screen edge) can't show its icon: no vote
    const top = Math.max(img.height * 0.12, 0);
    const out = blocks.map((b, i) => ({ name: b.n, m: got.has(i), sure: got.has(i) || b.box.y0 - 0.95 * S > top, x: b.box.x0, y: b.box.y0 }));
    // reading order, as the Codex lays them out: row by row (rows drift a little across the curved screen), left to right
    out.sort((a, b) => a.y - b.y);
    let row = 0, prevY = -Infinity;
    out.forEach(o => { if (o.y - prevY > 0.5 * S) row++; prevY = o.y; o.row = row; });
    out.sort((a, b) => a.row - b.row || a.x - b.x);
    return out.filter(x => x.sure);
  }

  /* ---------- frames ---------- */
  const wait = (el, ev, ms) => new Promise(ok => { const t = setTimeout(ok, ms); el.addEventListener(ev, () => { clearTimeout(t); ok(); }, { once: true }); });
  async function openVideo(file) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = URL.createObjectURL(file);
    await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error("video")); setTimeout(() => no(new Error("video")), 20000); });
    if (!isFinite(v.duration)) { v.currentTime = 1e7; await wait(v, "seeked", 5000); }
    if (!v.videoWidth || !isFinite(v.duration)) throw new Error("video");
    return v;
  }
  /* Crop box of the bright area (the TV screen in a phone-filmed clip) */
  function brightBox(ctx, W, H) {
    const d = ctx.getImageData(0, 0, W, H).data, col = new Array(W).fill(0), row = new Array(H).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 150) { col[x]++; row[y]++; } }
    const span = (a, lim) => { let s = a.findIndex(v => v > lim), e = a.length - 1 - a.slice().reverse().findIndex(v => v > lim); return s < 0 ? [0, a.length] : [s, e + 1]; };
    const [x0, x1] = span(col, H * 0.15), [y0, y1] = span(row, W * 0.15);
    return (x1 - x0) * (y1 - y0) < W * H * 0.15 ? { x: 0, y: 0, w: W, h: H } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  /* Dark text on white: a pixel is text when it's clearly brighter than its surroundings. */
  function threshold(src, W, H, dark) {
    const s = src.data, L = new Float32Array(W * H), I = new Float64Array((W + 1) * (H + 1));
    for (let i = 0; i < W * H; i++) L[i] = s[i * 4] * 0.3 + s[i * 4 + 1] * 0.59 + s[i * 4 + 2] * 0.11;
    for (let y = 0; y < H; y++) { let r = 0; for (let x = 0; x < W; x++) { r += L[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + r; } }
    // dark: black names on white bars (the Codex); otherwise light text on a dark UI
    const R = dark ? Math.max(6, Math.round(W / 213)) : Math.max(8, Math.round(W / 100)), out = new ImageData(W, H), o = out.data;
    for (let y = 0; y < H; y++) {
      const ya = Math.max(0, y - R), yb = Math.min(H, y + R + 1);
      for (let x = 0; x < W; x++) {
        const xa = Math.max(0, x - R), xb = Math.min(W, x + R + 1);
        const mean = (I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa]) / ((yb - ya) * (xb - xa));
        const v = L[y * W + x], txt = dark ? v < 110 && mean > 140 : v > mean + 35 && v > 110, k = (y * W + x) * 4;
        o[k] = o[k + 1] = o[k + 2] = txt ? 0 : 255; o[k + 3] = 255;
      }
    }
    return out;
  }
  async function* frames(file, dark) {
    const v = await openVideo(file);
    try {
      const dur = v.duration, n = Math.max(1, Math.min(MAX_FRAMES, Math.floor(dur / STEP_S)));
      const sw = 320, sh = Math.round(320 * v.videoHeight / v.videoWidth);
      const small = document.createElement("canvas"); small.width = sw; small.height = sh;
      const sctx = small.getContext("2d", { willReadFrequently: true });
      let prevSig = null;
      for (let i = 0; i < n; i++) {
        if (cancelled) return;
        v.currentTime = Math.min(dur - 0.05, (i + 0.5) * dur / n);
        await wait(v, "seeked", 8000);
        sctx.drawImage(v, 0, 0, sw, sh);
        const sig = sctx.getImageData(0, 0, sw, sh).data;
        if (prevSig) { let diff = 0; for (let k = 0; k < sig.length; k += 16) diff += Math.abs(sig[k + 1] - prevSig[k + 1]); if (diff / (sig.length / 16) < 2) continue; }
        prevSig = sig;
        const bb = brightBox(sctx, sw, sh), f = v.videoWidth / sw;
        const cw = OCR_W, ch = Math.round(OCR_W * bb.h / bb.w);
        const c = document.createElement("canvas"); c.width = cw; c.height = ch;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, bb.x * f, bb.y * f, bb.w * f, bb.h * f, 0, 0, cw, ch);
        const color = ctx.getImageData(0, 0, cw, ch);
        const bw = document.createElement("canvas"); bw.width = cw; bw.height = ch;
        bw.getContext("2d").putImageData(threshold(color, cw, ch, dark), 0, 0);
        yield { bw, color, i, n };
      }
    } finally { URL.revokeObjectURL(v.src); v.removeAttribute("src"); v.load(); }
  }
  /* A relic you don't own shows faded and blue; one you own shows its gold, silver or red art. */
  function ownedSampler(img) {
    return (b, h) => {
      const x0 = Math.max(0, Math.round(b.x0)), x1 = Math.min(img.width, Math.round(b.x1));
      const y0 = Math.max(0, Math.round(b.y0 - 4.5 * h)), y1 = Math.max(0, Math.round(b.y0 - 0.8 * h));
      let warm = 0, all = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const k = (y * img.width + x) * 4, r = img.data[k], g = img.data[k + 1], bl = img.data[k + 2];
        all++; if ((r > 90 && r > bl) || (r > 150 && g > 150 && bl > 150)) warm++;
      }
      return all ? warm / all > 0.08 : true;
    };
  }

  /* ---------- OCR ---------- */
  function loadScript(src) {
    return new Promise((ok, no) => {
      if (window.Tesseract) return ok();
      const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("ocr")); document.head.appendChild(s);
    });
  }
  async function getWorker() {
    if (worker) return worker;
    await loadScript(TESS + "tesseract.min.js");
    worker = await Tesseract.createWorker("eng", 1, { workerPath: TESS + "worker.min.js", corePath: TESS, langPath: TESS, gzip: false, workerBlobURL: false });
    await worker.setParameters({ tessedit_pageseg_mode: "11" });
    return worker;
  }
  function wordsOf(data) {
    if (data.words && data.words.length) return data.words.map(w => ({ text: w.text, conf: w.confidence, bbox: w.bbox }));
    const out = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => (l.words || []).forEach(w => out.push({ text: w.text, conf: w.confidence, bbox: w.bbox })))));
    return out;
  }

  /* ---------- the scan ---------- */
  async function runScan(kind, file) {
    if (SCAN_UI.busy) return;
    cancelled = false;
    const label = { relics: "relics", parts: "parts", mastery: "the Codex" }[kind];
    scanSay("Getting ready…", false, true);
    try {
      if (!ALL.length) throw new Error("data");
      const w = await getWorker();
      const relIdx = relicIndex(Object.keys(DATA.relics || {}));
      // Base and Prime parts. A built Base component ("Gauss Neuroptics") sits in the inventory as its blueprint too.
      const names = new Set(), alias = new Map();
      ALL.forEach(it => unitsOf(it).forEach(u => {
        if (u.whole || u.own || !u.full) return;
        names.add(u.full);
        if (it.b && !/ Blueprint$/.test(u.full)) { names.add(`${u.full} Blueprint`); alias.set(`${u.full} Blueprint`, u.full); }
      }));
      const pIdx = partIndex([...names]), cache = new Map();
      const iIdx = kind === "mastery" ? partIndex(ALL.filter(counts).map(it => it.n), true) : null;
      const seen = new Map(); // name -> [counts seen in each frame]
      const order = new Map(); // name -> when it first showed up, for listing in Codex order
      for await (const f of frames(file, kind === "mastery")) {
        if (cancelled) break;
        scanSay(`Reading ${label}… ${Math.round(100 * f.i / f.n)}%`, false, true);
        const { data } = await w.recognize(f.bw, {}, { text: false, blocks: true });
        const words = wordsOf(data), frame = new Map();
        if (kind === "mastery") masteryInFrame(words, f.color, iIdx, cache).forEach(x => { frame.set(x.name, x.m ? 1 : 0); if (!order.has(x.name)) order.set(x.name, order.size); });
        else if (kind === "relics") {
          const list = relicsInFrame(words, relIdx, ownedSampler(f.color));
          settleOrder(list, (a, b) => (tierOf(a) === tierOf(b) ? relicSort(a, b) : 0)).forEach((n, i) => { if (n) frame.set(n, (frame.get(n) || 0) + list[i].n); });
        } else partsInFrame(words, pIdx, cache).forEach(p => { const f = alias.get(p.full) || p.full; frame.set(f, (frame.get(f) || 0) + p.n); });
        frame.forEach((n, k) => (seen.get(k) || seen.set(k, []).get(k)).push(n));
      }
      if (cancelled) { scanSay("Scan cancelled."); return; }
      if (kind === "mastery") { // icon seen in at least half the frames that showed the item
        finishMastery(new Map([...seen.entries()].map(([k, l]) => [k, l.filter(Boolean).length * 2 >= l.length])), file.name, order); return;
      }
      const result = new Map([...seen.entries()].map(([k, l]) => [k, mode(l, kind !== "relics")]));
      if (kind === "relics") finishRelics(result, file.name); else finishParts(result, file.name);
    } catch (e) {
      const why = { video: "This phone couldn't open that video. Try recording at 1080p or 4K.", ocr: "The text reader didn't load. Try updating the app.", data: "Wait for the Prime list to load, then try again." }[e.message];
      scanSay(why || "Something went wrong reading that video.", true);
    }
  }
  /* The scan lists what it thinks is NOT mastered for you to check; everything else it saw gets
     marked Mastered once you confirm. */
  function finishMastery(result, fname, order) {
    const seen = [...result.entries()].map(([n, m]) => ({ it: BYNAME[n], m, o: order && order.has(n) ? order.get(n) : Infinity })).filter(x => x.it);
    if (!seen.length) { scanSay("Couldn't read any item names from that video. Try a recording of the Codex on the console.", true); return; }
    const notM = seen.filter(x => !x.m).sort((a, b) => a.o - b.o || a.it.n.localeCompare(b.it.n)); // in the order the Codex showed them
    state.scanFiles.mastery = fname; state.scanAt.mastery = Date.now(); save();
    scanSay(`Read ${seen.length} items: ${seen.length - notM.length} mastered. Check the rest, then confirm.`);
    renderDrawer(); setDrawer(false);
    setTimeout(() => {
      $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name">Not mastered?</div>
        <div class="meta"><span class="tag">Codex scan</span><span class="cnt">${seen.length - notM.length} mastered · ${notM.length} not</span></div></div>
        <div class="mbody"><p>The scan saw these without the mastery icon. Tick any that are actually mastered. Everything else it read (${seen.length - notM.length} items) will be marked Mastered.</p>
        <div class="remlist">${notM.length ? notM.map((x, i) => `<label class="tgl"><span>${esc(x.it.n)}${state.mastered[x.it.id] ? ` <span class="sub" style="margin:0">mastered in the app</span>` : ""}</span><input type="checkbox" data-nm="${i}"></label>`).join("") : `<p class="empty">Everything it read is mastered.</p>`}</div></div>
        <div class="tourbtns"><button class="chip ghost" data-close>Cancel</button><button class="chip" id="mGo">Confirm</button></div></article></div>`;
      $("#mGo").addEventListener("click", () => {
        const snap = snapState(), fix = new Set();
        document.querySelectorAll("[data-nm]").forEach(c => { if (c.checked) fix.add(+c.dataset.nm); });
        let on = 0, off = 0;
        seen.filter(x => x.m).forEach(x => { if (!state.mastered[x.it.id]) on++; state.mastered[x.it.id] = 1; clearBuild(x.it.id); });
        notM.forEach((x, i) => {
          if (fix.has(i)) { if (!state.mastered[x.it.id]) on++; state.mastered[x.it.id] = 1; clearBuild(x.it.id); }
          else if (state.mastered[x.it.id]) { delete state.mastered[x.it.id]; off++; }
        });
        save(); closeModal(); renderAll();
        offerUndo(`Marked ${on} mastered${off ? `, unmarked ${off}` : ""}`, snap);
      });
    }, 250);
  }
  function finishRelics(result, fname) {
    const owned = [...result.entries()].filter(([, n]) => n > 0);
    if (!result.size) { scanSay("Couldn't read any relic names from that video. A clip recorded on the console reads best.", true); return; }
    state.relicCounts = Object.fromEntries(owned);
    state.scanFiles.relics = fname; state.scanAt.relics = Date.now(); save();
    const total = owned.reduce((a, [, n]) => a + n, 0);
    scanSay(`Found ${owned.length} relic${owned.length === 1 ? "" : "s"} you own (${total} in total).`);
    renderDrawer(); renderAll();
  }
  function finishParts(result, fname) {
    if (!result.size) { scanSay("Couldn't read any part names from that video. A clip recorded on the console reads best.", true); return; }
    const left = new Map(result), add = [], rem = [];
    const order = [];
    ALL.forEach(it => {
      if (!active(it) || state.building[it.id] || state.built[it.id]) return; // in the Foundry, or built: their parts are used up
      unitsOf(it).forEach(u => { if (!u.whole && !u.own) order.push({ it, u }); });
    });
    order.sort((a, b) => (a.u.group ? 1 : 0) - (b.u.group ? 1 : 0)); // an item's own parts first, then ones needed for other weapons
    const snap = snapState();
    order.forEach(({ it, u }) => {
      const n = left.get(u.full) || 0;
      if (n > 0) { left.set(u.full, n - 1); if (!isTicked(u)) add.push(u); }
      else if (isTicked(u)) rem.push({ it, u });
    });
    add.forEach(u => { state.ticks[u.id] = 1; });
    state.partCounts = Object.fromEntries([...result.entries()].filter(([, n]) => n > 0)); // a new scan replaces the last one
    state.scanFiles.parts = fname; state.scanAt.parts = Date.now(); save();
    scanSay(`Ticked ${add.length} new part${add.length === 1 ? "" : "s"}.${rem.length ? ` ${rem.length} to check.` : ""}`);
    renderDrawer(); renderAll();
    if (add.length) offerUndo(`Scan ticked ${add.length} part${add.length === 1 ? "" : "s"}`, snap);
    if (rem.length) { setDrawer(false); setTimeout(() => confirmRemovals(rem), 250); }
  }
  function confirmRemovals(rem) {
    $("#modalRoot").innerHTML = `<div class="modal" id="modal"><article class="card"><div class="chead" style="cursor:default"><div class="name">Are you sure about these parts?</div></div>
      <div class="mbody"><p>These are ticked, but the scan didn't see them. Untick the ones you no longer have.</p>
      <div class="remlist">${rem.map(({ it, u }, i) => `<label class="tgl"><span>${esc(u.full)}${u.group ? ` <span class="sub" style="margin:0">for ${esc(it.n)}</span>` : u.c > 1 ? ` <span class="sub" style="margin:0">${u.i} of ${u.c}</span>` : ""}</span><input type="checkbox" data-rem="${i}" checked></label>`).join("")}</div></div>
      <div class="tourbtns"><button class="chip ghost" data-close>Keep all</button><button class="chip" id="remGo">Untick selected</button></div></article></div>`;
    $("#remGo").addEventListener("click", () => {
      const snap = snapState(); let n = 0;
      document.querySelectorAll("[data-rem]").forEach(c => { if (c.checked) { const { it, u } = rem[+c.dataset.rem]; delete state.ticks[u.id]; clearBuild(it.id); n++; } });
      save(); closeModal(); renderAll();
      if (n) offerUndo(`Unticked ${n} part${n === 1 ? "" : "s"}`, snap);
    });
  }

  if (typeof window !== "undefined") {
    window.runScan = runScan;
    window.cancelScan = () => { cancelled = true; };
    window.__finishMastery = finishMastery; // for tests
  }
  if (typeof module !== "undefined") module.exports = { masteryInFrame, greenBlobs, onLabel, lev, shape, letters, countOf, badgeFor, tierOfWord, relicIndex, relicsInFrame, settleOrder, partIndex, blocksOf, matchPart, partsInFrame, mode };
})();
