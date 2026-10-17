// ปรึกษาแพทย์: รวบรวมภาวะอันตราย รายงาน SBAR บันทึกการปรึกษาและคำสั่งแพทย์ (ข้อมูลจำลองเท่านั้น)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { app } from '../src/app.js';
import { consultFindings, buildSbar } from '../public/consult.js';
import { setConsultReader } from '../src/screenReader.js';
import { cleanAiReview, aiReviewText } from '../public/consultAi.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
after(async () => { setConsultReader(null); server.close(); await pool.end(); });
const headers = { 'X-User-Name': encodeURIComponent('พยาบาล'), 'X-User-Role': 'NURSE', 'Content-Type': 'application/json' };
const call = (path, method = 'GET', body, h = headers) => fetch(base + path, { method, headers: h, body: body && JSON.stringify(body) });

const session = {
  bed_no: 5, shift: 1, pre_bp_sys: 150, pre_bp_dia: 80, dry_weight_kg: 60, pre_weight_kg: 63.5, weight_gain_kg: 3.4, target_uf_kg: 3,
  access_inflammation: true, access_other: 'แดงบวมรอบเข็ม venous', access_thrill: true, complications: ['hypotension'],
  pre_symptoms: ['chest_pain', 'itching'], nursing_management: ['trendelenburg', 'pause_uf'], time_start: '08:00:00',
};
const vitals = [
  { id: 'a', recorded_time: '08:00:00', bp_sys: 148, bp_dia: 80, pr: 80, total_uf_ml: 0 },
  { id: 'b', recorded_time: '09:30:00', bp_sys: 84, bp_dia: 50, pr: 112, total_uf_ml: 1500 },
];

test('รวบรวมภาวะอันตรายจากแบบฟอร์ม', () => {
  const f = consultFindings(session, vitals);
  const by = Object.fromEntries(f.map((x) => [x.key, x]));
  assert.equal(by['v:b:bp_sys'].topic, 'hypotension');
  assert.equal(by['v:b:bp_sys'].level, 'danger');
  assert.equal(by.access_inflammation.topic, 'access_swelling');
  assert.match(by.access_inflammation.text, /แดงบวมรอบเข็ม venous/);
  assert.equal(by['pre:chest_pain'].topic, 'chest_pain');
  assert.equal(by['pre:itching'], undefined);
  assert.equal(by.gain.level, 'warn');
  assert.equal(by.access_thrill, undefined);
  assert.equal(consultFindings({ ...session, access_thrill: false }, []).find((x) => x.key === 'access_thrill').topic, 'access_flow');
  assert.deepEqual(consultFindings({}, []), []);
});

test('รายงาน SBAR', () => {
  const text = buildSbar(session, vitals, { prefix: 'นาย', first_name: 'ทดสอบ', last_name: 'จำลอง', hn: 'TEST1', vascular_access: 'AVF', access_side: 'LT' },
    { topics: ['hypotension', 'other'], other: 'ผู้ป่วยกังวล', findings: ['09:30 ความดันต่ำ SBP 84'], requests: ['order', 'visit'], urgency: 'STAT', reporter: 'พยาบาล' });
  assert.match(text, /^ขอปรึกษาแพทย์ \(ด่วนมาก\)/);
  assert.match(text, /S: นายทดสอบ จำลอง HN TEST1 เตียง 5 รอบ 1/);
  assert.match(text, /เรื่องที่ปรึกษา: ความดันตก, ผู้ป่วยกังวล/);
  assert.match(text, /B: Access AVF LT, Dry weight 60 kg/);
  assert.match(text, /A: BP ก่อนฟอก 150\/80, ล่าสุด 09:30 BP 84\/50 PR 112, UF ได้ 1500 ml/);
  assert.match(text, /การพยาบาลที่ให้แล้ว: Trendelenburg, Pause UF/);
  assert.match(text, /R: ขอคำสั่งการรักษา, ขอให้แพทย์มาดูผู้ป่วย/);
});

