/* ============================================================
   MORSIS — naiva.js · the coda of Fig. 04: "Introducing Naiva"
   Scrubbed by Fig. 04's pinned scroll (it rides on dissolve.js's
   "transit" scene hook):
     r 0.58 → 0.72  the emblem's binary settles into AVIAN, one
                    slot at a time (each flickers 0/1, then locks)
     r 0.74 → 0.92  the letters hop over and under each other
                    into NAIVA — N leaps the whole word to the front
     r 0.90 → 0.98  the name turns vermilion; the subline arrives
   Fully reversible: scroll back and NAIVA unravels into AVIAN.
   ============================================================ */

(() => {
  'use strict';

  const sec = document.getElementById('s-fig4');
  const box = document.getElementById('introNaiva');
  if (!sec || !box) return;

  const M = (window.MORSIS = window.MORSIS || {});
  M.onScene = M.onScene || {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const kicker = box.querySelector('.intro__kicker');
  const word = box.querySelector('.intro__word');
  const sub = box.querySelector('.intro__sub');
  const letters = Array.from(word.querySelectorAll('.intro__l'));   // A V I A N

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const span = (v, a, b) => clamp01((v - a) / (b - a));

  // where each AVIAN letter goes in NAIVA, and the arc it takes to get there
  // (em: negative = over the top, positive = under the row)
  // N leaps high over the whole word; V dives under the I; each A hops into a
  // slot only after its occupant has left — no letter ever passes through another
  const TARGET = [1, 3, 2, 4, 0];
  const ARC = [-0.24, 1.05, 0.08, -0.24, -1.35];
  const DELAY = [0.1, 0.06, 0.12, 0.14, 0];
  const CHARS = ['A', 'V', 'I', 'A', 'N'];

  /* ---------------- measure ---------------- */

  // slot positions: AVIAN as laid out, NAIVA from a hidden twin (works for any font)
  let dx = letters.map(() => 0), em = 100;
  function measure() {
    letters.forEach((l) => { l.style.transform = ''; l.textContent = CHARS[letters.indexOf(l)]; l.style.width = ''; });
    const twin = word.cloneNode(true);
    twin.style.cssText = 'position:absolute;left:0;top:0;width:100%;visibility:hidden;';
    Array.from(twin.children).forEach((s, i) => { s.textContent = 'NAIVA'[i]; s.style.opacity = '0'; });
    word.appendChild(twin);
    const src = letters.map((l) => l.offsetLeft);
    const dst = Array.from(twin.children).map((s) => s.offsetLeft);
    // fixed widths, so a flickering 0/1 never shifts the row
    letters.forEach((l) => { l.style.width = `${l.offsetWidth}px`; });
    twin.remove();
    dx = letters.map((_, i) => dst[TARGET[i]] - src[i]);
    em = parseFloat(getComputedStyle(word).fontSize) || 100;
  }

  /* ---------------- scrub ---------------- */

  function update(r) {
    const now = performance.now();
    const k = span(r, 0.74, 0.92);                    // the rearrangement
    const intro = smooth(span(r, 0.56, 0.66));
    // the kicker steps back while N leaps through the space above the word
    const leap = reduced ? 0 : Math.sin(Math.PI * smooth(span(k, DELAY[4], DELAY[4] + 0.72)));
    kicker.style.opacity = (intro * (1 - 0.9 * leap)).toFixed(3);
    kicker.style.setProperty('--track', `${(0.5 + (1 - intro) * 0.9).toFixed(3)}em`);   // tracks in
    letters.forEach((l, i) => {
      // decode: flicker in as binary, then lock onto the letter
      const d0 = 0.58 + i * 0.022;
      const appear = span(r, d0, d0 + 0.03);
      const locked = r >= d0 + 0.06;
      l.style.opacity = appear.toFixed(3);
      const ch = locked || reduced ? CHARS[i] : ((Math.floor(now / 70) + i * 3) % 2 ? '1' : '0');
      if (l.textContent !== ch) l.textContent = ch;
      l.classList.toggle('is-glyph', !locked && !reduced);

      // hop to its NAIVA slot along its own arc
      const e = reduced ? (k > 0.5 ? 1 : 0) : smooth(span(k, DELAY[i], DELAY[i] + 0.72));
      const x = dx[i] * e;
      const y = ARC[i] * em * Math.sin(Math.PI * e);
      const tilt = i === 4 ? -10 * Math.sin(Math.PI * e) : 0;
      l.style.transform = e > 0.0005 ? `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg)` : '';
    });

    const named = r >= 0.9;
    box.classList.toggle('is-name', named);
    const end = smooth(span(r, 0.9, 0.98));
    sub.style.opacity = end.toFixed(3);
    sub.style.transform = `translateY(${((1 - end) * 10).toFixed(1)}px)`;
  }

  // ride on the transit hook dissolve.js registered for every figure
  const prev = M.onScene.transit;
  M.onScene.transit = (r, el, f) => {
    if (prev) prev(r, el, f);
    if (el === sec) update(r);
  };

  measure();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(measure, 150); });
})();
