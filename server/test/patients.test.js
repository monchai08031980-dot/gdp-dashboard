// ไฟล์ทดสอบใช้ข้อมูลจำลองเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { app } from '../src/app.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
after(async () => { server.close(); await pool.end(); });

const headers = (extra = {}) => ({ 'X-User-Name': encodeURIComponent('test-nurse'), 'X-User-Role': 'NURSE', ...extra });
const json = (method, body) => ({ method, headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const PDF = Buffer.from('%PDF-1.4\n%mock\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const upload = (patientId, kind, buf, type, name) => fetch(`${base}/patients/${patientId}/files?kind=${kind}`, {
  method: 'POST', headers: headers({ 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }), body: buf,
});

test('เพิ่ม แก้ไข ลบผู้ป่วย พร้อมรูปและไฟล์แนบ และทุกขั้นตอนอยู่ใน audit log', async () => {
  const hn = `TEST-P-${Date.now()}`;
  const created = await fetch(`${base}/patients`, json('POST', { hn, first_name: 'ทดสอบ', last_name: 'ไฟล์แนบ', sex: 'M' }));
  assert.equal(created.status, 201);
  const p = await created.json();

  assert.equal((await fetch(`${base}/patients/${p.id}`, json('PATCH', { payer: 'บัตรทอง' }))).status, 200);

  // รูปผู้ป่วย
  const photo = await upload(p.id, 'PHOTO', JPEG, 'image/jpeg', 'รูป.jpg');
  assert.equal(photo.status, 201);
  const photoRow = await photo.json();
  assert.equal((await (await fetch(`${base}/patients/${p.id}`)).json()).photo_file_id, photoRow.id);
  const got = await fetch(`${base}/patients/${p.id}/files/${photoRow.id}`);
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), JPEG);

  // เอกสาร PDF และ JPG
  assert.equal((await upload(p.id, 'DOCUMENT', PDF, 'application/pdf', 'ผลแล็บ.pdf')).status, 201);
  assert.equal((await upload(p.id, 'DOCUMENT', JPEG, 'image/jpeg', 'scan.JPG')).status, 201);
  // ชนิดไฟล์อื่น หรือเนื้อไฟล์ไม่ตรงชนิด ถูกปฏิเสธ
  assert.equal((await upload(p.id, 'DOCUMENT', Buffer.from('hello'), 'text/plain', 'a.txt')).status, 415);
  assert.equal((await upload(p.id, 'DOCUMENT', Buffer.from('not a pdf'), 'application/pdf', 'fake.pdf')).status, 415);
  assert.equal((await upload(p.id, 'PHOTO', PDF, 'application/pdf', 'x.pdf')).status, 415);

  let files = await (await fetch(`${base}/patients/${p.id}/files`)).json();
  assert.equal(files.length, 3);
  const pdf = files.find((f) => f.mime_type === 'application/pdf');
  assert.equal((await fetch(`${base}/patients/${p.id}/files/${pdf.id}`, { method: 'DELETE', headers: headers() })).status, 204);
  files = await (await fetch(`${base}/patients/${p.id}/files`)).json();
  assert.equal(files.length, 2);

  // ลบผู้ป่วย = ซ่อนจากรายชื่อ แต่ข้อมูลยังอยู่
  assert.equal((await fetch(`${base}/patients/${p.id}`, { method: 'DELETE', headers: headers() })).status, 200);
  const list = await (await fetch(`${base}/patients?q=${hn}`)).json();
  assert.equal(list.length, 0);
  assert.equal((await (await fetch(`${base}/patients/${p.id}`)).json()).active, false);

  const log = await (await fetch(`${base}/audit?patient_id=${p.id}`)).json();
  const summary = log.map((a) => `${a.table_name}:${a.action}`);
  for (const step of ['patients:INSERT', 'patients:UPDATE', 'patient_files:INSERT', 'patient_files:UPDATE']) {
    assert.ok(summary.includes(step), `missing ${step} in ${summary}`);
  }
  assert.equal(summary.filter((s) => s === 'patient_files:INSERT').length, 3);
  assert.ok(log.every((a) => a.changed_by === 'test-nurse'));
});

