/* ============================================================
   MORSIS — main.js
   Page-wide: film grain + the HUD live-signal strip.
   Scene choreography lives in flow.js.
   ============================================================ */

(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------------------------
     FILM GRAIN — painted once; the CSS jitters it (see #grain).
     Re-rolling noise on the CPU and blending it over the page every
     frame was the single biggest cost on the site.
     ---------------------------------------------------------- */
  const grain = document.getElementById('grain');
  const gctx = grain.getContext('2d');

  // low-res noise tile, upscaled for a chunky filmic grain
  const TILE = 160;
  const tile = document.createElement('canvas');
  tile.width = tile.height = TILE;
  const tctx = tile.getContext('2d');
  const tileImg = tctx.createImageData(TILE, TILE);
  for (let i = 0; i < tileImg.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    tileImg.data[i] = tileImg.data[i + 1] = tileImg.data[i + 2] = v;
    tileImg.data[i + 3] = 255;
  }
  tctx.putImageData(tileImg, 0, 0);

  // the canvas overhangs the viewport by one tile so the jitter never shows an edge
  function drawGrain() {
    grain.width = Math.max(1, Math.floor((window.innerWidth + TILE) / 2));
    grain.height = Math.max(1, Math.floor((window.innerHeight + TILE) / 2));
    gctx.fillStyle = gctx.createPattern(tile, 'repeat');
    gctx.fillRect(0, 0, grain.width, grain.height);
  }

  /* ----------------------------------------------------------
     LIVE SIGNAL — cursor-driven waveform strip
     ---------------------------------------------------------- */
  const signal = document.getElementById('signal');
  const sctx = signal ? signal.getContext('2d') : null;   // absent on speak.html (no HUD)

  let mx = 0.5;       // smoothed cursor x (0..1)
  let targetX = 0.5;  // raw cursor x
  let t = 0;          // time
  let boost = 0;      // smoothed transmit amplitude (0..1)
  let pitch = 0;      // smoothed transmit pitch (0..1)

  // the cursor also wakes the dot field (styled in styles/dotgrid.css). The glow
  // is one small element moved with a transform, once per frame: writing CSS
  // variables on <html> per mousemove restyled the whole document each time.
  const GLOW = 170;                                  // radius, px
  const glow = document.createElement('div');
  glow.className = 'dot-glow';
  glow.setAttribute('aria-hidden', 'true');
  document.body.prepend(glow);                       // first child: paints under all content
  let gx = 0, gy = 0, glowQueued = false;
  const placeGlow = () => {
    glowQueued = false;
    const x = gx - GLOW, y = gy - GLOW;
    glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    glow.style.backgroundPosition = `${-x}px ${-y}px`;   // keeps its dots on the page grid
  };
  window.addEventListener('pointermove', (e) => {
    targetX = e.clientX / window.innerWidth;
    if (e.pointerType !== 'mouse') return;
    gx = e.clientX; gy = e.clientY;
    glow.classList.add('is-on');
    if (!glowQueued) { glowQueued = true; requestAnimationFrame(placeGlow); }
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => glow.classList.remove('is-on'));
  window.addEventListener('blur', () => glow.classList.remove('is-on'));

  function sizeSignal() {
    if (!sctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = signal.clientWidth;
    const h = signal.clientHeight;
    signal.width = Math.max(1, Math.floor(w * dpr));
    signal.height = Math.max(1, Math.floor(h * dpr));
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawSignal() {
    if (!sctx) return;
    t += 0.016;

    // while a phrase transmits (transmit.js), the reading head locks to the
    // live tone: position = place in the octave, amplitude = glyph weight
    const sig = window.MORSIS && window.MORSIS.signal;
    const live = sig && sig.active;
    const goal = live ? sig.pos : targetX;
    mx += (goal - mx) * (live ? 0.18 : 0.055);
    boost += ((live ? sig.amp : 0) - boost) * 0.15;
    pitch += ((live ? sig.norm : 0) - pitch) * 0.15;

    const w = signal.clientWidth;
    const h = signal.clientHeight;
    if (w < 2) return;

    sctx.clearRect(0, 0, w, h);

    const mid = h * 0.5;
    const amp = h * 0.42 * (1 + 0.1 * boost);
    const k = 1 + pitch * 2.2 + boost * 0.6;     // higher tones → tighter waves
    const spread = 18 + boost * 22;              // and a narrower, brighter packet

    // gaussian envelope centred on the cursor (or the live tone)
    const env = (x) => {
      const d = x / w - mx;
      return Math.exp(-d * d * spread) * amp;
    };

    // layered sines — an organic "reading"
    const wave = (x, phase) =>
      Math.sin(x * 0.021 * k + t * (2.1 + boost * 6) + phase) * 0.55 +
      Math.sin(x * 0.043 * k - t * 1.3 + phase * 2.0) * 0.30 +
      Math.sin(x * 0.011 + t * 0.7) * 0.15;

    // primary trace
    sctx.strokeStyle = 'rgba(229, 227, 220, 0.85)';
    sctx.lineWidth = 1;
    sctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = mid + env(x) * wave(x, 0);
      x === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
    }
    sctx.stroke();

    // faint echo trace, slightly offset in phase
    sctx.strokeStyle = 'rgba(229, 227, 220, 0.28)';
    sctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = mid + env(x) * wave(x, 1.7) * 0.55;
      x === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
    }
    sctx.stroke();

    // red reading head at the cursor
    const hx = mx * w;
    sctx.strokeStyle = 'rgba(255, 72, 0, 0.9)';
    sctx.beginPath();
    sctx.moveTo(hx, 4);
    sctx.lineTo(hx, h - 4);
    sctx.stroke();
  }

  /* ----------------------------------------------------------
     MAIN LOOP + resize
     ---------------------------------------------------------- */
  function frame() {
    drawSignal();
    requestAnimationFrame(frame);
  }

  function onResize() {
    sizeSignal();
    drawGrain();
  }

  window.addEventListener('resize', onResize);

  /* ----------------------------------------------------------
     START
     ---------------------------------------------------------- */
  function start() {
    sizeSignal();
    drawGrain();
    if (reduced || !sctx) {
      drawSignal();      // one static trace (or nothing, on pages without the HUD)
      return;            // no loop
    }
    requestAnimationFrame(frame);
  }

  start();
})();
