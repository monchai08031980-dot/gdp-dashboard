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

export const SCREEN_PROMPT = `ภาพนี้คือภาพถ่ายหน้าจอเครื่องฟอกไต (hemodialysis machine)
หน้าจออาจแสดงค่าปัจจุบันชุดเดียว หรือแสดงเป็นตาราง/ประวัติหลายแถวตามเวลา ให้อ่านทุกแถวที่มีเวลากำกับ แถวละหนึ่งรายการใน rows เรียงตามเวลา
อ่านตัวเลขที่แสดงอยู่บนหน้าจอจริงเท่านั้น ทีละตัวอย่างระมัดระวัง แต่ละแถวมี:
- time_raw: ตัวเลขเวลาของแถวนั้นตามที่เห็น เช่น "10:36" (ค่าชุดเดียวให้ใช้ตัวเลขตรงคำว่า "Time" บนจอ หรือนาฬิกาของเครื่อง ถ้ามี AM/PM ให้ใส่มาด้วย)
  ไม่ใช่ Treatment time, Elapsed, Remaining, Time left ซึ่งเป็นเวลาที่ฟอกไปแล้วหรือเวลาที่เหลือ ถ้าอ่านไม่ชัดให้เป็น null
- recorded_time: เวลาเดียวกับ time_raw ในรูปแบบ HH:MM เช่น 10:36 (ถ้ามี PM ให้แปลงเป็น 24 ชั่วโมง)
- bp_sys / bp_dia: ความดันโลหิต (mmHg) เช่น 128/76 คือ bp_sys 128 bp_dia 76
- pr: ชีพจร (pulse, PR, HR ครั้ง/นาที)
- rr: อัตราการหายใจ (ครั้ง/นาที) ถ้าไม่มีให้เป็น null
- bfr_ml_min: blood flow rate (BFR, Qb, blood pump, ml/min)
- pv_mmhg: venous pressure (PV, VP, venous, mmHg) ระวังเครื่องหมายลบ
- tmp_mmhg: transmembrane pressure (TMP, mmHg) ระวังเครื่องหมายลบ
- conductivity_ms_cm: conductivity ของน้ำยา (Cond, mS/cm) มักอยู่ราว 13-15
- ufr: อัตราดึงน้ำ (UF rate, UFR) หน่วย ml/h ถ้าเครื่องแสดงเป็น L/h ให้คูณ 1000
- total_uf_ml: ปริมาณน้ำที่ดึงออกไปแล้วจริง ณ เวลานั้น (UF volume, UFV, removed) หน่วย ml ไม่ใช่เป้าหมาย (UF goal/target) ถ้าเครื่องแสดงเป็น L ให้คูณ 1000
กติกา: ถ้าค่าใดไม่มี ถูกบัง เบลอ สะท้อนแสง หรือไม่แน่ใจแม้แต่หลักเดียว ให้ใส่ null ห้ามเดา ห้ามคำนวณ (ยกเว้นแปลงลิตรเป็น ml) ห้ามใช้ค่าปกติแทน ห้ามสร้างแถวที่ไม่มีบนจอ
ห้ามสลับค่าตั้ง (set/target/limit) กับค่าที่วัดได้จริง ให้ใช้ค่าที่วัดได้จริง
notes: บอกสั้น ๆ เป็นภาษาไทยถ้ามีค่าที่อ่านไม่ชัดหรือมีสัญญาณเตือนบนหน้าจอ ถ้าไม่มีให้เป็นค่าว่าง
ตอบเป็น JSON อย่างเดียว ตัวอย่าง:
{"rows":[{"time_raw":"10:36","recorded_time":"10:36","bp_sys":128,"bp_dia":76,"pr":80,"rr":null,"bfr_ml_min":300,"pv_mmhg":150,"tmp_mmhg":80,"conductivity_ms_cm":14.0,"ufr":600,"total_uf_ml":1250}],"notes":""}`;

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};
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

// รวมค่าของแถวเดียวกัน (เวลาเดียวกัน) จากการอ่านแต่ละรอบ เติมเฉพาะค่าที่ทุกรอบตรงกันและสมเหตุผล
function reconcileRow(rows, time) {
  const values = { recorded_time: time };
  const missing = time ? [] : ['Time'];
  const warnings = [];
  const at = time ? `${time} ` : '';
  for (const [name, { label, min, max, integer }] of Object.entries(SCREEN_FIELDS)) {
    // UFR และ Total ml เก็บเป็นจำนวนเต็ม (ml/h, ml)
    const got = rows.map((r) => toNumber(r?.[name])).map((v) => (integer && v !== null ? Math.round(v) : v));
    values[name] = null;
    if (got.every((v) => v === null)) { missing.push(label); continue; }
    if (got.some((v) => v === null) || got.some((v) => v !== got[0])) {
      warnings.push(`${at}${label} อ่านได้ไม่ตรงกัน (${got.map((v) => v ?? '-').join(' / ')}) ไม่ได้เติมให้ กรุณาตรวจจากเครื่อง`);
      continue;
    }
    if (got[0] < min || got[0] > max) {
      warnings.push(`${at}${label} อ่านได้ ${got[0]} ซึ่งผิดปกติ ไม่ได้เติมให้ กรุณาตรวจจากเครื่อง`);
      continue;
    }
    values[name] = got[0];
  }
  if (values.bp_sys !== null && values.bp_dia !== null && values.bp_sys <= values.bp_dia) {
    warnings.push(`${at}BP ${values.bp_sys}/${values.bp_dia} ไม่สมเหตุผล ไม่ได้เติมให้ กรุณาตรวจจากเครื่อง`);
    values.bp_sys = null;
    values.bp_dia = null;
  }
  return { values, missing, warnings };
}

