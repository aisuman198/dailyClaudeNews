// Jekyll が render したマークダウン (#raw-content) を v4 マガジン形式に変換。
// 想定する入力構造 (writer + summarizer 出力):
//   <h2>本日のハイライト</h2>
//   <ul><li>...</li><li>...</li><li>...</li></ul>
//   <h2>カテゴリ別まとめ</h2>
//   <h3>カテゴリ名（N件）</h3>
//   <h4><a href="...">Title</a></h4>
//   <p><sub>source ・ pt ・ date ・ state</sub><br><sub><strong>訳</strong>: ...</sub></p>
//   <p>summary paragraph</p>
//   <p>body paragraph</p>
//   <hr>
//   <h4>...</h4>
//   ...

(function(){
'use strict';

const CAT_STYLES = {
  'プロダクト':       { icon: '📦', tone: 'product' },
  '開発者ツール':     { icon: '🛠', tone: 'devtool' },
  '資金調達':         { icon: '💰', tone: 'business' },
  '研究':             { icon: '🔬', tone: 'research' },
  '安全性':           { icon: '🛡', tone: 'safety' },
  '開発者・利用者':   { icon: '🗣', tone: 'voice' },
  '開発者の声':       { icon: '🗣', tone: 'voice' },
  'その他':           { icon: '📰', tone: 'misc' },
};
function styleFor(name){
  for (const k of Object.keys(CAT_STYLES)) {
    if (name.includes(k)) return CAT_STYLES[k];
  }
  return { icon: '📰', tone: 'misc' };
}

function slug(s){
  return s.toLowerCase().replace(/[^a-z0-9一-龯ぁ-んァ-ヶー]+/g,'-').replace(/(^-|-$)/g,'').slice(0,80);
}

function parseMeta(s){
  const out = { source: '', sourceLabel: '', points: null, date: '', state: '', recurrence: 0 };
  if (!s) return out;
  const parts = s.split(/[・·]/).map(x => x.trim()).filter(Boolean);
  for (const p of parts) {
    if (p === 'hacker-news') { out.source='hn'; out.sourceLabel='HACKER NEWS'; }
    else if (p === 'anthropic-blog') { out.source='anthropic'; out.sourceLabel='ANTHROPIC'; }
    else if (/^(\d+)\s*pt$/i.test(p)) { out.points = parseInt(p, 10); }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(p)) { out.date = p; }
    else if (p.includes('継続')) {
      out.state = 'recur';
      const m = p.match(/(\d+)\s*回目/);
      if (m) out.recurrence = parseInt(m[1], 10);
    } else if (p.includes('新規')) {
      out.state = 'fresh';
    }
  }
  return out;
}

function extractTranslation(p){
  // <p>...<sub><strong>訳</strong>: 日本語訳</sub>...</p>
  const subs = p.querySelectorAll('sub');
  for (const sub of subs) {
    const txt = sub.textContent || '';
    if (/^訳[:：]/.test(txt)) return txt.replace(/^訳[:：]\s*/, '').trim();
  }
  return '';
}

function extractMetaString(p){
  // First <sub> in the p that does NOT start with "訳"
  const subs = p.querySelectorAll('sub');
  for (const sub of subs) {
    const txt = sub.textContent || '';
    if (!/^訳[:：]/.test(txt)) return txt.trim();
  }
  return '';
}

function findHeading(root, level, text){
  const headings = root.querySelectorAll(level);
  for (const h of headings) {
    if (h.textContent.trim() === text) return h;
  }
  return null;
}

function parseDocument(raw){
  const highlights = [];
  const categories = [];

  // ハイライト
  const hHead = findHeading(raw, 'h2', '本日のハイライト');
  if (hHead) {
    let el = hHead.nextElementSibling;
    while (el && el.tagName !== 'H2') {
      if (el.tagName === 'UL') {
        el.querySelectorAll('li').forEach(li => highlights.push(li.textContent.trim()));
        break;
      }
      el = el.nextElementSibling;
    }
  }

  // カテゴリ別
  const catHead = findHeading(raw, 'h2', 'カテゴリ別まとめ');
  if (!catHead) return { highlights, categories };

  let el = catHead.nextElementSibling;
  let curCat = null;
  let curCard = null;
  const finishCard = () => {
    if (curCard && curCat) {
      // 最初の段落を lead 扱い、残りを body へ
      if (curCard._paragraphs.length > 0) {
        curCard.lead = curCard._paragraphs[0];
        curCard.body = curCard._paragraphs.slice(1);
      }
      delete curCard._paragraphs;
      curCat.items.push(curCard);
    }
    curCard = null;
  };
  const finishCat = () => {
    finishCard();
    if (curCat) categories.push(curCat);
    curCat = null;
  };

  while (el) {
    if (el.tagName === 'H2') break;
    const tag = el.tagName;

    if (tag === 'H3') {
      finishCat();
      const t = el.textContent.trim();
      const m = t.match(/^(.+?)（(\d+)件）$/);
      const name = m ? m[1] : t;
      const count = m ? parseInt(m[2], 10) : 0;
      const s = styleFor(name);
      curCat = { name, count, icon: s.icon, tone: s.tone, items: [] };
    } else if (tag === 'H4') {
      if (!curCat) {
        // 万一カテゴリなしで h4 が出てきた場合は無名カテゴリを作る
        curCat = { name: '記事', count: 0, icon: '📰', tone: 'misc', items: [] };
      }
      finishCard();
      const a = el.querySelector('a');
      curCard = {
        id: slug(el.textContent),
        title: a ? a.textContent.trim() : el.textContent.trim(),
        url: a ? a.href : '',
        meta: null,
        translation: '',
        lead: '',
        body: [],
        _paragraphs: [],
      };
    } else if (tag === 'P' && curCard) {
      const subs = el.querySelectorAll('sub');
      if (subs.length > 0 && !curCard.meta) {
        curCard.meta = parseMeta(extractMetaString(el));
        curCard.translation = extractTranslation(el);
      } else {
        // 通常段落
        curCard._paragraphs.push(el.innerHTML);
      }
    } else if (tag === 'HR') {
      finishCard();
    }
    el = el.nextElementSibling;
  }
  finishCat();
  return { highlights, categories };
}

function renderHero(highlights, heroImages, heroSources){
  // heroImages: window.HERO_IMAGES (frontmatter から layout 経由)。長さ 3、各要素は URL 文字列 or null。
  // heroSources: ハイライト→マッチした記事の source ラベル ('ANTHROPIC' / 'HACKER NEWS')
  return highlights.map((h, i) => {
    const img = (heroImages && heroImages[i]) ? heroImages[i] : null;
    const src = (heroSources && heroSources[i]) ? heroSources[i] : '';
    const styleAttr = img ? ` style="background-image:url('${escapeAttr(img)}')"` : '';
    const cls = img ? 'h-item has-img' : 'h-item';
    return `<div class="${cls}"${styleAttr}>
       <div class="h-inner">
         <div>
           <div class="h-num">${String(i+1).padStart(2,'0')}</div>
           ${src ? `<div class="h-source">${escapeHtml(src)}</div>` : ''}
         </div>
         <div class="h-text">${h}</div>
       </div>
     </div>`;
  }).join('');
}

function renderSidebarToc(categories){
  return categories.map(c => `
    <a class="cat" href="#cat-${c.tone}">
      <span class="icon">${c.icon}</span>
      <span>${c.name}</span>
      <span class="count">${String(c.items.length).padStart(2,'0')}</span>
    </a>
    <div class="articles">
      ${c.items.map(i => `<a href="#a-${i.id}" title="${escapeAttr(i.title)}">${i.title}</a>`).join('')}
    </div>
  `).join('');
}

function renderCategories(categories){
  return categories.map(c => `
    <section class="cat" id="cat-${c.tone}" data-single="${c.items.length===1}">
      <div class="cat-head">
        <span class="cat-icon">${c.icon}</span>
        <h2 class="cat-name">${c.name}</h2>
        <span class="cat-count">${String(c.items.length).padStart(2,'0')} STORIES</span>
      </div>
      <div class="articles-grid">
        ${c.items.map(renderCard).join('')}
      </div>
    </section>
  `).join('');
}

function renderCard(it){
  const m = it.meta || {};
  const srcLabel = m.source === 'hn'
    ? `<span class="src">HACKER NEWS</span>${m.points ? ` · ${m.points}PT` : ''}`
    : m.source === 'anthropic'
      ? `<span class="src">ANTHROPIC</span>`
      : '<span class="src">SOURCE</span>';
  const tagline = m.source === 'hn' ? 'COMMUNITY' : 'OFFICIAL';
  const stateCls = m.state === 'fresh' ? 'fresh' : 'recur';
  const stateText = m.state === 'fresh' ? 'NEW' : `RECURRING · ${m.recurrence || 0}TH`;
  const body = (it.body || []).length
    ? `<details><summary></summary>${it.body.map(p => `<p>${p}</p>`).join('')}</details>` : '';
  const searchText = [it.title, it.translation, it.lead, ...(it.body||[])].join(' ').toLowerCase();
  const transHtml = it.translation ? `<p class="trans">${escapeHtml(it.translation)}</p>` : '';
  return `<article class="card" id="a-${it.id}" data-text="${escapeAttr(searchText)}">
    <div class="card-tagline">${tagline}</div>
    <h3><a href="${escapeAttr(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a></h3>
    ${transHtml}
    <p class="byline">
      ${srcLabel}<span class="sep">·</span>
      <span>${m.date || ''}</span><span class="sep">·</span>
      <span class="${stateCls}">${stateText}</span>
    </p>
    <p class="lead">${it.lead}</p>
    ${body}
  </article>`;
}

function escapeHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escapeAttr(s){return escapeHtml(s);}

function setupTheme(){
  // localStorage で前回選択を覚える。デフォルトはダーク。
  const saved = localStorage.getItem('dcn-theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
  const btn = document.getElementById('theme');
  const updateLabel = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    if (btn) btn.textContent = cur === 'dark' ? '☾ Light' : '☀ Dark';
  };
  updateLabel();
  if (btn) btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const nxt = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nxt);
    localStorage.setItem('dcn-theme', nxt);
    updateLabel();
  });
}

