// จัดนัดให้: เสนอนัดฟอกตามรอบและวันประจำของผู้ป่วยแต่ละคน พร้อมเลือกเตียง ใช้ร่วมกันทั้งเซิร์ฟเวอร์และหน้าตัวอย่าง
// คำนวณในระบบเอง ไม่ส่งข้อมูลผู้ป่วยออกไปภายนอก ผลเป็นเพียงข้อเสนอ พยาบาลตรวจแล้วกดยืนยันจึงบันทึก
const DAY_CODE = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const dayCode = (iso) => { const [y, m, d] = iso.split('-').map(Number); return DAY_CODE[(new Date(y, m - 1, d).getDay() + 6) % 7]; };
const normName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// dates: วันที่ที่จะจัด (YYYY-MM-DD, ตั้งแต่วันนี้)
// patients: ผู้ป่วยที่ยังรักษาอยู่ { id, hn, prefix, first_name, last_name, regular_shift, regular_days }
// shifts: การตั้งค่ารอบ { shift, active, beds }
// entries: นัดที่มีอยู่แล้วในช่วงวันนั้น { patient_id, schedule_date, shift, bed_no, first_name, last_name }
// usualBeds: { [patient_id]: เตียงที่ใช้บ่อยที่สุดในรอบประจำ }
// คืน { items: [{ patient_id, hn, name, date, shift, bed_no, usual }], problems: [{ patient_id, hn, name, date, shift, problem }], already }
export function planSchedule({ dates, patients, shifts, entries, usualBeds = {} }) {
  const items = [];
  const problems = [];
  let already = 0;
  const setting = Object.fromEntries(shifts.map((s) => [s.shift, s]));
  const name = (p) => `${p.prefix || ''}${p.first_name} ${p.last_name}`;

  for (const date of [...dates].sort()) {
    const code = dayCode(date);
    const due = patients.filter((p) => p.regular_shift && (p.regular_days || []).includes(code));
    // เตียงและชื่อที่ถูกใช้แล้วในแต่ละรอบของวันนี้
    const slot = {};
    const slotOf = (shift) => (slot[shift] ??= {
      beds: new Set(entries.filter((e) => e.schedule_date === date && e.shift === shift && e.bed_no).map((e) => e.bed_no)),
      names: new Set(entries.filter((e) => e.schedule_date === date && e.shift === shift).map((e) => normName(`${e.first_name} ${e.last_name}`))),
      count: entries.filter((e) => e.schedule_date === date && e.shift === shift).length,
    });
    const waiting = [];
    for (const p of due) {
      if (entries.some((e) => e.schedule_date === date && e.patient_id === p.id)) { already++; continue; }
      const s = setting[p.regular_shift];
      const base = { patient_id: p.id, hn: p.hn, name: name(p), date, shift: p.regular_shift };
      if (!s?.active || !s.beds) { problems.push({ ...base, problem: `ไม่ได้เปิดรอบ ${p.regular_shift}` }); continue; }
      const sl = slotOf(p.regular_shift);
      if (sl.names.has(normName(`${p.first_name} ${p.last_name}`))) { problems.push({ ...base, problem: 'ชื่อซ้ำกับผู้ป่วยที่นัดในรอบนี้แล้ว' }); continue; }
      sl.names.add(normName(`${p.first_name} ${p.last_name}`));
      waiting.push({ p, base, sl, s });
    }
    // รอบแรกให้คนที่มีเตียงประจำได้เตียงเดิมก่อน รอบสองให้เตียงว่างที่เลขน้อยที่สุด
    const placed = new Set();
    for (const w of waiting) {
      const usual = usualBeds[w.p.id];
      if (usual && usual <= w.s.beds && !w.sl.beds.has(usual) && w.sl.count < w.s.beds) {
        w.sl.beds.add(usual); w.sl.count++;
        items.push({ ...w.base, bed_no: usual, usual: true });
        placed.add(w);
      }
    }
    for (const w of waiting) {
      if (placed.has(w)) continue;
      const bed = Array.from({ length: w.s.beds }, (_, i) => i + 1).find((b) => !w.sl.beds.has(b));
      if (!bed || w.sl.count >= w.s.beds) { problems.push({ ...w.base, problem: `รอบ ${w.base.shift} เต็มแล้ว (${w.s.beds} เตียง)` }); continue; }
      w.sl.beds.add(bed); w.sl.count++;
      items.push({ ...w.base, bed_no: bed, usual: false });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.shift - b.shift || a.bed_no - b.bed_no);
  return { items, problems, already };
}
