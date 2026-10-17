import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import { pool, withAudit } from '../db.js';
import { pick, insertSql, updateSql } from '../crud.js';
import { PATIENT_FIELDS } from '../../public/form519.js';

const COLUMNS = PATIENT_FIELDS.map((f) => f.name);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_COLUMNS = 'id, patient_id, kind, file_name, mime_type, size_bytes, uploaded_by, created_at';

const router = Router();

// รายชื่อผู้ป่วย: ?q=(HN หรือชื่อ)&regular_shift=&archived=1&limit=&offset= จำนวนทั้งหมดอยู่ใน header X-Total-Count
// archived=1 คือข้อมูลผู้ป่วยเก่า (ผู้ป่วยที่ลบออกจากรายชื่อแล้ว) เรียงจากที่ย้ายมาล่าสุด
router.get('/', async (req, res) => {
  const params = [];
  const archived = req.query.archived === '1';
  const where = [archived ? 'NOT active' : 'active'];
  if (req.query.q?.trim()) {
    const q = params.push(`%${req.query.q.trim()}%`);
    where.push(`(hn ILIKE $${q} OR first_name ILIKE $${q} OR last_name ILIKE $${q}
      OR concat_ws(' ', first_name, last_name) ILIKE $${q} OR concat(prefix, first_name, ' ', last_name) ILIKE $${q})`);
  }
  if (req.query.regular_shift) where.push(`regular_shift = $${params.push(Number(req.query.regular_shift) || 0)}`);
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT *, count(*) OVER () AS total_count FROM patients
     WHERE ${where.join(' AND ')}
     ORDER BY ${archived ? 'archived_at DESC NULLS LAST, hn' : 'hn'}
     LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );
  res.set('X-Total-Count', String(rows[0]?.total_count ?? 0));
  res.json(rows.map(({ total_count, ...row }) => row));
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ป่วย' });
  res.json(rows[0]);
});

// รอบฟอกประจำต้องเป็นรอบที่เปิดอยู่ในการตั้งค่ารอบ (หน้าเตรียมผู้ป่วย)
// ผู้ป่วยที่อยู่รอบเดิมซึ่งถูกปิดภายหลัง ยังแก้ข้อมูลอื่นได้โดยไม่ต้องย้ายรอบ
async function checkRegularShift(db, data, current) {
  if (data.regular_shift === undefined || data.regular_shift === null || data.regular_shift === '') return;
  if (Number(data.regular_shift) === current) return;
  const { rows } = await db.query('SELECT active, beds FROM shift_settings WHERE shift = $1', [data.regular_shift]);
  if (!rows[0]?.active || !rows[0].beds) {
    throw Object.assign(new Error(`รอบ ${data.regular_shift} ไม่ได้เปิดในการตั้งค่ารอบ เลือกรอบที่เปิดอยู่ หรือเปิดรอบนี้ที่หน้าเตรียมผู้ป่วยก่อน`), { status: 400 });
  }
}

router.post('/', async (req, res) => {
  const data = pick(req.body, COLUMNS);
  const row = await withAudit(req.actor, req.reason, async (db) => {
    await checkRegularShift(db, data, null);
    return (await db.query(insertSql('patients', data))).rows[0];
  });
  res.status(201).json(row);
});

router.patch('/:id', async (req, res) => {
  const data = pick(req.body, COLUMNS);
  if (!Object.keys(data).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
  const row = await withAudit(req.actor, req.reason, async (db) => {
    const { rows: cur } = await db.query('SELECT regular_shift, active FROM patients WHERE id = $1', [req.params.id]);
    if (!cur[0]) return null;
    if (!cur[0].active) throw Object.assign(new Error('ผู้ป่วยรายนี้อยู่ในข้อมูลผู้ป่วยเก่า ต้องนำกลับมาก่อนจึงจะแก้ไขได้'), { status: 409 });
    await checkRegularShift(db, data, cur[0].regular_shift);
    return (await db.query(updateSql('patients', req.params.id, data))).rows[0];
  });
  if (!row) return res.status(404).json({ error: 'ไม่พบผู้ป่วย' });
  res.json(row);
});

// ลบผู้ป่วยออกจากรายชื่อ = ย้ายไปข้อมูลผู้ป่วยเก่า ไม่ลบเวชระเบียน ประวัติการฟอก และไฟล์
// นัดที่ยังไม่ถึง (ตั้งแต่วันนี้) ถูกยกเลิกด้วย เพื่อคืนเตียงในตารางนัด
router.delete('/:id', async (req, res) => {
  const result = await withAudit(req.actor, req.reason, async (db) => {
    const { rows } = await db.query(
      'UPDATE patients SET active = false, archived_at = now(), archive_reason = $2 WHERE id = $1 AND active RETURNING id',
      [req.params.id, req.reason],
    );
    if (!rows[0]) return null;
    const { rowCount } = await db.query(
      "UPDATE schedule_entries SET status = 'CANCELLED' WHERE patient_id = $1 AND status = 'PLANNED' AND schedule_date >= current_date",
      [req.params.id],
    );
    return { id: rows[0].id, cancelled_bookings: rowCount };
  });
  if (!result) return res.status(404).json({ error: 'ไม่พบผู้ป่วย' });
  res.json(result);
});

// นำผู้ป่วยจากข้อมูลผู้ป่วยเก่ากลับมาเป็นผู้ป่วยปัจจุบัน (นัดที่ยกเลิกไปแล้วไม่กลับมา ต้องนัดใหม่)
router.post('/:id/restore', async (req, res) => {
  const row = await withAudit(req.actor, req.reason, async (db) =>
    (await db.query(
      'UPDATE patients SET active = true, archived_at = NULL, archive_reason = NULL WHERE id = $1 AND NOT active RETURNING *',
      [req.params.id],
    )).rows[0]);
  if (!row) return res.status(404).json({ error: 'ไม่พบผู้ป่วยในข้อมูลผู้ป่วยเก่า' });
  res.json(row);
});

// ---------------------------------------------------------------------------
// ไฟล์แนบและรูปผู้ป่วย
// ---------------------------------------------------------------------------
router.get('/:id/files', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${FILE_COLUMNS} FROM patient_files WHERE patient_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [req.params.id],
  );
  res.json(rows);
});

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPdf = (b) => b.subarray(0, 5).toString('latin1') === '%PDF-';

