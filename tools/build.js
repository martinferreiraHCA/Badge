#!/usr/bin/env node
/* Inlines CSS and JS into a single distributable HTML file: dist/badge-studio.html
   (same thing the original badge_studio_e01.html was: one file you can open anywhere). */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="css\/app.css">/, () => '<style>\n' + fs.readFileSync(path.join(root, 'css/app.css'), 'utf8') + '\n</style>');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '').replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '');
const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
html = html.replace(/<link rel="icon"[^>]*>/, '<link rel="icon" href="data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '" type="image/svg+xml">');
const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>\n?/g)];
let bundle = '';
for (const m of scripts) bundle += '/* ===== ' + m[1] + ' ===== */\n' + fs.readFileSync(path.join(root, m[1]), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n';
html = html.replace(/(<script src="js\/[^"]+"><\/script>\n?)+/, () => '<script>\n' + bundle + '</script>\n');
html = html.replace("navigator.serviceWorker.register('sw.js')", "Promise.resolve()");
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/badge-studio.html');
fs.writeFileSync(out, html);
console.log('dist/badge-studio.html', (html.length / 1024).toFixed(1) + ' KB');
