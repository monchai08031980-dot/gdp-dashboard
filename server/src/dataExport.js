// ยืนยันข้อมูลทั้งหมด: ตรวจแบบฟอร์มทั้งชุด แล้วบันทึกเป็นไฟล์ลงโฟลเดอร์เก็บข้อมูลบนเครื่องที่รันเซิร์ฟเวอร์
// ไฟล์ JSON เก็บข้อมูลครบทุกส่วน ไฟล์ CSV เก็บบันทึกระหว่างฟอก (เปิดด้วย Excel ได้)
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, rm, access } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pool, withAudit } from './db.js';
import { checkSession } from '../public/sessionCheck.js';
import { VITAL_FIELDS } from '../public/form519.js';

const httpError = (status, message, extra) => Object.assign(new Error(message), { status, ...extra });
const FOLDER_KEY = 'data_folder';

// โฟลเดอร์ที่ตั้งไว้ในหน้าตั้งค่า ถ้ายังไม่ตั้งใช้ค่า DATA_FOLDER ของเซิร์ฟเวอร์ (ถ้ามี)
export async function getDataFolder(db = pool) {
  const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [FOLDER_KEY]);
  return rows[0]?.value || process.env.DATA_FOLDER || null;
}

// ตั้งโฟลเดอร์: ต้องเป็น path เต็ม สร้างให้ถ้ายังไม่มี และลองเขียนไฟล์จริงก่อนบันทึกค่า
export async function setDataFolder(actor, reason, path) {
  const folder = typeof path === 'string' ? path.trim() : '';
  if (!folder) throw httpError(400, 'กรุณาระบุโฟลเดอร์');
  if (!isAbsolute(folder)) throw httpError(400, 'กรุณาระบุโฟลเดอร์แบบเต็ม เช่น D:\\HemoData หรือ /srv/hemo-data');
  const full = resolve(folder);
  try {
    await mkdir(full, { recursive: true });
    const probe = join(full, `.hemo-sync-test-${process.pid}-${Date.now()}`);
    await writeFile(probe, 'test');
    await rm(probe);
  } catch (err) {
    throw httpError(400, `เขียนไฟล์ลงโฟลเดอร์นี้ไม่ได้ (${err.code || err.message}) ตรวจสิทธิ์ของโฟลเดอร์หรือเลือกโฟลเดอร์อื่น`);
  }
  await withAudit(actor, reason || 'ตั้งค่าโฟลเดอร์เก็บข้อมูล', (db) => db.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [FOLDER_KEY, full],
  ));
  return full;
}

