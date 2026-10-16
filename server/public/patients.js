// หน้าผู้ป่วยทั้งหมด: รายชื่อ, เพิ่ม ลบ แก้ไขผู้ป่วย, รูปผู้ป่วย และไฟล์แนบ (.jpg, .pdf)
import { PATIENT_FIELDS } from './form519.js';
import {
  $, api, apiList, apiUpload, blobUrl, esc, fmtTime, age, readField, fieldValue, renderField, needUser, ACTION, TABLE,
} from './common.js';

const SEX = { M: 'ชาย', F: 'หญิง' };
const ACCESS_SIDE = { LT: 'Lt', RT: 'Rt' };
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const listState = { page: 1 };
let patient = null; // ผู้ป่วยที่เปิดอยู่ (null = กำลังเพิ่มผู้ป่วยใหม่)
const thumbs = new Map(); // file id -> blob URL ของรูปที่โหลดแล้ว

const fullName = (p) => `${p.prefix || ''}${p.first_name} ${p.last_name}`;
const initials = (p) => (p.first_name || '?').slice(0, 1);
const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const say = (text) => { $('p-msg').textContent = text; };

async function photoUrl(p) {
  if (!p.photo_file_id) return null;
  if (!thumbs.has(p.photo_file_id)) thumbs.set(p.photo_file_id, blobUrl(`/patients/${p.id}/files/${p.photo_file_id}`).catch(() => null));
  return thumbs.get(p.photo_file_id);
}

// ---------------------------------------------------------------------------
// รายชื่อผู้ป่วย
// ---------------------------------------------------------------------------
async function loadPatients() {
  const size = Number($('p-page-size').value);
  const params = new URLSearchParams({ limit: size, offset: (listState.page - 1) * size });
  if ($('p-search').value.trim()) params.set('q', $('p-search').value.trim());
  const { rows, total } = await apiList('/patients?' + params);
  const pages = Math.max(1, Math.ceil(total / size));
  if (listState.page > pages) { listState.page = pages; return loadPatients(); }
  const today = new Date().toISOString().slice(0, 10);
  $('p-list').innerHTML = rows.map((p) => `
    <tr class="clickable" data-id="${p.id}">
      <td><span class="avatar" data-photo="${p.photo_file_id || ''}" data-patient="${p.id}">${esc(initials(p))}</span></td>
      <td>${esc(p.hn)}</td><td>${esc(fullName(p))}</td><td>${age(p.birth_date, today)}</td><td>${SEX[p.sex] || ''}</td>
      <td>${esc(p.vascular_access)} ${esc(ACCESS_SIDE[p.access_side] || '')}</td><td>${esc(p.payer)}</td>
    </tr>`).join('') || '<tr><td colspan="7">ไม่พบผู้ป่วย</td></tr>';
  const from = total ? (listState.page - 1) * size + 1 : 0;
  $('p-page-info').textContent = `${from}–${from + rows.length - (total ? 1 : 0)} จาก ${total} ราย · หน้า ${listState.page}/${pages}`;
  $('p-prev').disabled = listState.page <= 1;
  $('p-next').disabled = listState.page >= pages;
  for (const p of rows.filter((r) => r.photo_file_id)) {
    photoUrl(p).then((url) => {
      const el = $('p-list').querySelector(`.avatar[data-patient="${p.id}"]`);
      if (url && el) el.outerHTML = `<img class="avatar" src="${url}" alt="รูป ${esc(fullName(p))}">`;
    });
  }
}

// ---------------------------------------------------------------------------
// ข้อมูลผู้ป่วยหนึ่งราย
// ---------------------------------------------------------------------------
async function renderPhoto() {
  const url = patient && (await photoUrl(patient));
  $('p-photo').innerHTML = url ? `<img src="${url}" alt="รูปผู้ป่วย">` : esc(patient ? initials(patient) : '+');
  $('p-photo-label').firstChild.textContent = url ? 'เปลี่ยนรูป' : 'ใส่รูป';
}

