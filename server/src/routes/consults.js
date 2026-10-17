import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// รายการปรึกษาแพทย์ทุกเตียง: ?status=open (รอคำสั่ง) | answered | all  &date=YYYY-MM-DD (วันที่ฟอก)
// สร้างและบันทึกคำสั่งแพทย์ผ่าน /api/sessions/:id/consults
router.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status === 'open') where.push('c.answered_at IS NULL');
  if (req.query.status === 'answered') where.push('c.answered_at IS NOT NULL');
  if (req.query.date) where.push(`s.session_date = $${params.push(req.query.date)}`);
  const { rows } = await pool.query(
    `SELECT c.*, s.session_date, s.shift, s.bed_no, s.patient_id, p.hn, p.prefix, p.first_name, p.last_name
     FROM doctor_consults c JOIN dialysis_sessions s ON s.id = c.session_id JOIN patients p ON p.id = s.patient_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (c.answered_at IS NULL) DESC, CASE c.urgency WHEN 'STAT' THEN 0 WHEN 'URGENT' THEN 1 ELSE 2 END, c.created_at DESC
     LIMIT 300`,
    params,
  );
  res.json(rows);
});

export default router;
