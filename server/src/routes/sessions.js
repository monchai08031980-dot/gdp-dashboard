import { Router } from 'express';
import { pool, withAudit } from '../db.js';
import { pick, insertSql, updateSql } from '../crud.js';

// ฟิลด์ตามแบบฟอร์ม 519
const COLUMNS = [
  'patient_id', 'session_date', 'shift', 'bed_no', 'machine_no', 'session_no',
  'pre_weight_kg', 'dry_weight_kg', 'pre_bp_sys', 'pre_bp_dia', 'pre_pulse', 'pre_temp_c', 'pre_rr', 'pre_o2sat', 'pre_symptoms',
  'dialyzer', 'dialyzer_reuse_no', 'duration_min', 'blood_flow_ml_min', 'dialysate_flow_ml_min',
  'dialysate_na', 'dialysate_k', 'dialysate_ca', 'dialysate_hco3', 'dialysate_temp_c', 'uf_goal_ml',
  'anticoagulant', 'heparin_loading_iu', 'heparin_maintenance_iu', 'access_used', 'needle_size',
  'start_time', 'end_time',
  'post_weight_kg', 'post_bp_sys', 'post_bp_dia', 'post_pulse', 'post_temp_c', 'actual_uf_ml', 'kt_v', 'urr_pct',
  'medications', 'complications', 'nursing_notes', 'physician_orders', 'nurse_name', 'physician_name', 'status',
];
const VITAL_COLUMNS = [
  'recorded_at', 'bp_sys', 'bp_dia', 'pulse', 'blood_flow_ml_min', 'venous_pressure', 'arterial_pressure',
  'tmp', 'uf_rate_ml_h', 'uf_volume_ml', 'heparin_iu', 'note',
];

const router = Router();

router.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.date) where.push(`s.session_date = $${params.push(req.query.date)}`);
  if (req.query.patient_id) where.push(`s.patient_id = $${params.push(req.query.patient_id)}`);
  const { rows } = await pool.query(
    `SELECT s.*, p.hn, p.prefix, p.first_name, p.last_name
     FROM dialysis_sessions s JOIN patients p ON p.id = s.patient_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.session_date DESC, s.shift, s.bed_no
     LIMIT 200`,
    params,
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, p.hn, p.prefix, p.first_name, p.last_name
     FROM dialysis_sessions s JOIN patients p ON p.id = s.patient_id WHERE s.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรอบการฟอก' });
  const vitals = await pool.query('SELECT * FROM intradialytic_vitals WHERE session_id = $1 ORDER BY recorded_at', [req.params.id]);
  res.json({ ...rows[0], vitals: vitals.rows });
});

router.post('/', async (req, res) => {
  const row = await withAudit(req.user, req.reason, async (db) => (await db.query(insertSql('dialysis_sessions', pick(req.body, COLUMNS)))).rows[0]);
  res.status(201).json(row);
});

router.patch('/:id', async (req, res) => {
  const data = pick(req.body, COLUMNS);
  if (!Object.keys(data).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
  const row = await withAudit(req.user, req.reason, async (db) => (await db.query(updateSql('dialysis_sessions', req.params.id, data))).rows[0]);
  if (!row) return res.status(404).json({ error: 'ไม่พบรอบการฟอก' });
  res.json(row);
});

router.post('/:id/vitals', async (req, res) => {
  const data = { ...pick(req.body, VITAL_COLUMNS), session_id: req.params.id };
  const row = await withAudit(req.user, req.reason, async (db) => (await db.query(insertSql('intradialytic_vitals', data))).rows[0]);
  res.status(201).json(row);
});

export default router;
