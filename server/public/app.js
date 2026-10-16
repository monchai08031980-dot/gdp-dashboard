// หน้าบันทึกการฟอกเลือด: รายการรอบฟอก, แบบฟอร์ม 519, บันทึกระหว่างฟอก, ยา และประวัติการแก้ไข
import { SECTIONS, VITAL_FIELDS, MEDICATION_FIELDS } from './form519.js';
import {
  $, api, apiList, apiUpload, normalizeHm, esc, fmtTime, fmtDate, age, readField, fieldValue, renderInput, renderField, needUser, byWho, ACTION, TABLE,
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

// หน้าอื่นขอเปิดแบบฟอร์มการฟอก (เช่น ประวัติการฟอกในข้อมูลผู้ป่วยเก่า)
document.addEventListener('open-session', async (e) => {
  document.querySelector('.view-tab[data-view="sessions"]').click();
  await openSession(e.detail);
  $('detail').scrollIntoView({ behavior: 'smooth' });
});

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
  if (!$('cap').hidden && $('cap').dataset.session !== current.id) closeCapture();
  renderRows('medications', MEDICATION_FIELDS, current.medications);
  await loadAudit();
}

async function loadAudit() {
  const rows = await api(`/audit?session_id=${current.id}`);
  $('audit').innerHTML = rows.map((a) => `
    <tr><td>${fmtTime(a.changed_at)}</td><td>${ACTION[a.action]}</td><td>${TABLE[a.table_name] || a.table_name}</td>
    <td>${esc(byWho(a))}</td><td>${esc((a.changed_fields || []).join(', '))}</td><td>${esc(a.reason)}</td></tr>`).join('');
}

async function run(action) {
  try {
    await action();
    $('reason').value = '';
    await openSession(current.id);
    await loadSessions();
    $('msg').textContent = 'บันทึกแล้ว';
    return true;
  } catch (err) {
    $('msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
    return false;
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
      data[f.name] = value === '' ? null : f.type === 'number' ? Number(value) : f.type === 'time' ? (normalizeHm(value) ?? value) : value;
    }
    const base = `/sessions/${current.id}/${kind}`;
    if (btn.dataset.act === 'add') run(() => api(base, { method: 'POST', body: JSON.stringify(data) }));
    if (btn.dataset.act === 'save') run(() => api(`${base}/${tr.dataset.row}`, { method: 'PATCH', body: JSON.stringify(data) }));
    if (btn.dataset.act === 'delete' && confirm('ลบรายการนี้?')) run(() => api(`${base}/${tr.dataset.row}`, { method: 'DELETE' }));
  });
}

// ---------------------------------------------------------------------------
// การถ่ายภาพจากหน้าจอเครื่องฟอก: ถ่ายหรือเลือกภาพ อ่านค่า ให้พยาบาลตรวจ แล้วบันทึกเป็นแถวใหม่
// ภาพใช้อ่านค่าอย่างเดียว ไม่ได้เก็บไว้ในระบบ แถวที่บันทึกผ่าน API เดิมจึงมี audit log เหมือนกรอกเอง
// ---------------------------------------------------------------------------
// เรียงตามคอลัมน์บันทึกระหว่างฟอก: Time BP sys BP dia PR RR BFR PV TMP Conduct UFR Total ml (หมายเหตุใส่ให้อัตโนมัติ)
const CAPTURE_FIELDS = VITAL_FIELDS.filter((f) => f.name !== 'note');
const CAPTURE_NOTE = 'อ่านจากภาพหน้าจอเครื่อง';
let captureImage = null;
let readerEnabled = null;

const nowHm = () => new Date().toTimeString().slice(0, 5);
const capMsg = (text) => { $('cap-msg').textContent = text; };

function renderReview(values = {}, unread = []) {
  $('cap-review').innerHTML = `<thead><tr>${CAPTURE_FIELDS.map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr></thead>
    <tbody><tr>${CAPTURE_FIELDS.map((f) => `<td>${renderInput(f, values[f.name] ?? '')}</td>`).join('')}</tr></tbody>`;
  for (const name of unread) $('cap-review').querySelector(`[name="${name}"]`)?.classList.add('unread');
}

