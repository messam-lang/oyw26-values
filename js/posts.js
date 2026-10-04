/* OYW26 toolkit: who the toolkit is for (email gate) + the ready-made LinkedIn posts.
 * Data comes from data/posts.json (built by tools/build_posts.py). Explorer emails are stored hashed;
 * what the visitor types is hashed on the device the same way and compared. Nothing is sent anywhere.
 */
(() => {
  'use strict';

  // Email reminders ("your post is open today") are sent by the Google Apps Script in tools/reminders/Code.gs.
  // Paste its web-app URL here to switch the opt-in form on; empty = the form stays hidden (calendar reminders still work).
  const REMINDER_ENDPOINT = '';

  const $ = (id) => document.getElementById(id);
  const OYW = (window.OYW = window.OYW || {});
  const LS = { audience: 'oyw-audience', voice: 'oyw-voice', overrides: 'oyw-voice-overrides', lang: 'oyw-lang', reminded: 'oyw-reminder-email' };
  const MODE = OYW.mode || 'test';            // decided in toolkit.js (TEST_MODE flag, ?gate= override)

  const els = {
    gate: $('gate'), gateChoice: $('gateChoice'), gateForm: $('gateForm'), gateEmail: $('gateEmail'),
    gateLead: $('gateLead'), gateMode: $('gateMode'), gateError: $('gateError'),
    who: $('who'), whoText: $('whoText'), whoChange: $('whoChange'), kicker: $('kicker'),
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
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
    const t = today(), open = opensOn(p);
    if (t < open) return { k: 'soon', label: 'Opens ' + fmtDay(open) };
    if (t > p.windowEnd) return { k: 'past', label: 'Closed ' + fmtDay(p.windowEnd) };
    return { k: 'now', label: 'Open now · until ' + fmtDay(p.windowEnd) };
  }
  // Schneider employees and Explorers can post or download only inside the window, so the campaign lands in order.
  // Enactus delegates are guests and stay open. In test mode a toggle unlocks everything so testers can try downloads.
  const lockApplies = () => audience && audience.kind !== 'enactus';
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
      const files = await Promise.all(cards.map(async (c) => new File([await (await fetch(c.src)).blob()], c.name, { type: 'image/jpeg' })));
      await copyText(text);
      await navigator.share({ files, text });
    } catch (e) { if (!e || e.name !== 'AbortError') toast('Sharing is not available here. Download the image and use Post on LinkedIn.'); }
  }
  function download(cards) {
    cards.forEach((c, i) => setTimeout(() => {
      const a = document.createElement('a'); a.href = c.src; a.download = c.name; a.rel = 'noopener';
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
  async function classify(emailRaw) {
    const email = emailRaw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    const hash = await sha256(DATA.salt + ':' + email);
    const seed = parseInt(hash.slice(0, 8), 16);
    const explorer = DATA.explorers.find((x) => x.hash === hash);
    if (explorer) return { kind: 'explorer', explorerId: explorer.id, seed };
    return { kind: isSchneider(domainOf(email)) ? 'employee' : 'enactus', seed };
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
  function applyAudience(a, announce) {
    const ex = explorerOf(a);
    if (a.kind === 'explorer' && !ex) { renderGate(); return; }
    audience = a; save(LS.audience, a);
    document.body.classList.remove('gated');
    els.gate.hidden = true; els.who.hidden = false;
    els.whoText.textContent = a.kind === 'explorer' ? `${ex.name} · African Explorer` : a.kind === 'enactus' ? 'Enactus delegate' : 'Schneider Electric employee';
    if (els.kicker) els.kicker.textContent = a.kind === 'enactus' ? 'Enactus toolkit' : 'Employee toolkit';
    if (OYW.setTabHidden) OYW.setTabHidden('signature', a.kind === 'enactus');
    if (els.tabPosts) els.tabPosts.lastChild.textContent = a.kind === 'explorer' ? 'Your posts' : a.kind === 'enactus' ? 'Enactus posts' : 'Posts';
    renderPosts();
    if (announce) {
      toast(a.kind === 'explorer' ? `Welcome, ${ex.first}. Your posts are ready in the Posts tab.` : a.kind === 'enactus' ? 'Welcome. The Enactus posts are in the Posts tab.' : 'Welcome. Your posts are in the Posts tab.');
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
    const ex = explorerOf(audience);
    if (ex) renderExplorer(ex); else renderSet(audience.kind === 'enactus' ? DATA.sets.enactus : DATA.sets.graduates);
  }

  function renderSet(set) {
    const voice = currentVoice(set);
    const suggested = set.archetypes[(audience.seed || 0) % set.archetypes.length].key;
    const isEnactus = set.key === 'enactus';
    const head = document.createElement('div');
    head.className = 'posts-head';
    head.innerHTML = `<h2>${isEnactus ? 'Enactus posts' : 'Your LinkedIn posts'}</h2>
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
    head.innerHTML = `<h2>Hi ${esc(ex.first)}, here are your posts</h2>
      <p class="lead">${ex.posts.length} posts between ${fmtDay(ex.posts[0].windowStart)} and ${fmtDay(ex.posts[ex.posts.length - 1].windowEnd)}, written in your voice as an African Explorer${ex.theme ? ' on the ' + esc(ex.theme) + ' theme' : ''}. Each post unlocks on its date and closes when its window ends. Edit anything before you post.</p>
      ${hasFR ? `<div class="lang" role="radiogroup" aria-label="Language"><span>Show</span>
        <button type="button" role="radio" data-lang="EN" aria-checked="${lang === 'EN'}">English</button>
        <button type="button" role="radio" data-lang="FR" aria-checked="${lang === 'FR'}">Français</button>
        <small>You have both. Post both, or the one your main audience reads.</small></div>` : ''}`;
    head.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { save(LS.lang, b.dataset.lang); renderPosts(); }));
    els.panel.appendChild(head);
    addTestUnlock(head);
    els.panel.appendChild(remindersCard(ex.posts, ex.id, lang));

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
  // Calendar: an .ics with one 09:00 event on the morning each post opens (no server, works in Outlook, Google, Apple).
  // Email: opt-in form posting to the Apps Script endpoint (see tools/reminders/Code.gs); hidden until REMINDER_ENDPOINT is set.
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
      L.push('BEGIN:VEVENT', `UID:oyw26-${tag}-${p.id}@messam-lang.github.io`, 'DTSTAMP:' + stamp,
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
  async function subscribeEmail(email, extra) {
    const payload = Object.assign({ email: email.trim().toLowerCase() }, extra);
    try {
      // text/plain + no-cors: Apps Script accepts the POST without a preflight; the reply cannot be read, which is fine
      await fetch(REMINDER_ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
      return true;
    } catch (_) { return false; }
  }
  function remindersCard(posts, tag, lang) {
    const box = document.createElement('section');
    box.className = 'reminders step';
    const upcoming = posts.filter((p) => today() <= p.windowEnd);
    const emailOn = !!REMINDER_ENDPOINT;
    const already = load(LS.reminded);
    box.innerHTML = `<h2><span class="num">!</span> Get a nudge when each post opens</h2>
      <p class="fine top">Posts unlock on their own dates. Set a reminder now so you do not miss a window.</p>
      <div class="reminder-row">
        <div class="reminder-box">
          <h3>Calendar</h3>
          <p class="fine">One 09:00 reminder on the morning each post opens, with a link back here. Works with Outlook, Google and Apple Calendar.</p>
          <div><button class="btn ghost small act-ics" type="button" ${upcoming.length ? '' : 'disabled'}>Add ${upcoming.length} posting day${upcoming.length === 1 ? '' : 's'} to my calendar</button></div>
        </div>
        ${emailOn ? `<div class="reminder-box">
          <h3>Email</h3>
          ${already ? `<p class="reminder-done">You're on the list (${esc(already)}). <button class="link act-change" type="button">Change</button></p>`
            : `<p class="fine">An email the morning a post opens, with a link back here. One per post, unsubscribe link in each.</p>
          <form class="act-email" novalidate><input type="email" inputmode="email" autocomplete="email" placeholder="your.name@se.com" required aria-label="Email for reminders"><button class="btn primary small" type="submit">Email me</button></form>`}
        </div>` : ''}
      </div>`;
    box.querySelector('.act-ics').addEventListener('click', () => downloadIcs(upcoming, tag));
    const form = box.querySelector('.act-email');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input'), email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { input.focus(); toast('Please enter a valid email address.'); return; }
      const btn = form.querySelector('button'); btn.disabled = true;
      const ok = await subscribeEmail(email, { kind: audience.kind, explorerId: audience.explorerId || '', lang: lang || 'EN' });
      btn.disabled = false;
      if (ok) { save(LS.reminded, email); toast('Done. You will get an email the morning each post opens.'); renderPosts(); }
      else toast('That did not go through. Please try again in a moment.');
    });
    const change = box.querySelector('.act-change');
    if (change) change.addEventListener('click', () => { save(LS.reminded, null); renderPosts(); });
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
        ${cards.map((c, i) => `<figure><img src="${c.thumb}" alt="${esc(p.title)} visual${carousel ? ', card ' + (i + 1) : ''}" width="720" height="900" loading="lazy" decoding="async">${carousel ? `<figcaption>Card ${i + 1}</figcaption>` : ''}</figure>`).join('')}
        ${locked ? `<span class="lock-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>${st.k === 'soon' ? 'Opens ' + fmtDay(open) : 'Closed'}</span>` : ''}
      </div>
      <div class="post-main">
        <div class="post-chips"><span class="chip">Post ${index + 1} · ${fmtDay(p.date)}</span><span class="chip st">${esc(st.label)}</span></div>
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
      b.innerHTML = `<img src="${a.thumb}" alt="" width="720" height="900" loading="lazy"><span><b>${esc(a.key)}</b> ${esc(a.name)}</span>`;
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
    if (saved && saved.kind && (saved.kind !== 'explorer' || explorerOf(saved))) applyAudience(saved, false);
    else renderGate();
    OYW.posts = { data: DATA, get audience() { return audience; }, applyAudience, classify, renderGate, mode: MODE };
  }
  boot();
})();
