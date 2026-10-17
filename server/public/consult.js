// ปรึกษาแพทย์: รวบรวมภาวะที่อาจเป็นอันตรายจากแบบฟอร์ม 519 และเรียบเรียงรายงานแพทย์แบบ SBAR
// ใช้ร่วมกันทั้งเซิร์ฟเวอร์และหน้าเว็บ คำนวณในเครื่อง ไม่ส่งข้อมูลออกไปภายนอก พยาบาลเลือกและแก้ข้อความก่อนบันทึกเสมอ
import { CHECKLISTS } from './form519.js';
import { hdAlerts } from './hdAlerts.js';

// เรื่องที่ปรึกษาบ่อย ให้พยาบาลติ๊กเพิ่มเองได้ (เช่น สิ่งที่เห็นจากการตรวจ ซึ่งไม่มีในแบบฟอร์ม)
export const CONSULT_TOPICS = [
  ['hypotension', 'ความดันตก'],
  ['access_swelling', 'บวม แดง หรือมีแผลใกล้บริเวณแทงเข็ม'],
  ['access_bleeding', 'เลือดออกไม่หยุดบริเวณแทงเข็ม'],
  ['access_flow', 'คลำ Thrill ไม่ได้ หรือเลือดไหลไม่ดี'],
  ['chest_pain', 'เจ็บหรือแน่นหน้าอก'],
  ['dyspnea', 'หอบเหนื่อย นอนราบไม่ได้'],
  ['fever', 'ไข้ หนาวสั่น'],
  ['consciousness', 'ซึม สับสน หรือชัก'],
  ['cramp', 'ตะคริวรุนแรง'],
  ['hypertension', 'ความดันสูงมาก'],
  ['arrhythmia', 'ชีพจรผิดปกติ ใจสั่น'],
  ['other', 'อื่น ๆ'],
];
export const CONSULT_REQUESTS = [
  ['order', 'ขอคำสั่งการรักษา'],
  ['visit', 'ขอให้แพทย์มาดูผู้ป่วย'],
  ['adjust', 'ขอพิจารณาปรับ UF / BFR / เวลาฟอก'],
  ['stop', 'ขอพิจารณาหยุดฟอก'],
  ['refer', 'ขอพิจารณาส่งต่อ / ห้องฉุกเฉิน'],
];
export const URGENCY = { STAT: 'ด่วนมาก', URGENT: 'ด่วน', ROUTINE: 'ไม่ด่วน' };

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const yes = (v) => v === true || v === 'true';
const hm = (t) => (t ? String(t).slice(0, 5) : '');
const label = (list, k) => list.find(([x]) => x === k)?.[1] || k;
const ALERT_SYMPTOMS = ['chest_pain', 'orthopnea', 'engorged_neck_vein', 'fever', 'prolonged_bleeding'];
const ALERT_COMPLICATIONS = ['hypotension', 'chest_pain', 'arrhythmia', 'dizziness_syncope', 'fever', 'access_problem', 'hypertension'];

// ภาวะที่ระบบพบเองจากแบบฟอร์ม คืน [{ key, level: 'danger' | 'warn', text, topic }] (topic = เรื่องที่ควรติ๊กให้)
export function consultFindings(session, vitals = []) {
  const s = session;
  const out = [];
  const add = (key, level, text, topic = null) => { if (!out.some((f) => f.key === key)) out.push({ key, level, text, topic }); };
  const rows = [...vitals].sort((a, b) => String(a.recorded_time || '').localeCompare(String(b.recorded_time || '')));
  const TOPIC = { bp_sys: 'hypotension', pr: 'arrhythmia', bp_dia: 'hypertension' };
  hdAlerts(rows, s).rows.forEach((list, i) => list.forEach((a) => {
    const topic = a.field === 'bp_sys' && /สูง/.test(a.text) ? 'hypertension' : TOPIC[a.field] || null;
    add(`v:${rows[i].id || i}:${a.field}`, a.level, `${hm(rows[i].recorded_time)} ${a.text}`.trim(), topic);
  }));
  if (yes(s.access_inflammation)) add('access_inflammation', 'danger', `Vascular access มี Inflammation${s.access_other ? ` (${s.access_other})` : ''}`, 'access_swelling');
  if (s.access_thrill === false || s.access_thrill === 'false') add('access_thrill', 'danger', 'คลำ Thrill ไม่ได้', 'access_flow');
  if (s.access_bruit === false || s.access_bruit === 'false') add('access_bruit', 'warn', 'ฟัง Bruit ไม่ได้', 'access_flow');
  if (s.access_other && !yes(s.access_inflammation)) add('access_other', 'warn', `Vascular access: ${s.access_other}`);
  for (const k of s.pre_symptoms || []) {
    if (ALERT_SYMPTOMS.includes(k)) add(`pre:${k}`, 'danger', `อาการก่อนฟอก: ${label(CHECKLISTS.pre_symptoms, k)}`, { chest_pain: 'chest_pain', orthopnea: 'dyspnea', engorged_neck_vein: 'dyspnea', fever: 'fever', prolonged_bleeding: 'access_bleeding' }[k]);
  }
  for (const k of s.complications || []) {
    if (ALERT_COMPLICATIONS.includes(k)) add(`comp:${k}`, 'danger', `ภาวะแทรกซ้อน: ${label(CHECKLISTS.complications, k)}`, { hypotension: 'hypotension', chest_pain: 'chest_pain', arrhythmia: 'arrhythmia', fever: 'fever', access_problem: 'access_flow', hypertension: 'hypertension', dizziness_syncope: 'consciousness' }[k]);
    else if (k === 'muscle_cramp') add(`comp:${k}`, 'warn', 'ภาวะแทรกซ้อน: Muscle cramp', 'cramp');
  }
  const bt = num(s.pre_bt_c);
  if (bt !== null && bt >= 37.8) add('pre_bt', 'danger', `ไข้ BT ${bt} °C ก่อนฟอก`, 'fever');
  const gain = num(s.weight_gain_kg), dry = num(s.dry_weight_kg);
  if (gain !== null && dry && (gain > 3 || gain / dry > 0.05)) add('gain', 'warn', `น้ำหนักขึ้นระหว่างฟอก ${gain} kg (${Math.round((gain / dry) * 1000) / 10}% ของ Dry weight)`);
  return out;
}

