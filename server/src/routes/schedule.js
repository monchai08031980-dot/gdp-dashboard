import { Router } from 'express';
import { pool, withAudit } from '../db.js';

// ---------------------------------------------------------------------------
// การตั้งค่ารอบฟอก: GET /api/shifts, PUT /api/shifts
// ---------------------------------------------------------------------------
export const shifts = Router();

shifts.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM shift_settings ORDER BY shift');
  res.json(rows);
});

// body: [{ shift, active, beds, start_time }]
shifts.put('/', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  const rows = await withAudit(req.user, req.reason, async (db) => {
    const out = [];
    for (const s of req.body) {
      const { rows: r } = await db.query(
        `UPDATE shift_settings SET active = $2, beds = $3, start_time = $4 WHERE shift = $1 RETURNING *`,
        [s.shift, Boolean(s.active), s.beds, s.start_time || null],
      );
      if (r[0]) out.push(r[0]);
    }
    return out;
  });
  res.json(rows);
});

// ---------------------------------------------------------------------------
// ตารางนัดฟอกล่วงหน้า
// ---------------------------------------------------------------------------
export const schedule = Router();

const ENTRY_SELECT = `
  SELECT e.*, p.hn, p.prefix, p.first_name, p.last_name, p.photo_file_id
  FROM schedule_entries e JOIN patients p ON p.id = e.patient_id`;

// GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD&shift=&patient_id=
schedule.get('/', async (req, res) => {
  const params = [];
  const where = ["e.status = 'PLANNED'"];
  if (req.query.from) where.push(`e.schedule_date >= $${params.push(req.query.from)}`);
  if (req.query.to) where.push(`e.schedule_date <= $${params.push(req.query.to)}`);
  if (req.query.shift) where.push(`e.shift = $${params.push(req.query.shift)}`);
  if (req.query.patient_id) where.push(`e.patient_id = $${params.push(req.query.patient_id)}`);
  const { rows } = await pool.query(
    `${ENTRY_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.schedule_date, e.shift, e.bed_no NULLS LAST LIMIT 5000`,
    params,
  );
  res.json(rows);
});

