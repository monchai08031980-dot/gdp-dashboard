// พูดแทนพิมพ์ในฟอร์มซักประวัติ: แปลข้อความที่พยาบาลพูด (หรือพิมพ์) เป็นอาการที่ตอบ Yes น้ำหนัก และ Nurse note
// แปลในเครื่องด้วยคำที่กำหนดไว้ ไม่ส่งข้อความออกไปภายนอก ผลเป็นเพียงร่าง พยาบาลตรวจแล้วกดบันทึกเอง
// ใช้ร่วมกันทั้งเซิร์ฟเวอร์ (ทดสอบ) และหน้าเว็บ

// คำที่หมายถึงแต่ละอาการ (รหัสตรงกับ CHECKLISTS.pre_symptoms ใน form519.js) คำยาวกว่าตรวจก่อน
export const SYMPTOM_WORDS = {
  anxiety: ['วิตกกังวล', 'กังวล', 'เครียด', 'anxiety'],
  sleep_disturbance: ['นอนไม่หลับ', 'หลับไม่สนิท', 'นอนไม่ค่อยหลับ', 'นอนหลับยาก', 'sleep disturbance', 'insomnia'],
  orthopnea: ['นอนราบไม่ได้', 'นอนราบแล้วเหนื่อย', 'นอนหัวสูง', 'orthopnea'],
  fever: ['มีไข้', 'ไข้', 'ตัวร้อน', 'fever'],
  headache: ['ปวดหัว', 'ปวดศีรษะ', 'headache'],
  nausea_vomiting: ['คลื่นไส้', 'อาเจียน', 'อ้วก', 'nausea', 'vomiting'],
  anorexia: ['เบื่ออาหาร', 'ไม่อยากอาหาร', 'กินไม่ได้', 'กินข้าวไม่ได้', 'anorexia'],
  prolonged_bleeding: ['เลือดหยุดยาก', 'เลือดไหลไม่หยุด', 'เลือดออกนาน', 'prolonged bleeding', 'prolong bleeding'],
  itching: ['คัน', 'itching', 'itchy'],
  engorged_neck_vein: ['เส้นเลือดที่คอโป่ง', 'เส้นเลือดคอโป่ง', 'หลอดเลือดที่คอโป่ง', 'คอโป่ง', 'engorged neck vein', 'neck vein'],
  pale: ['ซีด', 'pale'],
  edema: ['บวม', 'edema', 'oedema'],
  constipation: ['ท้องผูก', 'ถ่ายไม่ออก', 'constipation'],
  chest_pain: ['เจ็บหน้าอก', 'แน่นหน้าอก', 'เจ็บอก', 'chest pain'],
  diarrhea: ['ท้องเสีย', 'ท้องร่วง', 'ถ่ายเหลว', 'diarrhea', 'diarrhoea'],
};

// คำปฏิเสธที่อยู่ติดหน้าอาการ เช่น "ไม่มีไข้" "ไม่ปวดหัว" "ปฏิเสธเจ็บหน้าอก" "no fever"
const NEGATION = /(ไม่\s*มี\s*(?:อาการ)?|ไม่\s*ได้|ไม่|ปฏิเสธ\s*(?:อาการ)?|\bno\b|\bdenies\b|\bnot\b)\s*$/i;

// ชื่อช่องน้ำหนักและคำที่ใช้เรียก ตรวจตามลำดับ (คำเฉพาะก่อนคำว่า "น้ำหนัก" เฉย ๆ)
const WEIGHT_WORDS = [
  ['dry_weight_kg', 'dry\\s*weight|ดราย\\s*เว(?:ท|ต|ทต์)|น้ำหนักแห้ง'],
  ['last_bw_kg', 'last\\s*bw|last\\s*body\\s*weight|น้ำหนักครั้งก่อน|น้ำหนักหลังฟอกครั้งก่อน'],
  ['target_uf_kg', 'target\\s*uf|ทาร์?เก็ต\\s*ยูเอฟ|ดึงน้ำ'],
  ['pre_weight_kg', 'pre\\s*weight|พรี\\s*เว(?:ท|ต|ทต์)|น้ำหนักก่อนฟอก|น้ำหนักวันนี้|น้ำหนักตัว|น้ำหนัก|ชั่งได้'],
];
const NUMBER = '(\\d{1,3}(?:\\s*(?:[.,]|จุด)\\s*\\d{1,2})?)';
const toNumber = (s) => Number(s.replace(/\s*(?:จุด|,)\s*/, '.').replace(/\s+/g, ''));

