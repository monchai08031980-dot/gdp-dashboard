import { Router } from 'express';
import { getDataFolder, setDataFolder } from '../dataExport.js';

const router = Router();

// ค่าตั้งของระบบ: โฟลเดอร์เก็บข้อมูล (บนเครื่องที่รันเซิร์ฟเวอร์)
router.get('/', async (_req, res) => res.json({ data_folder: await getDataFolder() }));

router.put('/data-folder', async (req, res) => {
  if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  res.json({ data_folder: await setDataFolder(req.actor, req.reason, req.body?.path) });
});

export default router;
