-- สิทธิการรักษา: เปลี่ยนชื่อ "ชำระเอง" เป็น "ชำระเงินเอง" (เพิ่ม "รัฐวิสาหกิจ" ในตัวเลือกของหน้าจอ)
-- การแก้ข้อมูลเดิมผ่าน trigger audit ตามปกติ โดยบันทึกผู้แก้เป็น migration
SELECT set_config('app.user_name', 'migration', true),
       set_config('app.reason', 'เปลี่ยนชื่อสิทธิการรักษา ชำระเอง เป็น ชำระเงินเอง', true);
UPDATE patients SET payer = 'ชำระเงินเอง' WHERE payer = 'ชำระเอง';
