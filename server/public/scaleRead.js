// กติกาการอ่านน้ำหนักจากรูปตาชั่ง ใช้ร่วมกันทั้งเซิร์ฟเวอร์และหน้าตัวอย่าง
// เหมือนการอ่านหน้าจอเครื่องฟอก: อ่านรูปเดียวกันสองครั้งแยกกัน เติมเฉพาะเมื่อสองครั้งตรงกันและสมเหตุผล
// ไม่แน่ใจไม่เติม ให้พยาบาลพิมพ์เอง ค่าที่เติมแล้วพยาบาลต้องตรวจก่อนกดบันทึกเสมอ
export const SCALE_READS = 2;
export const WEIGHT_RANGE = { min: 20, max: 250 };

export const SCALE_PROMPT = `ภาพนี้คือภาพถ่ายตาชั่งน้ำหนักตัวผู้ป่วย (เครื่องชั่งดิจิทัลหรือแบบเข็ม) อ่านน้ำหนักตัวที่แสดงอยู่
- weight_raw: ตัวเลขน้ำหนักตามที่เห็นทุกหลักรวมจุดทศนิยม เช่น "62.4" ถ้าตัวเลขใดไม่ชัด ถูกบัง เบลอ หรือสะท้อนแสงแม้แต่หลักเดียวให้เป็น null
- unit: หน่วยที่แสดง "kg" หรือ "lb" ถ้าไม่เห็นหน่วยให้เป็น null
- stable: true ถ้าเห็นสัญลักษณ์ว่าค่านิ่งแล้ว (เช่น STABLE, ▲, ●, ไฟนิ่ง) false ถ้าตัวเลขกำลังกระพริบหรือยังไม่นิ่ง null ถ้าดูไม่ออก
- notes: บอกสั้น ๆ เป็นภาษาไทยถ้ามีปัญหา เช่น อ่านไม่ชัด มีหลายตัวเลข ถ้าไม่มีให้เป็นค่าว่าง
กติกา: ห้ามเดา ห้ามปัดเศษ ห้ามคำนวณ ห้ามใช้ตัวเลขอื่นที่ไม่ใช่น้ำหนักตัว เช่น BMI, %fat, ส่วนสูง, น้ำหนักเป้าหมาย, ค่าที่จำไว้ครั้งก่อน
ตอบเป็น JSON อย่างเดียว ตัวอย่าง: {"weight_raw":"62.4","unit":"kg","stable":true,"notes":""}`;

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d{1,3}([.,]\d{1,2})?\s*$/.test(v)) return Number(v.trim().replace(',', '.'));
  return null;
};

// รวมผลอ่านหลายรอบ คืน { weight_kg, warnings, notes } weight_kg เป็น null เมื่อไม่แน่ใจ
export function reconcileScale(reads) {
  const notes = [...new Set(reads.map((r) => (typeof r?.notes === 'string' ? r.notes.trim().slice(0, 300) : '')).filter(Boolean))].join(' · ');
  const values = reads.map((r) => toNumber(r?.weight_raw));
  const units = reads.map((r) => (r?.unit === 'lb' ? 'lb' : 'kg'));
  const fail = (message) => ({ weight_kg: null, warnings: [message], notes });
  if (values.every((v) => v === null)) return fail('อ่านน้ำหนักจากรูปไม่ได้ กรุณาถ่ายใหม่ให้เห็นตัวเลขชัด หรือพิมพ์เอง');
  if (values.some((v) => v === null || v !== values[0]) || units.some((u) => u !== units[0])) {
    return fail(`อ่านได้ไม่ตรงกัน (${values.map((v, i) => (v === null ? '-' : `${v} ${units[i]}`)).join(' / ')}) ไม่ได้เติมให้ กรุณาดูจากตาชั่งแล้วพิมพ์เอง`);
  }
  if (reads.some((r) => r?.stable === false)) return fail(`ตัวเลข ${values[0]} ยังไม่นิ่ง ไม่ได้เติมให้ กรุณารอให้ตาชั่งนิ่งแล้วถ่ายใหม่`);
  const kg = units[0] === 'lb' ? Math.round(values[0] * 0.45359237 * 10) / 10 : values[0];
  if (kg < WEIGHT_RANGE.min || kg > WEIGHT_RANGE.max) return fail(`อ่านได้ ${kg} kg ซึ่งผิดปกติ ไม่ได้เติมให้ กรุณาตรวจจากตาชั่ง`);
  const warnings = units[0] === 'lb' ? [`ตาชั่งแสดง ${values[0]} lb แปลงเป็น ${kg} kg แล้ว`] : [];
  return { weight_kg: kg, warnings, notes };
}
