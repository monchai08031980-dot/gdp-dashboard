-- ตำแหน่งผู้บันทึก (พยาบาล / ผู้ช่วยพยาบาล) เก็บคู่กับชื่อใน audit log
ALTER TABLE audit_log
  ADD COLUMN changed_by_role text CHECK (changed_by_role IN ('NURSE', 'NURSE_AIDE'));

CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_user   text := NULLIF(current_setting('app.user_name', true), '');
  v_role   text := NULLIF(current_setting('app.user_role', true), '');
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

  INSERT INTO audit_log (table_name, record_id, action, changed_by, changed_by_role, reason, old_data, new_data, changed_fields)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), TG_OP, v_user, v_role, v_reason, v_old, v_new, v_fields);

  RETURN COALESCE(NEW, OLD);
END;
$$;
