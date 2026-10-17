// เสียงเตือนและ SMS เมื่อค่าผิดปกติระหว่างฟอก ใช้ตัวส่ง SMS จำลอง ไม่ส่งจริง และใช้ข้อมูลจำลองเท่านั้น
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withAudit } from '../src/db.js';
import { app } from '../src/app.js';
import { setSmsSender } from '../src/alertNotify.js';
import { normalizeAlertSettings, normalizePhone, smsMessage } from '../public/alertSettings.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
const saved = (await pool.query("SELECT value FROM app_settings WHERE key = 'hd_alert'")).rows[0]?.value ?? null;
after(async () => {
  setSmsSender(null);
  await withAudit('test', 'คืนค่าตั้งหลังทดสอบ', (db) => saved === null
    ? db.query("DELETE FROM app_settings WHERE key = 'hd_alert'")
    : db.query("UPDATE app_settings SET value = $1 WHERE key = 'hd_alert'", [saved]));
  server.close();
  await pool.end();
});

const headers = { 'X-User-Name': encodeURIComponent('พยาบาล'), 'X-User-Role': 'NURSE', 'Content-Type': 'application/json' };
const call = (path, method = 'GET', body) => fetch(base + path, { method, headers, body: body && JSON.stringify(body) });

test('ตรวจค่าตั้งการเตือนและเบอร์มือถือ', () => {
  assert.equal(normalizePhone('081-234-5678'), '0812345678');
  assert.equal(normalizePhone('+66 81 234 5678'), '0812345678');
  assert.equal(normalizePhone('021234567'), null);
  const { value, errors } = normalizeAlertSettings({ sound: { tone: 'siren', volume: 150, repeat: 2 }, sms: { enabled: true, phones: '0812345678\n0812345678\n12345' } });
  assert.equal(value.sound.tone, 'siren');
  assert.equal(value.sound.volume, 70);
  assert.deepEqual(value.sms.phones, ['0812345678']);
  assert.equal(errors.length, 1);
  assert.match(normalizeAlertSettings({ sms: { enabled: true, phones: [] } }).errors[0], /อย่างน้อย 1 เบอร์/);
  const msg = smsMessage({ bed_no: 5, shift: 1, first_name: 'ทดสอบ', hn: 'HN1' }, '11:30:00', [{ text: 'ความดันต่ำ SBP 82' }]);
  assert.equal(msg, '[Hemo Sync] เตียง 5 รอบ 1 เวลา 11:30: ความดันต่ำ SBP 82');
});

test('บันทึกค่าผิดปกติแล้วส่ง SMS ครั้งเดียว ไม่มีชื่อผู้ป่วย และมีบันทึกการส่ง', async () => {
  const sent = [];
  setSmsSender(async (to, message) => { if (to === '0899999999') throw new Error('เบอร์ปิด'); sent.push({ to, message }); });
  assert.equal((await call('/settings/hd-alert', 'PUT', { sms: { enabled: true, phones: ['abc'] } })).status, 400);
  const put = await call('/settings/hd-alert', 'PUT', { sound: { tone: 'chime' }, sms: { enabled: true, level: 'danger', phones: ['081-234-5678', '0899999999'] } });
  assert.equal(put.status, 200);
  const settings = await (await call('/settings')).json();
  assert.equal(settings.hd_alert.sound.tone, 'chime');
  assert.equal(settings.sms_ready, true);

  const patient = await (await call('/patients', 'POST', { hn: `TEST-SMS-${Date.now()}`, first_name: 'ทดสอบ', last_name: 'เตือน', sex: 'F' })).json();
  const session = await (await call('/sessions', 'POST', { patient_id: patient.id, session_date: '2026-10-16', bed_no: 7, shift: 2, pre_bp_sys: 150 })).json();
  // ค่าปกติ: ไม่ส่ง
  const ok = await (await call(`/sessions/${session.id}/vitals`, 'POST', { recorded_time: '09:00', bp_sys: 140, bp_dia: 80, pr: 80 })).json();
  assert.deepEqual(ok.sms, []);
  // SBP ลด 25 เป็นแค่ warn: ตั้งไว้ส่งเฉพาะอันตราย จึงไม่ส่ง
  const warn = await (await call(`/sessions/${session.id}/vitals`, 'POST', { recorded_time: '10:00', bp_sys: 125, pr: 80 })).json();
  assert.deepEqual(warn.sms, []);
  // ความดันต่ำ: ส่ง
  const low = await call(`/sessions/${session.id}/vitals`, 'POST', { recorded_time: '11:30', bp_sys: 82, pr: 80 });
  assert.equal(low.status, 201);
  const row = await low.json();
  assert.deepEqual(row.sms.map((r) => [r.phone, r.status]), [['081-xxx-5678', 'SENT'], ['089-xxx-9999', 'FAILED']]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message, '[Hemo Sync] เตียง 7 รอบ 2 เวลา 11:30: ความดันต่ำ SBP 82 (ต่ำกว่า 90)');
  assert.doesNotMatch(sent[0].message, /ทดสอบ|TEST-SMS/);
  // แก้แถวเดิม ค่าเดิมไม่ส่งซ้ำ แต่ค่าใหม่ที่อันตรายส่ง
  const edit = await (await call(`/sessions/${session.id}/vitals/${row.id}`, 'PATCH', { bp_sys: 80, pr: 130 })).json();
  assert.equal(sent.length, 2);
  assert.match(sent[1].message, /ชีพจรเร็ว PR 130/);
  assert.doesNotMatch(sent[1].message, /SBP/);
  assert.equal(edit.sms[0].status, 'SENT');

  const detail = await (await call(`/sessions/${session.id}`)).json();
  assert.equal(detail.notifications.length, 4);
  assert.ok(detail.notifications.every((n) => /^0\d{2}-xxx-\d{4}$/.test(n.phone)));
  const audit = await (await call(`/audit?session_id=${session.id}`)).json();
  assert.ok(audit.some((a) => a.table_name === 'alert_notifications'));
  await assert.rejects(pool.query('DELETE FROM alert_notifications WHERE session_id = $1', [session.id]), /append-only/);

  // ไม่ได้ตั้งผู้ให้บริการ: ยังบันทึกได้ และบันทึกว่ายังไม่ได้ส่ง
  setSmsSender(null);
  const prev = process.env.SMS_WEBHOOK_URL;
  delete process.env.SMS_WEBHOOK_URL;
  const none = await (await call(`/sessions/${session.id}/vitals`, 'POST', { recorded_time: '12:00', bp_sys: 150, conductivity_ms_cm: 16 })).json();
  assert.deepEqual(none.sms.map((r) => r.status), ['NOT_CONFIGURED', 'NOT_CONFIGURED']);
  const test = await (await call('/settings/hd-alert/test-sms', 'POST', {})).json();
  assert.equal(test.results[0].status, 'NOT_CONFIGURED');
  if (prev !== undefined) process.env.SMS_WEBHOOK_URL = prev;
});
