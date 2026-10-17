import { Router } from 'express';
import { pool, withAudit } from '../db.js';
import { pick, insertSql, updateSql } from '../crud.js';
import { ASSESSMENT_FIELDS } from '../../public/form519.js';
import { planSchedule } from '../../public/autoPlan.js';

const ASSESSMENT_COLUMNS = ASSESSMENT_FIELDS.map((f) => f.name);

// ---------------------------------------------------------------------------
// การตั้งค่ารอบฟอก: GET /api/shifts, PUT /api/shifts
// ---------------------------------------------------------------------------
export const shifts = Router();

// แต่ละรอบมีสรุปผู้ป่วยประจำ (รวมและแยกวัน) และจำนวนนัดของวันนี้ ไว้แสดงในหน้าตั้งค่ารอบ
shifts.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT s.*,
      (SELECT count(*)::int FROM patients p WHERE p.active AND p.regular_shift = s.shift) AS regular_patients,
      (SELECT coalesce(jsonb_object_agg(d, n), '{}') FROM (
        SELECT d, count(*)::int AS n FROM patients p, unnest(p.regular_days) AS d
        WHERE p.active AND p.regular_shift = s.shift GROUP BY d) x) AS regular_by_day,
      (SELECT count(*)::int FROM schedule_entries e
        WHERE e.shift = s.shift AND e.status = 'PLANNED' AND e.schedule_date = current_date) AS booked_today
    FROM shift_settings s ORDER BY s.shift`);
  res.json(rows);
});

// body: [{ shift, active, beds, start_time }] คืนเฉพาะรอบที่เปลี่ยน
shifts.put('/', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  const rows = await withAudit(req.actor, req.reason, async (db) => {
    const out = [];
    for (const s of req.body) {
      const { rows: r } = await db.query(
        // แก้เฉพาะรอบที่ค่าเปลี่ยน เวลาบันทึกล่าสุดและ audit log จึงตรงกับรอบที่แก้จริง
        `UPDATE shift_settings SET active = $2, beds = $3, start_time = $4
         WHERE shift = $1 AND (active, beds, start_time) IS DISTINCT FROM ($2, $3, $4::time) RETURNING *`,
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
  SELECT e.*, p.hn, p.prefix, p.first_name, p.last_name, p.photo_file_id, s.pre_weight_kg IS NOT NULL AS assessed
  FROM schedule_entries e JOIN patients p ON p.id = e.patient_id LEFT JOIN dialysis_sessions s ON s.id = e.session_id`;

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
  const created = await withAudit(req.actor, req.reason, async (db) => {
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

// ---------------------------------------------------------------------------
// จัดนัดให้: เสนอนัดตามรอบและวันประจำของผู้ป่วย (public/autoPlan.js) แล้วบันทึกเฉพาะที่พยาบาลเลือก
// ---------------------------------------------------------------------------
const MAX_PLAN_DAYS = 31;
function planDates(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || to < from) return null;
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); out.length <= MAX_PLAN_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > to) return out;
    out.push(iso);
  }
  return out.length > MAX_PLAN_DAYS ? false : out;
}

