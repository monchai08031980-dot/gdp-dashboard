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

test('พูดบันทึกใน Hemodialysis sheet: ภาวะแทรกซ้อน การพยาบาล การให้ความรู้ และค่า vital signs', async () => {
  const { parseHdSpoken, HD_WORDS } = await import('../public/voiceNote.js');
  for (const name of Object.keys(HD_WORDS)) assert.deepEqual(sorted(Object.keys(HD_WORDS[name])), sorted(CHECKLISTS[name].map(([k]) => k)));
  const a = parseHdSpoken('เวลา 10.30 ความดัน 85/50 ชีพจร 110 เป็นตะคริวและหน้ามืด ให้นอนหัวต่ำ หยุด UF แจ้งแพทย์');
  assert.deepEqual(a.vitals, { bp_sys: 85, bp_dia: 50, pr: 110, recorded_time: '10:30' });
  assert.deepEqual(sorted(a.checks.complications.yes), ['dizziness_syncope', 'muscle_cramp']);
  assert.deepEqual(sorted(a.checks.nursing_management.yes), ['notified_doctor', 'pause_uf', 'trendelenburg']);
  assert.equal(a.note, 'เป็นตะคริวและหน้ามืด ให้นอนหัวต่ำ หยุด UF แจ้งแพทย์');

  const b = parseHdSpoken('ไม่มีภาวะแทรกซ้อน แนะนำเรื่องอาหารและการจำกัดน้ำ');
  assert.deepEqual(b.checks.complications.yes, ['no_complication']);
  assert.deepEqual(sorted(b.checks.health_education.yes), ['fluid_control', 'nutrition']);
  // คำว่า "อาหาร" ที่ไม่ได้อยู่หลัง "แนะนำ" ไม่นับเป็นการให้ความรู้
  assert.deepEqual(parseHdSpoken('ทานอาหารได้น้อย').checks.health_education.yes, []);

  const c = parseHdSpoken('BP 140/90 PR 80 ไม่มีตะคริว ตัวกรองอุดตัน เปลี่ยนตัวกรอง');
  assert.deepEqual(c.checks.complications, { yes: [], no: ['muscle_cramp'] });
  assert.deepEqual(c.checks.technical_complications.yes, ['clotted_dialyzer']);
  assert.deepEqual(c.checks.nursing_management.yes, ['change_dialyzer']);
  assert.deepEqual(parseHdSpoken('ความดัน 120 80 bfr 300 tmp 120').vitals, { bp_sys: 120, bp_dia: 80, bfr_ml_min: 300, tmp_mmhg: 120 });
  assert.deepEqual(parseHdSpoken('ความดันต่ำ ตะคริว').checks.complications.yes.sort(), ['hypotension', 'muscle_cramp']);
});