// คืน { yes: [รหัสอาการ], no: [รหัสอาการที่บอกว่าไม่มี], weights: { ชื่อช่อง: kg }, note }
export function parseSpoken(text) {
  let rest = ` ${String(text || '').replace(/\s+/g, ' ').trim()} `;
  const weights = {};
  for (const [name, words] of WEIGHT_WORDS) {
    const re = new RegExp(`(?:${words})\\s*(?:คือ|เท่ากับ|ได้|=|:)?\\s*${NUMBER}\\s*(?:kg|กก\\.?|กิโลกรัม|กิโล)?`, 'i');
    const m = rest.match(re);
    if (!m || name in weights) continue;
    const kg = toNumber(m[1]);
    if (Number.isFinite(kg) && kg > 0 && kg < 300) weights[name] = kg;
    rest = rest.replace(m[0], ' ');
  }

  const { yes, no } = matchWords(rest, SYMPTOM_WORDS);
  return { yes, no, weights, note: rest.replace(/\s+/g, ' ').trim() };
}

// หาคำในพจนานุกรม { รหัส: [คำ] } คำยาวก่อน คำสั้นที่ซ้อนอยู่ในคำยาวไม่นับ คืน { yes, no }
function matchWords(text, dict) {
  const lower = String(text).toLowerCase();
  const yes = new Set();
  const no = new Set();
  const taken = [];
  const all = Object.entries(dict).flatMap(([key, words]) => words.map((w) => [key, w.toLowerCase()]))
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, word] of all) {
    let at = lower.indexOf(word);
    while (at >= 0) {
      const end = at + word.length;
      if (!taken.some(([s, e]) => at < e && end > s)) {
        taken.push([at, end]);
        (NEGATION.test(lower.slice(Math.max(0, at - 16), at)) ? no : yes).add(key);
      }
      at = lower.indexOf(word, end);
    }
  }
  for (const k of yes) no.delete(k);
  return { yes: [...yes], no: [...no] };
}