// GET /api/schedule/auto-plan?from=&to=  ยังไม่บันทึกอะไร
schedule.get('/auto-plan', async (req, res) => {
  const all = planDates(req.query.from, req.query.to);
  if (all === null) return res.status(400).json({ error: 'กรุณาระบุช่วงวันที่' });
  if (all === false) return res.status(400).json({ error: `จัดนัดได้ครั้งละไม่เกิน ${MAX_PLAN_DAYS} วัน` });
  const today = (await pool.query("SELECT to_char(current_date, 'YYYY-MM-DD') AS d")).rows[0].d;
  const dates = all.filter((d) => d >= today);
  if (!dates.length) return res.json({ items: [], problems: [], already: 0 });
  const [patients, shifts, entries, usual] = await Promise.all([
    pool.query('SELECT id, hn, prefix, first_name, last_name, regular_shift, regular_days FROM patients WHERE active ORDER BY hn'),
    pool.query('SELECT shift, active, beds FROM shift_settings'),
    pool.query(`${ENTRY_SELECT} WHERE e.status = 'PLANNED' AND e.schedule_date BETWEEN $1 AND $2`, [dates[0], dates.at(-1)]),
    // เตียงที่ผู้ป่วยใช้บ่อยที่สุดในรอบประจำ ช่วง 90 วันก่อน
    pool.query(`SELECT DISTINCT ON (e.patient_id) e.patient_id, e.bed_no
      FROM schedule_entries e JOIN patients p ON p.id = e.patient_id AND p.regular_shift = e.shift
      WHERE e.status = 'PLANNED' AND e.bed_no IS NOT NULL AND e.schedule_date BETWEEN $1::date - 90 AND $1::date - 1
      GROUP BY e.patient_id, e.bed_no ORDER BY e.patient_id, count(*) DESC, max(e.schedule_date) DESC`, [dates[0]]),
  ]);
  res.json(planSchedule({
    dates,
    patients: patients.rows,
    shifts: shifts.rows,
    entries: entries.rows,
    usualBeds: Object.fromEntries(usual.rows.map((r) => [r.patient_id, r.bed_no])),
  }));
});

// POST /api/schedule/auto-book  body: { items: [{ patient_id, date, shift, bed_no }] }
// บันทึกทุกรายการในครั้งเดียว ถ้ามีรายการที่จองไม่ได้ (ข้อมูลเปลี่ยนระหว่างนั้น) จะไม่บันทึกเลยและบอกทุกรายการที่ติด
schedule.post('/auto-book', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'ยังไม่ได้เลือกนัด' });
  if (items.length > 2000) return res.status(400).json({ error: 'บันทึกได้ครั้งละไม่เกิน 2000 นัด' });
  const conflicts = [];
  const created = await withAudit(req.actor, req.reason || 'จัดนัดให้ตามรอบและวันประจำ', async (db) => {
    const rows = [];
    for (const it of items) {
      const { rows: p } = await db.query('SELECT id, hn, first_name, last_name FROM patients WHERE id = $1 AND active', [it.patient_id]);
      if (!p[0]) { conflicts.push({ ...it, problem: 'ไม่พบผู้ป่วย' }); continue; }
      const result = await bookOne(db, p[0], it.date, Number(it.shift), it.bed_no ? Number(it.bed_no) : null, null);
      if (result.problem) conflicts.push({ ...it, hn: p[0].hn, problem: result.problem });
      else rows.push(result.row);
    }
    if (conflicts.length) throw Object.assign(new Error('จองไม่สำเร็จ'), { status: 409 });
    return rows;
  }).catch((err) => {
    if (err.status === 409) return null;
    throw err;
  });
  if (!created) return res.status(409).json({ error: 'มีนัดที่จองไม่ได้ จึงยังไม่ได้บันทึก กรุณากดจัดนัดใหม่', conflicts });
  res.status(201).json({ created: created.length });
});

