#!/usr/bin/env python3
"""Builds site/privacy.html from PRIVACY_POLICY.md, so the website and the
policy file never differ. The app's copy (src/app/privacy.tsx) is kept in
step by hand. Run from rival/: python3 scripts/build-site-privacy.py"""
import html, re, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
md = (root / 'PRIVACY_POLICY.md').read_text().splitlines()

def inline(t):
    t = html.escape(t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    return re.sub(r'([\w.+-]+@[\w-]+\.[\w.]+)', r'<a href="mailto:\1">\1</a>', t)

out, para, items = [], [], []
def flush():
    global para, items
    if para: out.append(f'<p>{inline(" ".join(para))}</p>'); para = []
    if items: out.append('<ul>' + ''.join(f'<li>{inline(i)}</li>' for i in items) + '</ul>'); items = []

date = ''
for line in md:
    s = line.strip()
    if s.startswith('# '):
        flush(); continue
    if s.startswith('**Last updated'):
        flush(); date = re.sub(r'\*', '', s); continue
    if s.startswith('## '):
        flush(); out.append(f'<h2 class="serif">{inline(s[3:])}</h2>'); continue
    if s.startswith('- '):
        if para: flush()
        items.append(s[2:]); continue
    if not s:
        flush(); continue
    if items and line.startswith('  '):
        items[-1] += ' ' + s; continue
    para.append(s)
flush()

body = '\n'.join(out)
page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy policy · RIVAL</title>
<meta name="description" content="What RIVAL collects, who can see it, and how to remove it.">
<meta name="theme-color" content="#1b1a19">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="top"><div class="wrap"><a class="mark" href="/">RIVAL</a><nav><a href="/">Home</a><a href="mailto:getrivalapp@gmail.com">Contact</a></nav></div></header>
<main class="wrap doc">
<div class="kick">RIVAL</div>
<h1 class="serif">Privacy policy</h1>
<p class="date">{html.escape(date)}</p>
{body}
</main>
<footer><div class="wrap"><span>© 2026 RIVAL</span><span><a href="/">Home</a><a href="mailto:getrivalapp@gmail.com">getrivalapp@gmail.com</a></span></div></footer>
</body>
</html>
'''
(root / 'site' / 'privacy.html').write_text(page)
print('site/privacy.html written')
