// หน้าข้อมูลผู้ป่วยเก่า: ผู้ป่วยที่ลบออกจากรายชื่อผู้ป่วยทั้งหมด ดูข้อมูลทั้งหมดได้ และนำกลับเป็นผู้ป่วยปัจจุบันได้
import { PATIENT_FIELDS, CHECKLISTS } from './form519.js';
import { $, api, apiList, blobUrl, esc, fmtDate, fmtTime, age, needUser, byWho, ACTION, TABLE } from './common.js';

const SEX = { M: 'ชาย', F: 'หญิง' };
const STATUS = { IN_PROGRESS: 'กำลังฟอก', COMPLETED: 'เสร็จสิ้น', CANCELLED: 'ยกเลิก' };
const DAY_SHORT = { MON: 'จ.', TUE: 'อ.', WED: 'พ.', THU: 'พฤ.', FRI: 'ศ.', SAT: 'ส.', SUN: 'อา.' };
const listState = { page: 1 };
let patient = null;

const today = () => new Date().toISOString().slice(0, 10);
const fullName = (p) => `${p.prefix || ''}${p.first_name} ${p.last_name}`;
const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const say = (text) => { $('a-msg').textContent = text; };
const regularLabel = (p) => (p.regular_shift
  ? `รอบ ${p.regular_shift}${p.regular_days?.length ? ' · ' + CHECKLISTS.regular_days.map(([k]) => k).filter((d) => p.regular_days.includes(d)).map((d) => DAY_SHORT[d]).join(' ') : ''}`
  : '-');

function valueLabel(field, value) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return '-';
  if (field.type === 'checklist') return CHECKLISTS[field.name].filter(([k]) => value.includes(k)).map(([, l]) => l).join(' ');
  if (field.type === 'select') return (field.options.find(([k]) => k === String(value)) || [value, value])[1];
  if (field.type === 'date') return fmtDate(value);
  return value;
}

// ---------------------------------------------------------------------------
// รายชื่อผู้ป่วยเก่า
// ---------------------------------------------------------------------------
async function loadList() {
  const size = Number($('a-page-size').value);
  const params = new URLSearchParams({ archived: '1', limit: size, offset: (listState.page - 1) * size });
  if ($('a-search').value.trim()) params.set('q', $('a-search').value.trim());
  const { rows, total } = await apiList('/patients?' + params);
  const pages = Math.max(1, Math.ceil(total / size));
  if (listState.page > pages) { listState.page = pages; return loadList(); }
  $('a-list').innerHTML = rows.map((p) => `
    <tr class="clickable" data-id="${p.id}">
      <td>${esc(p.hn)}</td><td>${esc(fullName(p))}</td><td>${age(p.birth_date, today())}</td><td>${SEX[p.sex] || ''}</td>
      <td>${esc(regularLabel(p))}</td><td>${fmtDate(p.archived_at?.slice(0, 10))}</td><td>${esc(p.archive_reason)}</td>
    </tr>`).join('') || '<tr><td colspan="7">ไม่มีข้อมูลผู้ป่วยเก่า</td></tr>';
  const from = total ? (listState.page - 1) * size + 1 : 0;
  $('a-page-info').textContent = `${from}–${from + rows.length - (total ? 1 : 0)} จาก ${total} ราย · หน้า ${listState.page}/${pages}`;
  $('a-prev').disabled = listState.page <= 1;
  $('a-next').disabled = listState.page >= pages;
}

let searchTimer;
$('a-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { listState.page = 1; loadList(); }, 250);
});
$('a-page-size').addEventListener('change', () => { listState.page = 1; loadList(); });
$('a-prev').addEventListener('click', () => { listState.page--; loadList(); });
$('a-next').addEventListener('click', () => { listState.page++; loadList(); });
$('a-list').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr) openArchived(tr.dataset.id);
});

