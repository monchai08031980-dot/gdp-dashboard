// หน้าบันทึกการฟอกเลือด: รายการรอบฟอก, แบบฟอร์ม 519, บันทึกระหว่างฟอก, ยา และประวัติการแก้ไข
import { SECTIONS, VITAL_FIELDS, MEDICATION_FIELDS } from './form519.js';
import {
  $, api, apiList, esc, fmtTime, fmtDate, age, readField, fieldValue, renderInput, renderField, needUser, ACTION, TABLE,
} from './common.js';

const STATUS = Object.fromEntries(SECTIONS[0].fields.find((f) => f.name === 'status').options);
const ACCESS_SIDE = { LT: 'Lt', RT: 'Rt' };

let current = null;
const listState = { page: 1 };

async function loadSessions() {
  const size = Number($('page-size').value);
  const params = new URLSearchParams({ limit: size, offset: (listState.page - 1) * size });
  if ($('date').value) params.set('date', $('date').value);
  if ($('search').value.trim()) params.set('q', $('search').value.trim());
  const { rows, total } = await apiList('/sessions?' + params);
  const pages = Math.max(1, Math.ceil(total / size));
  if (listState.page > pages) { listState.page = pages; return loadSessions(); }
  $('sessions').innerHTML = rows.map((s) => `
    <tr class="clickable" data-id="${s.id}">
      <td>${fmtDate(s.session_date)}</td><td>${esc(s.session_no)}</td><td>${esc(s.shift)}</td><td>${esc(s.bed_no)}</td>
      <td>${esc(s.hn)}</td><td>${esc(`${s.prefix || ''}${s.first_name} ${s.last_name}`)}</td>
      <td>${esc(s.pre_weight_kg)} / ${esc(s.post_bw_kg)}</td><td>${esc(s.total_uf_ml)}</td>
      <td><span class="badge">${STATUS[s.status] || s.status}</span></td>
    </tr>`).join('') || '<tr><td colspan="9">ไม่พบรายการ</td></tr>';
  const from = total ? (listState.page - 1) * size + 1 : 0;
  $('page-info').textContent = `${from}–${from + rows.length - (total ? 1 : 0)} จาก ${total} รายการ · หน้า ${listState.page}/${pages}`;
  $('prev').disabled = listState.page <= 1;
  $('next').disabled = listState.page >= pages;
}

// ตารางแถวย่อย (บันทึกระหว่างฟอก / ยา) แก้ในแถวได้ และมีแถวว่างไว้เพิ่มรายการใหม่
function renderRows(kind, fields, rows) {
  const head = `<tr>${fields.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th></th></tr>`;
  const row = (r) => `<tr data-row="${r?.id || ''}">${fields.map((f) =>
    `<td>${renderInput(f, fieldValue(r, f))}</td>`).join('')}
    <td class="row-actions">${r
      ? `<button type="button" class="ghost" data-act="save">บันทึก</button><button type="button" class="ghost danger" data-act="delete">ลบ</button>`
      : `<button type="button" data-act="add">เพิ่ม</button>`}</td></tr>`;
  $(kind).innerHTML = `<thead>${head}</thead><tbody>${rows.map(row).join('')}${row(null)}</tbody>`;
}

async function openSession(id) {
  current = await api('/sessions/' + id);
  const patient = await api('/patients/' + current.patient_id);
  $('detail').hidden = false;
  $('detail-title').textContent = 'Hemodialysis sheet (แบบฟอร์ม 519)';
  $('patient').innerHTML = `
    <span><b>Name</b> ${esc(`${patient.prefix || ''}${patient.first_name} ${patient.last_name}`)}</span>
    <span><b>Age</b> ${age(patient.birth_date, current.session_date)} yrs</span>
    <span><b>HN</b> ${esc(patient.hn)}</span>
    <span><b>Access</b> ${esc(patient.vascular_access)} ${esc(ACCESS_SIDE[patient.access_side] || '')}</span>
    <span><b>สิทธิ</b> ${esc(patient.payer)}</span>`;
  $('msg').textContent = '';
  $('form').innerHTML = SECTIONS.map((s) => `
    <fieldset><legend>${esc(s.title)}</legend>${s.fields.map((f) => renderField(f, current)).join('')}</fieldset>`).join('');
  renderRows('vitals', VITAL_FIELDS, current.vitals);
  renderRows('medications', MEDICATION_FIELDS, current.medications);
  await loadAudit();
}

async function loadAudit() {
  const rows = await api(`/audit?session_id=${current.id}`);
  $('audit').innerHTML = rows.map((a) => `
    <tr><td>${fmtTime(a.changed_at)}</td><td>${ACTION[a.action]}</td><td>${TABLE[a.table_name] || a.table_name}</td>
    <td>${esc(a.changed_by)}</td><td>${esc((a.changed_fields || []).join(', '))}</td><td>${esc(a.reason)}</td></tr>`).join('');
}

async function run(action) {
  try {
    await action();
    $('reason').value = '';
    await openSession(current.id);
    await loadSessions();
    $('msg').textContent = 'บันทึกแล้ว';
  } catch (err) {
    $('msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
  }
}

$('save').addEventListener('click', () => {
  if (needUser('msg')) return;
  const changes = {};
  for (const field of SECTIONS.flatMap((s) => s.fields)) {
    const value = readField($('form'), field);
    const before = current[field.name] ?? null;
    const same = field.type === 'checklist'
      ? JSON.stringify([...value].sort()) === JSON.stringify([...(before || [])].sort())
      : String(value ?? '') === fieldValue(current, field);
    if (!same) changes[field.name] = value;
  }
  if (!Object.keys(changes).length) { $('msg').textContent = 'ไม่มีการเปลี่ยนแปลง'; return; }
  run(() => api('/sessions/' + current.id, { method: 'PATCH', body: JSON.stringify(changes) }));
});

for (const [kind, fields] of [['vitals', VITAL_FIELDS], ['medications', MEDICATION_FIELDS]]) {
  $(kind).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || needUser('msg')) return;
    const tr = btn.closest('tr');
    const data = {};
    for (const f of fields) {
      const value = tr.querySelector(`[name="${f.name}"]`).value;
      data[f.name] = value === '' ? null : f.type === 'number' ? Number(value) : value;
    }
    const base = `/sessions/${current.id}/${kind}`;
    if (btn.dataset.act === 'add') run(() => api(base, { method: 'POST', body: JSON.stringify(data) }));
    if (btn.dataset.act === 'save') run(() => api(`${base}/${tr.dataset.row}`, { method: 'PATCH', body: JSON.stringify(data) }));
    if (btn.dataset.act === 'delete' && confirm('ลบรายการนี้?')) run(() => api(`${base}/${tr.dataset.row}`, { method: 'DELETE' }));
  });
}

$('sessions').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row) openSession(row.dataset.id).then(() => $('detail').scrollIntoView({ behavior: 'smooth' }));
});
const reloadFromFirstPage = () => { listState.page = 1; loadSessions(); };
let searchTimer;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(reloadFromFirstPage, 250); });
$('date').addEventListener('change', reloadFromFirstPage);
$('page-size').addEventListener('change', reloadFromFirstPage);
$('all').addEventListener('click', () => { $('date').value = ''; reloadFromFirstPage(); });
$('prev').addEventListener('click', () => { listState.page--; loadSessions(); });
$('next').addEventListener('click', () => { listState.page++; loadSessions(); });
$('close').addEventListener('click', () => { $('detail').hidden = true; current = null; });

loadSessions();
