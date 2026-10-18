/* ============================================================
   MORSIS — speak.js · Naiva's push-to-speak translator
   Hold to record: the microphone is read live (loudness + pitch,
   ~50×/s) while MediaRecorder keeps the take itself. Release:
   the take is split into syllables and each one is rewritten as
   a bird call —
     your pitch     → a note in the 2.6–7.8 kHz avian band
     rise / fall    → the call sweeps the same way
     a long sound   → a trill that follows its contour
     loudness       → how strongly each call sings
   Nothing plays unless something was actually heard.
   API: MORSIS.voice.{supported, start, stop, cancel, level, play}
   ============================================================ */

(() => {
  'use strict';

  const M = (window.MORSIS = window.MORSIS || {});
  M.recordings = M.recordings || [];

  const BAND = { lo: 2600, hi: 7800 };          // where the calls sing
  const VOICE = { lo: 85, hi: 420 };            // the human pitch range it reads
  const MAX_TAKE = 10;                          // seconds; a hold stops itself here

  let rec = null;                               // the take in progress

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  /* ---------------- live analysis ---------------- */

  // autocorrelation pitch on a 2× decimated window: cheap enough to run 50×/s
  function pitchOf(buf, rate) {
    const n = buf.length >> 1;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
    const sr = rate / 2;
    const minLag = Math.floor(sr / VOICE.hi * 0.8), maxLag = Math.min(n - 1, Math.ceil(sr / VOICE.lo * 1.2));
    let e0 = 0;
    for (let i = 0; i < n; i++) e0 += x[i] * x[i];
    if (e0 < 1e-6) return { hz: 0, clarity: 0 };
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0, e1 = 0;
      for (let i = 0; i + lag < n; i++) { s += x[i] * x[i + lag]; e1 += x[i + lag] * x[i + lag]; }
      const c = s / Math.sqrt(e0 * e1 + 1e-12);
      if (c > best) { best = c; bestLag = lag; }
    }
    return { hz: bestLag ? sr / bestLag : 0, clarity: best };
  }

  // opts.onLimit: called once the take reaches MAX_TAKE seconds
  async function start(opts = {}) {
    if (rec || !supported()) return { ok: false, reason: supported() ? 'busy' : 'unsupported' };
    const ctx = M.ensureAudio ? M.ensureAudio() : null;
    if (!ctx) return { ok: false, reason: 'unsupported' };
    const take = { frames: [], chunks: [], level: 0, cancelled: false, t0: 0, onLimit: opts.onLimit };
    rec = take;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      rec = null;
      return { ok: false, reason: err && err.name === 'NotAllowedError' ? 'blocked' : 'nomic' };
    }
    if (take.cancelled) { stream.getTracks().forEach((t) => t.stop()); rec = null; return { ok: false, reason: 'released' }; }

    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);                                   // a silent tap — never to the speakers
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) take.chunks.push(e.data); });
    recorder.start(250);

    const buf = new Float32Array(an.fftSize);
    Object.assign(take, { stream, src, an, recorder, t0: performance.now(), rate: ctx.sampleRate });
    take.timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      const p = rms > 0.004 ? pitchOf(buf, take.rate) : { hz: 0, clarity: 0 };
      take.frames.push({ t: (performance.now() - take.t0) / 1000, rms, hz: p.hz, clarity: p.clarity });
      take.level = Math.min(1, rms * 9);
      if ((performance.now() - take.t0) / 1000 > MAX_TAKE && take.onLimit) { const f = take.onLimit; take.onLimit = null; f(); }
    }, 20);
    return { ok: true };
  }

  function teardown(take) {
    clearInterval(take.timer);
    try { take.src.disconnect(); } catch (_) { /* ok */ }
    if (take.stream) take.stream.getTracks().forEach((t) => t.stop());
  }

  // release before the mic opened (or a deliberate abort): nothing is kept
  function cancel() {
    if (!rec) return;
    rec.cancelled = true;
    if (rec.recorder) {
      const take = rec;
      take.recorder.addEventListener('stop', () => teardown(take), { once: true });
      if (take.recorder.state !== 'inactive') take.recorder.stop(); else teardown(take);
      rec = null;
    }
  }

  function stop() {
    const take = rec;
    if (!take) return Promise.resolve(null);
    if (!take.recorder) { cancel(); return Promise.resolve(null); }   // still waiting for the mic
    rec = null;
    return new Promise((resolve) => {
      take.recorder.addEventListener('stop', () => {
        teardown(take);
        const mime = take.recorder.mimeType || 'audio/webm';
        const blob = new Blob(take.chunks, { type: mime });
        const result = translate(take.frames);
        result.duration = (performance.now() - take.t0) / 1000;
        result.blob = blob;
        result.url = URL.createObjectURL(blob);
        if (!result.silent) {
          M.recordings.push(result);
          window.dispatchEvent(new CustomEvent('morsis:recording', { detail: result }));
        }
        resolve(result);
      }, { once: true });
      take.recorder.stop();
    });
  }

  const level = () => (rec ? rec.level || 0 : 0);

  /* ---------------- voice → bird calls ---------------- */

  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const toBird = (hz) => BAND.lo * Math.pow(BAND.hi / BAND.lo, clamp01(Math.log(hz / VOICE.lo) / Math.log(VOICE.hi / VOICE.lo)));

  function translate(frames) {
    if (frames.length < 4) return { silent: true, notes: [] };
    // a gate above the room's own noise floor
    const floor = median(frames.map((f) => f.rms).sort((a, b) => a - b).slice(0, Math.max(1, frames.length >> 2)));
    const gate = Math.max(0.015, floor * 2.8);
    const loudest = Math.max(...frames.map((f) => f.rms));
    if (loudest < gate * 1.2) return { silent: true, notes: [] };

    // syllables: runs of frames above the gate, bridging gaps under 70 ms
    const segs = [];
    let cur = null;
    frames.forEach((f) => {
      if (f.rms > gate) {
        if (cur && f.t - cur.end <= 0.07) { cur.end = f.t; cur.frames.push(f); }
        else { cur = { start: f.t, end: f.t, frames: [f] }; segs.push(cur); }
      }
    });
    const syll = segs.filter((s) => s.end - s.start >= 0.06);
    if (!syll.length) return { silent: true, notes: [] };

    // rewrite each syllable as a call, closing long pauses to keep it lively
    const notes = [];
    let clock = 0, lastEnd = syll[0].start;
    syll.forEach((s) => {
      clock += Math.min(0.22, Math.max(0.05, s.start - lastEnd));
      lastEnd = s.end;
      const voiced = s.frames.filter((f) => f.hz && f.clarity > 0.55);
      const third = Math.max(1, Math.floor(voiced.length / 3));
      const pHead = median(voiced.slice(0, third).map((f) => f.hz));
      const pTail = median(voiced.slice(-third).map((f) => f.hz));
      const amp = Math.max(0.5, Math.min(1, Math.max(...s.frames.map((f) => f.rms)) / loudest));
      const d = s.end - s.start;
      // unvoiced (hiss, "s", "t"): a bright tink; voiced: the pitch, in the bird's band
      let f0 = voiced.length ? toBird(pHead) : 7000;
      let f1 = voiced.length ? toBird(pTail) : 6200;
      if (Math.abs(f1 / f0 - 1) < 0.06) f1 = f0 * 1.14;     // a flat syllable still lifts like a call
      if (d <= 0.17 || !voiced.length) {
        notes.push({ at: clock, dur: Math.max(0.07, Math.min(0.17, d)), f0, f1, amp });
        clock += Math.min(0.17, d);
      } else {
        // a long sound becomes a trill along its own contour
        const count = Math.min(10, Math.round(d / 0.075));
        for (let i = 0; i < count; i++) {
          const k = count > 1 ? i / (count - 1) : 0;
          const f = f0 * Math.pow(f1 / f0, k) * (i % 2 ? 0.95 : 1.05);
          notes.push({ at: clock + i * 0.075, dur: 0.055, f0: f * 0.92, f1: f * 1.04, amp: amp * (0.85 + 0.15 * (i % 2)) });
        }
        clock += count * 0.075;
      }
    });
    const capped = notes.slice(0, 60);
    const hz = capped.flatMap((n) => [n.f0, n.f1]);
    return {
      silent: false,
      notes: capped,
      calls: syll.length,
      lo: Math.min(...hz),
      hi: Math.max(...hz),
      length: capped.length ? capped[capped.length - 1].at + capped[capped.length - 1].dur : 0,
    };
  }

  /* ---------------- play the calls ---------------- */

  // schedules every note on the audio clock; onNote fires (for visuals) as each sings
  function play(result, source, onNote) {
    if (!result || result.silent || !result.notes.length) return 0;
    if (M.ensureAudio) M.ensureAudio();
    const timers = [];
    result.notes.forEach((n, i) => {
      if (!M.playChirp(n, source, { force: true })) return;
      if (onNote) timers.push(setTimeout(() => onNote(i, n), n.at * 1000));
    });
    return result.length;
  }

  M.voice = { supported, start, stop, cancel, level, play, translate, recording: () => !!rec, elapsed: () => (rec && rec.t0 ? (performance.now() - rec.t0) / 1000 : 0) };
})();