function closeCapture() {
  stopCamera();
  $('cap').hidden = true;
  $('cap-body').hidden = true;
  captureImage = null;
  $('cap-img').removeAttribute('src');
}

// ย่อภาพให้ด้านยาวไม่เกิน 1600 px แล้วแปลงเป็น JPEG เพื่อส่งเร็วและไม่ติดขนาดไฟล์
async function toJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return new File([blob], 'machine-screen.jpg', { type: 'image/jpeg' });
}

// กล้องสดในหน้าเว็บ (กล้องหลังถ้ามี) ถ้าเปิดไม่ได้ใช้กล้องหรือไฟล์ของเครื่องแทน
let cameraStream = null;
function stopCamera() {
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  $('cap-video').srcObject = null;
  $('cap-live').hidden = true;
}

// เปิดกล้องของเครื่องที่ใช้อยู่: ถ้าหน้าเว็บเปิดกล้องเองได้ แสดงภาพสดพร้อมปุ่มถ่าย
// ถ้าไม่ได้ (เบราว์เซอร์หรือหน้าที่ฝังอยู่ไม่อนุญาต) เปิดกล้องของเครื่องผ่านช่องเลือกภาพแบบ capture แทนทันที
const cameraBlocked = () => {
  const policy = document.permissionsPolicy || document.featurePolicy;
  return !navigator.mediaDevices?.getUserMedia || (policy?.allowsFeature && !policy.allowsFeature('camera'));
};
function openDeviceCamera() {
  $('cap-device').click();
}

async function openCamera() {
  capMsg('');
  if (cameraBlocked()) { openDeviceCamera(); return; }
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
    $('cap-video').srcObject = cameraStream;
    $('cap-live').hidden = false;
    $('cap-body').hidden = true;
    $('cap-live').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    stopCamera();
    if (err?.name === 'NotAllowedError') {
      $('cap-hint').textContent = 'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตกล้องในเบราว์เซอร์ แล้วกดถ่ายอีกครั้ง';
    }
    openDeviceCamera();
  }
}

async function takeShot() {
  const video = $('cap-video');
  if (!video.videoWidth) { $('cap-hint').textContent = 'กล้องยังไม่พร้อม กรุณารอสักครู่'; return; }
  const canvas = Object.assign(document.createElement('canvas'), { width: video.videoWidth, height: video.videoHeight });
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  stopCamera();
  await useImage(new File([blob], 'machine-screen.jpg', { type: 'image/jpeg' }));
}

async function pickImage(input) {
  const file = input.files[0];
  input.value = '';
  if (file) await useImage(file);
}

async function useImage(file) {
  if (!file.type.startsWith('image/')) { $('cap-hint').textContent = 'กรุณาเลือกไฟล์ภาพ'; return; }
  try {
    captureImage = await toJpeg(file);
  } catch {
    $('cap-hint').textContent = 'เปิดภาพนี้ไม่ได้ กรุณาถ่ายหรือเลือกภาพใหม่';
    return;
  }
  $('cap-img').src = URL.createObjectURL(captureImage);
  $('cap-body').hidden = false;
  $('cap-warn').innerHTML = '';
  $('cap-status').textContent = readerEnabled ? 'กด "อ่านค่า" เพื่อให้ระบบอ่านค่าจากภาพ' : '';
  capMsg('');
  // ถ้าระบบอ่านภาพเปิดอยู่ ช่อง Time รอค่าจากนาฬิกาบนเครื่อง ไม่ใส่เวลาของอุปกรณ์แทน
  renderReview(readerEnabled ? {} : { recorded_time: nowHm() });
  if (readerEnabled) readScreen();
}

