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

// 取得元ラベルの定義は sources.js（DCN_SOURCES）に集約。
// 未知の source は sourceLabel() が throw する（「SOURCE」へはフォールバックしない）。
const { sourceLabel, isCommunitySource } = (typeof DCN_SOURCES !== 'undefined')
  ? DCN_SOURCES
  : {};

function parseMeta(s){
  // メタ行フォーマット: `source ・ Npt（任意） ・ YYYY-MM-DD ・ 状態（任意）`
  // pt / 日付 / 状態 をパターンで判定し、それ以外の最初のトークンを source スラッグとして拾う。
  // 既知/未知の判定はここでは行わず、表示時に sourceLabel() が担う。
  const out = { source: '', points: null, date: '', state: '', recurrence: 0 };
  if (!s) return out;
  const parts = s.split(/[・·]/).map(x => x.trim()).filter(Boolean);
  for (const p of parts) {
    if (/^(\d+)\s*pt$/i.test(p)) { out.points = parseInt(p, 10); }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(p)) { out.date = p; }
    else if (p.includes('継続')) {
      out.state = 'recur';
      const m = p.match(/(\d+)\s*回目/);
      if (m) out.recurrence = parseInt(m[1], 10);
    } else if (p.includes('新規')) {
      out.state = 'fresh';
    } else if (!out.source) {
      out.source = p;
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

function renderHero(highlights, heroImages, heroSources, heroTargets){
  // heroImages: window.HERO_IMAGES (frontmatter から layout 経由)。長さ 3、各要素は URL 文字列 or null。
  // heroSources: ハイライト→マッチした記事の source ラベル ('ANTHROPIC' / 'HACKER NEWS')
  // heroTargets: ハイライト→マッチした記事のカード id ('xxx') or '' (マッチなし)
  return highlights.map((h, i) => {
    const img = (heroImages && heroImages[i]) ? heroImages[i] : null;
    const src = (heroSources && heroSources[i]) ? heroSources[i] : '';
    const tid = (heroTargets && heroTargets[i]) ? heroTargets[i] : '';
    const styleAttr = img ? ` style="background-image:url('${escapeAttr(img)}')"` : '';
    const cls = img ? 'h-item has-img' : 'h-item';
    const inner = `<div class="h-inner">
         <div>
           <div class="h-num">${String(i+1).padStart(2,'0')}</div>
           ${src ? `<div class="h-source">${escapeHtml(src)}</div>` : ''}
         </div>
         <div class="h-text">${h}</div>
       </div>`;
    if (tid) {
      return `<a class="${cls} h-link" href="#a-${escapeAttr(tid)}"${styleAttr} aria-label="このストーリーの記事へ移動">${inner}</a>`;
    }
    return `<div class="${cls}"${styleAttr}>${inner}</div>`;
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

// SVG ロゴ (currentColor でテーマに追従)。
// X: 公式の X ロゴ、Misskey: 公式マーク (mi-circle)、Slack: 公式 4 色ハッシュ。
const SHARE_ICONS = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  misskey: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4.5C4 3.12 5.12 2 6.5 2S9 3.12 9 4.5v6.6l2.05-2.5a2.3 2.3 0 0 1 1.78-.85h.34c.7 0 1.36.32 1.79.86l2.04 2.49V4.5C17 3.12 18.12 2 19.5 2S22 3.12 22 4.5v15c0 1.38-1.12 2.5-2.5 2.5S17 20.88 17 19.5v-6.6l-1.93 2.35a2.3 2.3 0 0 1-1.78.85h-.58a2.3 2.3 0 0 1-1.78-.85L9 12.9v6.6C9 20.88 7.88 22 6.5 22S4 20.88 4 19.5z"/></svg>',
  slack: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#E01E5A" d="M5.04 15.165a2.522 2.522 0 0 1-2.52 2.523A2.522 2.522 0 0 1 0 15.165a2.52 2.52 0 0 1 2.52-2.52h2.52zm1.27 0a2.52 2.52 0 0 1 2.52-2.52 2.52 2.52 0 0 1 2.52 2.52v6.31A2.522 2.522 0 0 1 8.83 24a2.522 2.522 0 0 1-2.52-2.525z"/><path fill="#36C5F0" d="M8.83 5.042a2.522 2.522 0 0 1-2.52-2.522A2.522 2.522 0 0 1 8.83 0a2.522 2.522 0 0 1 2.52 2.52v2.522zm0 1.271a2.522 2.522 0 0 1 2.52 2.52 2.522 2.522 0 0 1-2.52 2.52H2.521A2.52 2.52 0 0 1 0 8.833a2.52 2.52 0 0 1 2.52-2.52z"/><path fill="#2EB67D" d="M18.956 8.833a2.52 2.52 0 0 1 2.52-2.52A2.52 2.52 0 0 1 24 8.833a2.52 2.52 0 0 1-2.524 2.52h-2.52zm-1.27 0a2.522 2.522 0 0 1-2.521 2.52 2.52 2.52 0 0 1-2.52-2.52V2.52A2.52 2.52 0 0 1 15.165 0a2.52 2.52 0 0 1 2.52 2.52z"/><path fill="#ECB22E" d="M15.165 18.958a2.52 2.52 0 0 1 2.52 2.52A2.52 2.52 0 0 1 15.165 24a2.522 2.522 0 0 1-2.52-2.522v-2.52zm0-1.27a2.52 2.52 0 0 1-2.52-2.523 2.522 2.522 0 0 1 2.52-2.52h6.314A2.52 2.52 0 0 1 24 15.165a2.52 2.52 0 0 1-2.521 2.523z"/></svg>',
};

// 記事カードへの GitHub Pages 上のパーマリンク（共有先）。
// 共有では元記事ではなく、このサイトの該当記事アンカーへ誘導する。
function articlePermalink(id){
  const base = location.origin + location.pathname;
  return id ? `${base}#a-${id}` : base;
}

function buildShareButtons(title, url){
  if (!url) return '';
  const text = title || '';
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const miHref = `https://misskey-hub.net/share/?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&visibility=public`;
  const slackPayload = `${text} ${url}`;
  return `<span class="share" role="group" aria-label="この記事を共有">
    <a class="share-btn x" href="${escapeAttr(xHref)}" target="_blank" rel="noopener" title="X で共有" aria-label="X で共有">${SHARE_ICONS.x}</a>
    <a class="share-btn misskey" href="${escapeAttr(miHref)}" target="_blank" rel="noopener" title="Misskey で共有" aria-label="Misskey で共有">${SHARE_ICONS.misskey}</a>
    <button type="button" class="share-btn slack" data-slack-share="${escapeAttr(slackPayload)}" title="Slack 用にコピー" aria-label="Slack 用にコピー">${SHARE_ICONS.slack}</button>
  </span>`;
}

function renderCard(it){
  const m = it.meta || {};
  // 未知の source なら sourceLabel() が throw する（フォールバックしない）。
  const srcLabel = `<span class="src">${escapeHtml(sourceLabel(m.source))}</span>${m.points ? ` · ${m.points}PT` : ''}`;
  const tagline = isCommunitySource(m.source) ? 'COMMUNITY' : 'OFFICIAL';
  const stateCls = m.state === 'fresh' ? 'fresh' : 'recur';
  const stateText = m.state === 'fresh' ? 'NEW' : `RECURRING · ${m.recurrence || 0}TH`;
  const body = (it.body || []).length
    ? `<details><summary></summary>${it.body.map(p => `<p>${p}</p>`).join('')}</details>` : '';
  const searchText = [it.title, it.translation, it.lead, ...(it.body||[])].join(' ').toLowerCase();
  const transHtml = it.translation ? `<p class="trans">${escapeHtml(it.translation)}</p>` : '';
  const shareHtml = buildShareButtons(it.title, articlePermalink(it.id));
  return `<article class="card" id="a-${it.id}" data-text="${escapeAttr(searchText)}">
    <div class="card-tagline">${tagline}</div>
    <h3><a href="${escapeAttr(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a></h3>
    ${transHtml}
    <p class="byline">
      ${srcLabel}<span class="sep">·</span>
      <span>${m.date || ''}</span><span class="sep">·</span>
      <span class="${stateCls}">${stateText}</span>
      ${shareHtml}
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

function showToast(message){
  let toast = document.getElementById('dcn-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'dcn-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2000);
}

async function copyToClipboard(text){
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function setupShareButtons(){
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slack-share]');
    if (!btn) return;
    e.preventDefault();
    const payload = btn.getAttribute('data-slack-share') || '';
    copyToClipboard(payload).then(
      () => showToast('Slack 用にコピーしました'),
      () => showToast('コピーに失敗しました')
    );
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
  if (!item || !item.meta || !item.meta.source) return '';
  return sourceLabel(item.meta.source);
}

// URL 末尾スラッシュ・ハッシュを無視して比較するための正規化。
function normUrl(u){
  if (!u) return '';
  return String(u).replace(/#.*$/, '').replace(/\/+$/, '');
}

// article_url から記事カードを特定する (案A: hero_matches 経由のマッチング)。
function findCardByUrl(url, categories){
  const target = normUrl(url);
  if (!target) return null;
  for (const c of categories) {
    for (const it of c.items) {
      if (normUrl(it.url) === target) return it;
    }
  }
  return null;
}

// hero_matches (frontmatter) があれば article_url でカードを特定する。
// なければ従来の findArticleForHighlight (クライアント側マッチング) にフォールバックする。
// 返り値: highlights と同順の (card | null) 配列。
function resolveHeroMatches(highlights, categories){
  const fm = window.HERO_MATCHES;
  if (Array.isArray(fm) && fm.length > 0) {
    return highlights.map((h, i) => {
      const m = fm[i];
      if (m && m.article_url) {
        const card = findCardByUrl(m.article_url, categories);
        if (card) return card;
      }
      // hero_matches にエントリがあるが article_url が null / カード不在の場合のみ
      // フォールバックする (旧ページや部分欠損への保険)。
      return findArticleForHighlight(h, categories);
    });
  }
  // hero_matches 未定義 (旧ページ) は従来ロジック。
  return highlights.map(h => findArticleForHighlight(h, categories));
}

document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  const raw = document.getElementById('raw-content');
  if (!raw) return;
  const parsed = parseDocument(raw);

  // ハイライトごとに対応する記事カードを解決する (案A: hero_matches 優先、旧ページはフォールバック)。
  const heroCards = resolveHeroMatches(parsed.highlights, parsed.categories);
  const heroSources = heroCards.map(sourceLabelFor);
  const heroTargets = heroCards.map(it => it ? it.id : '');
  // og:image は hero_matches の og_image を最優先し、無ければ HERO_IMAGES[i] / カードのなし にフォールバック。
  const fm = Array.isArray(window.HERO_MATCHES) ? window.HERO_MATCHES : [];
  const legacyImages = Array.isArray(window.HERO_IMAGES) ? window.HERO_IMAGES : [];
  const heroImages = parsed.highlights.map((_, i) =>
    (fm[i] && fm[i].og_image) ? fm[i].og_image : (legacyImages[i] || null));

  const heroEl = document.getElementById('hero');
  if (heroEl) heroEl.innerHTML = renderHero(parsed.highlights, heroImages, heroSources, heroTargets);

  const tocEl = document.getElementById('toc');
  if (tocEl) tocEl.innerHTML = renderSidebarToc(parsed.categories);

  const mainEl = document.getElementById('v4-rendered');
  if (mainEl) mainEl.innerHTML = renderCategories(parsed.categories);

  setupExpandAll();
  setupSearch();
  setupShareButtons();
});

})();
