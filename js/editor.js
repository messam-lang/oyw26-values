/*!
 * OYWEditor: two in-browser card editors for the OYW26 toolkit.
 *   OYWEditor.photo(container, options)  Live card: user photo under a base PNG with a transparent oval.
 *   OYWEditor.text(container, options)   Reflection card: one paragraph set in a fixed box.
 * Plain ES2017, no modules, no dependencies. Every coordinate is in pixels on the card (1080x1350).
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var uid = 0;

  // ------------------------------------------------------------------ helpers

  function el(tag, cls, attrs) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') n.textContent = v;
        else n.setAttribute(k, v === true ? '' : String(v));
      });
    }
    return n;
  }

  function svgEl(tag, attrs) {
    var n = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
    return n;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  function makeCanvas(w, h) {
    var c = doc.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      if (!/^(data|blob):/i.test(String(url))) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not load image: ' + url)); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('Export failed'));
      }, type || 'image/png', quality);
    });
  }

  function emitter() {
    var fns = [];
    return {
      on: function (cb) {
        if (typeof cb !== 'function') return function () {};
        fns.push(cb);
        return function () { var i = fns.indexOf(cb); if (i >= 0) fns.splice(i, 1); };
      },
      emit: function (arg) {
        fns.slice().forEach(function (fn) {
          try { fn(arg); } catch (e) { setTimeout(function () { throw e; }, 0); }
        });
      },
      clear: function () { fns.length = 0; }
    };
  }

  function quietly(p) { p.catch(function () {}); return p; }

  function isCoarse() {
    try {
      if (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) { /* ignore */ }
    return !!(global.navigator && global.navigator.maxTouchPoints > 0);
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ------------------------------------------------------------------ style

  var CSS = [
    '.oywe,.oywe-btn{--_a:var(--oywe-accent,#3dcd58);--_i:var(--oywe-ink,#e7ffd9);--_m:var(--oywe-muted,rgba(231,255,217,.7));',
    '--_l:var(--oywe-line,rgba(231,255,217,.2));--_b:var(--oywe-bg,#0a2f24);--_w:var(--oywe-warn,#ffc24b);--_e:var(--oywe-error,#ff8a7a);',
    '}',
    '.oywe{display:flex;flex-direction:column;gap:12px;min-width:0;max-width:100%;color:var(--_i);font-family:inherit;line-height:1.4;box-sizing:border-box}',
    '.oywe *,.oywe *::before,.oywe *::after{box-sizing:border-box}',
    '.oywe-stage{position:relative;width:100%;aspect-ratio:4/5;overflow:hidden;border-radius:8px;background:var(--_b);border:1px solid var(--_l)}',
    '.oywe-canvas{display:block;width:100%;height:auto;aspect-ratio:4/5;outline:none}',
    '.oywe-canvas:focus-visible{box-shadow:inset 0 0 0 3px var(--_a)}',
    '.oywe-photo .oywe-canvas{touch-action:manipulation;cursor:pointer}',
    '.oywe-photo.has-photo .oywe-canvas{touch-action:none;cursor:grab}',
    '.oywe-photo.is-dragging .oywe-canvas{cursor:grabbing}',
    '.oywe-overlay{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .25s ease}',
    '.oywe-overlay.is-on{opacity:1}',
    '.oywe-cta{position:absolute;transform:translate(-50%,-50%);white-space:nowrap}',
    '.oywe-photo.has-photo .oywe-cta,.oywe-photo.is-loading .oywe-cta{display:none}',
    '.oywe-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}',
    '.oywe-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border-radius:999px;',
    'border:1px solid var(--_l);background:transparent;color:var(--_i);font:inherit;font-size:15px;font-weight:600;cursor:pointer;',
    '-webkit-tap-highlight-color:transparent;touch-action:manipulation}',
    '.oywe-btn:hover{border-color:var(--_m)}',
    '.oywe-btn:focus-visible{outline:2px solid var(--_a);outline-offset:2px}',
    '.oywe-btn:disabled{opacity:.45;cursor:default}',
    '.oywe-btn--primary{background:var(--_a);border-color:var(--_a);color:var(--_b)}',
    '.oywe-btn--primary:hover{border-color:var(--_i)}',
    '.oywe-zoom{display:flex;align-items:center;gap:8px;flex:1 1 150px;min-width:0;font-size:14px;color:var(--_m)}',
    '.oywe-zoom input{flex:1 1 auto;min-width:0;width:100%;height:44px;margin:0;accent-color:var(--_a);background:transparent}',
    '.oywe-zoom input:disabled{opacity:.45}',
    '.oywe-zoomval{min-width:3.2em;text-align:right;font-variant-numeric:tabular-nums}',
    '.oywe-hint,.oywe-msg,.oywe-counter{margin:0;font-size:14px;color:var(--_m)}',
    '.oywe-hint{border-top:1px solid var(--_l);padding-top:10px}',
    '.oywe-msg:empty{display:none}',
    '.oywe-msg.is-warn{color:var(--_w)}',
    '.oywe-msg.is-error{color:var(--_e)}',
    '.oywe-file{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);border:0;white-space:nowrap}',
    '.oywe-prompt{display:block;width:100%;font-size:15px;font-weight:600;color:var(--_i)}',
    '.oywe-input{display:block;width:100%;min-height:96px;padding:10px 12px;border-radius:8px;border:1px solid var(--_l);background:var(--_b);',
    'color:var(--_i);font:inherit;font-size:16px;line-height:1.45;resize:none;overflow-y:hidden}',
    '.oywe-input::placeholder{color:var(--_m);opacity:.8}',
    '.oywe-input:focus{outline:2px solid var(--_a);outline-offset:1px;border-color:transparent}',
    '.oywe-input:disabled{opacity:.6}',
    '.oywe-meta{display:flex;flex-direction:column;gap:4px}',
    '.oywe-counter{font-variant-numeric:tabular-nums}',
    '.oywe-counter.is-warn{color:var(--_w)}',
    '.oywe-counter.is-limit{color:var(--_e)}',
    '.oywe-flash{animation:oywe-flash .5s ease}',
    '@keyframes oywe-flash{0%,100%{transform:none}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}',
    '@media (prefers-reduced-motion:reduce){.oywe-flash{animation:oywe-flash-c .6s ease}.oywe-overlay{transition:none}}',
    '@keyframes oywe-flash-c{0%,100%{opacity:1}50%{opacity:.35}}'
  ].join('');

  function injectStyle() {
    if (doc.getElementById('oywe-style')) return;
    var s = el('style', null, { id: 'oywe-style' });
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  // ================================================================== PHOTO

  var PHOTO_LABELS = {
    add: 'Add your photo',
    change: 'Change photo',
    selfie: 'Take a selfie',
    zoom: 'Zoom',
    reset: 'Reset',
    hint: 'Drag to move. Pinch, Ctrl/\u2318 + scroll or the slider to zoom.',
    preview: 'Card preview',
    loading: 'Loading photo\u2026',
    small: 'This photo is {w}\u00D7{h} px. It will work, but one at least {min} px on the short side stays sharper.',
    error: 'Could not read that file. Try a JPG or PNG photo.',
    notImage: 'That file is not an image. Choose a JPG or PNG photo.',
    baseError: 'The card could not load. Reload the page and try again.'
  };

  function decodeFile(file) {
    function viaImage() {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          URL.revokeObjectURL(url);
          resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, bitmap: false });
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
      });
    }
    if (typeof global.createImageBitmap === 'function') {
      return global.createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(function (bmp) { return { src: bmp, w: bmp.width, h: bmp.height, bitmap: true }; })
        .catch(viaImage);
    }
    return viaImage();
  }

  // Halving steps, then one final step: keeps big phone photos sharp and the drag light.
  function downscale(src, w, h, tw, th) {
    var cur = src, cw = w, ch = h, tmp = [];
    while (cw / 2 >= tw && ch / 2 >= th) {
      var nw = Math.round(cw / 2), nh = Math.round(ch / 2);
      var c = makeCanvas(nw, nh), x = c.getContext('2d');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, nw, nh);
      if (cur !== src) tmp.push(cur);
      cur = c; cw = nw; ch = nh;
    }
    if (cw !== tw || ch !== th) {
      var f = makeCanvas(tw, th), fx = f.getContext('2d');
      fx.imageSmoothingEnabled = true; fx.imageSmoothingQuality = 'high';
      fx.drawImage(cur, 0, 0, tw, th);
      if (cur !== src) tmp.push(cur);
      cur = f;
    }
    tmp.forEach(function (c) { c.width = 0; c.height = 0; });
    return cur;
  }

  function photo(container, options) {
    if (!container || !container.appendChild) throw new Error('OYWEditor.photo: container element required');
    var o = options || {};
    var W = Math.round(num(o.width, 1080)), H = Math.round(num(o.height, 1350));
    var sl = o.slot || {};
    var slot = { x: num(sl.x, 139), y: num(sl.y, 358), w: num(sl.w, 805), h: num(sl.h, 842) };
    var BLEED = 2; // the photo covers the slot box plus 2 px, so antialiased edge pixels of the oval never show the fill
    var bx = Math.max(0, Math.floor(slot.x) - BLEED), by = Math.max(0, Math.floor(slot.y) - BLEED);
    var bw = Math.min(W, Math.ceil(slot.x + slot.w) + BLEED) - bx, bh = Math.min(H, Math.ceil(slot.y + slot.h) + BLEED) - by;
    var bcx = bx + bw / 2, bcy = by + bh / 2;
    var emptyFill = o.empty || '#04362A';
    var minUpload = num(o.minUpload, 1080);
    var zr = Array.isArray(o.zoom) ? o.zoom : [1, 3];
    var zMin = Math.max(1, num(zr[0], 1)), zMax = Math.max(zMin, num(zr[1], 3));
    var L = Object.assign({}, PHOTO_LABELS, o.labels || {});
    var faceTip = o.faceTip || 'Keep your face in the upper middle of the oval, clear of the name tab bottom-left and the badge bottom-right.';
    var fg = o.faceGuide || {
      cx: slot.x + slot.w * 0.53, cy: slot.y + slot.h * 0.35, rx: slot.w * 0.19, ry: slot.h * 0.245
    };

    injectStyle();
    var id = 'oywe-' + (++uid);
    var events = emitter();
    var destroyed = false;
    var base = null;
    var src = null, srcBitmap = null, sw = 0, sh = 0, cover = 1;
    var z = 1, ox = 0, oy = 0;
    var loadToken = 0;

    // ---- DOM
    var root = el('div', 'oywe oywe-photo');
    var stage = el('div', 'oywe-stage');
    var canvas = el('canvas', 'oywe-canvas', { role: 'img', 'aria-label': L.preview, tabindex: 0 });
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    var guide = svgEl('svg', { 'class': 'oywe-overlay', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    guide.appendChild(svgEl('ellipse', {
      cx: fg.cx, cy: fg.cy, rx: fg.rx, ry: fg.ry, fill: 'none',
      stroke: 'rgba(255,255,255,.85)', 'stroke-width': 1.5, 'stroke-dasharray': '6 6', 'vector-effect': 'non-scaling-stroke'
    }));
    var cta = el('button', 'oywe-btn oywe-btn--primary oywe-cta', { type: 'button', tabindex: -1, 'aria-hidden': 'true', text: L.add });
    cta.style.left = ((slot.x + slot.w / 2) / W * 100) + '%';
    cta.style.top = ((slot.y + slot.h * 0.42) / H * 100) + '%';
    stage.appendChild(canvas); stage.appendChild(guide); stage.appendChild(cta);

    var fileIn = el('input', 'oywe-file', { type: 'file', accept: 'image/*', tabindex: -1, 'aria-label': L.add, id: id + '-file' });
    var selfieIn = el('input', 'oywe-file', { type: 'file', accept: 'image/*', capture: 'user', tabindex: -1, 'aria-label': L.selfie, id: id + '-selfie' });

    var controls = el('div', 'oywe-controls');
    var btnAdd = el('button', 'oywe-btn oywe-btn--primary', { type: 'button', text: L.add });
    var btnSelfie = el('button', 'oywe-btn', { type: 'button', text: L.selfie });
    var zoomWrap = el('div', 'oywe-zoom');
    var zoomLabel = el('label', null, { 'for': id + '-zoom', text: L.zoom });
    var slider = el('input', null, {
      type: 'range', id: id + '-zoom', min: Math.round(zMin * 100), max: Math.round(zMax * 100), step: 1,
      value: Math.round(zMin * 100), 'aria-label': L.zoom, disabled: true
    });
    var zoomVal = el('span', 'oywe-zoomval', { 'aria-hidden': 'true', text: Math.round(zMin * 100) + '%' });
    zoomWrap.appendChild(zoomLabel); zoomWrap.appendChild(slider); zoomWrap.appendChild(zoomVal);
    var btnReset = el('button', 'oywe-btn', { type: 'button', text: L.reset, disabled: true });
    controls.appendChild(btnAdd);
    if (isCoarse()) controls.appendChild(btnSelfie);
    controls.appendChild(zoomWrap);
    controls.appendChild(btnReset);

    var hint = el('p', 'oywe-hint', { text: faceTip });
    var msg = el('p', 'oywe-msg', { 'aria-live': 'polite' });

    root.appendChild(stage); root.appendChild(controls); root.appendChild(hint); root.appendChild(msg);
    root.appendChild(fileIn); root.appendChild(selfieIn);
    container.appendChild(root);

    function setMsg(text, tone) {
      msg.textContent = text || '';
      msg.className = 'oywe-msg' + (tone ? ' is-' + tone : '');
    }

    // ---- geometry
    function scale() { return cover * z; }
    function clampOffsets() {
      if (!src) { ox = oy = 0; return; }
      var s = scale();
      var mx = Math.max(0, (sw * s - bw) / 2), my = Math.max(0, (sh * s - bh) / 2);
      ox = clamp(ox, -mx, mx); oy = clamp(oy, -my, my);
    }
    function photoRect() {
      var s = scale(), dw = sw * s, dh = sh * s;
      return { x: bcx + ox - dw / 2, y: bcy + oy - dh / 2, w: dw, h: dh };
    }
    function zoomAt(nz, ax, ay) {
      nz = clamp(nz, zMin, zMax);
      var s0 = scale(), s1 = cover * nz;
      var cx = bcx + ox, cy = bcy + oy;
      ox = ax - (ax - cx) * s1 / s0 - bcx;
      oy = ay - (ay - cy) * s1 / s0 - bcy;
      z = nz;
      clampOffsets();
    }

    // ---- paint
    function paint(c) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, W, H);
      c.fillStyle = emptyFill;
      c.fillRect(0, 0, W, H); // covers the slot box (and any stray transparent pixel of the base)
      if (src) {
        var r = photoRect();
        c.save();
        c.beginPath(); c.rect(bx, by, bw, bh); c.clip();
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.drawImage(src, r.x, r.y, r.w, r.h);
        c.restore();
      }
      if (base) c.drawImage(base, 0, 0, W, H);
      c.restore();
    }

    var raf = 0, pendingEmit = false;
    function render() { if (!destroyed) paint(ctx); }
    function commit() { render(); syncUI(); events.emit(api); }
    function schedule() {
      pendingEmit = true;
      if (raf) return;
      raf = global.requestAnimationFrame(function () {
        raf = 0;
        if (destroyed) return;
        render(); syncUI();
        if (pendingEmit) { pendingEmit = false; events.emit(api); }
      });
    }

    function syncUI() {
      var has = !!src;
      root.classList.toggle('has-photo', has);
      btnAdd.textContent = has ? L.change : L.add;
      slider.disabled = !has; btnReset.disabled = !has;
      var pct = Math.round(z * 100);
      if (String(slider.value) !== String(pct)) slider.value = pct;
      slider.setAttribute('aria-valuetext', pct + '%');
      zoomVal.textContent = pct + '%';
    }

    var guideTimer = 0;
    function showGuide(on, linger) {
      clearTimeout(guideTimer);
      if (on) guide.classList.add('is-on');
      else if (linger) guideTimer = setTimeout(function () { guide.classList.remove('is-on'); }, linger);
      else guide.classList.remove('is-on');
    }

    // ---- photo loading
    function releaseSrc() {
      if (srcBitmap && srcBitmap.close) { try { srcBitmap.close(); } catch (e) { /* ignore */ } }
      if (src && src.tagName === 'CANVAS') { src.width = 0; src.height = 0; }
      src = null; srcBitmap = null; sw = sh = 0;
    }

    function setFile(file) {
      if (!file || destroyed) return Promise.resolve(false);
      if (file.type && !/^image\//i.test(file.type)) { setMsg(L.notImage, 'error'); return Promise.resolve(false); }
      var token = ++loadToken;
      root.classList.add('is-loading');
      setMsg(L.loading);
      return decodeFile(file).then(function (d) {
        if (token !== loadToken || destroyed) { if (d.bitmap && d.src.close) d.src.close(); return false; }
        root.classList.remove('is-loading');
        if (!d.w || !d.h) throw new Error('empty');
        releaseSrc();
        var c0 = Math.max(bw / d.w, bh / d.h);
        var need = c0 * zMax; // largest scale the export can ask for
        if (need < 0.6) {
          var tw = Math.max(bw, Math.ceil(d.w * need)), th = Math.max(bh, Math.ceil(d.h * need));
          src = downscale(d.src, d.w, d.h, tw, th);
          sw = src.width; sh = src.height;
          if (d.bitmap && d.src.close) d.src.close();
        } else {
          src = d.src; sw = d.w; sh = d.h;
          if (d.bitmap) srcBitmap = d.src;
        }
        cover = Math.max(bw / sw, bh / sh);
        z = zMin; ox = oy = 0; clampOffsets();
        var shortSide = Math.min(d.w, d.h);
        if (shortSide < minUpload) {
          setMsg(L.small.replace('{w}', d.w).replace('{h}', d.h).replace('{min}', minUpload), 'warn');
        } else {
          setMsg(L.hint);
        }
        commit();
        showGuide(true); showGuide(false, 1600);
        return true;
      }).catch(function () {
        if (token !== loadToken || destroyed) return false;
        root.classList.remove('is-loading');
        setMsg(L.error, 'error');
        return false;
      });
    }

    function onFileChange(e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) setFile(f);
    }
    fileIn.addEventListener('change', onFileChange);
    selfieIn.addEventListener('change', onFileChange);
    function openPicker() { fileIn.click(); }
    btnAdd.addEventListener('click', openPicker);
    cta.addEventListener('click', openPicker);
    btnSelfie.addEventListener('click', function () { selfieIn.click(); });
    canvas.addEventListener('click', function () { if (!src && !root.classList.contains('is-loading')) openPicker(); });

    stage.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault();
    });
    stage.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); setFile(f); }
    });

    // ---- zoom / reset controls
    slider.addEventListener('input', function () {
      if (!src) return;
      zoomAt(Number(slider.value) / 100, bcx, bcy);
      showGuide(true); showGuide(false, 900);
      commit();
    });
    btnReset.addEventListener('click', function () {
      if (!src) return;
      z = zMin; ox = oy = 0;
      commit();
    });

    // ---- pointer gestures: one finger / mouse pans, two fingers pinch-zoom
    var pointers = {}, pcount = 0, gest = null, rect = null, moved = false;
    function toCanvas(cx, cy) {
      var r = rect || canvas.getBoundingClientRect();
      return { x: (cx - r.left) * W / r.width, y: (cy - r.top) * H / r.height };
    }
    function pts() { return Object.keys(pointers).map(function (k) { return pointers[k]; }); }
    function startGesture() {
      rect = canvas.getBoundingClientRect();
      var p = pts();
      if (p.length === 0) { gest = null; return; }
      var s0 = scale();
      if (p.length === 1) {
        gest = { type: 'pan', p0: toCanvas(p[0].x, p[0].y), ox0: ox, oy0: oy };
      } else {
        var a = toCanvas(p[0].x, p[0].y), b = toCanvas(p[1].x, p[1].y);
        var m0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gest = {
          type: 'pinch', d0: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), z0: z,
          u: { x: (m0.x - (bcx + ox)) / s0, y: (m0.y - (bcy + oy)) / s0 }
        };
      }
    }
    function moveGesture() {
      if (!gest || !src) return;
      moved = true;
      var p = pts();
      if (gest.type === 'pan' && p.length >= 1) {
        var q = toCanvas(p[0].x, p[0].y);
        ox = gest.ox0 + (q.x - gest.p0.x); oy = gest.oy0 + (q.y - gest.p0.y);
        clampOffsets();
      } else if (gest.type === 'pinch' && p.length >= 2) {
        var a = toCanvas(p[0].x, p[0].y), b = toCanvas(p[1].x, p[1].y);
        var m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        z = clamp(gest.z0 * Math.hypot(b.x - a.x, b.y - a.y) / gest.d0, zMin, zMax);
        var s1 = scale();
        ox = m.x - gest.u.x * s1 - bcx; oy = m.y - gest.u.y * s1 - bcy;
        clampOffsets();
      }
      schedule();
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (!src) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (!pointers[e.pointerId]) pcount++;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pcount === 1) moved = false;
      root.classList.add('is-dragging');
      showGuide(true);
      startGesture();
      try { canvas.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      moveGesture();
    });
    function endPointer(e) {
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId]; pcount--;
      if (pcount > 0) { startGesture(); return; }
      gest = null; rect = null;
      root.classList.remove('is-dragging');
      showGuide(false, 700);
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
      pendingEmit = false;
      if (moved) commit(); else syncUI();
      moved = false;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', endPointer);

    // ctrl/cmd + wheel (also what a desktop trackpad pinch sends in Chrome, Edge and Firefox)
    canvas.addEventListener('wheel', function (e) {
      if (!src || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1));
      var p = toCanvas(e.clientX, e.clientY);
      zoomAt(z * Math.exp(-clamp(dy, -25, 25) * 0.01), p.x, p.y);
      showGuide(true); showGuide(false, 900);
      schedule();
    }, { passive: false });

    // Safari desktop trackpad pinch (gesture events); ignored while touch pointers are down (iOS sends both)
    var gz0 = null;
    canvas.addEventListener('gesturestart', function (e) {
      if (!src || pcount > 0) return;
      e.preventDefault(); gz0 = z;
    });
    canvas.addEventListener('gesturechange', function (e) {
      if (gz0 === null || pcount > 0) return;
      e.preventDefault();
      var p = toCanvas(e.clientX, e.clientY);
      zoomAt(gz0 * e.scale, p.x, p.y);
      showGuide(true); showGuide(false, 900);
      schedule();
    });
    canvas.addEventListener('gestureend', function (e) {
      if (gz0 === null) return;
      e.preventDefault(); gz0 = null;
    });

    // keyboard: arrows pan, +/- zoom, 0 resets
    canvas.addEventListener('keydown', function (e) {
      if (!src) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
        return;
      }
      var step = e.shiftKey ? 60 : 12, handled = true;
      switch (e.key) {
        case 'ArrowLeft': ox -= step; break;
        case 'ArrowRight': ox += step; break;
        case 'ArrowUp': oy -= step; break;
        case 'ArrowDown': oy += step; break;
        case '+': case '=': zoomAt(z * 1.1, bcx, bcy); break;
        case '-': case '_': zoomAt(z / 1.1, bcx, bcy); break;
        case '0': z = zMin; ox = oy = 0; break;
        default: handled = false;
      }
      if (!handled) return;
      e.preventDefault();
      clampOffsets();
      showGuide(true); showGuide(false, 900);
      commit();
    });

    // ---- base
    syncUI();
    render();
    var ready = quietly(loadImage(o.base).then(function (img) {
      if (destroyed) return api;
      base = img;
      render();
      return api;
    }, function (err) {
      if (!destroyed) setMsg(L.baseError, 'error');
      throw err;
    }));

    function exportCanvas() {
      var c = makeCanvas(W, H);
      paint(c.getContext('2d'));
      return c;
    }

    var api = {
      ready: ready,
      getCanvas: exportCanvas,
      hasPhoto: function () { return !!src; },
      toBlob: function (type, quality) {
        return ready.then(function () { return canvasToBlob(exportCanvas(), type || 'image/png', quality); });
      },
      onChange: function (cb) { return events.on(cb); },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        loadToken++;
        if (raf) global.cancelAnimationFrame(raf);
        clearTimeout(guideTimer);
        events.clear();
        releaseSrc();
        base = null;
        if (root.parentNode) root.parentNode.removeChild(root);
        canvas.width = 0; canvas.height = 0;
      }
    };
    return api;
  }

  // ================================================================== TEXT

  var TEXT_LABELS = {
    preview: 'Card preview',
    loading: 'Loading the card font\u2026',
    fontError: 'The card font could not load, so the text cannot be measured. Reload the page and try again.',
    baseError: 'The card could not load. Reload the page and try again.',
    counter: '{n} / {max} characters \u00B7 {l} / {maxLines} lines',
    tooManyChars: 'That would pass {max} characters. Shorten the text to add more.',
    tooManyLines: 'That would need a {nth} line. The card fits {maxLines}.',
    wordTooWide: '\u201C{word}\u201D is too wide for one line. Shorten it or split it with a space.',
    removed: 'Removed {chars}: emoji and symbols outside the Latin set are not in the card font.',
    oneParagraph: 'One paragraph only: line breaks are not used.',
    invalidExport: 'The text does not fit the card yet.'
  };

  // Characters the card font (Poppins SemiBold, Latin subset) has glyphs for, checked against the woff2.
  // Anything else is stripped and reported. Override with options.allow(codePoint) for another font.
  function latinAllowed(cp) {
    return (cp >= 0x20 && cp <= 0x7E) ||
      (cp >= 0xA1 && cp <= 0xFF && cp !== 0xAD) ||
      cp === 0x131 || cp === 0x152 || cp === 0x153 ||
      cp === 0x2BC || cp === 0x2C6 || cp === 0x2DA || cp === 0x2DC ||
      (cp >= 0x2013 && cp <= 0x2014) || (cp >= 0x2018 && cp <= 0x201A) || (cp >= 0x201C && cp <= 0x201E) ||
      cp === 0x2022 || cp === 0x2026 || cp === 0x2039 || cp === 0x203A || cp === 0x2044 ||
      cp === 0x20AC || cp === 0x2122;
  }

  var OPENERS = ' ([{\u2018\u201C\u2013\u2014-/';
  // Silently dropped (parts of emoji sequences, invisible format characters).
  function isInvisible(cp) {
    return cp === 0x200B || cp === 0x200C || cp === 0x200D || cp === 0x2060 || cp === 0xFEFF ||
      (cp >= 0xFE00 && cp <= 0xFE0F) || cp === 0x20E3 || (cp >= 0x1F3FB && cp <= 0x1F3FF) ||
      (cp >= 0xE0020 && cp <= 0xE007F) || cp === 0xAD || (cp >= 0x200E && cp <= 0x200F) ||
      (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069);
  }

  // Input rules: one paragraph, no double spaces, curly quotes, Latin only, no leading spaces.
  // Trailing space is kept here (live typing); finalText() trims it.
  function sanitize(str, allowed) {
    var s = String(str == null ? '' : str);
    if (s.normalize) { try { s = s.normalize('NFC'); } catch (e) { /* ignore */ } }
    var hadBreak = /[\r\n\u2028\u2029]/.test(s);
    s = s.replace(/\r\n?|[\n\u2028\u2029\t\v\f\u0085]/g, ' ')
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000\u1680]/g, ' ');
    var out = '', removed = [];
    var chars = Array.from(s);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i], cp = ch.codePointAt(0);
      var prev = out.length ? out.charAt(out.length - 1) : '';
      if (ch === '\'') {
        var next = chars[i + 1] || '';
        if ((prev === '' || prev === ' ') && /[0-9]/.test(next)) ch = '\u2019';         // '26
        else ch = (prev === '' || OPENERS.indexOf(prev) >= 0) ? '\u2018' : '\u2019';
      } else if (ch === '"') {
        ch = (prev === '' || OPENERS.indexOf(prev) >= 0) ? '\u201C' : '\u201D';
      } else if (isInvisible(cp)) {
        continue;
      } else if (!allowed(cp)) {
        if (removed.indexOf(ch) < 0) removed.push(ch);
        continue;
      }
      if (ch === ' ' && (prev === '' || prev === ' ')) continue; // no leading or double spaces
      out += ch;
    }
    return { value: out, removed: removed, hadBreak: hadBreak };
  }

  function finalText(s) { return s.replace(/ +$/, ''); }

  // Measures and draws with the exact size and letter spacing. Uses ctx.letterSpacing where the
  // browser has it, otherwise places each glyph from shaped prefix widths plus the spacing.
  function TypeEngine(font, forceGlyph, rendering) {
    this.rendering = rendering || 'geometricPrecision';
    this.family = font.family;
    this.size = font.size;
    this.weight = font.weight;
    this.ls = font.letterSpacing;
    this.css = font.weight + ' ' + font.size + 'px "' + String(font.family).replace(/"/g, '') + '"';
    var probe = makeCanvas(4, 4).getContext('2d');
    this.native = !forceGlyph && ('letterSpacing' in probe);
    if (this.native) {
      probe.letterSpacing = this.ls + 'px';
      if (parseFloat(probe.letterSpacing) !== this.ls) this.native = false;
    }
    this.mctx = probe;
    this.cache = {};
    this.cacheSize = 0;
    this.setup(probe);
  }
  TypeEngine.prototype.setup = function (c) {
    c.font = this.css;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    if ('direction' in c) c.direction = 'ltr';
    if ('fontKerning' in c) c.fontKerning = 'normal';
    // Outline-accurate glyphs: no hinting and no platform emboldening, so the stems match the design.
    if ('textRendering' in c) c.textRendering = this.rendering;
    if ('letterSpacing' in c) c.letterSpacing = this.native ? this.ls + 'px' : '0px';
  };
  TypeEngine.prototype.raw = function (s) {
    var v = this.cache[s];
    if (v === undefined) {
      if (++this.cacheSize > 4000) { this.cache = {}; this.cacheSize = 1; }
      v = this.mctx.measureText(s).width; this.cache[s] = v;
    }
    return v;
  };
  // Advance width of the string from the first glyph's origin to the last glyph's advance
  // (letter spacing between glyphs, none after the last).
  TypeEngine.prototype.width = function (s) {
    if (!s) return 0;
    var n = Array.from(s).length;
    return this.native ? this.raw(s) - this.ls : this.raw(s) + this.ls * (n - 1);
  };
  TypeEngine.prototype.draw = function (c, s, x, y) {
    if (this.native) { c.fillText(s, x, y); return; }
    var chars = Array.from(s), pre = '';
    for (var i = 0; i < chars.length; i++) {
      pre += chars[i];
      if (chars[i] === ' ') continue;
      var gx = x + this.raw(pre) - this.raw(chars[i]) + this.ls * i;
      c.fillText(chars[i], gx, y);
    }
  };
  TypeEngine.prototype.wrap = function (text, maxW) {
    var words = text.split(' ').filter(Boolean), lines = [], cur = '', wide = null;
    var eps = 0.01;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!wide && this.width(w) > maxW + eps) wide = w;
      var cand = cur ? cur + ' ' + w : w;
      if (!cur || this.width(cand) <= maxW + eps) cur = cand;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return { lines: lines, wide: wide };
  };

  function fontAvailable(css) {
    var c = makeCanvas(4, 4).getContext('2d'), t = 'Hamburgefonstiv 0123456789 QWXZ';
    var res = ['monospace', 'serif'].map(function (fb) {
      c.font = css + ', ' + fb; var a = c.measureText(t).width;
      c.font = css.replace(/"[^"]*"$/, '') + fb; var b = c.measureText(t).width;
      return Math.abs(a - b) > 0.5;
    });
    return res[0] && res[1];
  }

  function text(container, options) {
    if (!container || !container.appendChild) throw new Error('OYWEditor.text: container element required');
    var o = options || {};
    var W = Math.round(num(o.width, 1080)), H = Math.round(num(o.height, 1350));
    var bo = o.box || {};
    var box = { x: num(bo.x, 149.6), y: num(bo.y, 558), w: num(bo.w, 780), h: num(bo.h, 488) };
    var firstBaselineY = num(o.firstBaselineY, 601);
    var lineHeight = num(o.lineHeight, 73.3);
    // Photoshop set the sample text of Reflection_REFERENCE_with-body.png 1.3 px below the spec's
    // rounded first_baseline_y (601); measured by 2-D correlation of the text coverage over all five
    // lines. The editor matches the reference card by default. Pass 0 to sit exactly on firstBaselineY.
    var baselineShift = num(o.baselineShift, 1.3);
    var subpixelY = o.subpixelBaseline !== false;
    var f = o.font || {};
    var font = {
      family: f.family || 'Poppins', weight: f.weight || 600, size: num(f.size, 60),
      letterSpacing: num(f.letterSpacing, -2.4), color: f.color || '#E9FFDB'
    };
    var li = o.limits || {};
    var maxLines = Math.max(1, Math.floor(num(li.maxLines, 6)));
    var maxChars = Math.max(1, Math.floor(num(li.maxChars, 130)));
    var recommended = Math.floor(num(li.recommended, 120));
    var L = Object.assign({}, TEXT_LABELS, o.labels || {});
    var allowed = typeof o.allow === 'function' ? o.allow : latinAllowed;
    var prompt = o.prompt || 'One thing you are taking home from Cape Town, in your own words. Up to 6 lines.';

    injectStyle();
    var id = 'oywe-' + (++uid);
    var events = emitter();
    var destroyed = false;
    var base = null, eng = null, fontOK = false;

    // ---- DOM
    var root = el('div', 'oywe oywe-text');
    var stage = el('div', 'oywe-stage');
    var canvas = el('canvas', 'oywe-canvas', { role: 'img', 'aria-label': L.preview });
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var boxGuide = svgEl('svg', { 'class': 'oywe-overlay', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    boxGuide.appendChild(svgEl('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h, fill: 'none', stroke: 'rgba(255,255,255,.7)',
      'stroke-width': 1.5, 'stroke-dasharray': '6 6', 'vector-effect': 'non-scaling-stroke'
    }));
    stage.appendChild(canvas); stage.appendChild(boxGuide);

    var controls = el('div', 'oywe-controls');
    var promptEl = el('label', 'oywe-prompt', { 'for': id + '-text', text: prompt });
    var ta = el('textarea', 'oywe-input', {
      id: id + '-text', rows: 3, placeholder: o.placeholder || '', spellcheck: 'true', autocapitalize: 'sentences',
      autocomplete: 'off', enterkeyhint: 'done', disabled: true, 'aria-describedby': id + '-counter ' + id + '-msg'
    });
    controls.appendChild(promptEl); controls.appendChild(ta);
    var meta = el('div', 'oywe-meta');
    var counter = el('p', 'oywe-counter', { id: id + '-counter', 'aria-live': 'polite' });
    var msg = el('p', 'oywe-msg', { id: id + '-msg', 'aria-live': 'polite' });
    meta.appendChild(counter); meta.appendChild(msg);
    root.appendChild(stage); root.appendChild(controls); root.appendChild(meta);
    container.appendChild(root);

    function setMsg(t, tone) {
      msg.textContent = t || '';
      msg.className = 'oywe-msg' + (tone ? ' is-' + tone : '');
    }

    // The field grows with the text, so the whole paragraph is always visible while editing.
    var lastFitW = 0;
    function fitField() {
      if (destroyed) return;
      ta.style.height = 'auto';
      ta.style.height = (ta.scrollHeight + 2) + 'px';
      lastFitW = ta.clientWidth;
    }
    var ro = global.ResizeObserver ? new global.ResizeObserver(function () {
      if (ta.clientWidth !== lastFitW) fitField();
    }) : null;
    if (ro) ro.observe(ta);

    // ---- model
    var initial = sanitize(o.value || '', allowed);
    var committed = finalText(initial.value);   // canonical text (trimmed)
    var liveValue = initial.value;              // what the textarea holds (may end in one space)
    var state = null;                           // evaluation of `committed`
    // setText() before the font loads cannot be measured yet; it is validated on load and, if it does
    // not fit, rolled back to the text it replaced (the typing rule).
    var preFontFallback = null;
    ta.value = liveValue;

    function evaluate(t) {
      var chars = Array.from(t).length;
      var r = eng ? eng.wrap(t, box.w) : { lines: t ? [t] : [], wide: null };
      var ev = {
        text: t, chars: chars, lines: r.lines, lineCount: r.lines.length, wide: r.wide,
        empty: chars === 0, tooManyChars: chars > maxChars, tooManyLines: r.lines.length > maxLines
      };
      ev.valid = fontOK && !ev.empty && !ev.tooManyChars && !ev.tooManyLines && !ev.wide;
      return ev;
    }

    function paint(c, ev) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, W, H);
      if (base) c.drawImage(base, 0, 0, W, H);
      // Text is drawn only when the whole paragraph fits (spec: never cut, never overflow). A text that
      // does not fit (reachable only through options.value) shows the bare card plus the error message.
      if (fontOK && eng && ev && ev.valid) {
        eng.setup(c);
        c.fillStyle = font.color;
        for (var i = 0; i < ev.lines.length; i++) drawLine(c, ev.lines[i], firstBaselineY + baselineShift + i * lineHeight);
      }
      c.restore();
    }

    // Browsers snap a text baseline to whole pixels. Lines sit every 73.3 px, so each line is set on a
    // whole-pixel baseline in a small layer and the layer is placed at the exact fractional position.
    var LAYER_PAD = Math.ceil(font.size), LAYER_ASC = Math.ceil(font.size * 1.2);
    var layer = null, lctx = null;
    function drawLine(c, line, yb) {
      var frac = yb - Math.floor(yb);
      if (!subpixelY || frac < 0.02 || frac > 0.98) { eng.draw(c, line, box.x, Math.round(yb)); return; }
      var lx = Math.floor(box.x) - LAYER_PAD;
      if (!layer) {
        layer = makeCanvas(Math.ceil(box.w) + 2 * LAYER_PAD + 2, Math.ceil(font.size * 1.7));
        lctx = layer.getContext('2d');
      }
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      eng.setup(lctx);
      lctx.fillStyle = font.color;
      eng.draw(lctx, line, box.x - lx, LAYER_ASC);
      c.imageSmoothingEnabled = true;
      c.drawImage(layer, lx, yb - LAYER_ASC);
    }

    function render() { if (!destroyed) paint(ctx, state); }

    // Set when the last refused edit needed a line past maxLines while the text already fills maxLines;
    // cleared by the next accepted change. Characters and lines are equal limits ("whichever comes first").
    var lineBlocked = false;
    function updateCounter(preview) {
      var ev = preview || state || evaluate(committed);
      counter.textContent = L.counter.replace('{n}', ev.chars).replace('{max}', maxChars)
        .replace('{l}', ev.lineCount).replace('{maxLines}', maxLines);
      var limit = ev.chars >= maxChars || (!preview && lineBlocked) || (!ev.empty && fontOK && !ev.valid);
      counter.classList.toggle('is-limit', limit);
      counter.classList.toggle('is-warn', !limit && ev.chars > recommended);
    }

    var flashTimer = 0;
    function flash() {
      counter.classList.remove('oywe-flash');
      void counter.offsetWidth;
      counter.classList.add('oywe-flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { counter.classList.remove('oywe-flash'); }, 650);
    }

    function reason(ev) {
      if (ev.tooManyChars) return L.tooManyChars.replace('{max}', maxChars);
      if (ev.tooManyLines) return L.tooManyLines.replace('{nth}', ordinal(maxLines + 1)).replace('{maxLines}', maxLines);
      if (ev.wide) return L.wordTooWide.replace('{word}', ev.wide);
      return '';
    }

    function commitText(t, notify) {
      var changed = t !== committed || !state;
      if (changed) lineBlocked = false;
      committed = t;
      state = evaluate(t);
      render();
      updateCounter();
      if (changed && notify) events.emit(api);
    }

    // ---- input handling
    var selBefore = null;
    var composing = false;
    var compMsg = false;     // the message line currently shows a composition-preview limit
    function remember() {
      selBefore = { s: ta.selectionStart, e: ta.selectionEnd };
    }
    ta.addEventListener('beforeinput', remember);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing && !composing) {
        e.preventDefault();
        setMsg(L.oneParagraph);
        return;
      }
      remember();
    });
    ta.addEventListener('compositionstart', function () { composing = true; });
    ta.addEventListener('compositionend', function () { composing = false; handleInput(); });
    ta.addEventListener('input', function (e) {
      if (composing || e.isComposing) {
        // Do not rewrite the field mid-composition (mobile keyboards compose every word): preview it
        // if it fits, and keep the counter and the limit message live. Any rollback happens at
        // compositionend, through handleInput().
        if (!fontOK || destroyed) return;
        var pv = evaluate(finalText(sanitize(ta.value, allowed).value));
        if (pv.valid || pv.empty) { state = pv; render(); state = evaluate(committed); }
        updateCounter(pv);
        if (!pv.valid && !pv.empty) { compMsg = true; setMsg(reason(pv), 'error'); }
        else if (compMsg) { compMsg = false; setMsg(''); }
        return;
      }
      handleInput();
    });

    function handleInput() {
      if (!fontOK || destroyed) return;
      var raw = ta.value;
      var hadComp = compMsg; compMsg = false;
      if (raw === liveValue) {
        // e.g. a composition that was cancelled: drop its preview from the counter and message.
        updateCounter();
        if (hadComp) setMsg('');
        return;
      }
      var caret = ta.selectionEnd;
      var s = sanitize(raw, allowed);
      var t = finalText(s.value);
      var ev = evaluate(t);
      var prev = state || evaluate(committed);
      var ok = ev.valid || ev.empty || (!prev.valid && !prev.empty && ev.chars < prev.chars);
      if (!ok) {
        ta.value = liveValue;
        if (selBefore) { try { ta.setSelectionRange(selBefore.s, selBefore.e); } catch (err) { /* ignore */ } }
        lineBlocked = ev.tooManyLines && prev.lineCount >= maxLines;
        updateCounter();
        flash();
        setMsg(reason(ev), 'error');
        return;
      }
      if (s.value !== raw) {
        var nc = sanitize(raw.slice(0, caret), allowed).value.length;
        ta.value = s.value;
        try { ta.setSelectionRange(Math.min(nc, s.value.length), Math.min(nc, s.value.length)); } catch (err) { /* ignore */ }
      }
      liveValue = ta.value;
      fitField();
      if (s.removed.length) setMsg(L.removed.replace('{chars}', s.removed.join(' ')), 'warn');
      else if (s.hadBreak) setMsg(L.oneParagraph);
      else if (!ev.valid && !ev.empty) setMsg(reason(ev), 'error');
      else setMsg('');
      commitText(t, true);
    }

    ta.addEventListener('focus', function () { boxGuide.classList.add('is-on'); });
    ta.addEventListener('blur', function () {
      boxGuide.classList.remove('is-on');
      // Tidy a trailing space once the person leaves the field.
      if (ta.value !== committed && finalText(ta.value) === committed) { ta.value = committed; liveValue = committed; }
    });

    // ---- loading
    setMsg(L.loading);
    updateCounter();
    var baseP = loadImage(o.base).then(function (img) {
      if (destroyed) return;
      base = img; render();
    }, function (err) {
      if (!destroyed) setMsg(L.baseError, 'error');
      throw err;
    });
    var fontP = Promise.resolve().then(function () {
      var css = new TypeEngine(font, true).css;
      if (!doc.fonts || !doc.fonts.load) throw new Error('FontFaceSet API missing');
      return doc.fonts.load(css).then(function (faces) {
        if ((!faces || !faces.length) && !fontAvailable(css)) throw new Error('Font not available: ' + css);
        if (destroyed) return;
        eng = new TypeEngine(font, !!o.forceGlyphSpacing, o.textRendering);
        fontOK = true;
        ta.disabled = false;
        fitField();
        if (msg.textContent === L.loading) setMsg('');
        var fallback = preFontFallback; preFontFallback = null;
        var queued = fallback !== null ? evaluate(committed) : null;
        if (queued && !queued.valid && !queued.empty) {
          // A setText() made before the font loaded does not fit: keep the text it replaced.
          ta.value = fallback; liveValue = fallback; fitField();
          commitText(fallback, true);
          lineBlocked = queued.tooManyLines && state.lineCount >= maxLines;
          updateCounter(); flash();
          setMsg(reason(queued), 'error');
          return;
        }
        commitText(committed, false);
        if (initial.removed.length) setMsg(L.removed.replace('{chars}', initial.removed.join(' ')), 'warn');
        else if (!state.valid && !state.empty) setMsg(reason(state), 'error');
      });
    }).catch(function (err) {
      if (!destroyed) { setMsg(L.fontError, 'error'); ta.disabled = true; }
      throw err;
    });
    var ready = quietly(Promise.all([baseP, fontP]).then(function () { return api; }));

    function invalidError() {
      var err = new Error(L.invalidExport);
      err.code = 'invalid';
      return err;
    }
    function exportCanvas() {
      var c = makeCanvas(W, H);
      paint(c.getContext('2d'), state);
      return c;
    }

    var api = {
      ready: ready,
      // The flattened card. Throws an Error with code 'invalid' (as toBlob rejects) while the text is
      // empty, does not fit, or the font has not loaded: there is no finished card to hand out yet.
      getCanvas: function () {
        if (!state || !state.valid) throw invalidError();
        return exportCanvas();
      },
      getText: function () { return committed; },
      isValid: function () { return !!(state && state.valid); },
      // Same rule as typing: text that would not fit (too many characters, a line past maxLines, or a
      // word wider than the box) is refused, the previous text stays, and the counter flashes with the
      // reason. Returns true when the text was taken, false when refused. Before `ready` the text is
      // queued (returns true) and checked as soon as the font loads.
      setText: function (s) {
        if (destroyed) return false;
        var r = sanitize(s == null ? '' : String(s), allowed);
        var t = finalText(r.value);
        if (!fontOK) {
          if (preFontFallback === null) preFontFallback = committed;
          ta.value = t; liveValue = t; fitField();
          committed = t; updateCounter(); events.emit(api);
          return true;
        }
        var ev = evaluate(t);
        if (!ev.valid && !ev.empty) {
          var prev = state || evaluate(committed);
          lineBlocked = ev.tooManyLines && prev.lineCount >= maxLines;
          updateCounter();
          flash();
          setMsg(reason(ev), 'error');
          return false;
        }
        ta.value = t; liveValue = t;
        fitField();
        commitText(t, true);
        if (r.removed.length) setMsg(L.removed.replace('{chars}', r.removed.join(' ')), 'warn');
        else setMsg('');
        return true;
      },
      toBlob: function (type, quality) {
        return ready.then(function () {
          if (!state || !state.valid) throw invalidError();
          return canvasToBlob(exportCanvas(), type || 'image/png', quality);
        });
      },
      onChange: function (cb) { return events.on(cb); },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(flashTimer);
        if (ro) ro.disconnect();
        events.clear();
        base = null;
        if (root.parentNode) root.parentNode.removeChild(root);
        canvas.width = 0; canvas.height = 0;
      }
    };
    return api;
  }

  global.OYWEditor = {
    version: '1.0.0',
    photo: photo,
    text: text
  };
})(window);
