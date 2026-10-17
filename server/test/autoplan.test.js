// จัดนัดให้ตามรอบและวันประจำ ใช้ข้อมูลจำลองเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { app } from '../src/app.js';
import { planSchedule } from '../public/autoPlan.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
after(async () => { server.close(); await pool.end(); });
const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Name': encodeURIComponent('test-nurse'), 'X-User-Role': 'NURSE' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('กติกาจัดนัด: ตามวันประจำ เตียงประจำก่อน ข้ามคนที่มีนัดแล้ว และแจ้งรอบเต็ม', () => {
  const P = (id, shift, days, first = `ชื่อ${id}`) => ({ id, hn: `H${id}`, first_name: first, last_name: 'จำลอง', regular_shift: shift, regular_days: days });
  const patients = [P('a', 1, ['MON', 'WED']), P('b', 1, ['MON']), P('c', 1, ['MON']), P('d', 2, ['MON']), P('e', 1, ['TUE']), P('f', null, [])];
  const shifts = [{ shift: 1, active: true, beds: 3 }, { shift: 2, active: false, beds: 10 }];
  // 2030-01-07 วันจันทร์ 2030-01-09 วันพุธ
  const entries = [{ patient_id: 'x', schedule_date: '2030-01-07', shift: 1, bed_no: 1, first_name: 'อื่น', last_name: 'คน' },
    { patient_id: 'c', schedule_date: '2030-01-07', shift: 1, bed_no: 2, first_name: 'ชื่อc', last_name: 'จำลอง' }];
  const r = planSchedule({ dates: ['2030-01-07', '2030-01-09'], patients, shifts, entries, usualBeds: { b: 3 } });
  assert.deepEqual(r.items.map((i) => `${i.date} ${i.patient_id} ${i.bed_no}`), ['2030-01-07 b 3', '2030-01-09 a 1']);
  assert.equal(r.already, 1); // c มีนัดแล้ว
  assert.deepEqual(r.problems.map((p) => `${p.patient_id} ${p.problem}`), ['d ไม่ได้เปิดรอบ 2', 'a รอบ 1 เต็มแล้ว (3 เตียง)']);
});

test('จัดนัดให้ผ่าน API: ดูแผน บันทึกที่เลือก แล้วไม่เสนอซ้ำ', async () => {
  const year = 2100 + Math.floor(Math.random() * 900);
  const p = (await call('/patients', 'POST', { hn: `TEST-AP-${Date.now()}`, first_name: 'จัดนัด', last_name: `อัตโนมัติ${Date.now()}`, regular_shift: 1, regular_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] }));
  assert.equal(p.status, 201);
  const from = `${year}-05-01`, to = `${year}-05-03`;
  assert.equal((await call(`/schedule/auto-plan?from=${from}&to=${year}-07-01`)).status, 400);
  const plan = (await call(`/schedule/auto-plan?from=${from}&to=${to}`)).body;
  const mine = plan.items.filter((i) => i.patient_id === p.body.id);
  assert.equal(mine.length, 3);
  const r = await call('/schedule/auto-book', 'POST', { items: mine.map(({ patient_id, date, shift, bed_no }) => ({ patient_id, date, shift, bed_no })) });
  assert.equal(r.status, 201);
  assert.equal(r.body.created, 3);
  const again = (await call(`/schedule/auto-plan?from=${from}&to=${to}`)).body;
  assert.equal(again.items.filter((i) => i.patient_id === p.body.id).length, 0);
  // จองซ้ำไม่ได้ และไม่บันทึกเลยสักรายการ
  const dup = await call('/schedule/auto-book', 'POST', { items: mine.map(({ patient_id, date, shift }) => ({ patient_id, date, shift })) });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.conflicts.length, 3);
});
