// ข้อมูลจำลองเท่านั้น ห้ามใช้ข้อมูลผู้ป่วยจริง (ชื่อ/HN ทั้งหมดสมมติ)
import { pool, withAudit } from '../src/db.js';
import { insertSql } from '../src/crud.js';

const firstNames = ['สมชาย', 'สมหญิง', 'ประเสริฐ', 'มาลี', 'บุญมี', 'จันทร์เพ็ญ', 'วิชัย', 'สุดา', 'ทองดี', 'อรุณี',
  'สมศักดิ์', 'วันเพ็ญ', 'ชัยวัฒน์', 'ละเอียด', 'ประยูร', 'สมพร', 'บุญเรือง', 'คำปุน', 'สุริยา', 'นงลักษณ์']; // สลับชาย/หญิง
const lastNames = ['ทดสอบ', 'จำลอง', 'ตัวอย่าง', 'สมมติ', 'ใจดี', 'มีสุข', 'ทดลอง', 'สาธิต', 'ฝึกหัด', 'แบบร่าง'];
const accesses = ['AVF', 'AVF', 'AVG', 'PC'];
const diagnoses = ['เบาหวาน', 'ความดันโลหิตสูง', 'ไตอักเสบเรื้อรัง', 'ไม่ทราบสาเหตุ'];
const PATIENT_COUNT = 190; // ชื่อ-สกุลไม่ซ้ำกัน (20 ชื่อ x 10 สกุล)
const BEDS = 30;
const SHIFT_START = { 1: 6, 2: 11, 3: 16 };
const DAY_CODE = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

let seed = 519;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a, b) => Math.round(a + rand() * (b - a));

const pad = (n) => String(n).padStart(2, '0');
const dayStr = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dow = (s) => (new Date(s + 'T00:00:00').getDay() + 6) % 7; // 0 = จันทร์

// รอบประจำ: ส่วนใหญ่ฟอก 3 ครั้ง/สัปดาห์ (จ.พ.ศ. หรือ อ.พฤ.ส.) ทุกคนที่ 4 ฟอก 2 ครั้ง
// เลือกรอบที่ว่างที่สุดและเตียงเดียวกันทุกวันที่มา ไม่ให้เกิน 30 เตียงในแต่ละรอบแต่ละวัน
const PATTERNS = [[0, 2, 4], [1, 3, 5], [0, 3], [1, 4], [2, 5]];
const bedUse = {};
const usedBeds = (shift, day) => (bedUse[`${shift}:${day}`] ||= new Set());
const plan = Array.from({ length: PATIENT_COUNT }, (_, i) => {
  const preferred = i % 4 === 3 ? 2 + ((i >> 2) % 3) : i % 2;
  for (const days of [PATTERNS[preferred], ...PATTERNS.filter((_, k) => k !== preferred)]) {
    const shifts = [1, 2, 3].sort((a, b) => Math.max(...days.map((d) => usedBeds(a, d).size)) - Math.max(...days.map((d) => usedBeds(b, d).size)) || a - b);
    for (const shift of shifts) {
      const bed = Array.from({ length: BEDS }, (_, b) => b + 1).find((b) => days.every((d) => !usedBeds(shift, d).has(b)));
      if (bed) { days.forEach((d) => usedBeds(shift, d).add(bed)); return { shift, bed, days }; }
    }
  }
  throw new Error('เตียงไม่พอสำหรับผู้ป่วยจำลอง');
});

