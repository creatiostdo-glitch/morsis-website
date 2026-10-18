/* ============================================================
   MORSIS — atlas.js · the line-art globe (scene "atlas")
   An orthographic globe drawn on Canvas2D from Natural Earth
   110m country outlines (world-atlas TopoJSON, decoded here).
   Only its northern cap rises above the footer HUD.

   scroll   r -0.3 → 0.7 builds it: a small ring of binary
            characters → grows into the globe → coastlines arrive
            as characters → everything resolves into line art.
            The rest of the pinned run is for exploring.
   drag     rotates (with inertia); a click picks a continent,
            which turns vermilion and drives the numbers + chart
   location the device position (if allowed) is ringed on the globe
   ============================================================ */

(() => {
  'use strict';

  const sec = document.getElementById('s-atlas');
  if (!sec) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const M = (window.MORSIS = window.MORSIS || {});
  M.onScene = M.onScene || {};

  const stage = sec.querySelector('.scene__stage');
  const canvas = document.getElementById('atlasGlobe');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    scope: $('atlasScope'), species: $('atlasSpecies'), mapped: $('atlasMapped'), pct: $('atlasPct'),
    bar: $('atlasBar'), acc: $('atlasAcc'), svg: $('atlasChart'), tip: $('atlasTip'),
    where: $('atlasWhere'), hint: $('atlasHint'), chart: $('atlasChartWrap'),
    kicker: sec.querySelector('.atlas__kicker'), stats: sec.querySelector('.atlas__stats'),
    titleLines: Array.from(sec.querySelectorAll('.atlas__title > span > span')),
  };

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const span = (v, a, b) => clamp01((v - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;
  const D2R = Math.PI / 180;
  const BONE = '229, 227, 220';
  const SIGNAL = '255, 72, 0';
  const FONT = '"Avant Garde", "Century Gothic", sans-serif';

  /* ---------------- data (illustrative model figures) ---------------- */

  // species: recognised bird species in the region · mapped: share Morsis has
  // a working hypothetical vocal model for · curve: logistic accuracy 2009→2026
  const YEARS = Array.from({ length: 18 }, (_, i) => 2009 + i);
  const REGIONS = {
    world: { name: 'World',         species: 11017, mapped: 0.62, curve: [6, 86, 2017.8, 0.5] },
    na:    { name: 'North America', species: 2150,  mapped: 0.74, curve: [8, 91, 2016.6, 0.52] },
    sa:    { name: 'South America', species: 3450,  mapped: 0.51, curve: [4, 79, 2019.0, 0.5] },
    eu:    { name: 'Europe',        species: 830,   mapped: 0.86, curve: [11, 94, 2015.2, 0.55] },
    af:    { name: 'Africa',        species: 2320,  mapped: 0.55, curve: [3, 76, 2019.4, 0.48] },
    as:    { name: 'Asia',          species: 3520,  mapped: 0.58, curve: [5, 82, 2018.4, 0.5] },
    oc:    { name: 'Oceania',       species: 1710,  mapped: 0.63, curve: [6, 85, 2018.1, 0.5] },
    an:    { name: 'Antarctica',    species: 46,    mapped: 0.91, curve: [14, 96, 2014.6, 0.6] },
  };
  const ORDER = ['na', 'sa', 'eu', 'af', 'as', 'oc', 'an'];
  Object.entries(REGIONS).forEach(([key, g], n) => {
    const [lo, hi, mid, k] = g.curve;
    g.series = YEARS.map((y, i) => {
      const wobble = Math.sin(i * 1.7 + n * 2.3) * 1.1 * (1 - i / 18);   // field seasons are noisy early
      return Math.max(0, Math.min(100, lo + (hi - lo) / (1 + Math.exp(-k * (y - mid))) + wobble));
    });
    g.key = key;
  });

  // a country belongs to the continent its main landmass sits in
  function continentOf(lon, lat) {
    if (lat < -60 || (lat < -40 && lon > 40 && lon < 100)) return 'an';
    if ((lat < -10 && lon > 110) || lon > 140 || lon < -150) return 'oc';
    if (lon < -25) return lat > 9.5 || (lat > 7.5 && lon < -77) ? 'na' : 'sa';
    const mideast = lat > 12.5 && lon > 34 && !(lat < 18 && lon < 43);
    if (lon >= -20 && lon < 52 && !mideast && (lat < 34.5 || (lat < 37.5 && lon < 12))) return 'af';
    if ((lat > 35 && lon < 27) || (lat > 44 && lon < 50)) return 'eu';
    return 'as';
  }

  /* ---------------- geometry: unit vectors on the sphere ---------------- */

  const vec = (lon, lat) => {
    const l = lon * D2R, p = lat * D2R, c = Math.cos(p);
    return [c * Math.sin(l), Math.sin(p), c * Math.cos(l)];
  };
  const toFlat = (list) => {
    const f = new Float32Array(list.length * 3);
    list.forEach((v, i) => { f[i * 3] = v[0]; f[i * 3 + 1] = v[1]; f[i * 3 + 2] = v[2]; });
    return f;
  };

  // graticule: meridians and parallels every 15°, sampled every 3°
  const grat = [];
  for (let lon = -180; lon < 180; lon += 15) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(vec(lon, lat));
    grat.push({ pts: toFlat(pts), eq: false });
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 3) pts.push(vec(lon, lat));
    grat.push({ pts: toFlat(pts), eq: lat === 0 });
  }

  let WORLD = null;   // { coast[], border[], countries[], samples, cont{} }

  function decode(topo) {
    const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map((arc) => {
      let x = 0, y = 0;
      return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
    });
    const uses = new Uint8Array(arcs.length);
    const ringPts = (idx) => {
      const pts = [];
      idx.forEach((i) => {
        const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
        uses[i < 0 ? ~i : i]++;
        a.forEach((p, k) => { if (k > 0 || !pts.length) pts.push(p); });
      });
      return pts;
    };

    const countries = [];
    topo.objects.countries.geometries.forEach((g) => {
      if (!g.arcs) return;
      const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
      const rings = [];
      polys.forEach((poly) => poly.forEach((r) => rings.push(ringPts(r))));
      // the main landmass decides the continent
      let best = rings[0], bestA = -1;
      rings.forEach((r) => {
        let a = 0;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
        if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = r; }
      });
      let cx = 0, cy = 0;
      best.forEach((p) => { cx += p[0]; cy += p[1]; });
      const cont = continentOf(cx / best.length, cy / best.length);
      countries.push({ cont, rings, flat: rings.map((r) => toFlat(r.map((p) => vec(p[0], p[1])))) });
    });

    // coast = arcs used by one country, border = shared by two
    const coast = [], border = [];
    arcs.forEach((a, i) => {
      if (!uses[i]) return;
      (uses[i] > 1 ? border : coast).push(toFlat(a.map((p) => vec(p[0], p[1]))));
    });

    // characters along the coastline, one every ~1.6°, for the build-in
    const samples = [];
    const STEP = 1.6 * D2R;
    coast.forEach((f) => {
      let acc = STEP;
      for (let i = 3; i < f.length; i += 3) {
        const dx = f[i] - f[i - 3], dy = f[i + 1] - f[i - 2], dz = f[i + 2] - f[i - 1];
        acc += Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (acc >= STEP) { acc = 0; samples.push(f[i], f[i + 1], f[i + 2]); }
      }
    });
    const n = samples.length / 3;
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { const s = Math.sin(i * 12.9898) * 43758.5453; seed[i] = s - Math.floor(s); }

    // continent centres (mean of their vertices) for the selection fly-to
    const cont = {};
    ORDER.forEach((k) => { cont[k] = { x: 0, y: 0, z: 0 }; });
    countries.forEach((c) => c.flat.forEach((f) => {
      for (let i = 0; i < f.length; i += 3) { const t = cont[c.cont]; t.x += f[i]; t.y += f[i + 1]; t.z += f[i + 2]; }
    }));
    ORDER.forEach((k) => {
      const t = cont[k], L = Math.hypot(t.x, t.y, t.z) || 1;
      cont[k] = { lon: Math.atan2(t.x, t.z) / D2R, lat: Math.asin(t.y / L) / D2R };
    });

    WORLD = { coast, border, countries, samples: new Float32Array(samples), seed, cont };
  }

  // the map ships with the site; the CDN copy is only a fallback
  const MAP_SOURCES = [
    'Assets/Data/countries-110m.json',
    'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json',
  ];
  (async () => {
    for (const url of MAP_SOURCES) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        decode(await res.json());
        dirty = true;
        return;
      } catch (_) { /* try the next source */ }
    }
    console.warn('[Morsis] Atlas: could not load the coastline data (Assets/Data/countries-110m.json or the CDN) — showing graticule only.');
  })();

  /* ---------------- view state ---------------- */

  const view = { lon: 12, lat: -18, vlon: 0, vlat: 0 };     // view centre (deg), drag velocity
  let flyTo = null;                                        // { lon, lat } eased toward
  let selected = null, hover = null;
  let loc = null, locState = 'idle';                       // idle | asking | on | off
  let lastUser = -1e9;
  let b = reduced ? 1 : 0;                                 // build progress 0 → 1
  let visible = false, dirty = true;
  let W = 2, H = 2, dpr = 1;

  let cl = 1, sl = 0, cp = 1, sp = 0;                      // rotation, refreshed per frame
  const setRot = () => {
    cl = Math.cos(view.lon * D2R); sl = Math.sin(view.lon * D2R);
    cp = Math.cos(view.lat * D2R); sp = Math.sin(view.lat * D2R);
  };

  // globe placement: final, and while it grows from the small ring
  const layout = () => {
    const phone = W < 760 * dpr;
    const Rf = phone ? Math.min(W * 0.66, H * 0.42) : Math.min(W * 0.335, H * 0.6);
    const cyF = H - (phone ? 96 : 92) * dpr;
    return { Rf, cyF, cx: W / 2 };
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(2, Math.round(stage.clientWidth * dpr));
    H = Math.max(2, Math.round(stage.clientHeight * dpr));
    canvas.width = W;
    canvas.height = H;
    const { Rf, cyF } = layout();
    stage.style.setProperty('--globe-top', `${((cyF - Rf) / dpr).toFixed(1)}px`);
    sizeChart();
    dirty = true;
  }

  /* ---------------- drawing ---------------- */

  // a projected line set; hidden points break the line (or hug the horizon, for fills)
  function trace(f, cx, cy, R, hug) {
    let pen = false;
    for (let i = 0; i < f.length; i += 3) {
      const x = f[i], y = f[i + 1], z = f[i + 2];
      const x1 = x * cl - z * sl, z1 = x * sl + z * cl;
      let px = x1, py = y * cp - z1 * sp;
      const pz = y * sp + z1 * cp;
      if (pz < 0) {
        if (!hug) { pen = false; continue; }
        const L = Math.hypot(px, py) || 1;
        px /= L; py /= L;
      }
      const X = cx + px * R, Y = cy - py * R;
      if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
    }
  }

  const bit = (i, t) => {
    const s = Math.sin(i * 78.233 + Math.floor(t * (0.6 + (i % 7) * 0.25)) * 12.9898) * 43758.5453;
    return s - Math.floor(s) < 0.5 ? '0' : '1';
  };

  function draw(now) {
    const t = now / 1000;
    const { Rf, cyF, cx } = layout();
    const g = smooth(span(b, 0.1, 0.5));                  // ring grows into the globe
    const R = lerp(Math.min(W, H) * 0.075, Rf, g);
    const cy = lerp(H * 0.5, cyF, g);
    const sweep = smooth(span(b, 0, 0.12));                // ring draws on
    const lineK = smooth(span(b, 0.68, 0.96));             // characters resolve into lines
    const coastG = span(b, 0.36, 0.78);                    // coast characters arrive
    const gratK = smooth(span(b, 0.4, 0.8));
    const markK = smooth(span(b, 0.86, 1));
    setRot();

    ctx.clearRect(0, 0, W, H);
    if (b <= 0.001) return;

    // the disc: a solid surface so the page's dots never show through the planet
    ctx.fillStyle = `rgba(11, 12, 14, ${(0.92 * gratK).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // a faint atmosphere just outside the horizon
    if (lineK > 0) {
      const atm = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.18);
      atm.addColorStop(0, `rgba(${BONE}, ${(0.07 * lineK).toFixed(3)})`);
      atm.addColorStop(1, `rgba(${BONE}, 0)`);
      ctx.fillStyle = atm;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2); ctx.fill();
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // graticule
    if (gratK > 0) {
      ctx.lineWidth = dpr * 0.8;
      grat.forEach((l) => {
        ctx.strokeStyle = `rgba(${BONE}, ${((l.eq ? 0.16 : 0.07) * gratK).toFixed(3)})`;
        ctx.beginPath(); trace(l.pts, cx, cy, R, false); ctx.stroke();
      });
    }

    if (WORLD) {
      // selected continent: vermilion wash under the line work
      if (selected && markK > 0) {
        ctx.fillStyle = `rgba(${SIGNAL}, ${(0.16 * markK).toFixed(3)})`;
        WORLD.countries.forEach((c) => {
          if (c.cont !== selected) return;
          ctx.beginPath();
          c.flat.forEach((f) => { trace(f, cx, cy, R, true); ctx.closePath(); });
          ctx.fill('evenodd');
        });
      }

      // line art: borders faint, coasts firm
      if (lineK > 0) {
        ctx.lineWidth = dpr * 0.8;
        ctx.strokeStyle = `rgba(${BONE}, ${(0.22 * lineK).toFixed(3)})`;
        ctx.beginPath(); WORLD.border.forEach((f) => trace(f, cx, cy, R, false)); ctx.stroke();
        ctx.lineWidth = dpr * 1.05;
        ctx.strokeStyle = `rgba(${BONE}, ${(0.78 * lineK).toFixed(3)})`;
        ctx.beginPath(); WORLD.coast.forEach((f) => trace(f, cx, cy, R, false)); ctx.stroke();

        const outline = (key, rgba, w) => {
          ctx.lineWidth = dpr * w;
          ctx.strokeStyle = rgba;
          ctx.beginPath();
          WORLD.countries.forEach((c) => { if (c.cont === key) c.flat.forEach((f) => trace(f, cx, cy, R, false)); });
          ctx.stroke();
        };
        if (hover && hover !== selected) outline(hover, `rgba(${BONE}, ${(0.95 * lineK).toFixed(3)})`, 1.3);
        if (selected) outline(selected, `rgba(${SIGNAL}, ${(0.95 * markK).toFixed(3)})`, 1.3);
      }

      // the coast as characters, before it resolves
      if (coastG > 0 && lineK < 1) {
        const S = WORLD.samples, seed = WORLD.seed;
        const fs = Math.max(7, Math.round(9 * dpr * lerp(0.7, 1, g)));
        ctx.font = `500 ${fs}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgb(${BONE})`;
        for (let i = 0, k = 0; i < S.length; i += 3, k++) {
          if (seed[k] > coastG * 1.25) continue;
          const x = S[i], y = S[i + 1], z = S[i + 2];
          const x1 = x * cl - z * sl, z1 = x * sl + z * cl;
          const pz = y * sp + z1 * cp;
          if (pz < 0.02) continue;
          const py = y * cp - z1 * sp;
          const fresh = clamp01((coastG * 1.25 - seed[k]) / 0.12);
          ctx.globalAlpha = (0.35 + 0.65 * pz) * fresh * (1 - lineK);
          ctx.fillText(bit(k, t), cx + x1 * R, cy - py * R);
        }
        ctx.globalAlpha = 1;
      }
    }

    // the horizon: a ring of characters that becomes a line
    if (lineK < 1) {
      const fs = Math.max(8, Math.round(10 * dpr));
      ctx.font = `500 ${fs}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const n = Math.max(24, Math.floor((2 * Math.PI * R) / (fs * 0.95)));
      const shown = Math.floor(n * sweep);
      for (let i = 0; i < shown; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const head = shown < n && i > shown - 4;           // the drawing head burns vermilion
        ctx.fillStyle = head ? `rgb(${SIGNAL})` : `rgb(${BONE})`;
        ctx.globalAlpha = (head ? 1 : 0.85) * (1 - lineK);
        ctx.fillText(bit(i + 9000, t), cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      }
      ctx.globalAlpha = 1;
    }
    if (lineK > 0) {
      ctx.lineWidth = dpr;
      ctx.strokeStyle = `rgba(${BONE}, ${(0.55 * lineK).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    }

    // you are here: a vermilion ring on the device's position
    if (loc && markK > 0) {
      const v = vec(loc.lon, loc.lat);
      const x1 = v[0] * cl - v[2] * sl, z1 = v[0] * sl + v[2] * cl;
      const pz = v[1] * sp + z1 * cp;
      if (pz > 0) {
        const X = cx + x1 * R, Y = cy - (v[1] * cp - z1 * sp) * R;
        const pulse = reduced ? 0 : (t * 0.6) % 1;
        ctx.strokeStyle = `rgba(${SIGNAL}, ${(markK * (1 - pulse) * 0.7).toFixed(3)})`;
        ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.arc(X, Y, (10 + pulse * 18) * dpr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(${SIGNAL}, ${markK.toFixed(3)})`;
        ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath(); ctx.arc(X, Y, 9 * dpr, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(${SIGNAL}, ${markK.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(X, Y, 2.4 * dpr, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /* ---------------- picking ---------------- */

  function lonLatAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const { Rf, cyF, cx } = layout();
    const x = (((clientX - rect.left) * dpr) - cx) / Rf;
    const y = (cyF - ((clientY - rect.top) * dpr)) / Rf;
    const d2 = x * x + y * y;
    if (d2 > 1) return null;
    const z = Math.sqrt(1 - d2);
    setRot();
    const y1 = y * cp + z * sp, z1 = -y * sp + z * cp;
    const X = x * cl + z1 * sl, Z = -x * sl + z1 * cl;
    return [Math.atan2(X, Z) / D2R, Math.asin(Math.max(-1, Math.min(1, y1))) / D2R];
  }

  function continentAt(clientX, clientY) {
    if (!WORLD || b < 0.9) return null;
    const ll = lonLatAt(clientX, clientY);
    if (!ll) return null;
    const [lon, lat] = ll;
    for (const c of WORLD.countries) {
      let inside = false;
      for (const r of c.rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i], [xj, yj] = r[j];
          if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      if (inside) return c.cont;
    }
    return null;
  }

  /* ---------------- selection → numbers + chart ---------------- */

  const shown = { species: REGIONS.world.species, mapped: REGIONS.world.mapped, series: REGIONS.world.series.slice() };
  let tween = null;

  function select(key) {
    selected = key;
    const g = REGIONS[key || 'world'];
    tween = {
      t0: performance.now(),
      from: { species: shown.species, mapped: shown.mapped, series: shown.series.slice() },
      to: g,
    };
    if (key && WORLD) {
      const c = WORLD.cont[key];
      flyTo = { lon: c.lon, lat: Math.max(-85, Math.min(60, c.lat - 30)) };
    }
    ui.scope.textContent = g.name;
    updateWhere();
    dirty = true;
  }

  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const fmtDeg = (v, pos, neg) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;

  function updateWhere() {
    let html;
    if (selected) html = `Highlighted · <b>${REGIONS[selected].name}</b>`;
    else if (loc) html = `<b>●</b> You are here · ${fmtDeg(loc.lat, 'N', 'S')} · ${fmtDeg(loc.lon, 'E', 'W')}`;
    else if (locState === 'asking') html = 'Locating this device…';
    else html = `Location off · viewing ${fmtDeg(Math.max(-90, Math.min(90, view.lat + 30)), 'N', 'S')} · ${fmtDeg(((view.lon + 540) % 360) - 180, 'E', 'W')}`;
    if (ui.where.innerHTML !== html) ui.where.innerHTML = html;
  }

  function askLocation() {
    if (locState !== 'idle') return;
    if (!('geolocation' in navigator)) { locState = 'off'; updateWhere(); return; }
    locState = 'asking';
    updateWhere();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        loc = { lat: p.coords.latitude, lon: p.coords.longitude };
        locState = 'on';
        // turn the planet to face the visitor, unless they are already steering
        if (performance.now() - lastUser > 4000 && !selected) flyTo = { lon: loc.lon, lat: Math.max(-85, Math.min(60, loc.lat - 33)) };
        updateWhere();
        dirty = true;
      },
      () => { locState = 'off'; updateWhere(); },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
    );
  }

  /* chart: pixel-space SVG, rebuilt on resize, paths updated on change */
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  };
  let cw = 300, ch = 120, chartEls = null, hoverYear = -1;

  function sizeChart() {
    cw = Math.max(80, ui.svg.clientWidth);
    ch = Math.max(40, ui.svg.clientHeight);
    ui.svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    ui.svg.textContent = '';
    const defs = mk('defs', {});
    const grad = mk('linearGradient', { id: 'atlasFill', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(mk('stop', { offset: 0, 'stop-color': 'rgb(255,72,0)', 'stop-opacity': 0.22 }),
                mk('stop', { offset: 1, 'stop-color': 'rgb(255,72,0)', 'stop-opacity': 0 }));
    const clip = mk('clipPath', { id: 'atlasClip' });
    const clipRect = mk('rect', { x: -4, y: -10, width: 0, height: ch + 20 });
    clip.append(clipRect);
    defs.append(grad, clip);
    ui.svg.append(defs);
    [0, 0.5, 1].forEach((f) => {
      const y = (ch - f * ch).toFixed(1);
      ui.svg.append(mk('line', { x1: 0, x2: cw, y1: y, y2: y, stroke: `rgba(${BONE},${f === 0 ? 0.22 : 0.07})`, 'stroke-width': 1 }));
      if (f > 0) {
        const lab = mk('text', { x: cw, y: (+y + 10).toFixed(1), 'text-anchor': 'end', fill: `rgba(${BONE},0.4)`, 'font-size': 8.5, 'letter-spacing': 1 });
        lab.textContent = `${f * 100}%`;
        ui.svg.append(lab);
      }
    });
    const g = mk('g', { 'clip-path': 'url(#atlasClip)' });
    const ref = mk('path', { fill: 'none', stroke: `rgba(${BONE},0.32)`, 'stroke-width': 1, 'stroke-dasharray': '2 3' });
    const area = mk('path', { fill: 'url(#atlasFill)' });
    const line = mk('path', { fill: 'none', stroke: 'rgb(255,72,0)', 'stroke-width': 1.4, 'stroke-linejoin': 'round' });
    const end = mk('circle', { r: 2.6, fill: 'rgb(255,72,0)' });
    g.append(ref, area, line, end);
    const probe = mk('line', { y1: 0, y2: ch, stroke: `rgba(${BONE},0.35)`, 'stroke-width': 1, opacity: 0 });
    const dot = mk('circle', { r: 3, fill: 'rgb(229,227,220)', opacity: 0 });
    ui.svg.append(g, probe, dot);
    chartEls = { clipRect, ref, area, line, end, probe, dot };
    renderChart(1);
  }

  const px = (i) => (i / (YEARS.length - 1)) * cw;
  const py = (v) => ch - (v / 100) * ch;
  const pathOf = (s) => s.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('');

  function renderChart(drawK) {
    if (!chartEls) return;
    const s = shown.series;
    chartEls.clipRect.setAttribute('width', (drawK * (cw + 8)).toFixed(1));
    chartEls.line.setAttribute('d', pathOf(s));
    chartEls.area.setAttribute('d', `${pathOf(s)}L${cw},${ch}L0,${ch}Z`);
    chartEls.ref.setAttribute('d', selected ? pathOf(REGIONS.world.series) : '');
    chartEls.end.setAttribute('cx', px(s.length - 1));
    chartEls.end.setAttribute('cy', py(s[s.length - 1]).toFixed(1));
    if (hoverYear >= 0) {
      const x = px(hoverYear), y = py(s[hoverYear]);
      chartEls.probe.setAttribute('x1', x); chartEls.probe.setAttribute('x2', x);
      chartEls.dot.setAttribute('cx', x); chartEls.dot.setAttribute('cy', y.toFixed(1));
      ui.tip.textContent = `${YEARS[hoverYear]} · ${s[hoverYear].toFixed(1)}%`;
      ui.tip.style.left = `${x}px`;
      ui.tip.style.top = `${(y / ch) * ui.svg.clientHeight + ui.svg.offsetTop}px`;
    }
  }

  ui.svg.addEventListener('pointermove', (e) => {
    const rect = ui.svg.getBoundingClientRect();
    hoverYear = Math.round(clamp01((e.clientX - rect.left) / rect.width) * (YEARS.length - 1));
    chartEls.probe.setAttribute('opacity', 1);
    chartEls.dot.setAttribute('opacity', 1);
    ui.tip.classList.add('is-on');
    renderChart(1);
  });
  ui.svg.addEventListener('pointerleave', () => {
    hoverYear = -1;
    chartEls.probe.setAttribute('opacity', 0);
    chartEls.dot.setAttribute('opacity', 0);
    ui.tip.classList.remove('is-on');
  });

  /* ---------------- input ---------------- */

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (b < 0.9) return;
    drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: 0, id: e.pointerId };
    view.vlon = view.vlat = 0;
    flyTo = null;
    lastUser = performance.now();
  });
  window.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
      drag.lx = e.clientX; drag.ly = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 4) {
        if (!canvas.classList.contains('is-dragging')) {
          canvas.classList.add('is-dragging');
          try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
        }
        const { Rf } = layout();
        const k = (180 / Math.PI) / (Rf / dpr);          // a drag across the radius ≈ 57°
        view.vlon = -dx * k;
        view.vlat = dy * k;
        view.lon -= dx * k;
        view.lat = Math.max(-85, Math.min(85, view.lat + dy * k));
        lastUser = performance.now();
        dirty = true;
      }
      return;
    }
    if (e.target === canvas && visible && b >= 0.9) {
      const h = continentAt(e.clientX, e.clientY);
      if (h !== hover) { hover = h; dirty = true; }
      canvas.classList.toggle('is-over-land', !!h);
    }
  }, { passive: true });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const click = drag.moved <= 4 && performance.now() - drag.t < 600;
    canvas.classList.remove('is-dragging');
    if (click) {
      const c = continentAt(e.clientX, e.clientY);
      select(c && c !== selected ? c : null);
    }
    drag = null;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; dirty = true; } });

  canvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 10;
    let used = true;
    if (e.key === 'ArrowLeft') view.lon -= step;
    else if (e.key === 'ArrowRight') view.lon += step;
    else if (e.key === 'ArrowUp') view.lat = Math.min(85, view.lat + step);
    else if (e.key === 'ArrowDown') view.lat = Math.max(-85, view.lat - step);
    else if (e.key === 'Enter' || e.key === ' ') select(ORDER[(ORDER.indexOf(selected) + 1) % ORDER.length]);
    else if (e.key === 'Escape') select(null);
    else used = false;
    if (used) { e.preventDefault(); flyTo = e.key.startsWith('Arrow') ? null : flyTo; lastUser = performance.now(); dirty = true; }
  });

  /* ---------------- scroll + loop ---------------- */

  M.onScene.atlas = (r) => {
    const nb = reduced ? 1 : clamp01((r + 0.3) / 1.0);
    if (nb !== b) { b = nb; dirty = true; }
    if (b > 0.2) askLocation();
  };

  new IntersectionObserver((en) => { visible = en[0].isIntersecting; dirty = true; }).observe(sec);
  window.addEventListener('resize', resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { dirty = true; });
  resize();

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible) return;

    // motion: fly-to > inertia > idle spin
    if (flyTo) {
      const dl = ((flyTo.lon - view.lon + 540) % 360) - 180;
      view.lon += dl * Math.min(1, dt * 3.2);
      view.lat += (flyTo.lat - view.lat) * Math.min(1, dt * 3.2);
      if (Math.abs(dl) < 0.05 && Math.abs(flyTo.lat - view.lat) < 0.05) flyTo = null;
      dirty = true;
    } else if (!drag && (Math.abs(view.vlon) > 0.01 || Math.abs(view.vlat) > 0.01)) {
      view.lon += view.vlon;
      view.lat = Math.max(-85, Math.min(85, view.lat + view.vlat));
      view.vlon *= 0.93; view.vlat *= 0.93;
      dirty = true;
    } else if (!drag && !reduced && !selected && now - lastUser > 5000) {
      view.lon += dt * (b < 1 ? 9 : 2.4);               // a slow drift, quicker while it builds
      dirty = true;
    }

    // numbers + chart tween toward the selection
    const countK = smooth(span(b, 0.5, 0.86));
    if (tween) {
      const k = smooth(clamp01((now - tween.t0) / 700));
      shown.species = lerp(tween.from.species, tween.to.species, k);
      shown.mapped = lerp(tween.from.mapped, tween.to.mapped, k);
      shown.series = tween.from.series.map((v, i) => lerp(v, tween.to.series[i], k));
      if (k >= 1) tween = null;
    }
    const sp2 = shown.species * countK, mp = shown.mapped * countK;
    ui.species.textContent = fmt(sp2);
    ui.mapped.textContent = fmt(sp2 * shown.mapped);
    ui.pct.textContent = `${Math.round(mp * 100)}%`;
    ui.bar.style.width = `${(mp * 100).toFixed(2)}%`;
    ui.acc.textContent = `${(shown.series[shown.series.length - 1] * countK).toFixed(1)}%`;
    renderChart(smooth(span(b, 0.6, 0.95)));

    // copy arrives with the build
    const head = smooth(span(b, 0.22, 0.42));
    ui.kicker.style.opacity = head.toFixed(3);
    ui.titleLines.forEach((el, i) => {
      const k = smooth(span(b, 0.26 + i * 0.05, 0.46 + i * 0.05));
      el.style.transform = k < 1 ? `translateY(${((1 - k) * 108).toFixed(1)}%)` : '';
    });
    const statK = smooth(span(b, 0.46, 0.6));
    ui.stats.style.opacity = statK.toFixed(3);
    ui.stats.style.transform = statK < 1 ? `translateY(${((1 - statK) * 16).toFixed(1)}px)` : '';
    const chartK = smooth(span(b, 0.54, 0.68));
    ui.chart.style.opacity = chartK.toFixed(3);
    ui.chart.style.transform = chartK < 1 ? `translateY(${((1 - chartK) * 16).toFixed(1)}px)` : '';
    const whereK = smooth(span(b, 0.86, 1));
    ui.where.style.opacity = whereK.toFixed(3);
    ui.hint.style.opacity = (whereK * 0.9).toFixed(3);
    if (!selected && !loc) updateWhere();

    if (dirty || b < 1 || loc) { draw(now); dirty = false; }   // the location ring pulses
  }
  requestAnimationFrame(frame);
})();
