// อ่านค่าจากภาพหน้าจอเครื่องฟอกไต เพื่อเติมแถว "บันทึกระหว่างฟอก" ให้พยาบาลตรวจก่อนบันทึก
// ภาพถูกส่งไปให้ Claude (Anthropic API) อ่าน จึงเปิดใช้เฉพาะเมื่อตั้ง SCREEN_READER=claude
// และ ANTHROPIC_API_KEY ไว้ ก่อนใช้กับผู้ป่วยจริงต้องได้รับอนุมัติจากโรงพยาบาลก่อน
import Anthropic from '@anthropic-ai/sdk';

// ช่วงค่าที่เป็นไปได้ ค่านอกช่วงถือว่าอ่านผิด จะไม่เติมให้และแจ้งเตือนแทน
export const SCREEN_FIELDS = {
  bp_sys: { label: 'BP sys', min: 40, max: 300 },
  bp_dia: { label: 'BP dia', min: 20, max: 200 },
  pr: { label: 'PR', min: 20, max: 250 },
  rr: { label: 'RR', min: 4, max: 60 },
  bfr_ml_min: { label: 'BFR', min: 0, max: 700 },
  pv_mmhg: { label: 'PV', min: -100, max: 500 },
  tmp_mmhg: { label: 'TMP', min: -100, max: 600 },
  conductivity_ms_cm: { label: 'Conduct', min: 5, max: 20 },
};

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const SCHEMA = {
  type: 'object',
  properties: {
    recorded_time: { ...nullable('string'), description: 'เวลาบนหน้าจอ รูปแบบ HH:MM (24 ชั่วโมง)' },
    ...Object.fromEntries(Object.keys(SCREEN_FIELDS).map((k) => [k, nullable('number')])),
    notes: { type: 'string', description: 'สิ่งที่อ่านไม่ชัดหรือสัญญาณเตือนบนหน้าจอ (ภาษาไทยสั้น ๆ) ถ้าไม่มีให้เป็นค่าว่าง' },
  },
  required: ['recorded_time', ...Object.keys(SCREEN_FIELDS), 'notes'],
  additionalProperties: false,
};

const PROMPT = `ภาพนี้คือหน้าจอเครื่องฟอกไต (hemodialysis machine) ระหว่างการฟอก
ให้อ่านค่าที่แสดงอยู่บนหน้าจอเท่านั้น:
- recorded_time: เวลาปัจจุบันบนหน้าจอ (HH:MM) ไม่ใช่เวลาที่เหลือหรือเวลาที่ฟอกไปแล้ว
- bp_sys / bp_dia: ความดันโลหิตจากการวัดครั้งล่าสุด (mmHg)
- pr: ชีพจร (pulse rate, ครั้ง/นาที) มักแสดงคู่กับความดัน
- rr: อัตราการหายใจ (ครั้ง/นาที) ถ้าไม่มีบนหน้าจอให้เป็น null
- bfr_ml_min: blood flow rate (Qb, ml/min)
- pv_mmhg: venous pressure (PV, VP, mmHg)
- tmp_mmhg: transmembrane pressure (TMP, mmHg)
- conductivity_ms_cm: conductivity ของน้ำยา (mS/cm)
ถ้าค่าใดไม่มีบนหน้าจอ อ่านไม่ชัด หรือไม่แน่ใจ ให้ใส่ null ห้ามเดาหรือคำนวณเอง`;

let client = null;

async function claudeReader(image, mediaType) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw httpError(422, 'ระบบอ่านภาพไม่อ่านภาพนี้ กรุณากรอกค่าเอง');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, 'อ่านผลจากระบบอ่านภาพไม่ได้ กรุณาลองใหม่หรือกรอกค่าเอง');
  }
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

// ทดสอบใส่ตัวอ่านจำลองแทนได้ (ใช้ข้อมูลจำลองเท่านั้น)
let reader = null;
export function setScreenReader(fn) { reader = fn; }
function activeReader() {
  if (reader) return reader;
  if (process.env.SCREEN_READER === 'claude') return claudeReader;
  return null;
}
export const screenReaderEnabled = () => Boolean(activeReader());

// คืน { values, missing, warnings, notes } ค่าที่ไม่ผ่านการตรวจเป็น null เสมอ
export async function readMachineScreen(image, mediaType) {
  const read = activeReader();
  if (!read) throw httpError(501, 'ยังไม่ได้เปิดใช้การอ่านภาพหน้าจอเครื่อง (ตั้ง SCREEN_READER=claude และ ANTHROPIC_API_KEY)');
  let raw;
  try {
    raw = await read(image, mediaType);
  } catch (err) {
    if (err.status && !(err instanceof Anthropic.APIError)) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw httpError(503, 'คีย์ของระบบอ่านภาพไม่ถูกต้อง');
    if (err instanceof Anthropic.RateLimitError) throw httpError(503, 'ระบบอ่านภาพไม่ว่าง กรุณาลองใหม่อีกครั้ง');
    if (err instanceof Anthropic.APIError) throw httpError(502, 'ระบบอ่านภาพขัดข้อง กรุณาลองใหม่หรือกรอกค่าเอง');
    throw err;
  }
  const values = {};
  const missing = [];
  const warnings = [];
  const time = typeof raw?.recorded_time === 'string' ? raw.recorded_time.trim().match(/^(\d{1,2})[:.](\d{2})/) : null;
  values.recorded_time = time && Number(time[1]) < 24 && Number(time[2]) < 60 ? `${time[1].padStart(2, '0')}:${time[2]}` : null;
  if (!values.recorded_time) missing.push('Time');
  for (const [name, { label, min, max }] of Object.entries(SCREEN_FIELDS)) {
    const v = raw?.[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      values[name] = null;
      missing.push(label);
    } else if (v < min || v > max) {
      values[name] = null;
      warnings.push(`${label} อ่านได้ ${v} ซึ่งผิดปกติ ไม่ได้เติมให้ กรุณาตรวจจากเครื่อง`);
    } else {
      values[name] = v;
    }
  }
  return { values, missing, warnings, notes: typeof raw?.notes === 'string' ? raw.notes.slice(0, 500) : '' };
}

// ตรวจไฟล์จากเนื้อไฟล์จริง ไม่เชื่อ Content-Type
export function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
