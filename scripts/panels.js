/* ============================================================
   MORSIS — panels.js
   Shared page furniture: the sound toggle + Web Audio hook,
   line-mask heading reveals, generated barcodes, reveal-on-
   scroll for the flowing (non-pinned) panels, and the inquiry
   form. Loaded before transmit.js and translator.js.
   ============================================================ */

(() => {
  'use strict';

  const M = (window.MORSIS = window.MORSIS || {});
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // the sound engine (context, chirps, zones, the Sound switch) lives in audio.js

  /* ---------------- Fig. 02: upload your sample ----------------
     There is no server yet: a sample is read in the browser (the pill fills
     with the real read progress) and kept in MORSIS.samples, announced by a
     `morsis:sample` event, ready for the training pipeline to collect. */

  const upInput = document.querySelector('[data-fig2-upload]');
  if (upInput) {
    const upBtn = upInput.closest('.fig2-upload__btn');
    const upLabel = upBtn.querySelector('[data-fig2-upload-label]');
    const MAX_MB = 25;
    M.samples = M.samples || [];
    const say = (text, ms) => {
      upLabel.textContent = text;
      if (ms) setTimeout(() => { upLabel.textContent = 'Upload your sample'; upBtn.classList.remove('is-done'); upBtn.style.setProperty('--fill', 0); }, ms);
    };
    upInput.addEventListener('change', () => {
      const file = upInput.files && upInput.files[0];
      upInput.value = '';                         // the same file can be chosen again
      if (!file) return;
      if (!/^audio\//.test(file.type)) { say('Audio files only', 2600); return; }
      if (file.size > MAX_MB * 1024 * 1024) { say(`Max ${MAX_MB} MB`, 2600); return; }
      upBtn.classList.remove('is-done');
      upBtn.style.setProperty('--fill', 0);
      say('Reading sample…');
      const reader = new FileReader();
      reader.onprogress = (e) => { if (e.lengthComputable) upBtn.style.setProperty('--fill', (e.loaded / e.total).toFixed(3)); };
      reader.onerror = () => say('Could not read file', 2600);
      reader.onload = () => {
        upBtn.style.setProperty('--fill', 1);
        const url = URL.createObjectURL(file);
        const sample = { file, name: file.name, size: file.size, type: file.type, url, duration: null, at: new Date().toISOString() };
        const probe = new Audio();
        probe.preload = 'metadata';
        probe.addEventListener('loadedmetadata', () => { sample.duration = probe.duration; }, { once: true });
        probe.src = url;
        M.samples.push(sample);
        window.dispatchEvent(new CustomEvent('morsis:sample', { detail: sample }));
        const short = file.name.length > 18 ? `${file.name.slice(0, 15)}…` : file.name;
        upBtn.classList.add('is-done');
        say(`${short} · added`, 4200);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ---------------- line-mask reveals ---------------- */

  const lineHeads = Array.from(document.querySelectorAll('.lines'));
  lineHeads.forEach((el) => {
    Array.from(el.children).forEach((line, i) => {
      const inner = document.createElement('span');
      inner.className = 'li';
      inner.style.setProperty('--i', i);
      while (line.firstChild) inner.appendChild(line.firstChild);
      line.appendChild(inner);
    });
  });
  if (reduced || !('IntersectionObserver' in window)) {
    lineHeads.forEach((el) => el.classList.add('is-in'));
  } else {
    const lio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); lio.unobserve(e.target); }
      });
    }, { threshold: 0.35 });
    lineHeads.forEach((el) => lio.observe(el));
  }

  /* ---------------- barcodes ---------------- */

  // a deterministic 1-D barcode from any string — decorative, but stable per code
  M.barcode = function barcode(el, code) {
    const bars = [];
    let x = 0;
    const push = (w, ink) => { if (ink) bars.push(`<rect x="${x}" width="${w}" height="40"/>`); x += w; };
    push(2, true); push(1, false); push(1, true); push(1, false);           // start guard
    for (const ch of String(code)) {
      let c = ch.charCodeAt(0);
      for (let b = 0; b < 4; b++) {
        push(1 + (c & 3), true);
        c >>= 2;
        push(1 + (c & 1), false);
        c >>= 1;
      }
    }
    push(1, true); push(1, false); push(2, true);                            // end guard
    el.innerHTML = `<svg viewBox="0 0 ${x} 40" preserveAspectRatio="none" aria-hidden="true">${bars.join('')}</svg>`;
  };
  document.querySelectorAll('.barcode[data-code]').forEach((el) => M.barcode(el, el.dataset.code));

  /* ---------------- reveal-on-scroll for flowing panels ---------------- */

  const reveals = Array.from(document.querySelectorAll('.reveal'));
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((el) => io.observe(el));
  }

  /* ---------------- inquiry form (prototype — nothing is sent) ---------------- */

  const form = document.getElementById('inqForm');
  if (form) {
    const note = document.getElementById('inqNote');
    const msg = document.getElementById('inqMsg');
    const count = document.getElementById('inqCount');
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    msg.addEventListener('input', () => { count.textContent = `${msg.value.length} / 600`; });

    // validate a field as soon as the visitor leaves it, not only on submit
    const check = (el) => {
      const v = el.value.trim();
      const ok = el.type === 'email' ? email.test(v) : v.length > 0;
      el.closest('.field').classList.toggle('is-invalid', !ok);
      el.setAttribute('aria-invalid', String(!ok));
      return ok;
    };
    form.querySelectorAll('input[required], textarea[required]').forEach((el) => {
      el.addEventListener('blur', () => { if (el.value) check(el); });
      el.addEventListener('input', () => { if (el.closest('.field').classList.contains('is-invalid')) check(el); });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fields = Array.from(form.querySelectorAll('input[required], textarea[required]'));
      const bad = fields.filter((el) => !check(el));
      if (bad.length) {
        // name the fields, and what a valid email needs
        const names = bad.map((el) => (el.type === 'email' && el.value.trim()
          ? 'a full email address (name@domain)'
          : form.querySelector(`label[for="${el.id}"]`).firstChild.textContent.trim().toLowerCase()));
        note.textContent = `Still needed: ${names.join(', ')}.`;
        note.className = 'form-note is-error';
        bad[0].focus();
        return;
      }
      const name = form.elements.name.value.trim().split(/\s+/)[0];
      note.textContent = `Logged, ${name}. This is a design prototype, so nothing was sent.`;
      note.className = 'form-note is-ok';
      form.reset();
      count.textContent = '0 / 600';
    });
  }

  /* ---------------- manifesto motion ---------------- */

  // decode: text resolves out of binary, left to right (data → language)
  function decode(el, dur) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim()) nodes.push({ node: walker.currentNode, text: walker.currentNode.textContent });
    }
    const total = nodes.reduce((a, n) => a + n.text.length, 0);
    if (!total || reduced) return;
    el.setAttribute('aria-label', nodes.map((n) => n.text).join('').replace(/\s+/g, ' ').trim());
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min(1, (now - t0) / dur);
      let idx = 0;
      nodes.forEach((n) => {
        let out = '';
        for (const ch of n.text) {
          out += ch.trim() === '' || idx / total < k ? ch : (Math.random() < 0.5 ? '0' : '1');
          idx++;
        }
        n.node.textContent = out;
      });
      if (k < 1) requestAnimationFrame(step);
      else { nodes.forEach((n) => { n.node.textContent = n.text; }); el.removeAttribute('aria-label'); }
    })(t0);
  }

  // what decodes: value codes + titles, log/reading labels, publication IDs, the fine print
  document.querySelectorAll('.value__n, .value__title, .pubs__head .kicker, .reading .kicker, .pub-table td:first-child, .colophon__fine')
    .forEach((el) => el.setAttribute('data-decode', ''));
  document.querySelectorAll('.pub-table tbody tr').forEach((tr, i) => tr.style.setProperty('--row', i));
  document.querySelectorAll('.colophon__row > *').forEach((el, i) => el.style.setProperty('--i', i));

  const decodeTargets = Array.from(document.querySelectorAll('[data-decode]'));
  const drawTargets = Array.from(document.querySelectorAll('.values, .colophon'));
  if (reduced || !('IntersectionObserver' in window)) {
    drawTargets.forEach((el) => el.classList.add('is-in'));
  } else {
    const dio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        dio.unobserve(e.target);
        if (e.target.hasAttribute('data-decode')) {
          const delay = e.target.matches('.pub-table td') ? 260 + 80 * Number(e.target.parentElement.style.getPropertyValue('--row') || 0) : 120;
          setTimeout(() => decode(e.target, e.target.matches('.colophon__fine') ? 1400 : 800), delay);
        } else {
          e.target.classList.add('is-in');
        }
      });
    }, { threshold: 0.3 });
    decodeTargets.concat(drawTargets).forEach((el) => dio.observe(el));
  }

  // text that sits behind the gate decodes the moment the visitor walks in
  const onEnter = Array.from(document.querySelectorAll('[data-decode-on-enter]'));
  if (onEnter.length) {
    const run = () => onEnter.forEach((el, i) => setTimeout(() => decode(el, 900), reduced ? 0 : 500 + i * 120));
    if (M.gated) window.addEventListener('morsis:enter', run, { once: true }); else run();
  }

  // statement: words light as you read down the page; glow follows the cursor
  const statement = document.getElementById('mfTitle');
  const glowFrame = document.querySelector('.frame--glow');
  const mfHero = document.querySelector('.mf-hero');
  const sWords = [];
  if (statement) {
    statement.querySelectorAll('.li').forEach((li) => {
      const parts = li.textContent.split(/(\s+)/);
      li.textContent = '';
      parts.forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { li.appendChild(document.createTextNode(part)); return; }
        const w = document.createElement('span');
        w.className = 'sw';
        w.textContent = part;
        li.appendChild(w);
        sWords.push(w);
      });
    });
  }
  if (mfHero && glowFrame && !reduced) {
    mfHero.addEventListener('pointermove', (e) => {
      const r = mfHero.getBoundingClientRect();
      glowFrame.style.setProperty('--gx', ((e.clientX - r.left - r.width / 2) * 0.06).toFixed(1));
      glowFrame.style.setProperty('--gy', ((e.clientY - r.top - r.height / 2) * 0.06).toFixed(1));
    }, { passive: true });
  }

  const colWord = document.querySelector('.colophon__word');
  let lastLit = -1;
  // read layout only while the manifesto is near the screen: reading rects every
  // frame, right after flow.js writes its styles, forced a layout on every page
  let near = false;
  const nearEl = document.getElementById('s-manifesto');
  if (nearEl) new IntersectionObserver((en) => { near = en[0].isIntersecting; }, { rootMargin: '100% 0px' }).observe(nearEl);
  (function scrollFrame() {
    requestAnimationFrame(scrollFrame);
    if (!near) return;
    const vh = window.innerHeight;
    if (statement && sWords.length) {
      const r = statement.getBoundingClientRect();
      if (r.bottom > -vh && r.top < vh * 2) {
        const p = Math.min(1, Math.max(0, (vh * 0.86 - r.top) / (vh * 0.5)));
        const n = reduced ? sWords.length : Math.round(p * sWords.length);
        if (n !== lastLit) {
          lastLit = n;
          sWords.forEach((w, i) => w.classList.toggle('is-lit', i < n));
        }
        if (glowFrame) {
          const hr = mfHero.getBoundingClientRect();
          glowFrame.style.setProperty('--orbit-rot', `${((vh - hr.top) / vh * 18).toFixed(2)}deg`);
        }
      }
    }
    if (colWord) {
      const r = colWord.getBoundingClientRect();
      if (r.top < vh * 1.2 && r.bottom > 0) {
        const p = reduced ? 1 : Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.55)));
        colWord.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`;
      }
    }
  })();
})();
