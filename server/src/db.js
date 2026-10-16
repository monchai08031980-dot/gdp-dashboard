import pg from 'pg';

// คอลัมน์ date คืนค่าเป็นสตริง YYYY-MM-DD เพื่อไม่ให้วันที่เลื่อนตาม timezone
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// numeric ในระบบนี้มีทศนิยมไม่เกิน 2 ตำแหน่ง แปลงเป็น number ได้ปลอดภัย
pg.types.setTypeParser(pg.types.builtins.NUMERIC, parseFloat);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://hemo:hemo@localhost:5432/hemo_sync',
});

export const ROLES = { NURSE: 'พยาบาล', NURSE_AIDE: 'ผู้ช่วยพยาบาล', DOCTOR: 'แพทย์', CLERK: 'เสมียน', OTHER: 'อื่นๆ' };

// ทุกการเขียนข้อมูลต้องผ่านฟังก์ชันนี้ เพื่อให้ trigger รู้ว่าใครแก้ (audit log)
// actor คือ { name, role } จากหน้าจอ หรือชื่อเปล่า ๆ สำหรับสคริปต์ระบบ เช่น seed
export async function withAudit(actor, reason, fn) {
  const { name, role } = typeof actor === 'string' ? { name: actor, role: null } : actor || {};
  if (!name) throw Object.assign(new Error('ต้องระบุผู้บันทึก'), { status: 401 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_name', $1, true), set_config('app.user_role', $2, true), set_config('app.reason', $3, true)", [
      name,
      role || '',
      reason || '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
