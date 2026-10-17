// ส่ง SMS เมื่อบันทึกค่าผิดปกติระหว่างฟอก ไปยังเบอร์มือถือที่ตั้งไว้ (ค่าตั้งใน app_settings key 'hd_alert')
// ส่งผ่านผู้ให้บริการ SMS ที่โรงพยาบาลเลือก: ตั้ง SMS_WEBHOOK_URL (และ SMS_WEBHOOK_TOKEN ถ้ามี)
// ระบบจะ POST JSON { to, message } ไปที่ URL นั้น ถ้ายังไม่ได้ตั้ง จะบันทึกไว้ว่าไม่ได้ส่ง
// ข้อความไม่มีชื่อหรือ HN ผู้ป่วย และทุกครั้งที่ส่งบันทึกลง alert_notifications (มี audit log)
import { pool, withAudit } from './db.js';
import { loadSession } from './dataExport.js';
import { hdAlerts } from '../public/hdAlerts.js';
import { normalizeAlertSettings, smsMessage, meets, maskPhone } from '../public/alertSettings.js';

const KEY = 'hd_alert';
const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function getAlertSettings(db = pool) {
  const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [KEY]);
  let saved = {};
  try { saved = rows[0]?.value ? JSON.parse(rows[0].value) : {}; } catch {}
  return normalizeAlertSettings(saved).value;
}

export async function setAlertSettings(actor, reason, input) {
  const { value, errors } = normalizeAlertSettings(input || {});
  if (errors.length) throw httpError(400, errors.join(' · '));
  await withAudit(actor, reason || 'ตั้งค่าการเตือนระหว่างฟอก', (db) => db.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, JSON.stringify(value)]));
  return value;
}

// ตัวส่ง SMS: ทดสอบใส่ตัวจำลองแทนได้ (ไม่ส่งจริงใน dev/test)
let sender = null;
export function setSmsSender(fn) { sender = fn; }
function activeSender() {
  if (sender) return sender;
  const url = process.env.SMS_WEBHOOK_URL;
  if (!url) return null;
  return async (to, message) => {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.SMS_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.SMS_WEBHOOK_TOKEN}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ to, message }), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`ผู้ให้บริการ SMS ตอบ ${res.status}`);
  };
}
export const smsReady = () => Boolean(activeSender());

async function sendTo(phone, message) {
  const send = activeSender();
  if (!send) return { status: 'NOT_CONFIGURED', error: 'ยังไม่ได้ตั้งค่าผู้ให้บริการ SMS (SMS_WEBHOOK_URL)' };
  try {
    await send(phone, message);
    return { status: 'SENT', error: null };
  } catch (err) {
    return { status: 'FAILED', error: String(err?.message || err).slice(0, 300) };
  }
}

// หลังบันทึกแถว vital signs: ส่ง SMS สำหรับค่าผิดปกติของแถวนั้นที่ยังไม่เคยส่ง คืน [{ phone (ปิดเลขบางส่วน), status }]
// การส่งไม่สำเร็จไม่ทำให้การบันทึกล้มเหลว
export async function notifyVital(actor, sessionId, vitalId) {
  const settings = await getAlertSettings();
  if (!settings.sms.enabled || !settings.sms.phones.length) return [];
  const data = await loadSession(sessionId);
  const i = data?.vitals.findIndex((v) => v.id === vitalId) ?? -1;
  if (i < 0) return [];
  const alerts = hdAlerts(data.vitals, data.session).rows[i].filter((a) => meets(a.level, settings.sms.level));
  if (!alerts.length) return [];
  const { rows: done } = await pool.query('SELECT field, phone FROM alert_notifications WHERE vital_id = $1', [vitalId]);
  const out = [];
  for (const phone of settings.sms.phones) {
    const fresh = alerts.filter((a) => !done.some((d) => d.field === a.field && d.phone === phone))
      .filter((a, k, all) => all.findIndex((b) => b.field === a.field) === k);
    if (!fresh.length) continue;
    const message = smsMessage(data.session, data.vitals[i].recorded_time, fresh);
    const result = await sendTo(phone, message);
    await withAudit(actor, 'แจ้งเตือนค่าผิดปกติระหว่างฟอกทาง SMS', async (db) => {
      for (const a of fresh) {
        await db.query(
          `INSERT INTO alert_notifications (session_id, vital_id, field, level, phone, message, status, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (vital_id, field, phone) DO NOTHING`,
          [sessionId, vitalId, a.field, a.level, phone, message, result.status, result.error]);
      }
    });
    out.push({ phone: maskPhone(phone), status: result.status, error: result.error });
  }
  return out;
}

// ประวัติการแจ้งเตือนของรอบฟอก (ปิดเลขบางส่วนของเบอร์)
export async function sessionNotifications(sessionId) {
  const { rows } = await pool.query(
    `SELECT vital_id, field, level, phone, status, error, created_at FROM alert_notifications WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  return rows.map((r) => ({ ...r, phone: maskPhone(r.phone) }));
}

// ส่ง SMS ทดสอบไปทุกเบอร์ที่ตั้งไว้ (ไม่มีข้อมูลผู้ป่วย)
export async function sendTestSms() {
  const { sms } = await getAlertSettings();
  if (!sms.phones.length) throw httpError(400, 'ยังไม่ได้ใส่เบอร์มือถือ');
  const out = [];
  for (const phone of sms.phones) out.push({ phone: maskPhone(phone), ...(await sendTo(phone, '[Hemo Sync] ทดสอบการแจ้งเตือนระหว่างฟอก ได้รับข้อความนี้แสดงว่าตั้งค่าเบอร์ถูกต้อง')) });
  return out;
}
