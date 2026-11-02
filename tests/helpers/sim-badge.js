'use strict';
/* A simulated E01 badge exposing the Web Bluetooth object shape the client
   needs: device.gatt.connect(), services, characteristics, notifications.
   It performs the Jieli auth handshake and the device-driven upload flow. */
const BS = globalThis.BS;
const { concat, crc16, readU32BE } = BS.util;
const R = BS.rcsp;

class FakeCharacteristic extends EventTarget {
  constructor(uuid, props, badge) { super(); this.uuid = uuid; this.properties = Object.assign({ write: false, writeWithoutResponse: false, notify: false, read: false }, props); this.badge = badge; this.value = null; this.notifying = false; }
  async startNotifications() { this.notifying = true; return this; }
  async writeValueWithoutResponse(bytes) { await this.badge.onWrite(this.uuid, new Uint8Array(bytes)); }
  async writeValueWithResponse(bytes) { await this.badge.onWrite(this.uuid, new Uint8Array(bytes)); }
  async readValue() { return new DataView(new Uint8Array([this.badge.battery]).buffer); }
  notify(bytes) { this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.dispatchEvent(new Event('characteristicvaluechanged')); }
}
class FakeService {
  constructor(uuid, chars) { this.uuid = uuid; this.chars = chars; }
  async getCharacteristic(uuid) { const c = this.chars.find((x) => x.uuid === uuid); if (!c) throw new Error('No characteristic ' + uuid); return c; }
  async getCharacteristics() { return this.chars; }
}

