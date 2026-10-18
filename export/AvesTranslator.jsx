/* ============================================================
   MORSIS — AvesTranslator.jsx
   Standalone React + Tailwind version of the site's Section 04
   "Aves Signal Translator". Same encoding as the live site:
   each glyph → a log-spaced tone inside the chosen avian band.

   Requirements: React 18+, Tailwind CSS (arbitrary values on).
   Font: ITC Avant Garde Std, loaded by the host page as
   "Avant Garde" (falls back to Century Gothic).

   Audio: playAvianFrequency() is the hook — replace its body with
   sample playback or a synth patch; every caller stays the same.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* [Design Note: palette is the brief's — Obsidian #0B0C0E ground, Raw Bone
   #E5E3DC type, Vermilion #FF4800 spent only on live state (encoding dot,
   active glyph, peak energy, full counter).] */
const C = { void: '#0B0C0E', bone: '#E5E3DC', mid: '#8A8983', signal: '#FF4800' };
const FONT = '"Avant Garde", "Century Gothic", sans-serif';

const SPECTRA = [
  { key: 'passeriformes', latin: 'Passeriformes', common: 'Songbird', lo: 8000, hi: 16000, harm: [1, 0.32], fid: 0 },
  { key: 'psittaciformes', latin: 'Psittaciformes', common: 'Resonance', lo: 2000, hi: 8000, harm: [1, 0.55, 0.34, 0.2], fid: -0.8 },
  { key: 'raptores', latin: 'Raptores', common: 'Infrasound', lo: 400, hi: 2000, harm: [1, 0.6, 0.42, 0.28, 0.16], fid: -2.2 },
];

const MAX = 48;
const VOWELS = 'AEIOUY';

/* ---------------- encoding ---------------- */

function glyphNorm(ch) {
  const c = ch.toUpperCase();
  if (c === ' ') return null;
  const L = c.charCodeAt(0) - 65;
  if (L >= 0 && L < 26) return L / 25;
  const D = c.charCodeAt(0) - 48;
  if (D >= 0 && D < 10) return (D + 0.5) / 10;
  return ((c.charCodeAt(0) * 37) % 100) / 100;
}

export function encode(phrase, lo, hi) {
  return Array.from(phrase).map((ch) => {
    const n = glyphNorm(ch);
    if (n === null) return { ch, rest: true, dur: 110 };
    const vowel = VOWELS.includes(ch.toUpperCase());
    const letter = /[a-z]/i.test(ch);
    return {
      ch,
      rest: false,
      norm: n,
      hz: lo * Math.pow(hi / lo, n),                 // log spacing across the band
      amp: vowel ? 1 : letter ? 0.75 : 0.55,
      dur: vowel ? 210 : letter ? 130 : 90,          // vowels sustain, stops are short
    };
  });
}

function metricsFor(seq, phrase, spec) {
  const tones = seq.filter((s) => !s.rest);
  if (!tones.length) return null;
  const peak = Math.max(...tones.map((s) => s.hz));
  const SIMPLE = [1, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 2];
  let score = 0;
  for (let i = 1; i < tones.length; i++) {
    const r = Math.max(tones[i - 1].hz, tones[i].hz) / Math.min(tones[i - 1].hz, tones[i].hz);
    score += 1 - Math.min(Math.min(...SIMPLE.map((s) => Math.abs(r / s - 1))) / 0.03, 1);
  }
  const hri = tones.length > 1 ? 0.35 + 0.65 * (score / (tones.length - 1)) : 0.5;
  const punct = (phrase.match(/[^a-z0-9\s]/gi) || []).length;
  const fid = Math.max(84, Math.min(99.4, 99.2 - punct * 0.9 - Math.max(0, phrase.length - 28) * 0.15 + spec.fid));
  const disp = 0.0105 * Math.pow(peak / 1000, 1.18);   // air absorption, ≈ dB per metre
  return { peak: peak / 1000, hri, fid, disp };
}

