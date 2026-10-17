-- เตรียมผู้ป่วย: การตั้งค่ารอบฟอก และตารางนัดฟอกล่วงหน้า

-- รอบฟอกของศูนย์ (เปิดได้ 1-4 รอบต่อวัน, จำนวนเตียงที่ใช้ในแต่ละรอบ ไม่เกิน 30)
CREATE TABLE shift_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift       smallint NOT NULL UNIQUE CHECK (shift BETWEEN 1 AND 4),
  active      boolean NOT NULL DEFAULT true,
  beds        smallint NOT NULL CHECK (beds BETWEEN 0 AND 30),
  start_time  time,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- นัดฟอก: หนึ่งแถวต่อผู้ป่วยหนึ่งคน ในหนึ่งวัน หนึ่งรอบ
CREATE TABLE schedule_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES patients(id),
  schedule_date  date NOT NULL,
  shift          smallint NOT NULL CHECK (shift BETWEEN 1 AND 4),
  bed_no         smallint CHECK (bed_no BETWEEN 1 AND 30),
  note           text,
  status         text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'CANCELLED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ในรอบเดียวกัน ผู้ป่วย (HN) ซ้ำไม่ได้ และเตียงซ้ำไม่ได้
CREATE UNIQUE INDEX schedule_entries_patient_uniq ON schedule_entries (schedule_date, shift, patient_id) WHERE status = 'PLANNED';
CREATE UNIQUE INDEX schedule_entries_bed_uniq ON schedule_entries (schedule_date, shift, bed_no) WHERE status = 'PLANNED' AND bed_no IS NOT NULL;
CREATE INDEX schedule_entries_patient_idx ON schedule_entries (patient_id, schedule_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shift_settings', 'schedule_entries'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t, t);
  END LOOP;
END;
$$;

-- ค่าเริ่มต้น 3 รอบ (ตั้งชื่อผู้บันทึกให้ trigger audit)
SELECT set_config('app.user_name', 'migration', true);
INSERT INTO shift_settings (shift, active, beds, start_time) VALUES
  (1, true, 30, '06:00'), (2, true, 30, '11:00'), (3, true, 30, '16:00'), (4, false, 30, '21:00');