async function openPatient(id) {
  patient = id ? await api('/patients/' + id) : null;
  $('p-detail').hidden = false;
  $('p-delete-confirm').hidden = true;
  $('p-viewer').hidden = true;
  $('p-title').textContent = patient ? `${fullName(patient)} · HN ${patient.hn}` : 'เพิ่มผู้ป่วยใหม่';
  $('p-form').innerHTML = PATIENT_FIELDS.map((f) => renderField(f, patient || {})).join('');
  $('p-save').textContent = patient ? 'บันทึกข้อมูลผู้ป่วย' : 'เพิ่มผู้ป่วย';
  // ไฟล์ รูป และการลบ ใช้ได้หลังบันทึกผู้ป่วยแล้ว
  $('p-delete').hidden = !patient;
  $('p-extra').hidden = !patient;
  $('p-photo-label').hidden = !patient;
  say(patient ? '' : 'กรอกข้อมูลแล้วกดเพิ่มผู้ป่วย จากนั้นจึงใส่รูปและแนบไฟล์ได้');
  await renderPhoto();
  if (patient) await Promise.all([loadFiles(), loadAudit()]);
  $('p-detail').scrollIntoView({ behavior: 'smooth' });
}

async function loadFiles() {
  const files = await api(`/patients/${patient.id}/files`);
  $('p-files').innerHTML = files.filter((f) => f.kind === 'DOCUMENT').map((f) => `
    <tr data-file="${f.id}" data-name="${esc(f.file_name)}" data-type="${f.mime_type}">
      <td><button type="button" class="link" data-act="open">${esc(f.file_name)}</button></td>
      <td>${f.mime_type === 'application/pdf' ? 'PDF' : 'JPG'}</td><td>${fmtSize(f.size_bytes)}</td>
      <td>${esc(f.uploaded_by)}</td><td>${fmtTime(f.created_at)}</td>
      <td class="row-actions"><button type="button" class="ghost danger" data-act="delete">ลบ</button></td>
    </tr>`).join('') || '<tr><td colspan="6">ยังไม่มีไฟล์แนบ</td></tr>';
}

async function loadAudit() {
  const rows = await api(`/audit?patient_id=${patient.id}`);
  $('p-audit').innerHTML = rows.map((a) => `
    <tr><td>${fmtTime(a.changed_at)}</td><td>${ACTION[a.action]}</td><td>${TABLE[a.table_name] || a.table_name}</td>
    <td>${esc(a.changed_by)}</td><td>${esc((a.changed_fields || []).join(', '))}</td><td>${esc(a.reason)}</td></tr>`).join('');
}

async function act(action, done = 'บันทึกแล้ว') {
  try {
    await action();
    $('p-reason').value = '';
    say(done);
  } catch (err) {
    say('ไม่สำเร็จ: ' + err.message);
  }
}

$('p-save').addEventListener('click', () => {
  if (needUser('p-msg')) return;
  const data = {};
  for (const f of PATIENT_FIELDS) {
    const value = readField($('p-form'), f);
    if (!patient || String(value ?? '') !== fieldValue(patient, f)) data[f.name] = value;
  }
  const missing = PATIENT_FIELDS.filter((f) => f.required && !(patient ? data[f.name] ?? patient[f.name] : data[f.name]));
  if (missing.length) return say('กรุณากรอก ' + missing.map((f) => f.label).join(', '));
  if (patient && !Object.keys(data).length) return say('ไม่มีการเปลี่ยนแปลง');
  act(async () => {
    const saved = patient
      ? await api('/patients/' + patient.id, { method: 'PATCH', body: JSON.stringify(data) }, 'p-reason')
      : await api('/patients', { method: 'POST', body: JSON.stringify(data) }, 'p-reason');
    await loadPatients();
    await openPatient(saved.id);
  }, patient ? 'บันทึกแล้ว' : 'เพิ่มผู้ป่วยแล้ว ใส่รูปและแนบไฟล์ได้เลย');
});

