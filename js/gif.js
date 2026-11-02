/* Badge Studio — GIF decoder (full LZW, disposal methods, local palettes) and
   GIF encoder (median-cut palette, LZW). Pure JS so it works in every browser
   and in Node tests; the app prefers WebCodecs ImageDecoder when available. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});

  /* ---------- decoder ---------- */
  function decode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (String.fromCharCode(b[0], b[1], b[2]) !== 'GIF') throw new Error('No es un archivo GIF.');
    let p = 6;
    const width = b[p] | (b[p + 1] << 8), height = b[p + 2] | (b[p + 3] << 8);
    const packed = b[p + 4], bgIndex = b[p + 5]; p += 7;
    let globalPalette = null;
    if (packed & 0x80) { const n = 1 << ((packed & 7) + 1); globalPalette = b.subarray(p, p + n * 3); p += n * 3; }
    const frames = [];
    let gce = { delay: 100, transparent: -1, disposal: 0 }, loop = 0;
    const canvas = new Uint8ClampedArray(width * height * 4);
    let previous = null;
    const readSub = () => { const parts = []; let total = 0; while (p < b.length) { const n = b[p++]; if (!n) break; parts.push(b.subarray(p, p + n)); total += n; p += n; } const out = new Uint8Array(total); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; } return out; };
    while (p < b.length) {
      const block = b[p++];
      if (block === 0x3b) break;
      if (block === 0x21) {
        const label = b[p++];
        if (label === 0xf9) { const len = b[p++]; const f = b[p]; gce = { disposal: (f >> 2) & 7, transparent: f & 1 ? b[p + 3] : -1, delay: (b[p + 1] | (b[p + 2] << 8)) * 10 }; p += len; p++; }
        else if (label === 0xff) { const len = b[p++]; const id = String.fromCharCode(...b.subarray(p, p + len)); p += len; const d = readSub(); if (id.startsWith('NETSCAPE') && d.length >= 3) loop = d[1] | (d[2] << 8); }
        else { p++; while (p < b.length && b[p]) p += b[p] + 1; p++; }
        continue;
      }
      if (block !== 0x2c) throw new Error('Bloque GIF desconocido 0x' + block.toString(16));
      const ix = b[p] | (b[p + 1] << 8), iy = b[p + 2] | (b[p + 3] << 8), iw = b[p + 4] | (b[p + 5] << 8), ih = b[p + 6] | (b[p + 7] << 8), ipk = b[p + 8]; p += 9;
      let palette = globalPalette;
      if (ipk & 0x80) { const n = 1 << ((ipk & 7) + 1); palette = b.subarray(p, p + n * 3); p += n * 3; }
      const interlaced = !!(ipk & 0x40);
      const minCode = b[p++];
      const data = readSub();
      const indices = lzwDecode(data, minCode, iw * ih);
      if (gce.disposal === 3) previous = canvas.slice();
      const rowMap = interlaced ? interlaceRows(ih) : null;
      for (let y = 0; y < ih; y++) {
        const ty = rowMap ? rowMap[y] : y, cy = iy + ty; if (cy >= height) continue;
        for (let x = 0; x < iw; x++) {
          const idx = indices[y * iw + x]; if (idx === gce.transparent) continue;
          const cx = ix + x; if (cx >= width) continue;
          const o = (cy * width + cx) * 4, q = idx * 3;
          if (!palette || q + 2 >= palette.length) continue;
          canvas[o] = palette[q]; canvas[o + 1] = palette[q + 1]; canvas[o + 2] = palette[q + 2]; canvas[o + 3] = 255;
        }
      }
      frames.push({ data: canvas.slice(), delay: Math.max(20, gce.delay || 100), width, height });
      if (gce.disposal === 2) {
        for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const cx = ix + x, cy = iy + y; if (cx < width && cy < height) { const o = (cy * width + cx) * 4; canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0; } }
      } else if (gce.disposal === 3 && previous) canvas.set(previous);
      gce = { delay: 100, transparent: -1, disposal: 0 };
    }
    if (!frames.length) throw new Error('El GIF no contiene cuadros.');
    return { width, height, frames, loop, bgIndex };
  }
  function interlaceRows(h) { const rows = []; for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y); return rows; }
  function lzwDecode(data, minCode, pixelCount) {
    const out = new Uint8Array(pixelCount);
    const clear = 1 << minCode, eoi = clear + 1;
    let codeSize = minCode + 1, dictSize = eoi + 1, prev = -1, bitBuf = 0, bitCnt = 0, pos = 0, op = 0;
    const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), lengths = new Uint16Array(4096);
    for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; lengths[i] = 1; }
    const stack = new Uint8Array(4097);
    while (op < pixelCount) {
      while (bitCnt < codeSize && pos < data.length) { bitBuf |= data[pos++] << bitCnt; bitCnt += 8; }
      if (bitCnt < codeSize) break;
      const code = bitBuf & ((1 << codeSize) - 1); bitBuf >>>= codeSize; bitCnt -= codeSize;
      if (code === clear) { codeSize = minCode + 1; dictSize = eoi + 1; prev = -1; continue; }
      if (code === eoi) break;
      let entry = code, first;
      if (code >= dictSize) { if (prev < 0) break; entry = prev; }
      let sp = 0, c = entry;
      while (c >= 0 && sp < 4096) { stack[sp++] = suffix[c]; c = prefix[c]; }
      first = stack[sp - 1];
      if (code >= dictSize) stack.copyWithin(1, 0, sp), stack[0] = first, sp++;
      for (let i = sp - 1; i >= 0 && op < pixelCount; i--) out[op++] = stack[i];
      if (prev >= 0 && dictSize < 4096) { prefix[dictSize] = prev; suffix[dictSize] = first; lengths[dictSize] = lengths[prev] + 1; dictSize++; if (dictSize === (1 << codeSize) && codeSize < 12) codeSize++; }
      prev = code;
    }
    return out;
  }

  /* ---------- encoder ---------- */
  function medianCut(pixels, maxColors) {
    const boxes = [{ px: pixels }];
    const range = (box) => { let mn = [255, 255, 255], mx = [0, 0, 0]; for (const p of box.px) for (let c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; } let best = 0, bl = -1; for (let c = 0; c < 3; c++) if (mx[c] - mn[c] > bl) { bl = mx[c] - mn[c]; best = c; } box.axis = best; box.len = bl; };
    boxes.forEach(range);
    while (boxes.length < maxColors) {
      boxes.sort((a, b) => b.len - a.len);
      const box = boxes[0]; if (!box || box.len <= 0 || box.px.length < 2) break;
      box.px.sort((a, b) => a[box.axis] - b[box.axis]);
      const mid = box.px.length >> 1;
      const left = { px: box.px.slice(0, mid) }, right = { px: box.px.slice(mid) };
      range(left); range(right); boxes.splice(0, 1, left, right);
    }
    return boxes.map((b) => { const s = [0, 0, 0]; for (const p of b.px) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map((v) => Math.round(v / b.px.length)); });
  }
  function buildPalette(frames, maxColors = 255) {
    const sample = [];
    const step = Math.max(1, Math.floor(frames.reduce((n, f) => n + f.width * f.height, 0) / 20000));
    for (const f of frames) for (let i = 0; i < f.data.length; i += 4 * step) if (f.data[i + 3] > 127) sample.push([f.data[i], f.data[i + 1], f.data[i + 2]]);
    if (!sample.length) sample.push([0, 0, 0]);
    const pal = medianCut(sample, maxColors);
    while (pal.length < 2) pal.push([0, 0, 0]);
    return pal;
  }
  function nearest(pal, cache, r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key]; if (idx !== undefined) return idx;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) { const d = (pal[i][0] - r) ** 2 + (pal[i][1] - g) ** 2 + (pal[i][2] - b) ** 2; if (d < bd) { bd = d; best = i; } }
    cache[key] = best; return best;
  }
  function lzwEncode(indices, minCode) {
    const clear = 1 << minCode, eoi = clear + 1;
    let codeSize = minCode + 1, dict = new Map(), next = eoi + 1;
    const out = []; let bitBuf = 0, bitCnt = 0;
    const emit = (code) => { bitBuf |= code << bitCnt; bitCnt += codeSize; while (bitCnt >= 8) { out.push(bitBuf & 255); bitBuf >>>= 8; bitCnt -= 8; } };
    emit(clear);
    let cur = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i], key = cur * 4096 + k;
      if (dict.has(key)) { cur = dict.get(key); continue; }
      emit(cur);
      if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
      else { emit(clear); dict = new Map(); next = eoi + 1; codeSize = minCode + 1; }
      cur = k;
    }
    emit(cur); emit(eoi);
    if (bitCnt > 0) out.push(bitBuf & 255);
    return out;
  }
  /* frames: [{data: RGBA, width, height, delay(ms)}]; transparent alpha<128 → index 0 handling is simplified: opaque only. */
  function encode(frames, opts = {}) {
    if (!frames.length) throw new Error('Sin cuadros.');
    const { width, height } = frames[0], loop = opts.loop ?? 0;
    const pal = buildPalette(frames, 256);
    const bits = Math.max(1, Math.ceil(Math.log2(pal.length))), size = 1 << bits;
    const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 255, width >> 8, height & 255, height >> 8, 0x80 | (bits - 1), 0, 0];
    for (let i = 0; i < size; i++) { const c = pal[i] || [0, 0, 0]; out.push(c[0], c[1], c[2]); }
    out.push(0x21, 0xff, 11, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 3, 1, loop & 255, loop >> 8, 0);
    const cache = {};
    for (const f of frames) {
      const delay = Math.round((f.delay || 100) / 10);
      out.push(0x21, 0xf9, 4, 0, delay & 255, delay >> 8, 0, 0);
      out.push(0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0);
      const idx = new Uint8Array(width * height);
      for (let i = 0, p = 0; i < idx.length; i++, p += 4) idx[i] = nearest(pal, cache, f.data[p], f.data[p + 1], f.data[p + 2]);
      const minCode = Math.max(2, bits);
      out.push(minCode);
      const lz = lzwEncode(idx, minCode);
      for (let i = 0; i < lz.length; i += 255) { const n = Math.min(255, lz.length - i); out.push(n); for (let j = 0; j < n; j++) out.push(lz[i + j]); }
      out.push(0);
    }
    out.push(0x3b);
    return new Uint8Array(out);
  }

  BS.gif = { decode, encode };
})(typeof window !== 'undefined' ? window : globalThis);
