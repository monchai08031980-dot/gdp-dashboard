import express, { Router } from 'express';
import { pool, withAudit } from '../db.js';
import { pick, insertSql, updateSql } from '../crud.js';
import { readMachineScreen, imageType } from '../screenReader.js';
import { loadSession, latestExport, prepareExport, confirmSession } from '../dataExport.js';
import { checkSession } from '../../public/sessionCheck.js';
import { notifyVital, sessionNotifications } from '../alertNotify.js';
import { CONSULT_TOPICS, CONSULT_REQUESTS, URGENCY } from '../../public/consult.js';
import { SESSION_COLUMNS, VITAL_FIELDS, MEDICATION_FIELDS } from '../../public/form519.js';

const VITAL_COLUMNS = VITAL_FIELDS.map((f) => f.name);
const MEDICATION_COLUMNS = MEDICATION_FIELDS.map((f) => f.name);

const router = Router();

// รายการรอบฟอก: ?date=&patient_id=&q=(HN หรือชื่อ)&limit=&offset=
// จำนวนทั้งหมดที่ตรงเงื่อนไขส่งกลับใน header X-Total-Count
router.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.date) where.push(`s.session_date = $${params.push(req.query.date)}`);
  if (req.query.patient_id) where.push(`s.patient_id = $${params.push(req.query.patient_id)}`);
  if (req.query.q?.trim()) {
    const q = params.push(`%${req.query.q.trim()}%`);
    where.push(`(p.hn ILIKE $${q} OR p.first_name ILIKE $${q} OR p.last_name ILIKE $${q}
      OR concat_ws(' ', p.first_name, p.last_name) ILIKE $${q} OR concat(p.prefix, p.first_name, ' ', p.last_name) ILIKE $${q})`);
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT s.*, p.hn, p.prefix, p.first_name, p.last_name, count(*) OVER () AS total_count
     FROM dialysis_sessions s JOIN patients p ON p.id = s.patient_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.session_date DESC, s.shift, s.bed_no
     LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );
  res.set('X-Total-Count', String(rows[0]?.total_count ?? 0));
  res.json(rows.map(({ total_count, ...row }) => row));
});

router.get('/:id', async (req, res) => {
  const data = await loadSession(req.params.id);
  if (!data) return res.status(404).json({ error: 'ไม่พบรอบการฟอก' });
  res.json({ ...data.session, vitals: data.vitals, medications: data.medications, export: await latestExport(req.params.id), notifications: await sessionNotifications(req.params.id), consults: await sessionConsults(req.params.id) });
});

// ตรวจแบบฟอร์มทั้งชุดก่อนยืนยัน (ยังไม่บันทึกอะไร)
router.get('/:id/check', async (req, res) => {
  const data = await loadSession(req.params.id);
  if (!data) return res.status(404).json({ error: 'ไม่พบรอบการฟอก' });
  res.json(checkSession(data.session, data));
});

// ยืนยันข้อมูลทั้งหมด ขั้นที่ 1: ตรวจแล้วส่งข้อมูลที่จะบันทึกกลับมาให้สร้างตัวอย่าง PDF (ยังไม่บันทึก)
router.post('/:id/export/prepare', async (req, res) => {
  res.json(await prepareExport(req.actor, req.params.id));
});

// ขั้นที่ 2: ยืนยันและบันทึก ?target=server|local|download&confirmed_at=&sha256=&ack=1&folder=
// target=server ส่งไฟล์ PDF มาใน body (application/pdf) เพื่อเขียนลงโฟลเดอร์บนเครื่องเซิร์ฟเวอร์
router.post('/:id/confirm', express.raw({ type: 'application/pdf', limit: 30 * 1024 * 1024 }), async (req, res) => {
  const q = req.query;
  const row = await confirmSession(req.actor, req.reason, req.params.id, {
    acknowledgeWarnings: q.ack === '1',
    confirmedAt: q.confirmed_at,
    sha256: q.sha256,
    target: q.target || 'server',
    folder: q.folder,
    pdf: Buffer.isBuffer(req.body) ? req.body : null,
  });
  res.status(201).json(row);
});

router.post('/', async (req, res) => {
  const row = await withAudit(req.actor, req.reason, async (db) => (await db.query(insertSql('dialysis_sessions', pick(req.body, SESSION_COLUMNS)))).rows[0]);
  res.status(201).json(row);
});

router.patch('/:id', async (req, res) => {
  const data = pick(req.body, SESSION_COLUMNS);
  if (!Object.keys(data).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
  const row = await withAudit(req.actor, req.reason, async (db) => (await db.query(updateSql('dialysis_sessions', req.params.id, data))).rows[0]);
  if (!row) return res.status(404).json({ error: 'ไม่พบรอบการฟอก' });
  res.json(row);
});

// อ่านค่าจากภาพหน้าจอเครื่องฟอก ยังไม่บันทึกอะไร ส่งค่ากลับให้พยาบาลตรวจแล้วกดบันทึกเองผ่าน POST /:id/vitals
router.post(
  '/:id/vitals/read-screen',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 10 * 1024 * 1024 }),
  async (req, res) => {
    if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
    const type = Buffer.isBuffer(req.body) ? imageType(req.body) : null;
    if (!type) return res.status(415).json({ error: 'รองรับเฉพาะภาพ JPG, PNG หรือ WEBP' });
    const { rows } = await pool.query('SELECT id FROM dialysis_sessions WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรอบการฟอก' });
    res.json(await readMachineScreen(req.body, type));
  },
);

