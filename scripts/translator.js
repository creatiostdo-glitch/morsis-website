/* ============================================================
   MORSIS — translator.js · Section 04, Aves Signal Translator
   Mock calculator: a typed human phrase is encoded glyph-by-glyph
   (same mapping as the hero, via MORSIS.encode) into the chosen
   avian band, played out over time, and read back through an
   oscilloscope, a scrolling spectrogram and four metrics.
   Audio goes through MORSIS.playAvianFrequency (panels.js).
   ============================================================ */

(() => {
  'use strict';

  const form = document.getElementById('trForm');
  if (!form) return;

  const M = (window.MORSIS = window.MORSIS || {});
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  const input = $('trInput');
  const count = $('trCount');
  const encodeBtn = $('trEncode');
  const statusEl = $('trStatus');
  const scope = $('trScope');
  const spectro = $('trSpectro');
  const seqEl = $('trSeq');
  const rangeEl = $('trRange');
  const sigEl = $('trSig');
  const barcodeEl = $('trBarcode');
  const instrument = $('trInstrument');
  const idleEl = $('trIdle');
  const metricEls = { peak: $('mPeak'), hri: $('mHri'), fid: $('mFid'), disp: $('mDisp') };

  const MAX = Number(input.maxLength) || 48;

  // target spectra — harmonic weights shape both the scope and the spectrogram
  const BANDS = {
    passeriformes: { lo: 8000, hi: 16000, harm: [1, 0.32], fid: 0 },
    psittaciformes: { lo: 2000, hi: 8000, harm: [1, 0.55, 0.34, 0.2], fid: -0.8 },
    raptores: { lo: 400, hi: 2000, harm: [1, 0.6, 0.42, 0.28, 0.16], fid: -2.2 },
  };
  let bandKey = 'passeriformes';
  const band = () => BANDS[bandKey];
  const fMax = () => band().hi * 1.6;   // headroom so the 2nd harmonic shows

  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------------- encoding + metrics ---------------- */

  // fallback if transmit.js is absent: identical glyph → position mapping
  function encode(phrase) {
    const b = band();
    if (M.encode) return M.encode(phrase, b.lo, b.hi);
    return Array.from(phrase).map((ch) => {
      const c = ch.toUpperCase().charCodeAt(0);
      if (ch === ' ') return { ch, rest: true, dur: 110 };
      const n = c >= 65 && c <= 90 ? (c - 65) / 25 : ((c * 37) % 100) / 100;
      return { ch, rest: false, norm: n, hz: b.lo * Math.pow(b.hi / b.lo, n), amp: 0.8, dur: 140 };
    });
  }

  function metricsFor(seq, phrase) {
    const tones = seq.filter((s) => !s.rest);
    if (!tones.length) return null;
    const peak = Math.max(...tones.map((s) => s.hz));

    // harmonic resonance index: how often neighbouring tones sit on simple ratios
    const SIMPLE = [1, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 2];
    let score = 0, pairs = 0;
    for (let i = 1; i < tones.length; i++) {
      const a = tones[i - 1].hz, b = tones[i].hz;
      const ratio = Math.max(a, b) / Math.min(a, b);
      const dev = Math.min(...SIMPLE.map((s) => Math.abs(ratio / s - 1)));
      score += 1 - Math.min(dev / 0.03, 1);
      pairs++;
    }
    const hri = pairs ? 0.35 + 0.65 * (score / pairs) : 0.5;

    // fidelity: long phrases and punctuation cost clarity; low bands carry less detail
    const punct = (phrase.match(/[^a-z0-9\s]/gi) || []).length;
    const fid = Math.max(84, Math.min(99.4, 99.2 - punct * 0.9 - Math.max(0, phrase.length - 28) * 0.15 + band().fid));

    // dispersion: air absorption rises steeply with frequency (≈ dB per metre)
    const disp = 0.0105 * Math.pow(peak / 1000, 1.18);

    return { peak: peak / 1000, hri, fid, disp };
  }

  function sigId(text) {
    let h = 0x811c9dc5;   // FNV-1a
    for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    const hex = h.toString(16).toUpperCase().padStart(8, '0');
    return `SIG-${hex.slice(0, 4)}-${hex.slice(4)}`;
  }

  /* ---------------- metric count-up ---------------- */

  const shown = { peak: 0, hri: 0, fid: 0, disp: 0 };
  const DIGITS = { peak: 2, hri: 3, fid: 1, disp: 3 };
  let tweenId = 0;

  function countTo(target) {
    const id = ++tweenId;
    const from = { ...shown };
    const t0 = performance.now();
    const dur = reduced ? 0 : 900;
    const ease = (t) => 1 - Math.pow(1 - t, 3);   // ease-out: fast start, gentle settle
    (function step(now) {
      if (id !== tweenId) return;
      const k = dur ? ease(Math.min(1, (now - t0) / dur)) : 1;
      Object.keys(target).forEach((key) => {
        shown[key] = from[key] + (target[key] - from[key]) * k;
        metricEls[key].textContent = shown[key].toFixed(DIGITS[key]);
      });
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------------- status ---------------- */

  function setStatus(state) {
    statusEl.dataset.state = state;
    statusEl.querySelector('b').textContent = { idle: 'Idle', encoding: 'Encoding', locked: 'Locked', recording: 'Recording' }[state];
  }

  /* ---------------- playback ---------------- */

  let tone = null;          // the tone currently sounding
  let run = 0;
  let lastPhrase = '';
  let signalTimer = 0;

  function renderSeq(seq) {
    seqEl.innerHTML = seq
      .map((s) => (s.rest
        ? '<li class="is-rest"><b>·</b><span>rest</span></li>'
        : `<li><b>${s.ch.replace(/[<>&"]/g, '')}</b><span>${(s.hz / 1000).toFixed(2)}</span></li>`))
      .join('');
  }

  function transmit(phrase) {
    const seq = encode(phrase);
    if (!seq.length) return;
    const id = ++run;
    lastPhrase = phrase;
    clearTimeout(signalTimer);

    const m = metricsFor(seq, phrase);
    if (m) countTo(m);
    const sid = sigId(`${bandKey}:${phrase}`);
    sigEl.textContent = `${sid} · ${seq.filter((s) => !s.rest).length} tones · ${bandKey}`;
    if (M.barcode) M.barcode(barcodeEl, sid);

    renderSeq(seq);
    if (idleEl) idleEl.classList.add('is-hidden');
    const items = Array.from(seqEl.children);
    setStatus('encoding');
    const signal = M.signal || (M.signal = { active: false, pos: 0.5, amp: 0, norm: 0 });

    let i = 0;
    (function next() {
      if (id !== run) return;
      items.forEach((li, k) => li.classList.toggle('is-on', k === i));
      if (i >= seq.length) {
        tone = null;
        setStatus('locked');
        signalTimer = setTimeout(() => { if (id === run) { signal.active = false; signal.amp = 0; } }, 1200);
        return;
      }
      const s = seq[i++];
      const li = items[i - 1];
      if (li) seqEl.scrollLeft = li.offsetLeft - seqEl.clientWidth / 2 + li.clientWidth / 2;
      if (s.rest) {
        tone = null;
        signal.amp = 0.15;
      } else {
        tone = { hz: s.hz, amp: s.amp, norm: s.norm };
        signal.active = true;
        signal.norm = s.norm;
        signal.pos = 0.08 + s.norm * 0.84;
        signal.amp = s.amp;
        if (M.playAvianFrequency) M.playAvianFrequency(s.hz, s.dur, s.amp, 'engine');   // heard only in the engine
      }
      setTimeout(next, s.dur);
    })();
  }

  /* ---------------- canvases ---------------- */

  const sctx = scope.getContext('2d');
  const pctx = spectro.getContext('2d');
  let dpr = 1;
  let column = null;

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    [scope, spectro].forEach((c) => {
      c.width = Math.max(2, Math.round(c.clientWidth * dpr));
      c.height = Math.max(2, Math.round(c.clientHeight * dpr));
    });
    pctx.fillStyle = '#0b0c0e';
    pctx.fillRect(0, 0, spectro.width, spectro.height);
    column = pctx.createImageData(Math.max(1, Math.round(2 * dpr)), spectro.height);
  }

  // smoothed display state, so the trace glides between tones
  let amp = 0.06, cyc = 4, phase = 0, last = performance.now();

  function drawScope(dt) {
    const W = scope.width, H = scope.height, mid = H / 2;
    // phosphor persistence: fade the last frame rather than clearing it
    sctx.fillStyle = 'rgba(11, 12, 14, 0.34)';
    sctx.fillRect(0, 0, W, H);

    sctx.strokeStyle = 'rgba(229, 227, 220, 0.06)';
    sctx.lineWidth = 1;
    sctx.beginPath();
    for (let gx = 1; gx < 10; gx++) { const x = (gx / 10) * W; sctx.moveTo(x, 0); sctx.lineTo(x, H); }
    for (let gy = 1; gy < 4; gy++) { const y = (gy / 4) * H; sctx.moveTo(0, y); sctx.lineTo(W, y); }
    sctx.stroke();

    // recording: the scope shows the live microphone instead of the model
    if (mic) {
      mic.analyser.getByteTimeDomainData(mic.wave);
      sctx.save();
      sctx.shadowColor = 'rgba(255, 72, 0, 0.7)';
      sctx.shadowBlur = 8 * dpr;
      sctx.strokeStyle = 'rgba(255, 92, 30, 0.95)';
      sctx.lineWidth = 1.4 * dpr;
      sctx.beginPath();
      const n = mic.wave.length;
      for (let x = 0; x <= W; x += 2) {
        const v = (mic.wave[Math.min(n - 1, Math.floor((x / W) * n))] - 128) / 128;
        const y = mid - v * H * 0.46 * Math.sin(Math.PI * (x / W)) ** 0.35;
        x ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
      }
      sctx.stroke();
      sctx.restore();
      return;
    }

    const targetAmp = tone ? 0.3 + tone.amp * 0.55 : 0.05;
    const targetCyc = tone ? 3 + tone.norm * 11 : 4;
    amp += (targetAmp - amp) * Math.min(1, dt * 10);
    cyc += (targetCyc - cyc) * Math.min(1, dt * 12);
    phase += dt * (reduced ? 0 : 3 + cyc * 0.6);

    const harm = band().harm;
    sctx.save();
    sctx.shadowColor = 'rgba(229, 227, 220, 0.8)';
    sctx.shadowBlur = 8 * dpr;
    sctx.strokeStyle = 'rgba(236, 234, 228, 0.95)';
    sctx.lineWidth = 1.4 * dpr;
    sctx.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const u = x / W;
      let v = 0;
      for (let k = 0; k < harm.length; k++) {
        v += harm[k] * Math.sin(Math.PI * 2 * (k + 1) * cyc * u + (k + 1) * phase);
      }
      v /= harm.reduce((a, b) => a + b, 0);
      if (!tone) v += (Math.random() - 0.5) * 0.4;   // idle: a quiet noise floor
      const taper = Math.sin(Math.PI * u) ** 0.35;
      const y = mid - v * amp * H * 0.42 * taper;
      x ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    }
    sctx.stroke();
    sctx.restore();

    // trigger marker
    sctx.fillStyle = 'rgba(255, 72, 0, 0.9)';
    sctx.fillRect(W * 0.06, mid - 5 * dpr, 1 * dpr, 10 * dpr);
  }

  function drawSpectro() {
    const W = spectro.width, H = spectro.height;
    const cw = column.width;
    // waterfall: shift left, paint a fresh column at the right edge
    pctx.drawImage(spectro, -cw, 0);
    const d = column.data;
    const fm = fMax();
    const bw = fm * 0.011;
    const harm = band().harm;
    if (mic) mic.analyser.getByteFrequencyData(mic.freq);
    const nyq = mic ? mic.rate / 2 : 1;
    for (let y = 0; y < H; y++) {
      const f = (1 - y / H) * fm;
      let v = Math.random() * 0.05 + (f < fm * 0.06 ? 0.05 : 0);
      if (mic) {
        // the live microphone, on the same frequency axis as the model's tones
        const bin = Math.min(mic.freq.length - 1, Math.floor((f / nyq) * mic.freq.length));
        v = Math.max(v, Math.pow(mic.freq[bin] / 255, 1.6));
      } else if (tone) {
        for (let k = 0; k < harm.length; k++) {
          const df = (f - tone.hz * (k + 1)) / bw;
          v += tone.amp * harm[k] * Math.exp(-df * df);
        }
      }
      v = Math.min(1, v);
      const hot = v > 0.82;
      for (let x = 0; x < cw; x++) {
        const o = (y * cw + x) * 4;
        d[o] = hot ? 255 : 11 + v * 218;
        d[o + 1] = hot ? 72 + (1 - v) * 120 : 12 + v * 215;
        d[o + 2] = hot ? 0 : 14 + v * 206;
        d[o + 3] = 255;
      }
    }
    pctx.putImageData(column, W - cw, 0);
  }

  let visible = false;
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(instrument);

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible) return;
    drawScope(dt);
    drawSpectro();
  }

  /* ---------------- recorder ----------------
     Captures the microphone into a take for later features (nothing consumes
     it yet). Takes live in MORSIS.recordings; each one also fires a
     `morsis:recording` event with { blob, url, duration, mime } as detail.
     While recording, the scope and the waterfall show the live input. */

  let mic = null;            // { analyser, wave, freq, rate } while recording
  const recBtn = $('trRec');
  const takeEl = $('trTake');
  const MAX_TAKE = 30;       // seconds; a take stops itself here
  const rec = { recorder: null, stream: null, chunks: [], t0: 0, timer: 0 };
  M.recordings = M.recordings || [];

  const fmtTime = (s) => `${pad2(Math.floor(s / 60))}:${pad2(Math.floor(s % 60))}`;
  const recLabel = (text) => { recBtn.querySelector('.rec-label').textContent = text; };

  function canRecord() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  async function startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      recLabel(err && err.name === 'NotAllowedError' ? 'Mic blocked' : 'No microphone');
      setTimeout(() => recLabel('Record'), 2600);
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    Object.assign(rec, { recorder, stream, chunks: [], t0: performance.now() });
    recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); });
    recorder.addEventListener('stop', finishTake);
    recorder.start(250);

    // feed the instrument: a silent analyser tap (never routed to the speakers)
    const ctx = M.ensureAudio ? M.ensureAudio() : null;
    if (ctx) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      mic = { analyser, src, wave: new Uint8Array(analyser.fftSize), freq: new Uint8Array(analyser.frequencyBinCount), rate: ctx.sampleRate };
    }

    run++;                    // stop any phrase playback; the instrument is listening now
    tone = null;
    if (idleEl) idleEl.classList.add('is-hidden');
    setStatus('recording');
    recBtn.classList.add('is-rec');
    recBtn.setAttribute('aria-pressed', 'true');
    recLabel('Stop');
    const tick = () => {
      const s = (performance.now() - rec.t0) / 1000;
      recBtn.querySelector('.rec-time').textContent = fmtTime(s);
      if (s >= MAX_TAKE) stopRecording();
    };
    tick();
    rec.timer = setInterval(tick, 250);
  }

  function stopRecording() {
    if (!rec.recorder || rec.recorder.state === 'inactive') return;
    clearInterval(rec.timer);
    rec.duration = (performance.now() - rec.t0) / 1000;
    rec.recorder.stop();
    rec.stream.getTracks().forEach((tr) => tr.stop());
    if (mic) { try { mic.src.disconnect(); } catch (_) { /* ok */ } }
    mic = null;
    recBtn.classList.remove('is-rec');
    recBtn.setAttribute('aria-pressed', 'false');
    recLabel('Record');
    setStatus('idle');
  }

  function finishTake() {
    const mime = rec.recorder.mimeType || 'audio/webm';
    const blob = new Blob(rec.chunks, { type: mime });
    const take = { blob, url: URL.createObjectURL(blob), duration: rec.duration, mime, at: new Date().toISOString() };
    M.recordings.push(take);
    window.dispatchEvent(new CustomEvent('morsis:recording', { detail: take }));
    takeEl.querySelector('.tr-take__name').innerHTML =
      `Take <b>${pad2(M.recordings.length)}</b> · <b>${take.duration.toFixed(1)} s</b> · held for Naiva`;
    takeEl.hidden = false;
    takeEl.style.animation = 'none';
    void takeEl.offsetWidth;            // replay the arrival for each new take
    takeEl.style.animation = '';
  }

  let player = null;
  takeEl.querySelector('.tr-take__play').addEventListener('click', (e) => {
    const take = M.recordings[M.recordings.length - 1];
    if (!take) return;
    if (player && !player.paused) { player.pause(); e.target.textContent = 'Play'; return; }
    player = new Audio(take.url);
    player.addEventListener('ended', () => { e.target.textContent = 'Play'; });
    player.play().then(() => { e.target.textContent = 'Pause'; }).catch(() => {});
  });

  if (!canRecord()) {
    recBtn.disabled = true;
    recLabel('Recording unavailable');
  }
  recBtn.addEventListener('click', () => {
    if (rec.recorder && rec.recorder.state === 'recording') stopRecording();
    else startRecording();
  });

  /* ---------------- controls ---------------- */

  function syncInput() {
    count.textContent = `${pad2(input.value.length)} / ${MAX}`;
    count.classList.toggle('is-full', input.value.length >= MAX);
    encodeBtn.disabled = input.value.trim().length === 0;
  }

  function syncRange() {
    rangeEl.textContent = `0–${(fMax() / 1000).toFixed(1)} kHz`;
  }

  input.addEventListener('input', syncInput);

  form.addEventListener('change', (e) => {
    if (e.target.name !== 'spectrum') return;
    bandKey = e.target.value;
    syncRange();
    if (lastPhrase) transmit(lastPhrase);   // re-encode the same phrase for the new listener
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const phrase = input.value.trim().slice(0, MAX);
    if (phrase) transmit(phrase);
  });

  /* ---------------- the lock: hold the engine on screen ----------------
     .tr-pin is sticky; if the engine is taller than the screen it locks as
     soon as its foot is in view (negative top). The rule at its foot fills
     as the hold runs out. */
  const pin = $('trPin');
  const panel = document.getElementById('s-translator');
  const lockEl = $('trLock');
  let pinTop = 0, near = false, lockQueued = false;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const stacked = window.matchMedia('(max-width: 980px)');   // phones/tablets: no lock (see CSS)
  function sizePin() {
    if (!pin) return;
    pinTop = Math.min(0, window.innerHeight - pin.offsetHeight);
    pin.style.setProperty('--pin-top', `${pinTop}px`);
  }
  function syncLock() {
    lockQueued = false;
    if (!pin || !near || stacked.matches) return;
    const r = panel.getBoundingClientRect();
    const hold = Math.max(1, r.height - pin.offsetHeight);
    const p = clamp01((pinTop - r.top) / hold);
    lockEl.style.setProperty('--lock', p.toFixed(4));
    lockEl.style.setProperty('--lock-on', p > 0.001 && p < 0.999 ? '1' : '0');
  }
  if (pin && panel && lockEl) {
    new IntersectionObserver((en) => { near = en[0].isIntersecting; syncLock(); }).observe(panel);
    window.addEventListener('scroll', () => {
      if (near && !lockQueued) { lockQueued = true; requestAnimationFrame(syncLock); }
    }, { passive: true });
  }

  size();
  sizePin();
  syncInput();
  syncRange();
  setStatus('idle');
  window.addEventListener('resize', () => { size(); sizePin(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizePin);
  requestAnimationFrame(frame);
})();
