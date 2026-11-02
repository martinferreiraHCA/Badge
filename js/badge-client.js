/* Badge Studio — Web Bluetooth client for Jieli round badges (E01 first;
   E87 / L8 / X9 / E92 via the same RCSP transport).

   Validated path (E01): auth handshake → 0x07 storage handle → 0x21 → 0x27 →
   0x1B metadata → device-driven 0x1D read windows → 0x20 name → 0x1C close.
   Best-effort extras learned from AuraCast / jieli-ble-badge-research:
   battery and screen info over the Qix side channel (FD02), brightness,
   language, clock sync, RCSP target/sys info, file browsing. All extras are
   guarded: a missing characteristic or a NOT_SUPPORTED status never breaks
   the validated upload path. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { concat, hx, u32be, crc16, sleep, sanitizeName, renamedFile, readU32BE } = BS.util;
  const R = BS.rcsp, OP = R.OP, UUID = R.UUID;

  function coveredBytes(ranges, start, end) {
    ranges.push([start, end]); ranges.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of ranges) { const prev = out[out.length - 1]; if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]); else out.push(r.slice()); }
    ranges.splice(0, ranges.length, ...out);
    return out.reduce((n, r) => n + r[1] - r[0], 0);
  }

  class BadgeClient {
    constructor({ log = () => {}, change = () => {}, progress = () => {}, complete = () => {}, bluetooth = null } = {}) {
      this.log = log; this.change = change; this.onProgress = progress; this.complete = complete;
      this.bluetooth = bluetooth || (typeof navigator !== 'undefined' ? navigator.bluetooth : null);
      this.device = null; this.tx = null; this.rx = null; this.control = null; this.qixNotifies = [];
      this.state = 'offline'; this.authState = 'idle'; this.profile = 'E01';
      this.pending = new Map(); this.writeQueue = Promise.resolve(); this.rxQueue = Promise.resolve();
      this.parser = new R.Parser(); this.serial = 0; this.qixSerial = 0; this.session = 0; this.fragment = 180;
      this.transfer = null; this.battery = null; this.charging = null; this.storage = null; this.info = ''; this.infoAttrs = []; this.sysAttrs = [];
      this.screen = null; this.brightness = null; this.packetSize = 0; this.withCRC = false; this.txProps = ''; this.files = []; this.storages = []; this.storageName = '';
      this.qixWaiters = []; this.lastActivity = 0; this.connectedAt = 0; this.storages = []; this.storageName = ''; this.browse = null; this.read = null;
      this.boundDisconnected = () => this.disconnected();
    }
    get ready() { return this.state === 'ready' && !!this.device?.gatt?.connected; }
    get connected() { return !!this.device?.gatt?.connected; }
    get hasQix() { return !!this.control; }
    emit() { this.change(this); }

    static available() { return typeof navigator !== 'undefined' && !!navigator.bluetooth && !!globalThis.isSecureContext; }

    /* Chrome exposes previously permitted devices through getDevices(); use it to reconnect without the picker. */
    async rememberedDevices() {
      try { if (this.bluetooth?.getDevices) return await this.bluetooth.getDevices(); } catch { /* unsupported */ }
      return [];
    }

    async connect(existingDevice = null) {
      if (this.state === 'connecting' || this.connected) return;
      if (!this.bluetooth) throw new Error('Web Bluetooth no está disponible. Abrí el sitio con Chrome, Edge u Opera en una pestaña propia.');
      if (typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext) throw new Error('Bluetooth requiere HTTPS o localhost.');
      this.state = 'connecting'; this.emit();
      try {
        const picked = existingDevice || await this.bluetooth.requestDevice({
          filters: R.NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
          optionalServices: [UUID.service, UUID.battery, UUID.deviceInfo, UUID.qixService, UUID.qixShort],
        });
        this.device = picked; this.session++; this.fragment = 180; this.parser = new R.Parser(); this.pending.clear();
        this.rxQueue = Promise.resolve(); this.writeQueue = Promise.resolve(); this.qixWaiters = [];
        this.profile = /^E01/i.test(picked.name || '') ? 'E01' : 'E87';
        picked.addEventListener('gattserverdisconnected', this.boundDisconnected);
        this.log('Dispositivo seleccionado: ' + (picked.name || 'badge') + ' · perfil ' + this.profile);
        const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent || '');
        const attempts = isWindows ? 4 : 2;
        let server = null, lastError = null;
        for (let attempt = 1; attempt <= attempts && !server; attempt++) {
          try {
            server = await picked.gatt.connect();
            const s = await server.getPrimaryService(UUID.service);
            this.tx = await s.getCharacteristic(UUID.tx);
            this.rx = await s.getCharacteristic(UUID.rx);
          } catch (e) {
            lastError = e; server = null; this.tx = null; this.rx = null;
            this.log('Intento ' + attempt + '/' + attempts + ' falló: ' + e.message);
            try { picked.gatt.disconnect(); } catch { /* ignore */ }
            if (attempt < attempts) await sleep(isWindows ? 2000 * attempt : 500 * attempt);
          }
        }
        if (!server) throw lastError || new Error('No se pudo conectar.');
        if (!this.tx.properties.writeWithoutResponse && !this.tx.properties.write) throw new Error('AE01 no permite escritura.');
        const epoch = this.session;
        this.rxHandler = (e) => {
          const v = e.target.value, copy = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
          this.rxQueue = this.rxQueue.then(() => { if (epoch === this.session) return this.receive(copy); }).catch((err) => { this.log('ERROR RX: ' + err.message); if (this.transfer?.active) { this.abortTransfer(err.message); this.disconnect(); } });
        };
        this.rx.addEventListener('characteristicvaluechanged', this.rxHandler);
        await this.rx.startNotifications();
        this.txProps = this.tx.properties.writeWithoutResponse ? 'AE01 · sin respuesta' : 'AE01 · con respuesta';
        this.state = 'connected'; this.connectedAt = Date.now(); this.emit();
        this.log('AE01 / AE02 conectados; notificaciones activas.');
        await this.attachBattery(server);
        await this.attachQix(server);
        await this.authenticate();
      } catch (e) {
        if (this.connected && this.authState === 'failed') { this.state = 'connected'; this.emit(); } else this.disconnect();
        throw e;
      }
    }
    async attachBattery(server) {
      try {
        const bs = await server.getPrimaryService(UUID.battery), bc = await bs.getCharacteristic(UUID.level);
        const battery = (v) => { if (v?.byteLength && v.getUint8(0) <= 100) { this.battery = v.getUint8(0); this.emit(); } };
        if (bc.properties.notify) { bc.addEventListener('characteristicvaluechanged', (e) => battery(e.target.value)); await bc.startNotifications(); }
        if (bc.properties.read) battery(await bc.readValue());
      } catch (e) { this.log('Servicio de batería estándar no disponible: ' + e.message); }
    }
    async attachQix(server) {
      try {
        let s;
        try { s = await server.getPrimaryService(UUID.qixService); } catch { s = await server.getPrimaryService(UUID.qixShort); }
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          const u = c.uuid.toLowerCase();
          if (u === UUID.qixControl || (c.properties.write || c.properties.writeWithoutResponse) && !this.control) this.control = c;
          if (c.properties.notify || c.properties.indicate) {
            c.addEventListener('characteristicvaluechanged', (e) => { const v = e.target.value; this.receiveQix(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice()); });
            try { await c.startNotifications(); this.qixNotifies.push(c); } catch { /* ignore */ }
          }
        }
        this.log(this.control ? 'Canal Qix (FD02) disponible: batería, pantalla, brillo, idioma y hora.' : 'Servicio Qix sin característica de control.');
        if (this.control) this.qixBootstrapped = false;
      } catch { this.log('Canal Qix no expuesto por este badge (normal en E01).'); }
    }
    disconnected() {
      this.session++;
      if (this.rx && this.rxHandler) this.rx.removeEventListener('characteristicvaluechanged', this.rxHandler);
      this.device?.removeEventListener('gattserverdisconnected', this.boundDisconnected);
      this.tx = null; this.rx = null; this.control = null; this.qixNotifies = []; this.state = 'offline'; this.authState = 'idle';
      this.battery = null; this.charging = null; this.storage = null; this.packetSize = 0; this.withCRC = false; this.txProps = ''; this.info = ''; this.screen = null; this.brightness = null; this.files = [];
      this.parser = new R.Parser();
      this.rejectAuth?.(new Error('Bluetooth desconectado')); this.resolveAuth = null; this.rejectAuth = null; clearTimeout(this.authTimer);
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Bluetooth desconectado')); }
      this.pending.clear();
      for (const w of this.qixWaiters) { clearTimeout(w.timer); w.reject(new Error('Bluetooth desconectado')); }
      clearTimeout(this.readTimer); this.read = null; clearTimeout(this.browseTimer); this.browse = null;
      this.qixWaiters = [];
      if (this.transfer?.active) this.abortTransfer('Bluetooth desconectado');
      this.log('Bluetooth desconectado.'); this.emit();
    }
    disconnect() { const d = this.device; if (d?.gatt?.connected) d.gatt.disconnect(); if (this.state !== 'offline') this.disconnected(); }

    write(bytes, quiet = false, target = null) {
      const epoch = this.session;
      const run = async () => {
        const ch = target || this.tx;
        if (!ch || !this.connected || epoch !== this.session) throw new Error('Conectá el badge primero.');
        if (!quiet) this.log('TX ' + hx(bytes, 64));
        for (let off = 0; off < bytes.length;) {
          if (epoch !== this.session) throw new Error('Conexión interrumpida.');
          const end = Math.min(off + this.fragment, bytes.length);
          try {
            if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(bytes.slice(off, end)); else await ch.writeValueWithResponse(bytes.slice(off, end));
            off = end; this.lastActivity = Date.now();
            if (this.transfer?.active) this.transfer.lastActivity = Date.now();
            if (off < bytes.length) await sleep(3);
          } catch (e) {
            if (off === 0 && this.fragment > 20 && this.connected && ['DataError', 'OperationError', 'InvalidModificationError', 'NetworkError'].includes(e.name)) { this.fragment = 20; this.log('GATT: fragmentos reducidos a 20 bytes.'); continue; }
            throw e;
          }
        }
      };
      const next = this.writeQueue.then(run); this.writeQueue = next.catch(() => {}); return next;
    }
    request(op, params = [], timeout = 12000) {
      if (!this.ready) return Promise.reject(new Error('Autenticá el badge antes de continuar.'));
      const sn = this.serial++ & 255, key = op + ':' + sn;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(key); reject(new Error('Sin respuesta del badge a 0x' + op.toString(16))); }, timeout);
        this.pending.set(key, { resolve, reject, timer, op });
        this.write(R.commandFrame(op, params, true, sn)).catch((e) => { const p = this.pending.get(key); if (p) { clearTimeout(timer); this.pending.delete(key); reject(e); } });
      });
    }
    /* Like request() but resolves with {status, parameter} instead of rejecting on non-zero status. */
    async tryRequest(op, params = [], timeout = 8000) {
      try { const parameter = await this.request(op, params, timeout); return { status: 0, parameter }; }
      catch (e) { if (e.status !== undefined) return { status: e.status, parameter: e.parameter || new Uint8Array() }; throw e; }
    }

    /* ---- authentication ---- */
    async authenticate() {
      if (!this.tx) throw new Error('Conectá el badge primero.');
      if (this.transfer?.active) throw new Error('Esperá que termine la transferencia.');
      if (this.resolveAuth) throw new Error('Ya se está autenticando.');
      this.authState = 'phone'; this.state = 'authenticating';
      this.challenge = new Uint8Array(16); (globalThis.crypto || require('crypto').webcrypto).getRandomValues(this.challenge);
      this.emit();
      const result = new Promise((resolve, reject) => { this.resolveAuth = resolve; this.rejectAuth = reject; this.authTimer = setTimeout(() => this.authFailure('No llegó la confirmación de autenticación. Reintentá con el badge encendido y en modo Bluetooth.'), 12000); });
      this.write(concat(new Uint8Array([0]), this.challenge)).catch((e) => this.authFailure(e.message));
      return result;
    }
    authFailure(message) {
      clearTimeout(this.authTimer); this.authState = 'failed'; this.state = this.tx ? 'connected' : 'offline';
      const reject = this.rejectAuth; this.resolveAuth = null; this.rejectAuth = null;
      this.log('Autenticación: ' + message); this.emit(); reject?.(new Error(message));
    }
    async receive(u) {
      this.lastActivity = Date.now();
      if (this.transfer?.active) this.transfer.lastActivity = Date.now();
      if (this.authState === 'phone' && u.length === 17 && u[0] === 1) {
        const expected = BS.jlAuth.encrypt16(this.challenge);
        if (!expected.every((b, i) => b === u[i + 1])) { this.authFailure('La prueba criptográfica del badge no coincide.'); return; }
        this.authState = 'device'; this.log('Prueba criptográfica verificada.');
        await this.write(new Uint8Array([2, 112, 97, 115, 115])); return;
      }
      if (this.authState === 'device' && u.length === 17 && u[0] === 0) { this.authState = 'final'; await this.write(concat(new Uint8Array([1]), BS.jlAuth.encrypt16(u.slice(1)))); return; }
      if (this.authState === 'final' && u.length === 5 && hx(u) === '02 70 61 73 73') {
        clearTimeout(this.authTimer); this.authState = 'authenticated'; this.state = 'ready';
        const resolve = this.resolveAuth; this.resolveAuth = null; this.rejectAuth = null;
        this.log('AUTH SUCCESS · badge autenticado.'); this.emit(); resolve?.(); return;
      }
      if (this.authState !== 'authenticated') return;
      for (const p of this.parser.feed(u)) {
        if (p.command) { await this.handleCommand(p); continue; }
        const key = p.opcode + ':' + p.serial, item = this.pending.get(key);
        this.log('RX 0x' + p.opcode.toString(16) + ' estado=' + p.status + ' ' + hx(p.parameter, 60));
        if (!item) continue;
        clearTimeout(item.timer); this.pending.delete(key);
        if (p.status !== 0) { const err = new Error('El badge respondió 0x' + p.opcode.toString(16) + ' con estado ' + (R.STATUS_NAMES[p.status] || p.status)); err.status = p.status; err.parameter = p.parameter; item.reject(err); }
        else { if (p.opcode === OP.FILE_META && this.transfer?.active && p.parameter.length >= 2) this.packetSize = p.parameter[0] * 256 + p.parameter[1]; item.resolve(p.parameter); }
      }
    }

    /* ---- info ---- */
    async queryInfo() {
      const p = await this.request(OP.TARGET_INFO, [255, 255, 255, 255, 0]);
      this.infoAttrs = R.parseTLV(p, R.TARGET_NAMES);
      const text = this.infoAttrs.filter((a) => ['name', 'version', 'protocol', 'mac', 'mtu', 'sdk_type', 'ui_version', 'customer'].includes(a.name) && a.decoded).map((a) => a.name + ': ' + a.decoded);
      this.info = text.join(' · ') || Array.from(p, (b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ' ')).join('').split(/\s+/).filter((x) => x.length >= 4).join(' · ') || ('Respuesta recibida (' + p.length + ' bytes).');
      this.emit(); return this.infoAttrs;
    }
    async queryStorage() {
      const p = await this.request(OP.SYS_INFO, [255, 0, 0, 0, 4]);
      this.storages = R.parseStorageInfo(p);
      const h = R.parseStorageHandle(p);
      if (h === null) { const alt = this.storages.find((x) => x.online && x.handle !== null); if (!alt) throw new Error('El badge no informó almacenamiento disponible.'); this.storage = alt.handle; this.storageName = alt.name; }
      else { this.storage = h; this.storageName = 'SD1'; }
      this.log('Almacenamiento: ' + this.storages.filter((x) => x.online).map((x) => x.name + '=0x' + (x.handle ?? 0).toString(16)).join(' ') + ' · usa ' + this.storageName);
      this.emit(); return this.storage;
    }
    async querySysInfo(fn = 0, mask = 0xffffffff) {
      const p = await this.request(OP.SYS_INFO, [fn & 255, ...u32be(mask)]);
      const attrs = R.parseTLV(p.slice(1), R.SYSINFO_NAMES);
      this.sysAttrs = attrs;
      const batt = attrs.find((a) => a.type === 0 && a.data.length === 1); if (batt && this.battery === null) this.battery = batt.data[0];
      const light = attrs.find((a) => a.type === 7 && a.data.length); if (light) this.brightness = light.data[light.data.length - 1];
      this.emit(); return attrs;
    }
    async queryFeatureMap() { const r = await this.tryRequest(OP.FEATURE_MAP, []); return r.status === 0 && r.parameter.length >= 4 ? readU32BE(r.parameter) : null; }

    /* ---- Qix side channel ---- */
    qixRequest(cmd, payload, responseCmd, timeout = 5000, ackOk = false) {
      if (!this.control) return Promise.reject(new Error('Este badge no expone el canal Qix (FD02).'));
      const seq = this.qixSerial = (this.qixSerial + 1) & 15, flag = ((seq & 15) << 3) | 0x02;
      const frame = R.qixFrame(cmd, payload, flag);
      return new Promise((resolve, reject) => {
        const waiter = { cmd, responseCmd, ackOk, resolve, reject, timer: setTimeout(() => { this.qixWaiters = this.qixWaiters.filter((w) => w !== waiter); reject(new Error('Sin respuesta Qix a 0x' + cmd.toString(16))); }, timeout) };
        this.qixWaiters.push(waiter);
        this.write(frame, false, this.control).catch((e) => { clearTimeout(waiter.timer); this.qixWaiters = this.qixWaiters.filter((w) => w !== waiter); reject(e); });
      });
    }
    receiveQix(raw) {
      this.lastActivity = Date.now();
      const q = R.parseQix(raw);
      if (!q) { this.log('RX Qix (sin parsear) ' + hx(raw, 40)); return; }
      this.log('RX Qix cmd=0x' + q.cmd.toString(16) + ' ' + hx(q.payload, 32));
      if (q.cmd === R.QIX.BATTERY_RET && q.payload.length >= 2) { this.charging = q.payload[0] === 1; this.battery = q.payload[1]; this.emit(); }
      /* 0xFF [cmd, status] is the generic acknowledgement the E01 sends for settings commands. */
      const ack = q.cmd === 0xff && q.payload.length >= 2;
      const w = this.qixWaiters.find((x) => x.responseCmd === q.cmd || (ack && x.cmd === q.payload[0] && x.ackOk));
      if (w) { clearTimeout(w.timer); this.qixWaiters = this.qixWaiters.filter((x) => x !== w); if (ack && q.payload[1] !== 0) w.reject(new Error('El badge rechazó Qix 0x' + q.payload[0].toString(16) + ' (estado ' + q.payload[1] + ')')); else w.resolve(q); }
    }
    /* The E01 ignores Qix requests until the screen-info query (0xC6) has been answered once. */
    async qixBootstrap() {
      if (!this.control || this.qixBootstrapped) return;
      try { await this.queryScreen(); this.qixBootstrapped = true; } catch (e) { this.log('Qix bootstrap: ' + e.message); }
    }
    async refreshBattery() {
      if (this.control) {
        await this.qixBootstrap();
        try { const q = await this.qixRequest(R.QIX.BATTERY_REQ, [0x80], R.QIX.BATTERY_RET); if (q.payload.length >= 2) return { level: q.payload[1], charging: q.payload[0] === 1 }; } catch (e) { this.log('Batería Qix: ' + e.message); }
      }
      try { await this.querySysInfo(0, 1); } catch (e) { this.log('Batería SysInfo: ' + e.message); }
      return { level: this.battery, charging: this.charging };
    }
    async queryScreen() {
      const q = await this.qixRequest(R.QIX.SCREEN_REQ, [1], R.QIX.SCREEN_RET);
      const p = q.payload;
      if (p.length >= 9 && p[0] === 1) {
        this.screen = { width: p[1] | (p[2] << 8), height: p[3] | (p[4] << 8), pictureWidth: p[5] | (p[6] << 8), pictureHeight: p[7] | (p[8] << 8), memory: p.length >= 13 ? (p[9] | (p[10] << 8) | (p[11] << 16) | (p[12] << 24)) >>> 0 : 0 };
        this.emit(); return this.screen;
      }
      throw new Error('Respuesta de pantalla inesperada: ' + hx(p));
    }
    async setLanguage(code) {
      if (!this.control) throw new Error('Este badge no expone el canal Qix.');
      await this.qixBootstrap();
      const seq = this.qixSerial = (this.qixSerial + 1) & 15;
      await this.write(R.qixFrame(R.QIX.LANGUAGE, [code === 'zh' ? 0 : 1], ((seq & 15) << 3) | 0x02), false, this.control);
      this.log('Idioma del badge: ' + (code === 'zh' ? '中文' : 'English'));
    }
    async syncTime(date = new Date()) {
      if (!this.control) throw new Error('Este badge no expone el canal Qix.');
      await this.qixBootstrap();
      await this.write(R.qixTimeFrame(date), false, this.control);
      this.log('Hora enviada: ' + date.toLocaleString());
    }
    async setBrightness(level) {
      const value = Math.max(0, Math.min(100, Math.round(level)));
      if (this.control) {
        await this.qixBootstrap();
        try { await this.qixRequest(R.QIX.SETTING, [0x16, 0x01, 0x00, value], R.QIX.SETTING, 3000, true); this.brightness = value; this.emit(); return; } catch (e) { this.log('Brillo Qix: ' + e.message); }
      }
      /* RCSP SYS_INFO_SET (0x08): [function][len][type 7][value] */
      const r = await this.tryRequest(OP.SYS_INFO_SET, [0, 2, 7, value], 5000);
      if (r.status !== 0) throw new Error('El badge no aceptó el cambio de brillo (' + (R.STATUS_NAMES[r.status] || r.status) + ').');
      this.brightness = value; this.emit();
    }

    /* ---- file browsing & deletion (Jieli SDK semantics) ----
       PathData.type describes the node being opened (0 = folder, 1 = file), not a filter:
       the root is a folder, so the listing starts with type 0 and clusters [0]. Entries arrive
       as DATA frames (first byte 0x0C) and the badge closes with 0x0D. Folders found at the
       root are opened one level deeper with clusters [0, cluster]. */
    async browseFiles({ pageSize = 20, devHandler = null, maxEntries = 300, depth = 2 } = {}) {
      if (this.transfer?.active) throw new Error('Esperá que termine la transferencia.');
      if (this.storage === null) await this.queryStorage();
      const handle = devHandler ?? this.storage;
      const walk = async (clusters, level, path) => {
        const out = []; let start = 1;
        for (;;) {
          const page = await this.browsePage(0, pageSize, start, handle, clusters);
          out.push(...page.entries.map((e) => ({ ...e, path, clusters })));
          if (!page.entries.length || page.entries.length < pageSize || out.length >= maxEntries) break;
          start += page.entries.length;
        }
        const files = out.filter((e) => e.isFile), folders = out.filter((e) => !e.isFile);
        if (level < depth) for (const f of folders.slice(0, 12)) { try { files.push(...await walk(clusters.concat(f.cluster), level + 1, (path ? path + '/' : '') + f.name)); } catch (e) { this.log('Carpeta ' + f.name + ': ' + e.message); } }
        if (level === 0) files.push(...folders.map((f) => ({ ...f, path: '' })));
        return files;
      };
      const all = await walk([0], 0, '');
      this.files = all.map((e) => ({ ...e, device: this.storageName || 'SD1', handle }));
      this.log('Archivos en el badge: ' + this.files.filter((f) => f.isFile).length + ' archivos, ' + this.files.filter((f) => !f.isFile).length + ' carpetas');
      this.emit(); return this.files;
    }
    browsePage(type, readNum, startIndex, handle, clusters) {
      return new Promise((resolve, reject) => {
        const chunks = []; let total = null, done = false;
        const finish = (err) => { if (done) return; done = true; clearTimeout(this.browseTimer); this.browse = null; if (err) reject(err); else { const entries = R.parseFileStructs(concat(...chunks)); this.log('Listado [' + clusters.join('/') + '] desde ' + startIndex + ': ' + entries.length + ' entradas' + (total !== null ? ' de ' + total : '') + ' · ' + entries.map((e) => (e.isFile ? '' : '[DIR] ') + e.name).join(', ')); resolve({ total, entries }); } };
        const idle = (ms) => { clearTimeout(this.browseTimer); this.browseTimer = setTimeout(() => finish(), ms); };
        this.browse = { data: (d) => { chunks.push(d); idle(1500); }, stop: (reason) => { if (reason === 0 || reason === 1) setTimeout(() => finish(), 50); else finish(new Error('El badge interrumpió el listado (código ' + reason + ').')); } };
        idle(6000);
        this.request(OP.FILE_BROWSE, R.fileBrowseParam(type, readNum, startIndex, handle, clusters), 8000)
          .then((p) => { total = p.length ? R.parseBrowseTotal(p) : null; if (total === 0) idle(400); else idle(2500); })
          .catch((e) => finish(e.status === 2 ? new Error('Este badge no soporta el listado de archivos (NOT_SUPPORTED).') : e));
      });
    }
    /* ---- reading files back (0x24): previews and downloads ----
       maxBytes stops early (cancel 0x81) once enough data for a preview arrived. */
    readFile(entry, { maxBytes = Infinity, onProgress = () => {}, timeout = 30000 } = {}) {
      if (!this.ready) return Promise.reject(new Error('Conectá y autenticá el badge primero.'));
      if (this.transfer?.active || this.read) return Promise.reject(new Error('Esperá que termine la transferencia en curso.'));
      const handle = entry.handle ?? this.storage;
      const param = entry.cluster !== undefined ? R.readFileByClusterParam(handle, entry.cluster, 0) : R.readFileByNameParam(handle, entry.name, !!entry.unicode, 0);
      return new Promise((resolve, reject) => {
        const chunks = []; let got = 0, size = 0, crcMode = null, done = false, cancelling = false;
        const finish = (err) => { if (done) return; done = true; clearTimeout(this.readTimer); this.read = null; if (err) { this.log('Lectura de ' + entry.name + ': ' + err.message); reject(err); } else { const data = concat(...chunks); this.log('Leído ' + entry.name + ': ' + data.length + ' bytes' + (size ? ' de ' + size : '')); resolve({ data, size }); } };
        const arm = (ms) => { clearTimeout(this.readTimer); this.readTimer = setTimeout(() => finish(cancelling ? null : new Error('El badge dejó de enviar datos.')), ms); };
        const cancel = async () => { if (cancelling) return; cancelling = true; try { await this.tryRequest(OP.FILE_READ_BACK, R.READ_CANCEL(0), 3000); } catch { /* the badge may already have stopped */ } arm(600); };
        this.read = {
          data: (p) => {
            if (done || p.length < 4) return;
            const offset = readU32BE(p, 0); let body = p.slice(4);
            if (crcMode === null) { const looksFile = (b) => (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46) || (b[0] === 0xff && b[1] === 0xd8); crcMode = body.length > 6 && !looksFile(body) && (looksFile(body.slice(2)) || crc16(body.slice(2)) === ((body[0] << 8) | body[1])); this.log('Lectura: ' + (crcMode ? 'con' : 'sin') + ' CRC por paquete'); }
            if (crcMode) body = body.slice(2);
            if (offset !== got) this.log('Lectura: desfase ' + offset + ' ≠ ' + got);
            chunks.push(body); got += body.length; onProgress(got, size);
            if (got >= maxBytes || (size && got >= size)) { if (size && got >= size) arm(1500); else cancel(); } else arm(4000);
          },
          stop: (ret) => { if (ret === 0 || cancelling) finish(); else finish(new Error('El badge interrumpió la lectura (código ' + ret + ').')); },
        };
        arm(timeout);
        this.request(OP.FILE_READ_BACK, param, 10000).then((p) => { size = R.parseReadStart(p); this.log('Lectura de ' + entry.name + ': ' + size + ' bytes anunciados'); if (!size) arm(4000); }).catch((e) => finish(e.status === 2 ? new Error('Este badge no permite leer archivos (NOT_SUPPORTED).') : e));
      });
    }
    /* Reads just enough of an AVI/JPEG to extract its first frame. */
    async previewFile(entry) {
      let budget = 24 * 1024, jpeg = null;
      for (let attempt = 0; attempt < 3 && !jpeg; attempt++) {
        const { data, size } = await this.readFile(entry, { maxBytes: budget });
        jpeg = R.firstJpeg(data);
        if (!jpeg && (size && data.length >= size)) break;
        budget *= 3;
      }
      if (!jpeg) throw new Error('No se encontró un cuadro JPEG en ' + entry.name + '.');
      return jpeg;
    }

    /* 0x1F needs the cluster reported by the browse; 0x23 deletes by 8.3 name. Both validated against the official SDK layouts. */
    async deleteFile(entry) {
      if (!entry) throw new Error('Elegí un archivo.');
      if (this.transfer?.active) throw new Error('Esperá que termine la transferencia.');
      if (entry.cluster !== undefined && entry.handle !== undefined) {
        const r = await this.tryRequest(OP.FILE_DELETE, R.deleteByClusterParam(entry.handle, entry.isFile !== false, entry.cluster, true), 15000);
        if (r.status === 0) { this.log('Eliminado ' + entry.name + ' (clúster ' + entry.cluster + ')'); this.files = this.files.filter((f) => f !== entry); this.emit(); return true; }
        this.log('Borrado por clúster rechazado (' + (R.STATUS_NAMES[r.status] || r.status) + '); se intenta por nombre.');
      }
      return this.deleteFileByName(entry.name);
    }
    /* 0x22 DEVICE_FORMAT [devHandle BE32]: wipes the whole media storage. Only on explicit request. */
    async formatStorage() {
      if (this.transfer?.active) throw new Error('Esperá que termine la transferencia.');
      if (this.storage === null) await this.queryStorage();
      const r = await this.tryRequest(OP.DEVICE_FORMAT, u32be(this.storage), 60000);
      const reason = r.parameter[0] ?? 0;
      if (r.status !== 0 || reason !== 0) throw new Error('El badge no formateó (' + (R.STATUS_NAMES[r.status] || r.status) + ', motivo ' + reason + ').');
      this.log('Almacenamiento ' + this.storageName + ' formateado.'); this.files = []; this.emit(); return true;
    }
    async deleteFileByName(name) {
      const r = await this.tryRequest(OP.ONE_FILE_DELETE, R.deleteByNameParam(name), 10000);
      if (r.status !== 0) throw new Error('El badge no borró ' + name + ' (' + (R.STATUS_NAMES[r.status] || r.status) + ').');
      this.log('Eliminado ' + name); this.files = this.files.filter((f) => f.name !== name); this.emit(); return true;
    }

    /* ---- diagnostics ---- */
    async diagnostics() {
      const steps = [];
      const run = async (name, fn) => { const t = Date.now(); try { const v = await fn(); steps.push({ name, ok: true, ms: Date.now() - t, value: v }); } catch (e) { steps.push({ name, ok: false, ms: Date.now() - t, value: e.message }); } };
      await run('Mapa de funciones (0x02)', () => this.queryFeatureMap().then((m) => (m === null ? 'no soportado' : '0x' + m.toString(16))));
      await run('Información (0x03)', () => this.queryInfo().then((a) => a.length + ' atributos'));
      await run('Sistema (0x07)', () => this.querySysInfo().then((a) => a.map((x) => x.name + '=' + x.decoded).join(', ')));
      await run('Almacenamiento SD1', () => this.queryStorage().then((h) => '0x' + h.toString(16)));
      await run('Batería', () => this.refreshBattery().then((b) => (b.level ?? '?') + ' %' + (b.charging ? ' (cargando)' : '')));
      if (this.control) await run('Pantalla (Qix 0xC6)', () => this.queryScreen().then((s) => s.width + '×' + s.height + ' · imagen ' + s.pictureWidth + '×' + s.pictureHeight));
      await run('Archivos (0x0C)', () => this.browseFiles().then((f) => f.filter((x) => x.isFile).length + ' archivos'));
      return steps;
    }

    /* ---- upload ---- */
    async upload(bytes, name, { ext = 'AVI' } = {}) {
      if (!this.ready) throw new Error('Conectá y autenticá el badge primero.');
      if (this.transfer?.active) throw new Error('Ya hay una transferencia en curso.');
      if (!bytes?.length) throw new Error('Prepará un archivo primero.');
      const t = this.transfer = { active: true, bytes: bytes.slice(), name: sanitizeName(name, ext), ext, rename: 0, committed: sanitizeName(name, ext), ranges: [], sent: 0, lastActivity: Date.now(), started: Date.now() };
      this.packetSize = 0; this.withCRC = false; this.emit(); this.onProgress(0, 'Consultando almacenamiento…');
      this.watchdog = setInterval(() => { if (t.active && Date.now() - t.lastActivity > 20000) { this.abortTransfer('El badge dejó de responder. Reconectá para reintentar.'); this.disconnect(); } }, 1000);
      try {
        let h;
        try { h = await this.queryStorage(); } catch (e) { this.log('Sin handle SD1 (' + e.message + '); se usa 2.'); h = 2; }
        if (!t.active) return;
        if (this.control) { try { await this.qixBootstrap(); await this.write(R.qixTimeFrame(), true, this.control); } catch { /* best effort */ } }
        await this.request(OP.FILE_PREPARE, [0]);
        if (!t.active) return;
        this.onProgress(0, 'Negociando transferencia…');
        const cap = await this.request(OP.FILE_PARAMS, concat(new Uint8Array([0]), u32be(h), new Uint8Array([1])));
        if (!t.active) return;
        this.withCRC = cap.length > 0 && cap[cap.length - 1] === 1;
        const crc = crc16(t.bytes), temp = 'BADGEST.tmp';
        const param = concat(u32be(t.bytes.length), new Uint8Array([crc >>> 8, crc & 255]), new TextEncoder().encode(temp + '\0'));
        this.log('UPLOAD ' + t.name + ' · ' + t.bytes.length + ' bytes · CRC16 ' + crc.toString(16));
        const start = await this.request(OP.FILE_META, param);
        if (!t.active) return;
        this.packetSize = start.length >= 2 ? start[0] * 256 + start[1] : 0;
        if (this.packetSize < 1 || this.packetSize > 8192) throw new Error('Tamaño de paquete inválido: ' + this.packetSize);
        this.emit(); this.onProgress(0, 'Esperando solicitudes del badge…');
      } catch (e) { if (t.active) { this.abortTransfer(e.message); this.disconnect(); } throw e; }
    }
    async handleCommand(p) {
      const t = this.transfer;
      if (p.opcode === OP.DATA && p.parameter[0] === OP.FILE_BROWSE) { this.log('RX listado ' + hx(p.parameter.slice(1), 48)); if (this.browse) this.browse.data(p.parameter.slice(1)); else this.log('(datos de listado fuera de sesión)'); return; }
      if (p.opcode === OP.DATA && p.parameter[0] === OP.FILE_READ_BACK) { if (p.needsReply) await this.write(R.responseFrame(OP.DATA, p.serial)); if (this.read) this.read.data(p.parameter.slice(1)); return; }
      if (p.opcode === OP.FILE_READ_BACK) { const op = p.parameter[0], ret = p.parameter[1] ?? 0; this.log('RX lectura op=0x' + (op ?? 0).toString(16) + ' ret=' + ret); if (p.needsReply) await this.write(R.responseFrame(p.opcode, p.serial)); if (op === 0x80 || op === 0x81) this.read?.stop(op === 0x81 ? 0 : ret); return; }
      if (p.opcode === OP.FILE_BROWSE_STOP) { this.log('RX fin de listado, motivo=' + (p.parameter[0] ?? 0)); if (p.needsReply) await this.write(R.responseFrame(p.opcode, p.serial)); this.browse?.stop(p.parameter[0] ?? 0); return; }
      if (!t?.active) { this.log('RX comando 0x' + p.opcode.toString(16) + ' fuera de transferencia: ' + hx(p.parameter, 40)); if (p.needsReply) await this.write(R.responseFrame(p.opcode, p.serial, 2)); return; }
      if (p.opcode === OP.FILE_READ) {
        const a = p.parameter;
        if (a.length < 7 || a[0] !== 0 || this.packetSize < 1 || this.packetSize > 8192) throw new Error('Solicitud de lectura inválida o recibida antes de negociar.');
        const length = a[1] * 256 + a[2], offset = readU32BE(a, 3);
        if (length < 1 || offset >= t.bytes.length) throw new Error('El badge pidió un rango de archivo inválido.');
        const end = Math.min(t.bytes.length, offset + length);
        this.log('READ ' + offset + ' + ' + length);
        let index = 0;
        for (let pos = offset; pos < end; pos += this.packetSize) {
          if (!t.active) return;
          const part = t.bytes.slice(pos, Math.min(end, pos + this.packetSize)), c = crc16(part);
          const header = this.withCRC ? new Uint8Array([OP.FILE_READ, index & 255, c >>> 8, c & 255]) : new Uint8Array([OP.FILE_READ, index & 255]);
          await this.write(R.commandFrame(OP.DATA, concat(header, part), false, this.serial++ & 255), true);
          index++;
        }
        t.sent = coveredBytes(t.ranges, offset, end);
        const pct = Math.min(99, t.sent / t.bytes.length * 100), elapsed = (Date.now() - t.started) / 1000, rate = elapsed > 0 ? t.sent / elapsed : 0;
        const eta = rate > 0 ? Math.max(0, (t.bytes.length - t.sent) / rate) : 0;
        this.onProgress(pct, t.sent.toLocaleString() + ' / ' + t.bytes.length.toLocaleString() + ' bytes · ' + (rate / 1024).toFixed(1) + ' KB/s · ~' + Math.ceil(eta) + ' s');
        return;
      }
      if (p.opcode === OP.FILE_NAME) {
        if (t.rename >= 999) throw new Error('Demasiados intentos de nombre.');
        t.committed = renamedFile(t.name, t.rename++, t.ext);
        const body = this.profile === 'E87' ? R.utf16Path(R.timestampName(t.ext.toLowerCase())) : concat(new TextEncoder().encode(t.committed), new Uint8Array([0, 0]));
        await this.write(R.responseFrame(OP.FILE_NAME, p.serial, 0, body));
        this.log('Nombre final: ' + t.committed); return;
      }
      if (p.opcode === OP.FILE_END) {
        const reason = p.parameter[0] ?? 255;
        await this.write(R.responseFrame(OP.FILE_END, p.serial));
        if (reason !== 0) throw new Error('El badge terminó con código ' + reason + ' (' + (R.STATUS_NAMES[reason] || 'desconocido') + ')');
        if (t.sent !== t.bytes.length) throw new Error('Fin prematuro: el badge no solicitó todos los bytes.');
        t.active = false; clearInterval(this.watchdog);
        const secs = ((Date.now() - t.started) / 1000).toFixed(1);
        this.onProgress(100, 'Confirmado · ' + t.committed + ' · ' + secs + ' s');
        this.log('TRANSFER COMPLETE · ' + t.committed + ' en ' + secs + ' s'); this.emit(); this.complete(t.committed); return;
      }
      if (p.opcode === OP.FILE_ERROR) throw new Error('Fallo de transferencia 0x1E, código ' + (p.parameter[0] ?? 255));
      this.log('Comando no manejado: 0x' + p.opcode.toString(16));
    }
    abortTransfer(message) {
      clearInterval(this.watchdog); if (this.transfer) this.transfer.active = false;
      this.onProgress(Math.min(99, (this.transfer?.sent || 0) / (this.transfer?.bytes.length || 1) * 100), 'Interrumpida: ' + message);
      this.log('TRANSFER ERROR · ' + message); this.emit();
    }
    cancel() { if (this.transfer?.active) { this.abortTransfer('Cancelada por el usuario.'); this.disconnect(); } }
  }

  BS.BadgeClient = BadgeClient;
  BS.coveredBytes = coveredBytes;
})(typeof window !== 'undefined' ? window : globalThis);
