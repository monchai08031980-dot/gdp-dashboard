import { Router } from 'express';
import { pool } from '../db.js';
import { reviewConsultImages, imageType } from '../screenReader.js';
import { CONSULT_AI_MAX_IMAGES } from '../../public/consultAi.js';

const router = Router();

// รูปแนบของการปรึกษา (เฉพาะที่ยังไม่ลบ)
export const CONSULT_IMAGES = `coalesce((SELECT json_agg(json_build_object('id', f.id, 'file_name', f.file_name, 'created_at', f.created_at) ORDER BY f.created_at)
  FROM patient_files f WHERE f.consult_id = c.id AND f.deleted_at IS NULL), '[]')`;

// รายการปรึกษาแพทย์ทุกเตียง: ?status=open (รอคำสั่ง) | answered | all  &date=YYYY-MM-DD (วันที่ฟอก)
// สร้างและบันทึกคำสั่งแพทย์ผ่าน /api/sessions/:id/consults
router.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status === 'open') where.push('c.answered_at IS NULL');
  if (req.query.status === 'answered') where.push('c.answered_at IS NOT NULL');
  if (req.query.date) where.push(`s.session_date = $${params.push(req.query.date)}`);
  const { rows } = await pool.query(
    `SELECT c.*, ${CONSULT_IMAGES} AS images, s.session_date, s.shift, s.bed_no, s.patient_id, p.hn, p.prefix, p.first_name, p.last_name
     FROM doctor_consults c JOIN dialysis_sessions s ON s.id = c.session_id JOIN patients p ON p.id = s.patient_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (c.answered_at IS NULL) DESC, CASE c.urgency WHEN 'STAT' THEN 0 WHEN 'URGENT' THEN 1 ELSE 2 END, c.created_at DESC
     LIMIT 300`,
    params,
  );
  res.json(rows);
});

// ให้ AI ช่วยดูรูปก่อนรายงานแพทย์ ยังไม่บันทึกอะไร ส่งข้อสังเกตกลับให้พยาบาลเลือกใส่ในรายงาน
// body: { images: [{ data: base64 }], context: { topics, findings } } ไม่ส่งชื่อหรือ HN ผู้ป่วย
router.post('/ai-review', async (req, res) => {
  if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  const list = Array.isArray(req.body?.images) ? req.body.images : [];
  if (!list.length) return res.status(400).json({ error: 'กรุณาแนบรูปอย่างน้อย 1 รูป' });
  if (list.length > CONSULT_AI_MAX_IMAGES) return res.status(400).json({ error: `ให้ AI ดูได้ครั้งละไม่เกิน ${CONSULT_AI_MAX_IMAGES} รูป` });
  const images = [];
  for (const im of list) {
    const data = typeof im?.data === 'string' ? Buffer.from(im.data, 'base64') : null;
    const type = data?.length ? imageType(data) : null;
    if (!type) return res.status(415).json({ error: 'รองรับเฉพาะภาพ JPG, PNG หรือ WEBP' });
    images.push({ data, type });
  }
  const ctx = req.body.context || {};
  const context = {
    topics: Array.isArray(ctx.topics) ? ctx.topics.map(String) : [],
    findings: Array.isArray(ctx.findings) ? ctx.findings.map(String) : [],
  };
  res.json(await reviewConsultImages(images, context));
});

export default router;
