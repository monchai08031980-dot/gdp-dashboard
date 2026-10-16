import { Router } from 'express';
import { pool, withAudit } from '../db.js';
import { pick, insertSql, updateSql } from '../crud.js';

const COLUMNS = [
  'hn', 'prefix', 'first_name', 'last_name', 'sex', 'birth_date', 'blood_group', 'diagnosis',
  'dry_weight_kg', 'vascular_access', 'access_side', 'hbsag', 'anti_hcv', 'anti_hiv', 'payer', 'active',
];

const router = Router();

router.get('/', async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const { rows } = await pool.query(
    `SELECT * FROM patients
     WHERE active AND (hn ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1)
     ORDER BY hn`,
    [q],
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ป่วย' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const row = await withAudit(req.user, req.reason, async (db) => (await db.query(insertSql('patients', pick(req.body, COLUMNS)))).rows[0]);
  res.status(201).json(row);
});

router.patch('/:id', async (req, res) => {
  const data = pick(req.body, COLUMNS);
  if (!Object.keys(data).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
  const row = await withAudit(req.user, req.reason, async (db) => (await db.query(updateSql('patients', req.params.id, data))).rows[0]);
  if (!row) return res.status(404).json({ error: 'ไม่พบผู้ป่วย' });
  res.json(row);
});

export default router;