// ---------------------------------------------------------------------------
// พูดบันทึกใน Hemodialysis sheet: ภาวะแทรกซ้อน การพยาบาล การให้ความรู้ และค่า vital signs ของแถวใหม่
// ---------------------------------------------------------------------------
export const HD_WORDS = {
  complications: {
    hypotension: ['ความดันต่ำ', 'ความดันตก', 'ความดันลด', 'hypotension'],
    muscle_cramp: ['ตะคริว', 'muscle cramp', 'cramp'],
    headache: ['ปวดหัว', 'ปวดศีรษะ', 'headache'],
    nausea_vomiting: ['คลื่นไส้', 'อาเจียน', 'อ้วก', 'nausea', 'vomiting'],
    fever: ['มีไข้', 'ไข้', 'หนาวสั่น', 'fever'],
    hypertension: ['ความดันสูง', 'hypertension'],
    chest_pain: ['เจ็บหน้าอก', 'แน่นหน้าอก', 'เจ็บอก', 'chest pain'],
    arrhythmia: ['หัวใจเต้นผิดจังหวะ', 'ใจสั่น', 'arrhythmia'],
    access_problem: ['เข็มหลุด', 'เส้นไม่ดี', 'เส้นฟอกมีปัญหา', 'เลือดซึม', 'เลือดไหลไม่ดี', 'access problem'],
    dizziness_syncope: ['เวียนหัว', 'เวียนศีรษะ', 'มึนหัว', 'หน้ามืด', 'เป็นลม', 'dizziness', 'syncope'],
    no_complication: ['ไม่มีภาวะแทรกซ้อน', 'ไม่มีอาการผิดปกติ', 'no complication'],
  },
  technical_complications: {
    blood_leak: ['เลือดรั่ว', 'blood leak'],
    clotted_dialyzer: ['ตัวกรองอุดตัน', 'ตัวกรองตัน', 'dialyzer อุดตัน', 'dialyzer ตัน', 'clotted dialyzer'],
    clotted_blood_line: ['สายเลือดอุดตัน', 'สายอุดตัน', 'ลิ่มเลือดในสาย', 'clotted blood line', 'clotted line'],
    machine_problem: ['เครื่องเสีย', 'เครื่องมีปัญหา', 'เครื่องขัดข้อง', 'machine problem'],
    no_complication: ['ไม่มีปัญหาทางเทคนิค', 'ไม่มีปัญหาเครื่อง', 'เครื่องปกติ'],
  },
  nursing_management: {
    psycho_support: ['ให้กำลังใจ', 'psycho support'],
    trendelenburg: ['นอนหัวต่ำ', 'ยกปลายเท้าสูง', 'ยกขาสูง', 'trendelenburg'],
    monitor_vs: ['วัดสัญญาณชีพ', 'ติดตามสัญญาณชีพ', 'วัดความดันซ้ำ', 'monitor v/s', 'monitor vs', 'monitor vital sign'],
    pause_uf: ['หยุด uf', 'ปิด uf', 'หยุดดึงน้ำ', 'pause uf'],
    hypertonic_solution: ['hypertonic', 'ให้ 50% glucose', 'ให้กลูโคส'],
    oxygen_therapy: ['ให้ออกซิเจน', 'ให้ o2', 'on o2', 'oxygen'],
    increase_dialysate: ['เพิ่ม dialysate', 'เพิ่มน้ำยา', 'increase dialysate'],
    decrease_dialysate: ['ลด dialysate', 'ลดน้ำยา', 'decrease dialysate'],
    hot_compression: ['ประคบร้อน', 'ประคบอุ่น', 'hot compression'],
    cold_compression: ['ประคบเย็น', 'cold compression'],
    strength_exercise: ['บริหารกล้ามเนื้อ', 'ยืดกล้ามเนื้อ', 'ยืดเหยียด', 'strength exercise'],
    aware_aspirate: ['ระวังสำลัก', 'aware aspirate'],
    monitor_ekg: ['ติด ekg', 'monitor ekg', 'ดู ekg', 'ทำ ekg'],
    decrease_bfr: ['ลด bfr', 'ลดความเร็วเลือด', 'decrease bfr'],
    change_dialyzer: ['เปลี่ยนตัวกรอง', 'เปลี่ยน dialyzer', 'change dialyzer'],
    change_blood_line: ['เปลี่ยนสายเลือด', 'เปลี่ยนสาย', 'change blood line'],
    post_hd_nursing: ['post hd nursing', 'ดูแลหลังฟอก'],
    notified_doctor: ['แจ้งแพทย์', 'รายงานแพทย์', 'ปรึกษาแพทย์', 'แจ้งหมอ', 'notify doctor', 'notified doctor'],
  },
};
// หัวข้อที่ให้ความรู้ นับเฉพาะคำที่อยู่หลัง "แนะนำ" "ให้ความรู้" "สอน" (ไม่เกิน 40 ตัวอักษร)
const EDUCATION_START = /(แนะนำ|ให้ความรู้|ให้คำแนะนำ|สอน|สุขศึกษา|health education)/gi;
const EDUCATION_WORDS = {
  nutrition: ['อาหาร', 'โภชนาการ', 'nutrition'], vascular_access: ['ดูแลเส้น', 'เส้นฟอก', 'แขนที่ทำเส้น', 'vascular access'],
  exercise: ['ออกกำลังกาย', 'exercise'], personal_hygiene: ['สุขอนามัย', 'ความสะอาด', 'hygiene'],
  medication: ['ยา', 'medication'], fluid_control: ['จำกัดน้ำ', 'ดื่มน้ำ', 'คุมน้ำ', 'fluid'],
  kt: ['ปลูกถ่ายไต', 'เปลี่ยนไต', 'kt'], follow_up: ['มาตามนัด', 'ตามนัด', 'follow up', 'f/u'], weigh_bw: ['ชั่งน้ำหนัก', 'ชั่ง bw'],
};

