// แปลคำพูดในฟอร์มซักประวัติเป็นอาการและน้ำหนัก (แปลในเครื่อง ใช้ข้อความจำลองเท่านั้น)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpoken, SYMPTOM_WORDS } from '../public/voiceNote.js';
import { CHECKLISTS } from '../public/form519.js';

const sorted = (a) => [...a].sort();

test('รหัสอาการตรงกับแบบฟอร์ม 519', () => {
  assert.deepEqual(sorted(Object.keys(SYMPTOM_WORDS)), sorted(CHECKLISTS.pre_symptoms.map(([k]) => k)));
});

test('แปลอาการที่มี ที่ไม่มี และน้ำหนัก', () => {
  const a = parseSpoken('ขาบวม คัน ไม่มีไข้ ไม่ปวดหัว น้ำหนัก 62.4');
  assert.deepEqual(sorted(a.yes), ['edema', 'itching']);
  assert.deepEqual(sorted(a.no), ['fever', 'headache']);
  assert.deepEqual(a.weights, { pre_weight_kg: 62.4 });
  assert.equal(a.note, 'ขาบวม คัน ไม่มีไข้ ไม่ปวดหัว');

  const b = parseSpoken('นอนไม่หลับ เบื่ออาหาร ปฏิเสธเจ็บหน้าอก น้ำหนัก 58 จุด 6 กิโล ดรายเวท 56');
  assert.deepEqual(sorted(b.yes), ['anorexia', 'sleep_disturbance']);
  assert.deepEqual(b.no, ['chest_pain']);
  assert.deepEqual(b.weights, { dry_weight_kg: 56, pre_weight_kg: 58.6 });

  assert.deepEqual(parseSpoken('ไม่มีอาการเจ็บหน้าอก แต่แน่นหน้าอก').yes, ['chest_pain']);
  assert.deepEqual(parseSpoken('ไม่มีไข้และปวดหัว').yes, ['headache']);
  assert.deepEqual(sorted(parseSpoken('มีไข้ คลื่นไส้อาเจียน ซีด').yes), ['fever', 'nausea_vomiting', 'pale']);
  const en = parseSpoken('no fever, edema both legs, pre weight 70.2 kg');
  assert.deepEqual([en.yes, en.no, en.weights], [['edema'], ['fever'], { pre_weight_kg: 70.2 }]);
  assert.deepEqual(parseSpoken('น้ำหนัก 62,5').weights, { pre_weight_kg: 62.5 });
  assert.deepEqual(parseSpoken('สบายดี').yes, []);
  assert.deepEqual(parseSpoken('').weights, {});
});
