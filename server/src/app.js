import express from 'express';
import { fileURLToPath } from 'node:url';
import patients from './routes/patients.js';
import sessions from './routes/sessions.js';
import audit from './routes/audit.js';

export const app = express();
app.use(express.json());
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

// TODO: แทนที่ด้วยระบบล็อกอินจริง ตอนนี้รับชื่อผู้บันทึกจาก header ชั่วคราว
app.use('/api', (req, _res, next) => {
  const encoded = req.get('X-User-Name');
  req.user = encoded ? decodeURIComponent(encoded) : null;
  const reason = req.get('X-Edit-Reason');
  req.reason = reason ? decodeURIComponent(reason) : null;
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/patients', patients);
app.use('/api/sessions', sessions);
app.use('/api/audit', audit);

// Express 5 ส่ง error จาก async handler มาที่นี่เอง
app.use((err, _req, res, _next) => {
  if (err.code === '22P02' || err.code === '23514' || err.code === '23502' || err.code === '22007') {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง', detail: err.message });
  }
  if (err.code === '23505') return res.status(409).json({ error: 'ข้อมูลซ้ำ', detail: err.detail });
  if (err.code === '23503') return res.status(400).json({ error: 'อ้างอิงข้อมูลที่ไม่มีอยู่', detail: err.detail });
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
});
