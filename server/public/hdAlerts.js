// เตือนค่าผิดปกติระหว่างฟอก จากแถว Vital signs ในแบบฟอร์ม 519 ใช้ร่วมกันทั้งเซิร์ฟเวอร์และหน้าตัวอย่าง
// คำนวณในระบบเอง ไม่ส่งข้อมูลออกไปภายนอก เป็นเพียงการเตือน พยาบาลและแพทย์ตัดสินใจเอง
// เกณฑ์เป็นค่าตั้งต้น ปรับให้ตรงแนวทางของศูนย์ได้ที่ HD_LIMITS
export const HD_LIMITS = {
  sbpLow: 90, // SBP ต่ำกว่านี้ = ความดันต่ำ
  sbpDrop: 20, // SBP ลดลงจากก่อนฟอกตั้งแต่นี้
  sbpHigh: 180, dbpHigh: 110,
  prLow: 50, prHigh: 120,
  rrLow: 10, rrHigh: 24,
  bfrLow: 200, // ml/min
  pvHigh: 250, tmpHigh: 250, // mmHg
  conductLow: 13, conductHigh: 15, // mS/cm
  ufrPerKg: 13, // ml/kg/h
  ufOverMl: 200, // Total UF เกิน Target UF ได้ไม่เกินนี้
};

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// rows: แถว Vital signs ตามลำดับเวลา session: ค่าในแบบฟอร์ม (pre_bp_sys, target_uf_kg, dry_weight_kg, pre_weight_kg)
// คืน { rows: [[{ field, level: 'danger' | 'warn', text }]] ตามลำดับแถว, count }
export function hdAlerts(rows, session = {}, limits = HD_LIMITS) {
  const L = limits;
  const firstSbp = rows.map((r) => num(r.bp_sys)).find((v) => v !== null) ?? null;
  const baseSbp = num(session.pre_bp_sys) ?? firstSbp;
  const baseName = num(session.pre_bp_sys) !== null ? 'ก่อนฟอก' : 'แถวแรก';
  const targetMl = num(session.target_uf_kg) !== null ? Math.round(num(session.target_uf_kg) * 1000) : null;
  const weight = num(session.dry_weight_kg) ?? num(session.pre_weight_kg);
  let count = 0;
  const out = rows.map((r) => {
    const a = [];
    const add = (field, level, text) => a.push({ field, level, text });
    const sbp = num(r.bp_sys), dbp = num(r.bp_dia), pr = num(r.pr), rr = num(r.rr);
    if (sbp !== null && sbp < L.sbpLow) add('bp_sys', 'danger', `ความดันต่ำ SBP ${sbp} (ต่ำกว่า ${L.sbpLow})`);
    else if (sbp !== null && baseSbp !== null && baseSbp - sbp >= L.sbpDrop) add('bp_sys', 'warn', `SBP ลดลง ${baseSbp - sbp} mmHg จาก${baseName} (${baseSbp})`);
    if (sbp !== null && sbp >= L.sbpHigh) add('bp_sys', 'warn', `ความดันสูง SBP ${sbp}`);
    if (dbp !== null && dbp >= L.dbpHigh) add('bp_dia', 'warn', `ความดันสูง DBP ${dbp}`);
    if (pr !== null && pr < L.prLow) add('pr', 'danger', `ชีพจรช้า PR ${pr}`);
    if (pr !== null && pr > L.prHigh) add('pr', 'danger', `ชีพจรเร็ว PR ${pr}`);
    if (rr !== null && (rr < L.rrLow || rr > L.rrHigh)) add('rr', 'warn', `หายใจ ${rr} ครั้ง/นาที ผิดปกติ`);
    const bfr = num(r.bfr_ml_min), pv = num(r.pv_mmhg), tmp = num(r.tmp_mmhg), cond = num(r.conductivity_ms_cm);
    if (bfr !== null && bfr < L.bfrLow) add('bfr_ml_min', 'warn', `BFR ${bfr} ต่ำ ตรวจ access และเส้นเลือด`);
    if (pv !== null && pv > L.pvHigh) add('pv_mmhg', 'warn', `PV ${pv} สูง ตรวจเข็มฝั่ง venous และ access`);
    if (tmp !== null && tmp > L.tmpHigh) add('tmp_mmhg', 'warn', `TMP ${tmp} สูง ตรวจ dialyzer อุดตันหรือ UFR สูง`);
    if (cond !== null && (cond < L.conductLow || cond > L.conductHigh)) add('conductivity_ms_cm', 'danger', `Conduct ${cond} นอกช่วง ${L.conductLow}–${L.conductHigh} ตรวจน้ำยา`);
    const ufr = num(r.ufr);
    if (ufr !== null && weight) {
      const perKg = Math.round((ufr / weight) * 10) / 10;
      if (perKg > L.ufrPerKg) add('ufr', 'warn', `UFR ${ufr} ml/h = ${perKg} ml/kg/h เกิน ${L.ufrPerKg} เสี่ยงความดันต่ำ`);
    }
    const total = num(r.total_uf_ml);
    if (total !== null && targetMl !== null && total > targetMl + L.ufOverMl) add('total_uf_ml', 'warn', `UF ${total} ml เกิน Target UF ${targetMl} ml`);
    count += a.length;
    return a;
  });
  return { rows: out, count };
}
