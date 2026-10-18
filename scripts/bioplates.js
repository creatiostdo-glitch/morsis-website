/* ============================================================
   MORSIS — bioplates.js · background specimen plates
   Dark bio imagery printed at 25% behind the empty space of the
   page (never behind content). Each plate is generated here:
     feather       an X-ray contact print of a flight feather
     cells         a microscopy field of cells and nuclei
     interference  two sound sources' wavefronts crossing
     contour       iso-depth lines traced from the dove depth map
   On scroll each plate wipes in, drifts against the page
   (parallax), settles in scale and rotation, and a vermilion scan
   line reads it top to bottom. To use photographs instead, put
   <img> in the figure in place of the canvas — the motion still
   applies to whatever the figure holds.
   ============================================================ */

(() => {
  'use strict';

  const plates = Array.from(document.querySelectorAll('.bio'));
  if (!plates.length) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const BONE = (a) => `rgba(229, 227, 220, ${a})`;

  /* ---------------- generators (transparent background, bone ink) ---------------- */

  const GEN = {
    feather(ctx, w, h, seed) {
      const rand = rng(seed);
      // the rachis: a long, slightly curved shaft
      const P = (t) => {
        const x0 = w * 0.56, y0 = h * 0.97, cx = w * 0.64, cy = h * 0.45, x1 = w * 0.4, y1 = h * 0.04;
        const u = 1 - t;
        return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
      };
      ctx.lineCap = 'round';
      ctx.shadowColor = BONE(0.5);
      ctx.shadowBlur = 6;
      // barbs: the vane widens then tapers to the tip; clumps part like real vanes
      for (let i = 0; i < 260; i++) {
        const t = 0.1 + (i / 260) * 0.88;
        if (rand() < 0.06) continue;                                  // a split in the vane
        const [x, y] = P(t);
        const [x2, y2] = P(Math.min(1, t + 0.01));
        const ang = Math.atan2(y2 - y, x2 - x);
        const vane = Math.pow(Math.sin(Math.PI * clamp01((t - 0.06) / 0.94)), 0.55);
        [-1, 1].forEach((side) => {
          const len = w * (side < 0 ? 0.34 : 0.26) * vane * (0.85 + rand() * 0.25);
          const a = ang + side * (0.62 + rand() * 0.08);
          const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
          const mx = x + Math.cos(a - side * 0.25) * len * 0.55, my = y + Math.sin(a - side * 0.25) * len * 0.55;
          ctx.strokeStyle = BONE((0.18 + rand() * 0.22).toFixed(3));
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(mx, my, ex, ey);
          ctx.stroke();
        });
      }
      // downy afterfeather near the base
      for (let i = 0; i < 70; i++) {
        const [x, y] = P(0.03 + rand() * 0.12);
        ctx.strokeStyle = BONE(0.12 + rand() * 0.1);
        ctx.beginPath();
        ctx.moveTo(x, y);
        let px = x, py = y;
        for (let k = 0; k < 6; k++) {
          px += (rand() - 0.5) * w * 0.08;
          py += (rand() - 0.6) * h * 0.03;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      // the shaft itself, brightest
      ctx.strokeStyle = BONE(0.85);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const [x, y] = P(i / 60);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    },

    cells(ctx, w, h, seed) {
      const rand = rng(seed);
      ctx.shadowColor = BONE(0.45);
      ctx.shadowBlur = 5;
      for (let i = 0; i < 46; i++) {
        const cx = rand() * w, cy = rand() * h;
        const r = 14 + rand() * 40;
        const wob = rand() * 10;
        ctx.beginPath();
        for (let k = 0; k <= 48; k++) {
          const a = (k / 48) * Math.PI * 2;
          const rr = r * (1 + 0.09 * Math.sin(a * 3 + wob) + 0.05 * Math.sin(a * 7 + wob * 2));
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.86;
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = BONE(0.42);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.fillStyle = BONE(0.04);
        ctx.fill();
        // nucleus + nucleolus
        const nx = cx + (rand() - 0.5) * r * 0.4, ny = cy + (rand() - 0.5) * r * 0.3;
        ctx.beginPath();
        ctx.ellipse(nx, ny, r * 0.34, r * 0.28, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = BONE(0.16);
        ctx.fill();
        ctx.strokeStyle = BONE(0.5);
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.fillStyle = BONE(0.75);
        ctx.beginPath();
        ctx.arc(nx + r * 0.06, ny - r * 0.04, Math.max(1.2, r * 0.06), 0, Math.PI * 2);
        ctx.fill();
        // organelles
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = BONE(0.25 + rand() * 0.3);
          ctx.fillRect(cx + (rand() - 0.5) * r * 1.4, cy + (rand() - 0.5) * r * 1.1, 1.4, 1.4);
        }
      }
    },

    interference(ctx, w, h) {
      // two point sources; where their wavefronts cross, moiré bands appear
      const S = [[w * 0.3, h * 0.38], [w * 0.68, h * 0.62]];
      ctx.lineWidth = 0.9;
      S.forEach(([sx, sy], si) => {
        for (let r = 6; r < Math.max(w, h) * 1.1; r += 9) {
          ctx.strokeStyle = BONE((0.34 * (1 - r / (Math.max(w, h) * 1.1))).toFixed(3));
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = si ? 'rgba(255, 72, 0, 0.9)' : BONE(0.95);
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    },

    contour(ctx, w, h, seed, depth) {
      if (!depth) return;
      // fit the whole bird (its bounds inside the depth map, as fractions) with a
      // margin for the plate's scroll drift, then draw an iso-line wherever the
      // depth band changes
      const B = { x: 0.044, y: 0.223, w: 0.913, h: 0.605 };
      const s = Math.min((w * 0.8) / (depth.width * B.w), (h * 0.62) / (depth.height * B.h));
      const dw = Math.round(depth.width * s), dh = Math.round(depth.height * s);
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      const tx = tmp.getContext('2d', { willReadFrequently: true });
      tx.drawImage(depth, w / 2 - (B.x + B.w / 2) * dw, h / 2 - (B.y + B.h / 2) * dh, dw, dh);
      const d = tx.getImageData(0, 0, w, h).data;
      const out = ctx.createImageData(w, h);
      const LEVELS = 16;
      const q = (i) => (d[i * 4 + 3] < 100 ? -1 : Math.floor((d[i * 4] / 255) * LEVELS));
      for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
          const i = y * w + x;
          const a = q(i);
          if (a !== q(i + 1) || a !== q(i + w)) {
            const o = i * 4;
            out.data[o] = 229; out.data[o + 1] = 227; out.data[o + 2] = 220;
            out.data[o + 3] = a < 0 || q(i + 1) < 0 || q(i + w) < 0 ? 230 : 150;
          }
        }
      }
      ctx.putImageData(out, 0, 0);
    },
  };

  /* ---------------- build ---------------- */

  let depth = null;   // the dove depth map, for the contour plate

  function render(plate) {
    const canvas = plate.querySelector('canvas');
    if (!canvas) return;
    const w = Math.max(2, Math.round(plate.clientWidth));
    const h = Math.max(2, Math.round(plate.clientHeight));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const gen = GEN[plate.dataset.bio];
    if (gen) gen(ctx, w, h, Number(plate.dataset.seed || 3), depth);
  }

  const renderAll = () => plates.forEach(render);
  renderAll();
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 200); });

  const img = new Image();
  img.onload = () => {
    // keep the grey depth (lighter = nearer) at a modest size for contouring
    const c = document.createElement('canvas');
    c.width = 760;
    c.height = Math.round((760 * img.naturalHeight) / img.naturalWidth);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    depth = c;
    plates.filter((p) => p.dataset.bio === 'contour').forEach(render);
  };
  img.src = 'Assets/Images/tmpycq0cnhz.png';

  /* ---------------- scroll motion ---------------- */

  const state = plates.map((el) => ({ el, canvas: el.querySelector('canvas'), scene: el.closest('.scene'), visible: false }));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const s = state.find((st) => st.el === e.target);
      if (s) s.visible = e.isIntersecting;
    });
  }, { rootMargin: '10% 0px' });
  state.forEach((s) => io.observe(s.el));

  function frame() {
    requestAnimationFrame(frame);
    const vh = window.innerHeight;
    state.forEach((s) => {
      if (!s.visible) return;
      let p, reveal;
      if (s.scene) {
        // inside a pinned scene: follow the scene's own progress
        const rect = s.scene.getBoundingClientRect();
        const run = Math.max(1, rect.height - vh);
        p = clamp01(-rect.top / run) * 2 - 1;                 // -1 → 1 across the scene
        reveal = smooth(clamp01((vh - rect.top) / vh));
      } else {
        const rect = s.el.getBoundingClientRect();
        p = Math.max(-1, Math.min(1, (rect.top + rect.height / 2 - vh / 2) / (vh / 2 + rect.height / 2)));
        reveal = smooth(clamp01((vh - rect.top) / (vh * 0.55)));
      }
      // only touch styles when the plate actually moved (scroll at rest = no work)
      const key = `${p.toFixed(4)}|${reveal.toFixed(4)}`;
      if (key === s.last) return;
      s.last = key;
      s.el.style.clipPath = reveal > 0.9999 ? '' : `inset(${((1 - reveal) * 100).toFixed(2)}% 0 0 0)`;
      s.el.style.setProperty('--scan', `${((p + 1) * 50).toFixed(2)}%`);
      if (!reduced && s.canvas) {
        s.canvas.style.transform =
          `translateY(${(p * -50).toFixed(1)}px) scale(${(1.14 - 0.14 * reveal).toFixed(4)}) rotate(${(p * 2.5).toFixed(2)}deg)`;
      }
    });
  }
  requestAnimationFrame(frame);
})();
