/* Badge Studio — baseline JPEG encoder with the standard (Annex K) Huffman
   tables and a bare JFIF APP0 header.

   Why not canvas.toBlob('image/jpeg')? The Jieli SoC's MJPEG decoder only
   renders the first pixel rows of JPEGs that use optimised Huffman tables, and
   chokes on ICC/EXIF APP segments that browsers inject (finding shared by
   AuraCast and the E-Badge Studio project). This encoder always emits:
   SOI · APP0/JFIF · DQT×2 · SOF0 · DHT×4 (standard) · SOS · scan · EOI
   with no restart markers, 4:2:0 or 4:4:4 chroma, MCU-aligned 368/360 px. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});

  const ZIGZAG = [0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53, 10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63];
  const STD_LUM_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const STD_CHR_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
  const DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], DC_LUM_VAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], DC_CHR_VAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
  const AC_LUM_VAL = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];
  const AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
  const AC_CHR_VAL = [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];

  function huffTable(bits, vals) {
    const codes = new Array(256), sizes = new Array(256);
    let code = 0, k = 0;
    for (let len = 1; len <= 16; len++) {
      for (let i = 0; i < bits[len - 1]; i++) { codes[vals[k]] = code; sizes[vals[k]] = len; code++; k++; }
      code <<= 1;
    }
    return { codes, sizes };
  }
  const H_DC_L = huffTable(DC_LUM_BITS, DC_LUM_VAL), H_DC_C = huffTable(DC_CHR_BITS, DC_CHR_VAL);
  const H_AC_L = huffTable(AC_LUM_BITS, AC_LUM_VAL), H_AC_C = huffTable(AC_CHR_BITS, AC_CHR_VAL);

  function scaledTable(base, quality) {
    const q = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2;
    const out = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      const v = Math.floor((base[i] * q + 50) / 100);
      out[i] = Math.min(255, Math.max(1, v));
    }
    return out;
  }
  function tableBytesZigzag(t) { const o = new Uint8Array(64); for (let i = 0; i < 64; i++) o[ZIGZAG[i]] = t[i]; return o; }

  class BitWriter {
    constructor(size) { this.buf = new Uint8Array(size); this.pos = 0; this.acc = 0; this.n = 0; }
    ensure(extra) { if (this.pos + extra > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra)); b.set(this.buf); this.buf = b; } }
    bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.pos); this.pos += arr.length; }
    bits(code, size) {
      this.acc = (this.acc << size) | code; this.n += size;
      while (this.n >= 8) {
        const b = (this.acc >>> (this.n - 8)) & 255;
        this.ensure(2); this.buf[this.pos++] = b; if (b === 255) this.buf[this.pos++] = 0;
        this.n -= 8; this.acc &= (1 << this.n) - 1;
      }
    }
    flush() { if (this.n > 0) this.bits((1 << (8 - this.n)) - 1, 8 - this.n); }
    result() { return this.buf.slice(0, this.pos); }
  }

  /* AAN-style float forward DCT on an 8x8 block (in/out length 64). */
  function fdct(block, out, qt) {
    const tmp = new Float32Array(64);
    for (let i = 0; i < 8; i++) {
      const r = i * 8;
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let x = 0; x < 8; x++) s += block[r + x] * COS[x * 8 + u];
        tmp[r + u] = s * (u === 0 ? 0.7071067811865476 : 1) * 0.5;
      }
    }
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        let s = 0;
        for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y * 8 + v];
        const val = s * (v === 0 ? 0.7071067811865476 : 1) * 0.5, idx = v * 8 + u;
        out[ZIGZAG[idx]] = Math.round(val / qt[idx]);
      }
    }
  }
  const COS = new Float32Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = Math.cos((2 * x + 1) * u * Math.PI / 16);

  function category(v) { let a = Math.abs(v), n = 0; while (a) { a >>= 1; n++; } return n; }
  function encodeBlock(w, zz, prevDC, dc, ac) {
    const diff = zz[0] - prevDC, cat = category(diff);
    w.bits(dc.codes[cat], dc.sizes[cat]);
    if (cat) w.bits(diff < 0 ? (diff - 1) & ((1 << cat) - 1) : diff, cat);
    let run = 0;
    for (let i = 1; i < 64; i++) {
      const v = zz[i];
      if (v === 0) { run++; continue; }
      while (run > 15) { w.bits(ac.codes[0xf0], ac.sizes[0xf0]); run -= 16; }
      const c = category(v), sym = (run << 4) | c;
      w.bits(ac.codes[sym], ac.sizes[sym]);
      w.bits(v < 0 ? (v - 1) & ((1 << c) - 1) : v, c);
      run = 0;
    }
    if (run) w.bits(ac.codes[0], ac.sizes[0]);
    return zz[0];
  }

  /* data: RGBA Uint8ClampedArray; quality 1..100; subsampling '420' or '444'. */
  function encodeRGBA(data, width, height, quality = 85, subsampling = '420') {
    quality = Math.max(1, Math.min(100, Math.round(quality)));
    const qL = scaledTable(STD_LUM_Q, quality), qC = scaledTable(STD_CHR_Q, quality);
    const w = new BitWriter(width * height / 2 + 1024);
    const sub = subsampling === '420' ? 2 : 1, mcu = 8 * sub;
    const seg = (marker, body) => { w.bytes([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]); w.bytes(body); };
    w.bytes([0xff, 0xd8]);
    seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    seg(0xdb, [0, ...tableBytesZigzag(qL)]); seg(0xdb, [1, ...tableBytesZigzag(qC)]);
    seg(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, (sub << 4) | sub, 0, 2, 0x11, 1, 3, 0x11, 1]);
    seg(0xc4, [0x00, ...DC_LUM_BITS, ...DC_LUM_VAL]); seg(0xc4, [0x10, ...AC_LUM_BITS, ...AC_LUM_VAL]);
    seg(0xc4, [0x01, ...DC_CHR_BITS, ...DC_CHR_VAL]); seg(0xc4, [0x11, ...AC_CHR_BITS, ...AC_CHR_VAL]);
    seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

    const Y = new Float32Array(width * height), Cb = new Float32Array(width * height), Cr = new Float32Array(width * height);
    for (let i = 0, p = 0; i < width * height; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      Y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
      Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
    const block = new Float32Array(64), zz = new Int32Array(64);
    const sample = (plane, x0, y0, step) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let s = 0;
        for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) {
          const px = Math.min(width - 1, x0 + x * step + dx), py = Math.min(height - 1, y0 + y * step + dy);
          s += plane[py * width + px];
        }
        block[y * 8 + x] = s / (step * step);
      }
    };
    let dcY = 0, dcCb = 0, dcCr = 0;
    for (let my = 0; my < height; my += mcu) {
      for (let mx = 0; mx < width; mx += mcu) {
        for (let by = 0; by < sub; by++) for (let bx = 0; bx < sub; bx++) {
          sample(Y, mx + bx * 8, my + by * 8, 1); fdct(block, zz, qL); dcY = encodeBlock(w, zz, dcY, H_DC_L, H_AC_L);
        }
        sample(Cb, mx, my, sub); fdct(block, zz, qC); dcCb = encodeBlock(w, zz, dcCb, H_DC_C, H_AC_C);
        sample(Cr, mx, my, sub); fdct(block, zz, qC); dcCr = encodeBlock(w, zz, dcCr, H_DC_C, H_AC_C);
      }
    }
    w.flush();
    w.bytes([0xff, 0xd9]);
    return w.result();
  }

  function encodeCanvas(canvas, quality = 0.85, subsampling = '420') {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return encodeRGBA(img.data, canvas.width, canvas.height, Math.round(quality <= 1 ? quality * 100 : quality), subsampling);
  }

  /* Strip APP1..APP15 (EXIF/ICC/Adobe) from a foreign JPEG, keep JFIF. */
  function sanitize(jpeg) {
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
    const out = [jpeg.subarray(0, 2)]; let i = 2, stripped = false;
    while (i < jpeg.length - 1) {
      while (i < jpeg.length && jpeg[i] === 0xff && jpeg[i + 1] === 0xff) i++;
      if (jpeg[i] !== 0xff) break;
      const marker = jpeg[i + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) { out.push(jpeg.subarray(i)); break; }
      if (i + 4 > jpeg.length) break;
      const segEnd = i + 2 + ((jpeg[i + 2] << 8) | jpeg[i + 3]);
      if (segEnd > jpeg.length) break;
      if (marker >= 0xe1 && marker <= 0xef) { stripped = true; i = segEnd; continue; }
      out.push(jpeg.subarray(i, segEnd)); i = segEnd;
    }
    if (!stripped) return jpeg;
    return BS.util.concat(...out);
  }

  /* Parse SOF0 for dimensions and progressive detection. */
  function inspect(jpeg) {
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
    let i = 2, info = { width: 0, height: 0, progressive: false, restart: false, apps: [] };
    while (i < jpeg.length - 1) {
      if (jpeg[i] !== 0xff) { i++; continue; }
      const m = jpeg[i + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      if (m === 0xd9 || m === 0xda) break;
      const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) { info.height = (jpeg[i + 5] << 8) | jpeg[i + 6]; info.width = (jpeg[i + 7] << 8) | jpeg[i + 8]; info.progressive = m === 0xc2; }
      if (m === 0xdd) info.restart = true;
      if (m >= 0xe0 && m <= 0xef) info.apps.push(m);
      i += 2 + len;
    }
    return info;
  }

  BS.jpeg = { encodeRGBA, encodeCanvas, sanitize, inspect };
})(typeof window !== 'undefined' ? window : globalThis);
