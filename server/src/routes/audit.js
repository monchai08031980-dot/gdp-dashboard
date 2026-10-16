import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// ประวัติการแก้ไขของระเบียนหนึ่ง ๆ: GET /api/audit?table=dialysis_sessions&record_id=...
// หรือทั้งแบบฟอร์มรวมแถวย่อย (บันทึกระหว่างฟอก ยา): GET /api/audit?session_id=...
// หรือข้อมูลผู้ป่วยรวมไฟล์แนบ: GET /api/audit?patient_id=...
router.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.table) where.push(`table_name = $${params.push(req.query.table)}`);
  if (req.query.record_id) where.push(`record_id = $${params.push(req.query.record_id)}`);
  if (req.query.patient_id) {
    const p = params.push(req.query.patient_id);
    where.push(`(record_id::text = $${p} OR (table_name = 'patient_files' AND
      (new_data->>'patient_id' = $${p} OR old_data->>'patient_id' = $${p})))`);
  }
  if (req.query.session_id) {
    const p = params.push(req.query.session_id);
    where.push(`(record_id::text = $${p} OR new_data->>'session_id' = $${p} OR old_data->>'session_id' = $${p})`);
  }
  const { rows } = await pool.query(
    `SELECT id, table_name, record_id, action, changed_by, reason, changed_fields, old_data, new_data, changed_at
     FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY changed_at DESC, id DESC LIMIT 200`,
    params,
  );
  res.json(rows);
});

export default router;
