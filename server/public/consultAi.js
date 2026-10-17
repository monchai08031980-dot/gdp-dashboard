// ให้ AI ช่วยดูรูปที่แนบในการปรึกษาแพทย์ (เช่น บริเวณแทงเข็ม แผล อาการบวม) และเขียนข้อสังเกตเบื้องต้นให้พยาบาลและแพทย์ตรวจต่อ
// ไม่ใช่การวินิจฉัย ไม่สั่งการรักษา ใช้ร่วมกันทั้งเซิร์ฟเวอร์และหน้าตัวอย่าง
import { CONSULT_TOPICS } from './consult.js';

export const CONSULT_AI_MAX_IMAGES = 4;
export const CONCERN = { high: 'ควรให้แพทย์ดูโดยเร็ว', medium: 'ควรรายงานแพทย์', low: 'เฝ้าติดตาม' };

// context: { topics: [รหัสเรื่อง], findings: [ข้อความ] } ไม่ใส่ชื่อหรือ HN ผู้ป่วย
export function consultAiPrompt(context = {}) {
  const topics = (context.topics || []).map((k) => CONSULT_TOPICS.find(([x]) => x === k)?.[1]).filter(Boolean);
  const findings = (context.findings || []).map((t) => String(t).slice(0, 200)).slice(0, 15);
  return `คุณช่วยพยาบาลไตเทียมดูรูปถ่ายผู้ป่วยระหว่างฟอกเลือด ก่อนรายงานแพทย์ รูปอาจเป็นบริเวณ vascular access (AVF/AVG/สาย DLC) ตำแหน่งแทงเข็ม แผล ผิวหนัง หรืออาการบวม
${topics.length ? `เรื่องที่พยาบาลจะปรึกษา: ${topics.join(', ')}\n` : ''}${findings.length ? `สิ่งที่พบจากแบบฟอร์ม:\n${findings.map((f) => `- ${f}`).join('\n')}\n` : ''}
ตอบเป็นภาษาไทย สั้น ชัด เป็นข้อสังเกตเบื้องต้นสำหรับพยาบาลและแพทย์ ไม่ใช่การวินิจฉัย
- summary: สรุปสิ่งที่เห็นในรูป 1–2 ประโยค
- observations: สิ่งที่เห็นจริงในรูปแต่ละข้อ (ตำแหน่ง สี ขนาดโดยประมาณถ้าเทียบได้ บวม แดง มีหนอง เลือดออก ห้อเลือด ผ้าปิดแผลเปียก ฯลฯ) พร้อม concern: high | medium | low
- red_flags: สัญญาณอันตรายที่เห็นและควรให้แพทย์ประเมินโดยเร็ว (เช่น ติดเชื้อรุนแรง เลือดออกไม่หยุด ห้อเลือดขยาย เส้นฟอกอาจอุดตัน) ถ้าไม่มีให้เป็นรายการว่าง
- possible_causes: ภาวะที่อาจเข้าได้กับสิ่งที่เห็น เขียนว่า "อาจเข้าได้กับ ..." ไม่ฟันธง
- suggested_topics: รหัสเรื่องที่ควรปรึกษาจากรายการนี้เท่านั้น: ${CONSULT_TOPICS.map(([k, l]) => `${k} (${l})`).join(', ')}
- image_quality: good ถ้าเห็นชัดพอประเมิน poor ถ้าเบลอ มืด ไกล หรือไม่เห็นบริเวณที่เกี่ยวข้อง
- notes: ข้อจำกัดของการดูจากรูป หรือสิ่งที่ควรตรวจเพิ่มด้วยการคลำหรือฟัง (เช่น thrill, bruit, อุณหภูมิผิว)
กติกา: บอกเฉพาะสิ่งที่เห็นในรูป ห้ามเดาข้อมูลที่ไม่เห็น ห้ามสั่งยาหรือการรักษา ห้ามระบุตัวตนผู้ป่วย ถ้ารูปไม่ใช่ร่างกายผู้ป่วยหรือดูไม่ได้ให้บอกใน notes
ตอบเป็น JSON อย่างเดียวตามช่องข้างต้น`;
}

export const CONSULT_AI_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    observations: {
      type: 'array',
      items: { type: 'object', properties: { text: { type: 'string' }, concern: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['text', 'concern'], additionalProperties: false },
    },
    red_flags: { type: 'array', items: { type: 'string' } },
    possible_causes: { type: 'array', items: { type: 'string' } },
    suggested_topics: { type: 'array', items: { type: 'string' } },
    image_quality: { type: 'string', enum: ['good', 'poor'] },
    notes: { type: 'string' },
  },
  required: ['summary', 'observations', 'red_flags', 'possible_causes', 'suggested_topics', 'image_quality', 'notes'],
  additionalProperties: false,
};

// ทำความสะอาดผลจาก AI: ตัดความยาว กรองรหัสเรื่องที่ไม่มีจริง
export function cleanAiReview(r = {}) {
  const str = (v, n = 400) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const list = (v, n = 8) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, n) : []);
  return {
    summary: str(r.summary, 600),
    observations: (Array.isArray(r.observations) ? r.observations : [])
      .map((o) => ({ text: str(o?.text, 300), concern: CONCERN[o?.concern] ? o.concern : 'medium' })).filter((o) => o.text).slice(0, 10),
    red_flags: list(r.red_flags),
    possible_causes: list(r.possible_causes),
    suggested_topics: [...new Set((Array.isArray(r.suggested_topics) ? r.suggested_topics : []).filter((k) => CONSULT_TOPICS.some(([x]) => x === k)))],
    image_quality: r.image_quality === 'poor' ? 'poor' : 'good',
    notes: str(r.notes, 600),
  };
}

// ข้อความสำหรับใส่ในรายงานแพทย์
export function aiReviewText(r) {
  const L = ['ข้อสังเกตจาก AI จากรูปที่แนบ (ช่วยดูเบื้องต้น ไม่ใช่การวินิจฉัย แพทย์ต้องประเมินเอง):'];
  if (r.summary) L.push(`   ${r.summary}`);
  for (const o of r.observations) L.push(`   - ${o.text}${o.concern === 'high' ? ' (ควรให้แพทย์ดูโดยเร็ว)' : ''}`);
  if (r.red_flags.length) L.push(`   สัญญาณอันตราย: ${r.red_flags.join('; ')}`);
  if (r.possible_causes.length) L.push(`   ${r.possible_causes.join('; ')}`);
  if (r.image_quality === 'poor') L.push('   รูปไม่ชัดพอ ควรถ่ายใหม่หรือให้แพทย์ดูผู้ป่วยโดยตรง');
  if (r.notes) L.push(`   หมายเหตุ: ${r.notes}`);
  return L.join('\n');
}
