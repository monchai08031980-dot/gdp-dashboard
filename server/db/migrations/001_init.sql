-- Hemo Sync AI: โครงสร้างฐานข้อมูลเริ่มต้น
-- ผู้ป่วย, รอบการฟอกเลือด (ตามแบบฟอร์ม 519), สัญญาณชีพระหว่างฟอก และ audit log

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- ผู้ป่วย
-- ---------------------------------------------------------------------------
CREATE TABLE patients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hn               text NOT NULL UNIQUE,              -- เลขประจำตัวผู้ป่วย
  prefix           text,                               -- คำนำหน้า
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  sex              text CHECK (sex IN ('M', 'F')),
  birth_date       date,
  blood_group      text,
  diagnosis        text,                               -- สาเหตุไตวาย
  dry_weight_kg    numeric(5,2),                       -- น้ำหนักแห้งเป้าหมาย
  vascular_access  text CHECK (vascular_access IN ('AVF', 'AVG', 'PERM_CATH', 'TEMP_CATH')),
  access_side      text,
  hbsag            text CHECK (hbsag IN ('POS', 'NEG', 'UNKNOWN')) DEFAULT 'UNKNOWN',
  anti_hcv         text CHECK (anti_hcv IN ('POS', 'NEG', 'UNKNOWN')) DEFAULT 'UNKNOWN',
  anti_hiv         text CHECK (anti_hiv IN ('POS', 'NEG', 'UNKNOWN')) DEFAULT 'UNKNOWN',
  payer            text,                               -- สิทธิการรักษา
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- รอบการฟอกเลือด (แบบฟอร์ม 519) หนึ่งแถวต่อการฟอกหนึ่งครั้ง
-- ---------------------------------------------------------------------------
CREATE TABLE dialysis_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL REFERENCES patients(id),
  session_date          date NOT NULL,
  shift                 smallint CHECK (shift BETWEEN 1 AND 4),   -- รอบ เช้า/บ่าย/...
  bed_no                smallint CHECK (bed_no BETWEEN 1 AND 30), -- ศูนย์มี 30 เตียง
  machine_no            text,
  session_no            integer,                                  -- ครั้งที่ฟอก

  -- ก่อนฟอก
  pre_weight_kg         numeric(5,2),
  dry_weight_kg         numeric(5,2),
  pre_bp_sys            smallint,
  pre_bp_dia            smallint,
  pre_pulse             smallint,
  pre_temp_c            numeric(4,1),
  pre_rr                smallint,
  pre_o2sat             smallint,
  pre_symptoms          text,

  -- ใบสั่งการรักษา (prescription)
  dialyzer              text,
  dialyzer_reuse_no     smallint,
  duration_min          smallint,
  blood_flow_ml_min     smallint,
  dialysate_flow_ml_min smallint,
  dialysate_na          numeric(5,1),
  dialysate_k           numeric(3,1),
  dialysate_ca          numeric(3,2),
  dialysate_hco3        numeric(4,1),
  dialysate_temp_c      numeric(3,1),
  uf_goal_ml            integer,
  anticoagulant         text,                 -- เช่น Heparin, LMWH, No heparin
  heparin_loading_iu    integer,
  heparin_maintenance_iu integer,
  access_used           text,
  needle_size           text,

  -- เวลา
  start_time            timestamptz,
  end_time              timestamptz,

  -- หลังฟอก
  post_weight_kg        numeric(5,2),
  post_bp_sys           smallint,
  post_bp_dia           smallint,
  post_pulse            smallint,
  post_temp_c           numeric(4,1),
  actual_uf_ml          integer,
  kt_v                  numeric(4,2),
  urr_pct               numeric(4,1),

  -- ยาและภาวะแทรกซ้อน
  medications           text,                 -- เช่น EPO, Iron, Vitamin
  complications         text,
  nursing_notes         text,
  physician_orders      text,

  -- ผู้รับผิดชอบ
  nurse_name            text,
  physician_name        text,
  status                text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dialysis_sessions_patient_date_idx ON dialysis_sessions (patient_id, session_date DESC);
CREATE INDEX dialysis_sessions_date_idx ON dialysis_sessions (session_date);

-- ---------------------------------------------------------------------------
-- สัญญาณชีพระหว่างฟอก (บันทึกทุก 30-60 นาที)
-- ---------------------------------------------------------------------------
CREATE TABLE intradialytic_vitals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES dialysis_sessions(id) ON DELETE CASCADE,
  recorded_at       timestamptz NOT NULL,
  bp_sys            smallint,
  bp_dia            smallint,
  pulse             smallint,
  blood_flow_ml_min smallint,
  venous_pressure   smallint,
  arterial_pressure smallint,
  tmp               smallint,
  uf_rate_ml_h      integer,
  uf_volume_ml      integer,
  heparin_iu        integer,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intradialytic_vitals_session_idx ON intradialytic_vitals (session_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Audit log: บันทึกทุกการเพิ่ม/แก้ไข/ลบ อัตโนมัติด้วย trigger
-- แอปต้องตั้ง app.user_name (และ app.reason ถ้ามี) ภายใน transaction
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  table_name    text NOT NULL,
  record_id     uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_by    text NOT NULL,
  reason        text,
  old_data      jsonb,
  new_data      jsonb,
  changed_fields text[],
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_record_idx ON audit_log (table_name, record_id, changed_at DESC);

-- audit log แก้ไขหรือลบไม่ได้
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_user   text := NULLIF(current_setting('app.user_name', true), '');
  v_reason text := NULLIF(current_setting('app.reason', true), '');
  v_old    jsonb;
  v_new    jsonb;
  v_fields text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'app.user_name must be set before changing %', TG_TABLE_NAME;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_fields
    FROM jsonb_each(v_new) n
    WHERE n.key <> 'updated_at' AND n.value IS DISTINCT FROM v_old -> n.key;

    IF v_fields IS NULL THEN
      RETURN NEW;  -- ไม่มีอะไรเปลี่ยน ไม่ต้องบันทึก
    END IF;
  END IF;

  INSERT INTO audit_log (table_name, record_id, action, changed_by, reason, old_data, new_data, changed_fields)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), TG_OP, v_user, v_reason, v_old, v_new, v_fields);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients', 'dialysis_sessions', 'intradialytic_vitals'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t, t);
  END LOOP;
END;
$$;
