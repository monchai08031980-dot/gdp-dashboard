// ยืนยันข้อมูลทั้งหมด: ตรวจแบบฟอร์มแล้วบันทึกไฟล์ลงโฟลเดอร์ ใช้ข้อมูลจำลองและโฟลเดอร์ชั่วคราวเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool, withAudit } from '../src/db.js';
import { app } from '../src/app.js';
import { checkSession } from '../public/sessionCheck.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
const tmp = await mkdtemp(join(tmpdir(), 'hemo-export-'));
const before = (await pool.query("SELECT value FROM app_settings WHERE key = 'data_folder'")).rows[0]?.value;
after(async () => {
  // คืนค่าโฟลเดอร์เดิม
  await withAudit('test', 'คืนค่าโฟลเดอร์หลังทดสอบ', (db) => (before
    ? db.query("UPDATE app_settings SET value = $1 WHERE key = 'data_folder'", [before])
    : db.query("DELETE FROM app_settings WHERE key = 'data_folder'")));
  server.close();
  await pool.end();
  await rm(tmp, { recursive: true, force: true });
});

const headers = { 'X-User-Name': encodeURIComponent('พยาบาล'), 'X-User-Role': 'NURSE' };
const json = (path, method, body) => fetch(base + path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const COMPLETE = {
  session_date: '2026-10-16', shift: 1, bed_no: 7, status: 'COMPLETED',
  pre_weight_kg: 62.5, dry_weight_kg: 60, last_bw_kg: 60.2, weight_gain_kg: 2.3, post_bw_kg: 60.3, weight_loss_kg: 2.2, target_uf_kg: 2.2,
  access_side: 'LT', access_type: 'AVF', machine_no: 'M-07', dialyzer: 'FX80', blood_flow_ml_min: 300,
  anticoagulant: 'HEPARIN', heparin_total_iu: 2000,
  time_start: '08:00', time_off: '12:00', duration_hr: 4, pre_bp_sys: 140, pre_bp_dia: 80, pre_pr: 78,
  total_uf_ml: 2200, complications: ['no_complication'], technical_complications: ['no_complication'],
};
const VITALS = ['08:00', '09:00', '10:00', '11:00', '12:00'].map((t, i) => ({ recorded_time: t, bp_sys: 130, bp_dia: 78, pr: 76, bfr_ml_min: 300, total_uf_ml: i * 550 }));

test('กติกาตรวจแบบฟอร์ม: ข้อมูลครบไม่มี error และจับค่าผิดได้', () => {
  assert.deepEqual(checkSession(COMPLETE, { vitals: VITALS }), { errors: [], warnings: [] });
  const bad = checkSession({ ...COMPLETE, status: 'IN_PROGRESS', pre_bp_sys: 70, pre_bp_dia: 90, post_bw_kg: null, time_off: '08:00', complications: ['no_complication', 'hypotension'] },
    { vitals: [...VITALS, { recorded_time: '09:00', bp_sys: 120, bp_dia: 70, pr: 70 }] });
  const fields = bad.errors.map((e) => e.field);
  for (const f of ['status', 'pre_bp_dia', 'post_bw_kg', 'time_off', 'complications', 'vitals']) assert.ok(fields.includes(f), f);
  assert.equal(checkSession(COMPLETE, { vitals: [] }).errors[0].field, 'vitals');
  const w = checkSession({ ...COMPLETE, weight_loss_kg: 3 }, { vitals: VITALS.map((v, i) => (i === 3 ? { ...v, total_uf_ml: 100 } : v)) }).warnings.map((x) => x.field);
  assert.ok(w.includes('weight_loss_kg') && w.includes('vitals'));
});

test('ยืนยันข้อมูลทั้งหมด: ตรวจก่อน ตั้งโฟลเดอร์ บันทึกไฟล์ และมี audit log', async () => {
  const patient = await (await json('/patients', 'POST', { hn: `TEST-CF-${Date.now()}`, first_name: 'ทดสอบ', last_name: 'ยืนยัน', sex: 'F' })).json();
  const session = await (await json('/sessions', 'POST', { patient_id: patient.id, session_date: '2026-10-16', bed_no: 7, shift: 1 })).json();
  const id = session.id;

  // ข้อมูลยังไม่ครบ: ตรวจเจอ error และยืนยันไม่ได้
  const check = await (await fetch(`${base}/sessions/${id}/check`)).json();
  assert.ok(check.errors.length > 5);
  let r = await json(`/sessions/${id}/export/prepare`, 'POST', {});
  assert.equal(r.status, 422);
  assert.ok((await r.json()).check.errors.length);

  assert.equal((await json(`/sessions/${id}`, 'PATCH', COMPLETE)).status, 200);
  for (const v of VITALS) assert.equal((await json(`/sessions/${id}/vitals`, 'POST', v)).status, 201);

  // โฟลเดอร์: ต้องเป็น path เต็ม
  assert.equal((await json('/settings/data-folder', 'PUT', { path: 'relative/dir' })).status, 400);
  const folder = join(tmp, 'HemoData');
  r = await json('/settings/data-folder', 'PUT', { path: folder });
  assert.equal(r.status, 200);
  assert.equal((await (await fetch(base + '/settings')).json()).data_folder, folder);

  // ขั้นที่ 1: สร้างตัวอย่าง ขั้นที่ 2: ยืนยันพร้อม PDF ข้อควรตรวจต้องติ๊กรับทราบก่อน
  assert.equal((await json(`/sessions/${id}`, 'PATCH', { weight_loss_kg: 3 })).status, 200);
  const prep = await (await json(`/sessions/${id}/export/prepare`, 'POST', {})).json();
  assert.equal(prep.check.warnings.length, 1);
  assert.equal(prep.record.vitals.length, 5);
  const PDF = Buffer.from('%PDF-1.4\n% mock\n%%EOF\n');
  const confirm = (q, body = PDF) => fetch(`${base}/sessions/${id}/confirm?${new URLSearchParams(q)}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/pdf' }, body });
  const q = { target: 'server', confirmed_at: prep.confirmed_at, sha256: prep.sha256 };
  assert.equal((await confirm(q)).status, 409);
  assert.equal((await confirm({ ...q, ack: '1', sha256: 'x' })).status, 409);
  assert.equal((await confirm({ ...q, ack: '1' }, Buffer.from('nope'))).status, 400);
  r = await confirm({ ...q, ack: '1' });
  assert.equal(r.status, 201);
  const exp = await r.json();
  assert.equal(exp.target, 'server');
  assert.ok(exp.file_path.startsWith(join(folder, '2026', '2026-10-16')));
  assert.deepEqual(await readFile(exp.pdf_path), PDF);
  const content = await readFile(exp.file_path, 'utf8');
  assert.equal(createHash('sha256').update(content).digest('hex'), exp.sha256);
  const saved = JSON.parse(content);
  assert.equal(saved.patient.hn, patient.hn);
  assert.equal(saved.vitals.length, 5);
  assert.equal(saved.confirmed_by_role, 'NURSE');
  assert.equal(exp.confirmed_by_role, 'NURSE');
  const csv = await readFile(exp.csv_path, 'utf8');
  assert.equal(csv.trim().split('\r\n').length, 6);

  let detail = await (await fetch(`${base}/sessions/${id}`)).json();
  assert.equal(detail.export.id, exp.id);
  assert.equal(detail.export.edited_after, false);
  // แก้ไขหลังยืนยัน ระบบต้องแจ้ง
  assert.equal((await json(`/sessions/${id}`, 'PATCH', { weight_loss_kg: 2.2 })).status, 200);
  detail = await (await fetch(`${base}/sessions/${id}`)).json();
  assert.equal(detail.export.edited_after, true);

  // ข้อมูลเปลี่ยนหลังดูตัวอย่าง: ยืนยันไม่ได้
  const prep2 = await (await json(`/sessions/${id}/export/prepare`, 'POST', {})).json();
  assert.equal((await json(`/sessions/${id}`, 'PATCH', { machine_no: 'M-08' })).status, 200);
  assert.equal((await confirm({ target: 'local', folder: 'HemoData', confirmed_at: prep2.confirmed_at, sha256: prep2.sha256 }, undefined)).status, 409);
  // โฟลเดอร์ในเครื่องผู้ใช้: เซิร์ฟเวอร์บันทึกการยืนยัน หน้าเว็บเขียนไฟล์เอง
  const prep3 = await (await json(`/sessions/${id}/export/prepare`, 'POST', {})).json();
  r = await confirm({ target: 'local', folder: 'HemoData', confirmed_at: prep3.confirmed_at, sha256: prep3.sha256 }, undefined);
  assert.equal(r.status, 201);
  const local = await r.json();
  assert.equal(local.target, 'local');
  assert.equal(local.pdf_path, `HemoData/2026/2026-10-16/${prep3.name}.pdf`);
  detail = await (await fetch(`${base}/sessions/${id}`)).json();
  assert.equal(detail.export.edited_after, false);

  const audit = await (await fetch(`${base}/audit?session_id=${id}`)).json();
  assert.ok(audit.some((a) => a.table_name === 'session_exports' && a.action === 'INSERT'));
  await assert.rejects(pool.query('DELETE FROM session_exports WHERE id = $1', [exp.id]), /append-only/);
});