// โหลดแบบฟอร์มทั้งชุดของรอบฟอก
export async function loadSession(id, db = pool) {
  const { rows } = await db.query(
    `SELECT s.*, p.hn, p.prefix, p.first_name, p.last_name
     FROM dialysis_sessions s JOIN patients p ON p.id = s.patient_id WHERE s.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const vitals = (await db.query('SELECT * FROM intradialytic_vitals WHERE session_id = $1 ORDER BY recorded_time', [id])).rows;
  const medications = (await db.query('SELECT * FROM session_medications WHERE session_id = $1 ORDER BY created_at', [id])).rows;
  return { session: rows[0], vitals, medications };
}

// audit_log ล่าสุดของแบบฟอร์ม (รวมแถวย่อย) ใช้ตรวจว่าแก้ไขหลังยืนยันหรือไม่
const LAST_AUDIT_SQL = `SELECT coalesce(max(id), 0) AS id FROM audit_log
  WHERE table_name IN ('dialysis_sessions', 'intradialytic_vitals', 'session_medications')
    AND (record_id::text = $1 OR new_data->>'session_id' = $1 OR old_data->>'session_id' = $1)`;

// การยืนยันล่าสุด และมีการแก้ไขหลังยืนยันหรือไม่
export async function latestExport(id, db = pool) {
  const { rows } = await db.query('SELECT * FROM session_exports WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
  if (!rows[0]) return null;
  const last = Number((await db.query(LAST_AUDIT_SQL, [id])).rows[0].id);
  return { ...rows[0], edited_after: last > Number(rows[0].last_audit_id) };
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function vitalsCsv(vitals) {
  const cols = VITAL_FIELDS;
  const lines = [cols.map((f) => csvCell(f.label)).join(',')];
  for (const v of vitals) lines.push(cols.map((f) => csvCell(f.name === 'recorded_time' && v[f.name] ? String(v[f.name]).slice(0, 5) : v[f.name])).join(','));
  return '\ufeff' + lines.join('\r\n') + '\r\n'; // BOM ให้ Excel อ่านภาษาไทยได้
}

const safe = (s) => String(s ?? '').replace(/[^0-9A-Za-z\u0E00-\u0E7F-]+/g, '_').slice(0, 40) || 'x';
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// เขียนไฟล์แบบปลอดภัย: เขียนไฟล์ชั่วคราวแล้วเปลี่ยนชื่อ ไม่ทับไฟล์เดิม
async function writeNew(path, content) {
  try { await access(path); throw httpError(409, 'มีไฟล์ชื่อนี้อยู่แล้ว กรุณาลองใหม่'); } catch (err) { if (err.status) throw err; }
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

// สร้างข้อมูลที่จะบันทึกจากข้อมูลในฐานข้อมูลตอนนี้ เวลายืนยันเดียวกันให้ผลเหมือนเดิมทุกครั้ง
// จึงใช้ sha256 ตรวจได้ว่าข้อมูลไม่เปลี่ยนระหว่างดูตัวอย่าง PDF กับตอนกดบันทึก
function buildExport(data, check, actor, confirmedAt) {
  const { session } = data;
  const day = String(session.session_date);
  const record = {
    format: 'hemo-sync-519',
    version: 1,
    confirmed_at: confirmedAt.toISOString(),
    confirmed_by: actor.name,
    confirmed_by_role: actor.role || null,
    patient: { id: session.patient_id, hn: session.hn, prefix: session.prefix, first_name: session.first_name, last_name: session.last_name },
    session: data.session,
    vitals: data.vitals,
    medications: data.medications,
    check: { errors: [], warnings: check.warnings },
  };
  const json = JSON.stringify(record, null, 2);
  return {
    record,
    json,
    csv: vitalsCsv(data.vitals),
    sha256: createHash('sha256').update(json).digest('hex'),
    dir: [day.slice(0, 4), day],
    name: `${day}_shift${session.shift ?? 'x'}_bed${session.bed_no ?? 'x'}_HN${safe(session.hn)}_${stamp(confirmedAt)}`,
  };
}

async function checked(actor, id) {
  if (!actor?.name) throw httpError(400, 'กรุณาเลือกตำแหน่งผู้บันทึก');
  const data = await loadSession(id);
  if (!data) throw httpError(404, 'ไม่พบรอบการฟอก');
  const check = checkSession(data.session, data);
  if (check.errors.length) throw httpError(422, `ยังยืนยันไม่ได้ พบข้อมูลที่ต้องแก้ ${check.errors.length} รายการ`, { check });
  return { data, check };
}

// ขั้นที่ 1: ตรวจแล้วสร้างไฟล์ให้ดูตัวอย่าง (PDF สร้างที่หน้าเว็บจาก record) ยังไม่บันทึกอะไร
export async function prepareExport(actor, id) {
  const { data, check } = await checked(actor, id);
  const out = buildExport(data, check, actor, new Date());
  return { check, confirmed_at: out.record.confirmed_at, ...out };
}

export const TARGETS = ['server', 'local', 'download'];

// ขั้นที่ 2: ยืนยัน ข้อมูลต้องตรงกับตัวอย่างที่ดู (sha256) ข้อควรตรวจต้องรับทราบแล้ว
// target=server เขียน JSON, CSV และ PDF ลงโฟลเดอร์บนเครื่องเซิร์ฟเวอร์
// target=local/download หน้าเว็บเขียนไฟล์ลงโฟลเดอร์ที่เลือกในเครื่องผู้ใช้เอง เซิร์ฟเวอร์บันทึกการยืนยันไว้
export async function confirmSession(actor, reason, id, { acknowledgeWarnings = false, confirmedAt, sha256, target = 'server', folder: localFolder, pdf } = {}) {
  if (!TARGETS.includes(target)) throw httpError(400, 'ที่เก็บไฟล์ไม่ถูกต้อง');
  const { data, check } = await checked(actor, id);
  if (check.warnings.length && !acknowledgeWarnings) throw httpError(409, `มีข้อควรตรวจ ${check.warnings.length} รายการ กรุณาตรวจและติ๊กรับทราบก่อนยืนยัน`, { check });
  const at = new Date(confirmedAt);
  if (!confirmedAt || Number.isNaN(at.getTime()) || Math.abs(Date.now() - at.getTime()) > 2 * 60 * 60 * 1000) {
    throw httpError(400, 'กรุณากดดูตัวอย่าง PDF ใหม่ก่อนบันทึก');
  }
  const out = buildExport(data, check, actor, at);
  if (out.sha256 !== sha256) throw httpError(409, 'ข้อมูลมีการเปลี่ยนแปลงหลังสร้างตัวอย่าง PDF กรุณาตรวจและดูตัวอย่างใหม่', { check });

  let folder;
  let base;
  let pdfPath = null;
  if (target === 'server') {
    folder = await getDataFolder();
    if (!folder) throw httpError(400, 'ยังไม่ได้ตั้งค่าโฟลเดอร์บนเครื่องเซิร์ฟเวอร์ กรุณาตั้งค่าที่ "📁 ตั้งค่าโฟลเดอร์เก็บข้อมูล" ก่อน');
    if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw httpError(400, 'ไม่ได้รับไฟล์ PDF');
    const dir = join(folder, ...out.dir);
    base = join(dir, out.name);
    pdfPath = `${base}.pdf`;
    try {
      await mkdir(dir, { recursive: true });
      await writeNew(`${base}.json`, out.json);
      await writeNew(`${base}_vitals.csv`, out.csv);
      await writeNew(pdfPath, pdf);
    } catch (err) {
      if (err.status) throw err;
      throw httpError(500, `บันทึกไฟล์ลงโฟลเดอร์ไม่ได้ (${err.code || err.message}) ตรวจโฟลเดอร์ในหน้าตั้งค่า`);
    }
  } else {
    // โฟลเดอร์ในเครื่องผู้ใช้ เบราว์เซอร์บอกได้แค่ชื่อโฟลเดอร์ ไม่ใช่ path เต็ม
    folder = String(localFolder || (target === 'download' ? 'ดาวน์โหลด' : '')).trim().slice(0, 200);
    if (!folder) throw httpError(400, 'กรุณาเลือกโฟลเดอร์');
    base = [folder, ...out.dir, out.name].join('/');
    pdfPath = `${base}.pdf`;
  }
  const lastAuditId = Number((await pool.query(LAST_AUDIT_SQL, [id])).rows[0].id);
  return withAudit(actor, reason || 'ยืนยันข้อมูลทั้งหมด', async (db) => (await db.query(
    `INSERT INTO session_exports (session_id, target, folder, file_path, csv_path, pdf_path, sha256, warnings, confirmed_by, confirmed_by_role, last_audit_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [id, target, folder, `${base}.json`, `${base}_vitals.csv`, pdfPath, out.sha256, check.warnings.map((w) => w.message), actor.name, actor.role || null, lastAuditId],
  )).rows[0]);
}
