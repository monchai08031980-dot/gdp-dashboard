import express, { Router } from 'express';
import { pool, withAudit } from '../db.js';
import { pick, insertSql, updateSql } from '../crud.js';
import { readMachineScreen, imageType } from '../screenReader.js';
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
  const { rows } = await pool.query(
    `SELECT s.*, p.hn, p.prefix, p.first_name, p.last_name
     FROM dialysis_sessions s JOIN patients p ON p.id = s.patient_id WHERE s.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรอบการฟอก' });
  const vitals = await pool.query('SELECT * FROM intradialytic_vitals WHERE session_id = $1 ORDER BY recorded_time', [req.params.id]);
  const medications = await pool.query('SELECT * FROM session_medications WHERE session_id = $1 ORDER BY created_at', [req.params.id]);
  res.json({ ...rows[0], vitals: vitals.rows, medications: medications.rows });
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
    // เวลาบนอุปกรณ์ที่ถ่าย ใช้แยกนาฬิกาออกจากเวลาฟอก และเลือกเช้า/บ่ายของนาฬิกาแบบ 12 ชั่วโมง
    res.json(await readMachineScreen(req.body, type, { now: req.get('X-Local-Time') }));
  },
);

// แถวย่อยของแบบฟอร์ม: บันทึกระหว่างฟอก และยาระหว่างฟอก
for (const [path, table, columns] of [
  ['vitals', 'intradialytic_vitals', VITAL_COLUMNS],
  ['medications', 'session_medications', MEDICATION_COLUMNS],
]) {
  router.post(`/:id/${path}`, async (req, res) => {
    const data = { ...pick(req.body, columns), session_id: req.params.id };
    const row = await withAudit(req.actor, req.reason, async (db) => (await db.query(insertSql(table, data))).rows[0]);
    res.status(201).json(row);
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
    res.json(row);
  });

  router.delete(`/:id/${path}/:rowId`, async (req, res) => {
    const row = await withAudit(req.actor, req.reason, async (db) =>
      (await db.query(`DELETE FROM ${table} WHERE id = $1 AND session_id = $2 RETURNING id`, [req.params.rowId, req.params.id])).rows[0]);
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.status(204).end();
  });
}

export default router;
