import { Router } from 'express';
import { getDataFolder, setDataFolder } from '../dataExport.js';
import { getAlertSettings, setAlertSettings, smsReady, sendTestSms } from '../alertNotify.js';

const router = Router();

// ค่าตั้งของระบบ: โฟลเดอร์เก็บข้อมูล (บนเครื่องที่รันเซิร์ฟเวอร์)
router.get('/', async (_req, res) => res.json({ data_folder: await getDataFolder(), hd_alert: await getAlertSettings(), sms_ready: smsReady() }));

router.put('/data-folder', async (req, res) => {
  if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  res.json({ data_folder: await setDataFolder(req.actor, req.reason, req.body?.path) });
});

// การเตือนระหว่างฟอก: เสียงเตือน และ SMS ไปยังเบอร์ที่ตั้งไว้
router.put('/hd-alert', async (req, res) => {
  if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  res.json({ hd_alert: await setAlertSettings(req.actor, req.reason, req.body), sms_ready: smsReady() });
});
router.post('/hd-alert/test-sms', async (req, res) => {
  if (!req.actor) return res.status(400).json({ error: 'กรุณาเลือกตำแหน่งผู้บันทึก' });
  res.json({ results: await sendTestSms() });
});

export default router;
