// โครงสร้างแบบฟอร์ม 519 (Hemodialysis sheet ศูนย์ไตเทียมหนองบัวลำภู)
// ใช้ร่วมกันทั้งหน้าเว็บ (สร้างฟอร์ม) และ server (รายชื่อคอลัมน์ที่อนุญาตให้บันทึก)
// ป้ายกำกับใช้ภาษาอังกฤษตามแบบฟอร์มกระดาษ เพื่อให้พยาบาลหาช่องได้ตรงกัน

const YES_NO = [['true', 'Yes'], ['false', 'No']];
const Y_N = [['true', 'Y'], ['false', 'N']];

export const CHECKLISTS = {
  pre_symptoms: [
    ['anxiety', 'Anxiety'], ['sleep_disturbance', 'Sleep disturbance'], ['orthopnea', 'Orthopnea'],
    ['fever', 'Fever'], ['headache', 'Headache'], ['nausea_vomiting', 'Nausea/Vomiting'],
    ['anorexia', 'Anorexia'], ['prolonged_bleeding', 'Prolong bleeding'], ['itching', 'Itching'],
    ['engorged_neck_vein', 'Engorged neck vein'], ['pale', 'Pale'], ['edema', 'Edema'],
    ['constipation', 'Constipation'], ['chest_pain', 'Chest pain'], ['diarrhea', 'Diarrhea'],
  ],
  complications: [
    ['hypotension', 'Hypotension'], ['muscle_cramp', 'Muscle cramp'], ['headache', 'Headache'],
    ['nausea_vomiting', 'Nausea/Vomiting'], ['fever', 'Fever'], ['hypertension', 'Hypertension'],
    ['chest_pain', 'Chest pain'], ['arrhythmia', 'Arrhythmia'], ['access_problem', 'Access problem'],
    ['dizziness_syncope', 'Dizziness/syncope'], ['no_complication', 'No complication'],
  ],
  technical_complications: [
    ['blood_leak', 'Blood leak'], ['clotted_dialyzer', 'Clotted dialyzer'],
    ['clotted_blood_line', 'Clotted blood line'], ['machine_problem', 'Machine problem'],
    ['no_complication', 'No complication'],
  ],
  nursing_management: [
    ['psycho_support', 'Psycho support'], ['trendelenburg', 'Trendelenburg'], ['monitor_vs', 'Monitor V/S'],
    ['pause_uf', 'Pause UF'], ['hypertonic_solution', 'Hypertonic solution'], ['oxygen_therapy', 'Oxygen therapy'],
    ['increase_dialysate', 'Increase dialysate'], ['decrease_dialysate', 'Decrease dialysate'],
    ['hot_compression', 'Hot compression'], ['cold_compression', 'Cold compression'],
    ['strength_exercise', 'Strength exercise'], ['aware_aspirate', 'Aware aspirate'],
    ['monitor_ekg', 'Monitor EKG'], ['decrease_bfr', 'Decrease BFR'], ['change_dialyzer', 'Change dialyzer'],
    ['change_blood_line', 'Change blood line'], ['post_hd_nursing', 'Post HD nursing'],
    ['notified_doctor', 'Notified Doctor'],
  ],
  health_education: [
    ['nutrition', 'Nutrition'], ['vascular_access', 'Vascular access'], ['exercise', 'Exercise'],
    ['personal_hygiene', 'Personal hygiene'], ['medication', 'Medication'], ['fluid_control', 'Fluid control'],
    ['kt', 'KT'], ['follow_up', 'F/U'], ['weigh_bw', 'การชั่ง BW'],
  ],
};