const normName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// ตรวจและจองหนึ่งวัน คืนข้อความปัญหา หรือแถวที่สร้างแล้ว
async function bookOne(db, patient, date, shift, wantedBed, note) {
  // กันการจองชนกันจากหลายเครื่องในรอบเดียวกัน
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`schedule:${date}:${shift}`]);
  const { rows: setting } = await db.query('SELECT active, beds, $2::date < current_date AS past FROM shift_settings WHERE shift = $1', [shift, date]);
  if (setting[0]?.past) return { problem: 'วันที่ผ่านมาแล้ว นัดล่วงหน้าได้ตั้งแต่วันนี้เป็นต้นไป' };
  if (!setting[0]?.active) return { problem: `ไม่ได้เปิดรอบ ${shift}` };

  const { rows: taken } = await db.query(
    `SELECT e.bed_no, e.patient_id, p.hn, p.first_name, p.last_name
     FROM schedule_entries e JOIN patients p ON p.id = e.patient_id
     WHERE e.schedule_date = $1 AND e.shift = $2 AND e.status = 'PLANNED'`,
    [date, shift],
  );
  if (taken.some((t) => t.patient_id === patient.id)) return { problem: `HN ${patient.hn} มีนัดในรอบนี้แล้ว` };
  const sameName = taken.find((t) => normName(`${t.first_name} ${t.last_name}`) === normName(`${patient.first_name} ${patient.last_name}`));
  if (sameName) return { problem: `ชื่อ ${patient.first_name} ${patient.last_name} ซ้ำกับผู้ป่วย HN ${sameName.hn} ที่นัดในรอบนี้แล้ว` };
  if (taken.length >= setting[0].beds) return { problem: `รอบ ${shift} เต็มแล้ว (${setting[0].beds} เตียง)` };

  const used = new Set(taken.map((t) => t.bed_no));
  let bed = wantedBed ?? null;
  if (bed !== null) {
    if (bed < 1 || bed > setting[0].beds) return { problem: `รอบ ${shift} ใช้เตียง 1-${setting[0].beds}` };
    if (used.has(bed)) return { problem: `เตียง ${bed} มีผู้ป่วยแล้ว` };
  } else {
    bed = Array.from({ length: setting[0].beds }, (_, i) => i + 1).find((b) => !used.has(b));
  }
  const { rows } = await db.query(
    `INSERT INTO schedule_entries (patient_id, schedule_date, shift, bed_no, note) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [patient.id, date, shift, bed, note || null],
  );
  return { row: rows[0] };
}

// POST /api/schedule  body: { patient_id, shift, bed_no?, dates: [YYYY-MM-DD], note? }
// จองทุกวันในครั้งเดียว ถ้ามีวันไหนติดปัญหาจะไม่จองเลยสักวัน และบอกทุกวันที่ติด
schedule.post('/', async (req, res) => {
  const { patient_id: patientId, shift, bed_no: bed, note } = req.body || {};
  const dates = [...new Set(Array.isArray(req.body?.dates) ? req.body.dates : [])].sort();
  if (!patientId || !shift || !dates.length) return res.status(400).json({ error: 'ต้องระบุผู้ป่วย รอบ และวันที่' });
  if (dates.length > 400) return res.status(400).json({ error: 'นัดได้ครั้งละไม่เกิน 400 วัน' });

  const conflicts = [];
  const created = await withAudit(req.user, req.reason, async (db) => {
    const { rows: p } = await db.query('SELECT id, hn, first_name, last_name FROM patients WHERE id = $1 AND active', [patientId]);
    if (!p[0]) throw Object.assign(new Error('ไม่พบผู้ป่วย'), { status: 404 });
    const rows = [];
    for (const date of dates) {
      const result = await bookOne(db, p[0], date, Number(shift), bed ? Number(bed) : null, note);
      if (result.problem) conflicts.push({ date, problem: result.problem });
      else rows.push(result.row);
    }
    if (conflicts.length) throw Object.assign(new Error('จองไม่สำเร็จ'), { status: 409 });
    return rows;
  }).catch((err) => {
    if (err.status === 409) return null;
    throw err;
  });
  if (!created) return res.status(409).json({ error: 'มีวันที่จองไม่ได้ จึงยังไม่ได้จองวันใดเลย', conflicts });
  res.status(201).json(created);
});

// PATCH /api/schedule/:id  เปลี่ยนเตียงหรือหมายเหตุ
schedule.patch('/:id', async (req, res) => {
  const data = {};
  if (Object.hasOwn(req.body || {}, 'bed_no')) data.bed_no = req.body.bed_no;
  if (Object.hasOwn(req.body || {}, 'note')) data.note = req.body.note || null;
  if (!Object.keys(data).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
  const row = await withAudit(req.user, req.reason, async (db) => {
    const { rows } = await db.query(
      `UPDATE schedule_entries SET ${Object.keys(data).map((k, i) => `${k} = $${i + 2}`).join(', ')}
       WHERE id = $1 AND status = 'PLANNED' RETURNING *`,
      [req.params.id, ...Object.values(data)],
    );
    return rows[0];
  });
  if (!row) return res.status(404).json({ error: 'ไม่พบนัด' });
  res.json(row);
});

// DELETE /api/schedule/:id  ยกเลิกนัด (เก็บประวัติไว้)
schedule.delete('/:id', async (req, res) => {
  const row = await withAudit(req.user, req.reason, async (db) =>
    (await db.query("UPDATE schedule_entries SET status = 'CANCELLED' WHERE id = $1 AND status = 'PLANNED' RETURNING id", [req.params.id])).rows[0]);
  if (!row) return res.status(404).json({ error: 'ไม่พบนัด' });
  res.status(204).end();
});
