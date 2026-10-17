-- รูปแนบของการปรึกษาแพทย์ เก็บในตารางไฟล์เดิม (เนื้อไฟล์แก้ไม่ได้ ลบแบบเก็บประวัติ มี audit log)
-- และข้อสังเกตจาก AI ที่พยาบาลใส่ไว้ในการปรึกษา
ALTER TABLE patient_files DROP CONSTRAINT patient_files_kind_check;
ALTER TABLE patient_files ADD CONSTRAINT patient_files_kind_check CHECK (kind IN ('PHOTO', 'DOCUMENT', 'CONSULT'));
ALTER TABLE patient_files ADD COLUMN consult_id uuid REFERENCES doctor_consults(id);
ALTER TABLE patient_files ADD CONSTRAINT patient_files_consult_check CHECK ((kind = 'CONSULT') = (consult_id IS NOT NULL));
CREATE INDEX patient_files_consult_idx ON patient_files (consult_id) WHERE consult_id IS NOT NULL;

ALTER TABLE doctor_consults ADD COLUMN ai_review text;
ALTER TABLE doctor_consults ADD COLUMN ai_reviewed_at timestamptz;