// type: text | number | date | time | textarea | select | bool | checklist
export const SECTIONS = [
  {
    title: 'ข้อมูลรอบฟอก',
    fields: [
      { name: 'session_date', label: 'Date', type: 'date' },
      { name: 'session_no', label: 'No.', type: 'number' },
      { name: 'shift', label: 'รอบ', type: 'number' },
      { name: 'bed_no', label: 'เตียง', type: 'number' },
      { name: 'status', label: 'สถานะ', type: 'select', options: [['DRAFT', 'ร่าง'], ['IN_PROGRESS', 'กำลังฟอก'], ['COMPLETED', 'เสร็จสิ้น'], ['CANCELLED', 'ยกเลิก']] },
    ],
  },
  {
    title: 'Pre dialysis assessment',
    fields: [
      { name: 'pre_symptoms', label: 'อาการที่ตอบ Yes', type: 'checklist' },
      { name: 'pre_nurse_note', label: 'Nurse note', type: 'textarea' },
    ],
  },
  {
    title: 'น้ำหนัก',
    fields: [
      { name: 'pre_weight_kg', label: 'Pre weight (kg)', type: 'number' },
      { name: 'dry_weight_kg', label: 'Dry weight (kg)', type: 'number' },
      { name: 'last_bw_kg', label: 'Last BW (kg)', type: 'number' },
      { name: 'weight_gain_kg', label: 'Weight gain (kg)', type: 'number' },
      { name: 'target_uf_kg', label: 'Target UF (kg)', type: 'number' },
      { name: 'post_bw_kg', label: 'Post BW (kg)', type: 'number' },
      { name: 'weight_loss_kg', label: 'Weight loss (kg)', type: 'number' },
      { name: 'meal_drink_nss_kg', label: 'Meal / Drink / NSS (kg)', type: 'number' },
    ],
  },
  {
    title: 'Vascular access',
    fields: [
      { name: 'access_side', label: 'Side', type: 'select', options: [['LT', 'Lt'], ['RT', 'Rt']] },
      { name: 'access_type', label: 'Type', type: 'select', options: [['AVF', 'AVF'], ['AVG', 'AVG'], ['DLC', 'DLC'], ['PC', 'PC']] },
      { name: 'access_thrill', label: 'Thrill', type: 'bool', options: Y_N },
      { name: 'access_bruit', label: 'Bruit', type: 'bool', options: Y_N },
      { name: 'access_inflammation', label: 'Inflammation', type: 'bool', options: Y_N },
      { name: 'access_other', label: 'Other', type: 'text' },
    ],
  },
  {
    title: 'Hemodialysis prescription',
    fields: [
      { name: 'machine_no', label: 'Machine NK', type: 'text' },
      { name: 'dialyzer', label: 'Dialyzer', type: 'text' },
      { name: 'surface_area_m2', label: 'Surface area (m²)', type: 'number' },
      { name: 'kuf', label: 'Kuf', type: 'number' },
      { name: 'test_leak', label: 'Test leak', type: 'bool', options: YES_NO },
      { name: 'last_tcv', label: 'Last TCV', type: 'text' },
      { name: 'dialyzer_use_no', label: 'Use No.', type: 'number' },
      { name: 'disinfectant', label: 'Disinfectant', type: 'text' },
      { name: 'blood_flow_ml_min', label: 'Blood flow (ml/min)', type: 'number' },
      { name: 'dialysate_flow_ml_min', label: 'Dialysate flow (ml/min)', type: 'select', options: [['300', '300'], ['500', '500'], ['700', '700']] },
      { name: 'dialysate_temp_c', label: 'Dialysate temp (°C)', type: 'number' },
      { name: 'na_uf_variation', label: 'Na / UF Variation', type: 'bool', options: YES_NO },
      { name: 'na_start', label: 'Na start (mEq/L)', type: 'number' },
      { name: 'na_conc_off', label: 'Na conc off (mEq/L)', type: 'number' },
      { name: 'dialysate_k', label: 'K⁺ (mEq/L)', type: 'number' },
      { name: 'dialysate_ca', label: 'Ca²⁺ (mEq/L)', type: 'number' },
      { name: 'dialysate_hco3', label: 'HCO₃ (mEq/L)', type: 'number' },
    ],
  },
  {
    title: 'Anticoagulant',
    fields: [
      { name: 'anticoagulant', label: 'ชนิด', type: 'select', options: [['HEPARIN', 'Heparin'], ['NO_HEPARIN', 'No Heparin'], ['LMWH', 'LMWH']] },
      { name: 'heparin_total_iu', label: 'Heparin (unit)', type: 'number' },
      { name: 'heparin_loading_iu', label: 'Loading (unit)', type: 'number' },
      { name: 'heparin_maintenance_iu', label: 'Maintenance (unit)', type: 'number' },
      { name: 'flush_nss_ml', label: 'Flush NSS (ml)', type: 'number' },
      { name: 'flush_nss_every_min', label: 'Flush ทุก (min)', type: 'number' },
      { name: 'lmwh_dose', label: 'LMWH', type: 'text' },
    ],
  },
  {
    title: 'Time dialysis และ Pre dialysis vital signs',
    fields: [
      { name: 'duration_hr', label: 'Duration (Hr.)', type: 'number' },
      { name: 'time_start', label: 'Time start', type: 'time' },
      { name: 'time_off', label: 'Time off', type: 'time' },
      { name: 'pre_bp_sys', label: 'BP ตัวบน (mmHg)', type: 'number' },
      { name: 'pre_bp_dia', label: 'BP ตัวล่าง (mmHg)', type: 'number' },
      { name: 'pre_bt_c', label: 'BT (°C)', type: 'number' },
      { name: 'pre_pr', label: 'PR (/min)', type: 'number' },
      { name: 'pre_rr', label: 'RR (/min)', type: 'number' },
      { name: 'hct_pct', label: 'Hct (%)', type: 'number' },
      { name: 'hb_g_dl', label: 'Hb (g/dl)', type: 'number' },
    ],
  },
  {
    title: 'สารน้ำ',
    fields: [
      { name: 'nss_rate_per_min', label: 'NSS (/min)', type: 'text' },
      { name: 'glucose_50_ml', label: '50% Glucose (ml)', type: 'number' },
      { name: 'extra_fluid_ml', label: 'Extra-fluid (ml)', type: 'number' },
      { name: 'total_fluid_replacement_ml', label: 'Total fluid replacement (ml)', type: 'number' },
      { name: 'total_uf_ml', label: 'Total UF (ml)', type: 'number' },
      { name: 'net_fluid_balance_ml', label: 'Net fluid balance (ml)', type: 'number' },
    ],
  },
  {
    title: 'Complication',
    fields: [
      { name: 'complications', label: 'Complication', type: 'checklist' },
      { name: 'technical_complications', label: 'Technical complication', type: 'checklist' },
    ],
  },
  {
    title: 'Nursing management และ Health education',
    fields: [
      { name: 'nursing_management', label: 'Nursing management', type: 'checklist' },
      { name: 'health_education', label: 'Health education', type: 'checklist' },
    ],
  },
  {
    title: 'บันทึกและผู้รับผิดชอบ',
    fields: [
      { name: 'nurse_note', label: 'Nurse Note', type: 'textarea' },
      { name: 'doctor_note', label: 'Doctor Note', type: 'textarea' },
      { name: 'nephrologist', label: 'Nephrologist', type: 'text' },
      { name: 'dialysis_nurses', label: 'Dialysis nurse', type: 'text' },
    ],
  },
];

