// ต้องมี PostgreSQL ที่ migrate แล้ว (ดู README) ใช้ข้อมูลจำลองเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withAudit } from '../src/db.js';
import { app } from '../src/app.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
after(async () => { server.close(); await pool.end(); });

const call = (path, method = 'GET', body, user = 'test-nurse', reason, role = 'NURSE') =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user && { 'X-User-Name': encodeURIComponent(user) }),
      ...(role && { 'X-User-Role': role }),
      ...(reason && { 'X-Edit-Reason': encodeURIComponent(reason) }),
    },
    body: body && JSON.stringify(body),
  });

test('ทุกการสร้างและแก้ไขรอบฟอกถูกบันทึกใน audit log', async () => {
  const hn = `TEST-${Date.now()}`;
  const patient = await (await call('/patients', 'POST', { hn, first_name: 'ทดสอบ', last_name: 'จำลอง', sex: 'F' })).json();
  const session = await (await call('/sessions', 'POST', { patient_id: patient.id, session_date: '2026-10-16', bed_no: 5, pre_weight_kg: 60.5 })).json();
  assert.equal(session.session_date, '2026-10-16');

  const res = await call(`/sessions/${session.id}`, 'PATCH', { pre_weight_kg: 61.2, bed_no: 5 }, 'พยาบาล ค', 'ชั่งน้ำหนักใหม่');
  assert.equal(res.status, 200);

  const log = await (await call(`/audit?table=dialysis_sessions&record_id=${session.id}`)).json();
  assert.deepEqual(log.map((a) => a.action), ['UPDATE', 'INSERT']);
  assert.equal(log[0].changed_by, 'พยาบาล ค');
  assert.equal(log[0].reason, 'ชั่งน้ำหนักใหม่');
  assert.deepEqual(log[0].changed_fields, ['pre_weight_kg']);
  assert.equal(log[0].old_data.pre_weight_kg, 60.5);
  assert.equal(log[0].new_data.pre_weight_kg, 61.2);

  // แถวย่อยของแบบฟอร์มก็ถูกบันทึกด้วย และดูรวมได้จาก session_id
  const vital = await (await call(`/sessions/${session.id}/vitals`, 'POST', { recorded_time: '08:30', bp_sys: 130, bp_dia: 80 })).json();
  assert.equal((await call(`/sessions/${session.id}/vitals/${vital.id}`, 'PATCH', { bp_sys: 95 })).status, 200);
  const checklist = await call(`/sessions/${session.id}`, 'PATCH', { complications: ['hypotension'], nursing_management: ['pause_uf'] });
  assert.equal(checklist.status, 200);
  assert.equal((await call(`/sessions/${session.id}`, 'PATCH', { complications: ['not_on_form'] })).status, 400);
  const all = await (await call(`/audit?session_id=${session.id}`)).json();
  assert.deepEqual(all.map((a) => `${a.table_name}:${a.action}`), [
    'dialysis_sessions:UPDATE', 'intradialytic_vitals:UPDATE', 'intradialytic_vitals:INSERT',
    'dialysis_sessions:UPDATE', 'dialysis_sessions:INSERT',
  ]);
  assert.deepEqual(all[0].changed_fields, ['complications', 'nursing_management']);

  await withAudit('test-cleanup', 'ลบข้อมูลทดสอบ', async (db) => {
    await db.query('DELETE FROM dialysis_sessions WHERE id = $1', [session.id]);
    await db.query('DELETE FROM patients WHERE id = $1', [patient.id]);
  });
});

test('แก้ไขโดยไม่ระบุผู้บันทึกไม่ได้', async () => {
  const res = await call('/patients', 'POST', { hn: `TEST-ANON-${Date.now()}`, first_name: 'ก', last_name: 'ข' }, null);
  assert.equal(res.status, 401);
});

test('แก้ไขหรือลบ audit log ไม่ได้', async () => {
  await assert.rejects(
    withAudit('x', null, (db) => db.query('DELETE FROM audit_log')),
    /append-only/,
  );
});

test('ฐานข้อมูลปฏิเสธการเขียนที่ไม่ได้ตั้งชื่อผู้บันทึก แม้จะข้าม API', async () => {
  await assert.rejects(
    pool.query("INSERT INTO patients (hn, first_name, last_name) VALUES ('TEST-RAW', 'ก', 'ข')"),
    /app.user_name must be set/,
  );
});

test('รายการรอบฟอกค้นหาด้วย HN หรือชื่อ และแบ่งหน้าได้', async () => {
  const hn = `TEST-Q-${Date.now()}`;
  const patient = await (await call('/patients', 'POST', { hn, first_name: 'ค้นหา', last_name: 'ทดลองแบ่งหน้า' })).json();
  const ids = [];
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) {
    ids.push((await (await call('/sessions', 'POST', { patient_id: patient.id, session_date: d })).json()).id);
  }
  const page = await call(`/sessions?q=${encodeURIComponent('ค้นหา ทดลอง')}&limit=2&offset=0`);
  assert.equal(page.headers.get('X-Total-Count'), '3');
  const rows = await page.json();
  assert.deepEqual(rows.map((r) => r.session_date), ['2026-10-03', '2026-10-02']);
  assert.equal(rows[0].total_count, undefined);
  const byHn = await (await call(`/sessions?q=${hn}&limit=2&offset=2`)).json();
  assert.deepEqual(byHn.map((r) => r.session_date), ['2026-10-01']);

  await withAudit('test-cleanup', 'ลบข้อมูลทดสอบ', async (db) => {
    await db.query('DELETE FROM dialysis_sessions WHERE id = ANY($1)', [ids]);
    await db.query('DELETE FROM patients WHERE id = $1', [patient.id]);
  });
});

test('ต้องเลือกตำแหน่งผู้บันทึก และ audit log เก็บตำแหน่งไว้', async () => {
  const hn = `TEST-ROLE-${Date.now()}`;
  const noRole = await call('/patients', 'POST', { hn, first_name: 'ตำแหน่ง', last_name: 'ผู้บันทึก' }, 'test-aide', null, null);
  assert.equal(noRole.status, 400);
  assert.equal((await call('/patients', 'POST', { hn, first_name: 'ตำแหน่ง', last_name: 'ผู้บันทึก' }, 'test-aide', null, 'JANITOR')).status, 400);
  const ok = await call('/patients', 'POST', { hn, first_name: 'ตำแหน่ง', last_name: 'ผู้บันทึก' }, 'test-aide', null, 'NURSE_AIDE');
  assert.equal(ok.status, 201);
  const p = await ok.json();
  const log = await (await call(`/audit?table=patients&record_id=${p.id}`)).json();
  assert.equal(log[0].changed_by, 'test-aide');
  assert.equal(log[0].changed_by_role, 'NURSE_AIDE');
  for (const role of ['DOCTOR', 'CLERK', 'OTHER']) {
    assert.equal((await call(`/patients/${p.id}`, 'PATCH', { payer: `ทดสอบ ${role}` }, 'test-staff', null, role)).status, 200);
  }
  const roles = (await (await call(`/audit?table=patients&record_id=${p.id}`)).json()).map((a) => a.changed_by_role);
  assert.deepEqual([...roles].sort(), ['CLERK', 'DOCTOR', 'NURSE_AIDE', 'OTHER']);
});
