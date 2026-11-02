/* Badge Studio — scene compositor. Renders a project frame at logical 368×368
   into any square canvas: background → content (pattern / text / image / gif /
   video / sequence / qr / clock / pixel) → stickers → caption → frame. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { rgba, clamp, hslToHex } = BS.util;
  const W = 368, C = 184, TAU = Math.PI * 2;

  const MODES = [
    ['pattern', 'Animaciones', 'wand'], ['text', 'Texto', 'type'], ['image', 'Imagen', 'image'], ['gif', 'GIF', 'film'], ['video', 'Video', 'video'],
    ['sequence', 'Secuencia', 'layers'], ['qr', 'Código QR', 'qr'], ['clock', 'Reloj', 'clock'], ['pixel', 'Pixel art', 'pixel'],
  ];
  const FRAMES = [['none', 'Sin marco'], ['ring', 'Anillo'], ['neon', 'Neón'], ['dashed', 'Punteado'], ['rainbow', 'Arcoíris'], ['dots', 'Luces'], ['vignette', 'Viñeta']];
  const BACKGROUNDS = [['solid', 'Color'], ['gradient', 'Degradado'], ['radial', 'Radial'], ['pattern', 'Animación']];
  const FITS = [['cover', 'Rellenar'], ['contain', 'Ajustar'], ['stretch', 'Estirar']];

  function defaults() {
    return {
      version: 2, mode: 'pattern', name: '',
      background: { kind: 'solid', color: '#090f0b', color2: '#1d2b1a', angle: 135, patternId: 'stars' },
      pattern: { id: 'orbit', color: '#d0f56a', color2: '#469cff', speed: 1, density: 1 },
      text: { line1: 'HOLA, MUNDO.', line2: 'STEM MAKER', effect: 'pulse', font: 'sans', size: 30, color: '#d0f56a', color2: '#a8ba96', bold: true, outline: false, outlineColor: '#000000', shadow: true, speed: 1 },
      media: { fit: 'cover', zoom: 1, rotation: 0, flipH: false, flipV: false, panX: 0, panY: 0, mask: 'none', filters: { brightness: 100, contrast: 100, saturate: 100, hue: 0, grayscale: 0, invert: 0, sepia: 0, blur: 0 } },
      gif: { fps: 0, reverse: false, boomerang: false, trimStart: 0, trimEnd: 1 },
      video: { start: 0, speed: 1 },
      sequence: { perFrame: 1, transition: 'fade' },
      qr: { text: 'https://badge.local', fg: '#0b0f0b', bg: '#ffffff', ecc: 'M', size: 0.68, caption: '' },
      clock: { face: 'digital', color: '#d0f56a', color2: '#ffffff', h24: true, showDate: true, showSeconds: true },
      pixel: { size: 16, rate: 4, frames: [], index: 0 },
      overlay: { text: '', position: 'bottom', size: 20, color: '#ffffff', font: 'sans', bg: true, effect: 'static' },
      stickers: [],
      frame: { style: 'none', color: '#d0f56a', width: 10 },
      export: { duration: 4, fps: 10, resolution: 368, quality: 82, still: false, budgetKB: 900 },
    };
  }
  function merge(base, over) { if (!over || typeof over !== 'object') return base; for (const k of Object.keys(over)) { if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], over[k]); else base[k] = over[k]; } return base; }
  function normalize(p) { return merge(defaults(), p); }

  function duration(p, assets) {
    const d = p.export.duration;
    if (p.mode === 'pixel') return Math.max(0.25, (p.pixel.frames.length || 1) / p.pixel.rate);
    if (p.mode === 'gif' && assets?.gif?.frames?.length) { const g = assets.gif; const fps = p.gif.fps || 0; const n = Math.max(1, Math.round(g.frames.length * (p.gif.trimEnd - p.gif.trimStart))) * (p.gif.boomerang ? 2 : 1); if (fps) return n / fps; const avg = g.frames.reduce((s, f) => s + f.delay, 0) / g.frames.length / 1000; return Math.max(0.3, n * avg); }
    if (p.mode === 'video' && assets?.video && Number.isFinite(assets.video.duration)) return Math.max(0.1, Math.min(d, (assets.video.duration - p.video.start) / (p.video.speed || 1)));
    if (p.mode === 'sequence' && assets?.sequence?.length) return Math.max(0.5, assets.sequence.length * p.sequence.perFrame);
    return d;
  }

  function drawBackground(ctx, t, p) {
    const b = p.background;
    if (b.kind === 'gradient') { const a = (b.angle || 0) * Math.PI / 180, g = ctx.createLinearGradient(C - Math.cos(a) * C, C - Math.sin(a) * C, C + Math.cos(a) * C, C + Math.sin(a) * C); g.addColorStop(0, b.color); g.addColorStop(1, b.color2); ctx.fillStyle = g; }
    else if (b.kind === 'radial') { const g = ctx.createRadialGradient(C, C, 10, C, C, 260); g.addColorStop(0, b.color2); g.addColorStop(1, b.color); ctx.fillStyle = g; }
    else ctx.fillStyle = b.color;
    ctx.fillRect(0, 0, W, W);
    if (b.kind === 'pattern') { ctx.save(); ctx.globalAlpha = 0.55; BS.patterns.draw(ctx, t, { id: b.patternId, color: p.pattern.color, color2: p.pattern.color2, speed: 1, density: 1, duration: p.export.duration }); ctx.restore(); }
  }

  function filterString(f) {
    if (!f) return 'none';
    const parts = [];
    if (f.brightness !== 100) parts.push('brightness(' + f.brightness + '%)');
    if (f.contrast !== 100) parts.push('contrast(' + f.contrast + '%)');
    if (f.saturate !== 100) parts.push('saturate(' + f.saturate + '%)');
    if (f.hue) parts.push('hue-rotate(' + f.hue + 'deg)');
    if (f.grayscale) parts.push('grayscale(' + f.grayscale + '%)');
    if (f.invert) parts.push('invert(' + f.invert + '%)');
    if (f.sepia) parts.push('sepia(' + f.sepia + '%)');
    if (f.blur) parts.push('blur(' + f.blur + 'px)');
    return parts.join(' ') || 'none';
  }
  /* Draws any drawable (bitmap, image, video, canvas) with the media transform. */
  function drawMedia(ctx, src, m, alpha = 1) {
    if (!src) return;
    const w = src.width || src.videoWidth || src.naturalWidth, h = src.height || src.videoHeight || src.naturalHeight;
    if (!w || !h) return;
    const base = m.fit === 'stretch' ? null : (m.fit === 'contain' ? Math.min(W / w, W / h) : Math.max(W / w, W / h));
    ctx.save();
    ctx.globalAlpha = alpha;
    if (m.mask === 'circle') { ctx.beginPath(); ctx.arc(C, C, C, 0, TAU); ctx.clip(); }
    else if (m.mask === 'rounded') { ctx.beginPath(); ctx.roundRect(24, 24, W - 48, W - 48, 40); ctx.clip(); }
    try { ctx.filter = filterString(m.filters); } catch { /* unsupported */ }
    ctx.translate(C + (m.panX || 0) * W, C + (m.panY || 0) * W);
    ctx.rotate((m.rotation || 0) * Math.PI / 180);
    ctx.scale((m.flipH ? -1 : 1) * (m.zoom || 1), (m.flipV ? -1 : 1) * (m.zoom || 1));
    if (base === null) ctx.drawImage(src, -C, -C, W, W); else ctx.drawImage(src, -w * base / 2, -h * base / 2, w * base, h * base);
    ctx.restore();
  }

  function gifFrameAt(t, p, g) {
    const start = Math.floor(g.frames.length * clamp(p.gif.trimStart, 0, 1)), end = Math.max(start + 1, Math.ceil(g.frames.length * clamp(p.gif.trimEnd, 0, 1)));
    let list = g.frames.slice(start, end); if (p.gif.reverse) list = list.slice().reverse(); if (p.gif.boomerang) list = list.concat(list.slice(1, -1).reverse());
    if (!list.length) return null;
    if (p.gif.fps) return list[Math.floor(t * p.gif.fps) % list.length];
    const total = list.reduce((s, f) => s + f.delay, 0) / 1000; let tt = (t % total) * 1000;
    for (const f of list) { tt -= f.delay; if (tt < 0) return f; }
    return list[list.length - 1];
  }

  function drawPixelFrames(ctx, t, p) {
    const frames = p.pixel.frames, n = p.pixel.size || 16, f = frames[Math.floor(t * p.pixel.rate) % Math.max(1, frames.length)] || frames[0];
    if (!f) return;
    const cell = Math.floor(256 / n), x0 = C - (cell * n) / 2, y0 = C - (cell * n) / 2;
    for (let i = 0; i < n * n; i++) if (f[i]) { ctx.fillStyle = f[i]; ctx.fillRect(x0 + (i % n) * cell, y0 + Math.floor(i / n) * cell, cell, cell); }
  }

  function drawStickers(ctx, t, p, dur) {
    for (const s of p.stickers || []) {
      const q = (t / dur) * TAU;
      let dx = 0, dy = 0, rot = (s.rotation || 0) * Math.PI / 180, sc = 1;
      if (s.anim === 'bounce') dy = -Math.abs(Math.sin(q * 2)) * 18;
      if (s.anim === 'spin') rot += q;
      if (s.anim === 'pulse') sc = 1 + Math.sin(q * 2) * 0.12;
      if (s.anim === 'float') { dx = Math.sin(q) * 10; dy = Math.cos(q * 1.3) * 8; }
      ctx.save(); ctx.translate(s.x * W + dx, s.y * W + dy); ctx.rotate(rot); ctx.scale(sc, sc);
      ctx.font = Math.round((s.size || 0.2) * W) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.emoji || '⭐', 0, 0); ctx.restore();
    }
  }
  function drawFrame(ctx, t, p) {
    const f = p.frame; if (!f || f.style === 'none') return;
    const w = f.width || 10, r = C - w / 2;
    ctx.save(); ctx.lineWidth = w;
    if (f.style === 'ring') { ctx.strokeStyle = f.color; ctx.beginPath(); ctx.arc(C, C, r, 0, TAU); ctx.stroke(); }
    else if (f.style === 'neon') { ctx.strokeStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 24 + Math.sin(t * 4) * 8; ctx.beginPath(); ctx.arc(C, C, r - 4, 0, TAU); ctx.stroke(); }
    else if (f.style === 'dashed') { ctx.strokeStyle = f.color; ctx.setLineDash([18, 12]); ctx.lineDashOffset = -t * 40; ctx.beginPath(); ctx.arc(C, C, r, 0, TAU); ctx.stroke(); }
    else if (f.style === 'rainbow') { for (let i = 0; i < 36; i++) { ctx.strokeStyle = hslToHex((i * 10 + t * 90) % 360, 90, 60); ctx.beginPath(); ctx.arc(C, C, r, i * TAU / 36, (i + 1.05) * TAU / 36); ctx.stroke(); } }
    else if (f.style === 'dots') { for (let i = 0; i < 40; i++) { const a = i * TAU / 40, on = (i + Math.floor(t * 8)) % 4 === 0; ctx.fillStyle = on ? f.color : rgba(f.color, 0.3); ctx.beginPath(); ctx.arc(C + Math.cos(a) * (C - w), C + Math.sin(a) * (C - w), w * 0.45, 0, TAU); ctx.fill(); } }
    else if (f.style === 'vignette') { const g = ctx.createRadialGradient(C, C, C * 0.55, C, C, C); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.85)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W); }
    ctx.restore();
  }

  /* assets: { image, gif:{frames:[{bitmap|data,...}]}, video, sequence:[bitmaps], now } */
  function render(ctx, t, project, assets = {}) {
    const p = project, dur = duration(p, assets), scale = ctx.canvas.width / W;
    ctx.save(); ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackground(ctx, t, p);
    switch (p.mode) {
      case 'pattern': BS.patterns.draw(ctx, t, { ...p.pattern, duration: dur }); break;
      case 'text': BS.textfx.draw(ctx, t, p.text, dur); break;
      case 'image': if (assets.image) drawMedia(ctx, assets.image, p.media); else placeholder(ctx, 'ELEGÍ UNA IMAGEN', p.pattern.color); break;
      case 'gif': { const g = assets.gif; if (g?.frames?.length) { const f = gifFrameAt(t, p, g); if (f) drawMedia(ctx, f.bitmap || f.canvas, p.media); } else placeholder(ctx, 'ELEGÍ UN GIF', p.pattern.color); break; }
      case 'video': if (assets.video) drawMedia(ctx, assets.video, p.media); else placeholder(ctx, 'ELEGÍ UN VIDEO', p.pattern.color); break;
      case 'sequence': {
        const seq = assets.sequence || [];
        if (!seq.length) { placeholder(ctx, 'AGREGÁ IMÁGENES', p.pattern.color); break; }
        const per = p.sequence.perFrame, i = Math.floor(t / per) % seq.length, next = (i + 1) % seq.length, ph = (t % per) / per;
        drawMedia(ctx, seq[i], p.media);
        if (p.sequence.transition === 'fade' && seq.length > 1 && ph > 0.75) drawMedia(ctx, seq[next], p.media, (ph - 0.75) / 0.25);
        break;
      }
      case 'qr': {
        const q = assets.qr; const size = W * clamp(p.qr.size, 0.3, 0.9), x = C - size / 2, y = C - size / 2 - (p.qr.caption ? 14 : 0);
        if (q) { ctx.save(); ctx.beginPath(); ctx.roundRect(x - 10, y - 10, size + 20, size + 20, 18); ctx.fillStyle = p.qr.bg; ctx.fill(); ctx.restore(); BS.qr.draw(ctx, q, x, y, size, p.qr.fg, p.qr.bg, 0); }
        if (p.qr.caption) { ctx.font = '700 17px Inter,"Segoe UI",Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff'; ctx.fillText(p.qr.caption, C, y + size + 32); }
        break;
      }
      case 'clock': BS.clock.draw(ctx, t, p.clock, assets.now || new Date()); break;
      case 'pixel': drawPixelFrames(ctx, t, p); break;
      default: break;
    }
    drawStickers(ctx, t, p, dur);
    BS.textfx.caption(ctx, t, p.overlay, dur);
    drawFrame(ctx, t, p);
    ctx.restore();
  }
  function placeholder(ctx, label, color) {
    ctx.strokeStyle = rgba(color, 0.35); ctx.setLineDash([8, 8]); ctx.strokeRect(96, 96, 176, 140); ctx.setLineDash([]);
    ctx.font = '700 14px Inter,"Segoe UI",Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(label, C, 262);
  }

  BS.scene = { MODES, FRAMES, BACKGROUNDS, FITS, defaults, normalize, duration, render, drawMedia, filterString, gifFrameAt };
})(typeof window !== 'undefined' ? window : globalThis);
