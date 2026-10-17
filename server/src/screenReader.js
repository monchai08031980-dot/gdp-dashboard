// อ่านค่าจากภาพหน้าจอเครื่องฟอกไต เพื่อเติมแถว "บันทึกระหว่างฟอก" ให้พยาบาลตรวจก่อนบันทึก
// ภาพถูกส่งไปให้ Claude (Anthropic API) อ่าน จึงเปิดใช้เฉพาะเมื่อตั้ง SCREEN_READER=claude
// และ ANTHROPIC_API_KEY ไว้ ก่อนใช้กับผู้ป่วยจริงต้องได้รับอนุมัติจากโรงพยาบาลก่อน
import Anthropic from '@anthropic-ai/sdk';

import { SCREEN_FIELDS, SCREEN_PROMPT, SCREEN_READS, reconcileReads } from '../public/screenRead.js';
import { SCALE_PROMPT, SCALE_READS, reconcileScale } from '../public/scaleRead.js';
import { consultAiPrompt, CONSULT_AI_SCHEMA, cleanAiReview } from '../public/consultAi.js';

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const ROW = {
  type: 'object',
  properties: {
    time_raw: nullable('string'),
    recorded_time: nullable('string'),
    ...Object.fromEntries(Object.keys(SCREEN_FIELDS).map((k) => [k, nullable('number')])),
  },
  required: ['time_raw', 'recorded_time', ...Object.keys(SCREEN_FIELDS)],
  additionalProperties: false,
};
// หน้าจออาจมีค่าหลายแถวตามเวลา จึงอ่านเป็นรายการแถว
const SCHEMA = {
  type: 'object',
  properties: { rows: { type: 'array', items: ROW }, notes: { type: 'string' } },
  required: ['rows', 'notes'],
  additionalProperties: false,
};

// รูปตาชั่ง: ตัวเลขน้ำหนักตามที่เห็น หน่วย และค่านิ่งหรือยัง
const SCALE_SCHEMA = {
  type: 'object',
  properties: {
    weight_raw: nullable('string'),
    unit: { anyOf: [{ type: 'string', enum: ['kg', 'lb'] }, { type: 'null' }] },
    stable: nullable('boolean'),
    notes: { type: 'string' },
  },
  required: ['weight_raw', 'unit', 'stable', 'notes'],
  additionalProperties: false,
};

let client = null;

// หลายรูปในคำขอเดียว: images = [{ data: Buffer, type }]
async function claudeImages(images, prompt, schema) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    messages: [{
      role: 'user',
      content: [
        ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data.toString('base64') } })),
        { type: 'text', text: prompt },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw httpError(422, 'ระบบไม่ดูรูปนี้ กรุณาบรรยายสิ่งที่เห็นเอง');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, 'อ่านผลจากระบบไม่ได้ กรุณาลองใหม่');
  }
}

async function claudeReader(image, mediaType, prompt = SCREEN_PROMPT, schema = SCHEMA) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
        { type: 'text', text: prompt },
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
let scaleReader = null;
export function setScreenReader(fn) { reader = fn; }
export function setScaleReader(fn) { scaleReader = fn; }
const claudeOn = () => process.env.SCREEN_READER === 'claude';
function activeReader() {
  if (reader) return reader;
  return claudeOn() ? claudeReader : null;
}
function activeScaleReader() {
  if (scaleReader) return scaleReader;
  return claudeOn() ? (image, type) => claudeReader(image, type, SCALE_PROMPT, SCALE_SCHEMA) : null;
}
export const screenReaderEnabled = () => Boolean(activeReader());
export const scaleReaderEnabled = () => Boolean(activeScaleReader());

// ให้ AI ช่วยดูรูปในการปรึกษาแพทย์ (ส่งรูปไปภายนอกเหมือนกัน จึงเปิดด้วยค่าเดียวกัน)
let consultReader = null;
export function setConsultReader(fn) { consultReader = fn; }
function activeConsultReader() {
  if (consultReader) return consultReader;
  return claudeOn() ? (images, prompt) => claudeImages(images, prompt, CONSULT_AI_SCHEMA) : null;
}
export const consultReaderEnabled = () => Boolean(activeConsultReader());
export async function reviewConsultImages(images, context) {
  const read = activeConsultReader();
  if (!read) throw httpError(501, 'ยังไม่ได้เปิดใช้ AI ดูรูป (ตั้ง SCREEN_READER=claude และ ANTHROPIC_API_KEY หลังโรงพยาบาลอนุมัติ)');
  const [result] = await readTimes(() => read(images, consultAiPrompt(context)), 1);
  return cleanAiReview(result);
}

async function readTimes(read, times, image, mediaType) {
  try {
    return await Promise.all(Array.from({ length: times }, () => read(image, mediaType)));
  } catch (err) {
    if (err.status && !(err instanceof Anthropic.APIError)) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw httpError(503, 'คีย์ของระบบอ่านภาพไม่ถูกต้อง');
    if (err instanceof Anthropic.RateLimitError) throw httpError(503, 'ระบบอ่านภาพไม่ว่าง กรุณาลองใหม่อีกครั้ง');
    if (err instanceof Anthropic.APIError) throw httpError(502, 'ระบบอ่านภาพขัดข้อง กรุณาลองใหม่หรือกรอกค่าเอง');
    throw err;
  }
}

// อ่านน้ำหนักจากรูปตาชั่ง SCALE_READS ครั้ง เติมเฉพาะเมื่อทุกครั้งตรงกัน (ดู public/scaleRead.js)
export async function readScale(image, mediaType) {
  const read = activeScaleReader();
  if (!read) throw httpError(501, 'ยังไม่ได้เปิดใช้การอ่านรูปตาชั่ง (ตั้ง SCREEN_READER=claude และ ANTHROPIC_API_KEY)');
  return reconcileScale(await readTimes(read, SCALE_READS, image, mediaType));
}

// อ่านภาพเดียวกัน SCREEN_READS ครั้งแยกกัน แล้วเติมเฉพาะค่าที่ทุกครั้งตรงกัน (ดู public/screenRead.js)
// คืน { values, missing, warnings, notes } ค่าที่ไม่แน่ใจเป็น null เสมอ
export async function readMachineScreen(image, mediaType) {
  const read = activeReader();
  if (!read) throw httpError(501, 'ยังไม่ได้เปิดใช้การอ่านภาพหน้าจอเครื่อง (ตั้ง SCREEN_READER=claude และ ANTHROPIC_API_KEY)');
  return reconcileReads(await readTimes(read, SCREEN_READS, image, mediaType));
}

// ตรวจไฟล์จากเนื้อไฟล์จริง ไม่เชื่อ Content-Type
export function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
