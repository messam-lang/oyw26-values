/* OYW26 toolkit: animated email signature (600x150).
 * Base = design background + the person's details + logos, drawn on canvas in Poppins.
 * Animation = the designer's alpha layer, pre-rendered to sprite strips (assets/signature/<a|b>/).
 * Exports an animated GIF (gifenc, encoded in the browser) and a static PNG. Nothing leaves the device.
 */
(() => {
  'use strict';
  const W = 600, H = 150;
  const $ = (id) => document.getElementById(id);
  const OYW = (window.OYW = window.OYW || {});

  // Layout measured from the designer's finished frames (600x150). y = text baseline.
  const DESIGNS = {
    a: {
      label: 'White', bg: '#ffffff',
      name:  { x: 21,  y: 74,    size: 24,   weight: 600, color: '#083826', align: 'left',  maxW: 420 },
      title: { x: 22,  y: 91.5,  size: 16,   weight: 500, color: '#62d36f', align: 'left',  maxW: 420 },
      email: { x: 22,  y: 126.5, size: 14.5, weight: 400, color: '#a9e6aa', align: 'left',  maxW: 258 },
      phone: { x: 293, y: 126.5, size: 14.5, weight: 400, color: '#a9e6aa', align: 'left',  maxW: 158 },
      se:    { x: 462, y: 112, w: 66 },
      divider: { x: 540.5, y0: 111, y1: 131, color: 'rgba(8, 56, 38, 0.55)' },
      one:   { x: 544, y: 114, w: 40 },
    },
    b: {
      label: 'Mint', bg: '#e7ffd9', contentFollowsOverlay: true,   // name, details and logos fade out while the pattern washes over, back in as it clears
      name:  { x: 300, y: 74,   size: 28, weight: 600, color: '#57b959', align: 'center', maxW: 420 },
      title: { x: 300, y: 88.5, size: 15, weight: 500, color: '#57b959', align: 'center', maxW: 420 },
      email: { x: 60,  y: 134,  size: 16, weight: 400, color: '#57b959', align: 'left',   maxW: 345 },
      phone: { x: 540, y: 134,  size: 16, weight: 400, color: '#57b959', align: 'right',  maxW: 130 },
      se:    { x: 30, y: 67, w: 57 },
      one:   { x: 534, y: 70, w: 34 },
    },
  };
  const PLACEHOLDER = { name: 'John Smith', title: 'Marketing & Communications', email: 'john.smith@se.com', phone: '+20 1234 56 789' };

  const els = {
    canvas: $('sigCanvas'), panel: $('tool-signature'),
    name: $('sigName'), title: $('sigTitle'), email: $('sigEmail'), phone: $('sigPhone'),
    gif: $('sigGif'), png: $('sigPng'), hint: $('sigHint'), copyText: $('sigCopyText'), sigText: $('sigText'),
    options: [...document.querySelectorAll('.sig-option')],
  };
  if (!els.canvas) return;

  const state = { design: 'a', fields: { name: '', title: '', email: '', phone: '' }, busy: false };
  const assets = { se: null, one: null, sprites: {} };   // sprites[key] = { manifest, strips: [Image] }
  const ctx = els.canvas.getContext('2d');
  const SCALE = 2;                                       // preview canvas is 1200x300 for crisp text
  els.canvas.width = W * SCALE; els.canvas.height = H * SCALE;

  const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Failed: ' + src)); im.src = src; });
  async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 20px Poppins`).catch(() => {})));
  }
  async function loadSprites(key) {
    if (assets.sprites[key]) return assets.sprites[key];
    const manifest = await fetch(`assets/signature/${key}/manifest.json`, { cache: 'no-cache' }).then((r) => r.json());
    const v = manifest.built ? `?v=${manifest.built}` : '';
    const strips = await Promise.all(Array.from({ length: manifest.strips }, (_, i) =>
      loadImage(`assets/signature/${key}/strip-${String(i).padStart(2, '0')}.${manifest.ext || 'png'}${v}`)));
    assets.sprites[key] = { manifest, strips };
    return assets.sprites[key];
  }

  // ---------------------------------------------------------------- drawing
  // The designer's type is set tighter than browser Poppins: measured against the reference frames,
  // matching widths need the size at 96% and the glyphs condensed to 95%.
  const SIZE_K = 0.96, X_K = 0.95;
  function fitFont(g, text, spec) {
    let size = spec.size * SIZE_K;
    g.font = `${spec.weight} ${size}px Poppins, system-ui, sans-serif`;
    const w = g.measureText(text).width * X_K;
    if (w > spec.maxW) { size = Math.max(8, size * spec.maxW / w); g.font = `${spec.weight} ${size}px Poppins, system-ui, sans-serif`; }
    return size;
  }
  function drawText(g, text, spec, placeholder) {
    if (!text) return;
    fitFont(g, text, spec);
    g.textAlign = spec.align; g.textBaseline = 'alphabetic';
    g.fillStyle = spec.color;
    const outer = g.globalAlpha;
    g.globalAlpha = outer * (placeholder ? 0.45 : 1);
    g.save();
    g.translate(spec.x, spec.y);
    g.scale(X_K, 1);
    g.fillText(text, 0, 0);
    g.restore();
    g.globalAlpha = outer;
  }
  function drawContent(g, design, fields, usePlaceholders, alpha) {
    const d = DESIGNS[design];
    for (const k of ['name', 'title', 'email', 'phone']) {
      const v = (fields[k] || '').trim();
      g.globalAlpha = (k === 'name' || k === 'title') ? alpha.name : alpha.rest;
      if (v) drawText(g, v, d[k], false);
      else if (usePlaceholders) drawText(g, PLACEHOLDER[k], d[k], true);
    }
    g.globalAlpha = alpha.rest;
    if (assets.se) { const h = d.se.w * assets.se.naturalHeight / assets.se.naturalWidth; g.drawImage(assets.se, d.se.x, d.se.y, d.se.w, h); }
    if (d.divider) { g.fillStyle = d.divider.color; g.fillRect(d.divider.x - 0.5, d.divider.y0, 1, d.divider.y1 - d.divider.y0); }
    if (assets.one) { const h = d.one.w * assets.one.naturalHeight / assets.one.naturalWidth; g.drawImage(assets.one, d.one.x, d.one.y, d.one.w, h); }
  }
  function drawOverlay(g, sprite, frame) {
    if (!sprite) return;
    const { manifest, strips } = sprite;
    const i = ((frame % manifest.frames) + manifest.frames) % manifest.frames;
    const strip = strips[Math.floor(i / manifest.framesPerStrip)];
    const row = i % manifest.framesPerStrip;
    if (strip) g.drawImage(strip, 0, row * H, W, H, 0, 0, W, H);
  }
  // opacity of the text and logos for a given animation frame (1 = fully visible)
  function contentAlpha(design, sprite, frame) {
    const d = DESIGNS[design];
    if (!d.contentFollowsOverlay || !sprite || !sprite.manifest.coverage) return { name: 1, rest: 1 };
    const cov = sprite.manifest.coverage;
    const c = cov[((frame % cov.length) + cov.length) % cov.length] || 0;
    // in the comp the name lingers slightly while details and logos clear first
    return { name: Math.pow(1 - c, 0.7), rest: Math.pow(1 - c, 1.6) };
  }
  function drawFrame(g, scale, frame, usePlaceholders) {
    const d = DESIGNS[state.design];
    const sprite = assets.sprites[state.design];
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.fillStyle = d.bg; g.fillRect(0, 0, W, H);
    const a = contentAlpha(state.design, sprite, frame);
    if (a.name > 0.002 || a.rest > 0.002) {
      g.save();
      drawContent(g, state.design, state.fields, usePlaceholders, a);
      g.restore();
    }
    drawOverlay(g, sprite, frame);
  }

  // ---------------------------------------------------------------- preview loop
  let raf = 0, t0 = 0;
  function tick(now) {
    raf = 0;
    if (els.panel.hidden) return;   // restarted on tab show; a hidden page just pauses requestAnimationFrame
    const sprite = assets.sprites[state.design];
    const fps = sprite ? sprite.manifest.fps : 12;
    if (!t0) t0 = now;
    const frame = Math.floor((now - t0) / 1000 * fps);
    drawFrame(ctx, SCALE, frame, true);
    raf = requestAnimationFrame(tick);
  }
  function startLoop() { if (!raf) raf = requestAnimationFrame(tick); }
  document.addEventListener('oyw:tab', (e) => { if (e.detail === 'signature') { init(); startLoop(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) startLoop(); });
  window.addEventListener('pageshow', startLoop);
  window.addEventListener('focus', startLoop);

  // ---------------------------------------------------------------- inputs
  function readFields() {
    state.fields = { name: els.name.value, title: els.title.value, email: els.email.value, phone: els.phone.value };
    const ready = !!state.fields.name.trim();
    els.gif.disabled = !ready || state.busy; els.png.disabled = !ready || state.busy;
    els.hint.textContent = ready
      ? 'The GIF plays in Gmail, Apple Mail and Outlook on the web. Outlook for Windows shows the first frame, which is the finished design.'
      : 'Type at least your name to unlock the downloads.';
    try { localStorage.setItem('oyw-sig', JSON.stringify(state.fields)); } catch (_) {}
    startLoop();
  }
  for (const k of ['name', 'title', 'email', 'phone']) els[k].addEventListener('input', readFields);
  function selectDesign(key) {
    state.design = key;
    for (const b of els.options) b.setAttribute('aria-checked', String(b.dataset.sig === key));
    loadSprites(key).then(startLoop).catch((e) => console.warn(e));
    try { localStorage.setItem('oyw-sig-design', key); } catch (_) {}
    startLoop();
  }
  els.options.forEach((b) => b.addEventListener('click', () => selectDesign(b.dataset.sig)));

  // ---------------------------------------------------------------- export
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function safeName() { return (state.fields.name.trim() || 'signature').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, ''); }
  async function renderStatic() {
    await init();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    drawFrame(c.getContext('2d'), 1, 0, false);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
  async function renderGif(onProgress) {
    await init();
    const { GIFEncoder, quantize, applyPalette } = await import(new URL('vendor/gifenc.esm.js', document.baseURI).href);   // absolute: import() in a classic script resolves against the script URL in some browsers
    const sprite = assets.sprites[state.design];
    const frames = sprite.manifest.frames, fps = sprite.manifest.fps;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    // one global palette built from a clean frame plus the busiest overlay frame keeps colours stable across frames
    const sample = new Uint8ClampedArray(W * H * 4 * 2);
    drawFrame(g, 1, 0, false); sample.set(g.getImageData(0, 0, W, H).data, 0);
    drawFrame(g, 1, Math.floor(frames / 2), false); sample.set(g.getImageData(0, 0, W, H).data, W * H * 4);
    const palette = quantize(sample, 256, { format: 'rgb565' });
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);
    for (let i = 0; i < frames; i++) {
      drawFrame(g, 1, i, false);
      const { data } = g.getImageData(0, 0, W, H);
      const index = applyPalette(data, palette, 'rgb565');
      gif.writeFrame(index, W, H, i === 0 ? { palette, delay, repeat: 0 } : { delay });
      if (onProgress) onProgress((i + 1) / frames);
      if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
    }
    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }
  async function doExport(kind) {
    if (state.busy) return;
    state.busy = true; readFields();
    const btn = kind === 'gif' ? els.gif : els.png;
    const label = btn.textContent;
    try {
      if (kind === 'gif') {
        const blob = await renderGif((p) => { btn.textContent = `Encoding… ${Math.round(p * 100)}%`; });
        download(blob, `OYW26-email-signature-${safeName()}.gif`);
        els.hint.textContent = `Saved. GIF size: ${(blob.size / 1024).toFixed(0)} KB.`;
      } else {
        const blob = await renderStatic();
        download(blob, `OYW26-email-signature-${safeName()}.png`);
      }
    } catch (err) {
      console.error(err);
      els.hint.textContent = 'Something went wrong while exporting. Please try again.';
    } finally {
      btn.textContent = label; state.busy = false; readFields();
    }
  }
  els.gif.addEventListener('click', () => doExport('gif'));
  els.png.addEventListener('click', () => doExport('png'));
  if (els.copyText) els.copyText.addEventListener('click', async (e) => {
    const t = els.sigText.textContent;
    try { await navigator.clipboard.writeText(t); e.currentTarget.textContent = 'Copied'; }
    catch (_) { e.currentTarget.textContent = 'Select and copy the text above'; }
    setTimeout(() => { els.copyText.textContent = 'Copy text'; }, 1800);
  });

  // ---------------------------------------------------------------- init
  let initPromise = null;
  function init() {
    if (!initPromise) {
      initPromise = (async () => {
        await ensureFonts();
        [assets.se, assets.one] = await Promise.all([loadImage('assets/signature/se-wordmark-dark.png'), loadImage('assets/signature/oyw-one.png')]);
        await loadSprites(state.design);
        loadSprites(state.design === 'a' ? 'b' : 'a').catch(() => {});
        startLoop();
      })().catch((e) => { console.warn(e); initPromise = null; });
    }
    return initPromise;
  }
  try {
    const saved = JSON.parse(localStorage.getItem('oyw-sig') || 'null');
    if (saved) for (const k of ['name', 'title', 'email', 'phone']) if (saved[k]) els[k].value = saved[k];
    const d = localStorage.getItem('oyw-sig-design'); if (d && DESIGNS[d]) state.design = d;
  } catch (_) {}
  for (const b of els.options) b.setAttribute('aria-checked', String(b.dataset.sig === state.design));
  readFields();
  if (!els.panel.hidden) init();
  OYW.signature = { init, renderStatic, renderGif, state, DESIGNS, drawFrame };
})();
