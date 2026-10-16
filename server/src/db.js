import pg from 'pg';

// คอลัมน์ date คืนค่าเป็นสตริง YYYY-MM-DD เพื่อไม่ให้วันที่เลื่อนตาม timezone
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// numeric ในระบบนี้มีทศนิยมไม่เกิน 2 ตำแหน่ง แปลงเป็น number ได้ปลอดภัย
pg.types.setTypeParser(pg.types.builtins.NUMERIC, parseFloat);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://hemo:hemo@localhost:5432/hemo_sync',
});

// ทุกการเขียนข้อมูลต้องผ่านฟังก์ชันนี้ เพื่อให้ trigger รู้ว่าใครแก้ (audit log)
export async function withAudit(user, reason, fn) {
  if (!user) throw Object.assign(new Error('ต้องระบุผู้บันทึก'), { status: 401 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_name', $1, true), set_config('app.reason', $2, true)", [
      user,
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
