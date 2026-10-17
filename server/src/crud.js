// ตัวช่วยสร้าง INSERT/UPDATE จากรายชื่อคอลัมน์ที่อนุญาตเท่านั้น
export function pick(body, columns) {
  const out = {};
  for (const c of columns) if (body && Object.hasOwn(body, c)) out[c] = body[c] === '' ? null : body[c];
  return out;
}

export function insertSql(table, data) {
  const keys = Object.keys(data);
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
  return { text: `INSERT INTO ${table} (${cols}) VALUES (${vals}) RETURNING *`, values: Object.values(data) };
}

export function updateSql(table, id, data) {
  const keys = Object.keys(data);
  const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
  return {
    text: `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`,
    values: [...Object.values(data), id],
  };
}
