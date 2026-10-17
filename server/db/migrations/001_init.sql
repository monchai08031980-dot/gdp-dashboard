-- Hemo Sync AI: โครงสร้างฐานข้อมูลเริ่มต้น
-- ผู้ป่วย, รอบการฟอกเลือด (Hemodialysis sheet แบบฟอร์ม 519), บันทึกระหว่างฟอก, ยา และ audit log

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
  vascular_access  text CHECK (vascular_access IN ('AVF', 'AVG', 'DLC', 'PC')),
  access_side      text CHECK (access_side IN ('LT', 'RT')),
  hbsag            text CHECK (hbsag IN ('POS', 'NEG', 'UNKNOWN')) DEFAULT 'UNKNOWN',
  anti_hcv         text CHECK (anti_hcv IN ('POS', 'NEG', 'UNKNOWN')) DEFAULT 'UNKNOWN',
  anti_hiv         text CHECK (anti_hiv IN ('POS', 'NEG', 'UNKNOWN')) DEFAULT 'UNKNOWN',
  payer            text,                               -- สิทธิการรักษา
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- รอบการฟอกเลือด: หนึ่งแถวต่อ Hemodialysis sheet (แบบฟอร์ม 519) หนึ่งแผ่น
-- รายการแบบติ๊ก (checkbox) เก็บเป็น text[] ของรหัสที่ติ๊ก
-- ---------------------------------------------------------------------------
CREATE TABLE dialysis_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id              uuid NOT NULL REFERENCES patients(id),
  session_date            date NOT NULL,
  session_no              integer,                       -- No. ครั้งที่ฟอก
  shift                   smallint CHECK (shift BETWEEN 1 AND 4),
  bed_no                  smallint CHECK (bed_no BETWEEN 1 AND 30),

  -- Pre dialysis assessment: อาการ
  pre_symptoms            text[] NOT NULL DEFAULT '{}' CHECK (pre_symptoms <@ ARRAY[
                            'anxiety', 'sleep_disturbance', 'orthopnea', 'fever', 'headache',
                            'nausea_vomiting', 'anorexia', 'prolonged_bleeding', 'itching',
                            'engorged_neck_vein', 'pale', 'edema', 'constipation', 'chest_pain', 'diarrhea']),
  pre_nurse_note          text,

  -- น้ำหนัก (kg)
  pre_weight_kg           numeric(5,2),
  dry_weight_kg           numeric(5,2),
  last_bw_kg              numeric(5,2),                  -- น้ำหนักหลังฟอกครั้งก่อน
  weight_gain_kg          numeric(4,2),
  target_uf_kg            numeric(4,2),
  post_bw_kg              numeric(5,2),
  weight_loss_kg          numeric(4,2),
  meal_drink_nss_kg       numeric(4,2),

  -- Vascular access
  access_side             text CHECK (access_side IN ('LT', 'RT')),
  access_type             text CHECK (access_type IN ('AVF', 'AVG', 'DLC', 'PC')),
  access_thrill           boolean,
  access_bruit            boolean,
  access_inflammation     boolean,
  access_other            text,

  -- Hemodialysis prescription
  machine_no              text,
  dialyzer                text,
  surface_area_m2         numeric(3,1),
  kuf                     numeric(5,1),
  test_leak               boolean,
  last_tcv                text,
  dialyzer_use_no         smallint,
  disinfectant            text,
  blood_flow_ml_min       smallint,
  dialysate_flow_ml_min   smallint CHECK (dialysate_flow_ml_min IN (300, 500, 700)),
  dialysate_temp_c        numeric(3,1),
  na_uf_variation         boolean,
  na_start                numeric(4,1),
  na_conc_off             numeric(4,1),
  dialysate_k             numeric(3,1),
  dialysate_ca            numeric(3,2),
  dialysate_hco3          numeric(4,1),

  -- Anticoagulant
  anticoagulant           text CHECK (anticoagulant IN ('HEPARIN', 'NO_HEPARIN', 'LMWH')),
  heparin_total_iu        integer,
  heparin_loading_iu      integer,
  heparin_maintenance_iu  integer,
  flush_nss_ml            integer,
  flush_nss_every_min     smallint,
  lmwh_dose               text,

  -- Time dialysis
  duration_hr             numeric(3,1),
  time_start              time,
  time_off                time,

  -- Pre dialysis vital signs
  pre_bp_sys              smallint,
  pre_bp_dia              smallint,
  pre_bt_c                numeric(4,1),
  pre_pr                  smallint,
  pre_rr                  smallint,

  -- Lab
  hct_pct                 numeric(4,1),
  hb_g_dl                 numeric(4,1),

  -- สารน้ำ
  nss_rate_per_min        text,
  glucose_50_ml           integer,
  extra_fluid_ml          integer,
  total_fluid_replacement_ml integer,
  total_uf_ml             integer,
  net_fluid_balance_ml    integer,

  -- Complication / Technical complication / Nursing management / Health education
  complications           text[] NOT NULL DEFAULT '{}' CHECK (complications <@ ARRAY[
                            'hypotension', 'muscle_cramp', 'headache', 'nausea_vomiting', 'fever',
                            'hypertension', 'chest_pain', 'arrhythmia', 'access_problem',
                            'dizziness_syncope', 'no_complication']),
  technical_complications text[] NOT NULL DEFAULT '{}' CHECK (technical_complications <@ ARRAY[
                            'blood_leak', 'clotted_dialyzer', 'clotted_blood_line', 'machine_problem',
                            'no_complication']),
  nursing_management      text[] NOT NULL DEFAULT '{}' CHECK (nursing_management <@ ARRAY[
                            'psycho_support', 'trendelenburg', 'monitor_vs', 'pause_uf',
                            'hypertonic_solution', 'oxygen_therapy', 'increase_dialysate',
                            'decrease_dialysate', 'hot_compression', 'cold_compression',
                            'strength_exercise', 'aware_aspirate', 'monitor_ekg', 'decrease_bfr',
                            'change_dialyzer', 'change_blood_line', 'post_hd_nursing', 'notified_doctor']),
  health_education        text[] NOT NULL DEFAULT '{}' CHECK (health_education <@ ARRAY[
                            'nutrition', 'vascular_access', 'exercise', 'personal_hygiene',
                            'medication', 'fluid_control', 'kt', 'follow_up', 'weigh_bw']),

  nurse_note              text,
  doctor_note             text,
  nephrologist            text,
  dialysis_nurses         text,
  status                  text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dialysis_sessions_patient_date_idx ON dialysis_sessions (patient_id, session_date DESC);
