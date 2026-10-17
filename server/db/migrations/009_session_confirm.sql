-- ยืนยันข้อมูลทั้งหมด: ตั้งค่าโฟลเดอร์เก็บข้อมูล และประวัติการยืนยัน/บันทึกไฟล์ของแต่ละรอบฟอก
CREATE TABLE app_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  value       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ไฟล์ที่บันทึกลงโฟลเดอร์แล้ว แก้ไขหรือลบไม่ได้ (เพิ่มได้อย่างเดียว)
CREATE TABLE session_exports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES dialysis_sessions(id) ON DELETE RESTRICT,
  folder        text NOT NULL,
  file_path     text NOT NULL,
  csv_path      text NOT NULL,
  sha256        text NOT NULL,
  warnings      text[] NOT NULL DEFAULT '{}',   -- ข้อควรตรวจที่ผู้ยืนยันรับทราบแล้ว
  confirmed_by  text NOT NULL,
  confirmed_by_role text,
  last_audit_id bigint NOT NULL,             -- audit_log ล่าสุดของรอบฟอกตอนยืนยัน ใช้ตรวจว่ามีการแก้ไขหลังยืนยันหรือไม่
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_exports_session_idx ON session_exports (session_id, created_at DESC);

CREATE FUNCTION session_exports_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'session_exports is append-only';
END;
$$;
CREATE TRIGGER session_exports_no_update_delete
  BEFORE UPDATE OR DELETE ON session_exports
  FOR EACH ROW EXECUTE FUNCTION session_exports_immutable();

CREATE TRIGGER app_settings_touch BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER app_settings_audit AFTER INSERT OR UPDATE OR DELETE ON app_settings FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER session_exports_audit AFTER INSERT ON session_exports FOR EACH ROW EXECUTE FUNCTION audit_row_change();
