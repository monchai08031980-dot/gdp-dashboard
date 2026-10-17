// ซักประวัติเบื้องต้นจากตารางนัดฟอก ค่าไปแสดงในแบบฟอร์ม 519 ใบเดียวกัน ใช้ข้อมูลจำลองเท่านั้น
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
    headers: { 'Content-Type': 'application/json', 'X-User-Name': encodeURIComponent('test-nurse'), 'X-User-Role': 'NURSE' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const year = 2100 + Math.floor(Math.random() * 900);

test('ซักประวัติจากนัดฟอก: สร้างแบบฟอร์มของนัด ค่าเริ่มต้นจากครั้งก่อน และ Hemodialysis sheet เห็นค่าเดียวกัน', async () => {
  const p = (await call('/patients', 'POST', { hn: `TEST-PA-${Date.now()}`, first_name: 'ซัก', last_name: 'ประวัติ', dry_weight_kg: 58.5, vascular_access: 'AVF', access_side: 'LT' })).body;
  // การฟอกครั้งก่อน Post BW 59.2
  await call('/sessions', 'POST', { patient_id: p.id, session_date: `${year}-03-01`, shift: 1, post_bw_kg: 59.2, session_no: 7 });
  const [entry] = (await call('/schedule', 'POST', { patient_id: p.id, shift: 1, dates: [`${year}-03-03`] })).body;

  const before = (await call(`/schedule/${entry.id}/assessment`)).body;
  assert.equal(before.session_id, null);
  assert.equal(before.values.dry_weight_kg, 58.5);
  assert.equal(before.values.last_bw_kg, 59.2);

  assert.equal((await call(`/schedule/${entry.id}/assessment`, 'PUT', { hn: 'x' })).status, 400);
  const saved = await call(`/schedule/${entry.id}/assessment`, 'PUT', {
    pre_symptoms: ['edema', 'itching'], pre_nurse_note: 'ทดสอบ', pre_weight_kg: 61.4, dry_weight_kg: 58.5, last_bw_kg: 59.2,
    weight_gain_kg: 2.2, target_uf_kg: 2.9, status: 'COMPLETED',
  });
  assert.equal(saved.status, 200);
  const s = saved.body;
  assert.equal(s.status, 'DRAFT'); // ช่องอื่นนอกจากการซักประวัติแก้จากที่นี่ไม่ได้
  assert.equal(s.session_no, 8);
  assert.equal(s.access_type, 'AVF');
  assert.equal(s.session_date, `${year}-03-03`);

  // Hemodialysis sheet ใบเดียวกัน ค่าเดียวกัน
  const sheet = (await call(`/sessions/${s.id}`)).body;
  assert.deepEqual(sheet.pre_symptoms, ['edema', 'itching']);
  assert.equal(sheet.pre_weight_kg, 61.4);
  assert.equal(sheet.target_uf_kg, 2.9);
  // แก้ใน sheet แล้วหน้าซักประวัติเห็นค่าใหม่ (ไม่มีสำเนาซ้ำ)
  await call(`/sessions/${s.id}`, 'PATCH', { post_bw_kg: 58.6 });
  const again = (await call(`/schedule/${entry.id}/assessment`)).body;
  assert.equal(again.session_id, s.id);
  assert.equal(again.values.post_bw_kg, 58.6);
  // บันทึกซ้ำใช้แบบฟอร์มเดิม
  assert.equal((await call(`/schedule/${entry.id}/assessment`, 'PUT', { pre_weight_kg: 61.6 })).body.id, s.id);
  const list = (await call(`/schedule?patient_id=${p.id}&from=${year}-03-03`)).body;
  assert.equal(list[0].assessed, true);

  const audit = (await call(`/audit?session_id=${s.id}`)).body;
  assert.ok(audit.some((a) => a.table_name === 'dialysis_sessions' && a.action === 'INSERT' && a.reason === 'ซักประวัติเบื้องต้น'));
});
