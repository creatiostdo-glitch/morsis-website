/* ============================================================
   MORSIS — timeline.js · seventeen years of listening (scene "timeline")
   The pinned run is a playhead travelling a ruler of years,
   2009 → 2026. It dwells on each milestone (the card holds),
   then glides to the next while the dot-matrix year rolls.
   Behind it, a live trace grows louder with the lab's accuracy
   (the atlas curve); from 2026 the trace burns vermilion: Naiva.
   ============================================================ */

(() => {
  'use strict';

  const sec = document.getElementById('s-timeline');
  if (!sec) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const M = (window.MORSIS = window.MORSIS || {});
  M.onScene = M.onScene || {};

  const $ = (id) => document.getElementById(id);
  const items = Array.from(sec.querySelectorAll('.tl__item'));
  const yearEl = $('tlYear');
  const yearWrap = sec.querySelector('.tl__year');
  const head = sec.querySelector('.tl__head');
  const track = sec.querySelector('.tl__track');
  const ruler = $('tlRuler');
  const needle = $('tlHead');
  const canvas = $('tlTrace');
  const ctx = canvas.getContext('2d');

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const span = (v, a, b) => clamp01((v - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;

  const T0 = 2009, T1 = 2027;                     // the ruler runs to the end of 2026
  const xOf = (t) => (t - T0) / (T1 - T0);
  const stops = items.map((li) => Number(li.dataset.year) + (Number(li.dataset.month || 1) - 1) / 12);
  const N = stops.length;
  const NAIVA = stops[N - 1];

  // the lab's accuracy over time — same logistic as the atlas's world curve
  const acc = (t) => 6 + 80 / (1 + Math.exp(-0.5 * (t - 2017.8)));

  /* ---------------- ruler ---------------- */

  const marks = [];
  function buildRuler() {
    ruler.textContent = '';
    const phone = window.innerWidth < 760;
    for (let y = T0; y <= 2026; y++) {
      const tick = document.createElement('i');
      tick.className = 'tl__tick' + (phone && (y - T0) % 3 !== 0 && y !== 2026 ? ' tl__tick--minor' : '');
      tick.style.left = `${(xOf(y) * 100).toFixed(3)}%`;
      const lab = document.createElement('span');
      lab.textContent = phone ? `’${String(y).slice(2)}` : y;
      tick.append(lab);
      ruler.append(tick);
    }
    marks.length = 0;
    stops.forEach((t) => {
      const m = document.createElement('b');
      m.className = 'tl__mark';
      m.style.left = `${(xOf(t) * 100).toFixed(3)}%`;
      ruler.append(m);
      marks.push(m);
    });
  }

  /* ---------------- state ---------------- */

  let pos = 0;            // continuous milestone index, 0 … N-1
  let t = stops[0];       // the playhead's time, in years
  let arrive = 0;
  let visible = false;
  let W = 2, H = 2, dpr = 1;
  let trackW = 1;          // cached: no layout reads inside the scroll handler

  function resize() {
    trackW = track.clientWidth;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(2, Math.round(canvas.clientWidth * dpr));
    H = Math.max(2, Math.round(canvas.clientHeight * dpr));
    canvas.width = W;
    canvas.height = H;
    buildRuler();
    apply();
  }

  // r → position: hold on each milestone, then glide to the next; the last
  // tenth of the run holds on Naiva so it can be read before the pillars arrive
  function place(r) {
    const u = (reduced ? 1 : clamp01(r / 0.9)) * (N - 1);
    const i = Math.min(N - 2, Math.floor(u));
    const f = u - i;
    const k = smooth(span(f, 0.42, 1));
    pos = i + k;
    t = lerp(stops[i], stops[i + 1], k);
  }

  function apply() {
    // year: rolls through the in-between years while travelling
    const y = String(Math.floor(t + 1e-6));
    if (yearEl.textContent !== y) yearEl.textContent = y;
    const naiva = pos > N - 1.35;
    yearWrap.classList.toggle('is-naiva', naiva);

    // cards: the one under the playhead holds, neighbours crossfade by
    items.forEach((li, k) => {
      const d = pos - k;
      const vis = 1 - clamp01(Math.abs(d) * 2.4);
      li.style.opacity = (vis * smooth(span(arrive, 0.5, 1))).toFixed(3);
      li.style.transform = reduced ? '' : `translateY(${(-d * 44).toFixed(1)}px)`;
      li.style.visibility = vis < 0.01 ? 'hidden' : '';
      li.setAttribute('aria-hidden', vis < 0.5 ? 'true' : 'false');
    });

    marks.forEach((m, k) => {
      m.classList.toggle('is-passed', stops[k] <= t + 0.01);
      m.classList.toggle('is-on', Math.abs(pos - k) < 0.25);
    });

    needle.style.transform = `translateX(${(xOf(t) * trackW).toFixed(1)}px)`;

    // arrival: the title rises, the record draws in from the left
    const a = smooth(arrive);
    head.style.opacity = smooth(span(arrive, 0.35, 0.9)).toFixed(3);
    yearWrap.style.opacity = smooth(span(arrive, 0.45, 1)).toFixed(3);
    track.style.clipPath = a < 1 ? `inset(-20px ${((1 - a) * 100).toFixed(2)}% -20px 0)` : '';
  }

  /* ---------------- the trace ---------------- */

  function drawTrace(now) {
    const time = reduced ? 0 : now / 1000;
    const mid = H * 0.56;
    const headX = xOf(t) * W;
    const naivaX = xOf(2026) * W;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = Math.max(1, dpr);
    ctx.lineJoin = 'round';

    const yAt = (x) => {
      const tt = T0 + (x / W) * (T1 - T0);
      let amp = (acc(tt) / 100) * H * 0.48;
      // each milestone leaves a burst in the record
      stops.forEach((s) => { const d = (tt - s) * 3.2; amp += Math.exp(-d * d) * H * 0.16; });
      const w = Math.sin(x * 0.11 / dpr + time * 2.1) * 0.55 +
                Math.sin(x * 0.29 / dpr - time * 1.4) * 0.3 +
                Math.sin(x * 0.047 / dpr + time * 0.6) * 0.15;
      return mid - w * Math.min(amp, H * 0.52);
    };

    const stroke = (x0, x1, style) => {
      if (x1 <= x0) return;
      ctx.strokeStyle = style;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 2) {
        const y = yAt(x);
        x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    // the future: a flat, faint baseline still to be recorded
    ctx.strokeStyle = 'rgba(229, 227, 220, 0.14)';
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(headX, mid); ctx.lineTo(W, mid); ctx.stroke();
    ctx.setLineDash([]);

    // the past: bone, then vermilion from the Naiva release on
    stroke(0, Math.min(headX, naivaX), 'rgba(229, 227, 220, 0.78)');
    stroke(naivaX, headX, 'rgba(255, 72, 0, 0.95)');
  }

  /* ---------------- wiring ---------------- */

  M.onScene.timeline = (r, el, f) => {
    arrive = f ? f.arrive : 1;
    place(r);
    apply();
  };

  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(sec);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 150); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  resize();

  (function frame(now) {
    requestAnimationFrame(frame);
    if (visible) drawTrace(now);
  })(performance.now());
})();