const rowsOf = (read) => (Array.isArray(read?.rows) ? read.rows : read ? [read] : []);

// รวมผลอ่านหลายรอบ คืน { rows: [{ values, missing }], warnings, notes }
// จับคู่แถวด้วยเวลาที่อ่านได้ แถวที่ไม่ได้อ่านเจอในทุกรอบจะไม่เติมให้
// ช่อง Time ใช้เวลาตามที่แสดงบนจอเครื่อง ไม่เทียบกับเวลาของอุปกรณ์ (ภาพอาจถ่ายไว้ก่อน)
export function reconcileReads(reads) {
  const notes = [...new Set(reads.map((r) => (typeof r?.notes === 'string' ? r.notes.trim().slice(0, 300) : '')).filter(Boolean))];
  const perRead = reads.map((r) => rowsOf(r).map((row) => ({ time: readClock(row), row })));
  const warnings = [];
  const rows = [];

  // ค่าชุดเดียวบนจอ: จับคู่กันตรง ๆ แม้อ่านเวลาไม่ได้หรือไม่ตรงกัน
  if (perRead.every((list) => list.length === 1)) {
    const times = perRead.map((list) => list[0].time);
    const time = times.every((t) => t && t === times[0]) ? times[0] : null;
    if (!time && times.some(Boolean)) warnings.push(`Time อ่านได้ไม่ตรงกัน (${times.map((t) => t ?? '-').join(' / ')}) ไม่ได้เติมให้ กรุณาดูเวลาบนเครื่อง`);
    const r = reconcileRow(perRead.map((list) => list[0].row), time);
    return { rows: [{ values: r.values, missing: r.missing }], warnings: [...warnings, ...r.warnings], notes: notes.join(' · ') };
  }

  const byTime = perRead.map((list) => {
    const map = new Map();
    for (const { time, row } of list) if (time && !map.has(time)) map.set(time, row);
    return map;
  });
  const allTimes = [...new Set(byTime.flatMap((m) => [...m.keys()]))].sort();
  for (const time of allTimes) {
    if (!byTime.every((m) => m.has(time))) {
      warnings.push(`แถวเวลา ${time} อ่านเจอไม่ครบทุกรอบ ไม่ได้เติมให้ กรุณาตรวจจากเครื่อง`);
      continue;
    }
    const r = reconcileRow(byTime.map((m) => m.get(time)), time);
    rows.push({ values: r.values, missing: r.missing });
    warnings.push(...r.warnings);
  }
  return { rows, warnings, notes: notes.join(' · ') };
}

// กรองแถวตามรอบบันทึก: เวลาเริ่ม แล้วทุก 30 นาทีจนครบ 4 ชั่วโมง (9 จุด)
// ใช้แถวที่เวลาใกล้แต่ละจุดที่สุดไม่เกิน 10 นาที แต่ละแถวใช้ได้ครั้งเดียว
export const SLOT_EVERY_MIN = 30;
export const SLOT_HOURS = 4;
export const SLOT_TOLERANCE_MIN = 10;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// นาทีหลังเวลาเริ่ม (ติดลบได้เล็กน้อย และข้ามเที่ยงคืนได้)
const after = (start, t) => { const d = (toMin(t) - toMin(start) + 1440) % 1440; return d > 1200 ? d - 1440 : d; };
export const slotLabel = (offset) => `${Math.floor(offset / 60)}:${String(offset % 60).padStart(2, '0')} ชม.`;

export function pickSlots(rows, start) {
  const timed = rows.filter((r) => r.values.recorded_time);
  const first = start || timed.map((r) => r.values.recorded_time).sort()[0];
  if (!first) return rows.map((r) => ({ ...r, slot: null }));
  const used = new Set();
  const picked = [];
  for (let offset = 0; offset <= SLOT_HOURS * 60; offset += SLOT_EVERY_MIN) {
    let best = null;
    for (const r of timed) {
      if (used.has(r)) continue;
      const diff = Math.abs(after(first, r.values.recorded_time) - offset);
      if (diff <= SLOT_TOLERANCE_MIN && (!best || diff < best.diff)) best = { r, diff };
    }
    if (best) { used.add(best.r); picked.push({ ...best.r, slot: slotLabel(offset) }); }
  }
  return picked;
}
