/* Badge Studio — pixel art editor model: grids of 8/16/24/32, tools (brush,
   eraser, fill, line, rect, picker, mirror), onion skin, frames, undo, import
   of any image as pixel art. Pure logic; the UI binds pointer events. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { clamp, hexFromRgb } = BS.util;
  const PALETTES = {
    lime: ['#d0f56a', '#ffffff', '#a7b7ff', '#ff8f72', '#69dfd0', '#ffd166', '#eb77b5', '#469cff', '#111111'],
    pico: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
    gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    pastel: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#ffffff', '#333333'],
  };
  const TOOLS = [['brush', 'Pincel'], ['erase', 'Goma'], ['fill', 'Balde'], ['line', 'Línea'], ['rect', 'Rectángulo'], ['picker', 'Cuentagotas']];

  class PixelEditor {
    constructor(size = 16) { this.size = size; this.frames = [this.blank()]; this.index = 0; this.tool = 'brush'; this.color = '#d0f56a'; this.mirror = false; this.onion = true; this.undo = []; this.redo = []; this.dragStart = null; this.preview = null; }
    blank() { return Array(this.size * this.size).fill(null); }
    get frame() { return this.frames[this.index]; }
    snapshot() { return { frames: this.frames.map((f) => f.slice()), index: this.index, size: this.size }; }
    restore(s) { this.frames = s.frames.map((f) => f.slice()); this.index = clamp(s.index, 0, this.frames.length - 1); this.size = s.size; }
    push() { this.undo.push(this.snapshot()); if (this.undo.length > 60) this.undo.shift(); this.redo = []; }
    undoStep() { const s = this.undo.pop(); if (s) { this.redo.push(this.snapshot()); this.restore(s); return true; } return false; }
    redoStep() { const s = this.redo.pop(); if (s) { this.undo.push(this.snapshot()); this.restore(s); return true; } return false; }
    resize(n) { this.push(); const old = this.size; this.frames = this.frames.map((f) => { const g = Array(n * n).fill(null); for (let y = 0; y < Math.min(n, old); y++) for (let x = 0; x < Math.min(n, old); x++) g[y * n + x] = f[y * old + x]; return g; }); this.size = n; }
    load(frames, size) { this.size = size; this.frames = frames.map((f) => f.slice()); this.index = 0; this.undo = []; this.redo = []; }
    addFrame() { if (this.frames.length >= 48) return; this.push(); this.frames.splice(this.index + 1, 0, this.blank()); this.index++; }
    duplicateFrame() { if (this.frames.length >= 48) return; this.push(); this.frames.splice(this.index + 1, 0, this.frame.slice()); this.index++; }
    deleteFrame() { if (this.frames.length < 2) return; this.push(); this.frames.splice(this.index, 1); this.index = Math.min(this.index, this.frames.length - 1); }
    moveFrame(dir) { const j = this.index + dir; if (j < 0 || j >= this.frames.length) return; this.push(); [this.frames[this.index], this.frames[j]] = [this.frames[j], this.frames[this.index]]; this.index = j; }
    clear() { this.push(); this.frames[this.index] = this.blank(); }
    shift(dx, dy) { this.push(); const n = this.size, f = this.frame, g = this.blank(); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g[((y + dy + n) % n) * n + (x + dx + n) % n] = f[y * n + x]; this.frames[this.index] = g; }
    flip(h = true) { this.push(); const n = this.size, f = this.frame, g = this.blank(); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g[y * n + x] = h ? f[y * n + (n - 1 - x)] : f[(n - 1 - y) * n + x]; this.frames[this.index] = g; }
    set(x, y, c) { const n = this.size; if (x < 0 || y < 0 || x >= n || y >= n) return; this.frame[y * n + x] = c; if (this.mirror) this.frame[y * n + (n - 1 - x)] = c; }
    fill(x, y, color) { const n = this.size, f = this.frame, old = f[y * n + x]; if (old === color) return; const stack = [y * n + x], seen = new Set(); while (stack.length) { const p = stack.pop(); if (seen.has(p) || f[p] !== old) continue; seen.add(p); f[p] = color; const xx = p % n, yy = p / n | 0; if (xx > 0) stack.push(p - 1); if (xx < n - 1) stack.push(p + 1); if (yy > 0) stack.push(p - n); if (yy < n - 1) stack.push(p + n); } }
    line(x0, y0, x1, y1, c) { const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy; for (;;) { this.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } } }
    rect(x0, y0, x1, y1, c) { const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [cY, d] = [Math.min(y0, y1), Math.max(y0, y1)]; for (let x = a; x <= b; x++) { this.set(x, cY, c); this.set(x, d, c); } for (let y = cY; y <= d; y++) { this.set(a, y, c); this.set(b, y, c); } }
    /* Pointer protocol: down(x,y) → move(x,y) → up(x,y). Returns true when a redraw is needed. */
    down(x, y) {
      const n = this.size; x = clamp(x, 0, n - 1); y = clamp(y, 0, n - 1);
      if (this.tool === 'picker') { const c = this.frame[y * n + x]; if (c) this.color = c; return true; }
      this.push();
      if (this.tool === 'fill') { this.fill(x, y, this.color); return true; }
      if (this.tool === 'line' || this.tool === 'rect') { this.dragStart = [x, y]; this.base = this.frame.slice(); return false; }
      this.set(x, y, this.tool === 'erase' ? null : this.color); return true;
    }
    move(x, y) {
      const n = this.size; x = clamp(x, 0, n - 1); y = clamp(y, 0, n - 1);
      if (this.dragStart) { this.frames[this.index] = this.base.slice(); const [sx, sy] = this.dragStart; (this.tool === 'line' ? this.line : this.rect).call(this, sx, sy, x, y, this.color); return true; }
      if (this.tool === 'brush' || this.tool === 'erase') { this.set(x, y, this.tool === 'erase' ? null : this.color); return true; }
      return false;
    }
    up() { this.dragStart = null; this.base = null; }
    /* Quantise an image (ImageData at size×size) into the current frame. */
    importImageData(data, n) { this.push(); const f = Array(n * n).fill(null); for (let i = 0; i < n * n; i++) { const a = data[i * 4 + 3]; if (a > 100) f[i] = hexFromRgb(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); } this.size = n; this.frames = this.frames.map((fr) => (fr.length === n * n ? fr : Array(n * n).fill(null))); this.frames[this.index] = f; }
    toPNGData(scale = 16) { if (typeof document === 'undefined') return null; const n = this.size, c = document.createElement('canvas'); c.width = c.height = n * scale; const ctx = c.getContext('2d'); this.frame.forEach((col, i) => { if (col) { ctx.fillStyle = col; ctx.fillRect((i % n) * scale, Math.floor(i / n) * scale, scale, scale); } }); return c.toDataURL('image/png'); }
  }
  function validateFrames(frames, size) {
    if (!Array.isArray(frames) || !frames.length || frames.length > 48) throw new Error('El proyecto debe contener entre 1 y 48 cuadros.');
    return frames.map((a) => { if (!Array.isArray(a) || a.length !== size * size || a.some((c) => c !== null && !/^#[0-9a-f]{6}$/i.test(c))) throw new Error('Datos de pixel art inválidos.'); return a.slice(); });
  }
  function defaultHeart(size = 16) { const f = Array(size * size).fill(null), rows = ['01100110', '11111111', '11111111', '11111111', '01111110', '00111100', '00011000']; const off = Math.floor((size - 8) / 2); rows.forEach((r, y) => [...r].forEach((v, x) => { if (v === '1') f[(y + off) * size + x + off] = '#d0f56a'; })); return f; }
  BS.pixel = { PixelEditor, PALETTES, TOOLS, validateFrames, defaultHeart };
})(typeof window !== 'undefined' ? window : globalThis);
