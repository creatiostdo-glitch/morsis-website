/* ============================================================
   MORSIS — flow.js
   The one-flow orchestrator. A smoothed master scroll drives the
   pinned scenes, and sections marked .stack slide up OVER the
   pinned scene before them (CSS gives them margin-top: -100svh),
   while that scene recedes — scales back and dims — underneath.

   Per scene, every frame:
     r       pinned progress: 0 when the stage pins, 1 when the
             next stacked section starts to cover it
     arrive  0 → 1 while the stage slides into view
     leave   0 → 1 while the next section covers it
   Built-in scenes are choreographed here; dissolve.js and helix.js
   register theirs on MORSIS.onScene[kind](r, section, { arrive, leave }).
   ============================================================ */

(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  // a reload always starts the story at the top: no restored scroll position,
  // and no jump to a #section left in the URL by an in-page link
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  // …except a return from the speak page (?return=engine), which lands on the
  // Naiva engine, already locked in place, with no gate
  const returning = document.documentElement.classList.contains('is-returning');
  if (location.hash || returning) history.replaceState(null, '', location.pathname);
  const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (!returning) {
    toTop();
    window.addEventListener('load', toTop, { once: true });   // after late layout, before anything is seen
  }
  const M = (window.MORSIS = window.MORSIS || {});
  M.onScene = M.onScene || {};
  M.chamberDim = 1;

  /* ---------------- elements ---------------- */

  const scenes = Array.from(document.querySelectorAll('.scene'));
  const hudSections = Array.from(document.querySelectorAll('[data-hud]'));
  const portalStage = document.querySelector('#s-portal .scene__stage');
  const hud = {
    labelSpans: document.querySelectorAll('#hudLabel [data-line]'),
    channel: document.getElementById('hudChannel'),
    cols: document.querySelectorAll('.hud .meta-col'),
  };

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const span = (r, [a, b]) => clamp01((r - a) / (b - a));

  // HUD label sets, keyed by each section's data-hud
  const HUD_INFO = {
    hero:       { label: ['Morsis Research Division', 'Bio-acoustic translation'], channel: 'CH.01 chamber 004' },
    fig1:       { label: ['Fig. 01 — Specimen', 'Columba livia'], channel: 'CH.02 render → binary' },
    gap:        { label: ['Field note 001', 'The existential gap'], channel: 'CH.03 live signal' },
    fig2:       { label: ['Fig. 02 — Analysis', 'Synthetic song model'], channel: 'CH.03 spectral → binary' },
    atlas:      { label: ['Global atlas', 'Species coverage'], channel: 'CH.04 coverage map' },
    timeline:   { label: ['Research timeline', '2009 — 2026'], channel: 'CH.05 archive' },
    pillars:    { label: ['Core research pillars', 'Software architecture'], channel: 'CH.06 synthesis' },
    fig4:       { label: ['Fig. 04 — Specimen', 'The Morsis emblem'], channel: 'CH.06 binary telemetry' },
    translator: { label: ['Naiva · public model', 'Compose a transmission'], channel: 'CH.07 Naiva' },
    manifesto:  { label: ['Lab manifesto', 'Values · log · inquiry'], channel: 'CH.08 open channel' },
  };

  /* ---------------- hero: intro + scroll-lit manifesto ---------------- */

  const intro = document.getElementById('heroIntro');
  const manifesto = document.getElementById('manifesto');

  // split the manifesto into word spans so each can light in turn
  const words = [];
  if (manifesto) {
    (function splitWords(node) {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const s = document.createElement('span');
            s.className = 'w';
            s.textContent = part;
            frag.appendChild(s);
            words.push(s);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          splitWords(child);
        }
      });
    })(manifesto.querySelector('p'));
  }

  const HERO = {
    introOut: [0.06, 0.22],   // headline + chamber demo lift away
    manIn:    [0.18, 0.28],   // manifesto arrives
    read:     [0.28, 0.84],   // words light across this span
    manOut:   [0.9, 1.0],     // manifesto lifts away before the translator covers
  };
  let litCount = -1;

  function applyPortal(r) {
    const hOut = smooth(span(r, HERO.introOut));
    const mIn = smooth(span(r, HERO.manIn));
    const mOut = smooth(span(r, HERO.manOut));

    intro.style.opacity = (1 - hOut).toFixed(3);
    intro.style.visibility = hOut > 0.999 ? 'hidden' : '';
    manifesto.style.opacity = (mIn * (1 - mOut)).toFixed(3);
    if (!reduced) {
      intro.style.transform = `translateY(${(-48 * hOut).toFixed(2)}px) scale(${(1 - 0.04 * hOut).toFixed(4)})`;
      intro.style.filter = hOut > 0.001 && hOut < 0.999 ? `blur(${(hOut * 10).toFixed(1)}px)` : '';
      manifesto.style.transform = `translateY(${(40 * (1 - mIn) - 40 * mOut).toFixed(2)}px)`;
      // blur only while moving: a standing filter (even blur(0)) keeps an extra layer alive
      const mb = (1 - mIn) * 10 + mOut * 10;
      manifesto.style.filter = mb > 0.05 && mIn * (1 - mOut) > 0.001 ? `blur(${mb.toFixed(1)}px)` : '';

      const n = Math.round(span(r, HERO.read) * words.length);
      if (n !== litCount) {
        litCount = n;
        words.forEach((w, i) => { w.style.opacity = i < n ? '1' : ''; });
      }
    }
    // the chamber dims under the manifesto
    M.chamberDim = 1 - 0.62 * mIn * (1 - mOut);
    return 1 + 0.06 * smooth(clamp01(r));   // slow push-in, composed with recede below
  }

  /* ---------------- gap: three beats on one stage ---------------- */

  const gapBeats = Array.from(document.querySelectorAll('#s-gap .gap-beat'));
  const umHuman = document.querySelector('.umwelt__ring--human');
  const umAvian = document.querySelector('.umwelt__ring--avian');
  const umOverlap = document.querySelector('.umwelt__overlap');
  const strikes = Array.from(document.querySelectorAll('#s-gap .strike'));

  // the first beat rides in with the stage; the last stays until covered
  const GAP_BEATS = [
    { in: null, out: [0.27, 0.34] },
    { in: [0.34, 0.41], out: [0.63, 0.7] },
    { in: [0.7, 0.77], out: null },
  ];
  const STRIKES = [[0.43, 0.49], [0.5, 0.56], [0.57, 0.63]];

  function applyGap(r, f) {
    gapBeats.forEach((el, i) => {
      const w = GAP_BEATS[i];
      // beat 1 starts arriving while Fig. 01's last digits are still burning off
      const inK = w.in ? smooth(span(r, w.in)) : smooth(span(f.arrive, [0.12, 0.72]));
      const outK = w.out ? smooth(span(r, w.out)) : 0;
      const op = inK * (1 - outK);
      el.style.opacity = op.toFixed(3);
      el.style.visibility = op < 0.002 ? 'hidden' : '';
      if (!reduced) {
        // arrive from below, leave upward: one direction of travel
        el.style.transform = `translateY(${(36 * (1 - inK) - 36 * outK).toFixed(2)}px)`;
        const bl = (1 - inK) * 8 + outK * 8;
        el.style.filter = bl > 0.05 && op > 0.002 ? `blur(${bl.toFixed(1)}px)` : '';
      }
    });

    // beat 1: the two umwelts trace themselves, then their overlap fills
    umHuman.style.strokeDashoffset = (1 - smooth(span(r, [-0.04, 0.12]))).toFixed(4);
    umAvian.style.strokeDashoffset = (1 - smooth(span(r, [0.03, 0.19]))).toFixed(4);
    umOverlap.style.opacity = (0.24 * smooth(span(r, [0.17, 0.25]))).toFixed(3);

    // beat 2: each novelty is struck through in turn
    strikes.forEach((el, i) => {
      const s = smooth(span(r, STRIKES[i]));
      el.style.setProperty('--s', s.toFixed(4));
      el.classList.toggle('is-struck', s > 0.98);
    });
  }

  /* ---------------- HUD swap ---------------- */

  let activeKey = '';
  let swapTimer = 0;

  function hudSwap(key) {
    if (key === activeKey) return;
    activeKey = key;
    const info = HUD_INFO[key];
    if (!info) return;
    hud.cols.forEach((col) => col.classList.add('is-swapping'));
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => {
      hud.labelSpans[0].textContent = info.label[0];
      hud.labelSpans[1].textContent = info.label[1];
      hud.channel.textContent = info.channel;
      hud.cols.forEach((col) => col.classList.remove('is-swapping'));
    }, 160);
  }

  /* ---------------- geometry ---------------- */

  // how far the section after `el` overlaps it (its negative margin)
  const overlapAfter = (el) => {
    const next = el.nextElementSibling;
    if (!next || !next.classList.contains('stack')) return 0;
    return Math.max(0, -parseFloat(getComputedStyle(next).marginTop) || 0);
  };

  let geo = [];
  let hudGeo = [];
  function measure() {
    hudGeo = hudSections.map((el) => ({ key: el.dataset.hud, top: el.offsetTop, h: el.offsetHeight }));
    geo = scenes.map((el) => {
      const stage = el.querySelector('.scene__stage');
      const vh = stage ? stage.offsetHeight : window.innerHeight;
      const over = overlapAfter(el);
      return { el, stage, vh, over, top: el.offsetTop, h: el.offsetHeight, kind: el.dataset.scene };
    });
  }

  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  // late layout shifts (fonts, images, reveals): re-measure only when the page
  // actually changes size, instead of forcing a layout every 1.5s
  if ('ResizeObserver' in window) new ResizeObserver(() => measure()).observe(document.querySelector('.flow') || document.body);

  /* ---------------- main loop ---------------- */

  let sY = window.scrollY;

  // back from the speak page: jump (not glide) to the engine's locked position,
  // then reveal the page. The smoothed scroll is set too, so nothing sweeps past.
  if (returning) {
    const land = () => {
      const panel = document.getElementById('s-translator');
      const pin = document.getElementById('trPin');
      if (panel) {
        measure();
        const pinTop = pin ? parseFloat(getComputedStyle(pin).top) || 0 : 0;
        const y = panel.offsetTop + Math.max(0, -pinTop) + 2;
        window.scrollTo({ top: y, left: 0, behavior: 'instant' });
        sY = window.scrollY;
      }
      document.documentElement.classList.remove('is-returning');
    };
    if (document.readyState === 'complete') land();
    else window.addEventListener('load', land, { once: true });
  }
  const REDUCED_OK = new Set(['portal', 'gap', 'transit', 'pillars', 'atlas', 'timeline']);

  function update() {
    const targetY = window.scrollY;
    sY += (targetY - sY) * (reduced ? 1 : 0.1);
    if (Math.abs(targetY - sY) < 0.1) sY = targetY;
    const vhNow = window.innerHeight;

    for (const g of geo) {
      const { el, stage, vh, over, top, h, kind } = g;
      // only scenes touching the viewport do any work
      if (sY + vhNow < top - 2 || sY > top + h + 2) continue;

      const total = Math.max(1, h - vh - over);      // the pinned, uncovered run
      const r = (sY - top) / total;
      const arrive = clamp01((sY - (top - vh)) / vh);
      const leave = over > 0 ? clamp01((sY - (top + total)) / over) : clamp01((sY - (top + total)) / vh);
      const f = { arrive, leave };

      if (!(reduced && !REDUCED_OK.has(kind))) {
        let zoom = 1;
        if (kind === 'portal') zoom = applyPortal(r);
        else if (kind === 'gap') applyGap(r, f);
        else if (M.onScene[kind]) M.onScene[kind](r, el, f);

        // recede: the covered scene sinks back and fades out completely while the
        // next one rises through it. Stages are transparent over one shared dot
        // field, so the hand-over has no card edge — it reads as one surface.
        if (stage) {
          const k = over > 0 ? smooth(leave) : 0;
          const s = reduced ? 1 : zoom * (1 - 0.06 * k);
          stage.style.transform = s !== 1 ? `scale(${s.toFixed(4)})` : '';
          stage.style.opacity = k > 0 ? (1 - k).toFixed(3) : '';
          stage.style.visibility = k > 0.999 ? 'hidden' : '';
        }
      }
    }

    // the HUD names the topmost section holding the middle of the viewport
    const mid = sY + vhNow * 0.5;
    for (let i = hudGeo.length - 1; i >= 0; i--) {
      const s = hudGeo[i];
      if (mid >= s.top && mid < s.top + s.h) { hudSwap(s.key); break; }
    }

    requestAnimationFrame(update);
  }

  if (portalStage) portalStage.style.opacity = '';
  requestAnimationFrame(update);
})();