// ตารางบันทึกระหว่างฟอก
export const VITAL_FIELDS = [
  { name: 'recorded_time', label: 'Time', type: 'time' },
  { name: 'bp_sys', label: 'BP sys', type: 'number' },
  { name: 'bp_dia', label: 'BP dia', type: 'number' },
  { name: 'pr', label: 'PR', type: 'number' },
  { name: 'rr', label: 'RR', type: 'number' },
  { name: 'bfr_ml_min', label: 'BFR', type: 'number' },
  { name: 'pv_mmhg', label: 'PV', type: 'number' },
  { name: 'tmp_mmhg', label: 'TMP', type: 'number' },
  { name: 'conductivity_ms_cm', label: 'Conduct', type: 'number' },
  { name: 'ufr', label: 'UFR', type: 'number' },
  { name: 'total_uf_ml', label: 'Total ml', type: 'number' },
  { name: 'note', label: 'Note', type: 'text' },
];

// EPO / Medication during HD
export const MEDICATION_FIELDS = [
  { name: 'drug_name', label: 'ยา', type: 'text' },
  { name: 'dose', label: 'Dose', type: 'text' },
  { name: 'route', label: 'Route', type: 'text' },
  { name: 'lot_no', label: 'Lot', type: 'text' },
  { name: 'note', label: 'Note', type: 'text' },
];

export const SESSION_COLUMNS = ['patient_id', ...SECTIONS.flatMap((s) => s.fields.map((f) => f.name))];
