-- ปรึกษาแพทย์ระหว่างฟอก: รายงาน SBAR ที่พยาบาลส่ง และคำสั่งแพทย์ที่ได้รับ (ทุกการเปลี่ยนแปลงมี audit log)
CREATE TABLE doctor_consults (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES dialysis_sessions(id) ON DELETE RESTRICT,
  urgency       text NOT NULL CHECK (urgency IN ('STAT', 'URGENT', 'ROUTINE')),
  topics        text[] NOT NULL DEFAULT '{}',
  findings      text[] NOT NULL DEFAULT '{}',
  requests      text[] NOT NULL DEFAULT '{}',
  report        text NOT NULL CHECK (length(trim(report)) > 0),
  reported_by   text NOT NULL,
  reported_by_role text,
  doctor_name   text,
  doctor_order  text,
  answered_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doctor_consults_session_idx ON doctor_consults (session_id, created_at);
CREATE TRIGGER doctor_consults_touch BEFORE UPDATE ON doctor_consults FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER doctor_consults_audit AFTER INSERT OR UPDATE OR DELETE ON doctor_consults FOR EACH ROW EXECUTE FUNCTION audit_row_change();
