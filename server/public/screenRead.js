// กติกาการอ่านค่าจากภาพหน้าจอเครื่องฟอกไต ใช้ร่วมกันทั้งเซิร์ฟเวอร์และหน้าตัวอย่าง
// เพื่อลดค่าผิด: อ่านภาพเดียวกันสองครั้งแยกกัน เติมเฉพาะค่าที่สองครั้งตรงกันและอยู่ในช่วงที่เป็นไปได้
// ค่าที่ไม่แน่ใจจะเว้นว่างและแจ้งให้พยาบาลกรอกเอง ไม่เดาค่าให้

// ช่วงค่าที่เป็นไปได้ ค่านอกช่วงถือว่าอ่านผิด
export const SCREEN_FIELDS = {
  bp_sys: { label: 'BP sys', min: 40, max: 300 },
  bp_dia: { label: 'BP dia', min: 20, max: 200 },
  pr: { label: 'PR', min: 20, max: 250 },
  rr: { label: 'RR', min: 4, max: 60 },
  bfr_ml_min: { label: 'BFR', min: 0, max: 700 },
  pv_mmhg: { label: 'PV', min: -100, max: 500 },
  tmp_mmhg: { label: 'TMP', min: -100, max: 600 },
  conductivity_ms_cm: { label: 'Conduct', min: 5, max: 20 },
  ufr: { label: 'UFR', min: 0, max: 4000, integer: true },
  total_uf_ml: { label: 'Total ml', min: 0, max: 10000, integer: true },
};
export const SCREEN_READS = 2;

export const SCREEN_PROMPT = `ภาพนี้คือภาพถ่ายหน้าจอเครื่องฟอกไต (hemodialysis machine) ระหว่างการฟอก
อ่านตัวเลขที่แสดงอยู่บนหน้าจอจริงเท่านั้น ทีละตัวอย่างระมัดระวัง:
- recorded_time: เวลาปัจจุบัน (นาฬิกา) บนหน้าจอ รูปแบบ HH:MM 24 ชั่วโมง ไม่ใช่เวลาที่เหลือ (remaining) หรือเวลาที่ฟอกไปแล้ว
- bp_sys / bp_dia: ความดันโลหิตจากการวัดครั้งล่าสุด (mmHg) เช่น 128/76 คือ bp_sys 128 bp_dia 76
- pr: ชีพจร (pulse, PR, HR ครั้ง/นาที) มักแสดงคู่กับความดัน
- rr: อัตราการหายใจ (ครั้ง/นาที) เครื่องส่วนใหญ่ไม่มีค่านี้ ถ้าไม่มีให้เป็น null
- bfr_ml_min: blood flow rate (BFR, Qb, blood pump, ml/min)
- pv_mmhg: venous pressure (PV, VP, venous, mmHg) ระวังเครื่องหมายลบ
- tmp_mmhg: transmembrane pressure (TMP, mmHg) ระวังเครื่องหมายลบ
- conductivity_ms_cm: conductivity ของน้ำยา (Cond, mS/cm) มักอยู่ราว 13-15
- ufr: อัตราดึงน้ำปัจจุบัน (UF rate, UFR) หน่วย ml/h ถ้าเครื่องแสดงเป็น L/h ให้คูณ 1000
- total_uf_ml: ปริมาณน้ำที่ดึงออกไปแล้วจริง (UF volume, UFV, removed) หน่วย ml ไม่ใช่เป้าหมาย (UF goal/target) ถ้าเครื่องแสดงเป็น L ให้คูณ 1000
กติกา: ถ้าค่าใดไม่มีบนหน้าจอ ถูกบัง เบลอ สะท้อนแสง หรือไม่แน่ใจแม้แต่หลักเดียว ให้ใส่ null ห้ามเดา ห้ามคำนวณ (ยกเว้นแปลงลิตรเป็น ml ตามที่บอก) ห้ามใช้ค่าปกติแทน
ห้ามสลับค่าตั้ง (set/target/limit) กับค่าที่วัดได้จริง ให้ใช้ค่าที่วัดได้จริง
notes: บอกสั้น ๆ เป็นภาษาไทยถ้ามีค่าที่อ่านไม่ชัดหรือมีสัญญาณเตือนบนหน้าจอ ถ้าไม่มีให้เป็นค่าว่าง
ตอบเป็น JSON อย่างเดียว ตัวอย่าง:
{"recorded_time":"10:42","bp_sys":128,"bp_dia":76,"pr":80,"rr":null,"bfr_ml_min":300,"pv_mmhg":150,"tmp_mmhg":80,"conductivity_ms_cm":14.0,"ufr":600,"total_uf_ml":1250,"notes":""}`;

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};
const toTime = (v) => {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{1,2})[:.](\d{2})/) : null;
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

// รวมผลอ่านหลายครั้ง คืน { values, missing, warnings, notes }
export function reconcileReads(reads) {
  const values = {};
  const missing = [];
  const warnings = [];
  const notes = [...new Set(reads.map((r) => (typeof r?.notes === 'string' ? r.notes.trim().slice(0, 300) : '')).filter(Boolean))];

  const times = reads.map((r) => toTime(r?.recorded_time));
  values.recorded_time = times.every((t) => t && t === times[0]) ? times[0] : null;
  if (!values.recorded_time) {
    missing.push('Time');
    if (times.filter(Boolean).length > 1 && new Set(times).size > 1) warnings.push(`Time อ่านได้ไม่ตรงกัน (${times.join(' / ')}) กรุณาตรวจจากเครื่อง`);
  }

  for (const [name, { label, min, max, integer }] of Object.entries(SCREEN_FIELDS)) {
    // UFR และ Total ml เก็บเป็นจำนวนเต็ม (ml/h, ml)
    const got = reads.map((r) => toNumber(r?.[name])).map((v) => (integer && v !== null ? Math.round(v) : v));
    values[name] = null;
    if (got.every((v) => v === null)) { missing.push(label); continue; }
    if (got.some((v) => v === null) || got.some((v) => v !== got[0])) {
      warnings.push(`${label} อ่านได้ไม่ตรงกัน (${got.map((v) => v ?? '-').join(' / ')}) ไม่ได้เติมให้ กรุณาตรวจจากเครื่อง`);
      continue;
    }
    if (got[0] < min || got[0] > max) {
      warnings.push(`${label} อ่านได้ ${got[0]} ซึ่งผิดปกติ ไม่ได้เติมให้ กรุณาตรวจจากเครื่อง`);
      continue;
    }
    values[name] = got[0];
  }

  if (values.bp_sys !== null && values.bp_dia !== null && values.bp_sys <= values.bp_dia) {
    warnings.push(`BP ${values.bp_sys}/${values.bp_dia} ไม่สมเหตุผล ไม่ได้เติมให้ กรุณาตรวจจากเครื่อง`);
    values.bp_sys = null;
    values.bp_dia = null;
  }
  return { values, missing, warnings, notes: notes.join(' · ') };
}
