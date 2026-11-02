'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const BS = require('./helpers/load.js');

test('crc16 xmodem matches the reference vector', () => {
  assert.equal(BS.util.crc16(new TextEncoder().encode('123456789')), 0x31c3);
});

test('jl auth cipher is deterministic and 16 bytes', () => {
  const a = BS.jlAuth.encrypt16(new Uint8Array(16)), b = BS.jlAuth.encrypt16(new Uint8Array(16));
  assert.equal(a.length, 16); assert.deepEqual(Array.from(a), Array.from(b));
  assert.equal(BS.util.hx(a), '9E 43 DF 37 7B 3A 46 CE 75 16 34 66 7E 21 5D E5');
});

test('rcsp frames round-trip through the parser', () => {
  const R = BS.rcsp, parser = new R.Parser();
  const cmd = R.commandFrame(0x1b, [1, 2, 3], true, 9), resp = R.responseFrame(0x21, 4, 0, [7]);
  const frames = parser.feed(BS.util.concat(new Uint8Array([0xaa]), cmd, resp.slice(0, 5)));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].opcode, 0x1b); assert.equal(frames[0].serial, 9); assert.equal(frames[0].command, true); assert.deepEqual(Array.from(frames[0].parameter), [1, 2, 3]);
  const rest = parser.feed(resp.slice(5));
  assert.equal(rest.length, 1); assert.equal(rest[0].command, false); assert.equal(rest[0].status, 0); assert.equal(rest[0].serial, 4); assert.deepEqual(Array.from(rest[0].parameter), [7]);
});

test('qix frames carry a valid checksum and parse back', () => {
  const f = BS.rcsp.qixFrame(0x29, [0x80], 0x0a);
  assert.equal(f[0], 0x9e);
  let chk = 0; for (const b of f.slice(2)) chk = (chk + b) & 255;
  assert.equal(f[1], chk);
  const q = BS.rcsp.parseQix(f);
  assert.equal(q.cmd, 0x29); assert.deepEqual(Array.from(q.payload), [0x80]);
});

test('jpeg encoder produces baseline JFIF with standard tables', () => {
  const w = 48, h = 32, d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = 200; d[i * 4 + 1] = 40; d[i * 4 + 2] = 90; d[i * 4 + 3] = 255; }
  const j = BS.jpeg.encodeRGBA(d, w, h, 80);
  const info = BS.jpeg.inspect(j);
  assert.equal(j[0], 0xff); assert.equal(j[1], 0xd8); assert.equal(j[j.length - 1], 0xd9);
  assert.equal(info.width, 48); assert.equal(info.height, 32); assert.equal(info.progressive, false); assert.deepEqual(info.apps, [0xe0]);
  let dht = 0; for (let i = 0; i < j.length - 1; i++) if (j[i] === 0xff && j[i + 1] === 0xc4) dht++;
  assert.equal(dht, 4);
});

test('jpeg sanitize strips EXIF/ICC but keeps JFIF', () => {
  const j = BS.jpeg.encodeRGBA(new Uint8ClampedArray(16 * 16 * 4), 16, 16, 50);
  const exif = BS.util.concat(new Uint8Array([0xff, 0xe1, 0, 6, 1, 2, 3, 4]));
  const polluted = BS.util.concat(j.slice(0, 2), exif, j.slice(2));
  assert.deepEqual(BS.jpeg.inspect(polluted).apps, [0xe1, 0xe0]);
  const clean = BS.jpeg.sanitize(polluted);
  assert.deepEqual(BS.jpeg.inspect(clean).apps, [0xe0]);
  assert.deepEqual(Array.from(clean), Array.from(j));
});

test('avi builder output validates and exposes frames', () => {
  const frame = BS.jpeg.encodeRGBA(new Uint8ClampedArray(368 * 368 * 4), 368, 368, 60);
  const avi = BS.avi.build([frame, frame, frame], 368, 368, 12);
  const info = BS.avi.inspect(avi);
  assert.equal(info.frames, 3); assert.equal(info.fps, 12); assert.equal(info.width, 368);
  assert.equal(BS.avi.frames(avi).length, 3);
  assert.throws(() => BS.avi.inspect(avi.slice(0, 100)), /AVI/);
});

test('gif encode/decode round trip keeps size, frames and delays', () => {
  const w = 20, h = 10, mk = (c) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = c; d[i * 4 + 1] = 255 - c; d[i * 4 + 2] = 30; d[i * 4 + 3] = 255; } return d; };
  const g = BS.gif.encode([{ data: mk(10), width: w, height: h, delay: 80 }, { data: mk(240), width: w, height: h, delay: 120 }], { loop: 0 });
  const dec = BS.gif.decode(g);
  assert.equal(dec.width, 20); assert.equal(dec.frames.length, 2); assert.equal(dec.frames[0].delay, 80); assert.equal(dec.frames[1].delay, 120);
  assert.ok(Math.abs(dec.frames[1].data[0] - 240) < 8);
});

test('file name helpers produce 8.3 names', () => {
  const u = BS.util;
  assert.equal(u.sanitizeName('mi animación.avi'), 'MIANIMAC.AVI');
  assert.equal(u.sanitizeName('', 'JPG'), 'BADGE001.JPG');
  assert.equal(u.renamedFile('BADGE001', 1), 'BADGE002.AVI');
  assert.equal(u.renamedFile('ARTE', 3), 'ARTE003.AVI');
  assert.equal(u.nextFileName('BADGE009.AVI'), 'BADGE010.AVI');
});
