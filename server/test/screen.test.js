// อ่านค่าจากภาพหน้าจอเครื่องฟอก ใช้ตัวอ่านจำลองแทนการเรียกระบบภายนอก และใช้ข้อมูลจำลองเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withAudit } from '../src/db.js';
import { app } from '../src/app.js';
import { setScreenReader } from '../src/screenReader.js';
import { reconcileReads, readClock, pickSlots } from '../public/screenRead.js';

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
    let calls = 0;
    setScreenReader(async (image, type) => {
      seen = { size: image.length, type };
      calls++;
      // อ่านสองครั้งได้ PR ไม่ตรงกัน ต้องไม่เติม PR
      return { recorded_time: '9:05', bp_sys: 138, bp_dia: 82, pr: calls === 1 ? 76 : 78, rr: null, bfr_ml_min: 300, pv_mmhg: 140, tmp_mmhg: 9999, conductivity_ms_cm: 14.0, notes: '' };
    });
    assert.equal((await fetch(base + '/health')).ok, true);
    assert.equal((await upload(path, Buffer.from('not an image'))).status, 415);
    assert.equal((await upload(path, JPEG, 'image/jpeg', {})).status, 400);
    assert.equal((await upload('/sessions/00000000-0000-0000-0000-000000000000/vitals/read-screen', JPEG)).status, 404);

    const res = await upload(path, JPEG);
    assert.equal(res.status, 200);
    const body = await res.json();
    const out = { ...body.rows[0], warnings: body.warnings };
    assert.deepEqual(seen, { size: JPEG.length, type: 'image/jpeg' });
    assert.equal(out.values.recorded_time, '09:05');
    assert.equal(out.values.bp_sys, 138);
    assert.equal(calls, 2);
    assert.equal(out.values.rr, null);
    assert.equal(out.values.pr, null);
    assert.equal(out.values.tmp_mmhg, null);
    assert.equal(out.values.conductivity_ms_cm, 14);
    assert.deepEqual(out.missing, ['RR', 'UFR', 'Total ml']);
    assert.match(out.warnings[0], /^09:05 PR อ่านได้ไม่ตรงกัน \(76 \/ 78\)/);
    assert.match(out.warnings[1], /^09:05 TMP/);

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

test('รวมผลอ่าน: ค่าต้องตรงกันทุกครั้งและสมเหตุผลจึงจะเติม', () => {
  const a = { recorded_time: '10:42', bp_sys: 80, bp_dia: 120, pr: '80', rr: null, bfr_ml_min: 300, pv_mmhg: -20, tmp_mmhg: 80, conductivity_ms_cm: 14.1, ufr: 612.4, total_uf_ml: '1250', notes: 'จอสะท้อนแสง' };
  const res = reconcileReads([a, { ...a, recorded_time: '10:43', notes: 'จอสะท้อนแสง' }]);
  const out = { ...res.rows[0], warnings: res.warnings, notes: res.notes };
  assert.equal(out.values.recorded_time, null);
  assert.equal(out.values.bp_sys, null); // sys ต่ำกว่า dia ไม่สมเหตุผล
  assert.equal(out.values.pr, 80);
  assert.equal(out.values.pv_mmhg, -20);
  assert.equal(out.values.ufr, 612);
  assert.equal(out.values.total_uf_ml, 1250);
  assert.equal(out.notes, 'จอสะท้อนแสง');
  assert.ok(out.warnings.some((w) => w.startsWith('Time อ่านได้ไม่ตรงกัน')));
  assert.ok(out.warnings.some((w) => w.startsWith('BP 80/120')));
});

test('อ่านนาฬิกาเครื่อง: AM/PM, แบบ 12 ชั่วโมง และเวลาที่ไม่ใช่นาฬิกา', () => {
  assert.equal(readClock({ time_raw: '4:52 PM', recorded_time: '04:52' }), '16:52');
  assert.equal(readClock({ time_raw: '12:05 am' }), '00:05');
  assert.equal(readClock({ time_raw: '16:52:30' }), '16:52');
  assert.equal(readClock({ time_raw: '9:15' }), '09:15'); // ไม่มี AM/PM ถือตามที่เห็น ไม่เดาเช้า/บ่าย
  assert.equal(readClock({ time_raw: null, recorded_time: null }), null);
  const base = { bp_sys: 120, bp_dia: 70, notes: '' };
  // ภาพที่ถ่ายไว้ก่อน เวลาบนจอ 10:36 ต้องได้ 10:36 ตามจอ
  const shown = reconcileReads([{ ...base, time_raw: 'Time 10:36' }, { ...base, time_raw: '10:36' }]);
  assert.equal(shown.rows[0].values.recorded_time, '10:36');
  const ok = reconcileReads([{ ...base, time_raw: '4:51 PM' }, { ...base, time_raw: '16:51' }]);
  assert.equal(ok.rows[0].values.recorded_time, '16:51');
});

test('หน้าจอหลายแถว: จับคู่แถวตามเวลา แล้วกรองเวลาเริ่มและทุก 30 นาทีจนครบ 4 ชั่วโมง', () => {
  // ข้อมูลจำลอง: เครื่องบันทึกทุก 15 นาที ตั้งแต่ 10:00 ถึง 14:15
  const rows = [];
  for (let m = 0; m <= 255; m += 15) {
    const t = `${String(10 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    rows.push({ time_raw: t, bp_sys: 120 + (m % 7), bp_dia: 70, pr: 80, bfr_ml_min: 300, total_uf_ml: m * 5 });
  }
  const second = rows.map((r) => ({ ...r }));
  second[2] = { ...second[2], pr: 81 }; // 10:30 PR อ่านสองรอบไม่ตรง
  second.splice(5, 1); // 11:15 อ่านเจอรอบเดียว
  const res = reconcileReads([{ rows, notes: '' }, { rows: second, notes: '' }]);
  assert.equal(res.rows.length, rows.length - 1);
  assert.ok(res.warnings.some((w) => w.startsWith('แถวเวลา 11:15')));
  assert.ok(res.warnings.some((w) => w.startsWith('10:30 PR อ่านได้ไม่ตรงกัน')));

  const slots = pickSlots(res.rows, '10:00');
  assert.deepEqual(slots.map((r) => r.values.recorded_time), ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00']);
  assert.equal(slots[0].slot, '0:00 ชม.');
  assert.equal(slots[8].slot, '4:00 ชม.');
  assert.equal(slots[1].values.pr, null);
  // เวลาเริ่ม 10:05 ใช้แถวที่ใกล้ที่สุดไม่เกิน 10 นาที
  assert.deepEqual(pickSlots(res.rows, '10:05').slice(0, 2).map((r) => r.values.recorded_time), ['10:00', '10:30']);
  // ข้ามเที่ยงคืน
  const night = pickSlots([{ values: { recorded_time: '23:45' } }, { values: { recorded_time: '00:15' } }], '23:45');
  assert.deepEqual(night.map((r) => r.slot), ['0:00 ชม.', '0:30 ชม.']);
});
