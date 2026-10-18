/* ============================================================
   MORSIS — dissolve.js · figure → binary transitions
   Each .scene--transit renders a procedural figure, then — as the
   visitor scrolls — breaks it cell by cell into 0 / 1 glyphs lit
   by the figure's own luminance. A vermilion "burning edge" marks
   the dissolve front; dissolved bits lift away like data leaving
   the specimen.
     Fig. 01  swallow    — ethereal glow in orbit rings
     Fig. 02  spectrogram — a bioacoustic analysis panel
     Fig. 04  emblemSolid — bone emblem; the cursor probes it
   Progress comes from flow.js (MORSIS.onScene.transit) with
   arrive / leave factors for the stacked slide-over flow.
   Optional per-section attributes:
     data-window="a,b"  dissolve range in pinned progress
     data-probe         cursor (or idle drift) opens cells locally
   ============================================================ */

(() => {
  'use strict';

  const sections = Array.from(document.querySelectorAll('.scene--transit'));
  if (!sections.length) return;

  const M = (window.MORSIS = window.MORSIS || {});
  M.onScene = M.onScene || {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const BONE = 'rgb(229, 227, 220)';
  const SIGNAL = 'rgb(255, 72, 0)';
  const FONT = '"Avant Garde", "Century Gothic", sans-serif';

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const span = (r, a, b) => clamp01((r - a) / (b - a));

  // seeded PRNG — procedural figures are identical on every rebuild
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // value noise → ragged, organic dissolve fronts
  const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function label(ctx, text, x, y, dpr, color, align) {
    ctx.save();
    ctx.font = `500 ${Math.round(9.5 * dpr)}px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(1.4 * dpr).toFixed(1)}px`;
    ctx.fillStyle = color || 'rgba(138, 137, 131, 1)';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), x, y);
    ctx.restore();
  }

  /* ---------------- figures ---------------- */
  // Every figure paints on a TRANSPARENT canvas: wherever it is empty (or a
  // cell has been broken into binary) the page's dot grid shows through.

  // the emblem geometry comes from the asset file itself (Assets/Logos/Asset 13.svg)
  let EMBLEM_D = null;
  const EMBLEM_URL = 'Assets/Logos/Asset%2013.svg';

  // Fig. 01 — the dove is a depth map (Assets/Images/tmpycq0cnhz.png): grey =
  // distance, lighter = nearer, transparent background. It gives both the
  // silhouette and the depth the cursor bloom wraps around.
  const DOVE_URL = 'Assets/Images/tmpycq0cnhz.png';
  let DOVE = null;

  // The bird's boundary comes from Assets/Images/Bird shape.svg, a trace of the
  // same dove. Where it sits inside the PNG (fractions of the PNG's size) was
  // found by maximising the overlap of the two silhouettes (IoU 0.97).
  const BIRD_URL = 'Assets/Images/Bird%20shape.svg';
  const BIRD_FIT = { x: 0.0443, y: 0.2230, w: 0.9130, h: 0.6050 };
  let BIRD = null;

  function prepareDove(img) {
    const w = 1264;
    const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    const src = x.getImageData(0, 0, w, h).data;

    let lo = 255, hi = 0, minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < w * h; i++) {
      if (src[i * 4 + 3] > 200) {
        const g = src[i * 4];
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
      if (src[i * 4 + 3] > 8) {
        const px = i % w, py = (i / w) | 0;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
    const lit = new ImageData(w, h), dep = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const a = src[i * 4 + 3];
      if (!a) continue;
      const n = clamp01((src[i * 4] - lo) / Math.max(1, hi - lo));   // 0 far → 1 near
      // the body: bone-white, a little brighter where it is nearer
      const k = 0.46 + 0.4 * n;       // leave headroom for the cursor's light
      lit.data[i * 4] = Math.min(255, 236 * k);
      lit.data[i * 4 + 1] = Math.min(255, 234 * k);
      lit.data[i * 4 + 2] = Math.min(255, 227 * k);
      lit.data[i * 4 + 3] = a;
      // the light catcher: nearer surfaces take more of the bloom
      dep.data[i * 4] = 255; dep.data[i * 4 + 1] = 248; dep.data[i * 4 + 2] = 236;
      dep.data[i * 4 + 3] = a * Math.pow(n, 1.35);
    }
    const toCanvas = (data) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').putImageData(data, 0, 0);
      return cv;
    };
    DOVE = { lit: toCanvas(lit), depth: toCanvas(dep), w, h, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
  }

  // deterministic jitter, shared by the baked waveform and its live highlight
  const jit = (c) => { const s = Math.sin(c * 91.7) * 43758.5453; return s - Math.floor(s); };

  const SOURCES = {
    // Fig. 01 — an ethereal dove inside orbit rings (Solvana-style glow)
    dove(ctx, W, H, dpr) {
      const rand = rng(7);
      const cx = W * 0.5, cy = H * 0.48;

      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, H * 0.66);
      g.addColorStop(0, 'rgba(229, 227, 220, 0.12)');
      g.addColorStop(0.45, 'rgba(229, 227, 220, 0.04)');
      g.addColorStop(1, 'rgba(229, 227, 220, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.lineWidth = Math.max(1, dpr);
      for (let i = 0; i < 4; i++) {
        const r = H * (0.19 + i * 0.085);
        ctx.strokeStyle = `rgba(229, 227, 220, ${(0.15 - i * 0.026).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        const a = rand() * Math.PI * 2;
        ctx.fillStyle = 'rgba(229, 227, 220, 0.7)';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 200; i++) {
        const s = (0.5 + rand() * 1.3) * dpr;
        ctx.fillStyle = `rgba(229, 227, 220, ${(0.1 + rand() * 0.55).toFixed(3)})`;
        ctx.fillRect(rand() * W, rand() * H, s, s);
      }

      if (!DOVE) return { bird: null };
      const b = DOVE.box;
      const s = Math.min((W * 0.8) / b.w, (H * 0.62) / b.h);
      const rect = {
        x: cx - (b.x + b.w / 2) * s,
        y: cy - (b.y + b.h / 2) * s,
        w: DOVE.w * s,
        h: DOVE.h * s,
      };
      // Three layers, so only the bird itself turns to binary:
      //   ctx (src) — rings + dust, stays;  halo — the glow, fades as the bird breaks;
      //   body — the sharp dove, trimmed to the SVG boundary, the only layer that dissolves.
      const layer = () => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        return c;
      };
      const halo = layer(), body = layer();
      const hx = halo.getContext('2d');
      hx.shadowColor = 'rgba(246, 244, 238, 0.9)';
      hx.shadowBlur = 70 * dpr;
      hx.globalAlpha = 0.3;
      hx.drawImage(DOVE.lit, rect.x, rect.y, rect.w, rect.h);
      hx.shadowBlur = 22 * dpr;
      hx.globalAlpha = 0.5;
      hx.drawImage(DOVE.lit, rect.x, rect.y, rect.w, rect.h);

      const bx = body.getContext('2d');
      bx.drawImage(DOVE.lit, rect.x, rect.y, rect.w, rect.h);
      let mask = null;
      if (BIRD) {
        mask = {
          x: rect.x + BIRD_FIT.x * rect.w,
          y: rect.y + BIRD_FIT.y * rect.h,
          w: BIRD_FIT.w * rect.w,
          h: BIRD_FIT.h * rect.h,
        };
        bx.globalCompositeOperation = 'destination-in';
        bx.drawImage(BIRD, mask.x, mask.y, mask.w, mask.h);
      }
      return { bird: rect, mask, halo, body };
    },

    // Fig. 02 — a bioacoustic analysis panel (Raven-style): waveform, intensity
    // spectrogram computed from a modelled song, power spectrum, colour scale,
    // axes. All synthetic. Syllable highlights are drawn live (selectable).
    spectrogram(ctx, W, H, dpr) {
      const rand = rng(11);

      // --- energy field: TW time columns × FH frequency rows ---
      const DUR = 2.4, FMAX = 12000;
      const TW = 720, FH = 240;
      const HZ = FMAX / FH;
      const E = new Float32Array(TW * FH);

      const deposit = (c, f, e, bw) => {
        if (c < 0 || c >= TW || f <= 0 || f >= FMAX) return;
        const row = f / HZ, sig = Math.max(0.8, bw / HZ);
        const r0 = Math.max(0, Math.floor(row - 3 * sig)), r1 = Math.min(FH - 1, Math.ceil(row + 3 * sig));
        for (let r = r0; r <= r1; r++) {
          const d = (r - row) / sig;
          E[c * FH + r] += e * Math.exp(-d * d);
        }
      };

      // every element is logged so the playhead can sound it; syllables keep
      // their fundamental contours so a selection can be redrawn live
      const EVENTS = [];
      const SYLS = [];
      const syl = (name) => { SYLS.push({ name, t0: Infinity, t1: -Infinity, fLo: Infinity, fHi: -Infinity, paths: [], rect: null }); return SYLS.length - 1; };
      const touch = (s, t, f) => {
        s.t0 = Math.min(s.t0, t); s.t1 = Math.max(s.t1, t);
        s.fLo = Math.min(s.fLo, f); s.fHi = Math.max(s.fHi, f);
      };

      // a tonal element: frequency contour f(u), fast attack, softer decay
      const tone = (t0, dur, fFn, amp, opt = {}) => {
        EVENTS.push({ t0, dur, f: fFn(0.5), amp });
        const harm = opt.harm || [1, 0.26, 0.07];
        const bw = opt.bw || 70;
        const c0 = (t0 / DUR) * TW, c1 = ((t0 + dur) / DUR) * TW;
        const steps = Math.max(4, Math.ceil((c1 - c0) * 3));
        const path = [];
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const c = Math.round(c0 + u * (c1 - c0));
          const env = (1 - Math.exp(-u * 22)) * Math.pow(1 - u, 0.55) * amp / 3;
          const f = fFn(u);
          harm.forEach((h, k) => deposit(c, f * (k + 1), env * h, bw * (1 + k * 0.6)));
          path.push([t0 + u * dur, f]);
          if (opt.syl !== undefined) touch(SYLS[opt.syl], t0 + u * dur, f);
        }
        if (opt.syl !== undefined) SYLS[opt.syl].paths.push(path);
      };

      // a buzzy element: band-limited noise with flutter
      const buzz = (t0, dur, lo, hi, amp, sylIdx) => {
        EVENTS.push({ t0, dur, f: (lo + hi) / 2, amp: amp * 0.8 });
        const c0 = Math.round((t0 / DUR) * TW), c1 = Math.round(((t0 + dur) / DUR) * TW);
        for (let c = c0; c <= c1; c++) {
          const u = (c - c0) / Math.max(1, c1 - c0);
          const env = Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(c * 1.7)) * amp;
          for (let r = Math.floor(lo / HZ); r <= Math.ceil(hi / HZ); r++) {
            const edge = Math.min(1, (r * HZ - lo) / 600, (hi - r * HZ) / 600);
            E[c * FH + r] += env * Math.max(0, edge) * (0.25 + 0.75 * rand()) * 0.55;
          }
        }
        const s = SYLS[sylIdx];
        s.rect = { t0, t1: t0 + dur, lo, hi };
        touch(s, t0, lo); touch(s, t0 + dur, hi);
      };

      // the modelled song — eight syllables, plus a distant second bird and wind
      tone(0.08, 0.14, (u) => 5200 + 320 * u, 0.8, { syl: syl('Rising whistle') });
      tone(0.27, 0.13, (u) => 6100 - 220 * u, 0.85, { syl: syl('Falling whistle') });
      const trill = syl('Trill');
      for (let i = 0; i < 9; i++) tone(0.47 + i * 0.05, 0.032, (u) => 7800 - 3600 * Math.pow(u, 0.8), 0.95, { syl: trill });
      buzz(0.99, 0.16, 4200, 8600, 0.5, syl('Buzz'));
      tone(1.21, 0.15, (u) => 3400 + 4800 * Math.pow(u, 1.5), 0.8, { syl: syl('Upsweep') });
      tone(1.43, 0.15, (u) => 5000 + 3600 * Math.sin(Math.PI * u) - 400 * u, 1, { syl: syl('Chevron') });
      const tinks = syl('Tinks');
      for (let i = 0; i < 10; i++) tone(1.65 + i * 0.034, 0.018, () => (i % 2 ? 5600 : 6800), 0.7, { harm: [1, 0.2], syl: tinks });
      tone(2.06, 0.26, (u) => 9200 - 6000 * Math.pow(u, 0.7) + 180 * Math.sin(u * 40), 0.85, { syl: syl('Terminal slur') });
      [0.3, 0.9, 1.5, 2.1].forEach((t) => tone(t, 0.06, () => 3000, 0.18, { harm: [1] }));

      for (let c = 0; c < TW; c++) {
        for (let r = 0; r < FH; r++) {
          const f = r * HZ;
          E[c * FH + r] += 0.2 * Math.exp(-f / 520) * (0.5 + 0.5 * rand()) + 0.03 * rand() * rand();
        }
      }
      // room tail: energy decays rather than stopping dead
      for (let r = 0; r < FH; r++) {
        for (let c = 1; c < TW; c++) {
          const i = c * FH + r, j = (c - 1) * FH + r;
          if (E[j] * 0.86 > E[i]) E[i] = E[j] * 0.86;
        }
      }

      // per-syllable power spectrum (mean energy across its span, log-scaled)
      SYLS.forEach((s) => {
        const c0 = Math.floor((s.t0 / DUR) * TW), c1 = Math.min(TW - 1, Math.ceil((s.t1 / DUR) * TW));
        const ps = new Float32Array(FH);
        let mx = 0;
        for (let r = 0; r < FH; r++) {
          let sum = 0;
          for (let c = c0; c <= c1; c++) sum += E[c * FH + r];
          ps[r] = Math.log(1 + 9 * (sum / (c1 - c0 + 1)));
          mx = Math.max(mx, ps[r]);
        }
        s.ps = ps;
        s.psMax = mx;
      });

      // --- layout (device px) ---
      const narrow = W < H * 0.9;                 // portrait: spectrogram + waveform only
      const L = W * (narrow ? 0.12 : 0.08), R = W * (narrow ? 0.94 : 0.78);
      // lifted a little: the listening bar (play · specimen · upload) sits under the axis
      const oT = H * 0.13, oB = H * 0.215;
      const T = H * 0.265, B = H * (narrow ? 0.6 : 0.69);   // portrait: the bar wraps taller
      const pX0 = W * 0.81, pX1 = W * 0.89;
      const cbX = W * 0.915;
      const fToY = (f) => B - (f / FMAX) * (B - T);
      const tToX = (t) => L + (t / DUR) * (R - L);

      // --- spectrogram image through a bone colour map ---
      const STOPS = [[0, 11, 12, 14], [0.2, 32, 33, 36], [0.42, 94, 93, 89], [0.66, 178, 176, 169], [0.86, 229, 227, 220], [1, 255, 254, 250]];
      const cmap = (v) => {
        for (let i = 1; i < STOPS.length; i++) {
          if (v <= STOPS[i][0]) {
            const a = STOPS[i - 1], b = STOPS[i], k = (v - a[0]) / (b[0] - a[0]);
            return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
          }
        }
        return STOPS[STOPS.length - 1].slice(1);
      };
      const img = new ImageData(TW, FH);
      for (let c = 0; c < TW; c++) {
        for (let r = 0; r < FH; r++) {
          const e = Math.min(1.4, E[c * FH + r]);
          const v = Math.min(1, Math.log(1 + 9 * e) / Math.log(10));        // log (dB-like) compression
          const [cr, cg, cb] = cmap(v);
          const o = ((FH - 1 - r) * TW + c) * 4;
          img.data[o] = cr; img.data[o + 1] = cg; img.data[o + 2] = cb; img.data[o + 3] = 255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = TW; tmp.height = FH;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, L, T, R - L, B - T);

      // --- grid + axes ---
      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeStyle = 'rgba(229, 227, 220, 0.07)';
      ctx.beginPath();
      for (let f = 2000; f < FMAX; f += 2000) { ctx.moveTo(L, fToY(f)); ctx.lineTo(R, fToY(f)); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(229, 227, 220, 0.18)';
      ctx.strokeRect(L, T, R - L, B - T);
      ctx.strokeRect(L, oT, R - L, oB - oT);
      for (let f = 0; f <= FMAX; f += 2000) label(ctx, String(f / 1000), L - 10 * dpr, fToY(f), dpr, null, 'right');
      label(ctx, 'kHz', L - 10 * dpr, T - 14 * dpr, dpr, null, 'right');
      ctx.beginPath();
      for (let t = 0; t <= DUR + 1e-6; t += 0.4) {
        ctx.moveTo(tToX(t), B); ctx.lineTo(tToX(t), B + 5 * dpr);
        label(ctx, t.toFixed(1), tToX(t), B + 16 * dpr, dpr, null, 'center');
      }
      ctx.stroke();
      if (!narrow) label(ctx, 'seconds', R, B + 32 * dpr, dpr, null, 'right');
      label(ctx, 'Waveform', L, oT - 12 * dpr, dpr, 'rgba(229, 227, 220, 0.9)');
      label(ctx, narrow ? 'Spectrogram' : 'Spectrogram · 0–12 kHz · Hann 512', L, T - 14 * dpr, dpr, 'rgba(229, 227, 220, 0.9)');

      // --- waveform (oscillogram) from column energy ---
      const mid = (oT + oB) / 2, half = (oB - oT) / 2 - 2 * dpr;
      const colAmp = new Float32Array(TW);
      let maxA = 0;
      for (let c = 0; c < TW; c++) {
        let s = 0;
        for (let r = Math.floor(1500 / HZ); r < FH; r++) s += E[c * FH + r] * E[c * FH + r];
        colAmp[c] = Math.sqrt(s);
        maxA = Math.max(maxA, colAmp[c]);
      }
      ctx.strokeStyle = 'rgba(229, 227, 220, 0.75)';
      ctx.beginPath();
      for (let c = 0; c < TW; c++) {
        const a = (colAmp[c] / maxA) * half * (0.55 + 0.45 * jit(c));
        const x = L + (c / TW) * (R - L);
        ctx.moveTo(x, mid - a);
        ctx.lineTo(x, mid + a);
      }
      ctx.stroke();

      const meta = { L, R, T, B, oT, oB, mid, half, pX0, pX1, DUR, FMAX, TW, FH, HZ, E, narrow, fToY, tToX,
        colAmp, maxA, syls: SYLS, events: EVENTS.sort((a, b) => a.t0 - b.t0) };
      if (narrow) return meta;                    // no room for the power panel and colour scale

      ctx.strokeStyle = 'rgba(229, 227, 220, 0.18)';
      ctx.strokeRect(pX0, T, pX1 - pX0, B - T);
      label(ctx, 'Power', pX0, T - 14 * dpr, dpr, 'rgba(229, 227, 220, 0.9)');
      label(ctx, 'dB', cbX, T - 14 * dpr, dpr);

      // --- colour scale ---
      const cg = ctx.createLinearGradient(0, B, 0, T);
      STOPS.forEach(([p, r, gg, b]) => cg.addColorStop(p, `rgb(${r},${gg},${b})`));
      ctx.fillStyle = cg;
      ctx.fillRect(cbX, T, 5 * dpr, B - T);
      label(ctx, '0', cbX + 12 * dpr, T + 4 * dpr, dpr);
      label(ctx, '−60', cbX + 12 * dpr, B - 4 * dpr, dpr);
      return meta;
    },

    // Fig. 04 — the emblem as a solid bone specimen, on nothing but the page
    // itself: cells broken out of it reveal exactly the background around it
    emblemSolid(ctx, W, H) {
      if (!EMBLEM_D) return null;
      const fit = Math.min(H * 0.6, W * 0.56) / 96.13;
      ctx.save();
      ctx.translate(W * 0.5 - 49.55 * fit, H * 0.47 - 48.06 * fit);
      ctx.scale(fit, fit);
      ctx.fillStyle = '#e5e3dc';
      ctx.fill(new Path2D(EMBLEM_D));
      ctx.restore();
      return null;
    },
  };

  /* ---------------- one transition ---------------- */

  class Transit {
    constructor(sec) {
      this.sec = sec;
      this.stage = sec.querySelector('.scene__stage');
      this.canvas = sec.querySelector('.transit__canvas');
      this.ctx = this.canvas.getContext('2d');
      this.line = sec.querySelector('.transit__line');
      this.caption = sec.querySelector('.transit__caption');
      this.overlay = sec.querySelectorAll('.frame');
      this.kind = sec.dataset.source;
      this.sweep = sec.dataset.sweep || 'rise';
      const win = (sec.dataset.window || '0.08,0.78').split(',').map(Number);
      this.winA = win[0];
      this.winB = win[1];
      this.r = -1;
      this.arrive = 0;
      this.leave = 0;
      this.drawnR = null;
      this.lastFlick = 0;
      this.visible = false;

      // pointer in device px (spectrogram scrub) and in cells (probe)
      this.pointer = { x: 0, y: 0, on: false, last: 0 };
      const track = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * this.W;
        this.pointer.y = ((e.clientY - rect.top) / rect.height) * this.H;
        this.pointer.on = true;
        this.pointer.last = performance.now();
      };
      this.stage.addEventListener('pointermove', track, { passive: true });
      this.stage.addEventListener('pointerdown', track, { passive: true });
      this.stage.addEventListener('pointerleave', () => { this.pointer.on = false; });

      if (sec.dataset.probe !== undefined) this.probe = { x: null, y: null, vx: 0, vy: 0 };
      if (this.kind === 'spectrogram') {
        this.play = { t: 0, last: 0, loop0: 0, wasRecording: true, sel: 5 };
        // listen once: the Play button drives the playhead through the song a
        // single time with sound, then stops; pause freezes the head in place
        this.audio = { playing: false, paused: false, base: 0, t0: 0 };
        this.bar = sec.querySelector('[data-fig2-bar]');
        this.playBtn = sec.querySelector('[data-fig2-play]');
        this.timeEl = sec.querySelector('[data-fig2-time]');
        if (this.playBtn) this.playBtn.addEventListener('click', () => this.toggleAudio());
        this.hoverSyl = -1;
        this.live = sec.querySelector('[data-fig-live]');
        this.stage.addEventListener('click', () => { if (this.hoverSyl >= 0) this.selectSyl(this.hoverSyl); });
        window.addEventListener('keydown', (e) => {
          if (!this.visible || !this.meta || !this.meta.syls || this.r >= this.winA) return;
          if (e.target.closest && e.target.closest('input, textarea, select, button')) return;
          const n = this.meta.syls.length;
          if (e.key === 'ArrowRight') { this.selectSyl((this.play.sel + 1) % n); e.preventDefault(); }
          if (e.key === 'ArrowLeft') { this.selectSyl((this.play.sel + n - 1) % n); e.preventDefault(); }
        });
      }

      this.build();
      new IntersectionObserver((en) => {
        this.visible = en[0].isIntersecting;
        if (this.visible) this.drawnR = null;
      }).observe(sec);
    }

    build() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const W = Math.max(2, Math.round(this.stage.clientWidth * dpr));
      const H = Math.max(2, Math.round(this.stage.clientHeight * dpr));
      this.canvas.width = W;
      this.canvas.height = H;
      Object.assign(this, { W, H, dpr });

      this.src = document.createElement('canvas');
      this.src.width = W;
      this.src.height = H;
      this.meta = (SOURCES[this.kind] || SOURCES.dove)(this.src.getContext('2d'), W, H, dpr) || null;
      // a figure with its own body layer dissolves only that body
      this.body = (this.meta && this.meta.body) || null;
      this.halo = (this.meta && this.meta.halo) || null;

      const cell = Math.max(8, Math.round(12 * dpr));
      const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
      const sm = document.createElement('canvas');
      sm.width = cols;
      sm.height = rows;
      const sx = sm.getContext('2d', { willReadFrequently: true });
      sx.drawImage(this.body || this.src, 0, 0, cols, rows);
      const data = sx.getImageData(0, 0, cols, rows).data;

      // per-cell coverage of the SVG boundary: cells outside it never break
      let cover = null;
      const mk = this.meta && this.meta.mask;
      if (mk && BIRD) {
        sx.clearRect(0, 0, cols, rows);
        sx.drawImage(BIRD, mk.x / cell, mk.y / cell, mk.w / cell, mk.h / cell);
        const md = sx.getImageData(0, 0, cols, rows).data;
        cover = new Float32Array(cols * rows);
        for (let i = 0; i < cover.length; i++) cover[i] = md[i * 4 + 3] / 255;
      }

      const n = cols * rows;
      const lum = new Float32Array(n), thr = new Float32Array(n), spd = new Float32Array(n), seed = new Float32Array(n);
      const rand = rng(n + this.kind.length * 97);
      const aspect = rows / cols;
      for (let i = 0; i < n; i++) {
        const gx = i % cols, gy = (i / cols) | 0;
        const u = gx / Math.max(1, cols - 1), v = gy / Math.max(1, rows - 1);
        lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
        seed[i] = rand();
        let sweep;
        if (this.sweep === 'scan') sweep = u;
        else if (this.sweep === 'radial') sweep = Math.min(1, Math.hypot(u - 0.5, (v - 0.48) * aspect) / 0.62);
        else sweep = 1 - v;   // rise: the figure breaks from the bottom up
        thr[i] = clamp01(sweep * 0.72 + vnoise(gx / 7, gy / 7) * 0.18 + seed[i] * 0.1);
        spd[i] = 0.6 + rand() * 0.8;
        if (cover) {
          if (cover[i] < 0.02) { thr[i] = 9; lum[i] = 0; }      // outside the bird: untouched
          else if (cover[i] < 0.35) lum[i] = 0;                 // rim: cleared, but carries no digit
        }
      }
      Object.assign(this, { cell, cols, rows, lum, thr, spd, seed, cover });

      // probe physics: every cell is a particle with a spring to its home
      if (this.probe) {
        this.ox = new Float32Array(n); this.oy = new Float32Array(n);
        this.vx = new Float32Array(n); this.vy = new Float32Array(n);
        this.heat = new Float32Array(n);
        this.probe.x = null;
      }
      this.drawnR = null;
    }

    bit(i, t) {
      const s = this.seed[i];
      const k = Math.floor(t * (0.5 + s * 1.8) + s * 13);
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x) < 0.5 ? '0' : '1';
    }

    // called by flow.js: r = pinned progress, arrive/leave = slide-in / cover factors
    set(r, f) {
      this.r = r;
      this.arrive = f ? f.arrive : clamp01(1 + r);
      this.leave = f ? f.leave : 0;
      // arrival fades inside draw() (its `fade`); a CSS blur on the full-screen
      // canvas used to sit on top of that and re-filtered every frame
      const appear = smooth(this.arrive);
      // Fig. 02's listening bar lives and leaves with the analysis panel
      if (this.bar) {
        const bk = smooth(span(this.arrive, 0.6, 1)) * (1 - smooth(span(r, this.winA - 0.08, this.winA - 0.01)));
        this.bar.style.opacity = bk.toFixed(3);
        this.bar.style.transform = `translate(-50%, ${((1 - bk) * 14).toFixed(1)}px)`;
        this.bar.classList.toggle('is-hidden', bk < 0.5);
        if (bk < 0.5 && this.audio && this.audio.playing) this.pauseAudio();
      }
      // the closing line holds until the next section is rising into view
      const lineK = smooth(span(r, this.winA + 0.16, this.winA + 0.3)) * (1 - smooth(span(this.leave, 0.05, 0.55)));
      if (this.line) {
        this.line.style.opacity = lineK.toFixed(3);
        if (!reduced) this.line.style.transform = `translateY(${((1 - lineK) * 24).toFixed(1)}px)`;
      }
      // the plate label leaves with the scene (flow.js fades the stage as the
      // next section slides in), not before it — no empty beat in between
      const chrome = (appear * (1 - smooth(this.leave))).toFixed(3);
      if (this.caption) this.caption.style.opacity = chrome;
      this.overlay.forEach((el) => { el.style.opacity = chrome; });
    }

    /* ---- Fig. 04: cursor (or idle drift) pushes cells; springs pull them home ---- */
    stepPhysics(now) {
      const p = this.probe;
      const { cols, rows, lum, seed, ox, oy, vx, vy, heat } = this;
      let driving = false;
      if (this.r < this.winB + 0.05) {
        const user = this.pointer.on && now - this.pointer.last < 2500;
        let tx, ty;
        if (user) {
          tx = this.pointer.x / this.cell;
          ty = this.pointer.y / this.cell;
        } else {
          const t = now / 1000;
          tx = cols * (0.5 + 0.2 * Math.cos(t * 0.45));
          ty = rows * (0.47 + 0.2 * Math.sin(t * 0.7));
        }
        if (p.x === null) { p.x = tx; p.y = ty; }
        const x0 = p.x, y0 = p.y;
        p.x += (tx - p.x) * (user ? 0.35 : 0.05);
        p.y += (ty - p.y) * (user ? 0.35 : 0.05);
        p.vx = p.x - x0;
        p.vy = p.y - y0;
        driving = !reduced;
      }

      const RI = 8.5, RI2 = RI * RI;           // influence radius, in cells
      const PUSH = 0.14, DRAG = 0.38, K = 0.055, DAMP = 0.85;
      let live = driving;
      for (let i = 0; i < lum.length; i++) {
        if (lum[i] < 0.05) continue;
        let ax = 0, ay = 0;
        if (driving) {
          const dx = (i % cols) + 0.5 - p.x, dy = ((i / cols) | 0) + 0.5 - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < RI2) {
            const d = Math.sqrt(d2) + 0.001;
            const f = 1 - d / RI, f2 = f * f;
            // radial scatter, slightly swirled per cell, plus drag along the cursor's motion
            const j = (seed[i] - 0.5) * 0.9;
            const ux = dx / d, uy = dy / d;
            const rx = ux * Math.cos(j) - uy * Math.sin(j), ry = ux * Math.sin(j) + uy * Math.cos(j);
            ax = rx * f2 * PUSH + p.vx * f2 * DRAG;
            ay = ry * f2 * PUSH + p.vy * f2 * DRAG;
            if (f2 * 1.4 > heat[i]) heat[i] = f2 * 1.4;
          }
        }
        if (heat[i] < 0.004 && ax === 0 && Math.abs(ox[i]) < 0.01 && Math.abs(oy[i]) < 0.01) continue;
        vx[i] = (vx[i] + ax - ox[i] * K) * DAMP;
        vy[i] = (vy[i] + ay - oy[i] * K) * DAMP;
        ox[i] += vx[i];
        oy[i] += vy[i];
        heat[i] *= 0.965;
        live = true;
      }
      return live;
    }

    /* ---- Fig. 02: which syllable is under the pointer (device px) ---- */
    sylAt(x, y) {
      const m = this.meta;
      if (!m || !m.syls) return -1;
      const pad = 10 * this.dpr;
      for (let i = 0; i < m.syls.length; i++) {
        const s = m.syls[i];
        if (x >= m.tToX(s.t0) - pad && x <= m.tToX(s.t1) + pad &&
            y >= m.fToY(s.fHi) - pad && y <= m.fToY(s.fLo) + pad) return i;
      }
      return -1;
    }

    selectSyl(i) {
      const m = this.meta;
      if (!m || !m.syls || i < 0 || i >= m.syls.length) return;
      this.play.sel = i;
      const s = m.syls[i];
      if (this.live) {
        this.live.textContent = `Syllable ${i + 1} of ${m.syls.length}: ${s.name}, peak ${(s.fHi / 1000).toFixed(2)} kilohertz, ${Math.round((s.t1 - s.t0) * 1000)} milliseconds.`;
      }
      // choosing a syllable plays it (a click or key press is the visitor's own act)
      if (M.playAvianFrequency) {
        if (M.ensureAudio) M.ensureAudio();
        m.events.filter((ev) => ev.t0 >= s.t0 - 0.001 && ev.t0 <= s.t1)
          .forEach((ev) => setTimeout(() => M.playAvianFrequency(ev.f, Math.max(40, ev.dur * 1000), ev.amp, 'fig2', { force: true }), (ev.t0 - s.t0) * 1000));
      }
    }

    /* ---- Fig. 02: listen once (play / pause) ---- */
    toggleAudio() {
      const a = this.audio;
      if (a.playing) { this.pauseAudio(); return; }
      if (M.ensureAudio) M.ensureAudio();          // inside the click: autoplay rules allow it
      if (!a.paused) a.base = 0;                   // a fresh play starts at the top
      a.playing = true;
      a.paused = false;
      a.t0 = performance.now();
      this.play.t = a.base - 0.0001;               // so an event at the very start still sounds
      this.syncPlayBtn();
    }
    pauseAudio() {
      const a = this.audio;
      if (!a.playing) return;
      a.base = Math.min(this.meta.DUR, a.base + (performance.now() - a.t0) / 1000);
      a.playing = false;
      a.paused = true;
      this.syncPlayBtn();
    }
    endAudio() {
      Object.assign(this.audio, { playing: false, paused: false, base: 0 });
      this.syncPlayBtn();
    }
    syncPlayBtn() {
      if (!this.playBtn) return;
      const on = this.audio.playing;
      this.playBtn.setAttribute('aria-pressed', String(on));
      this.playBtn.setAttribute('aria-label', on ? 'Pause the song' : 'Play the song');
    }

    /* ---- Fig. 02: recording reveal, playhead, scrub, selectable syllables ---- */
    drawAnalysis(now, fade) {
      const m = this.meta, pl = this.play;
      const { ctx, dpr } = this;
      const r = this.r;
      const k = fade * (1 - smooth(span(r, this.winA - 0.06, this.winA + 0.02)));
      if (k < 0.01) { this.stage.style.cursor = ''; return; }

      // the figure records in from the left as the stage arrives
      const rev = this.arrive < 1 ? 0.75 * smooth(span(this.arrive, 0.25, 1)) : 0.75 + 0.25 * span(r, 0, 0.08);
      const recording = rev < 0.999;
      const pr = this.pointer;
      const inPlot = !recording && pr.on && pr.x >= m.L - 12 * dpr && pr.x <= m.R + 12 * dpr && pr.y >= m.oT && pr.y <= m.B + 12 * dpr;
      const hoverSyl = inPlot ? this.sylAt(pr.x, pr.y) : -1;
      this.hoverSyl = hoverSyl;
      this.stage.style.cursor = hoverSyl >= 0 && hoverSyl !== pl.sel ? 'pointer' : (inPlot ? 'crosshair' : '');
      const scrub = inPlot && pr.x >= m.L && pr.x <= m.R;

      const au = this.audio;
      // leaving the figure pauses the song (it is only ever heard here)
      if (au.playing && (recording || !(M.audibleHere && M.audibleHere('fig2')))) this.pauseAudio();

      let t;
      const sounding = au.playing;               // captured before a last frame ends the run
      if (au.playing) {
        // listening: the song's own clock drives the head, once through
        t = au.base + (now - au.t0) / 1000;
        if (t >= m.DUR) { t = m.DUR; this.endAudio(); }
      } else if (au.paused) {
        t = au.base;                               // paused: the head waits where it stopped
      } else if (recording) {
        t = rev * m.DUR;
        pl.wasRecording = true;
      } else if (scrub) {
        t = ((pr.x - m.L) / (m.R - m.L)) * m.DUR;
      } else {
        if (pl.wasRecording) { pl.loop0 = now; pl.wasRecording = false; }
        const cyc = ((now - pl.loop0) / 1000) % (m.DUR + 1.2);
        t = Math.min(m.DUR, cyc);
      }

      // sound each element as the head crosses it — only while Play is running
      if (sounding) {
        m.events.forEach((ev) => {
          if (ev.t0 > pl.t && ev.t0 <= t) M.playAvianFrequency(ev.f, Math.max(40, ev.dur * 1000), ev.amp, 'fig2', { force: true });
        });
      }
      pl.t = t;
      if (this.playBtn) {
        const p = au.playing || au.paused ? t / m.DUR : 0;
        this.playBtn.style.setProperty('--p', p.toFixed(4));
        if (this.timeEl) this.timeEl.textContent = `${(au.playing || au.paused ? t : 0).toFixed(1).padStart(4, '0')} / 02.4 s`;
      }

      const x = m.tToX(t);
      ctx.save();
      ctx.globalAlpha = k;

      if (recording) {
        // unrecorded region stays dark, inside both plot frames
        ctx.fillStyle = '#0b0c0e';
        ctx.fillRect(x, m.oT + dpr, m.R - x - dpr, m.oB - m.oT - 2 * dpr);
        ctx.fillRect(x, m.T + dpr, m.R - x - dpr, m.B - m.T - 2 * dpr);
      }

      // --- the selected syllable: contour, waveform segment, brackets, label ---
      const sel = m.syls[pl.sel];
      if (sel && (!recording || m.tToX(sel.t1) <= x)) {
        // waveform segment in vermilion (same deterministic jitter as the baked trace)
        ctx.strokeStyle = 'rgba(255, 72, 0, 0.95)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        const c0 = Math.floor((sel.t0 / m.DUR) * m.TW), c1 = Math.ceil((sel.t1 / m.DUR) * m.TW);
        for (let c = c0; c <= c1 && c < m.TW; c++) {
          const a = (m.colAmp[c] / m.maxA) * m.half * (0.55 + 0.45 * jit(c));
          const cx = m.L + (c / m.TW) * (m.R - m.L);
          ctx.moveTo(cx, m.mid - a);
          ctx.lineTo(cx, m.mid + a);
        }
        ctx.stroke();

        // the syllable itself, traced over the spectrogram
        ctx.save();
        ctx.shadowColor = 'rgba(255, 72, 0, 0.9)';
        ctx.shadowBlur = 10 * dpr;
        ctx.strokeStyle = 'rgba(255, 72, 0, 0.95)';
        ctx.lineWidth = 2.2 * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (sel.rect) {
          const rx = m.tToX(sel.rect.t0), ry = m.fToY(sel.rect.hi);
          ctx.fillStyle = 'rgba(255, 72, 0, 0.16)';
          ctx.fillRect(rx, ry, m.tToX(sel.rect.t1) - rx, m.fToY(sel.rect.lo) - ry);
        }
        sel.paths.forEach((path) => {
          ctx.beginPath();
          path.forEach(([pt, pf], i) => (i ? ctx.lineTo(m.tToX(pt), m.fToY(pf)) : ctx.moveTo(m.tToX(pt), m.fToY(pf))));
          ctx.stroke();
        });
        ctx.restore();

        const bx0 = m.tToX(sel.t0) - 8 * dpr, bx1 = m.tToX(sel.t1) + 8 * dpr;
        const by0 = m.fToY(sel.fHi) - 10 * dpr, by1 = m.fToY(sel.fLo) + 8 * dpr;
        const cl = 9 * dpr;
        ctx.strokeStyle = 'rgba(255, 72, 0, 0.95)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        [[bx0, by0, 1, 1], [bx1, by0, -1, 1], [bx0, by1, 1, -1], [bx1, by1, -1, -1]]
          .forEach(([bx, by, sx, sy]) => { ctx.moveTo(bx + sx * cl, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + sy * cl); });
        ctx.stroke();
        const n = String(pl.sel + 1).padStart(2, '0');
        const ms = Math.round((sel.t1 - sel.t0) * 1000);
        label(ctx, m.narrow ? `Syl.${n} · ${(sel.fHi / 1000).toFixed(2)} kHz` : `Syl.${n} · ${sel.name} · peak ${(sel.fHi / 1000).toFixed(2)} kHz · ${ms} ms`,
          Math.min(bx0, m.R - 300 * dpr), by0 - 11 * dpr, dpr, 'rgba(255, 72, 0, 1)');

        // its power spectrum in the side panel
        if (!m.narrow && sel.ps) {
          const pts = [];
          for (let row = 0; row < m.FH; row++) pts.push([m.pX0 + (sel.ps[row] / sel.psMax) * (m.pX1 - m.pX0) * 0.94, m.fToY(row * m.HZ)]);
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.lineTo(m.pX0, m.fToY(m.FMAX)); ctx.lineTo(m.pX0, m.B); ctx.closePath();
          ctx.fillStyle = 'rgba(255, 72, 0, 0.14)';
          ctx.fill();
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.strokeStyle = 'rgba(255, 72, 0, 0.95)';
          ctx.lineWidth = 1.4 * dpr;
          ctx.stroke();
          label(ctx, `Syl.${n}`, m.pX1, m.B + 16 * dpr, dpr, 'rgba(255, 72, 0, 1)', 'right');
        }
      }

      // a different syllable under the pointer: a quiet dashed preview
      if (hoverSyl >= 0 && hoverSyl !== pl.sel) {
        const s = m.syls[hoverSyl];
        const bx0 = m.tToX(s.t0) - 8 * dpr, bx1 = m.tToX(s.t1) + 8 * dpr;
        const by0 = m.fToY(s.fHi) - 10 * dpr, by1 = m.fToY(s.fLo) + 8 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.strokeStyle = 'rgba(236, 234, 228, 0.8)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
        ctx.setLineDash([]);
        label(ctx, `Syl.${String(hoverSyl + 1).padStart(2, '0')} · click to analyse`, bx0, by1 + 12 * dpr, dpr, 'rgba(236, 234, 228, 0.95)');
      }

      // playhead: a vermilion line through waveform and spectrogram, with a soft wake
      const wake = ctx.createLinearGradient(x - 40 * dpr, 0, x, 0);
      wake.addColorStop(0, 'rgba(255, 72, 0, 0)');
      wake.addColorStop(1, 'rgba(255, 72, 0, 0.12)');
      ctx.fillStyle = wake;
      ctx.fillRect(x - 40 * dpr, m.oT, 40 * dpr, m.oB - m.oT);
      ctx.fillRect(x - 40 * dpr, m.T, 40 * dpr, m.B - m.T);
      ctx.strokeStyle = 'rgba(255, 72, 0, 0.95)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, m.oT - 4 * dpr); ctx.lineTo(x, m.oB);
      ctx.moveTo(x, m.T); ctx.lineTo(x, m.B + 4 * dpr);
      ctx.stroke();
      label(ctx, `${t.toFixed(2)} s`, x + 6 * dpr, m.oT + 10 * dpr, dpr, 'rgba(255, 72, 0, 1)');

      // live spectrum slice at the playhead
      const c = Math.min(m.TW - 1, Math.max(0, Math.round((t / m.DUR) * (m.TW - 1))));
      if (!m.narrow) {
        let mx = 0;
        const sl = new Float32Array(m.FH);
        for (let row = 0; row < m.FH; row++) {
          sl[row] = Math.log(1 + 9 * Math.min(1.4, m.E[c * m.FH + row])) / Math.log(10);
          mx = Math.max(mx, sl[row]);
        }
        ctx.strokeStyle = 'rgba(236, 234, 228, 0.9)';
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        for (let row = 0; row < m.FH; row++) {
          const px = m.pX0 + (sl[row] / Math.max(0.2, mx)) * (m.pX1 - m.pX0) * 0.94, py = m.fToY(row * m.HZ);
          row ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
        label(ctx, 'Live', m.pX0, m.B + 16 * dpr, dpr, 'rgba(236, 234, 228, 0.95)');
      }

      // hover crosshair + reading (over the spectrogram body)
      if (scrub && pr.y >= m.T && pr.y <= m.B) {
        const f = ((m.B - pr.y) / (m.B - m.T)) * m.FMAX;
        const row = Math.min(m.FH - 1, Math.max(0, Math.round(f / m.HZ)));
        const v = Math.log(1 + 9 * Math.min(1.4, m.E[c * m.FH + row])) / Math.log(10);
        const db = Math.round(-60 * (1 - Math.min(1, v)));
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.strokeStyle = 'rgba(236, 234, 228, 0.45)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(m.L, pr.y); ctx.lineTo(m.R, pr.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const text = `${t.toFixed(2)} s · ${(f / 1000).toFixed(2)} kHz · ${db} dB`;
        ctx.font = `500 ${Math.round(9.5 * dpr)}px ${FONT}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${(1.4 * dpr).toFixed(1)}px`;
        const w = ctx.measureText(text.toUpperCase()).width + 16 * dpr;
        const bx = Math.min(m.R - w, pr.x + 12 * dpr), by = Math.max(m.T + 4 * dpr, pr.y - 30 * dpr);
        ctx.fillStyle = 'rgba(11, 12, 14, 0.88)';
        ctx.fillRect(bx, by, w, 22 * dpr);
        ctx.strokeStyle = 'rgba(255, 72, 0, 0.7)';
        ctx.strokeRect(bx, by, w, 22 * dpr);
        label(ctx, text, bx + 8 * dpr, by + 11 * dpr, dpr, 'rgba(236, 234, 228, 1)');
      }
      if (!recording) {
        label(ctx, m.narrow ? 'Tap a syllable · drag to scrub' : 'Click a syllable to analyse it · ← → to step · hover to scrub',
          m.R, m.oT - 12 * dpr, dpr, 'rgba(255, 72, 0, 0.95)', 'right');
      }
      ctx.restore();
    }

    /* ---- Fig. 01: a slow, soft wingbeat. The body and tail hold still; the
            wings lift and fall from the shoulder line, foreshortening slightly
            at the top of the stroke. It settles before the dove breaks apart. ---- */
    flapState(now) {
      const mk = this.meta && this.meta.mask;
      if (!mk || reduced) return null;
      const k = 1 - smooth(span(this.r, this.winA - 0.08, this.winA + 0.01));
      if (k < 0.01) return null;
      const th = (now / 1000) * ((Math.PI * 2) / 2.8);           // one beat every 2.8 s
      const wave = (Math.sin(th) + 0.22 * Math.sin(2 * th)) / 1.1;   // quicker downstroke
      return {
        cx: mk.x + mk.w / 2,
        half: mk.w / 2,
        pivot: mk.y + mk.h * 0.3,                                   // the wing roots
        amp: mk.h * 0.06 * k,                                       // ~6% of the bird's height
        wave,
        x0: mk.x - 160 * this.dpr,
        x1: mk.x + mk.w + 160 * this.dpr,                           // incl. the glow past the tips
      };
    }

    // draw `img` (source rect → dest rect) in vertical strips, each lifted by the wingbeat
    // Strips meet on whole pixels with no overlap (an overlap shows as bright
    // seams under the additive bloom), and the still middle is drawn in one piece.
    warp(img, fl, sx, sy, sw, sh, dx, dy, dw, dh) {
      const ctx = this.ctx;
      const N = 96;
      const kx = sw / dw;
      let runA = -1;                                    // start of a run of unmoved strips
      const flush = (xb) => {
        if (runA < 0 || xb <= runA) return;
        ctx.drawImage(img, sx + (runA - dx) * kx, sy, (xb - runA) * kx, sh, runA, dy, xb - runA, dh);
        runA = -1;
      };
      for (let i = 0; i < N; i++) {
        const xa = Math.round(dx + (dw * i) / N), xb = Math.round(dx + (dw * (i + 1)) / N);
        if (xb <= xa) continue;
        const s = clamp01((Math.abs((xa + xb) / 2 - fl.cx) / fl.half - 0.2) / 0.8);
        const w = Math.pow(s, 1.6);
        if (w < 1e-4) { if (runA < 0) runA = xa; continue; }
        flush(xa);
        const lift = fl.amp * fl.wave * w;
        const squash = 1 - 0.05 * w * Math.abs(fl.wave);
        const h2 = dh * squash;
        const y2 = dy + (fl.pivot - dy) * (1 - squash) - lift;
        ctx.drawImage(img, sx + (xa - dx) * kx, sy, (xb - xa) * kx, sh, xa, y2, xb - xa, h2);
      }
      flush(Math.round(dx + dw));
    }

    // a full-canvas layer: only the bird's band is warped (the rest is empty)
    warpLayer(img, fl) {
      const x0 = Math.max(0, fl.x0), x1 = Math.min(this.W, fl.x1);
      this.warp(img, fl, x0, 0, x1 - x0, this.H, x0, 0, x1 - x0, this.H);
    }

    /* ---- Fig. 01: a soft bloom that follows the cursor across the dove,
            weighted by the depth map so the nearest surfaces catch the most ---- */
    drawBloom(now, fade, fl) {
      const m = this.meta, b = m && m.bird;
      if (!b || !DOVE) return;
      const { ctx, dpr } = this;
      const k = fade * (1 - smooth(span(this.r, this.winA - 0.04, this.winA + 0.08)));
      if (k < 0.01) return;

      // light position: the cursor, or a slow idle orbit around the body
      const pr = this.pointer;
      const user = pr.on && now - pr.last < 2500;
      const tt = now / 1000;
      const tx = user ? pr.x : b.x + b.w * (0.5 + 0.22 * Math.cos(tt * 0.45));
      const ty = user ? pr.y : b.y + b.h * (0.45 + 0.18 * Math.sin(tt * 0.7));
      const L = this.light || (this.light = { x: tx, y: ty });
      L.x += (tx - L.x) * (user ? 0.18 : 0.05);
      L.y += (ty - L.y) * (user ? 0.18 : 0.05);

      // bloom buffer at half resolution — the light is soft, so it scales cleanly
      const bw = Math.max(2, Math.round(b.w / 2)), bh = Math.max(2, Math.round(b.h / 2));
      if (!this.bloom || this.bloom.width !== bw || this.bloom.height !== bh) {
        this.bloom = document.createElement('canvas');
        this.bloom.width = bw;
        this.bloom.height = bh;
      }
      const g = this.bloom.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, bw, bh);
      const lx = ((L.x - b.x) / b.w) * bw, ly = ((L.y - b.y) / b.h) * bh;
      const R = Math.max(bw, bh) * 0.34;
      const rg = g.createRadialGradient(lx, ly, 0, lx, ly, R);
      rg.addColorStop(0, 'rgba(255, 249, 238, 1)');
      rg.addColorStop(0.35, 'rgba(255, 244, 226, 0.5)');
      rg.addColorStop(1, 'rgba(255, 244, 226, 0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, bw, bh);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(DOVE.depth, 0, 0, bw, bh);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k * 0.7;
      if (fl) this.warp(this.bloom, fl, 0, 0, bw, bh, b.x, b.y, b.w, b.h);
      else ctx.drawImage(this.bloom, b.x, b.y, b.w, b.h);
      // the halo: the same light, softened by shrinking it 8× and scaling it back up
      // (bilinear upscaling is a near-free blur; ctx.filter blur cost a frame on its own)
      const S = 8, pad = 3;
      const hw = Math.max(2, Math.round(b.w / S)) + pad * 2, hh = Math.max(2, Math.round(b.h / S)) + pad * 2;
      if (!this.halo2 || this.halo2.width !== hw || this.halo2.height !== hh) {
        this.halo2 = document.createElement('canvas');
        this.halo2.width = hw;
        this.halo2.height = hh;
      }
      const hg = this.halo2.getContext('2d');
      hg.clearRect(0, 0, hw, hh);
      hg.drawImage(this.bloom, pad, pad, hw - pad * 2, hh - pad * 2);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = k * 0.5;
      if (fl) this.warp(this.halo2, fl, 0, 0, hw, hh, b.x - pad * S, b.y - pad * S, hw * S, hh * S);
      else ctx.drawImage(this.halo2, b.x - pad * S, b.y - pad * S, hw * S, hh * S);
      // a faint glow in the air around the light itself
      const air = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, 120 * dpr);
      air.addColorStop(0, 'rgba(255, 246, 232, 0.08)');
      air.addColorStop(1, 'rgba(255, 246, 232, 0)');
      ctx.globalAlpha = k;
      ctx.fillStyle = air;
      ctx.fillRect(L.x - 120 * dpr, L.y - 120 * dpr, 240 * dpr, 240 * dpr);
      ctx.restore();
    }

    draw(now) {
      if (!this.visible) {
        if (this.audio && this.audio.playing) this.pauseAudio();   // never keeps playing off screen
        return;
      }
      const r = this.r;
      const front = span(r, this.winA, this.winB) * 1.3;   // overshoots so every cell resolves
      const live = front > 0 && front < 1.75;
      const physics = this.probe ? this.stepPhysics(now) : false;
      const analysis = this.meta && this.meta.syls && r < this.winB + 0.02;
      const bloom = this.meta && this.meta.bird && r < this.winA + 0.1;

      const flick = (live || physics) && now - this.lastFlick > 110;
      if (r === this.drawnR && !flick && !physics && !analysis && !bloom) return;
      if (flick) this.lastFlick = now;
      this.drawnR = r;

      const { ctx, W, H, cell, cols, lum, thr, spd } = this;
      const n = lum.length;
      // no self fade-out: the last digits are still burning off as the next
      // section arrives, and the stage fade in flow.js carries them away
      const fade = smooth(this.arrive);
      const ox = this.ox, oy = this.oy, heat = this.heat;
      const broken = (i) => ox && (heat[i] > 0.12 || Math.abs(ox[i]) + Math.abs(oy[i]) > 0.35);

      const fl = this.body ? this.flapState(now) : null;   // Fig. 01's wingbeat

      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = fade;
      if (fl) this.warpLayer(this.body, fl);
      else ctx.drawImage(this.body || this.src, 0, 0);
      ctx.globalAlpha = 1;

      // punch dissolved / displaced cells out of the figure
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      let any = false;
      // cells the probe only disturbs are eroded with round, fully cleared dots
      // that grow with how far the cell moved: the hole's rim is a porous dot
      // edge, not square steps or half-erased grey
      const soft = this.probe ? [] : null;
      for (let i = 0; i < n; i++) {
        if (thr[i] < front) {
          ctx.rect((i % cols) * cell, ((i / cols) | 0) * cell, cell, cell);
          any = true;
        } else if (lum[i] > 0.05 && broken(i)) {
          soft.push(i);
          any = true;
        }
      }
      if (any) ctx.fill();
      if (soft && soft.length) {
        ctx.beginPath();
        for (const i of soft) {
          const amt = clamp01(heat[i] * 1.4 + (Math.abs(ox[i]) + Math.abs(oy[i])) * 0.4);
          if (amt < 0.2) continue;
          const rad = cell * (0.3 + 0.48 * amt);
          const x = (i % cols) * cell + cell / 2, y = ((i / cols) | 0) * cell + cell / 2;
          ctx.moveTo(x + rad, y);
          ctx.arc(x, y, rad, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      if (this.body) {
        // slide the glow and the backdrop in beneath the (now holed) body; the
        // glow dims as the bird breaks, so no empty halo is left behind
        ctx.globalCompositeOperation = 'destination-over';
        ctx.globalAlpha = fade * (1 - smooth(clamp01(front / 1.1)));
        if (ctx.globalAlpha > 0.005) {
          if (fl) this.warpLayer(this.halo, fl);
          else ctx.drawImage(this.halo, 0, 0);
        }
        ctx.globalAlpha = fade;
        ctx.drawImage(this.src, 0, 0);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';

      if (any) {
        ctx.font = `500 ${Math.round(cell * 0.9)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const t = now / 1000;
        let style = '';
        for (let i = 0; i < n; i++) {
          const L = lum[i];
          let age = front - thr[i];
          let edge, a;
          const bx = ox ? ox[i] * cell : 0, by = oy ? oy[i] * cell : 0;
          if (age > 0) {
            // the burning front: full on the figure, a sparse sprinkle across empty dark
            edge = age < 0.035 && (L > 0.05 || (!this.cover && this.seed[i] < 0.22));
            if (L < 0.035 && !edge) continue;
            a = Math.min(1, 0.22 + L * 1.5) * (1 - smooth(clamp01((age - 0.28) / 0.5))) * fade;
          } else if (L > 0.05 && broken(i)) {
            // displaced by the probe: fast cells burn vermilion, settling ones cool to bone
            age = 0;
            const sp = Math.abs(this.vx[i]) + Math.abs(this.vy[i]);
            edge = sp > 0.35;
            a = Math.min(1, 0.25 + L * 1.5) * clamp01(heat[i] * 2.5 + (Math.abs(ox[i]) + Math.abs(oy[i])) * 0.4) * fade;
          } else continue;
          // a bounded figure keeps its digits inside its outline: they fade in place
          const lift = reduced || this.cover ? 0 : Math.max(0, age - 0.2);
          const travel = lift * lift * H * 0.8 * spd[i];
          let dx = 0, dy = -travel;                 // rise: digits drift upward
          if (this.sweep === 'radial' && travel > 0) {
            // radial: digits spread outward from the centre, like the vermilion front
            const px = (i % cols) * cell + cell / 2 - W * 0.5;
            const py = ((i / cols) | 0) * cell + cell / 2 - H * 0.48;
            const d = Math.hypot(px, py) || 1;
            dx = (px / d) * travel;
            dy = (py / d) * travel;
          }
          if (a < 0.02) continue;
          const want = edge ? SIGNAL : BONE;
          if (want !== style) { ctx.fillStyle = want; style = want; }
          ctx.globalAlpha = edge ? Math.max(a, 0.85 * fade) : a;
          ctx.fillText(L < 0.09 && !edge ? '.' : this.bit(i, t),
            (i % cols) * cell + cell / 2 + bx + dx, ((i / cols) | 0) * cell + cell / 2 + dy + by);
        }
        ctx.globalAlpha = 1;
      }

      if (analysis) this.drawAnalysis(now, fade);
      if (bloom) this.drawBloom(now, fade, fl);
    }
  }

  /* ---------------- wiring ---------------- */

  const transits = sections.map((sec) => new Transit(sec));
  const bySection = new Map(transits.map((t) => [t.sec, t]));

  M.onScene.transit = (r, sec, f) => {
    const t = bySection.get(sec);
    if (t) t.set(r, f);
  };

  function loop(now) {
    transits.forEach((t) => t.draw(now));
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => transits.forEach((t) => t.build()), 180);
  });

  // canvas text needs Avant Garde loaded before the figures are baked
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => transits.forEach((t) => t.build()));
  }

  // the dove and its SVG boundary: rebuild Fig. 01 as each arrives
  const rebuildDove = () => transits.filter((t) => t.kind === 'dove').forEach((t) => t.build());
  const doveImg = new Image();
  doveImg.onload = () => {
    prepareDove(doveImg);
    rebuildDove();
  };
  doveImg.src = DOVE_URL;
  const birdImg = new Image();
  birdImg.onload = () => {
    BIRD = birdImg;
    if (DOVE) rebuildDove();
  };
  birdImg.src = BIRD_URL;

  // fetch the emblem asset, then bake the figures that draw it
  fetch(EMBLEM_URL)
    .then((res) => res.text())
    .then((svg) => {
      const ds = Array.from(svg.matchAll(/\sd="([^"]+)"/g)).map((m) => m[1]);
      if (!ds.length) return;
      EMBLEM_D = ds.join(' ');
      transits.filter((t) => t.kind === 'emblemSolid').forEach((t) => t.build());
    })
    .catch(() => { /* figure stays an empty specimen field */ });
})();
