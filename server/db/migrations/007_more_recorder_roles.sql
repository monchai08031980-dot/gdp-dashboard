-- ตำแหน่งผู้บันทึกเพิ่ม: แพทย์ เสมียน และอื่นๆ
ALTER TABLE audit_log DROP CONSTRAINT audit_log_changed_by_role_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_changed_by_role_check
  CHECK (changed_by_role IN ('NURSE', 'NURSE_AIDE', 'DOCTOR', 'CLERK', 'OTHER'));