function sigId(text) {
  let h = 0x811c9dc5;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  const hex = h.toString(16).toUpperCase().padStart(8, '0');
  return `SIG-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/* ---------------- audio hook ---------------- */

export function playAvianFrequency(ctx, hz, durMs, amp = 1) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(hz, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.035 * amp, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}

/* ---------------- small pieces ---------------- */

function Bracket({ pos }) {
  const map = {
    tl: '-left-[7px] -top-[7px] border-l border-t',
    tr: '-right-[7px] -top-[7px] border-r border-t',
    bl: '-left-[7px] -bottom-[7px] border-l border-b',
    br: '-right-[7px] -bottom-[7px] border-r border-b',
  };
  return <i aria-hidden className={`pointer-events-none absolute h-3.5 w-3.5 border-[#E5E3DC]/50 ${map[pos]}`} />;
}

const meta = 'text-[10px] font-medium uppercase tracking-[0.16em] text-[#8A8983]';

function useCountUp(target, digits) {
  const [shown, setShown] = useState(null);
  const from = useRef(0);
  useEffect(() => {
    if (target == null) return undefined;
    const start = performance.now();
    const a = from.current;
    let id = 0;
    const step = (now) => {
      const k = 1 - Math.pow(1 - Math.min(1, (now - start) / 900), 3);   // ease-out
      const v = a + (target - a) * k;
      setShown(v);
      if (k < 1) id = requestAnimationFrame(step);
      else from.current = target;
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target]);
  return shown == null ? '—' : shown.toFixed(digits);
}

function Metric({ label, value, digits, unit }) {
  const text = useCountUp(value, digits);
  return (
    <div className="grid content-between gap-2.5 bg-[#0D0E11] px-3.5 pb-3 pt-3.5">
      <dt className="min-h-[2.6em] text-[9.5px] font-medium uppercase leading-tight tracking-[0.14em] text-[#8A8983]">{label}</dt>
      <dd className="m-0 flex items-baseline gap-1.5">
        <span className="text-[34px] font-extralight leading-none tracking-[-0.03em] text-[#E5E3DC] tabular-nums">{text}</span>
        <small className="text-[10px] font-medium tracking-[0.08em] text-[#8A8983]">{unit}</small>
      </dd>
    </div>
  );
}

/* ---------------- component ---------------- */

export default function AvesTranslator() {
  const [phrase, setPhrase] = useState('');
  const [specKey, setSpecKey] = useState('passeriformes');
  const [status, setStatus] = useState('idle');
  const [seq, setSeq] = useState([]);
  const [active, setActive] = useState(-1);
  const [metrics, setMetrics] = useState(null);
  const [sig, setSig] = useState('SIG — awaiting input');
  const [soundOn, setSoundOn] = useState(false);

  const spec = useMemo(() => SPECTRA.find((s) => s.key === specKey), [specKey]);
  const scopeRef = useRef(null);
  const spectroRef = useRef(null);
  const seqRef = useRef(null);
  const toneRef = useRef(null);
  const specRef = useRef(spec);
  const runRef = useRef(0);
  const audioRef = useRef(null);
  const soundRef = useRef(false);
  const timers = useRef([]);

  specRef.current = spec;

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const transmit = useCallback((text, s) => {
    const sq = encode(text, s.lo, s.hi);
    if (!sq.length) return;
    const id = ++runRef.current;
    clearTimers();
    setSeq(sq);
    setMetrics(metricsFor(sq, text, s));
    setSig(`${sigId(`${s.key}:${text}`)} · ${sq.filter((x) => !x.rest).length} tones · ${s.key}`);
    setStatus('encoding');

    let t = 0;
    sq.forEach((g, i) => {
      timers.current.push(setTimeout(() => {
        if (id !== runRef.current) return;
        setActive(i);
        toneRef.current = g.rest ? null : g;
        if (!g.rest && soundRef.current) playAvianFrequency(audioRef.current, g.hz, g.dur, g.amp);
      }, t));
      t += g.dur;
    });
    timers.current.push(setTimeout(() => {
      if (id !== runRef.current) return;
      toneRef.current = null;
      setActive(-1);
      setStatus('locked');
    }, t));
  }, []);

  // keep the active glyph centred in the sequence strip
  useEffect(() => {
    const ol = seqRef.current;
    const li = ol && ol.children[active];
    if (li) ol.scrollLeft = li.offsetLeft - ol.clientWidth / 2 + li.clientWidth / 2;
  }, [active]);

  useEffect(() => () => clearTimers(), []);

  /* canvases: phosphor oscilloscope + waterfall spectrogram */
  useEffect(() => {
    const scope = scopeRef.current;
    const spectro = spectroRef.current;
    const sctx = scope.getContext('2d');
    const pctx = spectro.getContext('2d');
    let dpr = 1, column, raf = 0, last = performance.now();
    let amp = 0.06, cyc = 4, phase = 0;

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      [scope, spectro].forEach((c) => { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; });
      pctx.fillStyle = C.void;
      pctx.fillRect(0, 0, spectro.width, spectro.height);
      column = pctx.createImageData(Math.max(1, Math.round(2 * dpr)), spectro.height);
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tone = toneRef.current;
      const harm = specRef.current.harm;
      const W = scope.width, H = scope.height, mid = H / 2;

      sctx.fillStyle = 'rgba(11, 12, 14, 0.34)';
      sctx.fillRect(0, 0, W, H);
      amp += ((tone ? 0.3 + tone.amp * 0.55 : 0.05) - amp) * Math.min(1, dt * 10);
      cyc += ((tone ? 3 + tone.norm * 11 : 4) - cyc) * Math.min(1, dt * 12);
      phase += dt * (3 + cyc * 0.6);
      const sum = harm.reduce((a, b) => a + b, 0);
      sctx.save();
      sctx.shadowColor = 'rgba(229, 227, 220, 0.8)';
      sctx.shadowBlur = 8 * dpr;
      sctx.strokeStyle = 'rgba(236, 234, 228, 0.95)';
      sctx.lineWidth = 1.4 * dpr;
      sctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const u = x / W;
        let v = 0;
        harm.forEach((h, k) => { v += h * Math.sin(Math.PI * 2 * (k + 1) * cyc * u + (k + 1) * phase); });
        v = v / sum + (tone ? 0 : (Math.random() - 0.5) * 0.4);
        const y = mid - v * amp * H * 0.42 * Math.sin(Math.PI * u) ** 0.35;
        x ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
      }
      sctx.stroke();
      sctx.restore();

      const SW = spectro.width, SH = spectro.height, cw = column.width;
      pctx.drawImage(spectro, -cw, 0);
      const d = column.data;
      const fm = specRef.current.hi * 1.6;
      const bw = fm * 0.011;
      for (let y = 0; y < SH; y++) {
        const f = (1 - y / SH) * fm;
        let v = Math.random() * 0.05;
        if (tone) harm.forEach((h, k) => { const df = (f - tone.hz * (k + 1)) / bw; v += tone.amp * h * Math.exp(-df * df); });
        v = Math.min(1, v);
        const hot = v > 0.82;
        for (let x = 0; x < cw; x++) {
          const o = (y * cw + x) * 4;
          d[o] = hot ? 255 : 11 + v * 218;
          d[o + 1] = hot ? 72 : 12 + v * 215;
          d[o + 2] = hot ? 0 : 14 + v * 206;
          d[o + 3] = 255;
        }
      }
      pctx.putImageData(column, SW - cw, 0);
    };

    size();
    window.addEventListener('resize', size);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size); };
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    const text = phrase.trim().slice(0, MAX);
    if (text) transmit(text, spec);
  };

  const onSpectrum = (s) => {
    setSpecKey(s.key);
    const text = phrase.trim();
    if (text && status !== 'idle') transmit(text, s);   // re-encode for the new listener
  };

  const toggleSound = () => {
    const next = !soundOn;
    // create/resume inside the click so browsers' autoplay rules are satisfied
    if (next) {
      if (!audioRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioRef.current = new AC();
      }
      if (audioRef.current && audioRef.current.state === 'suspended') audioRef.current.resume();
    }
    soundRef.current = next;
    setSoundOn(next);
  };

  const statusColor = status === 'encoding' ? 'text-[#FF4800]' : status === 'locked' ? 'text-[#E5E3DC]' : 'text-[#8A8983]';
  const dotColor = status === 'encoding' ? 'bg-[#FF4800] animate-pulse' : status === 'locked' ? 'bg-[#E5E3DC]' : 'bg-[#8A8983]';

  return (
    <section
      className="relative overflow-hidden bg-[#0B0C0E] px-5 py-28 text-[#E5E3DC] md:px-12"
      style={{ fontFamily: FONT }}
      aria-labelledby="aves-title"
    >
      {/* [Design Note: grey fog bleeds in from the left, like the "Futuristic" poster,
          so the glass instrument has something to refract.] */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_0%_28%,rgba(229,227,220,0.13),transparent_70%)]" />

      <div className="relative mx-auto grid max-w-[1280px] gap-11 lg:grid-cols-[5fr_7fr] lg:gap-x-20">
        <div>
          <p className={`mb-4 ${meta} tracking-[0.22em]`}>Primary feature // Interactive demo</p>
          {/* [Design Note: display type = Avant Garde Bold, lowercase, -0.055em, set solid.] */}
          <h2 id="aves-title" className="m-0 text-[clamp(46px,6vw,98px)] font-bold leading-[0.86] tracking-[-0.055em]">
            <span className="block">aves signal</span>
            <span className="block">translator.</span>
          </h2>
          <p className="mt-6 max-w-[46ch] text-base leading-relaxed text-[#8A8983]">
            Type a human phrase. Morsis encodes each glyph as a tone inside the avian band you choose,
            then models how the signal would travel through open air.
          </p>

          <form onSubmit={onSubmit} className="mt-11" autoComplete="off">
            <label htmlFor="aves-input" className={`mb-2.5 block ${meta}`}>Human phrase</label>
            <div className="relative">
              <input
                id="aves-input"
                value={phrase}
                maxLength={MAX}
                spellCheck={false}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="Enter human phrase to synthesize..."
                className="h-[58px] w-full rounded-md border border-[#E5E3DC]/15 bg-white/[0.025] pl-[18px] pr-20 text-base font-medium text-[#E5E3DC] outline-none transition placeholder:text-[#8A8983] focus:border-[#E5E3DC]/50 focus:shadow-[0_0_0_4px_rgba(229,227,220,0.05)]"
              />
              <span className={`absolute right-[18px] top-1/2 -translate-y-1/2 text-[10px] font-medium tracking-[0.12em] tabular-nums ${phrase.length >= MAX ? 'text-[#FF4800]' : 'text-[#8A8983]'}`}>
                {String(phrase.length).padStart(2, '0')} / {MAX}
              </span>
            </div>

            <fieldset className="mt-7 grid gap-2.5 border-0 p-0 sm:grid-cols-3">
              <legend className={`mb-2.5 ${meta}`}>Target avian spectrum</legend>
              {SPECTRA.map((s) => {
                const on = s.key === specKey;
                return (
                  <label
                    key={s.key}
                    className={`relative grid cursor-pointer gap-0.5 rounded-md border px-3.5 pb-3 pt-3.5 transition active:scale-[0.98] has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-[#FF4800] ${on ? 'border-[#E5E3DC]/60 bg-[#E5E3DC]/[0.06]' : 'border-[#E5E3DC]/15 bg-white/[0.02] hover:border-[#E5E3DC]/35'}`}
                  >
                    <input type="radio" name="spectrum" value={s.key} checked={on} onChange={() => onSpectrum(s)} className="absolute opacity-0" />
                    {on && <span aria-hidden className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full bg-[#FF4800]" />}
                    <span className="text-[13px] font-semibold tracking-[-0.01em]">{s.latin}</span>
                    <span className="text-[13px] font-extralight italic text-[#8A8983]">{s.common}</span>
                    <span className="mt-2 text-[10px] font-medium tracking-[0.1em] text-[#8A8983] tabular-nums">
                      {(s.lo / 1000).toFixed(1)}–{(s.hi / 1000).toFixed(1)} kHz
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!phrase.trim()}
                className="h-[52px] rounded-full bg-[#E5E3DC] px-[26px] text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#0B0C0E] transition hover:bg-white active:scale-[0.97] disabled:cursor-default disabled:opacity-35"
              >
                Encode &amp; Modulate Signal
              </button>
              <button
                type="button"
                aria-pressed={soundOn}
                onClick={toggleSound}
                className={`h-[52px] rounded-full border px-[26px] text-[10.5px] font-semibold uppercase tracking-[0.16em] transition active:scale-[0.97] ${soundOn ? 'border-[#FF4800]/60 text-[#FF4800]' : 'border-[#E5E3DC]/20 text-[#8A8983] hover:text-[#E5E3DC]'}`}
              >
                Sound · {soundOn ? 'on' : 'off'}
              </button>
            </div>
          </form>
        </div>

        {/* [Design Note: one glass instrument, three readings of the same signal —
            time (oscilloscope), frequency over time (spectrogram), summary (metrics).
            Corner brackets frame it like a specimen under measurement.] */}
        <div className="relative self-start rounded border border-[#E5E3DC]/[0.12] bg-gradient-to-b from-white/[0.04] to-white/[0.012] px-[18px] pb-[18px] pt-4 backdrop-blur-md lg:sticky lg:top-[88px]">
          <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />

          <div className={`mx-0.5 mb-2.5 flex items-center justify-between ${meta}`}>
            <span>CH.04 · Oscilloscope</span>
            <span className={`inline-flex items-center gap-2 ${statusColor}`}>
              <i className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
              {status === 'idle' ? 'Idle' : status === 'encoding' ? 'Encoding' : 'Locked'}
            </span>
          </div>
          <canvas ref={scopeRef} aria-label="Oscilloscope trace" className="mb-[18px] block h-[clamp(140px,19vh,200px)] w-full rounded-sm bg-[#0B0C0E]" />

          <div className={`mx-0.5 mb-2.5 flex items-center justify-between ${meta}`}>
            <span>Spectrogram · waterfall</span>
            <span className="tabular-nums">0–{((spec.hi * 1.6) / 1000).toFixed(1)} kHz</span>
          </div>
          <canvas ref={spectroRef} aria-label="Scrolling spectrogram" className="mb-3.5 block h-[clamp(120px,16vh,176px)] w-full rounded-sm bg-[#0B0C0E]" />

          <ol ref={seqRef} aria-label="Encoded glyph sequence" className="m-0 mb-3.5 flex min-h-[54px] list-none gap-1.5 overflow-x-auto p-0 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,#000_5%,#000_95%,transparent)]">
            {seq.map((g, i) => (
              <li
                key={`${i}-${g.ch}`}
                className={`grid min-w-[46px] flex-none justify-items-center gap-[3px] rounded border px-2 pb-1.5 pt-[7px] transition ${i === active ? 'border-[#FF4800] bg-[#FF4800]/[0.08]' : 'border-[#E5E3DC]/10'}`}
              >
                <b className={`text-base font-bold leading-none ${g.rest ? 'text-[#8A8983]' : ''}`}>{g.rest ? '·' : g.ch}</b>
                <span className={`text-[9px] font-medium tracking-[0.06em] tabular-nums ${i === active ? 'text-[#FF4800]' : 'text-[#8A8983]'}`}>
                  {g.rest ? 'rest' : (g.hz / 1000).toFixed(2)}
                </span>
              </li>
            ))}
          </ol>

          <dl className="m-0 grid grid-cols-2 gap-px border border-[#E5E3DC]/10 bg-[#E5E3DC]/10 xl:grid-cols-4">
            <Metric label="Frequency peak" value={metrics?.peak} digits={2} unit="kHz" />
            <Metric label="Harmonic resonance index" value={metrics?.hri} digits={3} unit="HRI" />
            <Metric label="Signal fidelity" value={metrics?.fid} digits={1} unit="%" />
            <Metric label="Acoustic dispersion rate" value={metrics?.disp} digits={3} unit="dB/m" />
          </dl>

          <div className={`mt-3.5 flex items-center justify-between gap-4 tabular-nums ${meta} tracking-[0.12em]`}>
            <span aria-hidden className="h-[22px] w-[140px] bg-[repeating-linear-gradient(90deg,#E5E3DC_0_1px,transparent_1px_3px,#E5E3DC_3px_5px,transparent_5px_6px)] opacity-70" />
            <span>{sig}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
