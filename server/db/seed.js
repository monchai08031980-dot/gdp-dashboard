// ข้อมูลจำลองเท่านั้น ห้ามใช้ข้อมูลผู้ป่วยจริง (ชื่อ/HN ทั้งหมดสมมติ)
import { pool, withAudit } from '../src/db.js';
import { insertSql } from '../src/crud.js';

const firstNames = ['สมชาย', 'สมหญิง', 'ประเสริฐ', 'มาลี', 'บุญมี', 'จันทร์เพ็ญ', 'วิชัย', 'สุดา', 'ทองดี', 'อรุณี'];
const lastNames = ['ทดสอบ', 'จำลอง', 'ตัวอย่าง', 'สมมติ', 'ใจดี'];
const accesses = ['AVF', 'AVF', 'AVG', 'PC'];
const diagnoses = ['เบาหวาน', 'ความดันโลหิตสูง', 'ไตอักเสบเรื้อรัง', 'ไม่ทราบสาเหตุ'];

let seed = 519;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a, b) => Math.round(a + rand() * (b - a));

await withAudit('seed-script', 'ข้อมูลจำลองสำหรับพัฒนา', async (db) => {
  const { rows: existing } = await db.query('SELECT count(*)::int AS n FROM patients');
  if (existing[0].n > 0) {
    console.log('มีข้อมูลอยู่แล้ว ข้ามการ seed');
    return;
  }

  for (let i = 0; i < 10; i++) {
    const sex = i % 2 === 0 ? 'M' : 'F';
    const dryWeight = between(450, 750) / 10;
    const { rows } = await db.query(
      `INSERT INTO patients (hn, prefix, first_name, last_name, sex, birth_date, diagnosis,
         dry_weight_kg, vascular_access, access_side, hbsag, anti_hcv, anti_hiv, payer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'NEG','NEG','NEG',$11) RETURNING id`,
      [
        `MOCK-${String(i + 1).padStart(5, '0')}`,
        sex === 'M' ? 'นาย' : 'นาง',
        firstNames[i],
        lastNames[i % lastNames.length],
        sex,
        `${between(1950, 1985)}-0${between(1, 9)}-1${between(0, 9)}`,
        diagnoses[i % diagnoses.length],
        dryWeight,
        accesses[i % accesses.length],
        i % 3 === 0 ? 'RT' : 'LT',
        i % 3 === 0 ? 'ประกันสังคม' : 'บัตรทอง',
      ],
    );
    const patientId = rows[0].id;

    let lastBw = dryWeight + 0.2;
    for (let s = 0; s < 3; s++) {
      const date = new Date(Date.UTC(2026, 9, 1 + s * 2 + (i % 2)));
      const startHour = i % 2 ? 13 : 8;
      const pre = +(dryWeight + between(10, 35) / 10).toFixed(1);
      const gain = +(pre - lastBw).toFixed(1);
      const targetUf = +(pre - dryWeight).toFixed(1);
      const post = +(pre - targetUf + 0.1).toFixed(1);
      const totalUf = Math.round((pre - post) * 1000);
      const complication = s === 1 && i % 4 === 0 ? ['hypotension'] : ['no_complication'];
      const session = {
        patient_id: patientId, session_date: date.toISOString().slice(0, 10), session_no: 40 + s,
        shift: 1 + (i % 2), bed_no: i + 1, status: 'COMPLETED',
        pre_symptoms: s === 2 && i % 3 === 0 ? ['edema', 'itching'] : [],
        pre_weight_kg: pre, dry_weight_kg: dryWeight, last_bw_kg: lastBw, weight_gain_kg: gain,
        target_uf_kg: targetUf, post_bw_kg: post, weight_loss_kg: +(pre - post).toFixed(1),
        access_side: i % 3 === 0 ? 'RT' : 'LT', access_type: accesses[i % accesses.length],
        access_thrill: true, access_bruit: true, access_inflammation: false,
        machine_no: String(i + 1), dialyzer: 'FX80', surface_area_m2: 1.8, test_leak: true,
        dialyzer_use_no: s + 1, disinfectant: 'Peracetic', blood_flow_ml_min: 300 + (i % 3) * 50,
        dialysate_flow_ml_min: 500, dialysate_temp_c: 36.5, na_uf_variation: false,
        na_start: 138, na_conc_off: 138, dialysate_k: 2.0, dialysate_ca: 2.5, dialysate_hco3: 35,
        anticoagulant: 'HEPARIN', heparin_total_iu: 2000, heparin_loading_iu: 1000, heparin_maintenance_iu: 1000,
        duration_hr: 4, time_start: `${String(startHour).padStart(2, '0')}:00`, time_off: `${startHour + 4}:00`,
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
  }
  console.log('seed ข้อมูลจำลองเรียบร้อย: ผู้ป่วย 10 ราย, การฟอก 30 รอบ');
});
await pool.end();
