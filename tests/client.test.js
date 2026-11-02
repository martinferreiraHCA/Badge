'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const BS = require('./helpers/load.js');
const { SimBadge, FakeBluetooth } = require('./helpers/sim-badge.js');

globalThis.isSecureContext = true;

function makeClient(badge, logs = []) {
  return new BS.BadgeClient({ log: (s) => logs.push(s), bluetooth: new FakeBluetooth(badge) });
}
function payload(n) { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (i * 7 + (i >> 8)) & 255; return a; }
const done = (badge) => new Promise((r) => badge.addEventListener('sim-complete', r, { once: true }));

test('authenticates against the simulated badge', async () => {
  const badge = new SimBadge(), logs = [], client = makeClient(badge, logs);
  await client.connect();
  assert.equal(client.state, 'ready');
  assert.equal(client.authState, 'authenticated');
  assert.equal(client.battery, 77);
  assert.equal(client.profile, 'E01');
});

test('uploads a file through device-driven windows with CRC', async () => {
  const badge = new SimBadge({ packetSize: 490, window: 8 }), client = makeClient(badge);
  await client.connect();
  const data = payload(12345);
  let finalName = null; client.complete = (n) => { finalName = n; };
  const finished = done(badge);
  await client.upload(data, 'mi loop', { ext: 'AVI' });
  await finished; await BS.util.sleep(10);
  assert.deepEqual(Array.from(badge.received.data), Array.from(data));
  assert.equal(badge.files[0], 'MILOOP.AVI');
  assert.equal(finalName, 'MILOOP.AVI');
  assert.equal(client.transfer.active, false);
  assert.equal(client.packetSize, 490);
  assert.equal(client.withCRC, true);
});

test('uploads without per-packet CRC and with odd packet sizes', async () => {
  const badge = new SimBadge({ packetSize: 200, withCRC: false, window: 3 }), client = makeClient(badge);
  await client.connect();
  const data = payload(2001), finished = done(badge);
  await client.upload(data, 'BADGE001');
  await finished;
  assert.deepEqual(Array.from(badge.received.data), Array.from(data));
});

test('renames when the badge rejects the first name', async () => {
  const badge = new SimBadge({ renameCollisions: 2 }), client = makeClient(badge);
  await client.connect();
  const finished = done(badge);
  await client.upload(payload(600), 'ART007');
  await finished;
  assert.equal(badge.files[0], 'ART009.AVI');
});

test('queries info, storage, sys info, brightness and files', async () => {
  const badge = new SimBadge(), client = makeClient(badge);
  await client.connect();
  const attrs = await client.queryInfo();
  assert.ok(attrs.find((a) => a.name === 'name' && a.decoded === 'E01'));
  assert.ok(client.info.includes('mac: 01:02:03:04:05:06'));
  assert.equal(await client.queryStorage(), 0x02000000);
  const sys = await client.querySysInfo();
  assert.equal(client.brightness, 60);
  assert.ok(sys.find((a) => a.name === 'battery'));
  await client.setBrightness(80);
  assert.equal(badge.brightness, 80);
  assert.equal(await client.queryFeatureMap(), null);
  badge.files = ['BADGE001.AVI', 'HOLA.AVI'];
  const files = await client.browseFiles();
  assert.deepEqual(files.map((f) => f.name), ['BADGE001.AVI', 'HOLA.AVI']);
  assert.equal(files[0].cluster, 101); assert.equal(files[0].isFile, true); assert.equal(files[0].unicode, false);
  assert.deepEqual(client.storages.filter((x) => x.online).map((x) => x.name), ['SD1', 'FLASH']);
});

test('pages through long listings and deletes by cluster and by name', async () => {
  const badge = new SimBadge(), client = makeClient(badge);
  await client.connect();
  badge.files = Array.from({ length: 45 }, (_, i) => 'F' + String(i).padStart(3, '0') + '.AVI');
  const files = await client.browseFiles({ pageSize: 20 });
  assert.equal(files.length, 45);
  assert.equal(files[44].name, 'F044.AVI');
  await client.deleteFile(files[3]);
  assert.deepEqual(badge.deleted, ['F003.AVI']);
  assert.equal(client.files.length, 44);
  await client.deleteFileByName('F010.AVI');
  assert.deepEqual(badge.deleted, ['F003.AVI', 'F010.AVI']);
  await assert.rejects(client.deleteFileByName('NOPE.AVI'), /no borró/);
  await assert.rejects(client.browseFiles({ devHandler: 0x03000000 }), /RECHAZADO/);
});

test('uses the Qix side channel when present', async () => {
  const badge = new SimBadge({ qix: true, name: 'E87-ABC' }), client = makeClient(badge);
  await client.connect();
  assert.equal(client.profile, 'E87');
  assert.equal(client.hasQix, true);
  const b = await client.refreshBattery();
  assert.deepEqual(b, { level: 77, charging: true });
  const s = await client.queryScreen();
  assert.equal(s.width, 368);
  await client.setBrightness(33);
  assert.equal(badge.brightness, 33);
  await client.syncTime(new Date(2026, 0, 2, 3, 4));
  assert.ok(badge.log.includes('qix 0xc6'));
});

test('diagnostics report every step', async () => {
  const badge = new SimBadge(), client = makeClient(badge);
  await client.connect();
  const steps = await client.diagnostics();
  assert.ok(steps.length >= 6);
  assert.ok(steps.every((s) => typeof s.ms === 'number'));
  assert.equal(steps.find((s) => s.name.startsWith('Batería')).value, '77 %');
});

test('disconnect aborts a transfer and rejects pending requests', async () => {
  const badge = new SimBadge(), client = makeClient(badge);
  await client.connect();
  const p = client.request(0x55, [], 5000);
  client.disconnect();
  await assert.rejects(p, /desconectado/);
  assert.equal(client.state, 'offline');
});
