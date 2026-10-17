// ตัวช่วยที่ใช้ร่วมกันทุกหน้า: เรียก API, จัดรูปแบบข้อความ, สร้างช่องกรอกจากโครงสร้างฟอร์ม
import { CHECKLISTS } from './form519.js';

export const $ = (id) => document.getElementById(id);
export const ACTION = { INSERT: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ' };
export const TABLE = {
  dialysis_sessions: 'แบบฟอร์ม', intradialytic_vitals: 'บันทึกระหว่างฟอก', session_medications: 'ยา',
  patients: 'ข้อมูลผู้ป่วย', patient_files: 'ไฟล์',
  session_exports: 'ยืนยันข้อมูล', app_settings: 'ตั้งค่าระบบ', alert_notifications: 'แจ้งเตือน SMS', doctor_consults: 'ปรึกษาแพทย์',
};

export const ROLE = { NURSE: 'พยาบาล', NURSE_AIDE: 'ผู้ช่วยพยาบาล', DOCTOR: 'แพทย์', CLERK: 'เสมียน', OTHER: 'อื่นๆ' };
// ผู้บันทึกเลือกเฉพาะตำแหน่ง (ยังไม่มีระบบล็อกอิน) เครื่องจะจำตำแหน่งไว้ให้ครั้งถัดไป
// audit log จึงเก็บชื่อผู้บันทึกเป็นชื่อตำแหน่ง จนกว่าจะมีล็อกอินรายบุคคล
try { $('user-role').value = localStorage.getItem('hemo.user-role') || $('user-role').value; } catch {}
$('user-role').addEventListener('change', () => { try { localStorage.setItem('hemo.user-role', $('user-role').value); } catch {} });
const userHeaders = () => ({ 'X-User-Name': encodeURIComponent(ROLE[$('user-role').value] || ''), 'X-User-Role': $('user-role').value });
// ผู้บันทึกใน audit log: ชื่อตำแหน่ง หรือชื่อพร้อมตำแหน่งสำหรับข้อมูลเดิมที่มีชื่อคน
export const byWho = (a) => {
  const role = ROLE[a.changed_by_role];
  return !role || a.changed_by === role ? a.changed_by : `${a.changed_by} (${role})`;
};

// รายการแบบแบ่งหน้า: คืนแถวพร้อมจำนวนทั้งหมดจาก header X-Total-Count
export async function apiList(path) {
  const res = await fetch('/api' + path);
  const rows = await res.json();
  if (!res.ok) throw new Error(rows.error || res.statusText);
  return { rows, total: Number(res.headers.get('X-Total-Count')) || 0 };
}

// เหตุผลการแก้ไขอ่านจากช่อง reasonId ของหน้าที่กำลังใช้
export async function api(path, options = {}, reasonId = 'reason') {
  const headers = { 'Content-Type': 'application/json', ...userHeaders() };
  const reason = ($(reasonId)?.value || '').trim();
  if (reason) headers['X-Edit-Reason'] = encodeURIComponent(reason);
  const res = await fetch('/api' + path, { ...options, headers });
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status, body });
  return body;
}

