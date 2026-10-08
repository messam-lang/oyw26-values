/* OYW26 toolkit: who the toolkit is for (email gate) + the ready-made LinkedIn posts.
 * Data comes from data/posts.json (built by tools/build_posts.py). Explorer emails are stored hashed;
 * what the visitor types is hashed on the device the same way and compared. Nothing is sent anywhere.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const OYW = (window.OYW = window.OYW || {});
  const LS = { audience: 'oyw-audience', voice: 'oyw-voice', overrides: 'oyw-voice-overrides', lang: 'oyw-lang', sigAuto: 'oyw-sig-auto' };
  const MODE = OYW.mode || 'test';            // decided in toolkit.js (TEST_MODE flag, ?gate= override)

  const els = {
    gate: $('gate'), gateChoice: $('gateChoice'), gateForm: $('gateForm'), gateEmail: $('gateEmail'),
    gateLead: $('gateLead'), gateMode: $('gateMode'), gateError: $('gateError'),
    who: $('who'), whoLine: $('whoLine'), whoChange: $('whoChange'), kicker: $('kicker'),
    panel: $('postsPanel'), tabPosts: $('tab-posts'),
  };
  let DATA = null;
  let audience = null;            // { kind: 'employee' | 'enactus' | 'explorer', explorerId?, seed }
  const edited = new Map();       // postId+variant -> true once the visitor edits a caption
  let overrides = load(LS.overrides) || {};

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  async function sha256(s) {
    if (!(window.crypto && crypto.subtle)) return sha256js(s);   // WebCrypto only exists on https and localhost
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Plain-JS SHA-256, so the gate still works if the page is ever reached over http (before a certificate is issued).
  function sha256js(str) {
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const K = [], H = [];
    const isPrime = (n) => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
    for (let n = 2, i = 0; i < 64; n++) if (isPrime(n)) { if (i < 8) H[i] = (Math.pow(n, 0.5) * 4294967296) | 0; K[i++] = (Math.pow(n, 1 / 3) * 4294967296) | 0; }
    const bytes = Array.from(new TextEncoder().encode(str)), bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 255);
    const w = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function domainOf(email) { return (email.split('@')[1] || '').toLowerCase(); }
  function isSchneider(domain) { return (DATA.schneiderDomains || []).some((d) => domain === d || domain.endsWith('.' + d)); }
  const fmtDay = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDate() + ' ' + d.toLocaleString('en-GB', { month: 'short' }); };
  // "today" comes from the server's clock (Date header on the data file) so a wrong device clock does not open a post early
  let clockOffset = 0;
  function today() { const d = new Date(Date.now() + clockOffset); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  // a post opens on its planned date (the playbook spaces people out inside a shared window) and closes with the window
  const opensOn = (p) => (p.date > p.windowStart ? p.date : p.windowStart);
  function statusOf(p) {
    if (!p.windowStart) return { k: 'open', label: 'Share any time' };   // undated post (speakers)
    const t = today(), open = opensOn(p);
    if (t < open) return { k: 'soon', label: 'Opens ' + fmtDay(open) };
    if (t > p.windowEnd) return { k: 'past', label: 'Closed ' + fmtDay(p.windowEnd) };
    return { k: 'now', label: 'Open now · until ' + fmtDay(p.windowEnd) };
  }
  // Schneider employees and Explorers can post or download only inside the window, so the campaign lands in order.
  // Enactus delegates are guests and stay open. In test mode a toggle unlocks everything so testers can try downloads.
  const lockApplies = () => audience && (audience.kind === 'employee' || audience.kind === 'explorer');   // speakers' posts are undated
  const testUnlocked = () => MODE === 'test' && sessionStorage.getItem('oyw-test-unlock') === '1';
  const isLocked = (st) => lockApplies() && st.k !== 'now' && !testUnlocked();
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); return ok;
    }
  }
  function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }

  // ---------------------------------------------------------------- LinkedIn (no API)
  // LinkedIn's composer opens with the caption already in the box. The button is a real link (target=_blank), which
  // browsers never treat as a pop-up; the caption is also copied because phones sometimes drop the prefill.
  function composeUrl(text) { return 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(text); }
  function onPostClick(text) {
    copyText(text).then((ok) => toast(ok ? 'Caption copied. LinkedIn is opening with it in the box. Add the image, then post.' : 'LinkedIn is opening. Paste the caption if it is not in the box.'));
  }
  let canShareFiles = false;
  try { canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] })); } catch (_) { canShareFiles = false; }
  async function shareWithImage(cards, text) {
    try {
      const files = await Promise.all(cards.map(async (c) => new File([await (await fetch(c.src + '?v=' + DATA.built)).blob()], c.name, { type: 'image/jpeg' })));
      await copyText(text);
      await navigator.share({ files, text });
    } catch (e) { if (!e || e.name !== 'AbortError') toast('Sharing is not available here. Download the image and use Post on LinkedIn.'); }
  }
  function download(cards) {
    cards.forEach((c, i) => setTimeout(() => {
      const a = document.createElement('a'); a.href = c.src + '?v=' + DATA.built; a.download = c.name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }, i * 500));
    toast(cards.length > 1 ? 'Downloading both cards.' : 'Downloading the image.');
  }

  // ---------------------------------------------------------------- gate
  function renderGate() {
    document.body.classList.add('gated');
    els.gate.hidden = false; els.who.hidden = true;
    els.gateChoice.hidden = MODE !== 'test';
    els.gateMode.hidden = MODE !== 'test';
    els.gateLead.textContent = MODE === 'test'
      ? 'Pick who you are. African Explorers: enter your work email below to see your own posts.'
      : 'Schneider Electric employees: use your work email. Enactus delegates: any email works.';
    els.gateError.hidden = true;
    OYW.setTabHidden && OYW.setTabHidden('signature', false);
  }
  // Schneider emails are firstname.lastname@…: the name welcomes the visitor and fills in their email signature.
  const capWord = (s) => s.split('-').map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('-');
  function nameFrom(email, ex) {
    const tokens = email.split('@')[0].replace(/\d+/g, '').split(/[._]+/).filter(Boolean);
    if (ex) {
      // Explorers: keep the spelling printed on their visuals, given name first (the email starts with the given name)
      const parts = ex.name.split(/\s+/), norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
      const at = parts.findIndex((p) => norm(p) === norm(tokens[0] || ''));
      if (at > 0) parts.unshift(parts.splice(at, 1)[0]);
      return { first: parts[0], name: parts.join(' ') };
    }
    if (tokens.length < 2) return { first: '', name: '' };      // no clear first.last pattern: greet without a name
    return { first: capWord(tokens[0]), name: tokens.map(capWord).join(' ') };
  }
  async function classify(emailRaw) {
    const email = emailRaw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    const hash = await sha256(DATA.salt + ':' + email);
    const seed = parseInt(hash.slice(0, 8), 16);
    // speakers are checked first (per speakers_manifest.json); they see only their own Meet the Speakers post
    const speaker = (DATA.speakers || []).find((s) => s.hash === hash);
    if (speaker) return { kind: 'speaker', speakerId: speaker.id, seed, email, first: speaker.first, name: speaker.name };
    const explorer = DATA.explorers.find((x) => x.hash === hash);
    if (explorer) return Object.assign({ kind: 'explorer', explorerId: explorer.id, seed, email }, nameFrom(email, explorer));
    if (isSchneider(domainOf(email))) return Object.assign({ kind: 'employee', seed, email }, nameFrom(email, null));
    return { kind: 'enactus', seed };
  }
  // The gate's name and email go into the signature step, where they stay editable. Anything typed there by hand wins.
  function prefillSignature(a) {
    const nameEl = $('sigName'), emailEl = $('sigEmail'), note = $('sigAutoNote');
    // no email (Enactus, or the test-mode buttons): no identity to fill in, leave the fields alone
    if (!nameEl || !emailEl || a.kind === 'enactus' || !a.email) { if (note) note.hidden = true; return ''; }
    const prev = load(LS.sigAuto) || {};
    let changed = false;
    // Same person coming back: only empty or previously auto-filled fields are touched, so anything they typed by hand
    // is kept. A different Schneider email on the same device is a new person: every signature field starts fresh.
    const newPerson = !!prev.email && prev.email !== a.email;
    const put = (el, val, was) => {
      const cur = el.value, auto = !!was && cur === was;
      if ((newPerson || auto || !cur.trim()) && cur !== (val || '')) { el.value = val || ''; changed = true; }
    };
    put(nameEl, a.name, prev.name);
    put(emailEl, a.email, prev.email);
    if (newPerson) for (const id of ['sigTitle', 'sigPhone']) { const el = $(id); if (el && el.value) { el.value = ''; changed = true; } }
    save(LS.sigAuto, { name: a.name || '', email: a.email });
    if (changed) nameEl.dispatchEvent(new Event('input', { bubbles: true }));
    // report what the fields actually hold now (hand-typed values may have been kept instead)
    const nameOk = !!a.name && nameEl.value === a.name, emailOk = emailEl.value === a.email;
    const filled = nameOk && emailOk ? 'name and email' : emailOk ? 'email' : nameOk ? 'name' : '';
    if (note) {
      note.hidden = !filled;
      note.textContent = filled === 'name and email' ? 'Your name and email are filled in from the email you entered at the start. Edit anything.'
        : filled === 'email' ? 'Your email is filled in from the one you entered at the start. Add your name, and edit anything.'
        : 'Your name is filled in from the email you entered at the start. Edit anything.';
    }
    return filled;
  }
  els.gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = await classify(els.gateEmail.value);
    if (!a) { els.gateError.hidden = false; els.gateEmail.focus(); return; }
    els.gateEmail.value = '';
    applyAudience(a, true);
  });
  els.gateChoice.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]'); if (!b) return;
    applyAudience({ kind: b.dataset.kind, seed: Math.floor(Math.random() * 1e9) }, true);
  });
  els.whoChange.addEventListener('click', () => {
    audience = null; save(LS.audience, null);
    renderGate();
    OYW.showTab && OYW.showTab('frame', true);
    els.gate.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function explorerOf(a) { return a && a.kind === 'explorer' ? DATA.explorers.find((x) => x.id === a.explorerId) : null; }
  function speakerOf(a) { return a && a.kind === 'speaker' ? (DATA.speakers || []).find((s) => s.id === a.speakerId) : null; }
  function applyAudience(a, announce) {
    const ex = explorerOf(a), sp = speakerOf(a);
    if ((a.kind === 'explorer' && !ex) || (a.kind === 'speaker' && !sp)) { renderGate(); return; }
    audience = a; save(LS.audience, a);
    document.body.classList.remove('gated');
    els.gate.hidden = true; els.who.hidden = false;
    const first = a.kind === 'explorer' ? (a.first || ex.first) : a.kind === 'speaker' ? sp.first : (a.first || '');
    const role = a.kind === 'explorer' ? 'African Explorer' : a.kind === 'speaker' ? 'Speaker' : a.kind === 'enactus' ? 'Enactus delegate' : 'Schneider Electric employee';
    const shown = a.kind === 'explorer' ? (a.name || ex.name) : a.kind === 'speaker' ? sp.name : (a.name || '');
    els.whoLine.innerHTML = shown ? `Welcome, <b>${esc(shown)}</b> · ${role}` : `Viewing as <b>${role}</b>`;
    const filled = prefillSignature(a);
    if (els.kicker) els.kicker.textContent = a.kind === 'enactus' ? 'Enactus toolkit' : 'Employee toolkit';
    if (OYW.setTabHidden) OYW.setTabHidden('signature', a.kind === 'enactus');
    if (els.tabPosts) els.tabPosts.lastChild.textContent = a.kind === 'explorer' ? 'Your posts' : a.kind === 'speaker' ? 'Speakers' : a.kind === 'enactus' ? 'Enactus posts' : 'Posts';
    renderPosts();
    if (announce) {
      toast(a.kind === 'enactus' ? 'Welcome. The Enactus posts are in the Posts tab.'
        : `Welcome${first ? ', ' + first : ''}. ${a.kind === 'speaker' ? 'Your Meet the Speakers post is in the Speakers tab' : 'Your posts are in the Posts tab'}${filled ? `, and your ${filled} ${filled === 'name and email' ? 'are' : 'is'} already in the Email signature tab` : ''}.`, 4800);
      if (MODE !== 'live' && OYW.showTab) OYW.showTab('posts', true);   // live: stay on the first tab
    }
  }

  // ---------------------------------------------------------------- posts
  function currentVoice(set) {
    const saved = load(LS.voice + '-' + set.key);
    if (saved && set.archetypes.some((a) => a.key === saved)) return saved;
    return set.archetypes[(audience.seed || 0) % set.archetypes.length].key;   // suggested: spreads evenly across people
  }
  function renderPosts() {
    if (!els.panel || !audience) return;
    els.panel.innerHTML = '';
    const ex = explorerOf(audience), sp = speakerOf(audience);
    if (sp) renderSpeaker(sp); else if (ex) renderExplorer(ex); else renderSet(audience.kind === 'enactus' ? DATA.sets.enactus : DATA.sets.graduates);
  }

  function renderSpeaker(sp) {
    const head = document.createElement('div');
    head.className = 'posts-head';
    head.innerHTML = `<h2>Hi ${esc(sp.first)}, here is your Meet the Speakers post</h2>
      <p class="lead">Made for you as a Schneider Electric speaker at the Summit${sp.role ? ', ' + esc(sp.role) : ''}. There is no posting date: share it whenever suits you. Edit the caption until it sounds like you.</p>`;
    els.panel.appendChild(head);
    const list = document.createElement('section');
    list.className = 'post-list';
    sp.posts.forEach((p, i) => {
      list.appendChild(postCard({ post: p, index: i, cards: p.langs.EN.cards, caption: p.langs.EN.caption, variantKey: 'EN', subline: 'English', alternatives: [] }));
    });
    els.panel.appendChild(list);
  }

  function renderSet(set) {
    const voice = currentVoice(set);
    const suggested = set.archetypes[(audience.seed || 0) % set.archetypes.length].key;
    const isEnactus = set.key === 'enactus';
    const head = document.createElement('div');
    head.className = 'posts-head';
    head.innerHTML = `<h2>${isEnactus ? 'Enactus posts' : audience.first ? `Hi ${esc(audience.first)}, here are your LinkedIn posts` : 'Your LinkedIn posts'}</h2>
      <p class="lead">${set.posts.length} posts between ${fmtDay(set.posts[0].windowStart)} and ${fmtDay(set.posts[set.posts.length - 1].windowEnd)}, in posting order. Each comes in four voices. ${isEnactus ? 'Captions are starting points: say it in your own words and language.' : 'Each post unlocks on its date and closes when its window ends, so the campaign lands in order. Edit the caption until it sounds like you.'}</p>`;
    els.panel.appendChild(head);
    addTestUnlock(head);
    if (!isEnactus) els.panel.appendChild(remindersCard(set.posts, 'graduates'));

    const voiceBox = document.createElement('section');
    voiceBox.className = 'voice step';
    voiceBox.innerHTML = `<h2><span class="num">1</span> Pick your voice</h2>
      <p class="fine top">Every post was written from four different starting points. One is suggested so the shared timeline stays varied. Pick whichever sounds like you; you can switch per post below.</p>
      <div class="voice-grid" role="radiogroup" aria-label="Voice"></div>`;
    const grid = voiceBox.querySelector('.voice-grid');
    for (const a of set.archetypes) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'voice-pick'; b.role = 'radio'; b.dataset.key = a.key;
      b.setAttribute('aria-checked', String(a.key === voice));
      b.innerHTML = `<span class="voice-key">${a.key}</span><span class="voice-name">${esc(a.name)}</span><span class="voice-blurb">${esc(a.blurb)}</span>${a.key === suggested ? '<span class="voice-sugg">Suggested for you</span>' : ''}`;
      b.addEventListener('click', () => { save(LS.voice + '-' + set.key, a.key); overrides = {}; save(LS.overrides, null); renderPosts(); });
      grid.appendChild(b);
    }
    els.panel.appendChild(voiceBox);

    const list = document.createElement('section');
    list.className = 'post-list';
    list.innerHTML = `<h2 class="list-title"><span class="num">2</span> Your posts, in order</h2>`;
    set.posts.forEach((p, i) => {
      const v = overrides[p.id] && p.variants[overrides[p.id]] ? overrides[p.id] : voice;
      list.appendChild(postCard({
        post: p, index: i, cards: p.variants[v].cards, caption: p.variants[v].caption, variantKey: v,
        subline: `Voice ${v} · ${esc(set.archetypes.find((a) => a.key === v).name)}`,
        alternatives: set.archetypes.filter((a) => a.key !== v && p.variants[a.key] && p.variants[a.key].cards.length).map((a) => ({
          key: a.key, name: a.name, thumb: p.variants[a.key].cards[0].thumb,
          pick: () => { overrides[p.id] = a.key; save(LS.overrides, overrides); renderPosts(); },
        })),
      }));
    });
    els.panel.appendChild(list);
  }

  function renderExplorer(ex) {
    const hasFR = ex.posts.some((p) => p.langs.FR && p.langs.FR.cards.length);
    let lang = load(LS.lang) || ex.language || 'EN';
    if (lang === 'FR' && !hasFR) lang = 'EN';
    const head = document.createElement('div');
    head.className = 'posts-head';
    head.innerHTML = `<h2>Hi ${esc(audience.first || ex.first)}, here are your posts</h2>
      <p class="lead">${ex.posts.length} posts between ${fmtDay(ex.posts[0].windowStart)} and ${fmtDay(ex.posts[ex.posts.length - 1].windowEnd)}, written in your voice as an African Explorer${ex.theme ? ' on the ' + esc(ex.theme) + ' theme' : ''}. Each post unlocks on its date and closes when its window ends. Edit anything before you post.</p>
      ${hasFR ? `<div class="lang" role="radiogroup" aria-label="Language"><span>Show</span>
        <button type="button" role="radio" data-lang="EN" aria-checked="${lang === 'EN'}">English</button>
        <button type="button" role="radio" data-lang="FR" aria-checked="${lang === 'FR'}">Français</button>
        <small>You have both. Post both, or the one your main audience reads.</small></div>` : ''}`;
    head.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { save(LS.lang, b.dataset.lang); renderPosts(); }));
    els.panel.appendChild(head);
    addTestUnlock(head);
    els.panel.appendChild(remindersCard(ex.posts, ex.id));

    const list = document.createElement('section');
    list.className = 'post-list';
    ex.posts.forEach((p, i) => {
      const L = p.langs[lang] && p.langs[lang].cards.length ? lang : 'EN';
      const other = L === 'EN' ? 'FR' : 'EN';
      const alt = p.langs[other] && p.langs[other].cards.length ? [{
        key: other, name: other === 'FR' ? 'Version française' : 'English version', thumb: p.langs[other].cards[0].thumb,
        pick: () => { save(LS.lang, other); renderPosts(); },
      }] : [];
      list.appendChild(postCard({
        post: p, index: i, cards: p.langs[L].cards, caption: p.langs[L].caption, variantKey: L,
        subline: (L === 'FR' ? 'Français' : 'English') + (p.chain ? ' · ' + esc(p.chain) : ''),
        alternatives: alt, altTitle: 'Other language',
      }));
    });
    els.panel.appendChild(list);
  }

  // ---------------------------------------------------------------- reminders
  // An .ics with one 09:00 event on the morning each post opens (no server; works in Outlook, Google and Apple Calendar).
  const siteUrl = () => location.origin + location.pathname;
  const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function icsFold(line) {
    const out = []; let s = line;
    while (s.length > 72) { out.push(s.slice(0, 72)); s = ' ' + s.slice(72); }
    out.push(s); return out.join('\r\n');
  }
  function buildIcs(posts, tag) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OYW26 toolkit//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:OYW26 posting days'];
    for (const p of posts) {
      const d = opensOn(p).replace(/-/g, '');
      const desc = `Your "${p.title}" post is open from ${fmtDay(opensOn(p))} to ${fmtDay(p.windowEnd)}. Open the toolkit, go to Posts and press Post on LinkedIn.\n${siteUrl()}`;
      L.push('BEGIN:VEVENT', `UID:oyw26-${tag}-${p.id}@energizedbyeachother.com`, 'DTSTAMP:' + stamp,
        'DTSTART:' + d + 'T090000', 'DTEND:' + d + 'T093000',
        'SUMMARY:' + icsText(`Post on LinkedIn today: ${p.title} (#OYW26)`), 'DESCRIPTION:' + icsText(desc), 'URL:' + siteUrl(),
        'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText('Your OYW26 post is open. Open the toolkit and post.'), 'END:VALARM', 'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }
  function downloadIcs(posts, tag) {
    const blob = new Blob([buildIcs(posts, tag)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'OYW26-posting-days.ics'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`${posts.length} reminders ready. Open the file to add them to your calendar.`);
  }
  function remindersCard(posts, tag) {
    const box = document.createElement('section');
    box.className = 'reminders step';
    const upcoming = posts.filter((p) => today() <= p.windowEnd);
    box.innerHTML = `<h2><span class="num">!</span> Get a nudge when each post opens</h2>
      <p class="fine top">Posts unlock on their own dates. Add them to your calendar so you do not miss a window: one 09:00 reminder on the morning each post opens, with a link back here. Works with Outlook, Google and Apple Calendar.</p>
      <div><button class="btn ghost small act-ics" type="button" ${upcoming.length ? '' : 'disabled'}>Add ${upcoming.length} posting day${upcoming.length === 1 ? '' : 's'} to my calendar</button></div>`;
    box.querySelector('.act-ics').addEventListener('click', () => downloadIcs(upcoming, tag));
    return box;
  }

  function addTestUnlock(head) {
    if (MODE !== 'test' || !lockApplies()) return;
    const on = testUnlocked();
    const p = document.createElement('p');
    p.className = 'test-unlock';
    p.innerHTML = `Test mode: posts outside their window are locked, as they will be live. <button type="button" class="link">${on ? 'Lock them again' : 'Unlock everything for testing'}</button>`;
    p.querySelector('button').addEventListener('click', () => { sessionStorage.setItem('oyw-test-unlock', on ? '0' : '1'); renderPosts(); });
    head.appendChild(p);
  }

  function postCard({ post: p, index, cards, caption, variantKey, subline, alternatives, altTitle }) {
    const st = statusOf(p);
    const locked = isLocked(st);
    const carousel = cards.length > 1;
    const art = document.createElement('article');
    art.className = 'post st-' + st.k + (locked ? ' locked' : '');
    art.dataset.id = p.id;
    const key = p.id + '|' + variantKey;
    const open = opensOn(p);
    const windowText = fmtDay(open) + ' to ' + fmtDay(p.windowEnd);
    const lockNote = !locked ? '' : st.k === 'soon'
      ? `<b>Locked until ${fmtDay(open)}.</b> Posting and downloads are open from ${windowText}. You can read the caption now.`
      : `<b>This window closed on ${fmtDay(p.windowEnd)}.</b> Posting and downloads were open from ${windowText}.`;
    art.innerHTML = `
      <div class="post-visual ${carousel ? 'two' : ''}">
        ${cards.map((c, i) => `<figure><img src="${c.thumb}?v=${DATA.built}" alt="${esc(p.title)} visual${carousel ? ', card ' + (i + 1) : ''}" width="720" height="900" loading="lazy" decoding="async">${carousel ? `<figcaption>Card ${i + 1}</figcaption>` : ''}</figure>`).join('')}
        ${locked ? `<span class="lock-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>${st.k === 'soon' ? 'Opens ' + fmtDay(open) : 'Closed'}</span>` : ''}
      </div>
      <div class="post-main">
        <div class="post-chips"><span class="chip">Post ${index + 1}${p.date ? ' · ' + fmtDay(p.date) : ''}</span><span class="chip st">${esc(st.label)}</span></div>
        <h3 class="post-title">${esc(p.title)}</h3>
        <p class="post-sub">${subline}${carousel ? ' · two cards, post them together' : ''}</p>
        <textarea class="post-caption" rows="8" spellcheck="false" aria-label="Caption for ${esc(p.title)}" ${locked ? 'readonly' : ''}>${esc(caption)}</textarea>
        <div class="row wrap post-actions">
          <a class="btn primary act-li" href="${locked ? '#' : composeUrl(caption)}" target="_blank" rel="noopener noreferrer" ${locked ? 'aria-disabled="true" tabindex="-1"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5v8M6.5 6.4v.1M10.5 17.5v-8m0 3.2c0-2 1.3-3.4 3.2-3.4s3.3 1.4 3.3 3.6v4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Post on LinkedIn</a>
          <button class="btn ghost act-dl" type="button" ${locked ? 'disabled' : ''}>${carousel ? 'Download both cards' : 'Download image'}</button>
          <button class="btn ghost small act-copy" type="button" ${locked ? 'disabled' : ''}>Copy caption</button>
          <button class="btn ghost small act-share" type="button" ${locked ? 'disabled' : ''} ${canShareFiles ? '' : 'hidden'}>Share with image…</button>
        </div>
        <p class="fine">${locked ? lockNote : `<b>Post on LinkedIn</b> copies the caption and opens LinkedIn with it in the box. Add the downloaded image${carousel ? 's' : ''}, ${p.tag ? 'tag ' + esc(p.tag.replace(/\s{2,}/g, ' and ')) + ', ' : ''}check the text, post.${canShareFiles ? ' On a phone, <b>Share with image</b> sends the picture straight to the LinkedIn app; paste the caption if it does not carry over.' : ''}`}</p>
        ${alternatives.length ? `<details class="alt"><summary>${esc(altTitle || 'Other voices for this post')}</summary><div class="alt-grid"></div></details>` : ''}
      </div>`;
    const ta = art.querySelector('.post-caption');
    const li = art.querySelector('.act-li');
    ta.addEventListener('input', () => { edited.set(key, true); autosize(ta); if (!locked) li.href = composeUrl(ta.value); });
    requestAnimationFrame(() => autosize(ta));
    li.addEventListener('click', (e) => { if (locked) { e.preventDefault(); toast(st.k === 'soon' ? `This post opens on ${fmtDay(open)}.` : 'This posting window has closed.'); return; } onPostClick(ta.value); });
    art.querySelector('.act-dl').addEventListener('click', () => { if (!locked) download(cards); });
    art.querySelector('.act-copy').addEventListener('click', async (e) => {
      if (locked) return;
      const ok = await copyText(ta.value); const b = e.currentTarget; const old = b.textContent;
      b.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { b.textContent = old; }, 1600);
    });
    art.querySelector('.act-share').addEventListener('click', () => { if (!locked) shareWithImage(cards, ta.value); });
    const grid = art.querySelector('.alt-grid');
    if (grid) for (const a of alternatives) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'alt-pick';
      b.innerHTML = `<img src="${a.thumb}?v=${DATA.built}" alt="" width="720" height="900" loading="lazy"><span><b>${esc(a.key)}</b> ${esc(a.name)}</span>`;
      b.addEventListener('click', a.pick);
      grid.appendChild(b);
    }
    return art;
  }

  document.addEventListener('oyw:tab', (e) => { if (e.detail === 'posts') for (const ta of els.panel.querySelectorAll('textarea')) autosize(ta); });

  // ---------------------------------------------------------------- boot
  async function boot() {
    if (!els.gate || !els.panel) return;
    try {
      const r = await fetch('data/posts.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      const served = Date.parse(r.headers.get('Date') || '');
      if (served) clockOffset = served - Date.now();
      DATA = await r.json();
    } catch (err) {
      console.warn('posts data unavailable', err);
      document.body.classList.remove('gated'); els.gate.hidden = true;
      els.panel.innerHTML = '<p class="lead">The ready-made posts are not available right now.</p>';
      return;
    }
    const saved = load(LS.audience);
    const savedOk = saved && saved.kind && (saved.kind === 'explorer' ? !!explorerOf(saved) : saved.kind === 'speaker' ? !!speakerOf(saved) : true);
    if (savedOk) applyAudience(saved, false);
    else renderGate();
    OYW.posts = { data: DATA, get audience() { return audience; }, applyAudience, classify, renderGate, mode: MODE, sha256js };
  }
  boot();
})();
