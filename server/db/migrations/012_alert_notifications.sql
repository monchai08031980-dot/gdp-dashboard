-- การแจ้งเตือนค่าผิดปกติระหว่างฟอกทาง SMS: บันทึกทุกครั้งที่ส่งหรือส่งไม่ได้ เพิ่มได้อย่างเดียว
-- หนึ่งแถว vital signs + ช่องที่ผิดปกติ + เบอร์ ส่งได้ครั้งเดียว (แก้แถวซ้ำไม่ส่งซ้ำ)
CREATE TABLE alert_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES dialysis_sessions(id) ON DELETE RESTRICT,
  vital_id    uuid NOT NULL,
  field       text NOT NULL,
  level       text NOT NULL CHECK (level IN ('warn', 'danger')),
  channel     text NOT NULL DEFAULT 'SMS',
  phone       text NOT NULL,
  message     text NOT NULL,
  status      text NOT NULL CHECK (status IN ('SENT', 'FAILED', 'NOT_CONFIGURED')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vital_id, field, phone)
);
CREATE INDEX alert_notifications_session_idx ON alert_notifications (session_id, created_at);

CREATE FUNCTION alert_notifications_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'alert_notifications is append-only';
END;
$$;
CREATE TRIGGER alert_notifications_no_update_delete
  BEFORE UPDATE OR DELETE ON alert_notifications
  FOR EACH ROW EXECUTE FUNCTION alert_notifications_immutable();
CREATE TRIGGER alert_notifications_audit AFTER INSERT ON alert_notifications FOR EACH ROW EXECUTE FUNCTION audit_row_change();