class SimBadge extends EventTarget {
  constructor({ name = 'E01-TEST', packetSize = 490, withCRC = true, window = 8, storageHandle = 0x02000000, qix = false, renameCollisions = 0 } = {}) {
    super();
    this.name = name; this.id = 'sim-' + name; this.packetSize = packetSize; this.withCRC = withCRC; this.window = window; this.storageHandle = storageHandle;
    this.battery = 77; this.renameCollisions = renameCollisions; this.files = []; this.folders = {}; this.emptyTotal = false; this.log = [];
    this.tx = new FakeCharacteristic(R.UUID.tx, { writeWithoutResponse: true }, this);
    this.rx = new FakeCharacteristic(R.UUID.rx, { notify: true }, this);
    this.level = new FakeCharacteristic(R.UUID.level, { read: true, notify: true }, this);
    this.services = [new FakeService(R.UUID.service, [this.tx, this.rx]), new FakeService(R.UUID.battery, [this.level])];
    if (qix) { this.control = new FakeCharacteristic(R.UUID.qixControl, { writeWithoutResponse: true }, this); this.qixNotify = new FakeCharacteristic(R.UUID.qixNotify[0], { notify: true }, this); this.services.push(new FakeService(R.UUID.qixService, [this.control, this.qixNotify])); }
    this.parser = new R.Parser(); this.auth = 'idle'; this.serial = 0; this.transfer = null; this.inbound = [];
    const badge = this;
    this.gatt = { connected: false, async connect() { this.connected = true; return this; }, disconnect() { this.connected = false; badge.dispatchEvent(new Event('gattserverdisconnected')); }, async getPrimaryService(uuid) { const s = badge.services.find((x) => x.uuid === uuid); if (!s) { const e = new Error('No service ' + uuid); e.name = 'NotFoundError'; throw e; } return s; }, async getPrimaryServices() { return badge.services; } };
  }
  send(bytes) { setTimeout(() => this.rx.notify(bytes), 0); }
  cmd(op, params, needReply = true) { const sn = this.serial++ & 255; this.send(R.commandFrame(op, params, needReply, sn)); return sn; }
  async onWrite(uuid, bytes) {
    if (uuid === R.UUID.qixControl) { this.onQix(bytes); return; }
    this.inbound.push(bytes);
    if (this.auth !== 'done') { this.handleAuth(bytes); return; }
    for (const f of this.parser.feed(bytes)) await this.handleFrame(f);
  }
  handleAuth(bytes) {
    if (this.auth === 'idle' && bytes[0] === 0 && bytes.length === 17) { this.auth = 'phone'; this.send(concat(new Uint8Array([1]), BS.jlAuth.encrypt16(bytes.slice(1)))); return; }
    if (this.auth === 'phone' && bytes.length === 5 && bytes[0] === 2) { this.auth = 'device'; this.challenge = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 255); this.send(concat(new Uint8Array([0]), this.challenge)); return; }
    if (this.auth === 'device' && bytes[0] === 1 && bytes.length === 17) {
      const expected = BS.jlAuth.encrypt16(this.challenge);
      if (expected.every((b, i) => b === bytes[i + 1])) { this.auth = 'done'; this.send(new Uint8Array([2, 112, 97, 115, 115])); } else this.log.push('auth mismatch');
    }
  }
  reply(f, status = 0, params = []) { this.send(R.responseFrame(f.opcode, f.serial, status, params)); }
  async handleFrame(f) {
    this.log.push((f.command ? 'C' : 'R') + ' 0x' + f.opcode.toString(16));
    if (!f.command) { this.onResponse(f); return; }
    const p = f.parameter;
    switch (f.opcode) {
      case R.OP.FEATURE_MAP: return this.reply(f, 2);
      case R.OP.TARGET_INFO: return this.reply(f, 0, concat(new Uint8Array([4, 3]), new TextEncoder().encode('E01'), new Uint8Array([7, 2, 1, 2, 3, 4, 5, 6]), new Uint8Array([3, 13, 2, 0])));
      case R.OP.SYS_INFO: {
        const d = new Uint8Array(22); d[0] = 4 | 8; d.set(BS.util.u32be(this.storageHandle), 9); d.set(BS.util.u32be(0x03000000), 13);
        const attr2 = concat(new Uint8Array([d.length + 1, 2]), d), batt = new Uint8Array([2, 0, this.battery]), light = new Uint8Array([2, 7, 60]);
        return this.reply(f, 0, concat(new Uint8Array([p[0]]), batt, attr2, light));
      }
      case R.OP.SYS_INFO_SET: this.brightness = p[3]; return this.reply(f, 0);
      case R.OP.FILE_BROWSE: {
        // param: [type][readNum][start BE16][dev BE32][pathLen BE16][clusters]
        const type = p[0], readNum = p[1], start = (p[2] << 8) | p[3], dev = readU32BE(p, 4), pathLen = (p[8] << 8) | p[9];
        const clusters = []; for (let i = 0; i < pathLen; i += 4) clusters.push(readU32BE(p, 10 + i));
        if (dev !== this.storageHandle || type !== 0) return this.reply(f, 5);
        this.log.push('browse ' + clusters.join('/') + ' start=' + start + ' n=' + readNum);
        const inFolder = clusters.length > 1 ? this.folders[clusters[clusters.length - 1]] : null;
        if (clusters.length > 1 && !inFolder) return this.reply(f, 3);
        const names = inFolder ? inFolder.files : this.files;
        const list = names.map((n, i) => ({ name: n, isFile: true, cluster: (inFolder ? 1000 : 100) + 1 + i })).concat(inFolder ? [] : Object.entries(this.folders).map(([c, fo]) => ({ name: fo.name, isFile: false, cluster: +c })));
        const slice = list.slice(start - 1, start - 1 + readNum);
        this.reply(f, 0, this.emptyTotal ? [] : [list.length]);
        setTimeout(() => {
          const structs = slice.map((e) => { const raw = new TextEncoder().encode(e.name); return concat(new Uint8Array([(e.isFile ? 1 : 0) | 2 | (2 << 2)]), BS.util.u32be(e.cluster), new Uint8Array([0, 1]), new Uint8Array([raw.length]), raw); });
          const data = concat(...structs);
          for (let o = 0; o < data.length; o += 40) this.send(R.commandFrame(R.OP.DATA, concat(new Uint8Array([R.OP.FILE_BROWSE]), data.slice(o, o + 40)), false, this.serial++ & 255));
          setTimeout(() => this.cmd(R.OP.FILE_BROWSE_STOP, [0]), 5);
        }, 2);
        return;
      }
      case R.OP.FILE_READ_BACK: {
        const op = p[0];
        if (op === 0x81) { this.reply(f, 0); if (this.reading) { this.reading.cancelled = true; setTimeout(() => this.cmd(R.OP.FILE_READ_BACK, [0x80, 0]), 2); } return; }
        let name = null, start = 0;
        if (op === 1) { const cluster = readU32BE(p, 9); start = readU32BE(p, 5); const idx = cluster - 101; name = this.files[idx]; }
        else if (op === 2) { start = readU32BE(p, 5); name = new TextDecoder().decode(p.slice(10)).replace(/\0+$/, ''); }
        const data = name && this.contents && this.contents[name];
        if (!data) return this.reply(f, 3);
        this.reply(f, 0, concat(new Uint8Array([op]), BS.util.u32be(data.length)));
        const r = this.reading = { cancelled: false }; let off = start; const windowEnd = this.readWindow ? start + this.readWindow : Infinity;
        const pump = () => { if (r.cancelled) return; if (off >= data.length || off >= windowEnd) { this.reading = null; this.cmd(R.OP.FILE_READ_BACK, [0x80, 0]); return; } const part = data.slice(off, Math.min(off + 544, windowEnd)), c = crc16(part); this.send(R.commandFrame(R.OP.DATA, concat(new Uint8Array([R.OP.FILE_READ_BACK]), BS.util.u32be(off), new Uint8Array([c >> 8, c & 255]), part), false, this.serial++ & 255)); off += part.length; setTimeout(pump, 1); };
        setTimeout(pump, 2);
        return;
      }
      case R.OP.DEVICE_FORMAT: { if (readU32BE(p, 0) !== this.storageHandle) return this.reply(f, 5); this.deleted = (this.deleted || []).concat(this.files.splice(0)); this.folders = {}; return this.reply(f, 0, [0]); }
      case R.OP.FILE_DELETE: {
        const dev = readU32BE(p, 1), cluster = readU32BE(p, 6);
        if (dev !== this.storageHandle) return this.reply(f, 5);
        if (cluster > 1000) { const fo = Object.values(this.folders)[0]; const j = cluster - 1001; if (!fo || j >= fo.files.length) return this.reply(f, 3); this.deleted = (this.deleted || []).concat(fo.files.splice(j, 1)); return this.reply(f, 0); }
        const idx = cluster - 101; if (idx < 0 || idx >= this.files.length) return this.reply(f, 3);
        this.deleted = (this.deleted || []).concat(this.files.splice(idx, 1)); return this.reply(f, 0);
      }
      case R.OP.ONE_FILE_DELETE: {
        const name = new TextDecoder().decode(p.slice(1)), idx = this.files.indexOf(name);
        if (idx < 0) return this.reply(f, 3);
        this.deleted = (this.deleted || []).concat(this.files.splice(idx, 1)); return this.reply(f, 0);
      }
      case R.OP.FILE_BROWSE_STOP: return this.reply(f, 0);
      case R.OP.FILE_PREPARE: return this.reply(f, 0);
      case R.OP.FILE_PARAMS: return this.reply(f, 0, [0, this.withCRC ? 1 : 0]);
      case R.OP.FILE_META: {
        const size = readU32BE(p, 0), crc = (p[4] << 8) | p[5];
        this.transfer = { size, crc, data: new Uint8Array(size), got: 0, offset: 0, window: this.window * this.packetSize };
        this.reply(f, 0, [this.packetSize >> 8, this.packetSize & 255]);
        setTimeout(() => this.requestWindow(), 2);
        return;
      }
      case R.OP.DATA: return this.onData(p);
      default: return this.reply(f, 2);
    }
  }
  requestWindow() {
    const t = this.transfer; if (!t) return;
    const len = Math.min(t.window, t.size - t.offset);
    this.cmd(R.OP.FILE_READ, concat(new Uint8Array([0, len >> 8, len & 255]), BS.util.u32be(t.offset)), false);
    t.expect = len; t.expectIndex = 0; t.windowGot = 0;
  }
  onData(p) {
    const t = this.transfer; if (!t) return;
    const hasCRC = this.withCRC, head = hasCRC ? 4 : 2, part = p.slice(head);
    if (p[0] !== R.OP.FILE_READ || p[1] !== (t.expectIndex & 255)) { this.log.push('bad data index ' + p[1]); return; }
    if (hasCRC && ((p[2] << 8) | p[3]) !== crc16(part)) { this.log.push('bad crc'); this.cmd(R.OP.FILE_ERROR, [3], false); return; }
    t.data.set(part, t.offset + t.windowGot); t.windowGot += part.length; t.expectIndex++;
    if (t.windowGot >= t.expect) {
      t.offset += t.expect; t.got = t.offset;
      if (t.offset >= t.size) { if (crc16(t.data) !== t.crc) { this.log.push('file crc mismatch'); this.cmd(R.OP.FILE_END, [3]); } else this.cmd(R.OP.FILE_NAME, []); }
      else setTimeout(() => this.requestWindow(), 1);
    }
  }
  onResponse(f) {
    if (f.opcode === R.OP.FILE_NAME) {
      const name = new TextDecoder().decode(f.parameter).replace(/\0+$/, '');
      if (this.renameCollisions > 0) { this.renameCollisions--; this.cmd(R.OP.FILE_NAME, []); return; }
      this.files.push(name); this.transfer.name = name; (this.contents = this.contents || {})[name] = this.transfer.data; this.cmd(R.OP.FILE_END, [0]);
    } else if (f.opcode === R.OP.FILE_END) { this.received = this.transfer; this.transfer = null; this.dispatchEvent(new Event('sim-complete')); }
  }
  onQix(bytes) {
    const q = R.parseQix(bytes); if (!q) { this.log.push('qix raw ' + bytes[1].toString(16)); return; }
    this.log.push('qix 0x' + q.cmd.toString(16));
    const respond = (cmd, payload) => setTimeout(() => this.qixNotify.notify(R.qixFrame(cmd, payload, 0x01)), 0);
    if (q.cmd === R.QIX.BATTERY_REQ) respond(R.QIX.BATTERY_RET, [1, this.battery]);
    else if (q.cmd === R.QIX.SCREEN_REQ) respond(R.QIX.SCREEN_RET, [1, 0x70, 0x01, 0x70, 0x01, 0x70, 0x01, 0x70, 0x01, 0, 0, 0x0e, 0]);
    else if (q.cmd === R.QIX.SETTING) { this.brightness = q.payload[3]; respond(0xff, [R.QIX.SETTING, 0]); }
  }
}
class FakeBluetooth { constructor(badge) { this.badge = badge; } async requestDevice() { return this.badge; } async getDevices() { return [this.badge]; } }

module.exports = { SimBadge, FakeBluetooth };
