/* OYW26 toolkit shell: tabs, LinkedIn banners, captions. Shares state with the frame tool through window.OYW. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const OYW = (window.OYW = window.OYW || {});

  // true  = testing: the gate offers "Schneider Electric" / "Enactus" buttons, deep links such as #posts work,
  //         and the Posts tab shows an unlock toggle.
  // false = live: the email decides the audience and every visit starts on the first tab.
  // On localhost only, ?gate=test or ?gate=live overrides it for one visit (a development aid; ignored on the public site).
  const TEST_MODE = false;
  const q = new URLSearchParams(location.search);
  const forced = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? q.get('gate') : null;
  OYW.mode = forced === 'live' ? 'live' : forced === 'test' ? 'test' : (TEST_MODE ? 'test' : 'live');

  // ---------------------------------------------------------------- tabs
  const TABS = ['frame', 'signature', 'banner', 'posts'];
  const LABELS = { frame: 'Profile frame', signature: 'Email signature', banner: 'LinkedIn banner', posts: 'Posts' };
  const tabButtons = [...document.querySelectorAll('.tabs [data-tab]')];
  const visibleTabs = () => tabButtons.filter((b) => !b.hidden);
  function showTab(id, push) {
    if (!TABS.includes(id)) id = 'frame';
    const target = tabButtons.find((b) => b.dataset.tab === id);
    if (target && target.hidden) id = 'frame';
    for (const b of tabButtons) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const t of TABS) {
      const panel = $('tool-' + t);
      if (panel) panel.hidden = t !== id;
    }
    if (push && history.replaceState) history.replaceState(null, '', '#' + id);
    document.dispatchEvent(new CustomEvent('oyw:tab', { detail: id }));
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }
  tabButtons.forEach((b, i) => {
    b.addEventListener('click', () => showTab(b.dataset.tab, true));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const vis = visibleTabs(), at = vis.indexOf(b);
      const n = vis[(at + d + vis.length) % vis.length];
      n.focus(); showTab(n.dataset.tab, true);
    });
  });
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1), false));
  // a tab can be switched off for an audience (Enactus delegates get no email signature); numbers and Next links follow
  function setTabHidden(id, hidden) {
    const b = tabButtons.find((x) => x.dataset.tab === id);
    if (!b || b.hidden === !!hidden) return;
    b.hidden = !!hidden;
    const arrow = b.previousElementSibling;
    if (arrow && arrow.classList.contains('tab-arrow')) arrow.hidden = !!hidden;
    renumber(); updateNextLinks();
    if (hidden && b.getAttribute('aria-selected') === 'true') showTab('frame', true);
  }
  function renumber() {
    visibleTabs().forEach((b, n) => { const el = b.querySelector('.tab-num'); if (el) el.textContent = n + 1; });
  }
  function updateNextLinks() {
    const vis = visibleTabs().map((b) => b.dataset.tab);
    for (const t of TABS) {
      const panel = $('tool-' + t), a = panel && panel.querySelector('a.next');
      if (!a) continue;
      const at = vis.indexOf(t), next = at >= 0 && at < vis.length - 1 ? vis[at + 1] : null;
      a.hidden = !next;
      if (next) { a.href = '#' + next; a.innerHTML = `Next: ${LABELS[next]} <span aria-hidden="true">→</span>`; }
    }
  }
  OYW.showTab = showTab;
  OYW.setTabHidden = setTabHidden;
  OYW.updateNextLinks = updateNextLinks;
  updateNextLinks();

  // ---------------------------------------------------------------- LinkedIn banners
  const BANNERS = [
    { id: 'banner-1', name: 'Gradient blocks', note: 'Logos top centre' },
    { id: 'banner-2', name: 'Deep green', note: 'Logos right' },
    { id: 'banner-3', name: 'Deep green', note: 'Logos under the title' },
    { id: 'banner-4', name: 'Sage grid', note: 'Marks top centre' },
  ];
  const bannerGrid = $('bannerGrid'), bannerImg = $('bannerImg'), bannerLink = $('bannerDownload'), avatar = $('liAvatar');
  let bannerId = BANNERS[0].id;
  function selectBanner(id) {
    bannerId = id;
    for (const b of bannerGrid.children) b.setAttribute('aria-checked', String(b.dataset.id === id));
    bannerImg.src = `assets/banners/${id}.jpg`;
    bannerLink.href = `assets/banners/${id}.jpg`;
    bannerLink.download = `OYW26-LinkedIn-banner-${id.slice(-1)}.jpg`;
  }
  function buildBanners() {
    if (!bannerGrid) return;
    bannerGrid.innerHTML = '';
    BANNERS.forEach((b, i) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'banner-pick'; el.role = 'radio'; el.dataset.id = b.id;
      el.setAttribute('aria-checked', 'false');
      el.innerHTML = `<img src="assets/banners/${b.id}-thumb.jpg" alt="Banner ${i + 1}: ${b.name}, ${b.note}" width="528" height="132"><span>${i + 1} · ${b.name} <small>${b.note}</small></span>`;
      el.addEventListener('click', () => selectBanner(b.id));
      bannerGrid.appendChild(el);
    });
    selectBanner(bannerId);
  }
  function refreshAvatar() {
    if (!avatar) return;
    const url = OYW.getFrameDataURL && OYW.getFrameDataURL();
    avatar.style.backgroundImage = url ? `url(${url})` : '';
    avatar.classList.toggle('has-photo', !!url);
  }
  // name and headline come from the signature step, the way LinkedIn shows them under the banner
  const liName = $('liName'), liHeadline = $('liHeadline');
  const sigName = $('sigName'), sigTitle = $('sigTitle');
  function refreshProfileText() {
    if (!liName) return;
    const n = (sigName && sigName.value.trim()) || '';
    const t = (sigTitle && sigTitle.value.trim()) || '';
    liName.textContent = n || 'Your name';
    liHeadline.textContent = (t ? t : 'Your job title') + ' at Schneider Electric';
  }
  if (sigName) sigName.addEventListener('input', refreshProfileText);
  if (sigTitle) sigTitle.addEventListener('input', refreshProfileText);
  document.addEventListener('oyw:tab', (e) => { if (e.detail === 'banner') { refreshAvatar(); refreshProfileText(); } });
  refreshProfileText();

  // ---------------------------------------------------------------- boot
  buildBanners();
  if (OYW.mode === 'live') {
    // live: always start on the first tab, whatever link brought the visitor here
    if (location.hash && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    showTab('frame', false);
  } else {
    showTab(location.hash.slice(1) || 'frame', false);
  }
})();