test('เนื้อไฟล์แก้ไขหรือลบไม่ได้', async () => {
  await assert.rejects(pool.query("UPDATE file_contents SET content = '\\x00'"), /write-once/);
});

test('บันทึกรอบฟอกประจำของผู้ป่วย และรับเฉพาะวันที่ถูกต้อง', async () => {
  const hn = `TEST-R-${Date.now()}`;
  const ok = await fetch(`${base}/patients`, json('POST', { hn, first_name: 'รอบ', last_name: 'ประจำ', regular_shift: '2', regular_days: ['TUE', 'THU', 'SAT'] }));
  assert.equal(ok.status, 201);
  const p = await ok.json();
  assert.equal(p.regular_shift, 2);
  assert.deepEqual(p.regular_days, ['TUE', 'THU', 'SAT']);
  const bad = await fetch(`${base}/patients/${p.id}`, json('PATCH', { regular_days: ['XYZ'] }));
  assert.equal(bad.status, 400);
  const badShift = await fetch(`${base}/patients/${p.id}`, json('PATCH', { regular_shift: 5 }));
  assert.equal(badShift.status, 400);
  // รอบ 4 ปิดอยู่ตามค่าตั้งต้น จึงเลือกเป็นรอบประจำไม่ได้
  const closed = await fetch(`${base}/patients/${p.id}`, json('PATCH', { regular_shift: 4 }));
  assert.equal(closed.status, 400);
  assert.match((await closed.json()).error, /ไม่ได้เปิดในการตั้งค่ารอบ/);
  assert.equal((await fetch(`${base}/patients/${p.id}`, json('PATCH', { regular_shift: 3 }))).status, 200);
});

test('ลบผู้ป่วยแล้วย้ายไปข้อมูลผู้ป่วยเก่า ยกเลิกนัดที่ยังไม่ถึง และนำกลับมาได้', async () => {
  const hn = `TEST-ARC-${Date.now()}`;
  const p = await (await fetch(`${base}/patients`, json('POST', { hn, first_name: 'ย้าย', last_name: `ข้อมูลเก่า${Date.now()}` }))).json();
  const d = new Date(); d.setDate(d.getDate() + 3);
  const future = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal((await fetch(`${base}/schedule`, json('POST', { patient_id: p.id, shift: 1, dates: [future] }))).status, 201);

  const del = await fetch(`${base}/patients/${p.id}`, { method: 'DELETE', headers: headers({ 'X-Edit-Reason': encodeURIComponent('ย้ายไปรักษาที่อื่น') }) });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).cancelled_bookings, 1);
  assert.equal((await (await fetch(`${base}/patients?q=${hn}`)).json()).length, 0);
  const old = await (await fetch(`${base}/patients?archived=1&q=${hn}`)).json();
  assert.equal(old.length, 1);
  assert.equal(old[0].archive_reason, 'ย้ายไปรักษาที่อื่น');
  assert.ok(old[0].archived_at);
  assert.equal((await (await fetch(`${base}/schedule?patient_id=${p.id}`)).json()).length, 0);
  // ข้อมูลเก่าแก้ไขไม่ได้จนกว่าจะนำกลับ
  assert.equal((await fetch(`${base}/patients/${p.id}`, json('PATCH', { payer: 'บัตรทอง' }))).status, 409);

  const back = await fetch(`${base}/patients/${p.id}/restore`, json('POST', {}));
  assert.equal(back.status, 200);
  const restored = await back.json();
  assert.equal(restored.active, true);
  assert.equal(restored.archived_at, null);
  assert.equal((await (await fetch(`${base}/patients?archived=1&q=${hn}`)).json()).length, 0);
  assert.equal((await fetch(`${base}/patients/${p.id}/restore`, json('POST', {}))).status, 404);
  const log = await (await fetch(`${base}/audit?table=patients&record_id=${p.id}`)).json();
  assert.ok(log.some((a) => a.changed_fields?.includes('archived_at') && a.reason === 'ย้ายไปรักษาที่อื่น'));
});