// รายงานแพทย์แบบ SBAR (ข้อความที่พยาบาลแก้ได้ก่อนบันทึก)
// pick: { topics: [รหัส], other: ข้อความ, findings: [ข้อความ], requests: [รหัส], request_note, urgency, reporter }
export function buildSbar(session, vitals, patient, pick) {
  const s = session;
  const p = patient || {};
  const rows = [...(vitals || [])].sort((a, b) => String(a.recorded_time || '').localeCompare(String(b.recorded_time || '')));
  const last = rows.filter((r) => num(r.bp_sys) !== null || num(r.pr) !== null).at(-1);
  const name = `${p.prefix || s.prefix || ''}${p.first_name || s.first_name || ''} ${p.last_name || s.last_name || ''}`.trim();
  const topics = (pick.topics || []).map((k) => (k === 'other' ? pick.other : label(CONSULT_TOPICS, k))).filter(Boolean);
  const L = [];
  L.push(`ขอปรึกษาแพทย์ (${URGENCY[pick.urgency] || URGENCY.URGENT})`);
  L.push(`S: ${name || 'ผู้ป่วย'} HN ${p.hn || s.hn || '-'} เตียง ${s.bed_no ?? '-'} รอบ ${s.shift ?? '-'} กำลังฟอกเลือด${s.time_start ? ` เริ่ม ${hm(s.time_start)}` : ''}`);
  L.push(`   เรื่องที่ปรึกษา: ${topics.length ? topics.join(', ') : '-'}`);
  const b = [];
  if (p.diagnosis) b.push(`สาเหตุไตวาย ${p.diagnosis}`);
  const access = [p.vascular_access || s.access_type, p.access_side || s.access_side].filter(Boolean).join(' ');
  if (access) b.push(`Access ${access}`);
  if (num(s.dry_weight_kg) !== null) b.push(`Dry weight ${num(s.dry_weight_kg)} kg`);
  if (num(s.pre_weight_kg) !== null) b.push(`Pre weight ${num(s.pre_weight_kg)} kg`);
  if (num(s.target_uf_kg) !== null) b.push(`Target UF ${num(s.target_uf_kg)} kg`);
  if (s.anticoagulant) b.push(`Anticoagulant ${s.anticoagulant}${num(s.heparin_total_iu) !== null ? ` ${num(s.heparin_total_iu)} unit` : ''}`);
  L.push(`B: ${b.join(', ') || '-'}`);
  const a = [];
  if (num(s.pre_bp_sys) !== null) a.push(`BP ก่อนฟอก ${num(s.pre_bp_sys)}/${num(s.pre_bp_dia) ?? '-'}`);
  if (last) a.push(`ล่าสุด ${hm(last.recorded_time)} BP ${num(last.bp_sys) ?? '-'}/${num(last.bp_dia) ?? '-'} PR ${num(last.pr) ?? '-'}${num(last.rr) !== null ? ` RR ${num(last.rr)}` : ''}`);
  const uf = rows.map((r) => num(r.total_uf_ml)).filter((v) => v !== null).at(-1);
  if (uf !== undefined) a.push(`UF ได้ ${uf} ml`);
  L.push(`A: ${a.join(', ') || '-'}`);
  for (const f of pick.findings || []) L.push(`   - ${f}`);
  const done = (s.nursing_management || []).map((k) => label(CHECKLISTS.nursing_management, k));
  if (done.length) L.push(`   การพยาบาลที่ให้แล้ว: ${done.join(', ')}`);
  const req = (pick.requests || []).map((k) => label(CONSULT_REQUESTS, k));
  if (pick.request_note) req.push(pick.request_note);
  L.push(`R: ${req.join(', ') || 'ขอคำสั่งการรักษา'}`);
  if (pick.reporter) L.push(`ผู้รายงาน: ${pick.reporter}`);
  return L.join('\n');
}
