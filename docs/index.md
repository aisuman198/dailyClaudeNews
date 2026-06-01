---
title: Daily Claude News
layout: archive
---

# Daily Claude News

<p class="sub">毎朝 9:00 JST に Claude Code が AI 業界ニュースを日本語にまとめて自動コミットしています。</p>

<p class="source-info">
  Sources:
  <a href="https://www.anthropic.com/">Anthropic Official</a> (sitemap.xml)
  ・
  <a href="https://news.ycombinator.com/">Hacker News</a> (top stories)
  ・ Filter: <code>Anthropic / Claude / Codex</code>
</p>

{% assign daily_pages = site.pages | where_exp: "page", "page.path contains 'daily/'" | where_exp: "page", "page.name != '.gitkeep'" | sort: "name" | reverse %}

<ul class="archive-list">
{% for page in daily_pages %}
  {% assign date = page.name | remove: '.md' %}
  <li>
    <a href="{{ page.url | relative_url }}">{{ date }}</a>
    <span class="stat">🆕 {{ page.fresh_count | default: '?' }} ・ 🔁 {{ page.recurring_count | default: '?' }}</span>
  </li>
{% endfor %}
</ul>

<p style="text-align:center;margin-top:30px;color:var(--muted);font-size:12px">
  Source code: <a href="https://github.com/aisuman198/dailyClaudeNews">github.com/aisuman198/dailyClaudeNews</a>
</p>
