/* Badge Studio — Jieli RCSP (AE00) and Qix (FD00) frame codecs.

   RCSP frame:  FE DC BA | flag | opcode | len(BE16) | body | EF
     flag 0xC0 command needing reply · 0x80 command/data without reply · 0x00 response
     command body = [serial, ...params] · response body = [status, serial, ...params]
   Qix frame:   9E | checksum | flag | cmd | len(LE16) | payload
     flag bits: 7 isRequest · 6-3 serial · 2 isLong · 1 needResponse · 0 isResponse */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { concat, hx } = BS.util;

  const UUID = {
    service: '0000ae00-0000-1000-8000-00805f9b34fb',
    tx: '0000ae01-0000-1000-8000-00805f9b34fb',
    rx: '0000ae02-0000-1000-8000-00805f9b34fb',
    battery: '0000180f-0000-1000-8000-00805f9b34fb',
    level: '00002a19-0000-1000-8000-00805f9b34fb',
    deviceInfo: '0000180a-0000-1000-8000-00805f9b34fb',
    qixService: 'c2e6fd00-e966-1000-8000-bef9c223df6a',
    qixControl: 'c2e6fd02-e966-1000-8000-bef9c223df6a',
    qixNotify: ['c2e6fd01-e966-1000-8000-bef9c223df6a', 'c2e6fd03-e966-1000-8000-bef9c223df6a', 'c2e6fd05-e966-1000-8000-bef9c223df6a'],
    qixShort: '0000fd00-0000-1000-8000-00805f9b34fb',
  };
  const NAME_PREFIXES = ['E01', 'E87', 'E92', 'L8', 'X9', 'LED Badge', 'EC-BADGE', 'BADGE'];

  const OP = {
    FEATURE_MAP: 0x02, TARGET_INFO: 0x03, RESET_AUTH: 0x06, SYS_INFO: 0x07, SYS_INFO_SET: 0x08,
    FILE_BROWSE: 0x0c, FILE_BROWSE_STOP: 0x0d,
    FILE_READ_BACK: 0x24, FILE_META: 0x1b, FILE_END: 0x1c, FILE_READ: 0x1d, FILE_ERROR: 0x1e, FILE_DELETE: 0x1f, FILE_NAME: 0x20, FILE_PREPARE: 0x21,
    DEVICE_FORMAT: 0x22, ONE_FILE_DELETE: 0x23, FILE_PARAMS: 0x27, SMALL_FILE: 0x28, DATA: 0x01,
  };
  const STATUS_NAMES = { 0: 'OK', 1: 'ERROR', 2: 'NO_SOPORTADO', 3: 'DATOS', 4: 'TIMEOUT', 5: 'RECHAZADO' };
  const DEV_HANDLERS = { 0: 'USB', 1: 'SD0', 2: 'SD1', 3: 'FLASH' };

  function commandFrame(op, params = [], needReply = true, serial = 0) {
    const p = params instanceof Uint8Array ? params : new Uint8Array(params), len = p.length + 1;
    return concat(new Uint8Array([0xfe, 0xdc, 0xba, 0x80 | (needReply ? 0x40 : 0), op, len >>> 8, len & 255, serial & 255]), p, new Uint8Array([0xef]));
  }
  function responseFrame(op, serial, status = 0, params = []) {
    const p = params instanceof Uint8Array ? params : new Uint8Array(params), len = p.length + 2;
    return concat(new Uint8Array([0xfe, 0xdc, 0xba, 0x00, op, len >>> 8, len & 255, status & 255, serial & 255]), p, new Uint8Array([0xef]));
  }

  /* Incremental parser: feed() returns the complete frames found so far. */
  class Parser {
    constructor() { this.buffer = []; }
    feed(bytes) {
      this.buffer.push(...bytes);
      const out = [];
      for (;;) {
        let i = -1;
        for (let k = 0; k + 2 < this.buffer.length; k++) if (this.buffer[k] === 0xfe && this.buffer[k + 1] === 0xdc && this.buffer[k + 2] === 0xba) { i = k; break; }
        if (i < 0) { this.buffer = this.buffer.slice(-2); break; }
        if (i) this.buffer.splice(0, i);
        if (this.buffer.length < 8) break;
        const len = this.buffer[5] * 256 + this.buffer[6];
        if (len > 16384) { this.buffer.shift(); continue; }
        const total = len + 8;
        if (this.buffer.length < total) break;
        if (this.buffer[total - 1] !== 0xef) { this.buffer.shift(); continue; }
        const flag = this.buffer[3], command = !!(flag & 0x80), min = command ? 1 : 2, p = this.buffer.slice(7, 7 + len);
        if (len >= min) out.push({ command, needsReply: !!(flag & 0x40), flag, opcode: this.buffer[4], serial: p[command ? 0 : 1], status: command ? null : p[0], parameter: new Uint8Array(p.slice(min)), raw: new Uint8Array(this.buffer.slice(0, total)) });
        this.buffer.splice(0, total);
      }
      return out;
    }
  }

  /* 0x07 sys-info response: [function][len type data...]. Parses TLV attrs. */
  const SYSINFO_NAMES = { 0: 'battery', 1: 'volume', 2: 'eq', 3: 'mode', 4: 'file_pos', 5: 'fm', 6: 'rtc', 7: 'brightness', 8: 'storage', 9: 'play_state' };
  /* ATTR_TYPE_* from JL_rcsp_protocol.h (official) */
  const TARGET_NAMES = { 0: 'protocol_version', 1: 'sys_info', 2: 'edr_addr', 3: 'platform', 4: 'function_info', 5: 'dev_version', 6: 'sdk_type', 7: 'uboot_version', 8: 'double_partition', 9: 'update_status', 10: 'vid_pid', 11: 'auth_key', 12: 'procode', 13: 'max_mtu', 14: 'function_mask', 15: 'sdk_type2', 16: 'ui_version', 17: 'ble_addr', 18: 'peripherals', 19: 'md5_game_support', 31: 'customer' };
  /* JLChipFlag from the Android SDK: what sdk_type means */
  const CHIP_FLAGS = { 0: 'AC692x AI soundbox', 1: 'AC692x soundbox', 2: 'AC693x TWS headset', 3: 'AC695x charging bin', 4: 'AC697x TWS headset', 5: 'AC696x soundbox', 6: 'AC696x TWS soundbox', 7: 'AC695x sound card', 8: 'AC695x watch', 9: 'AC701x watch', 10: 'earphone (manifest)', 11: 'soundbox (manifest)', 12: 'color-screen charging case', 13: 'AC707N watch / badge (BR35)', 14: 'dongle', 254: 'common SDK' };
  function parseTLV(payload, names) {
    const out = []; let i = 0;
    while (i < payload.length) {
      const len = payload[i]; if (len < 1) break;
      const type = payload[i + 1], data = payload.slice(i + 2, i + 1 + len);
      if (i + 1 + len > payload.length) break;
      out.push({ type, name: names[type] || ('attr_' + type), data, hex: hx(data), decoded: decodeAttr(type, data, names) });
      i += len + 1;
    }
    return out;
  }
  function ascii(data) { for (const b of data) if (b < 0x20 || b > 0x7e) return null; return new TextDecoder().decode(data); }
  function decodeAttr(type, data, names) {
    if (!data.length) return '';
    if (names === TARGET_NAMES) {
      if ((type === 2 || type === 17) && data.length >= 6) return Array.from(data.slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join(':') + (data.length > 6 ? ' +' + hx(data.slice(6)) : '');
      if (type === 10 && data.length >= 4) return 'vid=0x' + ((data[0] << 8) | data[1]).toString(16) + ' pid=0x' + ((data[2] << 8) | data[3]).toString(16);
      if (type === 13 && data.length >= 2) return 'mtu=' + ((data[0] << 8) | data[1]);
      if (type === 6 && data.length === 1) return data[0] + ' = ' + (CHIP_FLAGS[data[0]] || 'desconocido');
      if (type === 5 && data.length === 2) return data[0] + '.' + data[1];
      if (type === 0 && data.length === 1) return 'v' + data[0];
      if (type === 11) return hx(data);
    } else if (type === 0 && data.length === 1) return data[0] + '%';
    const a = ascii(data); if (a) return a;
    if (data.length === 1) return String(data[0]);
    if (data.length === 2) return String((data[0] << 8) | data[1]);
    if (data.length === 4) return String(BS.util.readU32BE(data));
    return hx(data);
  }
  /* 0x07 reply, attribute type 2 (COMMON_INFO_ATTR_DEV): storage table.
     Old layout (what the E01 answers): [onlineBits][USB h32][SD0 h32][SD1 h32][FLASH h32][idx5 h32][reuse]
     bit i of onlineBits = device i present. Handles are the devHandle used by 0x27 / 0x0C / 0x1F. */
  const STORAGE_NAMES = ['USB', 'SD0', 'SD1', 'FLASH', 'DEV4', 'DEV5'];
  function parseStorageInfo(p) {
    if (p.length < 3) return [];
    let i = 1;
    while (i < p.length) {
      const len = p[i]; if (len < 1 || i + 1 + len > p.length) return [];
      if (p[i + 1] === 2) {
        const d = p.slice(i + 2, i + 1 + len);
        if (!d.length || d[0] === 0xff) return [];
        const out = []; let o = 1;
        for (let idx = 0; idx < 6; idx++) {
          const entry = { index: idx, name: STORAGE_NAMES[idx], online: !!(d[0] & (1 << idx)), handle: null };
          if (idx !== 4 && o + 4 <= d.length) { entry.handle = BS.util.readU32BE(d, o); o += 4; }
          out.push(entry);
        }
        return out;
      }
      i += len + 1;
    }
    return [];
  }
  /* E01 path: the handle of SD1 (index 2), the storage the badge writes media to. */
  function parseStorageHandle(p) { const e = parseStorageInfo(p).find((x) => x.index === 2 && x.online); return e && e.handle !== null ? e.handle : null; }

  /* File browse (0x0C), PathData.toData() from the Jieli Android SDK:
     [type][readNum][startIndex BE16][devHandle BE32][pathLen BE16][clusters BE32...]   type 0 = folders, 1 = files */
  function fileBrowseParam(type, readNum, startIndex, devHandler, clusters = [0]) {
    const path = concat(...clusters.map((c) => BS.util.u32be(c)));
    return concat(new Uint8Array([type & 255, readNum & 255]), BS.util.u16be(startIndex), BS.util.u32be(devHandler), BS.util.u16be(path.length), path);
  }
  /* The entries do not travel in the 0x0C reply (that only carries totalFile); the badge streams them as
     DATA (0x01) frames whose first byte is 0x0C, then sends 0x0D (stop, reason). FileStruct layout:
     [flags][cluster BE32][fileNum BE16][nameLen][name]  flags: bit0 file · bit1 NOT unicode (GBK) · bits2-6 devIndex */
  function parseFileStructs(data) {
    const entries = []; let i = 0;
    while (i + 8 <= data.length) {
      const flags = data[i], cluster = BS.util.readU32BE(data, i + 1), fileNum = BS.util.readU16BE(data, i + 5), nameLen = data[i + 7];
      if (i + 8 + nameLen > data.length) break;
      const raw = data.slice(i + 8, i + 8 + nameLen), unicode = !(flags & 2);
      let name;
      try { name = unicode ? new TextDecoder('utf-16le').decode(raw) : new TextDecoder('gbk').decode(raw); } catch { name = new TextDecoder().decode(raw); }
      name = name.replace(/\0+$/, '');
      entries.push({ name, isFile: !!(flags & 1), unicode, devIndex: (flags & 0x7c) >> 2, cluster, fileNum });
      i += 8 + nameLen;
    }
    return entries;
  }
  function parseBrowseTotal(p) { if (!p.length) return 0; if (p.length === 1) return p[0]; if (p.length === 2) return BS.util.readU16BE(p); return BS.util.readU32BE(p); }
  /* 0x1F DelDevFileParam: [last][devHandle BE32][type (1 = file)][cluster BE32] */
  function deleteByClusterParam(devHandle, isFile, cluster, last = true) { return concat(new Uint8Array([last ? 1 : 0]), BS.util.u32be(devHandle), new Uint8Array([isFile ? 1 : 0]), BS.util.u32be(cluster)); }
  /* 0x24 ReadFileFromDeviceCmd (ONE_FILE_TRANS_BACK), op byte first:
       1 start by cluster  [1][devHandle BE32][offset BE32][cluster BE32]
       2 start by name     [2][devHandle BE32][offset BE32][unicode][name]   name: "\\U" + UTF-16LE + 00 00, or GBK/ASCII
       0x81 cancel [0x81][reason] (phone → badge) · 0x80 stop [0x80][ret] (badge → phone)
     reply to start: [op][size BE32] · data arrives as DATA frames [0x24][offset BE32][crc16?][bytes] */
  function readFileByClusterParam(devHandle, cluster, offset = 0) { return concat(new Uint8Array([1]), BS.util.u32be(devHandle), BS.util.u32be(offset), BS.util.u32be(cluster)); }
  function readFileByNameParam(devHandle, name, unicode = false, offset = 0) {
    let nameData;
    if (unicode) { const u = new Uint8Array(name.length * 2); for (let i = 0; i < name.length; i++) { u[i * 2] = name.charCodeAt(i) & 255; u[i * 2 + 1] = name.charCodeAt(i) >> 8; } nameData = concat(new TextEncoder().encode('\\U'), u, new Uint8Array(2)); }
    else nameData = new TextEncoder().encode(name);
    return concat(new Uint8Array([2]), BS.util.u32be(devHandle), BS.util.u32be(offset), new Uint8Array([unicode ? 1 : 0]), nameData);
  }
  const READ_CANCEL = (reason = 0) => new Uint8Array([0x81, reason & 255]);
  function parseReadStart(p) { return p.length >= 5 ? BS.util.readU32BE(p, 1) : p.length >= 4 ? BS.util.readU32BE(p, 0) : 0; }
  /* Locate the first complete JPEG (FF D8 … FF D9) inside a byte stream (AVI movi chunk or raw JPEG). */
  function firstJpeg(bytes) {
    let start = -1;
    for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) { start = i; break; }
    if (start < 0) return null;
    for (let i = start + 2; i + 1 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return bytes.slice(start, i + 2);
    return null;
  }

  /* 0x23 DeleteFileByNameCmd: [0x00][ASCII name] */
  function deleteByNameParam(name) { return concat(new Uint8Array([0]), new TextEncoder().encode(name)); }

  /* ---- Qix (0x9E) ---- */
  function qixFrame(cmd, payload, flag) {
    const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const inner = concat(new Uint8Array([flag & 255, cmd & 255, p.length & 255, (p.length >> 8) & 255]), p);
    let chk = 0; for (const b of inner) chk = (chk + b) & 255;
    return concat(new Uint8Array([0x9e, chk]), inner);
  }
  function parseQix(raw) {
    if (raw.length < 6 || raw[0] !== 0x9e) return null;
    const plen = raw[4] | (raw[5] << 8);
    if (raw.length < 6 + plen) return null;
    return { cmd: raw[3], flag: raw[2], payload: raw.slice(6, 6 + plen), isResponse: !!(raw[2] & 1) };
  }
  const QIX = { BATTERY_REQ: 0x29, BATTERY_RET: 0x27, SCREEN_REQ: 0xc6, SCREEN_RET: 0xc7, LANGUAGE: 0x16, SETTING: 0x20, TIME: 0x45 };
  function qixTimeFrame(d = new Date()) {
    const y = d.getFullYear();
    return new Uint8Array([0x9e, 0x45, 0x08, 0x02, 0x07, 0x00, y & 255, (y >> 8) & 255, d.getMonth() + 1, d.getDate(), 0x00, d.getHours(), d.getMinutes()]);
  }
  const QIX_HEARTBEAT = new Uint8Array([0x9e, 0xb5, 0x0b, 0x29, 0x01, 0x00, 0x80]);

  /* UTF-16LE device path used by Zrun/E87 firmware in the 0x20 reply. */
  function utf16Path(name) {
    const s = '啜' + name; const out = new Uint8Array(s.length * 2 + 2);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[i * 2] = c & 255; out[i * 2 + 1] = c >> 8; }
    return out;
  }
  function timestampName(ext) { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()) + '.' + ext; }

  BS.rcsp = { UUID, NAME_PREFIXES, OP, STATUS_NAMES, DEV_HANDLERS, commandFrame, responseFrame, Parser, parseTLV, SYSINFO_NAMES, TARGET_NAMES, CHIP_FLAGS, parseStorageHandle, parseStorageInfo, STORAGE_NAMES, fileBrowseParam, parseFileStructs, parseBrowseTotal, deleteByClusterParam, deleteByNameParam, readFileByClusterParam, readFileByNameParam, READ_CANCEL, parseReadStart, firstJpeg, qixFrame, parseQix, QIX, qixTimeFrame, QIX_HEARTBEAT, utf16Path, timestampName };
})(typeof window !== 'undefined' ? window : globalThis);
