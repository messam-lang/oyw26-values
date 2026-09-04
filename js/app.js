/* Schneider Electric × One Young World · #OYW26 value frame tool
 * Everything runs in the browser: face detection (TensorFlow.js BlazeFace), compositing (canvas), export.
 * No photo ever leaves the device.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const FRAME = 1080;
  // Transparent window of the frame (measured from the delivered PNG): bbox and centroid.
  const WINDOW = { x0: 60, y0: 40, x1: 1019, y1: 974, cx: 555, cy: 494 };
  // Where the detected face box should land inside the frame (centre + box height), in frame px.
  const FACE_TARGET = { x: 556, y: 478, h: 310 };
  const MAX_SRC_SIDE = 2200;     // photo is downscaled to this before compositing (memory-safe on phones)
  const DETECT_SIDE = 640;       // detection input long side

  // Order follows "The Journey" in the client's iconography doc (Welcome is the opening-ceremony mark, not a personal value).
  const VALUES = [
    { id: 'community',  name: 'Community',  tagline: 'Stronger together.' },
    { id: 'friendship', name: 'Friendship', tagline: 'Bonds that power change.' },
    { id: 'knowledge',  name: 'Knowledge',  tagline: 'Learning that lights the way.' },
    { id: 'action',     name: 'Action',     tagline: 'Turning ideas into impact.' },
    { id: 'progress',   name: 'Progress',   tagline: 'Every step forward counts.' },
  ];

  const COPY = {
    shareTitle: 'My #OYW26 value',
    shareText: (v) => `Powered By Each Other. For me, it's ${v}. #OYW26 #AdvancingEnergyTech`,
    eventTitle: 'Advancing Energy Tech',
    eventSub: 'Powered By Each Other.',
    eventWhere: 'Cape Town · 3–6 November 2026',
    hashtags: '#AdvancingEnergyTech   #OYW26',
    partners: 'Schneider Electric  ×  One Young World',
  };

  // ---------------------------------------------------------------- dom
  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $('canvas'), hint: $('hint'), busy: $('busy'), busyText: $('busyText'),
    file: $('file'), fileLabel: $('fileLabel'),
    faces: $('faces'), faceList: $('faceList'),
    legend: $('legend'),
    zoom: $('zoom'), rotate: $('rotate'), recenter: $('recenter'), straighten: $('straighten'), reset: $('reset'),
    save: $('save'), saveLabel: $('saveLabel'), story: $('story'), saveHint: $('saveHint'),
    toast: $('toast'), bgVideo: $('bgVideo'),
  };
  const ctx = els.canvas.getContext('2d', { alpha: false });

  // ---------------------------------------------------------------- state
  const state = {
    src: null, w: 0, h: 0,          // downscaled photo canvas + size
    scale: 1, tx: FRAME / 2, ty: FRAME / 2, rot: 0,
    faces: [], faceIdx: -1,
    valueId: null,
    auto: null,                     // last automatic fit, for Reset
    minScale: 0.2, maxScale: 8,
  };
  const assets = { frameBg: null, frameIcons: {}, legendIcons: {}, pattern: null };
  const isTouch = matchMedia('(pointer: coarse)').matches;

  // ---------------------------------------------------------------- utils
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const loadImage = (src) => new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Failed to load ' + src));
    im.src = src;
  });
  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }
  function setBusy(text) {
    if (text) { els.busyText.textContent = text; els.busy.hidden = false; }
    else els.busy.hidden = true;
  }

  // ---------------------------------------------------------------- drawing
  let raf = 0;
  function requestDraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

  function drawScene(g, size) {
    const k = size / FRAME;
    g.save();
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#0a2f24';
    g.fillRect(0, 0, FRAME, FRAME);
    if (state.src) {
      g.save();
      g.translate(state.tx, state.ty);
      g.rotate(state.rot);
      g.scale(state.scale, state.scale);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(state.src, -state.w / 2, -state.h / 2);
      g.restore();
    } else {
      // empty-state: soft glow + prompt inside the window
      const rg = g.createRadialGradient(WINDOW.cx, WINDOW.cy, 40, WINDOW.cx, WINDOW.cy, 520);
      rg.addColorStop(0, 'rgba(61,205,88,0.35)');
      rg.addColorStop(1, 'rgba(61,205,88,0)');
      g.fillStyle = rg; g.fillRect(0, 0, FRAME, FRAME);
      g.fillStyle = 'rgba(231,255,217,0.92)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 46px Poppins, system-ui, sans-serif';
      g.fillText(isTouch ? 'Tap to add your photo' : 'Click or drop your photo here', WINDOW.cx, WINDOW.cy - 10);
      g.font = '500 30px Poppins, system-ui, sans-serif';
      g.fillStyle = 'rgba(231,255,217,0.65)';
      g.fillText('Your face gets framed automatically', WINDOW.cx, WINDOW.cy + 48);
    }
    if (assets.frameBg) g.drawImage(assets.frameBg, 0, 0, FRAME, FRAME);
    const icon = state.valueId && assets.frameIcons[state.valueId];
    if (icon) g.drawImage(icon, 0, 0, FRAME, FRAME);
    g.restore();
  }
  function draw() { drawScene(ctx, FRAME); }

  // ---------------------------------------------------------------- transforms
  function coverScale() {
    return Math.max((WINDOW.x1 - WINDOW.x0) / state.w, (WINDOW.y1 - WINDOW.y0) / state.h);
  }
  function setScaleBounds() {
    const c = coverScale();
    state.minScale = c * 0.45;
    state.maxScale = Math.max(c * 6, 6);
  }
  function clampCover() {
    // keep the photo covering the window bbox when it can (only meaningful with no rotation)
    if (Math.abs(state.rot) > 1e-3) return;
    const sw = state.w * state.scale, sh = state.h * state.scale;
    const minTx = WINDOW.x1 - sw / 2, maxTx = WINDOW.x0 + sw / 2;
    const minTy = WINDOW.y1 - sh / 2, maxTy = WINDOW.y0 + sh / 2;
    state.tx = minTx <= maxTx ? clamp(state.tx, minTx, maxTx) : (WINDOW.x0 + WINDOW.x1) / 2;
    state.ty = minTy <= maxTy ? clamp(state.ty, minTy, maxTy) : (WINDOW.y0 + WINDOW.y1) / 2;
  }
  // frame-space position of a photo pixel (px,py) under the current transform
  function photoToFrame(px, py) {
    const lx = (px - state.w / 2) * state.scale, ly = (py - state.h / 2) * state.scale;
    const c = Math.cos(state.rot), s = Math.sin(state.rot);
    return { x: state.tx + lx * c - ly * s, y: state.ty + lx * s + ly * c };
  }
  function zoomAbout(k, px, py) {
    const ns = clamp(state.scale * k, state.minScale, state.maxScale);
    k = ns / state.scale;
    state.tx = px + (state.tx - px) * k;
    state.ty = py + (state.ty - py) * k;
    state.scale = ns;
  }
  function rotateAbout(d, px, py) {
    const c = Math.cos(d), s = Math.sin(d);
    const dx = state.tx - px, dy = state.ty - py;
    state.tx = px + dx * c - dy * s;
    state.ty = py + dx * s + dy * c;
    state.rot += d;
  }
  function fitToFace(f) {
    setScaleBounds();
    const s = clamp(Math.max(FACE_TARGET.h / f.h, coverScale()), state.minScale, state.maxScale);
    state.scale = s; state.rot = 0;
    state.tx = FACE_TARGET.x - (f.cx - state.w / 2) * s;
    state.ty = FACE_TARGET.y - (f.cy - state.h / 2) * s;
    clampCover();
    state.auto = { scale: state.scale, tx: state.tx, ty: state.ty, rot: 0 };
    syncSliders();
  }
  function fitCenter() {
    setScaleBounds();
    state.scale = coverScale(); state.rot = 0;
    state.tx = (WINDOW.x0 + WINDOW.x1) / 2; state.ty = (WINDOW.y0 + WINDOW.y1) / 2;
    state.auto = { scale: state.scale, tx: state.tx, ty: state.ty, rot: 0 };
    syncSliders();
  }
  function syncSliders() {
    const t = Math.log(state.scale / state.minScale) / Math.log(state.maxScale / state.minScale);
    els.zoom.value = Math.round(clamp(t, 0, 1) * 1000);
    els.rotate.value = (state.rot * 180 / Math.PI).toFixed(1);
  }
  function currentFace() { return state.faces[state.faceIdx] || null; }
  function faceFrameCenter() {
    const f = currentFace();
    return f ? photoToFrame(f.cx, f.cy) : { x: WINDOW.cx, y: WINDOW.cy };
  }

  // ---------------------------------------------------------------- gestures
  const pointers = new Map();
  let prevPinch = null;      // { mid, dist, ang }
  let rotAccum = 0, rotEngaged = false;
  let hintShown = false;

  function framePoint(e) {
    const r = els.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * FRAME / r.width, y: (e.clientY - r.top) * FRAME / r.height };
  }
  function pinchOf(pts) {
    const [a, b] = pts;
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      ang: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }
  // opening the file picker needs a completed click/tap (user activation), not pointerdown
  els.canvas.addEventListener('click', () => { if (!state.src) els.file.click(); });
  els.canvas.addEventListener('pointerdown', (e) => {
    if (!state.src) return;
    e.preventDefault();
    els.canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, framePoint(e));
    if (pointers.size === 2) { prevPinch = pinchOf([...pointers.values()]); rotAccum = 0; rotEngaged = false; }
    if (!hintShown) { hintShown = true; els.hint.classList.add('fade'); }
  });
  els.canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = framePoint(e);
    if (pointers.size === 1) {
      const prev = pointers.get(e.pointerId);
      state.tx += p.x - prev.x; state.ty += p.y - prev.y;
    }
    pointers.set(e.pointerId, p);
    if (pointers.size === 2 && prevPinch) {
      const cur = pinchOf([...pointers.values()]);
      zoomAbout(cur.dist / prevPinch.dist, cur.mid.x, cur.mid.y);
      let d = cur.ang - prevPinch.ang;
      if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      rotAccum += d;
      if (!rotEngaged && Math.abs(rotAccum) > 4 * Math.PI / 180) { rotEngaged = true; }
      if (rotEngaged) rotateAbout(d, cur.mid.x, cur.mid.y);
      state.tx += cur.mid.x - prevPinch.mid.x; state.ty += cur.mid.y - prevPinch.mid.y;
      prevPinch = cur;
    }
    syncSliders();
    requestDraw();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    prevPinch = pointers.size === 2 ? pinchOf([...pointers.values()]) : null;
  };
  els.canvas.addEventListener('pointerup', endPointer);
  els.canvas.addEventListener('pointercancel', endPointer);
  els.canvas.addEventListener('wheel', (e) => {
    if (!state.src) return;
    e.preventDefault();
    const p = framePoint(e);
    zoomAbout(Math.exp(-e.deltaY * 0.0016), p.x, p.y);
    syncSliders(); requestDraw();
  }, { passive: false });
  els.canvas.addEventListener('dblclick', () => { if (state.auto) { Object.assign(state, state.auto); syncSliders(); requestDraw(); } });
  els.canvas.addEventListener('keydown', (e) => {
    if (!state.src) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.file.click(); } return; }
    const step = e.shiftKey ? 20 : 5;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) { state.tx += map[e.key][0]; state.ty += map[e.key][1]; e.preventDefault(); requestDraw(); }
    else if (e.key === '+' || e.key === '=') { zoomAbout(1.05, WINDOW.cx, WINDOW.cy); syncSliders(); requestDraw(); }
    else if (e.key === '-') { zoomAbout(1 / 1.05, WINDOW.cx, WINDOW.cy); syncSliders(); requestDraw(); }
  });

  // sliders
  els.zoom.addEventListener('input', () => {
    if (!state.src) return;
    const t = els.zoom.value / 1000;
    const target = state.minScale * Math.pow(state.maxScale / state.minScale, t);
    const c = faceFrameCenter();
    zoomAbout(target / state.scale, c.x, c.y);
    requestDraw();
  });
  els.rotate.addEventListener('input', () => {
    if (!state.src) return;
    const target = parseFloat(els.rotate.value) * Math.PI / 180;
    const c = faceFrameCenter();
    rotateAbout(target - state.rot, c.x, c.y);
    requestDraw();
  });
  els.recenter.addEventListener('click', () => {
    if (!state.src) return;
    const f = currentFace();
    if (f) fitToFace(f); else { fitCenter(); toast('No face was detected in this photo, so it is centred instead.'); }
    requestDraw();
  });
  els.straighten.addEventListener('click', () => {
    const f = currentFace();
    if (!state.src) return;
    if (!f || f.eyeAngle == null) { toast('Straighten needs a detected face. Use the Rotate slider instead.'); return; }
    const c = faceFrameCenter();
    rotateAbout((-f.eyeAngle) - state.rot, c.x, c.y);
    syncSliders(); requestDraw();
  });
  els.reset.addEventListener('click', () => {
    if (!state.auto) return;
    Object.assign(state, state.auto); syncSliders(); requestDraw();
  });

  // ---------------------------------------------------------------- legend
  function buildLegend() {
    els.legend.innerHTML = '';
    for (const v of VALUES) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'value'; b.role = 'radio';
      b.setAttribute('aria-checked', 'false'); b.dataset.id = v.id;
      b.innerHTML = `<img src="assets/icons/${v.id}.svg" alt="" width="44" height="44">
        <span class="name">${v.name}</span><span class="tagline">${v.tagline}</span>`;
      b.addEventListener('click', () => selectValue(v.id));
      els.legend.appendChild(b);
    }
  }
  function selectValue(id) {
    state.valueId = id;
    for (const b of els.legend.children) b.setAttribute('aria-checked', String(b.dataset.id === id));
    updateExportState();
    requestDraw();
    document.dispatchEvent(new CustomEvent('oyw:value', { detail: VALUES.find((v) => v.id === id) || null }));
  }
  function updateExportState() {
    const ready = !!(state.src && state.valueId);
    els.save.disabled = !ready; els.story.disabled = !ready;
    els.saveHint.textContent = ready
      ? (isTouch ? 'Saves a 1080 × 1080 PNG. On a phone, use the share sheet to save to Photos.' : 'Downloads a 1080 × 1080 PNG, ready for LinkedIn, Instagram or WhatsApp.')
      : (!state.src ? 'Add a photo and pick a value to unlock.' : 'Pick your value to unlock.');
  }

  // ---------------------------------------------------------------- photo intake
  els.file.addEventListener('change', () => { if (els.file.files[0]) loadPhoto(els.file.files[0]); els.file.value = ''; });
  document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); document.body.classList.remove('dragging');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadPhoto(f);
  });
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
    if (item) loadPhoto(item.getAsFile());
  });

  async function loadPhoto(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(heic|heif|jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name || '')) {
      toast('Please choose a photo (JPG, PNG or HEIC).'); return;
    }
    setBusy('Loading photo…');
    let img;
    const url = URL.createObjectURL(file);
    try {
      // note: no img.decode() here - it can stall in hidden/background tabs; drawImage decodes synchronously anyway
      img = await loadImage(url);
    } catch (err) {
      setBusy(null); URL.revokeObjectURL(url);
      toast('That image could not be opened. Try a JPG or PNG.'); return;
    }
    // downscale to a memory-safe working copy (EXIF orientation is applied by the browser)
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) { setBusy(null); URL.revokeObjectURL(url); toast('That image could not be read.'); return; }
    const k = Math.min(1, MAX_SRC_SIDE / Math.max(iw, ih));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);

    state.src = c; state.w = c.width; state.h = c.height;
    state.faces = []; state.faceIdx = -1;
    els.canvas.classList.remove('empty');
    els.fileLabel.textContent = 'Choose another photo';
    els.faces.hidden = true;
    fitCenter(); requestDraw();

    setBusy('Finding your face…');
    try {
      const faces = await detectFaces(c);
      state.faces = faces;
      if (faces.length) {
        state.faceIdx = 0; fitToFace(faces[0]);
        if (faces.length > 1) showFaceChooser(faces);
      } else {
        toast('We could not spot a face, so the photo is centred. Drag and zoom to adjust.');
      }
    } catch (err) {
      console.warn('Face detection unavailable:', err);
      toast('Automatic face framing is unavailable on this device. Drag and zoom to adjust.');
    }
    setBusy(null);
    els.hint.hidden = false;
    updateExportState();
    requestDraw();
    if (!state.valueId) {
      $('step-value').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function showFaceChooser(faces) {
    els.faceList.innerHTML = '';
    faces.forEach((f, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.role = 'radio'; b.setAttribute('aria-checked', String(i === state.faceIdx));
      b.setAttribute('aria-label', 'Face ' + (i + 1));
      const t = document.createElement('canvas'); t.width = 128; t.height = 128;
      const g = t.getContext('2d');
      const m = f.h * 0.6;
      const sx = f.cx - f.w / 2 - m, sy = f.cy - f.h / 2 - m, ss = Math.max(f.w, f.h) + 2 * m;
      g.fillStyle = '#0a2f24'; g.fillRect(0, 0, 128, 128);
      g.drawImage(state.src, sx, sy, ss, ss, 0, 0, 128, 128);
      b.appendChild(t);
      b.addEventListener('click', () => {
        state.faceIdx = i;
        for (const x of els.faceList.children) x.setAttribute('aria-checked', 'false');
        b.setAttribute('aria-checked', 'true');
        fitToFace(f); requestDraw();
      });
      els.faceList.appendChild(b);
    });
    els.faces.hidden = false;
  }

  // ---------------------------------------------------------------- face detection
  let detectorPromise = null;
  function getDetector() {
    if (!detectorPromise) {
      detectorPromise = (async () => {
        if (!window.tf) await loadScript('vendor/tf.es2017.min.js');
        if (!window.blazeface) await loadScript('vendor/blazeface.min.umd.js');
        try { await tf.setBackend('webgl'); await tf.ready(); }
        catch (_) { await tf.setBackend('cpu'); await tf.ready(); }
        return blazeface.load({ modelUrl: 'models/blazeface/model.json', maxFaces: 8, scoreThreshold: 0.7, iouThreshold: 0.3 });
      })().catch((e) => { detectorPromise = null; throw e; });
    }
    return detectorPromise;
  }
  // warm up the detector while the visitor reads the page
  const warm = () => getDetector().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 4000 }); else setTimeout(warm, 1500);

  function makeDetectInput(src, sx, sy, sw, sh) {
    const k = Math.min(1, DETECT_SIDE / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return { canvas: c, k, sx, sy };
  }
  async function runDetector(model, input) {
    const preds = await model.estimateFaces(input.canvas, false, false, true);
    const out = [];
    for (const p of preds) {
      const [x0, y0] = p.topLeft, [x1, y1] = p.bottomRight;
      const w = (x1 - x0) / input.k, h = (y1 - y0) / input.k;
      if (w < 8 || h < 8) continue;
      const cx = input.sx + (x0 + x1) / 2 / input.k, cy = input.sy + (y0 + y1) / 2 / input.k;
      let eyeAngle = null;
      if (p.landmarks && p.landmarks.length >= 2) {
        const [re, le] = p.landmarks;            // subject's right eye appears on the image left
        eyeAngle = Math.atan2(le[1] - re[1], le[0] - re[0]);
      }
      const score = Array.isArray(p.probability) ? p.probability[0] : (p.probability && p.probability.dataSync ? p.probability.dataSync()[0] : 1);
      out.push({ cx, cy, w, h, eyeAngle, score });
    }
    return out;
  }
  function iou(a, b) {
    const ax0 = a.cx - a.w / 2, ay0 = a.cy - a.h / 2, ax1 = a.cx + a.w / 2, ay1 = a.cy + a.h / 2;
    const bx0 = b.cx - b.w / 2, by0 = b.cy - b.h / 2, bx1 = b.cx + b.w / 2, by1 = b.cy + b.h / 2;
    const iw = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0)), ih = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
    const inter = iw * ih; return inter / (a.w * a.h + b.w * b.h - inter);
  }
  function dedupe(faces) {
    faces.sort((a, b) => b.score - a.score);
    const keep = [];
    for (const f of faces) if (!keep.some((k) => iou(k, f) > 0.35)) keep.push(f);
    return keep.sort((a, b) => b.w * b.h - a.w * a.h);
  }
  async function detectFaces(src) {
    const model = await getDetector();
    const W = src.width, H = src.height;
    let faces = await runDetector(model, makeDetectInput(src, 0, 0, W, H));
    if (!faces.length) {
      // second pass: 2×2 overlapping tiles catch smaller faces in wide or group shots
      const tw = W * 0.62, th = H * 0.62;
      const tiles = [[0, 0], [W - tw, 0], [0, H - th], [W - tw, H - th]];
      const results = await Promise.all(tiles.map(([x, y]) => runDetector(model, makeDetectInput(src, x, y, tw, th))));
      faces = results.flat();
    }
    return dedupe(faces).filter((f) => f.score >= 0.7);
  }

  // ---------------------------------------------------------------- export
  function canvasToBlob(c) { return new Promise((res) => c.toBlob(res, 'image/png')); }
  function fileName(kind) {
    const v = VALUES.find((x) => x.id === state.valueId);
    return `OYW26-${v ? v.name : 'value'}-${kind}.png`;
  }
  async function shareOrDownload(blob, name) {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      const v = VALUES.find((x) => x.id === state.valueId);
      try { await navigator.share({ files: [file], title: COPY.shareTitle, text: COPY.shareText(v ? v.name : 'about people') }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  }
  async function renderSquare() {
    const c = document.createElement('canvas'); c.width = FRAME; c.height = FRAME;
    drawScene(c.getContext('2d', { alpha: false }), FRAME);
    return c;
  }
  async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all(['400', '500', '600', '700'].map((w) => document.fonts.load(`${w} 40px Poppins`).catch(() => {})));
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  async function renderStory() {
    await ensureFonts();
    const W = 1080, H = 1920;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { alpha: false });
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#04261d'); bg.addColorStop(0.55, '#0a2f24'); bg.addColorStop(1, '#03150f');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, 700, 60, W / 2, 700, 980);
    glow.addColorStop(0, 'rgba(61,205,88,0.55)'); glow.addColorStop(1, 'rgba(61,205,88,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    if (assets.pattern) {
      // brand stripes hugging the bottom edge, kept clear of the event copy
      g.save(); g.globalAlpha = 0.22;
      const pw = W * 1.25, ph = pw * (assets.pattern.naturalHeight / assets.pattern.naturalWidth);
      g.drawImage(assets.pattern, (W - pw) / 2, H - ph * 0.42, pw, ph);
      g.restore();
    }
    // partners line
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(231,255,217,0.85)'; g.font = '500 30px Poppins, system-ui, sans-serif';
    g.fillText(COPY.partners, W / 2, 150);
    // composite
    const square = await renderSquare();
    const size = 940, x = (W - size) / 2, y = 220;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 60; g.shadowOffsetY = 24;
    roundRect(g, x, y, size, size, 40); g.fillStyle = '#0a2f24'; g.fill(); g.restore();
    g.save(); roundRect(g, x, y, size, size, 40); g.clip(); g.drawImage(square, x, y, size, size); g.restore();
    // value
    const v = VALUES.find((o) => o.id === state.valueId);
    g.fillStyle = 'rgba(231,255,217,0.8)'; g.font = '500 34px Poppins, system-ui, sans-serif';
    g.fillText('The value I stand for', W / 2, 1262);
    const icon = v && assets.legendIcons[v.id];
    g.font = '700 84px Poppins, system-ui, sans-serif';
    const label = (v ? v.name : '').toUpperCase();
    const tw = g.measureText(label).width;
    const iconSize = icon ? 78 : 0, gap = icon ? 26 : 0;
    const total = tw + iconSize + gap, startX = (W - total) / 2;
    if (icon) g.drawImage(icon, startX, 1348 - iconSize / 2, iconSize, iconSize);
    g.textAlign = 'left'; g.fillStyle = '#ffffff';
    g.fillText(label, startX + iconSize + gap, 1350);
    g.textAlign = 'center';
    // event
    g.fillStyle = '#ffffff'; g.font = '700 58px Poppins, system-ui, sans-serif';
    g.fillText(COPY.eventTitle, W / 2, 1530);
    g.fillStyle = 'rgba(231,255,217,0.9)'; g.font = '500 36px Poppins, system-ui, sans-serif';
    g.fillText(COPY.eventSub, W / 2, 1592);
    g.fillStyle = 'rgba(231,255,217,0.7)'; g.font = '500 30px Poppins, system-ui, sans-serif';
    g.fillText(COPY.eventWhere, W / 2, 1690);
    g.fillStyle = '#5eff59'; g.font = '600 32px Poppins, system-ui, sans-serif';
    g.fillText(COPY.hashtags, W / 2, 1770);
    return c;
  }
  async function doExport(kind) {
    if (!state.src || !state.valueId) return;
    const btn = kind === 'story' ? els.story : els.save;
    btn.disabled = true;
    try {
      const c = kind === 'story' ? await renderStory() : await renderSquare();
      const blob = await canvasToBlob(c);
      if (!blob) throw new Error('export failed');
      const r = await shareOrDownload(blob, fileName(kind === 'story' ? 'story' : 'profile'));
      if (r === 'downloaded') toast(kind === 'story' ? 'Story image saved.' : 'Profile picture saved.');
    } catch (err) {
      console.error(err);
      toast('Something went wrong while saving. Please try again.');
    } finally { btn.disabled = false; }
  }
  els.save.addEventListener('click', () => doExport('square'));
  els.story.addEventListener('click', () => doExport('story'));

  // shared with the other toolkit tabs (captions, LinkedIn banner preview)
  window.OYW = Object.assign(window.OYW || {}, {
    getValue: () => VALUES.find((v) => v.id === state.valueId) || null,
    getFrameDataURL: () => { if (!state.src) return null; draw(); return els.canvas.toDataURL('image/jpeg', 0.9); },
  });

  // ---------------------------------------------------------------- boot
  async function boot() {
    buildLegend();
    els.canvas.classList.add('empty');
    if (isTouch) els.saveLabel.textContent = 'Save / share';
    updateExportState();
    // background video: skip on data-saver connections
    const conn = navigator.connection;
    if (conn && conn.saveData) { els.bgVideo.removeAttribute('autoplay'); els.bgVideo.pause(); els.bgVideo.innerHTML = ''; }
    els.bgVideo.addEventListener('error', () => { els.bgVideo.style.display = 'none'; });

    ensureFonts().then(requestDraw);
    requestDraw();
    // frame background: WebP with PNG fallback
    try { assets.frameBg = await loadImage('assets/frames/frame-bg-lossless.webp'); }
    catch (_) { assets.frameBg = await loadImage('assets/frames/frame-bg.png'); }
    requestDraw();
    // icons
    await Promise.all(VALUES.map(async (v) => {
      try { assets.frameIcons[v.id] = await loadImage(`assets/icons/${v.id}-frame.svg`); } catch (e) { console.warn(e); }
      try { assets.legendIcons[v.id] = await loadImage(`assets/icons/${v.id}.svg`); } catch (e) { console.warn(e); }
    }));
    try { assets.pattern = await loadImage('assets/pattern-1.svg'); } catch (_) {}
    requestDraw();
    // dev/test hook: ?photo=<same-origin path> loads a photo without the file picker; ?debug exposes internals
    const q = new URLSearchParams(location.search);
    if (q.has('debug')) window.__oyw = { state, assets, draw, renderSquare, renderStory, detectFaces, fitToFace, fitCenter, selectValue, loadPhoto };
    const testPhoto = q.get('photo');
    if (testPhoto && !/^(https?:)?\/\//i.test(testPhoto)) {
      try {
        const r = await fetch(testPhoto); const b = await r.blob();
        await loadPhoto(new File([b], testPhoto.split('/').pop(), { type: b.type || 'image/jpeg' }));
      } catch (e) { console.warn('test photo failed', e); }
    }
  }
  boot();
})();