// ---------------------------------------------------------------------------
// ข้อมูลผู้ป่วยเก่าหนึ่งราย (ดูอย่างเดียว)
// ---------------------------------------------------------------------------
async function openArchived(id) {
  const [p, sessions, files, audit] = await Promise.all([
    api('/patients/' + id),
    api(`/sessions?patient_id=${id}&limit=500`),
    api(`/patients/${id}/files`),
    api(`/audit?patient_id=${id}`),
  ]);
  patient = p;
  $('a-detail').hidden = false;
  $('a-viewer').hidden = true;
  say('');
  $('a-title').textContent = `${fullName(p)} · HN ${p.hn}`;
  $('a-note').textContent = `ย้ายมาข้อมูลผู้ป่วยเก่าเมื่อ ${fmtTime(p.archived_at)}${p.archive_reason ? ` · เหตุผล: ${p.archive_reason}` : ''}`;
  $('a-photo').textContent = (p.first_name || '?').slice(0, 1);
  if (p.photo_file_id) {
    blobUrl(`/patients/${p.id}/files/${p.photo_file_id}`).then((url) => { $('a-photo').innerHTML = `<img src="${url}" alt="รูปผู้ป่วย">`; }).catch(() => {});
  }
  $('a-facts').innerHTML = [
    ...PATIENT_FIELDS.map((f) => [f.label, valueLabel(f, p[f.name])]),
    ['อายุ', p.birth_date ? `${age(p.birth_date, today())} ปี` : '-'],
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('a-sessions').innerHTML = sessions.map((s) => `
    <tr class="clickable" data-session="${s.id}">
      <td>${fmtDate(s.session_date)}</td><td>${esc(s.session_no)}</td><td>${esc(s.shift)}</td><td>${esc(s.bed_no)}</td>
      <td>${esc(s.pre_weight_kg ?? '-')} / ${esc(s.post_bw_kg ?? '-')}</td><td>${esc(s.total_uf_ml ?? '-')}</td><td>${STATUS[s.status] || esc(s.status)}</td>
    </tr>`).join('') || '<tr><td colspan="7">ไม่มีประวัติการฟอก</td></tr>';
  $('a-files').innerHTML = files.filter((f) => f.kind === 'DOCUMENT').map((f) => `
    <tr data-file="${f.id}" data-name="${esc(f.file_name)}" data-type="${f.mime_type}">
      <td><button type="button" class="link" data-act="open">${esc(f.file_name)}</button></td>
      <td>${f.mime_type === 'application/pdf' ? 'PDF' : 'JPG'}</td><td>${fmtSize(f.size_bytes)}</td>
      <td>${esc(f.uploaded_by)}</td><td>${fmtTime(f.created_at)}</td>
    </tr>`).join('') || '<tr><td colspan="5">ไม่มีไฟล์แนบ</td></tr>';
  $('a-audit').innerHTML = audit.map((a) => `
    <tr><td>${fmtTime(a.changed_at)}</td><td>${ACTION[a.action]}</td><td>${TABLE[a.table_name] || a.table_name}</td>
    <td>${esc(byWho(a))}</td><td>${esc((a.changed_fields || []).join(', '))}</td><td>${esc(a.reason)}</td></tr>`).join('');
  $('a-restore').textContent = 'นำกลับเป็นผู้ป่วยปัจจุบัน';
  delete $('a-restore').dataset.confirm;
  $('a-detail').scrollIntoView({ behavior: 'smooth' });
}

$('a-sessions').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-session]');
  if (tr) document.dispatchEvent(new CustomEvent('open-session', { detail: tr.dataset.session }));
});

$('a-files').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act="open"]');
  if (!btn) return;
  const tr = btn.closest('tr');
  try {
    const url = await blobUrl(`/patients/${patient.id}/files/${tr.dataset.file}`);
    if (tr.dataset.type === 'image/jpeg') {
      $('a-viewer-img').src = url;
      $('a-viewer-img').alt = tr.dataset.name;
      $('a-viewer-name').textContent = tr.dataset.name;
      $('a-viewer').hidden = false;
    } else {
      Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener' }).click();
    }
  } catch (err) {
    say(err.message);
  }
});
$('a-viewer-close').addEventListener('click', () => { $('a-viewer').hidden = true; });
$('a-close').addEventListener('click', () => { $('a-detail').hidden = true; patient = null; });

// นำกลับ: กดสองครั้งเพื่อยืนยัน
$('a-restore').addEventListener('click', async () => {
  if (needUser('a-msg')) return;
  const btn = $('a-restore');
  if (btn.dataset.confirm !== 'yes') {
    btn.dataset.confirm = 'yes';
    btn.textContent = 'ยืนยันนำกลับ';
    say('ผู้ป่วยจะกลับไปอยู่ในผู้ป่วยทั้งหมด นัดที่ถูกยกเลิกไปแล้วต้องนัดใหม่');
    return;
  }
  try {
    const restored = await api(`/patients/${patient.id}/restore`, { method: 'POST', body: '{}' }, 'a-reason');
    $('a-reason').value = '';
    $('a-detail').hidden = true;
    patient = null;
    await loadList();
    document.dispatchEvent(new CustomEvent('open-patient', { detail: restored.id }));
  } catch (err) {
    say('ไม่สำเร็จ: ' + err.message);
  }
});

document.addEventListener('view-change', (e) => { if (e.detail === 'archive') loadList(); });
