/* ============================================================
   MORSIS — audio.js · the sound engine, shared by every page
   One Web Audio context and master bus, the site's two voices
   (a fixed-pitch avian tone and a gliding chirp), the zones that
   decide where sound may be heard, and the page-wide Sound
   switch. Loaded first; everything else calls into MORSIS.*.
   ============================================================ */

(() => {
  'use strict';

  const M = (window.MORSIS = window.MORSIS || {});
  const audio = (M.audio = { ctx: null, on: false, bus: null });

  function ensureContext() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        audio.ctx = new AC();
        // one master bus: chirps are pushed loud, a compressor keeps stacked tones from clipping
        const comp = audio.ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 8;
        comp.ratio.value = 6;
        comp.attack.value = 0.002;
        comp.release.value = 0.12;
        audio.bus = audio.ctx.createGain();
        audio.bus.gain.value = 1;
        audio.bus.connect(comp).connect(audio.ctx.destination);
      }
    }
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }
  M.ensureAudio = ensureContext;   // call it inside a click, so autoplay rules allow it

  /* ---------------- where sound may be heard ----------------
     The hero's chamber only while the hero fills the screen, the engine
     only while the engine does, Fig. 02 only through its own Play button,
     the speak gate only while it is up. Any other source stays silent. */
  const ZONES = {
    hero: () => document.getElementById('s-portal'),
    engine: () => document.getElementById('s-translator'),
    fig2: () => document.getElementById('s-fig2'),
  };
  function audibleHere(source) {
    if (source === 'gate') {
      const g = document.getElementById('gate');
      return !!g && !g.classList.contains('is-leaving');
    }
    const el = ZONES[source] && ZONES[source]();
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    // the section must hold the middle of the screen (the hero stops being "here"
    // once the next section has slid halfway over its pinned stage)
    if (source === 'hero') return r.top <= vh * 0.5 && r.bottom >= vh * 1.5;
    return r.top <= vh * 0.5 && r.bottom >= vh * 0.5;
  }
  M.audibleHere = audibleHere;

  const allowed = (source, opts) => !!audio.ctx && (audio.on || (opts && opts.force)) && audibleHere(source);

  // one sine voice: f0 glides to f1 over `glide` seconds, with a fast click-free
  // attack and a natural decay
  function voice(a, at, dur, f0, f1, level, glide) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f1, at + glide);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.012, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(audio.bus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  // a fixed-pitch avian tone (the hero, the engine, Fig. 02). It sweeps up into
  // its pitch — a chirp, not a beep — and a soft octave below carries it on
  // laptop speakers, where 8–16 kHz fades. opts.force: the visitor pressed a
  // play control themselves, so it sounds even with the Sound switch off.
  M.playAvianFrequency = function playAvianFrequency(hz, durMs, amp, source, opts) {
    if (!allowed(source, opts)) return;
    const a = audio.ctx;
    const t0 = a.currentTime;
    const dur = Math.max(0.05, durMs / 1000);
    const peak = 0.32 * Math.min(1.2, amp || 1);
    const glide = Math.min(0.04, dur * 0.4);
    voice(a, t0, dur, hz * 0.86, hz, peak, glide);
    if (hz > 1200) voice(a, t0, dur, hz * 0.43, hz / 2, peak * 0.45, glide);
  };

  // a gliding call note for the voice translator: f0 → f1 over dur seconds,
  // starting `at` seconds from now. Returns false when it may not sound here.
  M.playChirp = function playChirp(n, source, opts) {
    if (!allowed(source, opts)) return false;
    const a = audio.ctx;
    const at = a.currentTime + (n.at || 0);
    const peak = 0.3 * Math.min(1.2, n.amp || 1);
    voice(a, at, n.dur, n.f0, n.f1, peak, n.dur * 0.85);
    voice(a, at, n.dur, n.f0 / 2, n.f1 / 2, peak * 0.4, n.dur * 0.85);
    return true;
  };

  /* ---------------- the page-wide Sound switch ---------------- */

  const toggles = Array.from(document.querySelectorAll('[data-sound-toggle]'));
  M.setSound = (on) => {
    audio.on = on;
    if (on) ensureContext();
    toggles.forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'Sound · on' : 'Sound · off';
    });
  };
  toggles.forEach((btn) => btn.addEventListener('click', () => M.setSound(!audio.on)));
})();
