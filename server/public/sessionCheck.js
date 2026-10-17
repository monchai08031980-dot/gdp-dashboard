// ตรวจแบบฟอร์ม 519 ทั้งชุดก่อนกด "ยืนยันข้อมูลทั้งหมด" ใช้ร่วมกันทั้งเซิร์ฟเวอร์ (ตัดสินจริง) และหน้าเว็บ
// errors: ต้องแก้ก่อนยืนยัน  warnings: ยืนยันได้เมื่อผู้บันทึกตรวจแล้ว
// แต่ละรายการมี section (หัวข้อในแบบฟอร์ม) field (ชื่อช่อง ใช้เลื่อนไปที่ช่อง) และ message
import { SECTIONS, VITAL_FIELDS } from './form519.js';
import { SCREEN_FIELDS } from './screenRead.js';

const FIELD = Object.fromEntries(SECTIONS.flatMap((s) => s.fields.map((f) => [f.name, { ...f, section: s.title }])));
const VITAL_LABEL = Object.fromEntries(VITAL_FIELDS.map((f) => [f.name, f.label]));

// ต้องกรอกก่อนยืนยัน
const REQUIRED = [
  'session_date', 'shift', 'bed_no', 'status',
  'pre_weight_kg', 'dry_weight_kg', 'post_bw_kg',
  'access_side', 'access_type',
  'machine_no', 'dialyzer', 'blood_flow_ml_min',
  'anticoagulant',
  'time_start', 'time_off', 'pre_bp_sys', 'pre_bp_dia', 'pre_pr',
];

