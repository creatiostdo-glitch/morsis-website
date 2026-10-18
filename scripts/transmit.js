/* ============================================================
   MORSIS — transmit.js · Chamber 004, live encoding demo
   The hero no longer takes keyboard input: it demonstrates.
   Example phrases are encoded glyph-by-glyph into tones in the
   avian band (8–16 kHz, one octave, log-spaced like the cochlea)
   and played out through the chamber — each tone radiates from
   its own angle on the ring, the HUD trace locks to it, the clean
   ring interior names the glyph and its frequency, and the ticker
   below lights the phrase letter by letter. Visitors compose their
   own in the translator, one scroll below.
   Also exports the encoder (MORSIS.encode) used by translator.js.
   ============================================================ */

(() => {
  'use strict';

  const M = (window.MORSIS = window.MORSIS || {});
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const F_LO = 8000;    // Hz — bottom of the avian band
  const F_HI = 16000;   // Hz — one octave up
  const VOWELS = 'AEIOUY';

  // shared with main.js: the HUD trace follows the live tone
  const signal = M.signal || (M.signal = { active: false, pos: 0.5, amp: 0, norm: 0 });

  /* ---------------- encoding (shared) ---------------- */

  // position of a glyph inside the band, 0..1 (null = rest)
  function glyphNorm(ch) {
    const c = ch.toUpperCase();
    if (c === ' ') return null;
    const L = c.charCodeAt(0) - 65;
    if (L >= 0 && L < 26) return L / 25;                    // A..Z across the band
    const D = c.charCodeAt(0) - 48;
    if (D >= 0 && D < 10) return (D + 0.5) / 10;            // digits interleave
    return ((c.charCodeAt(0) * 37) % 100) / 100;            // punctuation: stable hash
  }

  // lo/hi default to the songbird octave; the translator passes other bands
  function encode(phrase, lo = F_LO, hi = F_HI) {
    return Array.from(phrase).map((ch) => {
      const n = glyphNorm(ch);
      if (n === null) return { ch, rest: true, dur: 110 };
      const isVowel = VOWELS.includes(ch.toUpperCase());
      const isLetter = /[a-z]/i.test(ch);
      return {
        ch,
        rest: false,
        norm: n,
        hz: lo * Math.pow(hi / lo, n),                      // log spacing across the band
        amp: isVowel ? 1 : isLetter ? 0.75 : 0.55,
        dur: isVowel ? 210 : isLetter ? 130 : 90,           // vowels sustain, stops are short
      };
    });
  }

  M.encode = encode;
  M.glyphNorm = glyphNorm;

  /* ---------------- the demo ---------------- */

  const stage = document.getElementById('portalStage');
  const intro = document.getElementById('heroIntro');
  const glyphEl = document.getElementById('txGlyph');
  const freqEl = document.getElementById('txFreq');
  const stepEl = document.getElementById('txStep');
  const phraseEl = document.getElementById('txPhrase');
  const metaEl = document.getElementById('txMeta');
  if (!stage || !phraseEl) return;

  const PHRASES = [
    'hello, little wren',
    'you are safe here',
    'we are listening',
    'good morning',
    'thank you',
  ];
  const SLOW = 2.3;        // the demo plays slower than the instrument, so it can be read

  // ring angle for a tone: the band wraps once around the gate, from the top
  const angleFor = (norm) => Math.PI / 2 - norm * Math.PI * 2;
  const pad2 = (n) => String(n).padStart(2, '0');
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  let stageVisible = false;
  new IntersectionObserver((en) => { stageVisible = en[0].isIntersecting; }, { threshold: 0.1 }).observe(stage);

  // only perform while the hero intro is actually on screen
  const watching = () => stageVisible && intro.style.visibility !== 'hidden' && Number(intro.style.opacity || 1) > 0.25;
  async function whenWatched() {
    while (!watching()) await wait(300);
  }

  function showGlyph(ch) {
    glyphEl.textContent = ch;
    // small settle — the glyph arrives, it doesn't blink in
    glyphEl.animate(
      [{ opacity: 0.4, transform: 'scale(0.94)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 140, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }

  function renderPhrase(text) {
    phraseEl.innerHTML = '';
    phraseEl.setAttribute('aria-label', `Transmitting: ${text}`);
    return Array.from(text).map((ch) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.setAttribute('aria-hidden', 'true');
      phraseEl.appendChild(s);
      return s;
    });
  }

  async function play(text) {
    const seq = encode(text);
    const spans = renderPhrase(text);
    const tones = seq.filter((s) => !s.rest);
    let peak = 0;
    metaEl.textContent = `Chamber 004 · encoding · ${tones.length} tones`;

    for (let i = 0; i < seq.length; i++) {
      await whenWatched();
      const s = seq[i];
      spans.forEach((el, k) => {
        el.classList.toggle('is-on', k === i);
        el.classList.toggle('is-done', k < i);
      });
      stepEl.textContent = `${pad2(i + 1)} / ${pad2(seq.length)}`;

      if (s.rest) {
        signal.amp = 0.15;
        glyphEl.textContent = '-';        // hyphen: Nothing 5×7 has no em dash, so '—' fell back to a solid font. The readout keeps all three rows, so it stays centred
        freqEl.textContent = 'rest';
      } else {
        peak = Math.max(peak, s.hz);
        showGlyph(s.ch.toUpperCase());
        freqEl.textContent = `${(s.hz / 1000).toFixed(2)} kHz`;
        signal.active = true;
        signal.norm = s.norm;
        signal.pos = 0.08 + s.norm * 0.84;
        signal.amp = s.amp;
        const chamber = M.chamber;
        if (chamber && !reduced) chamber.puff(angleFor(s.norm), 90 + s.amp * 80, 0.06 + s.amp * 0.05);
        if (M.playAvianFrequency) M.playAvianFrequency(s.hz, s.dur, s.amp, 'hero');   // heard only on the hero
      }
      await wait(s.dur * SLOW);
    }

    spans.forEach((el) => { el.classList.remove('is-on'); el.classList.add('is-done'); });
    if (M.chamber && !reduced) M.chamber.burst(0.05, 260);
    signal.amp = 0.4;
    glyphEl.textContent = pad2(tones.length);
    freqEl.textContent = 'tones sent';
    stepEl.textContent = `Peak ${(peak / 1000).toFixed(2)} kHz`;
    metaEl.textContent = 'Chamber 004 · transmission complete';
    await wait(2600);
    signal.active = false;
    signal.amp = 0;
    glyphEl.textContent = '';
    freqEl.textContent = '';
    stepEl.textContent = '';
    await wait(700);
  }

  (async function loop() {
    let i = 0;
    for (;;) {
      await whenWatched();
      await play(PHRASES[i % PHRASES.length]);
      i++;
    }
  })();
})();
