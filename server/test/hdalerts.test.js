// เตือนค่าผิดปกติระหว่างฟอก (ข้อมูลจำลองเท่านั้น)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hdAlerts } from '../public/hdAlerts.js';

const fields = (r) => r.map((a) => `${a.field}:${a.level}`);

test('เตือนความดัน ชีพจร ค่าเครื่อง และ UF', () => {
  const rows = [
    { recorded_time: '09:00', bp_sys: 150, bp_dia: 80, pr: 80, rr: 18, bfr_ml_min: 300, pv_mmhg: 140, tmp_mmhg: 100, conductivity_ms_cm: 14, ufr: 600, total_uf_ml: 0 },
    { recorded_time: '10:00', bp_sys: 125, bp_dia: 70, pr: 95, rr: 18, bfr_ml_min: 300, pv_mmhg: 260, tmp_mmhg: 100, conductivity_ms_cm: 14, ufr: 600, total_uf_ml: 600 },
    { recorded_time: '11:00', bp_sys: 85, bp_dia: 50, pr: 125, rr: 26, bfr_ml_min: 180, pv_mmhg: 140, tmp_mmhg: 300, conductivity_ms_cm: 15.5, ufr: 900, total_uf_ml: 2800 },
    { recorded_time: '', bp_sys: '', bp_dia: '', pr: '', rr: '', bfr_ml_min: '', pv_mmhg: '', tmp_mmhg: '', conductivity_ms_cm: '', ufr: '', total_uf_ml: '' },
  ];
  const { rows: a, count } = hdAlerts(rows, { pre_bp_sys: 150, target_uf_kg: 2.5, dry_weight_kg: 60 });
  assert.deepEqual(a[0], []);
  assert.deepEqual(fields(a[1]), ['bp_sys:warn', 'pv_mmhg:warn']);
  assert.match(a[1][0].text, /ลดลง 25 mmHg จากก่อนฟอก/);
  assert.deepEqual(fields(a[2]), ['bp_sys:danger', 'pr:danger', 'rr:warn', 'bfr_ml_min:warn', 'tmp_mmhg:warn', 'conductivity_ms_cm:danger', 'ufr:warn', 'total_uf_ml:warn']);
  assert.match(a[2].find((x) => x.field === 'ufr').text, /15 ml\/kg\/h/);
  assert.deepEqual(a[3], []);
  assert.equal(count, 10);
});

test('ไม่มี BP ก่อนฟอก ใช้แถวแรกเป็นฐาน และไม่มีน้ำหนักก็ไม่คิด UFR ต่อ kg', () => {
  const { rows: a } = hdAlerts([{ bp_sys: 140 }, { bp_sys: 118, ufr: 2000 }], {});
  assert.deepEqual(fields(a[1]), ['bp_sys:warn']);
  assert.match(a[1][0].text, /จากแถวแรก/);
  assert.equal(hdAlerts([{ bp_sys: 'abc', pr: null }], {}).count, 0);
});
