-- ไฟล์ของผู้ป่วย: รูปผู้ป่วย (.jpg) และเอกสารแนบ (.jpg, .pdf)
-- ข้อมูลไฟล์ (metadata) อยู่ใน patient_files ซึ่งมี audit log เหมือนตารางอื่น
-- เนื้อไฟล์แยกไว้ใน file_contents เพื่อไม่ให้ audit log เก็บไฟล์ทั้งก้อนซ้ำ และแก้ไขภายหลังไม่ได้

CREATE TABLE patient_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL REFERENCES patients(id),
  kind         text NOT NULL CHECK (kind IN ('PHOTO', 'DOCUMENT')),
  file_name    text NOT NULL,
  mime_type    text NOT NULL CHECK (mime_type IN ('image/jpeg', 'application/pdf')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  sha256       text NOT NULL,
  uploaded_by  text NOT NULL,
  deleted_at   timestamptz,                          -- ลบแบบเก็บประวัติ ไม่ลบไฟล์จริง
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'PHOTO' OR mime_type = 'image/jpeg')
);

CREATE INDEX patient_files_patient_idx ON patient_files (patient_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE file_contents (
  file_id  uuid PRIMARY KEY REFERENCES patient_files(id),
  content  bytea NOT NULL
);

CREATE FUNCTION file_contents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'file_contents is write-once';
END;
$$;

CREATE TRIGGER file_contents_no_update_delete
  BEFORE UPDATE OR DELETE ON file_contents
  FOR EACH ROW EXECUTE FUNCTION file_contents_immutable();

CREATE TRIGGER patient_files_touch BEFORE UPDATE ON patient_files FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER patient_files_audit AFTER INSERT OR UPDATE OR DELETE ON patient_files FOR EACH ROW EXECUTE FUNCTION audit_row_change();

ALTER TABLE patients ADD COLUMN photo_file_id uuid REFERENCES patient_files(id);