test('บันทึกการปรึกษา ติ๊ก Notified Doctor และบันทึกคำสั่งแพทย์ พร้อม audit log', async () => {
  const patient = await (await call('/patients', 'POST', { hn: `TEST-CS-${Date.now()}`, first_name: 'ทดสอบ', last_name: 'ปรึกษา', sex: 'M' })).json();
  const s = await (await call('/sessions', 'POST', { patient_id: patient.id, session_date: '2026-10-16', bed_no: 4, nursing_management: ['monitor_vs'] })).json();
  const path = `/sessions/${s.id}/consults`;
  assert.equal((await call(path, 'POST', { topics: ['hypotension'], report: 'x' }, { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await call(path, 'POST', { topics: [], report: 'รายงาน' })).status, 400);
  assert.equal((await call(path, 'POST', { topics: ['hypotension'], report: '  ' })).status, 400);
  assert.equal((await call('/sessions/00000000-0000-0000-0000-000000000000/consults', 'POST', { topics: ['hypotension'], report: 'r' })).status, 404);
  const res = await call(path, 'POST', { topics: ['hypotension', 'nope'], findings: ['SBP 84'], requests: ['order'], urgency: 'STAT', report: 'ขอปรึกษาแพทย์ (ด่วนมาก)\nS: ...' });
  assert.equal(res.status, 201);
  const c = await res.json();
  assert.deepEqual([c.topics, c.urgency, c.reported_by, c.reported_by_role, c.answered_at], [['hypotension'], 'STAT', 'พยาบาล', 'NURSE', null]);
  let detail = await (await call(`/sessions/${s.id}`)).json();
  assert.deepEqual(detail.nursing_management, ['monitor_vs', 'notified_doctor']);
  assert.equal(detail.consults.length, 1);
  // ปรึกษาครั้งที่สองไม่ติ๊กซ้ำ
  await call(path, 'POST', { topics: ['fever'], report: 'ครั้งที่สอง' });
  detail = await (await call(`/sessions/${s.id}`)).json();
  assert.deepEqual(detail.nursing_management, ['monitor_vs', 'notified_doctor']);

  assert.equal((await call(`${path}/${c.id}`, 'PATCH', { doctor_name: 'นพ.จำลอง', doctor_order: '' })).status, 400);
  const ans = await (await call(`${path}/${c.id}`, 'PATCH', { doctor_name: 'นพ.จำลอง', doctor_order: 'NSS 100 ml stat, ลด UF' })).json();
  assert.equal(ans.doctor_order, 'NSS 100 ml stat, ลด UF');
  assert.ok(ans.answered_at);
  // รายการปรึกษาของทุกเตียง: กรองสถานะและวันที่ฟอก
  const open = await (await call('/consults?status=open&date=2026-10-16')).json();
  const mine = open.filter((x) => x.session_id === s.id);
  assert.deepEqual(mine.map((x) => x.topics), [['fever']]);
  assert.equal(mine[0].bed_no, 4);
  assert.equal(mine[0].first_name, 'ทดสอบ');
  const answered = await (await call('/consults?status=answered')).json();
  assert.ok(answered.some((x) => x.id === c.id));
  assert.ok(!(await (await call('/consults?status=open')).json()).some((x) => x.id === c.id));
  assert.ok(!(await (await call('/consults?date=2026-10-15')).json()).some((x) => x.session_id === s.id));
  const audit = await (await call(`/audit?session_id=${s.id}`)).json();
  assert.ok(audit.filter((a) => a.table_name === 'doctor_consults').length >= 3);
  assert.ok(audit.some((a) => a.table_name === 'dialysis_sessions' && a.action === 'UPDATE' && a.reason === 'ปรึกษาแพทย์'));
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

test('ผลจาก AI: กรองรหัสเรื่อง และข้อความสำหรับรายงานบอกว่าไม่ใช่การวินิจฉัย', () => {
  const r = cleanAiReview({ summary: 'บวมแดงรอบเข็ม', observations: [{ text: 'แดงบวม 2 ซม.', concern: 'high' }, { text: '', concern: 'low' }],
    red_flags: ['อาจติดเชื้อ'], possible_causes: ['อาจเข้าได้กับการอักเสบ'], suggested_topics: ['access_swelling', 'nope'], image_quality: 'x', notes: '' });
  assert.deepEqual(r.suggested_topics, ['access_swelling']);
  assert.equal(r.observations.length, 1);
  assert.equal(r.image_quality, 'good');
  const text = aiReviewText(r);
  assert.match(text, /ไม่ใช่การวินิจฉัย/);
  assert.match(text, /แดงบวม 2 ซม\. \(ควรให้แพทย์ดูโดยเร็ว\)/);
});

test('แนบรูปในการปรึกษา ให้ AI ดูรูป และเก็บข้อสังเกตจาก AI', async () => {
  const patient = await (await call('/patients', 'POST', { hn: `TEST-CSI-${Date.now()}`, first_name: 'ทดสอบ', last_name: 'รูป', sex: 'F' })).json();
  const s = await (await call('/sessions', 'POST', { patient_id: patient.id, session_date: '2026-10-16', bed_no: 6 })).json();

  // AI ดูรูป: ปิดอยู่ตอบ 501
  setConsultReader(null);
  const prev = process.env.SCREEN_READER;
  delete process.env.SCREEN_READER;
  const img = { data: JPEG.toString('base64') };
  assert.equal((await call('/consults/ai-review', 'POST', { images: [img] })).status, 501);
  assert.equal((await (await call('/health')).json()).consult_ai, false);
  if (prev !== undefined) process.env.SCREEN_READER = prev;

  let seen = null;
  setConsultReader(async (images, prompt) => { seen = { n: images.length, type: images[0].type, prompt };
    return { summary: 'บวมแดงรอบเข็ม venous', observations: [{ text: 'แดงบวม', concern: 'high' }], red_flags: [], possible_causes: [], suggested_topics: ['access_swelling'], image_quality: 'good', notes: '' }; });
  assert.equal((await (await call('/health')).json()).consult_ai, true);
  assert.equal((await call('/consults/ai-review', 'POST', { images: [] })).status, 400);
  assert.equal((await call('/consults/ai-review', 'POST', { images: [img, img, img, img, img] })).status, 400);
  assert.equal((await call('/consults/ai-review', 'POST', { images: [{ data: Buffer.from('nope').toString('base64') }] })).status, 415);
  assert.equal((await call('/consults/ai-review', 'POST', { images: [img] }, { 'Content-Type': 'application/json' })).status, 400);
  // รูปใหญ่กว่าคำขอทั่วไป (100kb) ต้องรับได้
  const big = { data: Buffer.concat([JPEG, Buffer.alloc(300 * 1024)]).toString('base64') };
  const review = await (await call('/consults/ai-review', 'POST', { images: [big, img], context: { topics: ['access_swelling'], findings: ['Vascular access มี Inflammation'] } })).json();
  assert.deepEqual(review.suggested_topics, ['access_swelling']);
  assert.equal(seen.n, 2);
  assert.equal(seen.type, 'image/jpeg');
  assert.match(seen.prompt, /Vascular access มี Inflammation/);
  assert.doesNotMatch(seen.prompt, /ทดสอบ|TEST-CSI/);

  const c = await (await call(`/sessions/${s.id}/consults`, 'POST', { topics: ['access_swelling'], report: 'รายงาน', ai_review: aiReviewText(review) })).json();
  assert.match(c.ai_review, /ไม่ใช่การวินิจฉัย/);
  assert.ok(c.ai_reviewed_at);
  const up = (body, type = 'image/jpeg') => fetch(`${base}/sessions/${s.id}/consults/${c.id}/images`, { method: 'POST', headers: { ...headers, 'Content-Type': type, 'X-File-Name': encodeURIComponent('แผล.jpg') }, body });
  assert.equal((await up(Buffer.from('nope'))).status, 415);
  const file = await (await up(JPEG)).json();
  assert.equal(file.file_name, 'แผล.jpg');
  const got = await fetch(`${base}/sessions/${s.id}/consults/${c.id}/images/${file.id}`);
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), JPEG);
  let detail = await (await call(`/sessions/${s.id}`)).json();
  assert.deepEqual(detail.consults[0].images.map((i) => i.id), [file.id]);
  const list = await (await call('/consults?date=2026-10-16')).json();
  assert.equal(list.find((x) => x.id === c.id).images.length, 1);
  // ไม่ปนกับเอกสารของผู้ป่วย และลบแบบเก็บประวัติ
  const files = await (await call(`/patients/${patient.id}/files`)).json();
  assert.ok(files.every((f) => f.kind !== 'DOCUMENT'));
  assert.equal((await call(`/sessions/${s.id}/consults/${c.id}/images/${file.id}`, 'DELETE')).status, 204);
  detail = await (await call(`/sessions/${s.id}`)).json();
  assert.deepEqual(detail.consults[0].images, []);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM file_contents WHERE file_id = $1', [file.id])).rows[0].n, 1);
});