// ช่วงค่าที่เป็นไปได้ (นอกช่วงถือว่ากรอกผิด)
const RANGES = {
  shift: [1, 4], bed_no: [1, 30], session_no: [1, 100000],
  pre_weight_kg: [20, 250], dry_weight_kg: [20, 250], last_bw_kg: [20, 250], post_bw_kg: [20, 250],
  weight_gain_kg: [-10, 15], target_uf_kg: [0, 10], weight_loss_kg: [-5, 10], meal_drink_nss_kg: [0, 5],
  surface_area_m2: [0.5, 3], kuf: [1, 120], dialyzer_use_no: [1, 100],
  blood_flow_ml_min: [50, 600], dialysate_temp_c: [34, 40],
  na_start: [120, 160], na_conc_off: [120, 160], dialysate_k: [0, 5], dialysate_ca: [0, 5], dialysate_hco3: [20, 45],
  heparin_total_iu: [0, 20000], heparin_loading_iu: [0, 10000], heparin_maintenance_iu: [0, 10000],
  flush_nss_ml: [0, 1000], flush_nss_every_min: [0, 240],
  duration_hr: [0.5, 8],
  pre_bp_sys: [40, 300], pre_bp_dia: [20, 200], pre_bt_c: [33, 43], pre_pr: [20, 250], pre_rr: [4, 60],
  hct_pct: [5, 70], hb_g_dl: [2, 25],
  glucose_50_ml: [0, 500], extra_fluid_ml: [0, 5000], total_fluid_replacement_ml: [0, 5000],
  total_uf_ml: [0, 10000], net_fluid_balance_ml: [-10000, 10000],
};

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const num = (v) => (isEmpty(v) ? null : Number(v));
const toMin = (t) => (typeof t === 'string' && /^\d{2}:\d{2}/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
const hm = (t) => (t ? String(t).slice(0, 5) : '');
const near = (a, b, tol) => Math.abs(a - b) <= tol + 1e-9;

export function checkSession(session, { vitals = [], medications = [] } = {}) {
  const errors = [];
  const warnings = [];
  const err = (field, message) => errors.push({ section: FIELD[field]?.section || 'บันทึกระหว่างฟอก', field, message });
  const warn = (field, message) => warnings.push({ section: FIELD[field]?.section || 'บันทึกระหว่างฟอก', field, message });
  const label = (name) => FIELD[name]?.label || name;
  const s = session || {};

  // ช่องที่ต้องกรอก
  for (const name of REQUIRED) if (isEmpty(s[name])) err(name, `ยังไม่ได้กรอก ${label(name)}`);

  if (s.status === 'DRAFT' || s.status === 'IN_PROGRESS') err('status', 'สถานะยังไม่เสร็จสิ้น เปลี่ยนเป็น "เสร็จสิ้น" (หรือ "ยกเลิก") ก่อนยืนยัน');

  // ค่าตัวเลขต้องอยู่ในช่วงที่เป็นไปได้
  for (const [name, [min, max]] of Object.entries(RANGES)) {
    const v = num(s[name]);
    if (v === null) continue;
    if (!Number.isFinite(v)) err(name, `${label(name)} ไม่ใช่ตัวเลข`);
    else if (v < min || v > max) err(name, `${label(name)} = ${v} ผิดปกติ (ควรอยู่ระหว่าง ${min}–${max})`);
  }
  if (num(s.pre_bp_sys) !== null && num(s.pre_bp_dia) !== null && num(s.pre_bp_sys) <= num(s.pre_bp_dia)) {
    err('pre_bp_dia', `BP ก่อนฟอก ${s.pre_bp_sys}/${s.pre_bp_dia} ตัวบนต้องมากกว่าตัวล่าง`);
  }

  // เวลาเริ่ม-เลิก และระยะเวลาฟอก
  const start = toMin(hm(s.time_start));
  const off = toMin(hm(s.time_off));
  let dialysisMin = null;
  if (start !== null && off !== null) {
    dialysisMin = (off - start + 1440) % 1440; // ข้ามเที่ยงคืนได้ (รอบดึก)
    if (dialysisMin === 0) err('time_off', 'Time off ต้องไม่เท่ากับ Time start');
    else if (dialysisMin > 8 * 60) err('time_off', `Time start ${hm(s.time_start)} ถึง Time off ${hm(s.time_off)} นานเกิน 8 ชั่วโมง ตรวจเวลาอีกครั้ง`);
    else if (num(s.duration_hr) !== null && !near(dialysisMin / 60, num(s.duration_hr), 0.25)) {
      warn('duration_hr', `Duration ${s.duration_hr} ชม. ไม่ตรงกับเวลาเริ่ม-เลิก (${(dialysisMin / 60).toFixed(1)} ชม.)`);
    }
  }

  // น้ำหนัก: คำนวณตรวจกับค่าที่กรอก
  const pre = num(s.pre_weight_kg), post = num(s.post_bw_kg), last = num(s.last_bw_kg), dry = num(s.dry_weight_kg);
  if (pre !== null && last !== null && num(s.weight_gain_kg) !== null && !near(pre - last, num(s.weight_gain_kg), 0.2)) {
    warn('weight_gain_kg', `Weight gain ${s.weight_gain_kg} kg ไม่ตรงกับ Pre weight − Last BW (${(pre - last).toFixed(1)} kg)`);
  }
  if (pre !== null && post !== null) {
    if (num(s.weight_loss_kg) !== null && !near(pre - post, num(s.weight_loss_kg), 0.2)) {
      warn('weight_loss_kg', `Weight loss ${s.weight_loss_kg} kg ไม่ตรงกับ Pre weight − Post BW (${(pre - post).toFixed(1)} kg)`);
    }
    if (post > pre) warn('post_bw_kg', `Post BW ${post} kg มากกว่า Pre weight ${pre} kg`);
    if (pre - post > 5) warn('post_bw_kg', `น้ำหนักลดระหว่างฟอก ${(pre - post).toFixed(1)} kg มากผิดปกติ`);
  }
  if (post !== null && dry !== null && post < dry - 1) warn('post_bw_kg', `Post BW ${post} kg ต่ำกว่า Dry weight ${dry} kg เกิน 1 kg`);
  if (num(s.target_uf_kg) !== null && num(s.total_uf_ml) !== null && Math.abs(num(s.target_uf_kg) * 1000 - num(s.total_uf_ml)) > 500) {
    warn('total_uf_ml', `Total UF ${s.total_uf_ml} ml ต่างจาก Target UF ${s.target_uf_kg} kg เกิน 500 ml`);
  }

  // Anticoagulant
  if (s.anticoagulant === 'HEPARIN' && isEmpty(s.heparin_total_iu) && isEmpty(s.heparin_loading_iu) && isEmpty(s.heparin_maintenance_iu)) {
    err('heparin_total_iu', 'เลือก Heparin แต่ยังไม่ได้กรอกขนาดยา');
  }
  if (s.anticoagulant === 'LMWH' && isEmpty(s.lmwh_dose)) err('lmwh_dose', 'เลือก LMWH แต่ยังไม่ได้กรอกขนาดยา');
  if (s.anticoagulant === 'NO_HEPARIN' && isEmpty(s.flush_nss_ml)) warn('flush_nss_ml', 'No Heparin แต่ยังไม่ได้กรอก Flush NSS');

  // Complication: ต้องเลือกอย่างน้อยหนึ่งข้อ และ "No complication" ห้ามเลือกคู่กับข้ออื่น
  for (const name of ['complications', 'technical_complications']) {
    const list = Array.isArray(s[name]) ? s[name] : [];
    if (!list.length) err(name, `${label(name)}: เลือกอย่างน้อย 1 ข้อ (ถ้าไม่มีให้เลือก No complication)`);
    else if (list.includes('no_complication') && list.length > 1) err(name, `${label(name)}: เลือก No complication คู่กับอาการอื่นไม่ได้`);
  }
  if ((s.complications || []).some((c) => c !== 'no_complication') && isEmpty(s.nursing_management)) {
    warn('nursing_management', 'มี Complication แต่ยังไม่ได้เลือก Nursing management');
  }

  // บันทึกระหว่างฟอก
  if (!vitals.length) err('vitals', 'ยังไม่มีบันทึกระหว่างฟอก');
  const rows = [...vitals].map((v) => ({ ...v, t: toMin(hm(v.recorded_time)) })).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const seen = new Set();
  let prevTotal = null;
  let prevT = null;
  for (const v of rows) {
    const at = hm(v.recorded_time) || '(ไม่มีเวลา)';
    if (v.t === null) { err('vitals', 'บันทึกระหว่างฟอกมีแถวที่ไม่มีเวลา'); continue; }
    if (seen.has(v.t)) err('vitals', `บันทึกระหว่างฟอกเวลา ${at} ซ้ำกัน`);
    seen.add(v.t);
    for (const [name, { label: l, min, max }] of Object.entries(SCREEN_FIELDS)) {
      const x = num(v[name]);
      if (x !== null && (x < min || x > max)) err('vitals', `บันทึกระหว่างฟอก ${at} ${l} = ${x} ผิดปกติ (${min}–${max})`);
    }
    if (num(v.bp_sys) !== null && num(v.bp_dia) !== null && num(v.bp_sys) <= num(v.bp_dia)) {
      err('vitals', `บันทึกระหว่างฟอก ${at} BP ${v.bp_sys}/${v.bp_dia} ตัวบนต้องมากกว่าตัวล่าง`);
    }
    if (num(v.bp_sys) === null || num(v.bp_dia) === null || num(v.pr) === null) {
      warn('vitals', `บันทึกระหว่างฟอก ${at} ยังไม่มี ${['bp_sys', 'bp_dia', 'pr'].filter((n) => num(v[n]) === null).map((n) => VITAL_LABEL[n]).join(', ')}`);
    }
    if (start !== null && dialysisMin) {
      const after = (v.t - start + 1440) % 1440;
      if (after > dialysisMin + 15 && after < 1440 - 15) warn('vitals', `บันทึกระหว่างฟอก ${at} อยู่นอกช่วง Time start–Time off`);
    }
    if (prevT !== null && v.t - prevT > 60) warn('vitals', `บันทึกระหว่างฟอกเว้นช่วงเกิน 1 ชั่วโมง (${hm(rows.find((r) => r.t === prevT).recorded_time)} ถึง ${at})`);
    const total = num(v.total_uf_ml);
    if (total !== null && prevTotal !== null && total < prevTotal) warn('vitals', `Total ml ที่ ${at} (${total}) น้อยกว่าแถวก่อนหน้า (${prevTotal})`);
    if (total !== null) prevTotal = total;
    prevT = v.t;
  }
  if (prevTotal !== null && num(s.total_uf_ml) !== null && Math.abs(prevTotal - num(s.total_uf_ml)) > 200) {
    warn('total_uf_ml', `Total UF ในแบบฟอร์ม ${s.total_uf_ml} ml ไม่ตรงกับ Total ml แถวสุดท้ายของบันทึกระหว่างฟอก (${prevTotal} ml)`);
  }

  // ยาระหว่างฟอก: แถวที่มีต้องมีชื่อยา
  for (const m of medications) {
    if (isEmpty(m.drug_name)) warn('medications', 'มีรายการยาที่ไม่มีชื่อยา');
  }

  return { errors, warnings };
}
