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
- time_raw: ข้อความนาฬิกาของเครื่องตามที่เห็นบนจอทุกตัวอักษร รวม AM/PM ถ้ามี เช่น "16:52" หรือ "4:52 PM"
  นาฬิกามักอยู่มุมบนหรือแถบสถานะของจอ เป็นเวลาของวัน (ชั่วโมง:นาที)
  ห้ามใช้เวลาการฟอก ได้แก่ Treatment time, Therapy time, Elapsed, Remaining, Time left, Rest time, Duration, Dialysis time
  หรือตัวเลขที่มีหน่วย h/min หรือ ชม./นาที ซึ่งเป็นเวลาที่ฟอกไปแล้วหรือเวลาที่เหลือ ไม่ใช่นาฬิกา
  ถ้าบนจอไม่มีนาฬิกาที่แน่ใจว่าเป็นเวลาของวัน ให้ time_raw และ recorded_time เป็น null
- recorded_time: เวลาเดียวกับ time_raw แปลงเป็น HH:MM 24 ชั่วโมง (4:52 PM เป็น 16:52)
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
{"time_raw":"10:42","recorded_time":"10:42","bp_sys":128,"bp_dia":76,"pr":80,"rr":null,"bfr_ml_min":300,"pv_mmhg":150,"tmp_mmhg":80,"conductivity_ms_cm":14.0,"ufr":600,"total_uf_ml":1250,"notes":""}`;

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};
const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const gap = (a, b) => { const d = Math.abs(minutes(a) - minutes(b)); return Math.min(d, 1440 - d); };
const hm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
// อ่านนาฬิกาจาก time_raw ก่อน (รู้ AM/PM) แล้วจึงใช้ recorded_time
// ไม่มี AM/PM ถือเป็นแบบ 24 ชั่วโมงตามที่เห็น ไม่เดาเช้า/บ่าย (3:45 อาจเป็นเวลาที่เหลือ ไม่ใช่ 15:45)
export function readClock(read) {
  for (const text of [read?.time_raw, read?.recorded_time]) {
    const m = typeof text === 'string' ? text.trim().match(/(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/i) : null;
    if (!m) continue;
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ampm = m[3]?.toLowerCase().replace(/\./g, '');
    if (min > 59 || h > 23) continue;
    if (ampm) {
      if (h < 1 || h > 12) continue;
      h = (h % 12) + (ampm === 'pm' ? 12 : 0);
    }
    return hm(h, min);
  }
  return null;
}

// รวมผลอ่านหลายครั้ง คืน { values, missing, warnings, notes }
// now: เวลาปัจจุบันของอุปกรณ์ที่ถ่าย (HH:MM) ใช้ตรวจว่าเวลาที่อ่านได้เป็นนาฬิกาจริง
export function reconcileReads(reads, { now } = {}) {
  const values = {};
  const missing = [];
  const warnings = [];
  const notes = [...new Set(reads.map((r) => (typeof r?.notes === 'string' ? r.notes.trim().slice(0, 300) : '')).filter(Boolean))];

  const validNow = typeof now === 'string' && /^\d{2}:\d{2}$/.test(now) ? now : null;
  const times = reads.map((r) => readClock(r));
  values.recorded_time = times.every((t) => t && t === times[0]) ? times[0] : null;
  if (!values.recorded_time) {
    missing.push('Time');
    if (times.some(Boolean)) warnings.push(`Time อ่านได้ไม่ตรงกัน (${times.map((t) => t ?? '-').join(' / ')}) ไม่ได้เติมให้ กรุณาดูนาฬิกาบนเครื่อง`);
  } else if (validNow && gap(values.recorded_time, validNow) > 120) {
    // ห่างจากเวลาปัจจุบันเกิน 2 ชั่วโมง มักเป็นเวลาฟอกหรือเวลาที่เหลือ ไม่ใช่นาฬิกา
    warnings.push(`Time อ่านได้ ${values.recorded_time} ห่างจากเวลาปัจจุบัน (${validNow}) มาก อาจเป็นเวลาฟอกหรือเวลาที่เหลือ ไม่ได้เติมให้ กรุณาดูนาฬิกาบนเครื่อง`);
    values.recorded_time = null;
    missing.push('Time');
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