// อัปโหลด: POST /:id/files?kind=PHOTO|DOCUMENT  body = ไฟล์ดิบ, header X-File-Name = ชื่อไฟล์ (URL-encoded)
router.post(
  '/:id/files',
  express.raw({ type: ['image/jpeg', 'application/pdf'], limit: MAX_FILE_BYTES }),
  async (req, res) => {
    const kind = req.query.kind === 'PHOTO' ? 'PHOTO' : 'DOCUMENT';
    const content = Buffer.isBuffer(req.body) ? req.body : null;
    const mime = req.is('image/jpeg') ? 'image/jpeg' : req.is('application/pdf') ? 'application/pdf' : null;
    if (!content?.length || !mime) return res.status(415).json({ error: 'รับเฉพาะไฟล์ .jpg และ .pdf' });
    if ((mime === 'image/jpeg' && !isJpeg(content)) || (mime === 'application/pdf' && !isPdf(content))) {
      return res.status(415).json({ error: 'เนื้อไฟล์ไม่ตรงกับชนิดไฟล์ รับเฉพาะ .jpg และ .pdf' });
    }
    if (kind === 'PHOTO' && mime !== 'image/jpeg') return res.status(415).json({ error: 'รูปผู้ป่วยต้องเป็นไฟล์ .jpg' });
    const fileName = (req.get('X-File-Name') ? decodeURIComponent(req.get('X-File-Name')) : 'file').slice(0, 200);

    const row = await withAudit(req.actor, req.reason, async (db) => {
      const { rows: patient } = await db.query('SELECT photo_file_id FROM patients WHERE id = $1 AND active FOR UPDATE', [req.params.id]);
      if (!patient[0]) return null;
      const { rows } = await db.query(
        `INSERT INTO patient_files (patient_id, kind, file_name, mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${FILE_COLUMNS}`,
        [req.params.id, kind, fileName, mime, content.length, createHash('sha256').update(content).digest('hex'), req.user],
      );
      await db.query('INSERT INTO file_contents (file_id, content) VALUES ($1, $2)', [rows[0].id, content]);
      if (kind === 'PHOTO') {
        // รูปเดิมเก็บไว้เป็นประวัติ แต่ไม่แสดงแล้ว
        if (patient[0].photo_file_id) await db.query('UPDATE patient_files SET deleted_at = now() WHERE id = $1', [patient[0].photo_file_id]);
        await db.query('UPDATE patients SET photo_file_id = $1 WHERE id = $2', [rows[0].id, req.params.id]);
      }
      return rows[0];
    });
    if (!row) return res.status(404).json({ error: 'ไม่พบผู้ป่วย' });
    res.status(201).json(row);
  },
);

router.get('/:id/files/:fileId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f.file_name, f.mime_type, c.content FROM patient_files f JOIN file_contents c ON c.file_id = f.id
     WHERE f.id = $1 AND f.patient_id = $2`,
    [req.params.fileId, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  res.set({
    'Content-Type': rows[0].mime_type,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(rows[0].file_name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.send(rows[0].content);
});

router.delete('/:id/files/:fileId', async (req, res) => {
  const row = await withAudit(req.actor, req.reason, async (db) => {
    const { rows } = await db.query(
      'UPDATE patient_files SET deleted_at = now() WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL RETURNING id',
      [req.params.fileId, req.params.id],
    );
    if (rows[0]) await db.query('UPDATE patients SET photo_file_id = NULL WHERE id = $1 AND photo_file_id = $2', [req.params.id, req.params.fileId]);
    return rows[0];
  });
  if (!row) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  res.status(204).end();
});

export default router;
