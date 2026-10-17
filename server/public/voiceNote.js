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

  const lower = rest.toLowerCase();
  const yes = new Set();
  const no = new Set();
  const taken = []; // ช่วงข้อความที่จับคู่แล้ว กันคำสั้นซ้อนคำยาว (เช่น "ไข้" ใน "มีไข้")
  const all = Object.entries(SYMPTOM_WORDS).flatMap(([key, words]) => words.map((w) => [key, w.toLowerCase()]))
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
  return { yes: [...yes], no: [...no], weights, note: rest.replace(/\s+/g, ' ').trim() };
}