// PATCH /api/schedule/:id  เปลี่ยนเตียงหรือหมายเหตุ
schedule.patch('/:id', async (req, res) => {
  const data = {};
  if (Object.hasOwn(req.body || {}, 'bed_no')) data.bed_no = req.body.bed_no;
  if (Object.hasOwn(req.body || {}, 'note')) data.note = req.body.note || null;
  if (!Object.keys(data).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
  const row = await withAudit(req.actor, req.reason, async (db) => {
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
  const row = await withAudit(req.actor, req.reason, async (db) =>
    (await db.query("UPDATE schedule_entries SET status = 'CANCELLED' WHERE id = $1 AND status = 'PLANNED' RETURNING id", [req.params.id])).rows[0]);
  if (!row) return res.status(404).json({ error: 'ไม่พบนัด' });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// ซักประวัติเบื้องต้นของนัด (Pre dialysis assessment และน้ำหนัก)
// ค่าเก็บในแบบฟอร์ม 519 ของนัดนี้โดยตรง (schedule_entries.session_id) Hemodialysis sheet จึงแสดงค่าเดียวกัน
// ---------------------------------------------------------------------------
// ค่าตั้งต้นของแบบฟอร์มใหม่: Dry weight จากข้อมูลผู้ป่วย, Last BW จาก Post BW ของการฟอกครั้งก่อน
async function newSessionDefaults(db, entry) {
  const { rows } = await db.query(
    `SELECT p.dry_weight_kg, p.vascular_access AS access_type, p.access_side,
       (SELECT s.post_bw_kg FROM dialysis_sessions s WHERE s.patient_id = p.id AND s.post_bw_kg IS NOT NULL
          AND (s.session_date, s.shift) < ($2::date, $3::smallint) ORDER BY s.session_date DESC, s.shift DESC LIMIT 1) AS last_bw_kg,
       (SELECT coalesce(max(s.session_no), 0) + 1 FROM dialysis_sessions s WHERE s.patient_id = p.id) AS session_no
     FROM patients p WHERE p.id = $1`,
    [entry.patient_id, entry.schedule_date, entry.shift],
  );
  return rows[0];
}

schedule.get('/:id/assessment', async (req, res) => {
  const { rows } = await pool.query(`${ENTRY_SELECT} WHERE e.id = $1`, [req.params.id]);
  const entry = rows[0];
  if (!entry || entry.status !== 'PLANNED') return res.status(404).json({ error: 'ไม่พบนัด' });
  let values;
  if (entry.session_id) {
    const s = (await pool.query('SELECT * FROM dialysis_sessions WHERE id = $1', [entry.session_id])).rows[0];
    values = Object.fromEntries(ASSESSMENT_COLUMNS.map((c) => [c, s[c] ?? null]));
  } else {
    const d = await newSessionDefaults(pool, entry);
    values = Object.fromEntries(ASSESSMENT_COLUMNS.map((c) => [c, d[c] ?? null]));
  }
  res.json({ entry, session_id: entry.session_id, values });
});

// บันทึกการซักประวัติ: ครั้งแรกสร้างแบบฟอร์ม 519 (สถานะร่าง) ของนัดนี้ หรือผูกกับแบบฟอร์มของวันและรอบเดียวกันที่มีอยู่แล้ว
schedule.put('/:id/assessment', async (req, res) => {
  const data = pick(req.body, ASSESSMENT_COLUMNS);
  if (!Object.keys(data).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะบันทึก' });
  const session = await withAudit(req.actor, req.reason || 'ซักประวัติเบื้องต้น', async (db) => {
    const entry = (await db.query("SELECT * FROM schedule_entries WHERE id = $1 AND status = 'PLANNED' FOR UPDATE", [req.params.id])).rows[0];
    if (!entry) return null;
    let sessionId = entry.session_id;
    if (!sessionId) {
      const existing = await db.query(
        `SELECT s.id FROM dialysis_sessions s WHERE s.patient_id = $1 AND s.session_date = $2 AND s.shift = $3
           AND NOT EXISTS (SELECT 1 FROM schedule_entries e WHERE e.session_id = s.id) LIMIT 1`,
        [entry.patient_id, entry.schedule_date, entry.shift],
      );
      sessionId = existing.rows[0]?.id;
      if (!sessionId) {
        const d = await newSessionDefaults(db, entry);
        const row = {
          patient_id: entry.patient_id, session_date: entry.schedule_date, shift: entry.shift, bed_no: entry.bed_no, status: 'DRAFT',
          session_no: d.session_no, dry_weight_kg: d.dry_weight_kg, last_bw_kg: d.last_bw_kg, access_type: d.access_type, access_side: d.access_side,
        };
        sessionId = (await db.query(insertSql('dialysis_sessions', row))).rows[0].id;
      }
      await db.query('UPDATE schedule_entries SET session_id = $2 WHERE id = $1', [entry.id, sessionId]);
    }
    return (await db.query(updateSql('dialysis_sessions', sessionId, data))).rows[0];
  });
  if (!session) return res.status(404).json({ error: 'ไม่พบนัด' });
  res.json(session);
});
