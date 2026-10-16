// หน้าบันทึกการฟอกเลือด: รายการรอบฟอก, แบบฟอร์ม 519, สัญญาณชีพ และประวัติการแก้ไข
const $ = (id) => document.getElementById(id);
const STATUS = { DRAFT: 'ร่าง', IN_PROGRESS: 'กำลังฟอก', COMPLETED: 'เสร็จสิ้น', CANCELLED: 'ยกเลิก' };
const ACTION = { INSERT: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ' };

// [หัวข้อ, [[ฟิลด์, ป้ายกำกับ, ชนิด]]]
const FORM_519 = [
  ['ข้อมูลรอบฟอก', [
    ['session_date', 'วันที่', 'date'], ['shift', 'รอบ', 'number'], ['bed_no', 'เตียง', 'number'],
    ['machine_no', 'เครื่อง', 'text'], ['session_no', 'ครั้งที่', 'number'],
    ['status', 'สถานะ', 'status'],
  ]],
  ['ก่อนฟอก', [
    ['pre_weight_kg', 'น้ำหนักก่อน (kg)', 'number'], ['dry_weight_kg', 'น้ำหนักแห้ง (kg)', 'number'],
    ['pre_bp_sys', 'BP ตัวบน', 'number'], ['pre_bp_dia', 'BP ตัวล่าง', 'number'],
    ['pre_pulse', 'ชีพจร', 'number'], ['pre_temp_c', 'อุณหภูมิ (°C)', 'number'],
    ['pre_rr', 'การหายใจ', 'number'], ['pre_o2sat', 'O2 sat (%)', 'number'],
    ['pre_symptoms', 'อาการก่อนฟอก', 'textarea'],
  ]],
  ['คำสั่งการรักษา', [
    ['dialyzer', 'ตัวกรอง', 'text'], ['dialyzer_reuse_no', 'ใช้ซ้ำครั้งที่', 'number'],
    ['duration_min', 'เวลาฟอก (นาที)', 'number'], ['blood_flow_ml_min', 'QB (ml/min)', 'number'],
    ['dialysate_flow_ml_min', 'QD (ml/min)', 'number'], ['dialysate_na', 'Na', 'number'],
    ['dialysate_k', 'K', 'number'], ['dialysate_ca', 'Ca', 'number'], ['dialysate_hco3', 'HCO3', 'number'],
    ['dialysate_temp_c', 'อุณหภูมิน้ำยา', 'number'], ['uf_goal_ml', 'UF เป้าหมาย (ml)', 'number'],
    ['anticoagulant', 'สารกันเลือดแข็ง', 'text'], ['heparin_loading_iu', 'Heparin loading (IU)', 'number'],
    ['heparin_maintenance_iu', 'Heparin maintenance (IU/h)', 'number'],
    ['access_used', 'เส้นฟอกเลือด', 'text'], ['needle_size', 'ขนาดเข็ม', 'text'],
  ]],
  ['หลังฟอก', [
    ['post_weight_kg', 'น้ำหนักหลัง (kg)', 'number'], ['post_bp_sys', 'BP ตัวบน', 'number'],
    ['post_bp_dia', 'BP ตัวล่าง', 'number'], ['post_pulse', 'ชีพจร', 'number'],
    ['post_temp_c', 'อุณหภูมิ (°C)', 'number'], ['actual_uf_ml', 'UF จริง (ml)', 'number'],
    ['kt_v', 'Kt/V', 'number'], ['urr_pct', 'URR (%)', 'number'],
  ]],
  ['ยา ภาวะแทรกซ้อน และผู้รับผิดชอบ', [
    ['medications', 'ยาที่ให้', 'textarea'], ['complications', 'ภาวะแทรกซ้อน', 'textarea'],
    ['nursing_notes', 'บันทึกการพยาบาล', 'textarea'], ['physician_orders', 'คำสั่งแพทย์', 'textarea'],
    ['nurse_name', 'พยาบาล', 'text'], ['physician_name', 'แพทย์', 'text'],
  ]],
];

let current = null;

try { $('user').value = localStorage.getItem('hemo.user') || ''; } catch {}
$('user').addEventListener('change', () => { try { localStorage.setItem('hemo.user', $('user').value); } catch {} });

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-User-Name': encodeURIComponent($('user').value.trim()) };
  const reason = $('reason').value.trim();
  if (reason) headers['X-Edit-Reason'] = encodeURIComponent(reason);
  const res = await fetch('/api' + path, { ...options, headers });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtTime = (t) => (t ? new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '');

async function loadSessions() {
  const date = $('date').value;
  const rows = await api('/sessions' + (date ? `?date=${date}` : ''));
  $('sessions').innerHTML = rows.map((s) => `
    <tr class="clickable" data-id="${s.id}">
      <td>${fmtDate(s.session_date)}</td><td>${esc(s.shift)}</td><td>${esc(s.bed_no)}</td>
      <td>${esc(s.hn)}</td><td>${esc(`${s.prefix || ''}${s.first_name} ${s.last_name}`)}</td>
      <td>${esc(s.pre_weight_kg)} / ${esc(s.post_weight_kg)}</td><td>${esc(s.actual_uf_ml)}</td>
      <td><span class="badge">${STATUS[s.status] || s.status}</span></td>
    </tr>`).join('') || '<tr><td colspan="8">ไม่มีรายการ</td></tr>';
}

function renderForm(s) {
  $('form').innerHTML = FORM_519.map(([legend, fields]) => `
    <fieldset><legend>${legend}</legend>${fields.map(([name, label, type]) => {
      let value = s[name] ?? '';
      if (type === 'date' && value) value = String(value).slice(0, 10);
      let input;
      if (type === 'textarea') input = `<textarea name="${name}" rows="2">${esc(value)}</textarea>`;
      else if (type === 'status') input = `<select name="${name}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
      else input = `<input name="${name}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(value)}">`;
      return `<label class="${type === 'textarea' ? 'wide' : ''}">${label}${input}</label>`;
    }).join('')}</fieldset>`).join('');
}

async function openSession(id) {
  current = await api('/sessions/' + id);
  $('detail').hidden = false;
  $('detail-title').textContent = `แบบบันทึกการฟอกเลือด (519) · ${current.hn} ${current.first_name} ${current.last_name}`;
  $('msg').textContent = '';
  renderForm(current);
  $('vitals').innerHTML = current.vitals.map((v) => `
    <tr><td>${fmtTime(v.recorded_at)}</td><td>${esc(v.bp_sys)}/${esc(v.bp_dia)}</td><td>${esc(v.pulse)}</td>
    <td>${esc(v.blood_flow_ml_min)}</td><td>${esc(v.venous_pressure)}</td><td>${esc(v.arterial_pressure)}</td>
    <td>${esc(v.tmp)}</td><td>${esc(v.uf_volume_ml)}</td></tr>`).join('') || '<tr><td colspan="8">ยังไม่มีบันทึก</td></tr>';
  await loadAudit();
  $('detail').scrollIntoView({ behavior: 'smooth' });
}

async function loadAudit() {
  const rows = await api(`/audit?table=dialysis_sessions&record_id=${current.id}`);
  $('audit').innerHTML = rows.map((a) => `
    <tr><td>${fmtTime(a.changed_at)}</td><td>${ACTION[a.action]}</td><td>${esc(a.changed_by)}</td>
    <td>${esc((a.changed_fields || []).join(', '))}</td><td>${esc(a.reason)}</td></tr>`).join('');
}

$('save').addEventListener('click', async () => {
  if (!$('user').value.trim()) { $('msg').textContent = 'กรุณาระบุชื่อผู้บันทึกก่อน'; return; }
  const changes = {};
  for (const el of $('form').elements) {
    if (!el.name) continue;
    let before = current[el.name] ?? '';
    if (el.type === 'date' && before) before = String(before).slice(0, 10);
    if (String(before) !== el.value) changes[el.name] = el.value;
  }
  if (!Object.keys(changes).length) { $('msg').textContent = 'ไม่มีการเปลี่ยนแปลง'; return; }
  try {
    await api('/sessions/' + current.id, { method: 'PATCH', body: JSON.stringify(changes) });
    $('reason').value = '';
    await openSession(current.id);
    await loadSessions();
    $('msg').textContent = 'บันทึกแล้ว';
  } catch (err) {
    $('msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
  }
});

$('sessions').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row) openSession(row.dataset.id);
});
$('date').addEventListener('change', loadSessions);
$('all').addEventListener('click', () => { $('date').value = ''; loadSessions(); });
$('close').addEventListener('click', () => { $('detail').hidden = true; current = null; });

loadSessions();
