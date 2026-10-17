// อ่านน้ำหนักจากรูปตาชั่ง ใช้ตัวอ่านจำลองแทนการเรียกระบบภายนอก และใช้ข้อมูลจำลองเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { app } from '../src/app.js';
import { setScaleReader } from '../src/screenReader.js';
import { reconcileScale } from '../public/scaleRead.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
after(async () => { setScaleReader(null); server.close(); await pool.end(); });

const headers = { 'X-User-Name': encodeURIComponent('พยาบาล'), 'X-User-Role': 'NURSE' };
const upload = (body, type = 'image/jpeg', h = headers) => fetch(base + '/scale/read', { method: 'POST', headers: { ...h, 'Content-Type': type }, body });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

test('กติการวมผลอ่านตาชั่ง: เติมเฉพาะเมื่อสองรอบตรงกัน นิ่ง และสมเหตุผล', () => {
  const r = (weight_raw, unit = 'kg', stable = true, notes = '') => ({ weight_raw, unit, stable, notes });
  assert.deepEqual(reconcileScale([r('62.4'), r('62.4')]), { weight_kg: 62.4, warnings: [], notes: '' });
  assert.equal(reconcileScale([r('62,4'), r('62.4', 'kg', null)]).weight_kg, 62.4);
  assert.equal(reconcileScale([r('62.4'), r('62.9')]).weight_kg, null);
  assert.equal(reconcileScale([r('62.4'), r(null)]).weight_kg, null);
  assert.match(reconcileScale([r(null), r(null)]).warnings[0], /อ่านน้ำหนักจากรูปไม่ได้/);
  assert.match(reconcileScale([r('62.4', 'kg', false), r('62.4')]).warnings[0], /ยังไม่นิ่ง/);
  assert.equal(reconcileScale([r('62.4', 'kg'), r('62.4', 'lb')]).weight_kg, null);
  assert.equal(reconcileScale([r('8.5'), r('8.5')]).weight_kg, null);
  assert.equal(reconcileScale([r('62.4 kg'), r('62.4 kg')]).weight_kg, null);
  const lb = reconcileScale([r('150.0', 'lb'), r('150.0', 'lb')]);
  assert.equal(lb.weight_kg, 68);
  assert.match(lb.warnings[0], /lb/);
  assert.equal(reconcileScale([r('62.4', 'kg', true, 'มีแสงสะท้อน'), r('62.4')]).notes, 'มีแสงสะท้อน');
});

test('API อ่านรูปตาชั่ง: ตรวจผู้บันทึก ตรวจไฟล์ ปิดอยู่ตอบ 501 และอ่านสองรอบ', async () => {
  try {
    setScaleReader(null);
    const prev = process.env.SCREEN_READER;
    delete process.env.SCREEN_READER;
    assert.equal((await (await fetch(base + '/health')).json()).scale_reader, false);
    assert.equal((await upload(JPEG)).status, 501);
    if (prev !== undefined) process.env.SCREEN_READER = prev;

    let calls = 0;
    let seen = null;
    setScaleReader(async (image, type) => { calls++; seen = { size: image.length, type }; return { weight_raw: '58.7', unit: 'kg', stable: true, notes: '' }; });
    assert.equal((await (await fetch(base + '/health')).json()).scale_reader, true);
    assert.equal((await upload(JPEG, 'image/jpeg', {})).status, 400);
    assert.equal((await upload(Buffer.from('not an image'))).status, 415);
    calls = 0;
    const res = await upload(JPEG);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { weight_kg: 58.7, warnings: [], notes: '' });
    assert.equal(calls, 2);
    assert.deepEqual(seen, { size: JPEG.length, type: 'image/jpeg' });

    calls = 0;
    setScaleReader(async () => ({ weight_raw: ++calls === 1 ? '58.7' : '59.7', unit: 'kg', stable: true, notes: '' }));
    const bad = await (await upload(JPEG)).json();
    assert.equal(bad.weight_kg, null);
    assert.match(bad.warnings[0], /ไม่ตรงกัน/);

    setScaleReader(async () => { throw Object.assign(new Error('ระบบอ่านภาพไม่ว่าง'), { status: 503 }); });
    assert.equal((await upload(JPEG)).status, 503);
  } finally {
    setScaleReader(null);
  }
});
