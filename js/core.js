/* Badge Studio — core namespace and shared helpers.
   Every module attaches to the global BS object so the app can be served as
   plain static files and inlined into a single HTML file by tools/build.js. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytesLabel = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB');

  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of parts) { out.set(a, o); o += a.length; }
    return out;
  }
  const hx = (a, max = Infinity) => Array.from(a.slice(0, max), (b) => b.toString(16).padStart(2, '0')).join(' ').toUpperCase() + (a.length > max ? ' …' : '');
  const u16be = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);
  const u32be = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const le16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const le32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const readU16BE = (a, o = 0) => ((a[o] << 8) | a[o + 1]) >>> 0;
  const readU32BE = (a, o = 0) => ((a[o] * 0x1000000) + (a[o + 1] << 16) + (a[o + 2] << 8) + a[o + 3]) >>> 0;
  const readU32LE = (a, o = 0) => ((a[o + 3] * 0x1000000) + (a[o + 2] << 16) + (a[o + 1] << 8) + a[o]) >>> 0;

  /* CRC-16/XMODEM: poly 0x1021, init 0, no reflection, no final xor. */
  function crc16(a) {
    let c = 0;
    for (const b of a) {
      c ^= b << 8;
      for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    return c;
  }

  function uniqueId() {
    const bytes = new Uint8Array(16);
    (root.crypto || require('crypto').webcrypto).getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* Deterministic pseudo random helpers for animations. */
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = hash(xi + yi * 57), b = hash(xi + 1 + yi * 57), c = hash(xi + (yi + 1) * 57), d = hash(xi + 1 + (yi + 1) * 57);
    const u = smooth(xf), v = smooth(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function rgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }
  function rgba(hex, a) { return 'rgba(' + rgb(hex).join(',') + ',' + a + ')'; }
  function hexFromRgb(r, g, b) { return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return hexFromRgb(255 * f(0), 255 * f(8), 255 * f(4));
  }
  function mixHex(a, b, t) { const x = rgb(a), y = rgb(b); return hexFromRgb(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)); }

  /* Device file names: 8.3 upper-case ASCII, the format the E01 lists on screen. */
  function sanitizeName(s, ext = 'AVI') {
    const raw = String(s || 'BADGE001').replace(/\.(avi|jpg|jpeg)$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 8) || 'BADGE001';
    return raw + '.' + ext;
  }
  function renamedFile(name, count, ext = 'AVI') {
    const base = sanitizeName(name, ext).slice(0, -(ext.length + 1));
    if (!count) return base + '.' + ext;
    const match = base.match(/^(.*?)(\d{1,3})$/);
    const rootName = match ? match[1] : base, num = (match ? Number(match[2]) : 0) + count;
    return rootName.slice(0, 5) + String(num % 1000).padStart(3, '0') + '.' + ext;
  }
  function nextFileName(name, ext = 'AVI') {
    const m = String(name || '').match(/^(.*?)(\d{1,3})\.[A-Z]+$/i);
    const base = (m ? m[1] : 'BADGE').slice(0, 5) || 'BADGE', n = (m ? +m[2] : 0) + 1;
    return base.toUpperCase() + String(n % 1000).padStart(3, '0') + '.' + ext;
  }

  BS.util = { sleep, clamp, esc, bytesLabel, concat, hx, u16be, u32be, le16, le32, readU16BE, readU32BE, readU32LE, crc16, uniqueId, hash, lerp, smooth, noise2, rgb, rgba, hexFromRgb, hslToHex, mixHex, sanitizeName, renamedFile, nextFileName };
  BS.VERSION = '2.0.0';
})(typeof window !== 'undefined' ? window : globalThis);