function setupExpandAll(){
  const btn = document.getElementById('expand-all');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const opened = document.querySelectorAll('details[open]').length;
    const total = document.querySelectorAll('details').length;
    const open = opened < total;
    document.querySelectorAll('details').forEach(d => { d.open = open; });
    btn.textContent = open ? 'Collapse All' : 'Expand All';
  });
}

function setupSearch(){
  const q = document.getElementById('q');
  if (!q) return;
  q.addEventListener('input', e => {
    const v = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.card').forEach(el => {
      el.classList.toggle('fade', v && !el.dataset.text.includes(v));
    });
    document.querySelectorAll('.cat').forEach(sec => {
      const has = sec.querySelectorAll('.card:not(.fade)').length > 0;
      sec.style.display = has ? '' : 'none';
    });
  });
}

function findArticleForHighlight(highlight, categories){
  const h = highlight.toLowerCase();
  let best = null, bestScore = 0;
  for (const c of categories) {
    for (const it of c.items) {
      const words = it.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      let score = 0;
      for (const w of words) if (h.includes(w)) score++;
      if (score > bestScore) { bestScore = score; best = it; }
    }
  }
  return bestScore > 0 ? best : null;
}

function sourceLabelFor(item){
  if (!item || !item.meta) return '';
  if (item.meta.source === 'hn') return 'HACKER NEWS';
  if (item.meta.source === 'anthropic') return 'ANTHROPIC';
  return '';
}

document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  const raw = document.getElementById('raw-content');
  if (!raw) return;
  const parsed = parseDocument(raw);

  const heroImages = (window.HERO_IMAGES && Array.isArray(window.HERO_IMAGES))
    ? window.HERO_IMAGES : [];
  const heroSources = parsed.highlights.map(h =>
    sourceLabelFor(findArticleForHighlight(h, parsed.categories))
  );

  const heroEl = document.getElementById('hero');
  if (heroEl) heroEl.innerHTML = renderHero(parsed.highlights, heroImages, heroSources);

  const tocEl = document.getElementById('toc');
  if (tocEl) tocEl.innerHTML = renderSidebarToc(parsed.categories);

  const mainEl = document.getElementById('v4-rendered');
  if (mainEl) mainEl.innerHTML = renderCategories(parsed.categories);

  setupExpandAll();
  setupSearch();
});

})();