// ค่า vital signs ที่พูด เช่น "BP 120/80 ชีพจร 80 หายใจ 20 BFR 300 เวลา 10.30"
const N = '(\\d{1,3}(?:\\s*(?:[.]|จุด)\\s*\\d{1,2})?)';
const VITAL_WORDS = [
  ['bp', `(?:bp|ความดัน(?:โลหิต)?|บีพี)\\s*(?:คือ|ได้|=)?\\s*(\\d{2,3})\\s*(?:/|ทับ|\\s)\\s*(\\d{2,3})`],
  ['pr', `(?:pr|ชีพจร|pulse|ชีพจรเต้น)\\s*(?:คือ|ได้|=)?\\s*${N}`],
  ['rr', `(?:rr|หายใจ|การหายใจ)\\s*(?:คือ|ได้|=)?\\s*${N}`],
  ['bfr_ml_min', `(?:bfr|blood flow|บีเอฟอาร์)\\s*(?:คือ|ได้|=)?\\s*${N}`],
  ['pv_mmhg', `(?:pv|venous pressure|vp)\\s*(?:คือ|ได้|=)?\\s*${N}`],
  ['tmp_mmhg', `(?:tmp|ทีเอ็มพี)\\s*(?:คือ|ได้|=)?\\s*${N}`],
  ['conductivity_ms_cm', `(?:conduct(?:ivity)?|คอนดัค)\\s*(?:คือ|ได้|=)?\\s*${N}`],
  ['ufr', `(?:ufr)\\s*(?:คือ|ได้|=)?\\s*${N}`],
  ['total_uf_ml', `(?:total uf|total ml|ดึงน้ำได้|uf รวม)\\s*(?:คือ|ได้|=)?\\s*(\\d{1,4})`],
  ['recorded_time', `(?:เวลา|time)\\s*(\\d{1,2})\\s*(?:[.:]|นาฬิกา|โมง)\\s*(\\d{2})?`],
];

// คืน { checks: { ชื่อรายการ: { yes, no } }, vitals: { ช่อง: ค่า }, note }
export function parseHdSpoken(text) {
  let rest = ` ${String(text || '').replace(/\s+/g, ' ').trim()} `;
  const vitals = {};
  for (const [name, pattern] of VITAL_WORDS) {
    const m = rest.match(new RegExp(pattern, 'i'));
    if (!m) continue;
    if (name === 'bp') { vitals.bp_sys = Number(m[1]); vitals.bp_dia = Number(m[2]); }
    else if (name === 'recorded_time') {
      const h = Number(m[1]), mi = Number(m[2] || 0);
      if (h < 24 && mi < 60) vitals.recorded_time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    } else vitals[name] = toNumber(m[1]);
    rest = rest.replace(m[0], ' ');
  }
  const checks = {};
  for (const [name, dict] of Object.entries(HD_WORDS)) checks[name] = matchWords(rest, dict);
  // ไม่มีภาวะแทรกซ้อน ใช้ร่วมกับภาวะอื่นไม่ได้
  for (const name of ['complications', 'technical_complications']) {
    if (checks[name].yes.length > 1) checks[name].yes = checks[name].yes.filter((k) => k !== 'no_complication');
  }
  const edu = new Set();
  for (const m of rest.matchAll(EDUCATION_START)) {
    for (const k of matchWords(rest.slice(m.index + m[0].length, m.index + m[0].length + 40), EDUCATION_WORDS).yes) edu.add(k);
  }
  checks.health_education = { yes: [...edu], no: [] };
  return { checks, vitals, note: rest.replace(/\s+/g, ' ').trim() };
}
