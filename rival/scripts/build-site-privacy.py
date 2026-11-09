#!/usr/bin/env python3
"""Builds site/privacy.html from PRIVACY_POLICY.md and site/terms.html from
TERMS.md, so the website and the source files never differ. The app's copy of
the privacy policy (src/app/privacy.tsx) is kept in step by hand; the app's terms
page reads src/lib/termsText.ts, written here too.
Run from rival/: python3 scripts/build-site-privacy.py"""
import html, re, pathlib

root = pathlib.Path(__file__).resolve().parent.parent

FOOTER = ('<footer><div class="wrap"><span>© 2026 RIVAL</span><span>'
          '<a href="/privacy">Privacy policy</a><a href="/terms">Terms of use</a>'
          '<a href="mailto:hello@therivalapp.com">hello@therivalapp.com</a></span></div></footer>')

def inline(t):
    t = html.escape(t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    return re.sub(r'([\w.+-]+@[\w-]+\.[\w.]+)', r'<a href="mailto:\1">\1</a>', t)

def body_of(md_lines):
    out, para, items = [], [], []
    def flush():
        nonlocal para, items
        if para: out.append(f'<p>{inline(" ".join(para))}</p>'); para = []
        if items: out.append('<ul>' + ''.join(f'<li>{inline(i)}</li>' for i in items) + '</ul>'); items = []
    date = ''
    for line in md_lines:
        s = line.strip()
        if s.startswith('# '):
            flush(); continue
        if s.startswith('**Last updated'):
            flush(); date = re.sub(r'\*', '', s); continue
        if s.startswith('## '):
            flush(); slug = re.sub(r'[^a-z0-9]+', '-', s[3:].lower()).strip('-')
            out.append(f'<h2 class="serif" id="{slug}">{inline(s[3:])}</h2>'); continue
        if s.startswith('- '):
            if para: flush()
            items.append(s[2:]); continue
        if not s:
            flush(); continue
        if items and line.startswith('  '):
            items[-1] += ' ' + s; continue
        para.append(s)
    flush()
    return date, '\n'.join(out)

def build(src, slug, title, description):
    date, body = body_of((root / src).read_text().splitlines())
    page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · RIVAL</title>
<meta name="description" content="{description}">
<meta name="theme-color" content="#1b1a19">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RIVAL">
<meta property="og:url" content="https://therivalapp.com/{slug}">
<meta property="og:title" content="{title} · RIVAL">
<meta property="og:image" content="https://therivalapp.com/img/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://therivalapp.com/{slug}">
<link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/manrope.css">
<link rel="icon" href="/img/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="top"><div class="wrap"><a class="mark" href="/">RIVAL</a><nav><a href="/">Home</a><a href="mailto:hello@therivalapp.com">Contact</a></nav></div></header>
<main class="wrap doc">
<div class="kick">RIVAL</div>
<h1 class="serif">{title}</h1>
<p class="date">{html.escape(date)}</p>
{body}
</main>
{FOOTER}
</body>
</html>
'''
    (root / 'site' / f'{slug}.html').write_text(page)
    print(f'site/{slug}.html written')

build('PRIVACY_POLICY.md', 'privacy', 'Privacy policy', 'What RIVAL collects, who can see it, and how to remove it.')
build('TERMS.md', 'terms', 'Terms of use', 'The agreement for using RIVAL and therivalapp.com.')


# The app's terms page reads the same text (src/lib/termsText.ts), so the app
# and the website never differ. Bold markers are dropped; the app shows plain
# text in its own grey rows.
def app_terms():
    import json
    lines = (root / 'TERMS.md').read_text().splitlines()
    date, intro, sections, cur, para = '', [], [], None, []
    def flush():
        nonlocal para
        if para:
            text = re.sub(r'\*\*(.+?)\*\*', r'\1', ' '.join(para)); para = []
            (cur['rows'] if cur else intro).append(text)
    for line in lines:
        s = line.strip()
        if s.startswith('# '): continue
        if s.startswith('**Last updated'):
            date = re.sub(r'\*|Last updated:\s*', '', s); continue
        if s.startswith('## '):
            flush(); cur = {'title': s[3:], 'rows': []}; sections.append(cur); continue
        if s.startswith('- '):
            flush(); para = [s[2:]]; continue
        if not s:
            flush(); continue
        para.append(s)
    flush()
    out = ('// Built from TERMS.md by scripts/build-site-privacy.py. Do not edit by hand.\n'
           f'export const TERMS_UPDATED = {json.dumps(date)};\n'
           f'export const TERMS_INTRO: string[] = {json.dumps(intro, ensure_ascii=False, indent=2)};\n'
           f'export const TERMS_SECTIONS: {{ title: string; rows: string[] }}[] = {json.dumps(sections, ensure_ascii=False, indent=2)};\n')
    (root / 'src' / 'lib' / 'termsText.ts').write_text(out)
    print('src/lib/termsText.ts written')

app_terms()