CREATE INDEX dialysis_sessions_date_idx ON dialysis_sessions (session_date);

-- ---------------------------------------------------------------------------
-- ตารางบันทึกระหว่างฟอก (Time, BP, PR, RR, BFR, PV, TMP, Conduct, UFR, Total, Note)
-- ---------------------------------------------------------------------------
CREATE TABLE intradialytic_vitals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES dialysis_sessions(id) ON DELETE CASCADE,
  recorded_time       time NOT NULL,
  bp_sys              smallint,
  bp_dia              smallint,
  pr                  smallint,
  rr                  smallint,
  bfr_ml_min          smallint,
  pv_mmhg             smallint,
  tmp_mmhg            smallint,
  conductivity_ms_cm  numeric(4,1),
  ufr                 integer,
  total_uf_ml         integer,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intradialytic_vitals_session_idx ON intradialytic_vitals (session_id, recorded_time);

-- ---------------------------------------------------------------------------
-- EPO / Medication during HD
-- ---------------------------------------------------------------------------
CREATE TABLE session_medications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES dialysis_sessions(id) ON DELETE CASCADE,
  drug_name   text NOT NULL,                 -- เช่น Espogen, Hemaplus
  dose        text,
  route       text,
  lot_no      text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_medications_session_idx ON session_medications (session_id);

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
  FOREACH t IN ARRAY ARRAY['patients', 'dialysis_sessions', 'intradialytic_vitals', 'session_medications'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t, t);
  END LOOP;
END;
$$;