async function readScreen() {
  if (!captureImage || needUser('cap-msg')) return;
  $('cap-read').disabled = true;
  $('cap-status').textContent = 'กำลังอ่านค่าจากภาพ (อ่านสองรอบเพื่อตรวจซ้ำ อาจใช้เวลาถึง 1 นาที)...';
  $('cap-warn').innerHTML = '';
  try {
    const { values, warnings, notes } = await apiUpload(`/sessions/${current.id}/vitals/read-screen`, captureImage);
    const unread = CAPTURE_FIELDS.filter((f) => values[f.name] == null).map((f) => f.name);
    renderReview(values, unread);
    const unreadLabels = CAPTURE_FIELDS.filter((f) => unread.includes(f.name)).map((f) => f.label);
    $('cap-status').textContent = unread.length
      ? `อ่านได้แน่นอน ${CAPTURE_FIELDS.length - unread.length} ค่า ช่องสีเหลือง (${unreadLabels.join(', ')}) กรุณากรอกเองจากหน้าจอเครื่อง`
      : 'อ่านได้ครบทุกค่า';
    $('cap-warn').innerHTML = [...warnings, ...(notes ? [notes] : []), 'กรุณาตรวจค่ากับหน้าจอเครื่องทุกครั้งก่อนบันทึก']
      .map((w) => `<li>${esc(w)}</li>`).join('');
  } catch (err) {
    $('cap-status').textContent = 'อ่านค่าไม่สำเร็จ: ' + err.message;
  } finally {
    $('cap-read').disabled = false;
  }
}

$('cap-open').addEventListener('click', async () => {
  $('cap').hidden = false;
  $('cap').dataset.session = current.id;
  capMsg('');
  if (readerEnabled === null) {
    readerEnabled = await fetch('/api/health').then((r) => r.json()).then((h) => Boolean(h.screen_reader)).catch(() => false);
  }
  $('cap-read').hidden = !readerEnabled;
  $('cap-hint').textContent = readerEnabled
    ? 'ถ่ายตรงหน้าจอเครื่องให้เห็นตัวเลขชัด ไม่เอียง ไม่สะท้อนแสง ไม่ให้เห็นชื่อผู้ป่วย ระบบอ่านสองรอบและเติมเฉพาะค่าที่ตรงกัน พยาบาลตรวจกับหน้าจอก่อนกดบันทึก ภาพไม่ถูกเก็บในระบบ'
    : 'ยังไม่ได้เปิดใช้ระบบอ่านภาพอัตโนมัติ ถ่ายหรือเลือกภาพแล้วกรอกค่าตามภาพได้เลย';
});
$('cap-close').addEventListener('click', closeCapture);
$('cap-camera-btn').addEventListener('click', openCamera);
$('cap-shot').addEventListener('click', takeShot);
$('cap-live-cancel').addEventListener('click', stopCamera);
$('cap-file').addEventListener('change', (e) => pickImage(e.target));
$('cap-device').addEventListener('change', (e) => pickImage(e.target));
$('cap-read').addEventListener('click', readScreen);
$('cap-save').addEventListener('click', async () => {
  if (needUser('cap-msg')) return;
  const data = {};
  for (const f of CAPTURE_FIELDS) {
    const value = $('cap-review').querySelector(`[name="${f.name}"]`).value.trim();
    data[f.name] = value === '' ? null : f.type === 'number' ? Number(value) : f.type === 'time' ? (normalizeHm(value) ?? value) : value;
  }
  if (!data.recorded_time) { capMsg('กรุณาใส่เวลา'); return; }
  data.note = CAPTURE_NOTE;
  if (CAPTURE_FIELDS.every((f) => f.name === 'recorded_time' || data[f.name] == null)) { capMsg('ยังไม่มีค่าที่จะบันทึก'); return; }
  if (await run(() => api(`/sessions/${current.id}/vitals`, { method: 'POST', body: JSON.stringify(data) }))) {
    closeCapture();
    $('msg').textContent = 'บันทึกค่าจากภาพหน้าจอลงบันทึกระหว่างฟอกแล้ว';
  } else {
    capMsg($('msg').textContent);
  }
});

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
$('close').addEventListener('click', () => { closeCapture(); $('detail').hidden = true; current = null; });

loadSessions();