await withAudit('seed-script', 'ข้อมูลจำลองสำหรับพัฒนา', async (db) => {
  const { rows: existing } = await db.query('SELECT count(*)::int AS n FROM patients');
  if (existing[0].n > 0) {
    console.log('มีข้อมูลอยู่แล้ว ข้ามการ seed');
    return;
  }
  await db.query("UPDATE shift_settings SET active = shift <= 3, beds = $1", [BEDS]);

  let sessions = 0;
  let bookings = 0;
  for (let i = 0; i < PATIENT_COUNT; i++) {
    const { shift, bed, days } = plan[i];
    const sex = i % 2 === 0 ? 'M' : 'F';
    const dryWeight = between(450, 750) / 10;
    const { rows } = await db.query(
      `INSERT INTO patients (hn, prefix, first_name, last_name, sex, birth_date, diagnosis,
         dry_weight_kg, vascular_access, access_side, hbsag, anti_hcv, anti_hiv, payer, regular_shift, regular_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'NEG','NEG','NEG',$11,$12,$13) RETURNING id`,
      [
        `MOCK-${String(i + 1).padStart(5, '0')}`,
        sex === 'M' ? 'นาย' : 'นาง',
        firstNames[i % 20],
        lastNames[Math.floor(i / 20)],
        sex,
        `${between(1950, 1985)}-0${between(1, 9)}-1${between(0, 9)}`,
        diagnoses[i % diagnoses.length],
        dryWeight,
        accesses[i % accesses.length],
        i % 3 === 0 ? 'RT' : 'LT',
        ['บัตรทอง', 'บัตรทอง', 'บัตรทอง', 'บัตรทอง', 'บัตรทอง', 'ประกันสังคม', 'ประกันสังคม', 'ข้าราชการ', 'รัฐวิสาหกิจ', 'ชำระเงินเอง'][i % 10],
        shift,
        days.map((d) => DAY_CODE[d]),
      ],
    );
    const patientId = rows[0].id;

    // ประวัติการฟอก 3 ครั้งล่าสุดตามวันประจำ ก่อนวันนี้
    const history = Array.from({ length: 10 }, (_, k) => dayStr(k - 10)).filter((d) => days.includes(dow(d))).slice(-3);
    sessions += history.length;
    let lastBw = dryWeight + 0.2;
    for (let s = 0; s < history.length; s++) {
      const startHour = SHIFT_START[shift];
      const pre = +(dryWeight + between(10, 35) / 10).toFixed(1);
      const gain = +(pre - lastBw).toFixed(1);
      const targetUf = +(pre - dryWeight).toFixed(1);
      const post = +(pre - targetUf + 0.1).toFixed(1);
      const totalUf = Math.round((pre - post) * 1000);
      const complication = s === 1 && i % 4 === 0 ? ['hypotension'] : ['no_complication'];
      const session = {
        patient_id: patientId, session_date: history[s], session_no: 40 + s,
        shift, bed_no: bed, status: 'COMPLETED',
        pre_symptoms: s === 2 && i % 3 === 0 ? ['edema', 'itching'] : [],
        pre_weight_kg: pre, dry_weight_kg: dryWeight, last_bw_kg: lastBw, weight_gain_kg: gain,
        target_uf_kg: targetUf, post_bw_kg: post, weight_loss_kg: +(pre - post).toFixed(1),
        access_side: i % 3 === 0 ? 'RT' : 'LT', access_type: accesses[i % accesses.length],
        access_thrill: true, access_bruit: true, access_inflammation: false,
        machine_no: String(bed), dialyzer: 'FX80', surface_area_m2: 1.8, test_leak: true,
        dialyzer_use_no: s + 1, disinfectant: 'Peracetic', blood_flow_ml_min: 300 + (i % 3) * 50,
        dialysate_flow_ml_min: 500, dialysate_temp_c: 36.5, na_uf_variation: false,
        na_start: 138, na_conc_off: 138, dialysate_k: 2.0, dialysate_ca: 2.5, dialysate_hco3: 35,
        anticoagulant: 'HEPARIN', heparin_total_iu: 2000, heparin_loading_iu: 1000, heparin_maintenance_iu: 1000,
        duration_hr: 4, time_start: `${String(startHour).padStart(2, '0')}:00`, time_off: `${String(startHour + 4).padStart(2, '0')}:00`,
        pre_bp_sys: between(130, 170), pre_bp_dia: between(70, 95), pre_bt_c: 36.6,
        pre_pr: between(70, 95), pre_rr: 18, hct_pct: between(28, 36), hb_g_dl: between(90, 120) / 10,
        total_uf_ml: totalUf, net_fluid_balance_ml: -totalUf,
        complications: complication, technical_complications: ['no_complication'],
        nursing_management: complication[0] === 'hypotension' ? ['monitor_vs', 'pause_uf', 'post_hd_nursing'] : ['monitor_vs', 'post_hd_nursing'],
        health_education: ['nutrition', 'fluid_control'],
        nephrologist: 'แพทย์จำลอง ข', dialysis_nurses: 'พยาบาลจำลอง ก',
      };
      const { rows: sess } = await db.query(insertSql('dialysis_sessions', session));
      lastBw = post;

      for (let h = 0; h <= 8; h++) {
        const t = startHour * 60 + h * 30;
        await db.query(insertSql('intradialytic_vitals', {
          session_id: sess[0].id,
          recorded_time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`,
          bp_sys: between(110, 160), bp_dia: between(60, 90), pr: between(70, 95), rr: 18,
          bfr_ml_min: session.blood_flow_ml_min, pv_mmhg: between(120, 200), tmp_mmhg: between(0, 90),
          conductivity_ms_cm: 14.0, ufr: Math.round(totalUf / 4), total_uf_ml: Math.round((totalUf / 8) * h),
          note: h === 0 ? 'Start HD' : null,
        }));
      }
      if (s === 0) {
        await db.query(insertSql('session_medications', { session_id: sess[0].id, drug_name: 'EPO (จำลอง)', dose: '4000 IU', route: 'SC' }));
      }
    }

    // นัดล่วงหน้า 4 สัปดาห์ตามรอบและเตียงประจำ
    for (let off = 0; off < 28; off++) {
      const date = dayStr(off);
      if (!days.includes(dow(date))) continue;
      await db.query(insertSql('schedule_entries', { patient_id: patientId, schedule_date: date, shift, bed_no: bed }));
      bookings++;
    }
  }
  console.log(`seed ข้อมูลจำลองเรียบร้อย: ผู้ป่วย ${PATIENT_COUNT} ราย, การฟอก ${sessions} รอบ, นัดล่วงหน้า ${bookings} นัด`);
});
await pool.end();
