/* ============================================================
   MORSIS — portal.js · Chamber 004
   Fluid engine adapted from Pavel Dobryakov's WebGL-Fluid-
   Simulation (MIT, © 2017) — ported to the Morsis world:
   monochrome bone-on-black, keystroke + ring-click input,
   smoke dissolving into ASCII glyphs. No bloom, no sunrays.
   ============================================================ */

(() => {
  'use strict';

  let canvas = document.getElementById('fluid');
  const stage = document.getElementById('portalStage');
  if (!canvas || !stage) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 512,        // the display reads dye per 20px glyph cell — 1024 was invisible extra work
    DENSITY_DISSIPATION: 0.75,  // a slow exhale, not a strobe
    VELOCITY_DISSIPATION: 0.9,  // the field settles quickly — calm, viscous motion
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 14,    // enough for calm smoke; 20 cost ~30% more GPU per frame
    CURL: 18,
    SPLAT_RADIUS: 0.5,
    SPLAT_FORCE: 6000,
  };

  const RING_R = 0.21;      // gate radius, uv units (y-normalised)
  const ATLAS_CHARS = ' .01';   // thin smoke resolves into binary — data first

  let gl = null;
  let ext = null;
  let visible = false;


  /* ---------------- context & formats (Pavel's, trimmed) ---------------- */

  // alpha: the chamber is transparent where empty, so the page's dot grid shows through
  const GL_PARAMS = { alpha: true, premultipliedAlpha: true, depth: false, stencil: false, antialias: false };

  // WebGL2 first; if it can't render to half-float targets, start again on a
  // fresh canvas with WebGL1 (a canvas can only ever hold one context type)
  function getWebGLContext() {
    if (setupContext(canvas.getContext('webgl2', GL_PARAMS), true)) return true;
    if (gl) {
      const fresh = canvas.cloneNode(false);
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
    return setupContext(canvas.getContext('webgl', GL_PARAMS) || canvas.getContext('experimental-webgl', GL_PARAMS), false);
  }

  // why the chamber went flat, for the console (see the boot block)
  const why = [];
  const rendererOf = (g) => {
    try {
      const d = g.getExtension('WEBGL_debug_renderer_info');
      return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
    } catch (_) { return 'unknown'; }
  };

  function setupContext(context, isWebGL2) {
    gl = context;
    const tag = isWebGL2 ? 'WebGL2' : 'WebGL1';
    if (!gl) { why.push(`${tag}: browser returned no context`); return false; }
    if (gl.isContextLost && gl.isContextLost()) { why.push(`${tag}: context created already lost (GPU blocked)`); return false; }

    let halfFloat = null;
    let supportLinearFiltering = false;
    if (isWebGL2) {
      // either extension makes 16F targets renderable (many phones only ship the half one)
      gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('EXT_color_buffer_half_float');
      supportLinearFiltering = true; // core in WebGL2 for 16F
    } else {
      halfFloat = gl.getExtension('OES_texture_half_float');
      supportLinearFiltering = !!gl.getExtension('OES_texture_half_float_linear');
    }
    if (!halfFloat && !isWebGL2) { why.push(`${tag}: no OES_texture_half_float on ${rendererOf(gl)}`); return false; }

    gl.clearColor(0, 0, 0, 1);

    const texType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    let formatRGBA, formatRG, formatR;
    if (isWebGL2) {
      formatRGBA = getSupportedFormat(gl.RGBA16F, gl.RGBA, texType);
      formatRG = getSupportedFormat(gl.RG16F, gl.RG, texType);
      formatR = getSupportedFormat(gl.R16F, gl.RED, texType);
    } else {
      formatRGBA = getSupportedFormat(gl.RGBA, gl.RGBA, texType);
      formatRG = formatRGBA;
      formatR = formatRGBA;
    }
    if (!formatRGBA) { why.push(`${tag}: cannot render to half-float textures on ${rendererOf(gl)}`); return false; }

    ext = { formatRGBA, formatRG, formatR, texType, supportLinearFiltering };
    return true;
  }

  function getSupportedFormat(internalFormat, format, type) {
    if (!supportRenderTextureFormat(internalFormat, format, type)) {
      switch (internalFormat) {
        case gl.R16F: return getSupportedFormat(gl.RG16F, gl.RG, type);
        case gl.RG16F: return getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
        default: return null;
      }
    }
    return { internalFormat, format };
  }

  function supportRenderTextureFormat(internalFormat, format, type) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }

  /* __SHADERS_A__ */

  /* ---------------- solver shaders (Pavel's, GLSL 100) ---------------- */

  const VERT = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`;

  const FRAG_CLEAR = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture; uniform float value;
    void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`;

  const FRAG_SPLAT = `
    precision highp float; precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget; uniform float aspectRatio;
    uniform vec3 color; uniform vec2 point; uniform float radius;
    void main () {
      vec2 p = vUv - point; p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
    }`;

  const FRAG_ADVECT = `
    precision highp float; precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity; uniform sampler2D uSource;
    uniform vec2 texelSize; uniform vec2 dyeTexelSize;
    uniform float dt; uniform float dissipation;
    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
      vec2 st = uv / tsize - 0.5;
      vec2 iuv = floor(st); vec2 fuv = fract(st);
      vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
      vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
      vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
      vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
      return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }
    void main () {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
      gl_FragColor = texture2D(uSource, coord) / (1.0 + dissipation * dt);
    }`;

  const FRAG_DIVERGENCE = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR;
    varying highp vec2 vT; varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) { L = -C.x; }
      if (vR.x > 1.0) { R = -C.x; }
      if (vT.y > 1.0) { T = -C.y; }
      if (vB.y < 0.0) { B = -C.y; }
      gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`;
  /* __SHADERS_B__ */

  const FRAG_CURL = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR;
    varying highp vec2 vT; varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }`;

  const FRAG_VORTICITY = `
    precision highp float; precision highp sampler2D;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uVelocity; uniform sampler2D uCurl;
    uniform float curl; uniform float dt;
    void main () {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;
      vec2 vel = texture2D(uVelocity, vUv).xy;
      vel = min(max(vel, -1000.0), 1000.0);
      gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }`;

  const FRAG_PRESSURE = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR;
    varying highp vec2 vT; varying highp vec2 vB;
    uniform sampler2D uPressure; uniform sampler2D uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float divergence = texture2D(uDivergence, vUv).x;
      gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
    }`;

  const FRAG_GRADIENT = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR;
    varying highp vec2 vT; varying highp vec2 vB;
    uniform sampler2D uPressure; uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 vel = texture2D(uVelocity, vUv).xy;
      vel -= vec2(R - L, T - B);
      gl_FragColor = vec4(vel, 0.0, 1.0);
    }`;

  /* ---------------- display: smoke dissolving into ASCII ---------------- */

  const FRAG_DISPLAY = `
    precision highp float; precision highp sampler2D;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uTexture; uniform sampler2D uAtlas;
    uniform vec2 uGrid; uniform vec2 texelSize;
    uniform float uRingR; uniform float uAspect; uniform float uDim; uniform float uTime;
    float hash (vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main () {
      vec3 bone = vec3(0.898, 0.890, 0.863);       // #E5E3DC
      vec3 obsidian = vec3(0.043, 0.047, 0.055);   // #0B0C0E

      // smooth smoke (per-pixel, with shading)
      vec3 c = texture2D(uTexture, vUv).rgb;
      vec3 lc = texture2D(uTexture, vL).rgb;
      vec3 rc = texture2D(uTexture, vR).rgb;
      vec3 tc = texture2D(uTexture, vT).rgb;
      vec3 bc = texture2D(uTexture, vB).rgb;
      float dx = length(rc) - length(lc);
      float dy = length(tc) - length(bc);
      vec3 n = normalize(vec3(dx, dy, length(texelSize)));
      float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
      float lum = c.r * diffuse;
      vec3 smoothCol = bone * pow(lum, 0.8) * 1.35;

      // ascii glyph per cell (density read at cell centre)
      vec2 cell = floor(vUv * uGrid);
      vec2 centre = (cell + 0.5) / uGrid;
      float d = clamp(texture2D(uTexture, centre).r, 0.0, 1.0);
      // atlas = [' ', '.', '0', '1']: faint smoke is a dot, anything denser is a bit,
      // and each cell's bit re-rolls on its own slow clock so the field reads as live data
      float levels = 4.0;
      float seed = hash(cell);
      float bit = step(0.5, hash(cell + floor(uTime * (0.18 + seed * 0.5) + seed * 9.0)));
      float idx = d < 0.035 ? 0.0 : (d < 0.09 ? 1.0 : 2.0 + bit);
      vec2 f = fract(vUv * uGrid);
      vec2 auv = vec2((idx + f.x) / levels, 1.0 - f.y);   // atlas rows run top-down
      float glyph = texture2D(uAtlas, auv).a;
      vec3 asciiCol = bone * glyph * (0.30 + 0.70 * smoothstep(0.02, 0.30, d));

      // bright smoke stays smooth; thin smoke resolves into glyphs
      vec3 col = mix(asciiCol, smoothCol, smoothstep(0.40, 0.75, d));

      // the gate ring
      vec2 pr = vUv - vec2(0.5);
      pr.x *= uAspect;
      float r = length(pr);
      float ring = 1.0 - smoothstep(0.0012, 0.0032, abs(r - uRingR));
      // a solid disc of background inside the ring — nothing shows through it
      float disc = 1.0 - smoothstep(uRingR - 0.004, uRingR - 0.001, r);
      col *= 1.0 - disc;
      col += bone * ring * 0.55;

      // dim the chamber while the manifesto reads over it
      col *= uDim;

      // premultiplied: light where there is signal, transparent where the field is empty
      gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
    }`;

  /* ---------------- programs ---------------- */

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
    }
    return s;
  }

  function makeProgram(fragSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { prog: p, u };
  }

  function initPrograms() {
    P.clear = makeProgram(FRAG_CLEAR);
    P.splat = makeProgram(FRAG_SPLAT);
    P.advect = makeProgram(FRAG_ADVECT);
    P.divergence = makeProgram(FRAG_DIVERGENCE);
    P.curl = makeProgram(FRAG_CURL);
    P.vorticity = makeProgram(FRAG_VORTICITY);
    P.pressure = makeProgram(FRAG_PRESSURE);
    P.gradient = makeProgram(FRAG_GRADIENT);
    P.display = makeProgram('#define SHADING\n' + FRAG_DISPLAY);
  }

  const P = {};

  /* ---------------- glyph atlas (Avant Garde ramp) ---------------- */

  function buildAtlas() {
    const levels = ATLAS_CHARS.length;
    const cellPx = 64;
    const c = document.createElement('canvas');
    c.width = levels * cellPx;
    c.height = cellPx;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = '#ffffff';
    x.font = '46px "Avant Garde", "Century Gothic", sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    for (let i = 0; i < levels; i++) {
      x.fillText(ATLAS_CHARS[i], i * cellPx + cellPx / 2, cellPx / 2 + 2);
    }
    return c;
  }

  let atlasTex = null;

  function uploadAtlas() {
    const c = buildAtlas();
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    atlasTex = {
      tex,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        return id;
      },
    };
  }

  /* ---------------- fullscreen quad (Pavel's blit) ---------------- */

  let blitReady = false;
  function blit(target) {
    if (!blitReady) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      blitReady = true;
    }
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  /* ---------------- framebuffers (Pavel's, trimmed) ---------------- */

  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture, fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    let a = createFBO(w, h, internalFormat, format, type, param);
    let b = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w, height: h,
      texelSizeX: a.texelSizeX, texelSizeY: a.texelSizeY,
      get read() { return a; },
      get write() { return b; },
      swap() { const t = a; a = b; b = t; },
    };
  }

  function getResolution(resolution) {
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(resolution);
    const max = Math.round(resolution * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min }
      : { width: min, height: max };
  }

  let dye, velocity, divergence, curlFBO, pressure;

  function initFramebuffers() {
    const simRes = getResolution(config.SIM_RESOLUTION);
    const dyeRes = getResolution(config.DYE_RESOLUTION);
    const t = ext.texType;
    const filt = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);
    dye = createDoubleFBO(dyeRes.width, dyeRes.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, t, filt);
    velocity = createDoubleFBO(simRes.width, simRes.height, ext.formatRG.internalFormat, ext.formatRG.format, t, filt);
    divergence = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, t, gl.NEAREST);
    curlFBO = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, t, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, t, gl.NEAREST);
  }

  /* ---------------- simulation step (Pavel's) ---------------- */

  let aspect = 1;

  function step(dt) {
    gl.disable(gl.BLEND);

    gl.useProgram(P.curl.prog);
    gl.uniform2f(P.curl.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(P.curl.u.uVelocity, velocity.read.attach(0));
    blit(curlFBO);

    gl.useProgram(P.vorticity.prog);
    gl.uniform2f(P.vorticity.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(P.vorticity.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(P.vorticity.u.uCurl, curlFBO.attach(1));
    gl.uniform1f(P.vorticity.u.curl, config.CURL);
    gl.uniform1f(P.vorticity.u.dt, dt);
    blit(velocity.write); velocity.swap();

    gl.useProgram(P.divergence.prog);
    gl.uniform2f(P.divergence.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(P.divergence.u.uVelocity, velocity.read.attach(0));
    blit(divergence);

    gl.useProgram(P.clear.prog);
    gl.uniform1i(P.clear.u.uTexture, pressure.read.attach(0));
    gl.uniform1f(P.clear.u.value, config.PRESSURE);
    blit(pressure.write); pressure.swap();

    gl.useProgram(P.pressure.prog);
    gl.uniform2f(P.pressure.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(P.pressure.u.uDivergence, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(P.pressure.u.uPressure, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }

    gl.useProgram(P.gradient.prog);
    gl.uniform2f(P.gradient.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(P.gradient.u.uPressure, pressure.read.attach(0));
    gl.uniform1i(P.gradient.u.uVelocity, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();

    gl.useProgram(P.advect.prog);
    gl.uniform2f(P.advect.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering) {
      gl.uniform2f(P.advect.u.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    }
    const velId = velocity.read.attach(0);
    gl.uniform1i(P.advect.u.uVelocity, velId);
    gl.uniform1i(P.advect.u.uSource, velId);
    gl.uniform1f(P.advect.u.dt, dt);
    gl.uniform1f(P.advect.u.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write); velocity.swap();

    if (!ext.supportLinearFiltering) {
      gl.uniform2f(P.advect.u.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    }
    gl.uniform1i(P.advect.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(P.advect.u.uSource, dye.read.attach(1));
    gl.uniform1f(P.advect.u.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write); dye.swap();
  }

  /* ---------------- splats ---------------- */

  function correctRadius(r) {
    const a = canvas.width / canvas.height;
    return a > 1 ? r * a : r;
  }

  function splat(x, y, dx, dy, strength) {
    const s = strength || 0.6;
    gl.useProgram(P.splat.prog);
    gl.uniform1i(P.splat.u.uTarget, velocity.read.attach(0));
    gl.uniform1f(P.splat.u.aspectRatio, aspect);
    gl.uniform2f(P.splat.u.point, x, y);
    gl.uniform3f(P.splat.u.color, dx, dy, 0);
    gl.uniform1f(P.splat.u.radius, correctRadius(config.SPLAT_RADIUS / 100));
    blit(velocity.write); velocity.swap();
    gl.uniform1i(P.splat.u.uTarget, dye.read.attach(0));
    gl.uniform3f(P.splat.u.color, s, s, s * 0.96);
    blit(dye.write); dye.swap();
  }

  /* ---------------- grid, resize, visibility ---------------- */

  let gridX = 1, gridY = 1;

  // the stage's layout size, cached: reading clientWidth inside the frame loop
  // (after flow.js has written its styles) forced a layout every frame
  let stageW = stage.clientWidth, stageH = stage.clientHeight;
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { stageW = stage.clientWidth; stageH = stage.clientHeight; }).observe(stage);
  }

  function resize() {
    // layout size, not getBoundingClientRect — flow.js scales the stage on
    // scroll, and a transformed rect would rebuild the framebuffers every frame
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(2, Math.floor(stageW * dpr));
    const h = Math.max(2, Math.floor(stageH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      initFramebuffers();
    }
    // square ASCII cells across the viewport
    gridY = Math.max(24, Math.round(h / 20));
    gridX = Math.max(24, Math.round(w / 20));
    aspect = canvas.width / canvas.height;
  }

  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }, { threshold: 0.05 })
    .observe(stage);

  /* ---------------- ambient breath + main loop ---------------- */

  let last = performance.now();
  let tAcc = 0;
  let ambient = 0;

  // pre-warm: breathe smoke out of the whole ring and run the solver for ~1.5s
  // of sim time before the first visible frame, so the chamber never opens empty
  let primed = false;
  function prime() {
    primed = true;
    if (reduced) return;
    // a light, calm haze — about what the ambient breath leaves after a few seconds
    for (let i = 0; i < 90; i++) {
      if (i % 15 === 0) {
        const a = (i / 90) * Math.PI * 2;
        emit(a, 160, 0.13);
        emit(a + Math.PI, 160, 0.13);
      }
      step(0.0166);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    // off screen, context lost, or still behind the gate (gate.js) — no GPU work
    if (!visible || !velocity || (window.MORSIS && window.MORSIS.gated)) { last = now; return; }
    resize();
    if (!primed) prime();

    const dt = Math.min((now - last) / 1000, 0.0166);
    last = now;
    tAcc += dt;

    if (!reduced) {
      ambient += dt;
      if (ambient > 0.7) {
        ambient = 0;
        const a = tAcc * 0.25;
        const pos = ringAngleToXY(a, 1.04);
        splat(pos.x, pos.y, -Math.sin(a) * 70, Math.cos(a) * 70, 0.14);
      }
    }

    step(dt);
    render();
  }

  /* ---------------- boot ---------------- */

  // (re)build everything that lives on the GPU — at boot and after a context restore
  function initGPU() {
    blitReady = false;
    initPrograms();
    uploadAtlas();
    canvas.width = canvas.height = 0;     // forces resize() to rebuild the framebuffers
    resize();
  }

  // A GPU reset (driver update, sleep, too many tabs) loses the context. Without
  // preventDefault the browser never gives it back and the chamber stays flat.
  function watchContext() {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      velocity = null;                    // puff/burst/stir go quiet while lost
      stage.classList.add('portal--flat');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (!setupContext(gl, typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)) return;
      initGPU();
      primed = false;                     // the restored field starts empty: warm it again
      stage.classList.remove('portal--flat');
    });
  }

  if (!getWebGLContext()) {
    stage.classList.add('portal--flat');
    console.warn(`[Morsis] Chamber 004 is flat — ${why.join(' · ')}. ` +
      '"no context" / "already lost" = the browser has 3D switched off or blocked: fully restart it and ' +
      'check hardware acceleration. "half-float" = WebGL works but this GPU path lacks float targets.');
    stage.dataset.glReason = why.join(' · ');
  } else {
    watchContext();
    initGPU();
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
  }

  /* ---------------- render ---------------- */

  function render() {
    gl.disable(gl.BLEND);
    gl.useProgram(P.display.prog);
    gl.uniform2f(P.display.u.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform1i(P.display.u.uTexture, dye.read.attach(0));
    gl.uniform1i(P.display.u.uAtlas, atlasTex.attach(1));
    gl.uniform2f(P.display.u.uGrid, gridX, gridY);
    gl.uniform1f(P.display.u.uRingR, RING_R);
    gl.uniform1f(P.display.u.uAspect, aspect);
    // flow.js eases this down while the hero manifesto is on screen
    gl.uniform1f(P.display.u.uDim, (window.MORSIS && window.MORSIS.chamberDim) || 1);
    gl.uniform1f(P.display.u.uTime, tAcc);
    blit(null);
  }

  /* ---------------- input: cursor stir + ring pulses ---------------- */

  function ringAngleToXY(angle, scale) {
    // point on (or just outside) the ring in uv space — y-normalised radius
    const r = RING_R * (scale || 1);
    return {
      x: 0.5 + Math.cos(angle) * r / aspect,
      y: 0.5 + Math.sin(angle) * r,
    };
  }

  // emit from just outside the ring: mostly outward, with a little swirl
  function emit(a, speed, strength) {
    const pos = ringAngleToXY(a, 1.04);
    const vx = Math.cos(a) * 0.8 - Math.sin(a) * 0.35;
    const vy = Math.sin(a) * 0.8 + Math.cos(a) * 0.35;
    splat(pos.x, pos.y, vx * speed, vy * speed, strength);
  }

  // the cursor stirs the field — velocity from pointer motion, a whisper of dye
  let lastPt = null;
  canvas.addEventListener('pointermove', (e) => {
    if (!visible || !velocity || reduced) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    if (lastPt) {
      const dx = x - lastPt.x, dy = y - lastPt.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.0006) {
        splat(x, y, dx * config.SPLAT_FORCE * 0.35, dy * config.SPLAT_FORCE * 0.35, 0.04);
      }
    }
    lastPt = { x, y };
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => { lastPt = null; });

  // a click sends a pulse out from the nearest point of the ring
  canvas.addEventListener('click', (e) => {
    if (!velocity) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    const a = Math.atan2(y - 0.5, (x - 0.5) * aspect);
    for (let i = -1; i <= 1; i++) emit(a + i * 0.07, 260, 0.3);
  });

  /* ---------------- public: lets transmit.js drive the chamber ---------------- */

  window.MORSIS = window.MORSIS || {};
  window.MORSIS.chamber = {
    // a tone leaving the ring at `angle`
    puff(angle, speed, strength, spread) {
      if (!velocity) return;   // no WebGL → flat fallback, nothing to drive
      const sp = spread || 1;
      for (let i = 0; i < 3; i++) {
        emit(angle + (i - 1) * 0.06 * sp + (Math.random() - 0.5) * 0.04,
          speed * (0.85 + Math.random() * 0.3), strength);
      }
    },
    // the whole ring answers at once — carrier lock
    burst(strength, speed) {
      if (!velocity) return;
      for (let i = 0; i < 24; i++) emit((i / 24) * Math.PI * 2, speed || 420, strength || 0.3);
    },
  };
})();