$('p-delete').addEventListener('click', () => { $('p-delete-confirm').hidden = false; });
$('p-delete-no').addEventListener('click', () => { $('p-delete-confirm').hidden = true; });
$('p-delete-yes').addEventListener('click', () => {
  if (needUser('p-msg')) return;
  act(async () => {
    await api('/patients/' + patient.id, { method: 'DELETE' }, 'p-reason');
    patient = null;
    $('p-detail').hidden = true;
    await loadPatients();
  });
});

function checkFile(file, onlyJpeg) {
  const name = file.name.toLowerCase();
  const jpg = /\.(jpe?g)$/.test(name) && (!file.type || file.type === 'image/jpeg');
  const pdf = name.endsWith('.pdf') && (!file.type || file.type === 'application/pdf');
  if (onlyJpeg ? !jpg : !(jpg || pdf)) return onlyJpeg ? 'รูปผู้ป่วยต้องเป็นไฟล์ .jpg' : `${file.name}: รับเฉพาะไฟล์ .jpg และ .pdf`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}: ไฟล์ใหญ่เกิน 10 MB`;
  return null;
}

$('p-photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || needUser('p-msg')) return;
  const problem = checkFile(file, true);
  if (problem) return say(problem);
  act(async () => {
    await apiUpload(`/patients/${patient.id}/files?kind=PHOTO`, new File([file], file.name, { type: 'image/jpeg' }), 'p-reason');
    patient = await api('/patients/' + patient.id);
    await Promise.all([renderPhoto(), loadAudit(), loadPatients()]);
  }, 'เปลี่ยนรูปแล้ว');
});

$('p-file-input').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || needUser('p-msg')) return;
  const problems = files.map((f) => checkFile(f, false)).filter(Boolean);
  if (problems.length) return say(problems.join(' · '));
  act(async () => {
    for (const f of files) {
      const type = f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
      await apiUpload(`/patients/${patient.id}/files?kind=DOCUMENT`, new File([f], f.name, { type }), 'p-reason');
    }
    await Promise.all([loadFiles(), loadAudit()]);
  }, `แนบไฟล์แล้ว ${files.length} ไฟล์`);
});

$('p-files').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const tr = btn.closest('tr');
  const path = `/patients/${patient.id}/files/${tr.dataset.file}`;
  if (btn.dataset.act === 'open') {
    try {
      const url = await blobUrl(path);
      if (tr.dataset.type === 'image/jpeg') {
        $('p-viewer-img').src = url;
        $('p-viewer-img').alt = tr.dataset.name;
        $('p-viewer-name').textContent = tr.dataset.name;
        $('p-viewer').hidden = false;
        $('p-viewer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        const a = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener' });
        a.click();
      }
    } catch (err) {
      say(err.message);
    }
  }
  if (btn.dataset.act === 'delete') {
    if (needUser('p-msg')) return;
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'ยืนยันลบ';
      return;
    }
    act(async () => {
      await api(path, { method: 'DELETE' }, 'p-reason');
      await Promise.all([loadFiles(), loadAudit()]);
    }, 'ลบไฟล์แล้ว');
  }
});
$('p-viewer-close').addEventListener('click', () => { $('p-viewer').hidden = true; });

$('p-list').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row) openPatient(row.dataset.id);
});
$('p-new').addEventListener('click', () => openPatient(null));
$('p-close').addEventListener('click', () => { $('p-detail').hidden = true; patient = null; });
const reloadFromFirstPage = () => { listState.page = 1; loadPatients(); };
let searchTimer;
$('p-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(reloadFromFirstPage, 250); });
$('p-page-size').addEventListener('change', reloadFromFirstPage);
$('p-prev').addEventListener('click', () => { listState.page--; loadPatients(); });
$('p-next').addEventListener('click', () => { listState.page++; loadPatients(); });

// สลับหน้า การฟอกเลือด / ผู้ป่วยทั้งหมด
document.querySelector('.views').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-view]');
  if (!tab) return;
  for (const t of document.querySelectorAll('.view-tab')) {
    const on = t === tab;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    $('view-' + t.dataset.view).hidden = !on;
  }
  if (tab.dataset.view === 'patients') loadPatients();
});
