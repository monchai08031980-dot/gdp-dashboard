-- รอบฟอกประจำของผู้ป่วย: รอบ และวันในสัปดาห์ที่มาฟอก
ALTER TABLE patients
  ADD COLUMN regular_shift smallint CHECK (regular_shift BETWEEN 1 AND 4),
  ADD COLUMN regular_days text[] NOT NULL DEFAULT '{}'
    CHECK (regular_days <@ ARRAY['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
