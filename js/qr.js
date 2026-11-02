/* Badge Studio — QR code generator (byte mode, versions 1-10, ECC L/M/Q/H).
   Returns a boolean matrix; the scene draws it inside the round display. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});

  /* GF(256) tables for Reed-Solomon */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function generator(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; }
  function rsEncode(data, n) { const g = generator(n), out = new Array(n).fill(0); for (const d of data) { const f = d ^ out.shift(); out.push(0); if (f) for (let j = 0; j < n; j++) out[j] ^= mul(g[j + 1], f); } return out; }

  /* [totalCodewords, ecPerBlock, blocksG1, dataG1, blocksG2, dataG2] per version for L,M,Q,H */
  const EC_TABLE = {
    1: { L: [26, 7, 1, 19, 0, 0], M: [26, 10, 1, 16, 0, 0], Q: [26, 13, 1, 13, 0, 0], H: [26, 17, 1, 9, 0, 0] },
    2: { L: [44, 10, 1, 34, 0, 0], M: [44, 16, 1, 28, 0, 0], Q: [44, 22, 1, 22, 0, 0], H: [44, 28, 1, 16, 0, 0] },
    3: { L: [70, 15, 1, 55, 0, 0], M: [70, 26, 1, 44, 0, 0], Q: [70, 18, 2, 17, 0, 0], H: [70, 22, 2, 13, 0, 0] },
    4: { L: [100, 20, 1, 80, 0, 0], M: [100, 18, 2, 32, 0, 0], Q: [100, 26, 2, 24, 0, 0], H: [100, 16, 4, 9, 0, 0] },
    5: { L: [134, 26, 1, 108, 0, 0], M: [134, 24, 2, 43, 0, 0], Q: [134, 18, 2, 15, 2, 16], H: [134, 22, 2, 11, 2, 12] },
    6: { L: [172, 18, 2, 68, 0, 0], M: [172, 16, 4, 27, 0, 0], Q: [172, 24, 4, 19, 0, 0], H: [172, 28, 4, 15, 0, 0] },
    7: { L: [196, 20, 2, 78, 0, 0], M: [196, 18, 4, 31, 0, 0], Q: [196, 18, 2, 14, 4, 15], H: [196, 26, 4, 13, 1, 14] },
    8: { L: [242, 24, 2, 97, 0, 0], M: [242, 22, 2, 38, 2, 39], Q: [242, 22, 4, 18, 2, 19], H: [242, 26, 4, 14, 2, 15] },
    9: { L: [292, 30, 2, 116, 0, 0], M: [292, 22, 3, 36, 2, 37], Q: [292, 20, 4, 16, 4, 17], H: [292, 24, 4, 12, 4, 13] },
    10: { L: [346, 18, 2, 68, 2, 69], M: [346, 26, 4, 43, 1, 44], Q: [346, 24, 6, 19, 2, 20], H: [346, 28, 6, 15, 2, 16] },
  };
  const ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  const ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  function capacity(v, ecc) { const t = EC_TABLE[v][ecc]; return t[2] * t[3] + t[4] * t[5]; }
  function formatBits(ecc, mask) { const data = (ECC_BITS[ecc] << 3) | mask; let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return ((data << 10) | rem) ^ 0x5412; }
  function versionBits(v) { let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); return (v << 12) | rem; }

  function encode(text, ecc = 'M') {
    const bytes = new TextEncoder().encode(text);
    let version = 1; while (version <= 10 && capacity(version, ecc) < bytes.length + (version < 10 ? 2 : 3)) version++;
    if (version > 10) throw new Error('Texto demasiado largo para el QR (máximo ~' + capacity(10, ecc) + ' bytes).');
    const t = EC_TABLE[version][ecc], dataLen = t[2] * t[3] + t[4] * t[5];
    const bits = []; const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(4, 4); push(bytes.length, version < 10 ? 8 : 16); for (const b of bytes) push(b, 8);
    push(0, Math.min(4, dataLen * 8 - bits.length)); while (bits.length % 8) bits.push(0);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0; data.length < dataLen; p ^= 1) data.push(p ? 0x11 : 0xec);
    const blocks = [], ecs = []; let o = 0;
    for (let b = 0; b < t[2] + t[4]; b++) { const n = b < t[2] ? t[3] : t[5]; const d = data.slice(o, o + n); o += n; blocks.push(d); ecs.push(rsEncode(d, t[1])); }
    const out = []; const maxD = Math.max(t[3], t[5]);
    for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < t[1]; i++) for (const e of ecs) out.push(e[i]);

    const size = version * 4 + 17, m = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
    const set = (x, y, v) => { m[y][x] = v ? 1 : 0; };
    const finder = (x, y) => { for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue; const on = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)); set(xx, yy, on); } };
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    const al = ALIGN[version] || [];
    for (const ay of al) for (const ax of al) { if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    set(8, size - 8, 1);
    const reserved = (x, y) => (y === 8 && (x <= 8 || x >= size - 8)) || (x === 8 && (y <= 8 || y >= size - 8));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (reserved(x, y) && m[y][x] === -1) m[y][x] = 0;
    if (version >= 7) for (let i = 0; i < 18; i++) { const b = (versionBits(version) >> i) & 1; m[Math.floor(i / 3)][size - 11 + (i % 3)] = b; m[size - 11 + (i % 3)][Math.floor(i / 3)] = b; }
    const template = m.map((r) => Int8Array.from(r));
    const dataBits = []; for (const b of out) for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    function place(mask) {
      const g = template.map((r) => Int8Array.from(r)); let k = 0, up = true;
      for (let x = size - 1; x > 0; x -= 2) { if (x === 6) x--; for (let i = 0; i < size; i++) { const y = up ? size - 1 - i : i; for (const xx of [x, x - 1]) if (g[y][xx] === -1) { const bit = k < dataBits.length ? dataBits[k] : 0; k++; g[y][xx] = bit ^ (MASKS[mask](xx, y) ? 1 : 0); } } up = !up; }
      const f = formatBits(ecc, mask), bit = (i) => (f >> i) & 1, put = (x, y, v) => { g[y][x] = v; };
      for (let i = 0; i <= 5; i++) put(8, i, bit(i));
      put(8, 7, bit(6)); put(8, 8, bit(7)); put(7, 8, bit(8));
      for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
      put(8, size - 8, 1);
      return g;
    }
    function penalty(g) {
      let s = 0;
      for (let y = 0; y < size; y++) { let run = 1; for (let x = 1; x < size; x++) { if (g[y][x] === g[y][x - 1]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; } }
      for (let x = 0; x < size; x++) { let run = 1; for (let y = 1; y < size; y++) { if (g[y][x] === g[y - 1][x]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; } }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) s += 3;
      let dark = 0; for (const r of g) for (const v of r) dark += v; s += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
      return s;
    }
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) { const g = place(mask); const sc = penalty(g); if (sc < bestScore) { bestScore = sc; best = g; } }
    return { size, version, ecc, modules: best.map((r) => Array.from(r, (v) => v === 1)) };
  }

  function draw(ctx, qr, x, y, w, fg = '#000000', bg = '#ffffff', quiet = 2) {
    const n = qr.size + quiet * 2, cell = w / n;
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, w);
    ctx.fillStyle = fg;
    for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.modules[r][c]) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
  }
  BS.qr = { encode, draw };
})(typeof window !== 'undefined' ? window : globalThis);
