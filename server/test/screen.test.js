// อ่านค่าจากภาพหน้าจอเครื่องฟอก ใช้ตัวอ่านจำลองแทนการเรียกระบบภายนอก และใช้ข้อมูลจำลองเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withAudit } from '../src/db.js';
import { app } from '../src/app.js';
import { setScreenReader } from '../src/screenReader.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
after(async () => { setScreenReader(null); server.close(); await pool.end(); });

const headers = { 'X-User-Name': encodeURIComponent('พยาบาล'), 'X-User-Role': 'NURSE' };
const json = (path, method, body) => fetch(base + path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const upload = (path, body, type = 'image/jpeg', h = headers) => fetch(base + path, { method: 'POST', headers: { ...h, 'Content-Type': type }, body });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

test('อ่านภาพหน้าจอเครื่อง: ตรวจไฟล์ ตรวจค่า และไม่บันทึกจนกว่าพยาบาลจะยืนยัน', async () => {
  const patient = await (await json('/patients', 'POST', { hn: `TEST-SCR-${Date.now()}`, first_name: 'ทดสอบ', last_name: 'หน้าจอ', sex: 'M' })).json();
  const session = await (await json('/sessions', 'POST', { patient_id: patient.id, session_date: '2026-10-16', bed_no: 3 })).json();
  const path = `/sessions/${session.id}/vitals/read-screen`;
  try {
    setScreenReader(null);
    const prev = process.env.SCREEN_READER;
    delete process.env.SCREEN_READER;
    assert.equal((await upload(path, JPEG)).status, 501);
    assert.equal((await (await fetch(base + '/health')).json()).screen_reader, false);
    if (prev !== undefined) process.env.SCREEN_READER = prev;

    let seen = null;
    setScreenReader(async (image, type) => {
      seen = { size: image.length, type };
      return { recorded_time: '9:05', bp_sys: 138, bp_dia: 82, pr: 76, rr: null, bfr_ml_min: 300, pv_mmhg: 140, tmp_mmhg: 9999, conductivity_ms_cm: 14.0, notes: '' };
    });
    assert.equal((await fetch(base + '/health')).ok, true);
    assert.equal((await upload(path, Buffer.from('not an image'))).status, 415);
    assert.equal((await upload(path, JPEG, 'image/jpeg', {})).status, 400);
    assert.equal((await upload('/sessions/00000000-0000-0000-0000-000000000000/vitals/read-screen', JPEG)).status, 404);

    const res = await upload(path, JPEG);
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.deepEqual(seen, { size: JPEG.length, type: 'image/jpeg' });
    assert.equal(out.values.recorded_time, '09:05');
    assert.equal(out.values.bp_sys, 138);
    assert.equal(out.values.rr, null);
    assert.equal(out.values.tmp_mmhg, null);
    assert.deepEqual(out.missing, ['RR']);
    assert.match(out.warnings[0], /^TMP/);

    // การอ่านภาพไม่สร้างแถว ต้องกดบันทึกเองผ่าน API เดิมซึ่งมี audit log
    const detail = await (await fetch(`${base}/sessions/${session.id}`)).json();
    assert.equal(detail.vitals.length, 0);
  } finally {
    setScreenReader(null);
    await withAudit('test-cleanup', 'ลบข้อมูลทดสอบ', async (db) => {
      await db.query('DELETE FROM dialysis_sessions WHERE id = $1', [session.id]);
      await db.query('DELETE FROM patients WHERE id = $1', [patient.id]);
    });
  }
});