export const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// วันที่แสดงและกรอกเป็น DD/MM/YYYY ปี พ.ศ. (ถ้าจะใช้ ค.ศ. ให้ตั้ง YEAR_OFFSET = 0)
// ภายในระบบและ API ยังเป็น YYYY-MM-DD (ค.ศ.) เหมือนเดิม
const YEAR_OFFSET = 543;
const pad2 = (n) => String(n).padStart(2, '0');
export const isoToDmy = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${Number(y) + YEAR_OFFSET}`;
};
// รับ 16/10/2569 หรือ 16/10/2026 (ปีตั้งแต่ 2400 ถือเป็น พ.ศ.) คืน YYYY-MM-DD หรือ null ถ้าไม่ใช่วันที่จริง
export const dmyToIso = (text) => {
  const m = String(text).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  let y = Number(m[3]);
  if (YEAR_OFFSET && y >= 2400) y -= YEAR_OFFSET;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
};
export const fmtDate = (d) => isoToDmy(d);
export const fmtTime = (t) => {
  if (!t) return '';
  const dt = new Date(t);
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear() + YEAR_OFFSET} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
};
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
export const age = (birth, on) => {
  if (!birth) return '';
  const b = new Date(birth), d = new Date(on);
  return d.getFullYear() - b.getFullYear() - (d < new Date(d.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
};

// ค่าที่แสดงในฟอร์ม -> ค่าที่ส่งให้ API
export function readField(form, field) {
  if (field.type === 'checklist') {
    return [...form.querySelectorAll(`input[name="${field.name}"]:checked`)].map((el) => el.value);
  }
  const value = form.elements[field.name].value;
  if (value === '') return null;
  if (field.type === 'bool') return value === 'true';
  if (field.type === 'time') return normalizeHm(value) ?? value;
  if (field.type === 'number' || field.name === 'dialysate_flow_ml_min') return Number(value);
  return value;
}

export function fieldValue(record, field) {
  const v = record?.[field.name];
  if (v === null || v === undefined) return field.type === 'checklist' ? [] : '';
  if (field.type === 'time') return hhmm(v);
  return field.type === 'checklist' ? v : String(v);
}

export function renderInput(field, value) {
  const n = field.name;
  if (field.type === 'checklist') {
    return `<div class="checks">${CHECKLISTS[n].map(([k, label]) => `
      <label class="check"><input type="checkbox" name="${n}" value="${k}" ${value.includes(k) ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div>`;
  }
  if (field.type === 'select' || field.type === 'bool') {
    return `<select name="${n}"><option value=""></option>${field.options.map(([k, label]) =>
      `<option value="${k}" ${k === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  }
  if (field.type === 'textarea') return `<textarea name="${n}" rows="2">${esc(value)}</textarea>`;
  return `<input name="${n}" type="${field.type}" ${field.type === 'number' ? 'step="any"' : ''} value="${esc(value)}">`;
}

export function renderField(field, record) {
  const wide = field.type === 'checklist' || field.type === 'textarea';
  const tag = field.type === 'checklist' ? 'div' : 'label';
  return `<${tag} class="field ${wide ? 'wide' : ''}"><span>${esc(field.label)}</span>${renderInput(field, fieldValue(record, field))}</${tag}>`;
}

export function needUser(msgId) {
  if ($('user-role').value) return false;
  $(msgId).textContent = 'กรุณาเลือกผู้บันทึกก่อน';
  $('user-role').focus();
  return true;
}


// อัปโหลดไฟล์ดิบ (jpg / pdf) ไปที่ path
export async function apiUpload(path, file, reasonId, extraHeaders = {}) {
  const headers = {
    ...extraHeaders,
    'Content-Type': file.type || 'application/octet-stream',
    ...userHeaders(),
    'X-File-Name': encodeURIComponent(file.name),
  };
  const reason = ($(reasonId)?.value || '').trim();
  if (reason) headers['X-Edit-Reason'] = encodeURIComponent(reason);
  const res = await fetch('/api' + path, { method: 'POST', headers, body: file });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// โหลดไฟล์เป็น blob URL สำหรับแสดงรูปหรือเปิดเอกสาร
export async function blobUrl(path) {
  const res = await fetch('/api' + path);
  if (!res.ok) throw new Error('เปิดไฟล์ไม่ได้');
  return URL.createObjectURL(await res.blob());
}

// ---------------------------------------------------------------------------
// ช่องวันที่ทุกช่อง (input type=date) แสดงและพิมพ์เป็น DD/MM/YYYY พร้อมปุ่มปฏิทิน
// ช่อง type=date เดิมยังอยู่ (ซ่อนไว้) และเก็บค่า YYYY-MM-DD โค้ดเดิมจึงอ่าน .value ได้เหมือนเดิม
// ---------------------------------------------------------------------------
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function enhanceDate(input) {
  if (input.dataset.dmy) return;
  input.dataset.dmy = '1';
  const text = document.createElement('input');
  text.type = 'text';
  text.inputMode = 'numeric';
  text.autocomplete = 'off';
  text.placeholder = 'วว/ดด/ปปปป';
  text.className = 'date-text';
  text.required = input.required;
  input.required = false;
  text.setAttribute('aria-label', input.getAttribute('aria-label') || input.closest('label')?.querySelector('span')?.textContent || 'วันที่');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost date-btn';
  btn.textContent = '📅';
  btn.setAttribute('aria-label', 'เลือกจากปฏิทิน');
  const wrap = document.createElement('span');
  wrap.className = 'date-field';
  input.replaceWith(wrap);
  wrap.append(text, btn, input);
  input.classList.add('date-native');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const show = () => { text.value = isoToDmy(nativeValue.get.call(input)); text.removeAttribute('aria-invalid'); text.title = ''; };
  // โค้ดที่ตั้งค่า input.value ตรง ๆ ให้ช่องที่แสดงเปลี่ยนตาม
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return nativeValue.get.call(this); },
    set(v) { nativeValue.set.call(this, v); show(); },
  });
  show();
  text.addEventListener('change', () => {
    const raw = text.value.trim();
    const iso = raw ? dmyToIso(raw) : '';
    const problem = iso === null ? 'วันที่ไม่ถูกต้อง ใช้รูปแบบ วว/ดด/ปปปป'
      : iso && input.min && iso < input.min ? `ต้องไม่ก่อน ${isoToDmy(input.min)}`
        : iso && input.max && iso > input.max ? `ต้องไม่หลัง ${isoToDmy(input.max)}` : '';
    if (problem) {
      nativeValue.set.call(input, '');
      text.setAttribute('aria-invalid', 'true');
      text.title = problem;
      return;
    }
    nativeValue.set.call(input, iso);
    show();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  input.addEventListener('change', show);
  btn.addEventListener('click', () => {
    try { input.showPicker(); } catch { text.focus(); }
  });
}

// เวลาแสดงและกรอกแบบ 24 ชั่วโมง HH:MM ตามหน้าจอเครื่อง ไม่มี AM/PM (ช่องเวลาของเบราว์เซอร์แสดงตามภาษาเครื่อง)
// รับ 9:05, 09.05, 0905, 905 แล้วจัดเป็น 09:05 คืน null ถ้าไม่ใช่เวลาจริง
export const normalizeHm = (text) => {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const m = t.match(/^(\d{1,2})[:.](\d{2})$/) || t.match(/^(\d{1,2})(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${pad2(Number(m[1]))}:${m[2]}`;
};
function enhanceTime(input) {
  Object.assign(input, { type: 'text', inputMode: 'numeric', placeholder: 'HH:MM', maxLength: 5, autocomplete: 'off' });
  input.classList.add('time-24');
}
document.addEventListener('focusout', (e) => {
  const input = e.target;
  if (!input.classList?.contains('time-24')) return;
  const v = normalizeHm(input.value);
  if (v === null) { input.setAttribute('aria-invalid', 'true'); input.title = 'กรอกเวลาแบบ 24 ชั่วโมง เช่น 14:30'; return; }
  input.value = v;
  input.removeAttribute('aria-invalid');
  input.removeAttribute('title');
});

const enhanceAll = (root) => {
  root.querySelectorAll?.('input[type="date"]:not([data-dmy])').forEach(enhanceDate);
  root.querySelectorAll?.('input[type="time"]').forEach(enhanceTime);
};
enhanceAll(document);
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) {
    if (n.matches('input[type="date"]')) enhanceDate(n);
    else if (n.matches('input[type="time"]')) enhanceTime(n);
    else enhanceAll(n);
  }
}).observe(document.body, { childList: true, subtree: true });
