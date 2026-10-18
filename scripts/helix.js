/* ============================================================
   MORSIS — helix.js · Section 03, core research pillars
   A raymarched form in glossy black "liquid chrome" on a bone fog
   plate (Atomic Sleep poster language). The form MORPHS as the
   visitor scrolls through the three pillars — signed-distance
   fields blend, so one shape melts into the next:
     P.01 frequency synthesis  → a double helix (two signal strands)
     P.02 harmonic intent      → three interlocked orbit rings,
                                 the emblem's own geometry, in 3D
     P.03 silent contact       → a liquid sphere carrying standing
                                 waves: sound through air, no touch
   Text, numerals and the pillar rail cross-fade on the same scroll,
   so the whole scene can be scrubbed and reversed at any point.
   ============================================================ */

(() => {
  'use strict';

  const plate = document.getElementById('plate');
  const canvas = document.getElementById('helix');
  if (!plate || !canvas) return;

  const M = (window.MORSIS = window.MORSIS || {});
  M.onScene = M.onScene || {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const span = (r, a, b) => clamp01((r - a) / (b - a));

  const pillars = Array.from(plate.querySelectorAll('.plate__pillar'));
  const statuses = Array.from(plate.querySelectorAll('.status-set'));
  const numerals = Array.from(plate.querySelectorAll('.plate__num span'));
  const rail = Array.from(plate.querySelectorAll('.plate__rail li'));
  const idxEl = document.getElementById('pillarIdx');
  const furniture = Array.from(plate.querySelectorAll('.plate__top, .plate__bottom'));

  /* ---------------- scroll choreography ---------------- */

  // [in, out] windows in pillars-scene progress; the last stays until covered
  const WIN = [
    { in: [0.04, 0.12], out: [0.36, 0.42] },
    { in: [0.44, 0.5], out: [0.68, 0.74] },
    { in: [0.76, 0.82], out: null },
  ];
  // each pillar's share of the run, for its rail bar
  const RUN = [[0.04, 0.42], [0.42, 0.74], [0.74, 1.0]];
  // shape morphs ride between the text windows
  const MORPH = [[0.36, 0.5], [0.68, 0.82]];

  let scrollR = 0;
  let openK = 0;
  let morph = 0;
  let lastIdx = -1;

  M.onScene.pillars = (r, sec, f) => {
    scrollR = r;
    const arrive = f ? f.arrive : clamp01(1 + r);

    // the plate opens from a small specimen window into a full-width band
    const o = arrive < 1 ? 0.65 * arrive : 0.65 + 0.35 * span(r, 0, 0.1);
    openK = smooth(o);
    const iy = (1 - openK) * 24, ix = (1 - openK) * 32, rad = (1 - openK) * 10;
    plate.style.clipPath = `inset(${iy.toFixed(2)}% ${ix.toFixed(2)}% round ${rad.toFixed(1)}px)`;

    const furn = smooth(span(r, 0.0, 0.1));
    furniture.forEach((el) => { el.style.opacity = furn.toFixed(3); });

    morph = smooth(span(r, MORPH[0][0], MORPH[0][1])) + smooth(span(r, MORPH[1][0], MORPH[1][1]));

    let best = 0, bestK = -1;
    WIN.forEach((w, p) => {
      const inK = smooth(span(r, w.in[0], w.in[1]));
      const outK = w.out ? smooth(span(r, w.out[0], w.out[1])) : 0;
      const k = inK * (1 - outK);
      if (k > bestK) { bestK = k; best = p; }

      [pillars[p], statuses[p]].forEach((el) => {
        el.style.opacity = k.toFixed(3);
        el.style.visibility = k < 0.002 ? 'hidden' : '';
      });
      if (!reduced) {
        pillars[p].style.transform = `translateY(${(28 * (1 - inK) - 28 * outK).toFixed(2)}px)`;
        pillars[p].style.filter = k < 0.999 ? `blur(${((1 - k) * 8).toFixed(1)}px)` : '';
        numerals[p].style.transform = `translateY(${(60 * (1 - inK) - 60 * outK).toFixed(1)}px)`;
      }
      numerals[p].style.opacity = k.toFixed(3);

      const li = rail[p];
      li.style.setProperty('--fill', span(r, RUN[p][0], RUN[p][1]).toFixed(4));
      li.classList.toggle('is-active', k > 0.5);
    });

    if (best !== lastIdx && idxEl) {
      lastIdx = best;
      idxEl.textContent = String(best + 1).padStart(2, '0');
    }
  };

  /* ---------------- WebGL raymarcher ---------------- */

  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) {
    plate.classList.add('plate--flat');
    console.warn('[Morsis] Pillars: no WebGL context — showing the flat plate.');
    return;
  }

  const VERT = `
    attribute vec2 aPos;
    void main () { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uRot;
    uniform float uShift;
    uniform float uDist;
    uniform float uMorph;   // 0 helix → 1 rings → 2 sphere

    mat2 rot (float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

    float smin (float a, float b, float k) {
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(b, a, h) - k * h * (1.0 - h);
    }

    float capX (vec3 p, float hl, float r) {
      p.x -= clamp(p.x, -hl, hl);
      return length(p) - r;
    }

    float torus (vec3 p, float R, float r) {
      return length(vec2(length(p.xz) - R, p.y)) - r;
    }

    // P.01 — two strands joined by split, melted rungs
    float helix (vec3 p) {
      p.xy *= rot(0.2);
      p.xz *= rot(uRot);
      vec3 q = p;
      q.xz *= rot(q.y * 0.95);
      float R = 1.05;
      float d = min(length(q.xz - vec2(R, 0.0)), length(q.xz + vec2(R, 0.0))) - 0.24;
      float per = 0.66;
      vec3 r = q;
      r.y = mod(r.y + per * 0.5, per) - per * 0.5;
      r.x = abs(r.x) - R * 0.52;
      d = smin(d, capX(r, R * 0.36, 0.115), 0.22);
      d += 0.03 * sin(p.y * 3.0 - uTime * 0.7) * sin(p.x * 2.1 + p.z * 2.7 + uTime * 0.4);
      return d * 0.55;
    }

    // P.02 — three orbit rings at the emblem's angles, slowly precessing
    float rings (vec3 p) {
      p.xz *= rot(uRot * 0.7);
      p.yz *= rot(0.18);
      // two orbits tilted back and crossed (the emblem's loops) + an inner circle
      vec3 a = p; a.xy *= rot(0.55); a.yz *= rot(1.15);
      vec3 b = p; b.xy *= rot(-0.55); b.yz *= rot(1.15);
      vec3 c = p; c.yz *= rot(1.57);
      float w = 0.02 * sin(uTime * 0.8 + p.y * 4.0);
      float d = torus(a, 1.4, 0.11 + w);
      d = smin(d, torus(b, 1.4, 0.11 - w), 0.14);
      d = smin(d, torus(c, 0.9, 0.12 + w), 0.14);
      return d * 0.85;
    }

    // P.03 — a liquid sphere with standing-wave bands running pole to pole
    float sphere (vec3 p) {
      p.xz *= rot(uRot * 0.5);
      p.yz *= rot(0.3);
      float r = length(p);
      float lat = atan(length(p.xz), p.y);
      float band = sin(lat * 13.0 - uTime * 1.2) * 0.04 * sin(lat);
      return (r - 0.98 + band) * 0.8;
    }

    // liquid transition A → B: A thins away while a chrome droplet swells at the
    // centre, then the droplet gives its mass to B — mercury collapsing and re-forming
    float melt (float dA, float dB, vec3 p, float k) {
      float a = dA + 0.5 * smoothstep(0.0, 0.55, k);
      float b = dB + 0.5 * (1.0 - smoothstep(0.45, 1.0, k));
      float drop = (length(p) - 0.95 * sin(3.14159 * k)) * 0.9;
      return smin(smin(a, b, 0.25), drop, 0.45);
    }

    float map (vec3 p) {
      p.x -= uShift;
      if (uMorph <= 0.001) return helix(p);
      if (uMorph < 0.999) return melt(helix(p), rings(p), p, uMorph);
      if (uMorph <= 1.001) return rings(p);
      if (uMorph < 1.999) return melt(rings(p), sphere(p), p, uMorph - 1.0);
      return sphere(p);
    }

    vec3 normalAt (vec3 p) {
      vec2 e = vec2(0.0015, -0.0015);
      return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
                       e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
    }

    vec3 plateBg (vec2 uv) {
      vec3 hi = vec3(0.945, 0.94, 0.925);
      vec3 lo = vec3(0.80, 0.79, 0.765);
      return mix(hi, lo, smoothstep(0.15, 1.15, length(uv * vec2(0.75, 1.0) - vec2(0.25, 0.1))));
    }

    // the studio the black liquid reflects: bright fog above, dark floor
    vec3 env (vec3 d) {
      vec3 c = mix(vec3(0.05, 0.05, 0.06), vec3(0.9, 0.895, 0.875), smoothstep(-0.35, 0.55, d.y));
      c *= 0.55 + 0.45 * smoothstep(-0.2, 0.9, d.y);
      return c;
    }

    void main () {
      vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
      vec3 ro = vec3(0.0, 0.0, uDist);
      vec3 rd = normalize(vec3(uv, -1.75));
      vec3 bg = plateBg(uv);

      float t = 0.0;
      bool hit = false;
      for (int i = 0; i < 120; i++) {
        float d = map(ro + rd * t);
        if (d < 0.0012 * t) { hit = true; break; }
        t += d * 0.9;             // blended fields are not exact distances: step a little short
        if (t > uDist + 7.0) break;
      }

      vec3 col = bg;
      if (hit) {
        vec3 p = ro + rd * t;
        vec3 n = normalAt(p);
        vec3 rf = reflect(rd, n);
        float cosv = max(dot(n, -rd), 0.0);
        float F = 0.05 + 0.95 * pow(1.0 - cosv, 5.0);
        float ao = clamp(map(p + n * 0.14) / (0.14 * 0.55), 0.0, 1.0);

        vec3 base = vec3(0.012, 0.012, 0.014);
        vec3 refl = env(rf) * F;
        // soft-box highlights: what makes black read as wet chrome
        float key = pow(max(dot(rf, normalize(vec3(-0.55, 0.7, 0.45))), 0.0), 36.0);
        float strip = smoothstep(0.07, 0.0, abs(rf.x + 0.28)) * smoothstep(0.0, 0.6, rf.y);
        float rim = pow(max(dot(rf, normalize(vec3(0.9, 0.25, -0.35))), 0.0), 10.0);
        vec3 spec = vec3(1.0) * (key * 1.9 + strip * 0.85 + rim * 0.5) * (0.55 + 0.45 * F);

        col = base + (refl + spec) * (0.45 + 0.55 * ao);
        col = mix(col, bg, smoothstep(uDist - 0.8, uDist + 4.2, t) * 0.85);
        // the form dissolves into fog before it reaches the plate's top and bottom bars
        col = mix(col, bg, smoothstep(0.3, 0.46, abs(uv.y)) * 0.92);
      }

      col *= 1.0 - 0.06 * dot(uv, uv);
      gl_FragColor = vec4(col, 1.0);
    }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }

  // everything on the GPU, built at boot and again after a context restore
  let U = null;
  function initGPU() {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return false;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    U = {
      res: gl.getUniformLocation(prog, 'uRes'),
      time: gl.getUniformLocation(prog, 'uTime'),
      rot: gl.getUniformLocation(prog, 'uRot'),
      shift: gl.getUniformLocation(prog, 'uShift'),
      dist: gl.getUniformLocation(prog, 'uDist'),
      morph: gl.getUniformLocation(prog, 'uMorph'),
    };
    return true;
  }
  if (!initGPU()) {
    plate.classList.add('plate--flat');
    return;
  }

  // survive a GPU reset: hold the context, rebuild when the browser hands it back
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    U = null;
    plate.classList.add('plate--flat');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!initGPU()) return;
    resize();
    lastKey = '';
    plate.classList.remove('plate--flat');
  });

  /* ---------------- size, visibility, loop ---------------- */

  let shift = 1.0;

  function resize() {
    const w = plate.clientWidth, h = plate.clientHeight;
    // render below CSS resolution — the plate's depth-of-field softens it anyway
    const budget = 440000;          // raymarching is per pixel: this cap is the plate's GPU cost
    let scale = w > 900 ? 0.6 : 0.75;
    if (w * h * scale * scale > budget) scale = Math.sqrt(budget / (w * h));
    canvas.width = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    // on wide plates the form stands just right of centre, between the pillar
    // copy (left) and the status column (right); centred on narrow ones
    const aspect = w / Math.max(1, h);
    const halfW = 9.2 * (0.5 / 1.75) * aspect;   // world half-width at the form's plane
    shift = aspect > 1.05 ? 0.12 * halfW : 0.0;
  }

  let visible = false;
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(plate);

  let lastKey = '';
  const t0 = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || !U) return;                    // off screen, or context lost
    const key = `${scrollR.toFixed(4)}|${morph.toFixed(4)}`;
    if (reduced && key === lastKey) return;      // reduced motion: redraw on scroll only
    lastKey = key;
    const t = reduced ? 0 : (now - t0) / 1000;
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.time, t);
    gl.uniform1f(U.rot, scrollR * 4.2 + t * 0.07);
    gl.uniform1f(U.shift, shift);
    gl.uniform1f(U.morph, morph);
    // the camera flies in as the window opens — we enter the specimen
    gl.uniform1f(U.dist, reduced ? 9.2 : 9.2 + (1 - openK) * 4.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
