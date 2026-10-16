-- ข้อมูลผู้ป่วยเก่า: ผู้ป่วยที่ถูกลบออกจากรายชื่อ (active = false) เก็บวันที่และเหตุผลไว้
ALTER TABLE patients
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archive_reason text;

-- ผู้ป่วยที่ลบไปก่อนหน้านี้ ใช้เวลาที่แก้ไขล่าสุดเป็นวันที่ย้ายไปข้อมูลผู้ป่วยเก่า
SELECT set_config('app.user_name', 'migration', true),
       set_config('app.reason', 'ตั้งวันที่ย้ายไปข้อมูลผู้ป่วยเก่าให้ผู้ป่วยที่ลบไปแล้ว', true);
UPDATE patients SET archived_at = updated_at WHERE NOT active AND archived_at IS NULL;
