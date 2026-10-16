// ตัวช่วยที่ใช้ร่วมกันทุกหน้า: เรียก API, จัดรูปแบบข้อความ, สร้างช่องกรอกจากโครงสร้างฟอร์ม
import { CHECKLISTS } from './form519.js';

export const $ = (id) => document.getElementById(id);
export const ACTION = { INSERT: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ' };
export const TABLE = {
  dialysis_sessions: 'แบบฟอร์ม', intradialytic_vitals: 'บันทึกระหว่างฟอก', session_medications: 'ยา',
  patients: 'ข้อมูลผู้ป่วย', patient_files: 'ไฟล์',
};

try { $('user').value = localStorage.getItem('hemo.user') || $('user').value; } catch {}
$('user').addEventListener('change', () => { try { localStorage.setItem('hemo.user', $('user').value); } catch {} });

// รายการแบบแบ่งหน้า: คืนแถวพร้อมจำนวนทั้งหมดจาก header X-Total-Count
export async function apiList(path) {
  const res = await fetch('/api' + path);
  const rows = await res.json();
  if (!res.ok) throw new Error(rows.error || res.statusText);
  return { rows, total: Number(res.headers.get('X-Total-Count')) || 0 };
}

// เหตุผลการแก้ไขอ่านจากช่อง reasonId ของหน้าที่กำลังใช้
export async function api(path, options = {}, reasonId = 'reason') {
  const headers = { 'Content-Type': 'application/json', 'X-User-Name': encodeURIComponent($('user').value.trim()) };
  const reason = ($(reasonId)?.value || '').trim();
  if (reason) headers['X-Edit-Reason'] = encodeURIComponent(reason);
  const res = await fetch('/api' + path, { ...options, headers });
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status, body });
  return body;
}

export const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const fmtTime = (t) => (t ? new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '');
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
  if ($('user').value.trim()) return false;
  $(msgId).textContent = 'กรุณาระบุชื่อผู้บันทึกก่อน';
  $('user').focus();
  return true;
}


// อัปโหลดไฟล์ดิบ (jpg / pdf) ไปที่ path
export async function apiUpload(path, file, reasonId) {
  const headers = {
    'Content-Type': file.type || 'application/octet-stream',
    'X-User-Name': encodeURIComponent($('user').value.trim()),
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
