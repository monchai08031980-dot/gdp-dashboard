// ข้อมูลจำลองเท่านั้น ห้ามใช้ข้อมูลผู้ป่วยจริง (ชื่อ/HN ทั้งหมดสมมติ)
import { pool, withAudit } from '../src/db.js';

const firstNames = ['สมชาย', 'สมหญิง', 'ประเสริฐ', 'มาลี', 'บุญมี', 'จันทร์เพ็ญ', 'วิชัย', 'สุดา', 'ทองดี', 'อรุณี'];
const lastNames = ['ทดสอบ', 'จำลอง', 'ตัวอย่าง', 'สมมติ', 'ใจดี'];
const accesses = ['AVF', 'AVF', 'AVG', 'PERM_CATH'];
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
        i % 3 === 0 ? 'ขวา' : 'ซ้าย',
        i % 3 === 0 ? 'ประกันสังคม' : 'บัตรทอง',
      ],
    );
    const patientId = rows[0].id;

    for (let s = 0; s < 3; s++) {
      const date = new Date(Date.UTC(2026, 9, 1 + s * 2 + (i % 2)));
      const start = new Date(date.getTime() + (1 + (i % 2) * 5) * 3600_000); // 08:00 / 13:00 น.
      const end = new Date(start.getTime() + 4 * 3600_000);
      const pre = dryWeight + between(10, 35) / 10;
      const uf = Math.round((pre - dryWeight) * 1000);
      const { rows: sess } = await db.query(
        `INSERT INTO dialysis_sessions (patient_id, session_date, shift, bed_no, machine_no, session_no,
           pre_weight_kg, dry_weight_kg, pre_bp_sys, pre_bp_dia, pre_pulse, pre_temp_c,
           dialyzer, dialyzer_reuse_no, duration_min, blood_flow_ml_min, dialysate_flow_ml_min,
           dialysate_na, dialysate_k, dialysate_ca, dialysate_hco3, uf_goal_ml,
           anticoagulant, heparin_loading_iu, heparin_maintenance_iu, access_used,
           start_time, end_time, post_weight_kg, post_bp_sys, post_bp_dia, post_pulse,
           actual_uf_ml, nurse_name, physician_name, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,36.6,'FX80',$12,240,300,500,138,2.0,1.25,35,$13,
           'Heparin',1000,500,$14,$15,$16,$17,$18,$19,$20,$21,'พยาบาลจำลอง ก','แพทย์จำลอง ข','COMPLETED')
         RETURNING id`,
        [
          patientId, date.toISOString().slice(0, 10), 1 + (i % 2), i + 1, `M-${String(i + 1).padStart(2, '0')}`,
          s + 1, pre, dryWeight, between(130, 170), between(70, 95), between(70, 95), s + 1, uf,
          accesses[i % accesses.length], start, end, (pre - uf / 1000 + 0.1).toFixed(2),
          between(115, 150), between(65, 85), between(70, 90), uf - 100,
        ],
      );
      for (let h = 0; h <= 4; h++) {
        await db.query(
          `INSERT INTO intradialytic_vitals (session_id, recorded_at, bp_sys, bp_dia, pulse,
             blood_flow_ml_min, venous_pressure, arterial_pressure, tmp, uf_rate_ml_h, uf_volume_ml)
           VALUES ($1,$2,$3,$4,$5,300,$6,$7,$8,$9,$10)`,
          [
            sess[0].id, new Date(start.getTime() + h * 3600_000), between(110, 160), between(60, 90),
            between(70, 95), between(120, 180), -between(120, 180), between(40, 90),
            Math.round(uf / 4), Math.round((uf / 4) * h),
          ],
        );
      }
    }
  }
  console.log('seed ข้อมูลจำลองเรียบร้อย: ผู้ป่วย 10 ราย, การฟอก 30 รอบ');
});
await pool.end();
