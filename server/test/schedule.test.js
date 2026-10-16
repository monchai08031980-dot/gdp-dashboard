// ตารางนัดฟอกล่วงหน้า ใช้ข้อมูลจำลองเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { app } from '../src/app.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
after(async () => { server.close(); await pool.end(); });
const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Name': encodeURIComponent('test-nurse') },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

// ใช้ปีไกล ๆ แบบสุ่มช่วงกว้าง เพื่อไม่ชนกับข้อมูลจำลองอื่นหรือการรันทดสอบครั้งก่อน
const year = 2100 + Math.floor(Math.random() * 900);
const d = (m, day) => `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

test('นัดฟอกล่วงหน้าหลายวัน กันผู้ป่วยซ้ำในรอบด้วย HN และชื่อ', async () => {
  const stamp = Date.now();
  const a = (await call('/patients', 'POST', { hn: `TEST-S-A-${stamp}`, first_name: 'ซ้ำ', last_name: `ชื่อเดียวกัน${stamp}` })).body;
  const b = (await call('/patients', 'POST', { hn: `TEST-S-B-${stamp}`, first_name: 'ซ้ำ', last_name: `ชื่อเดียวกัน${stamp}` })).body;
  const c = (await call('/patients', 'POST', { hn: `TEST-S-C-${stamp}`, first_name: 'อีก', last_name: 'คนหนึ่ง' })).body;

  const booked = await call('/schedule', 'POST', { patient_id: a.id, shift: 1, dates: [d(1, 5), d(1, 8), d(1, 12)] });
  assert.equal(booked.status, 201);
  assert.equal(booked.body.length, 3);
  assert.ok(booked.body.every((e) => e.bed_no >= 1));

  // HN เดิม รอบเดิม ซ้ำไม่ได้ และถ้าติดวันเดียว ก็ไม่จองวันอื่นด้วย
  const again = await call('/schedule', 'POST', { patient_id: a.id, shift: 1, dates: [d(1, 8), d(1, 9)] });
  assert.equal(again.status, 409);
  assert.deepEqual(again.body.conflicts.map((x) => x.date), [d(1, 8)]);
  assert.equal((await call(`/schedule?patient_id=${a.id}&from=${d(1, 9)}&to=${d(1, 9)}`)).body.length, 0);

  // คนละ HN แต่ชื่อ-สกุลเหมือนกัน ในรอบเดียวกัน ไม่ได้
  const sameName = await call('/schedule', 'POST', { patient_id: b.id, shift: 1, dates: [d(1, 5)] });
  assert.equal(sameName.status, 409);
  assert.match(sameName.body.conflicts[0].problem, /ซ้ำกับผู้ป่วย HN/);
  // แต่คนละรอบได้
  assert.equal((await call('/schedule', 'POST', { patient_id: b.id, shift: 2, dates: [d(1, 5)] })).status, 201);

  // เตียงเดียวกันในรอบเดียวกันไม่ได้
  const bed = booked.body[0].bed_no;
  const bedClash = await call('/schedule', 'POST', { patient_id: c.id, shift: 1, bed_no: bed, dates: [d(1, 5)] });
  assert.equal(bedClash.status, 409);
  assert.match(bedClash.body.conflicts[0].problem, /เตียง/);

  // ยกเลิกนัดแล้วจองใหม่ได้ และทุกขั้นตอนอยู่ใน audit log
  assert.equal((await call(`/schedule/${booked.body[0].id}`, 'DELETE')).status, 204);
  assert.equal((await call('/schedule', 'POST', { patient_id: c.id, shift: 1, bed_no: bed, dates: [d(1, 5)] })).status, 201);
  const log = (await call(`/audit?table=schedule_entries&record_id=${booked.body[0].id}`)).body;
  assert.deepEqual(log.map((x) => x.action), ['UPDATE', 'INSERT']);
  assert.deepEqual(log[0].changed_fields, ['status']);
});

test('นัดย้อนหลังไม่ได้', async () => {
  const p = (await call('/patients', 'POST', { hn: `TEST-PAST-${Date.now()}`, first_name: 'ย้อน', last_name: 'หลัง' })).body;
  const res = await call('/schedule', 'POST', { patient_id: p.id, shift: 1, dates: ['2020-01-01'] });
  assert.equal(res.status, 409);
  assert.match(res.body.conflicts[0].problem, /ผ่านมาแล้ว/);
});

test('รอบที่ปิดหรือเต็มจองไม่ได้', async () => {
  const original = (await call('/shifts')).body;
  try {
    await call('/shifts', 'PUT', [{ shift: 4, active: false, beds: 30 }, { shift: 3, active: true, beds: 1, start_time: '16:00' }]);
    const stamp = Date.now();
    const p1 = (await call('/patients', 'POST', { hn: `TEST-F1-${stamp}`, first_name: 'เต็ม', last_name: 'หนึ่ง' })).body;
    const p2 = (await call('/patients', 'POST', { hn: `TEST-F2-${stamp}`, first_name: 'เต็ม', last_name: 'สอง' })).body;
    assert.match((await call('/schedule', 'POST', { patient_id: p1.id, shift: 4, dates: [d(2, 1)] })).body.conflicts[0].problem, /ไม่ได้เปิดรอบ/);
    assert.equal((await call('/schedule', 'POST', { patient_id: p1.id, shift: 3, dates: [d(2, 1)] })).status, 201);
    assert.match((await call('/schedule', 'POST', { patient_id: p2.id, shift: 3, dates: [d(2, 1)] })).body.conflicts[0].problem, /เต็ม/);
  } finally {
    await call('/shifts', 'PUT', original);
  }
});

test('การตั้งค่ารอบแสดงจำนวนผู้ป่วยประจำแยกวัน และกรองรายชื่อตามรอบได้', async () => {
  const hn = `TEST-SC-${Date.now()}`;
  const res = await fetch(`${base}/patients`, { method: 'POST', headers: { 'X-User-Name': 'test-nurse', 'Content-Type': 'application/json' },
    body: JSON.stringify({ hn, first_name: 'สรุป', last_name: 'รอบ', regular_shift: 1, regular_days: ['MON', 'FRI'] }) });
  assert.equal(res.status, 201);
  const shifts = await (await fetch(`${base}/shifts`)).json();
  const one = shifts.find((s) => s.shift === 1);
  assert.ok(one.regular_patients >= 1);
  assert.ok(one.regular_by_day.MON >= 1 && one.regular_by_day.FRI >= 1);
  assert.equal(typeof one.booked_today, 'number');
  const list = await (await fetch(`${base}/patients?regular_shift=1&q=${hn}`)).json();
  assert.deepEqual(list.map((p) => p.hn), [hn]);
  assert.equal((await (await fetch(`${base}/patients?regular_shift=2&q=${hn}`)).json()).length, 0);
});
