/* ============================================================
   MORSIS — gate.js · the pre-page, Project: Birdsong
   The Morsis emblem (Assets/Logos/Asset 13.svg) as black liquid
   chrome, raymarched on the bone plate. Its shape is the real
   logo: the SVG is rasterised once into a signed-distance texture
   and swept into round "tubes" that follow every stroke.
     open   a droplet swells and melts into the emblem
     idle   it sways slowly and leans toward the cursor
     enter  it melts back into a droplet, the room lifts away,
            and the WebGL context is released — zero cost after
   ============================================================ */

(() => {
  'use strict';

  const root = document.documentElement;
  const gate = document.getElementById('gate');
  const M = (window.MORSIS = window.MORSIS || {});
  if (!gate) { root.classList.remove('is-gated'); return; }
  // coming back from the speak page straight to the engine: no gate this time
  if (!root.classList.contains('is-gated')) { gate.remove(); M.gated = false; return; }

  M.gated = true;
  const mode = gate.dataset.mode || 'enter';     // 'enter' (index) · 'return' (speak.html)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('gateForm');
  const enterBtn = document.getElementById('gateEnter');
  const stage = gate.querySelector('.gate__stage');

  // the site behind the gate is unreachable until entry (focus, screen readers)
  const behind = [document.querySelector('main'), document.querySelector('.hud')].filter(Boolean);
  behind.forEach((el) => { el.inert = true; });

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // in-out cubic

  /* ---------------- signed-distance texture from the logo ---------------- */

  const N = 448;          // texture size, px
  const WORLD = 2.6;      // world units the texture spans (the emblem is 2.0 wide)
  const RANGE = 16;       // ± px of distance stored (tighter range = finer 8-bit steps)

  // Felzenszwalb–Huttenlocher 1-D squared distance transform
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }
  function edt(grid) {
    const f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) f[y] = grid[y * N + x];
      edt1d(f, N, d, v, z);
      for (let y = 0; y < N; y++) grid[y * N + x] = d[y];
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) f[x] = grid[y * N + x];
      edt1d(f, N, d, v, z);
      for (let x = 0; x < N; x++) grid[y * N + x] = d[x];
    }
  }

  function buildSDF(pathD) {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true });
    const s = (N * (2.0 / WORLD)) / 99.09;               // viewBox 99.09 × 96.13
    x.translate(N / 2 - 49.545 * s, N / 2 - 48.065 * s);
    x.scale(s, s);
    x.fill(new Path2D(pathD));
    const a = x.getImageData(0, 0, N, N).data;
    const inside = new Float64Array(N * N), outside = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const on = a[i * 4 + 3] > 127;
      outside[i] = on ? 0 : 1e20;    // distance to the shape, for pixels outside it
      inside[i] = on ? 1e20 : 0;     // distance to the edge, for pixels inside it
    }
    edt(outside); edt(inside);
    const sd = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) sd[i] = Math.sqrt(outside[i]) - Math.sqrt(inside[i]);
    // two box-blur passes take the pixel staircase out of the field (it would
    // otherwise show as ridges in the chrome's reflections)
    const tmp = new Float32Array(N * N);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 1; y < N - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = y * N + x;
          tmp[i] = (sd[i - N - 1] + sd[i - N] + sd[i - N + 1] + sd[i - 1] + sd[i] + sd[i + 1] +
                    sd[i + N - 1] + sd[i + N] + sd[i + N + 1]) / 9;
        }
      }
      for (let i = 0; i < N * N; i++) if (tmp[i]) sd[i] = tmp[i];
    }
    const out = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) out[i] = Math.round(255 * clamp01(0.5 + sd[i] / (2 * RANGE)));
    return out;
  }

  /* ---------------- the shader ---------------- */

  const VERT = 'attribute vec2 aPos; void main () { gl_Position = vec4(aPos, 0.0, 1.0); }';
  const FRAG = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uMorph;     // 0 emblem → 1 droplet
    uniform vec2 uRot;        // yaw, pitch
    uniform float uScale;
    uniform float uListen;    // live mic level while you speak: the tubes ripple
    uniform sampler2D uSdf;
    const float WORLD = ${WORLD.toFixed(2)};
    const float RANGE_W = ${((2 * RANGE * WORLD) / N).toFixed(5)};

    mat2 rot (float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
    float smin (float a, float b, float k) {
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(b, a, h) - k * h * (1.0 - h);
    }

    // world xy → signed distance to the logo's outline (texture), exact outside its box
    float logo2 (vec2 q) {
      vec2 uv = q / WORLD + 0.5;
      vec2 cl = clamp(uv, 0.0, 1.0);
      float d = (texture2D(uSdf, vec2(cl.x, 1.0 - cl.y)).r - 0.5) * RANGE_W;
      return d + length((uv - cl) * WORLD);
    }

    // every stroke of the logo becomes a round liquid tube
    float emblem (vec3 p) {
      float r = 0.078 + 0.006 * sin(uTime * 1.1 + p.x * 5.0 + p.y * 3.0)
              + uListen * 0.026 * sin(uTime * 17.0 + p.x * 9.0 - p.y * 7.0);
      float dc = max(logo2(p.xy) + r, 0.0);
      return length(vec2(dc, p.z * 1.1)) - r;
    }

    float droplet (vec3 p) {
      float lat = atan(length(p.xz), p.y);
      // while you speak, the droplet's bands ripple with your voice
      float ripple = (0.018 + uListen * 0.05) * sin(lat * 13.0 - uTime * (1.2 + uListen * 5.0)) * sin(lat);
      return length(p) - 0.6 + ripple;
    }

    float map (vec3 p) {
      p /= uScale;
      p.xz *= rot(uRot.x);
      p.yz *= rot(uRot.y);
      float k = uMorph, d;
      if (k <= 0.001) d = emblem(p);
      else if (k >= 0.999) d = droplet(p);
      else {
        // mercury: the strokes thin away while a droplet swells at the centre
        float a = emblem(p) + 0.14 * smoothstep(0.0, 0.6, k);
        float b = droplet(p) + 0.6 * (1.0 - smoothstep(0.4, 1.0, k));
        float drop = length(p) - 0.62 * sin(3.14159 * k);
        d = smin(smin(a, b, 0.18), drop, 0.32);
      }
      return d * uScale;
    }

    vec3 normalAt (vec3 p) {
      vec2 e = vec2(0.004, -0.004);     // ~0.7 texel: smooths the field's 8-bit steps
      return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
                       e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
    }

    // the room the black liquid reflects: bright fog above, a dark floor
    vec3 env (vec3 d) {
      vec3 c = mix(vec3(0.05, 0.05, 0.06), vec3(0.93, 0.925, 0.905), smoothstep(-0.35, 0.55, d.y));
      return c * (0.55 + 0.45 * smoothstep(-0.2, 0.9, d.y));
    }

    void main () {
      vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
      vec3 ro = vec3(0.0, 0.0, 5.2);
      vec3 rd = normalize(vec3(uv, -1.9));
      float pix = 1.0 / (uRes.y * 1.9);

      // skip rays that miss the bounding sphere entirely (most of the canvas)
      float bR = 1.5 * uScale;
      float bb = dot(ro, rd), cc = dot(ro, ro) - bR * bR;
      if (bb * bb - cc < 0.0) { gl_FragColor = vec4(0.0); return; }

      float t = max(0.0, -bb - sqrt(bb * bb - cc));
      float m = 1e9;
      bool hit = false;
      for (int i = 0; i < 110; i++) {
        float d = map(ro + rd * t);
        m = min(m, d / max(t, 0.5));
        if (d < 0.0008 * t) { hit = true; break; }
        t += d * 0.8;
        if (t > 8.5) break;
      }
      if (!hit) {
        // soft silhouette: the closest miss still covers part of the pixel
        float a = 1.0 - smoothstep(0.0, pix * 1.6, m);
        gl_FragColor = vec4(vec3(0.03) * a, a);
        return;
      }

      vec3 p = ro + rd * t;
      vec3 n = normalAt(p);
      vec3 rf = reflect(rd, n);
      float cosv = max(dot(n, -rd), 0.0);
      float F = 0.05 + 0.95 * pow(1.0 - cosv, 5.0);
      float ao = clamp(map(p + n * 0.1) / 0.06, 0.0, 1.0);
      float key = pow(max(dot(rf, normalize(vec3(-0.55, 0.7, 0.45))), 0.0), 36.0);
      float strip = smoothstep(0.07, 0.0, abs(rf.x + 0.28)) * smoothstep(0.0, 0.6, rf.y);
      float rim = pow(max(dot(rf, normalize(vec3(0.9, 0.25, -0.35))), 0.0), 10.0);
      vec3 spec = vec3(1.0) * (key * 1.9 + strip * 0.85 + rim * 0.5) * (0.55 + 0.45 * F);
      vec3 col = vec3(0.012, 0.012, 0.014) + (env(rf) * F + spec) * (0.45 + 0.55 * ao);
      gl_FragColor = vec4(col, 1.0);
    }`;

  /* ---------------- WebGL setup ---------------- */

  let gl = null, U = null;

  function setup(sdf) {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return false; }
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, N, N, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, sdf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    U = {};
    ['uRes', 'uTime', 'uMorph', 'uRot', 'uScale', 'uListen', 'uSdf'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.uSdf, 0);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  function resize() {
    if (!gl) return;
    // ~1 device pixel per CSS pixel, capped: the silhouette is analytically smoothed
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const side = Math.min(stage.clientWidth * dpr, 900);
    canvas.width = canvas.height = Math.max(2, Math.round(side));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  /* ---------------- motion ---------------- */

  let t0 = performance.now();              // reset when the emblem is ready to show
  let morph = reduced ? 0 : 1;            // starts as a droplet
  let scale = reduced ? 1 : 0.0001;
  let leaving = null;                      // { t0 } once entry starts
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let running = true;

  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const t = (now - t0) / 1000;

    if (leaving) {
      // melt back into a droplet, then let it sink away with the room
      const k = clamp01((now - leaving.t0) / 900);
      morph = ease(k);
      scale = 1 - 0.35 * ease(clamp01((now - leaving.t0 - 500) / 700));
    } else {
      // a droplet appears, then condenses into the emblem
      const intro = reduced ? 0 : 1 - ease(clamp01((t - 0.75) / 1.5));
      if (!reduced) scale = 0.0001 + 0.9999 * ease(clamp01((t - 0.25) / 0.7));
      // holding to speak: the emblem collapses into the droplet, and re-forms on release
      const dt = Math.min(0.05, (now - (lastNow || now)) / 1000);
      press += ((holding ? 1 : 0) - press) * (reduced ? 1 : Math.min(1, dt * (holding ? 7 : 4.5)));
      morph = Math.max(intro, ease(clamp01(press)));
    }
    lastNow = now;

    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    const sway = reduced ? 0 : Math.sin(t * 0.45) * 0.32;
    const yaw = sway + pointer.x * 0.28;
    const pitch = pointer.y * 0.16 + (reduced ? 0 : Math.sin(t * 0.31) * 0.06);

    // speaking: the tubes ripple with your voice; singing: each call is a beat
    const lv = M.voice ? M.voice.level() : 0;
    listen += (lv - listen) * (lv > listen ? 0.35 : 0.08);
    sing *= 0.9;
    if (M.voice && M.voice.recording()) updateTimer();
    const beat = 1 + 0.055 * sing + 0.03 * listen;

    stage.style.setProperty('--shadow', (scale * (1 - morph * 0.4)).toFixed(3));
    stage.style.setProperty('--shadow-w', (0.55 + 0.45 * (1 - morph) * Math.cos(yaw)).toFixed(3));
    if (flatEl && gate.classList.contains('gate--flat')) flatEl.style.transform = beat > 1.001 ? `scale(${beat.toFixed(3)})` : '';

    if (!gl || !U) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, reduced ? 0 : t);
    gl.uniform1f(U.uMorph, morph);
    gl.uniform2f(U.uRot, yaw, pitch);
    gl.uniform1f(U.uScale, Math.max(0.0001, scale * beat));
    gl.uniform1f(U.uListen, reduced ? 0 : listen);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ---------------- push to speak (scripts/speak.js) ----------------
     Hold the emblem (or Space / Enter while it has focus): Naiva listens.
     Release: what you said comes back as bird calls. If nothing was
     heard, nothing plays. */

  let listen = 0, sing = 0, press = 0, lastNow = 0;
  const flatEl = gate.querySelector('.gate__flat');
  const sayEl = document.getElementById('gateSay');
  const sayText = sayEl ? sayEl.querySelector('span') : null;
  let holding = false, busy = false, sayTimer = 0;

  function say(text, state, revertMs) {
    if (!sayEl) return;
    clearTimeout(sayTimer);
    sayText.textContent = text;
    sayEl.dataset.state = state || '';
    if (revertMs) sayTimer = setTimeout(() => say('Press and hold the emblem to speak', ''), revertMs);
  }
  function updateTimer() {
    const s = M.voice.elapsed();
    sayText.textContent = `Listening · ${String(Math.floor(s)).padStart(2, '0')}.${Math.floor((s % 1) * 10)} s`;
  }
  const kHz = (hz) => (hz / 1000).toFixed(1);

  async function beginSpeak() {
    if (holding || busy || leaving || !M.voice) return;
    if (!M.voice.supported()) { say('Speaking needs a microphone', 'error', 3200); return; }
    holding = true;
    say('Opening the microphone', 'listening');
    const res = await M.voice.start({ onLimit: () => endSpeak() });
    if (!res.ok) {
      holding = false;
      if (res.reason === 'blocked') say('Microphone blocked — allow it to speak', 'error', 4200);
      else if (res.reason === 'nomic') say('No microphone found', 'error', 3200);
      else if (res.reason === 'released') say('Microphone ready — press and hold to speak', '', 3200);
      return;
    }
    if (!holding) { M.voice.cancel(); return; }      // let go while the mic was opening
    say('Listening · 00.0 s', 'listening');
  }

  async function endSpeak() {
    if (!holding) return;
    holding = false;
    if (!M.voice.recording()) return;
    busy = true;
    say('Translating to birdsong', 'listening');
    const result = await M.voice.stop();
    if (!result || result.silent) {
      busy = false;
      say('No sound heard — hold and speak', 'quiet', 3200);
      return;
    }
    say(`Naiva · ${result.calls} call${result.calls === 1 ? '' : 's'} · ${kHz(result.lo)}–${kHz(result.hi)} kHz`, 'singing');
    const len = M.voice.play(result, 'gate', () => { sing = 1; });
    setTimeout(() => { busy = false; say('Hold to speak again', '', 2600); }, (len + 0.4) * 1000);
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    beginSpeak();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => stage.addEventListener(ev, endSpeak));
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); beginSpeak(); }
  });
  stage.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endSpeak(); }
  });

  /* ---------------- entry ---------------- */

  function enter() {
    if (leaving) return;
    if (M.voice && M.voice.recording()) { holding = false; M.voice.cancel(); }
    leaving = { t0: performance.now() };
    enterBtn.disabled = true;

    // the speak page: melt the emblem, then go back to the engine
    if (mode === 'return') {
      enterBtn.querySelector('.gate__enter-label').textContent = 'Returning to Naiva';
      gate.classList.add('is-leaving-soft');
      setTimeout(() => { window.location.href = enterBtn.dataset.href || 'index.html?return=engine'; }, reduced ? 0 : 750);
      return;
    }

    enterBtn.querySelector('.gate__enter-label').textContent = 'Entering Project: Birdsong';
    // entering is the visitor's click: switch sound on now, inside the gesture,
    // so the hero's chirps are audible (they can mute it in the hero or the engine)
    if (M.setSound) M.setSound(true);
    setTimeout(() => {
      gate.classList.add('is-leaving');
      root.classList.remove('is-gated');
      behind.forEach((el) => { el.inert = false; });
      M.gated = false;
      window.dispatchEvent(new CustomEvent('morsis:enter'));
    }, reduced ? 0 : 650);
    setTimeout(() => {
      running = false;
      const lose = gl && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();             // give the GPU back to the site
      gate.remove();
    }, reduced ? 350 : 1750);
  }
  enterBtn.addEventListener('click', enter);

  /* ---------------- boot ---------------- */

  function flat() {
    gate.classList.add('gate--flat');
    stage.style.setProperty('--shadow', '1');
  }

  requestAnimationFrame(() => {
    gate.classList.add('is-ready');
    setTimeout(() => gate.classList.add('is-settled'), 2300);
  });
  try { enterBtn.focus({ preventScroll: true }); } catch (_) { /* ok */ }

  fetch('Assets/Logos/Asset%2013.svg')
    .then((r) => r.text())
    .then((svg) => {
      const ds = Array.from(svg.matchAll(/\sd="([^"]+)"/g)).map((m) => m[1]);
      if (!ds.length || !setup(buildSDF(ds.join(' ')))) { flat(); return; }
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); U = null; if (!leaving) flat(); });
      resize();
      window.addEventListener('resize', resize);
    })
    .catch(flat)
    .finally(() => { t0 = performance.now(); requestAnimationFrame(frame); });
})();
