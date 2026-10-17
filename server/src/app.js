import express from 'express';
import { fileURLToPath } from 'node:url';
import patients from './routes/patients.js';
import sessions from './routes/sessions.js';
import audit from './routes/audit.js';
import settings from './routes/settings.js';
import { schedule, shifts } from './routes/schedule.js';
import { ROLES } from './db.js';
import { screenReaderEnabled, scaleReaderEnabled, readScale, imageType } from './screenReader.js';

export const app = express();
app.use(express.json());
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

// TODO: แทนที่ด้วยระบบล็อกอินจริง ตอนนี้รับชื่อผู้บันทึกจาก header ชั่วคราว
app.use('/api', (req, res, next) => {
  const encoded = req.get('X-User-Name');
  req.user = encoded ? decodeURIComponent(encoded) : null;
  // ตำแหน่งผู้บันทึกจากหน้าจอ (ROLES ใน db.js) บังคับเลือกก่อนแก้ข้อมูล
  const role = req.get('X-User-Role');
  if (req.method !== 'GET' && req.user && !Object.hasOwn(ROLES, role || '')) {
    return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  }
  req.actor = req.user ? { name: req.user, role } : null;
  const reason = req.get('X-Edit-Reason');
  req.reason = reason ? decodeURIComponent(reason) : null;
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, screen_reader: screenReaderEnabled(), scale_reader: scaleReaderEnabled() }));

// อ่านน้ำหนักจากรูปตาชั่ง ยังไม่บันทึกอะไร ส่งค่ากลับให้พยาบาลตรวจในฟอร์มซักประวัติ แล้วกดบันทึกเอง (รูปไม่ได้เก็บไว้)
app.post('/api/scale/read', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 10 * 1024 * 1024 }), async (req, res) => {
  if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  const type = Buffer.isBuffer(req.body) ? imageType(req.body) : null;
  if (!type) return res.status(415).json({ error: 'รองรับเฉพาะภาพ JPG, PNG หรือ WEBP' });
  res.json(await readScale(req.body, type));
});
app.use('/api/patients', patients);
app.use('/api/sessions', sessions);
app.use('/api/audit', audit);
app.use('/api/settings', settings);
app.use('/api/shifts', shifts);
app.use('/api/schedule', schedule);

// Express 5 ส่ง error จาก async handler มาที่นี่เอง
app.use((err, _req, res, _next) => {
  if (err.code === '22P02' || err.code === '23514' || err.code === '23502' || err.code === '22007') {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง', detail: err.message });
  }
  if (err.code === '23505') return res.status(409).json({ error: 'ข้อมูลซ้ำ', detail: err.detail });
  if (err.code === '23503') return res.status(400).json({ error: 'อ้างอิงข้อมูลที่ไม่มีอยู่', detail: err.detail });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'ไฟล์ใหญ่เกินกำหนด' });
  if (err.status) return res.status(err.status).json({ error: err.message, ...(err.check && { check: err.check }) });
  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
});