// ปรึกษาแพทย์: บันทึกรายงาน SBAR ที่พยาบาลตรวจแล้ว และติ๊ก Notified Doctor ในแบบฟอร์มให้ในคราวเดียวกัน
const sessionConsults = async (id) => (await pool.query('SELECT * FROM doctor_consults WHERE session_id = $1 ORDER BY created_at', [id])).rows;
const keys = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter((k) => allowed.some(([a]) => a === k)))] : []);
const texts = (list) => (Array.isArray(list) ? list.map((t) => String(t).trim().slice(0, 300)).filter(Boolean).slice(0, 30) : []);

router.post('/:id/consults', async (req, res) => {
  if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  const b = req.body || {};
  const report = typeof b.report === 'string' ? b.report.trim() : '';
  if (!report) return res.status(400).json({ error: 'ยังไม่มีข้อความรายงานแพทย์' });
  if (report.length > 5000) return res.status(400).json({ error: 'ข้อความรายงานยาวเกินไป' });
  const topics = keys(b.topics, CONSULT_TOPICS);
  if (!topics.length) return res.status(400).json({ error: 'กรุณาเลือกเรื่องที่ปรึกษาอย่างน้อย 1 เรื่อง' });
  const urgency = URGENCY[b.urgency] ? b.urgency : 'URGENT';
  const row = await withAudit(req.actor, req.reason || 'ปรึกษาแพทย์', async (db) => {
    const s = (await db.query('SELECT nursing_management FROM dialysis_sessions WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!s) return null;
    if (!(s.nursing_management || []).includes('notified_doctor')) {
      await db.query("UPDATE dialysis_sessions SET nursing_management = array_append(coalesce(nursing_management, '{}'), 'notified_doctor') WHERE id = $1", [req.params.id]);
    }
    return (await db.query(
      `INSERT INTO doctor_consults (session_id, urgency, topics, findings, requests, report, reported_by, reported_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.id, urgency, topics, texts(b.findings), keys(b.requests, CONSULT_REQUESTS), report, req.actor.name, req.actor.role || null],
    )).rows[0];
  });
  if (!row) return res.status(404).json({ error: 'ไม่พบรอบการฟอก' });
  res.status(201).json(row);
});

// บันทึกคำสั่งแพทย์ที่ได้รับ (แก้ได้ ทุกครั้งมี audit log)
router.patch('/:id/consults/:consultId', async (req, res) => {
  if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  const order = typeof req.body?.doctor_order === 'string' ? req.body.doctor_order.trim() : '';
  const doctor = typeof req.body?.doctor_name === 'string' ? req.body.doctor_name.trim() : '';
  if (!order) return res.status(400).json({ error: 'กรุณากรอกคำสั่งแพทย์' });
  if (!doctor) return res.status(400).json({ error: 'กรุณากรอกชื่อแพทย์' });
  const row = await withAudit(req.actor, req.reason || 'บันทึกคำสั่งแพทย์', async (db) => (await db.query(
    `UPDATE doctor_consults SET doctor_name = $1, doctor_order = $2, answered_at = coalesce(answered_at, now())
     WHERE id = $3 AND session_id = $4 RETURNING *`, [doctor.slice(0, 200), order.slice(0, 5000), req.params.consultId, req.params.id])).rows[0]);
  if (!row) return res.status(404).json({ error: 'ไม่พบการปรึกษานี้' });
  res.json(row);
});

// แถวย่อยของแบบฟอร์ม: บันทึกระหว่างฟอก และยาระหว่างฟอก
for (const [path, table, columns] of [
  ['vitals', 'intradialytic_vitals', VITAL_COLUMNS],
  ['medications', 'session_medications', MEDICATION_COLUMNS],
]) {
  router.post(`/:id/${path}`, async (req, res) => {
    const data = { ...pick(req.body, columns), session_id: req.params.id };
    const row = await withAudit(req.actor, req.reason, async (db) => (await db.query(insertSql(table, data))).rows[0]);
    const sms = path === 'vitals' ? await notifyVital(req.actor, req.params.id, row.id).catch((err) => { console.error('SMS', err); return []; }) : undefined;
    res.status(201).json({ ...row, ...(sms && { sms }) });
  });

  router.patch(`/:id/${path}/:rowId`, async (req, res) => {
    const data = pick(req.body, columns);
    if (!Object.keys(data).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
    const row = await withAudit(req.actor, req.reason, async (db) => {
      const sql = updateSql(table, req.params.rowId, data);
      sql.text = sql.text.replace(' RETURNING *', ` AND session_id = $${sql.values.length + 1} RETURNING *`);
      sql.values.push(req.params.id);
      return (await db.query(sql)).rows[0];
    });
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
    const sms = path === 'vitals' ? await notifyVital(req.actor, req.params.id, row.id).catch((err) => { console.error('SMS', err); return []; }) : undefined;
    res.json({ ...row, ...(sms && { sms }) });
  });

  router.delete(`/:id/${path}/:rowId`, async (req, res) => {
    const row = await withAudit(req.actor, req.reason, async (db) =>
      (await db.query(`DELETE FROM ${table} WHERE id = $1 AND session_id = $2 RETURNING id`, [req.params.rowId, req.params.id])).rows[0]);
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.status(204).end();
  });
}

export default router;
