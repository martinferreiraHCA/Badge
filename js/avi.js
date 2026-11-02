/* Badge Studio — RIFF AVI (MJPEG) builder and validator.
   The E01 plays single-stream MJPEG AVIs without audio. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { concat, le16, le32 } = BS.util;

  const fourcc = (s) => new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
  const padEven = (a) => (a.length % 2 ? concat(a, new Uint8Array([0])) : a);
  const chunk = (id, data) => concat(fourcc(id), le32(data.length), padEven(data));
  function list(type, ...children) { const body = concat(fourcc(type), ...children); return concat(fourcc('LIST'), le32(body.length), padEven(body)); }

  function build(jpegs, width, height, fps = 10) {
    if (!jpegs.length) throw new Error('Sin cuadros para el AVI.');
    const maxFrame = Math.max(...jpegs.map((x) => x.length)), total = jpegs.length;
    const rate = Math.round(fps * 1000), scale = 1000;
    const avih = new Uint8Array(56); let dv = new DataView(avih.buffer);
    dv.setUint32(0, Math.round(1e6 / fps), true); dv.setUint32(4, maxFrame * fps, true); dv.setUint32(12, 0x10, true);
    dv.setUint32(16, total, true); dv.setUint32(24, 1, true); dv.setUint32(28, maxFrame, true);
    dv.setUint32(32, width, true); dv.setUint32(36, height, true);

    const strh = new Uint8Array(56); dv = new DataView(strh.buffer);
    strh.set(fourcc('vids'), 0); strh.set(fourcc('MJPG'), 4);
    dv.setUint32(20, scale, true); dv.setUint32(24, rate, true); dv.setUint32(32, total, true);
    dv.setUint32(36, maxFrame, true); dv.setUint32(40, 0xffffffff, true);
    dv.setInt16(48, 0, true); dv.setInt16(50, 0, true); dv.setInt16(52, width, true); dv.setInt16(54, height, true);

    const strf = new Uint8Array(40); dv = new DataView(strf.buffer);
    dv.setUint32(0, 40, true); dv.setInt32(4, width, true); dv.setInt32(8, height, true);
    dv.setUint16(12, 1, true); dv.setUint16(14, 24, true); strf.set(fourcc('MJPG'), 16);
    dv.setUint32(20, width * height * 3, true);

    const hdrl = list('hdrl', chunk('avih', avih), list('strl', chunk('strh', strh), chunk('strf', strf)));
    const frameChunks = [], indexEntries = []; let moviOffset = 4;
    for (const jpg of jpegs) {
      const fc = chunk('00dc', jpg); frameChunks.push(fc);
      const ent = new Uint8Array(16), edv = new DataView(ent.buffer);
      ent.set(fourcc('00dc'), 0); edv.setUint32(4, 0x10, true); edv.setUint32(8, moviOffset, true); edv.setUint32(12, jpg.length, true);
      indexEntries.push(ent); moviOffset += fc.length;
    }
    const movi = list('movi', ...frameChunks), idx1 = chunk('idx1', concat(...indexEntries));
    const riffBody = concat(fourcc('AVI '), hdrl, movi, idx1);
    return concat(fourcc('RIFF'), le32(riffBody.length), riffBody);
  }

  const MAX_BYTES = 25 * 1024 * 1024;
  function inspect(a, sizes = [360, 368, 240]) {
    if (!(a instanceof Uint8Array) || a.length < 64 || a.length > MAX_BYTES) throw new Error('AVI vacío, inválido o mayor a 25 MB.');
    const dv = new DataView(a.buffer, a.byteOffset, a.byteLength), str = (o, n) => String.fromCharCode(...a.slice(o, o + n));
    if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'AVI ' || dv.getUint32(4, true) + 8 !== a.length) throw new Error('Se requiere un archivo RIFF AVI completo.');
    let avih = null, strh = null, strf = null, frames = 0, first = null, streams = 0;
    const frameList = [];
    function walk(start, end, depth = 0) {
      if (depth > 5) throw new Error('Estructura AVI inválida.');
      let o = start;
      while (o + 8 <= end) {
        const id = str(o, 4), len = dv.getUint32(o + 4, true), data = o + 8, stop = data + len;
        if (stop > end || stop > a.length) throw new Error('AVI truncado.');
        if (id === 'LIST') { if (len < 4) throw new Error('Lista AVI inválida.'); walk(data + 4, stop, depth + 1); }
        else if (id === 'avih' && len >= 56) avih = data;
        else if (id === 'strh' && len >= 56) { streams++; strh = data; }
        else if (id === 'strf' && len >= 40) strf = data;
        else if (/^\d\d(dc|db)$/.test(id)) {
          if (len < 4 || a[data] !== 255 || a[data + 1] !== 216) throw new Error('El AVI no contiene cuadros JPEG.');
          frames++; frameList.push([data, stop]); if (first === null) first = a.slice(data, stop);
        }
        o = stop + (len & 1);
      }
      if (o !== end) throw new Error('Alineación AVI inválida.');
    }
    walk(12, a.length);
    if (!avih || !strh || !strf || streams !== 1 || !frames || str(strh, 4) !== 'vids' || str(strh + 4, 4) !== 'MJPG' || str(strf + 16, 4) !== 'MJPG') throw new Error('Usá AVI MJPEG con una única pista de video y sin audio.');
    const width = dv.getInt32(strf + 4, true), height = dv.getInt32(strf + 8, true), rate = dv.getUint32(strh + 24, true), scale = dv.getUint32(strh + 20, true), fps = rate / scale;
    if (!sizes.includes(width) || height !== width) throw new Error('El AVI debe ser cuadrado: ' + sizes.join(', ') + ' px.');
    if (!Number.isFinite(fps) || fps <= 0 || fps > 30 || dv.getUint32(avih + 16, true) !== frames || dv.getUint32(strh + 32, true) !== frames) throw new Error('Duración o índice de cuadros AVI inconsistente.');
    return { width, height, fps, frames, first, frameList };
  }

  /* Extract every JPEG frame (for previews of imported AVIs). */
  function frames(a) { const info = inspect(a); return info.frameList.map(([s, e]) => a.slice(s, e)); }

  BS.avi = { build, inspect, frames, MAX_BYTES };
})(typeof window !== 'undefined' ? window : globalThis);
