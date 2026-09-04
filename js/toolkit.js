/* OYW26 toolkit shell: tabs, LinkedIn banners, captions. Shares state with the frame tool through window.OYW. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const OYW = (window.OYW = window.OYW || {});

  // ---------------------------------------------------------------- tabs
  const TABS = ['frame', 'signature', 'banner', 'captions'];
  const tabButtons = [...document.querySelectorAll('.tabs [data-tab]')];
  function showTab(id, push) {
    if (!TABS.includes(id)) id = 'frame';
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
      const n = tabButtons[(i + d + tabButtons.length) % tabButtons.length];
      n.focus(); showTab(n.dataset.tab, true);
    });
  });
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1), false));
  OYW.showTab = showTab;

  // ---------------------------------------------------------------- captions
  const CAPTIONS = [
    {
      id: 'announcement', title: 'Announcement',
      text: () => `The next generation of leaders is coming together to shape what's next.\n\nSchneider Electric is proud to be part of One Young World 2026 in Cape Town.\n\nPowered by Each Other.\n\n#OYW26 #AdvancingEnergyTech`,
    },
    {
      id: 'pov', title: 'Personal point of view',
      hint: 'The last line is yours to change. It starts with the value you picked in the frame tool.',
      text: (value) => `I'm proud to be part of a community that believes progress happens when we work together.\n\nLooking forward to seeing ideas, perspectives and experiences come together at #OYW2026.\n\nPowered by Each Other.\n\nFor me, impact means: ${value ? value + '.' : '________'}\n\n#OYW26 #AdvancingEnergyTech`,
    },
    {
      id: 'summit', title: 'During the summit',
      text: () => `Ideas are moving. Conversations are happening. Progress is taking shape.\n\nProud to be part of One Young World 2026 in Cape Town, alongside young leaders shaping what's next.\n\nPowered by Each Other.\n\n#OYW26 #AdvancingEnergyTech`,
    },
  ];
  const captionList = $('captionList');
  const edited = new Set();
  function currentValueName() {
    const v = OYW.getValue && OYW.getValue();
    return v ? v.name : '';
  }
  function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
  async function copyText(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { btn.textContent = old; }, 1600);
  }
  function buildCaptions() {
    if (!captionList) return;
    captionList.innerHTML = '';
    for (const c of CAPTIONS) {
      const card = document.createElement('div');
      card.className = 'caption';
      card.innerHTML = `<div class="caption-head"><h3>${c.title}</h3><button class="btn ghost small" type="button">Copy</button></div>
        ${c.hint ? `<p class="fine">${c.hint}</p>` : ''}
        <textarea rows="6" spellcheck="false" aria-label="${c.title} caption"></textarea>`;
      const ta = card.querySelector('textarea');
      ta.value = c.text(currentValueName());
      ta.dataset.id = c.id;
      ta.addEventListener('input', () => { edited.add(c.id); autosize(ta); });
      card.querySelector('button').addEventListener('click', (e) => copyText(ta.value, e.currentTarget));
      captionList.appendChild(card);
      autosize(ta);
    }
  }
  function refreshCaptions() {
    if (!captionList) return;
    const name = currentValueName();
    for (const ta of captionList.querySelectorAll('textarea')) {
      const c = CAPTIONS.find((x) => x.id === ta.dataset.id);
      if (c && !edited.has(c.id)) { ta.value = c.text(name); autosize(ta); }
    }
  }
  document.addEventListener('oyw:value', refreshCaptions);
  document.addEventListener('oyw:tab', (e) => { if (e.detail === 'captions') for (const ta of captionList.querySelectorAll('textarea')) autosize(ta); });

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
  buildCaptions();
  buildBanners();
  showTab(location.hash.slice(1) || 'frame', false);
})();
