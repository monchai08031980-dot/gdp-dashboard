-- ซักประวัติเบื้องต้นจากตารางนัดฟอก: นัดหนึ่งรายการผูกกับแบบฟอร์ม 519 หนึ่งใบ
-- ค่าที่ซักประวัติเก็บในแบบฟอร์มใบนั้นโดยตรง Hemodialysis sheet จึงแสดงค่าเดียวกัน ไม่มีสำเนาซ้ำ
ALTER TABLE schedule_entries ADD COLUMN session_id uuid REFERENCES dialysis_sessions(id);
CREATE UNIQUE INDEX schedule_entries_session_uniq ON schedule_entries (session_id) WHERE session_id IS NOT NULL;
