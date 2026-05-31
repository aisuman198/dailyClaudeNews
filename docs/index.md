---
title: Daily Claude News
layout: default
---

# Daily Claude News

Mac の launchd が毎朝 **9:00 JST** に起動し、Claude Code CLI（Max サブスクリプション）で AI 業界ニュースを日本語にまとめて自動コミットしています。

ソース: [Anthropic 公式](https://www.anthropic.com/) (sitemap.xml) ・ [Hacker News](https://news.ycombinator.com/) (top stories)

## アーカイブ

{% assign daily_pages = site.pages | where_exp: "page", "page.path contains 'daily/'" | where_exp: "page", "page.name != '.gitkeep'" | sort: "name" | reverse %}

<ul>
{% for page in daily_pages %}
  {% assign date = page.name | remove: '.md' %}
  <li><a href="{{ page.url | relative_url }}">{{ date }}</a> — 新規 {{ page.fresh_count | default: '?' }} 件 / 継続 {{ page.recurring_count | default: '?' }} 件</li>
{% endfor %}
</ul>

---

ソースコード: [github.com/aisuman198/dailyClaudeNews](https://github.com/aisuman198/dailyClaudeNews)
