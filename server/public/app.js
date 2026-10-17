// หน้าบันทึกการฟอกเลือด: รายการรอบฟอก, แบบฟอร์ม 519, บันทึกระหว่างฟอก, ยา และประวัติการแก้ไข
import { SECTIONS, VITAL_FIELDS, MEDICATION_FIELDS } from './form519.js';
import { hdAlerts } from './hdAlerts.js';
import { DEFAULT_ALERT_SETTINGS, TONES, LEVELS, meets, normalizeAlertSettings } from './alertSettings.js';
import { playAlert } from './alertSound.js';
import { buildPdf519 } from './pdf519.js';
import { getSaveMode, setSaveMode, canPickFolder, savedFolder, pickFolder, writeToFolder, makeZip, downloadFile } from './localSave.js';
import {
  $, api, apiList, apiUpload, normalizeHm, hhmm, esc, fmtTime, fmtDate, age, readField, fieldValue, renderInput, renderField, needUser, byWho, ACTION, TABLE,
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
  showHdAlerts();
  soundForNewAlerts();
  if (!$('cap').hidden && $('cap').dataset.session !== current.id) closeCapture();
  renderRows('medications', MEDICATION_FIELDS, current.medications);
  resetConfirm();
  await loadAudit();
}

// เตือนค่าผิดปกติระหว่างฟอก (เกณฑ์ใน hdAlerts.js) อ่านจากตารางและแบบฟอร์มที่แสดงอยู่ จึงเตือนทันทีขณะพิมพ์ก่อนกดเพิ่ม
function showHdAlerts() {
  const trs = [...$('vitals').querySelectorAll('tbody tr')];
  const val = (root, name) => root.querySelector(`[name="${name}"]`)?.value ?? '';
  const rows = trs.map((tr) => Object.fromEntries(VITAL_FIELDS.map((f) => [f.name, val(tr, f.name)])));
  const session = Object.fromEntries(['pre_bp_sys', 'target_uf_kg', 'dry_weight_kg', 'pre_weight_kg'].map((n) => [n, val($('form'), n) || current?.[n]]));
  const { rows: alerts, count } = hdAlerts(rows, session);
  const items = [];
  trs.forEach((tr, i) => {
    tr.querySelectorAll('.alert-warn, .alert-danger').forEach((el) => { el.classList.remove('alert-warn', 'alert-danger'); el.removeAttribute('title'); });
    for (const a of alerts[i]) {
      const input = tr.querySelector(`[name="${a.field}"]`);
      if (!input) continue;
      if (!input.classList.contains('alert-danger')) input.classList.add(`alert-${a.level}`);
      if (a.level === 'danger') input.classList.remove('alert-warn');
      input.title = [input.title, a.text].filter(Boolean).join('\n');
      const time = rows[i].recorded_time ? normalizeHm(rows[i].recorded_time) || rows[i].recorded_time : (tr.dataset.row ? '' : 'แถวใหม่');
      items.push(`<li class="${a.level}">${a.level === 'danger' ? '⚠️ ' : ''}${time ? `<b>${esc(time)}</b> ` : ''}${esc(a.text)}</li>`);
    }
  });
  // SMS ที่ส่งไปแล้วของรอบนี้ (จากเซิร์ฟเวอร์)
  const sent = {};
  for (const n of current?.notifications || []) (sent[`${n.phone}|${n.status}`] ??= new Set()).add(n.vital_id);
  const SMS_STATUS = { SENT: 'ส่ง SMS แล้ว', FAILED: 'ส่ง SMS ไม่สำเร็จ', NOT_CONFIGURED: 'ยังไม่ได้ส่ง SMS (ยังไม่ได้ตั้งค่าผู้ให้บริการ)' };
  const sms = Object.entries(sent).map(([k, rows]) => { const [phone, status] = k.split('|'); return `<li class="sms">📱 ${SMS_STATUS[status]} ถึง ${esc(phone)} (${rows.size} แถว)</li>`; });
  $('hd-alerts').hidden = !count && !sms.length;
  $('hd-alerts').innerHTML = (count ? `<li class="head">เตือนระหว่างฟอก ${count} รายการ กรุณาประเมินผู้ป่วยและรายงานแพทย์ตามแนวทางของศูนย์</li>${items.join('')}` : '') + sms.join('');
}

// เสียงเตือน: ดังเมื่อแถวที่บันทึกแล้วมีค่าผิดปกติใหม่ (เปิดแบบฟอร์มครั้งแรกไม่ดัง)
let alertCfg = DEFAULT_ALERT_SETTINGS;
let smsReady = false;
let heard = { session: null, keys: new Set() };
function soundForNewAlerts() {
  const { rows } = hdAlerts(current.vitals, current);
  const keys = new Set();
  rows.forEach((list, i) => list.forEach((a) => keys.add(`${current.vitals[i].id}|${a.field}|${a.level}`)));
  const fresh = heard.session === current.id ? [...keys].filter((k) => !heard.keys.has(k)) : [];
  heard = { session: current.id, keys };
  const { sound } = alertCfg;
  if (sound.enabled && fresh.some((k) => meets(k.split('|')[2], sound.level))) playAlert(sound);
}

async function loadAlertSettings() {
  try {
    const s = await api('/settings');
    alertCfg = s.hd_alert || DEFAULT_ALERT_SETTINGS;
    smsReady = Boolean(s.sms_ready);
  } catch {}
  const { sound, sms } = alertCfg;
  $('al-summary').textContent = `เสียง${sound.enabled ? `เปิด (${TONES[sound.tone]})` : 'ปิด'} · SMS ${sms.enabled ? `เปิด ${sms.phones.length} เบอร์${smsReady ? '' : ' แต่ยังไม่ได้ตั้งค่าผู้ให้บริการ SMS'}` : 'ปิด'}`;
}

function fillAlertForm() {
  const { sound, sms } = alertCfg;
  const opts = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  $('al-sound-on').value = sound.enabled ? '1' : '0';
  $('al-sound-level').innerHTML = opts(LEVELS, sound.level);
  $('al-tone').innerHTML = opts(TONES, sound.tone);
  $('al-volume').value = sound.volume;
  $('al-volume-v').textContent = `${sound.volume}%`;
  $('al-repeat').value = sound.repeat;
  $('al-sms-on').value = sms.enabled ? '1' : '0';
  $('al-sms-level').innerHTML = opts(LEVELS, sms.level);
  $('al-phones').value = sms.phones.join('\n');
  $('al-sms-state').textContent = smsReady
    ? 'เชื่อมต่อผู้ให้บริการ SMS แล้ว'
    : 'ยังไม่ได้เชื่อมต่อผู้ให้บริการ SMS บนเซิร์ฟเวอร์ (ตั้ง SMS_WEBHOOK_URL) ตั้งเบอร์ไว้ก่อนได้ ระบบจะบันทึกว่ายังไม่ได้ส่งจนกว่าจะเชื่อมต่อ';
  $('al-msg').textContent = '';
}
const readAlertForm = () => ({
  sound: { enabled: $('al-sound-on').value === '1', level: $('al-sound-level').value, tone: $('al-tone').value, volume: Number($('al-volume').value), repeat: Number($('al-repeat').value) },
  sms: { enabled: $('al-sms-on').value === '1', level: $('al-sms-level').value, phones: $('al-phones').value },
});

$('al-toggle').addEventListener('click', async () => {
  $('al').hidden = !$('al').hidden;
  if (!$('al').hidden) { await loadAlertSettings(); fillAlertForm(); }
});
$('al-volume').addEventListener('input', () => { $('al-volume-v').textContent = `${$('al-volume').value}%`; });
$('al-play').addEventListener('click', () => {
  const { value } = normalizeAlertSettings(readAlertForm());
  if (!playAlert({ ...value.sound, repeat: Math.min(value.sound.repeat, 2) })) $('al-msg').textContent = 'ความดังเป็น 0 หรือเครื่องนี้เล่นเสียงไม่ได้';
});
$('al-save').addEventListener('click', async () => {
  if (needUser('al-msg')) return;
  const { errors } = normalizeAlertSettings(readAlertForm());
  if (errors.length) { $('al-msg').textContent = errors.join(' · '); return; }
  try {
    await api('/settings/hd-alert', { method: 'PUT', body: JSON.stringify(readAlertForm()) }, 'al-no-reason');
    await loadAlertSettings();
    fillAlertForm();
    $('al-msg').textContent = 'บันทึกแล้ว';
  } catch (err) { $('al-msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message; }
});
$('al-test-sms').addEventListener('click', async () => {
  if (needUser('al-msg')) return;
  $('al-msg').textContent = 'กำลังส่ง...';
  try {
    const { results } = await api('/settings/hd-alert/test-sms', { method: 'POST', body: '{}' }, 'al-no-reason');
    const label = { SENT: 'ส่งแล้ว', FAILED: 'ส่งไม่สำเร็จ', NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่าผู้ให้บริการ SMS' };
    $('al-msg').textContent = results.map((r) => `${r.phone}: ${label[r.status]}${r.status === 'FAILED' ? ` (${r.error})` : ''}`).join(' · ');
  } catch (err) { $('al-msg').textContent = err.message + ' (กดบันทึกการตั้งค่าก่อน)'; }
});
loadAlertSettings();
$('vitals').addEventListener('input', showHdAlerts);
$('form').addEventListener('input', (e) => { if (['pre_bp_sys', 'target_uf_kg', 'dry_weight_kg', 'pre_weight_kg'].includes(e.target.name)) showHdAlerts(); });

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
loadFolder();
    $('msg').textContent = 'บันทึกแล้ว';
    return true;
  } catch (err) {
    $('msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
    return false;
  }
}

// ช่องในแบบฟอร์มที่แก้แล้วแต่ยังไม่ได้กดบันทึก
function formChanges() {
  const changes = {};
  for (const field of SECTIONS.flatMap((s) => s.fields)) {
    const value = readField($('form'), field);
    const before = current[field.name] ?? null;
    const same = field.type === 'checklist'
      ? JSON.stringify([...value].sort()) === JSON.stringify([...(before || [])].sort())
      : String(value ?? '') === fieldValue(current, field);
    if (!same) changes[field.name] = value;
  }
  return changes;
}

$('save').addEventListener('click', () => {
  if (needUser('msg')) return;
  const changes = formChanges();
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

// ค่าของเครื่องที่ถ้าไม่เปลี่ยนให้ใช้ค่าเดิม กรอกให้ครบทุกช่องทุกแถว (ช่องสีฟ้า ให้พยาบาลตรวจ)
// ช่องว่างใช้ค่าจากแถวก่อนหน้า แถวแรกใช้บันทึกระหว่างฟอกแถวล่าสุดที่เวลาก่อนหน้า
// ถ้ายังไม่มีค่าก่อนหน้าเลย ใช้ค่าแรกที่อ่านได้ในแถวถัดไป
const CARRY_FIELDS = ['bfr_ml_min', 'pv_mmhg', 'tmp_mmhg', 'conductivity_ms_cm', 'ufr', 'total_uf_ml'];
function carryForward(rows) {
  const firstTime = rows.find((r) => r.values.recorded_time)?.values.recorded_time;
  const earlier = (current?.vitals || [])
    .filter((v) => firstTime && hhmm(v.recorded_time) < firstTime)
    .sort((a, b) => String(a.recorded_time).localeCompare(String(b.recorded_time)));
  const out = rows.map((r) => ({ ...r, values: { ...r.values }, carried: [] }));
  for (const name of CARRY_FIELDS) {
    let prev = earlier.at(-1)?.[name] ?? out.find((r) => r.values[name] != null)?.values[name] ?? null;
    for (const r of out) {
      if (r.values[name] == null && prev != null) { r.values[name] = prev; r.carried.push(name); }
      prev = r.values[name] ?? prev;
    }
  }
  return out;
}

// ตารางตรวจค่าที่อ่านได้ แถวละหนึ่งเวลา ติ๊กเลือกแถวที่จะบันทึก ช่องที่อ่านไม่ได้เป็นสีเหลือง
// แถวที่มีเวลาเดียวกันอยู่แล้วในบันทึกระหว่างฟอกจะไม่ถูกเลือกไว้ กันบันทึกซ้ำ
function renderReview(rows) {
  const have = new Set((current?.vitals || []).map((v) => hhmm(v.recorded_time)));
  $('cap-review').innerHTML = `<thead><tr><th>บันทึก</th>${CAPTURE_FIELDS.map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => {
      const dup = r.values.recorded_time && have.has(r.values.recorded_time);
      return `<tr><td><label class="check"><input type="checkbox" data-pick ${dup ? '' : 'checked'}>${dup ? '<span class="badge">มีแล้ว</span>' : ''}</label></td>
        ${CAPTURE_FIELDS.map((f) => `<td>${renderInput(f, r.values[f.name] ?? '')}</td>`).join('')}</tr>`;
    }).join('')}</tbody>`;
  [...$('cap-review').tBodies[0].rows].forEach((tr, i) => {
    for (const f of CAPTURE_FIELDS) if (rows[i].values[f.name] == null) tr.querySelector(`[name="${f.name}"]`)?.classList.add('unread');
    for (const name of rows[i].carried || []) {
      const input = tr.querySelector(`[name="${name}"]`);
      input?.classList.add('carried');
      if (input) input.title = 'ใช้ค่าเดิมจากแถวก่อนหน้า';
    }
  });
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
  renderReview([{ values: readerEnabled ? {} : { recorded_time: nowHm() } }]);
  if (readerEnabled) readScreen();
}

async function readScreen() {
  if (!captureImage || needUser('cap-msg')) return;
  $('cap-read').disabled = true;
  $('cap-status').textContent = 'กำลังอ่านค่าจากภาพ (อ่านสองรอบเพื่อตรวจซ้ำ อาจใช้เวลาถึง 1 นาที)...';
  $('cap-warn').innerHTML = '';
  try {
    const { rows, warnings, notes } = await apiUpload(`/sessions/${current.id}/vitals/read-screen`, captureImage);
    // ลงทุกแถวที่อ่านได้บนหน้าจอเครื่อง เรียงตามเวลา
    const extra = [];
    let shown = rows;
    $('cap-status').textContent = rows.length > 1 ? `อ่านได้ ${rows.length} แถวจากหน้าจอเครื่อง` : '';
    if (!shown.length) {
      $('cap-status').textContent = 'ไม่พบแถวที่อ่านได้บนหน้าจอ';
      shown = [{ values: {} }];
    }
    shown = carryForward(shown);
    const carried = shown.reduce((n, r) => n + (r.carried?.length || 0), 0);
    if (carried) extra.push(`ช่องสีฟ้า ${carried} ช่อง ใช้ค่าเดิม (BFR, PV, TMP, Conduct, UFR, Total ml) กรุณาตรวจกับหน้าจอเครื่อง`);
    renderReview(shown);
    const dups = $('cap-review').querySelectorAll('[data-pick]:not(:checked)').length;
    if (dups) extra.push(`${dups} แถวมีเวลานี้อยู่แล้วในบันทึกระหว่างฟอก จึงไม่ได้ติ๊กไว้ กันบันทึกซ้ำ`);
    const unread = shown.reduce((n, r) => n + CAPTURE_FIELDS.filter((f) => r.values[f.name] == null).length, 0);
    if (rows.length === 1) {
      $('cap-status').textContent = unread ? `ช่องสีเหลือง ${unread} ช่องอ่านไม่ได้แน่นอน กรุณากรอกเองจากหน้าจอเครื่อง` : 'อ่านได้ครบทุกค่า';
    } else if (unread) {
      $('cap-status').textContent += ` · ช่องสีเหลือง ${unread} ช่องกรุณากรอกเอง`;
    }
    $('cap-warn').innerHTML = [...extra, ...warnings, ...(notes ? [notes] : []), 'กรุณาตรวจค่ากับหน้าจอเครื่องทุกครั้งก่อนบันทึก']
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
  const picked = [];
  for (const tr of $('cap-review').tBodies[0].rows) {
    if (!tr.querySelector('[data-pick]').checked) continue;
    const data = {};
    for (const f of CAPTURE_FIELDS) {
      const value = tr.querySelector(`[name="${f.name}"]`).value.trim();
      data[f.name] = value === '' ? null : f.type === 'number' ? Number(value) : f.type === 'time' ? (normalizeHm(value) ?? value) : value;
    }
    if (CAPTURE_FIELDS.every((f) => f.name === 'recorded_time' || data[f.name] == null)) continue;
    if (!data.recorded_time) { capMsg('กรุณาใส่เวลาให้ทุกแถวที่เลือก'); return; }
    picked.push({ ...data, note: CAPTURE_NOTE });
  }
  if (!picked.length) { capMsg('ยังไม่มีแถวที่จะบันทึก'); return; }
  const ok = await run(async () => {
    for (const data of picked) await api(`/sessions/${current.id}/vitals`, { method: 'POST', body: JSON.stringify(data) });
  });
  if (ok) {
    closeCapture();
    $('msg').textContent = `บันทึกค่าจากภาพหน้าจอลงบันทึกระหว่างฟอกแล้ว ${picked.length} แถว`;
  } else {
    capMsg($('msg').textContent);
  }
});

// ---------------------------------------------------------------------------
// ยืนยันข้อมูลทั้งหมด: ตรวจทั้งแบบฟอร์มที่เซิร์ฟเวอร์ (กติกาใน sessionCheck.js) แล้วบันทึกไฟล์ลงโฟลเดอร์เก็บข้อมูล
// ต้องไม่มีข้อผิดพลาด และข้อควรตรวจต้องติ๊กรับทราบก่อน การยืนยันมี audit log
// ---------------------------------------------------------------------------
let dataFolder = null; // โฟลเดอร์บนเครื่องเซิร์ฟเวอร์
let localFolder = null; // โฟลเดอร์ที่เลือกในเครื่องนี้ (FileSystemDirectoryHandle)
let prepared = null; // ข้อมูลที่จะบันทึกและ PDF ที่แสดงตัวอย่างอยู่
const confirmMsg = (text) => { $('confirm-msg').textContent = text; };

function targetText() {
  if (getSaveMode() === 'server') return dataFolder ? `โฟลเดอร์บนเครื่องเซิร์ฟเวอร์ ${dataFolder}` : 'โฟลเดอร์บนเครื่องเซิร์ฟเวอร์ (ยังไม่ได้ตั้งค่า)';
  if (localFolder) return `โฟลเดอร์ "${localFolder.name}" ในเครื่องนี้`;
  return canPickFolder() ? 'โฟลเดอร์ในเครื่องนี้ (ยังไม่ได้เลือก)' : 'ดาวน์โหลดเป็นไฟล์ zip ลงเครื่องนี้';
}

async function loadFolder() {
  try { dataFolder = (await api('/settings')).data_folder; } catch { dataFolder = null; }
  localFolder = await savedFolder();
  $('folder-current').textContent = dataFolder || 'ยังไม่ได้ตั้งค่า';
  $('folder-local').textContent = localFolder ? localFolder.name : canPickFolder() ? 'ยังไม่ได้เลือก' : 'เลือกไม่ได้ในเบราว์เซอร์นี้ (จะดาวน์โหลดเป็น zip)';
  for (const r of document.querySelectorAll('input[name="save-mode"]')) r.checked = r.value === getSaveMode();
  $('confirm-folder').textContent = targetText();
  if (prepared) $('confirm-target').textContent = targetText();
}

function renderConfirmState() {
  const e = current?.export;
  const el = $('confirm-state');
  if (!e) { el.className = 'confirm-state'; el.textContent = 'ยังไม่ได้ยืนยัน'; return; }
  const where = e.target === 'server' ? e.file_path.replace(/\.json$/, '.pdf') : e.pdf_path || e.file_path;
  el.className = 'confirm-state ' + (e.edited_after ? 'stale' : 'ok');
  el.innerHTML = e.edited_after
    ? `⚠️ มีการแก้ไขหลังยืนยัน (ยืนยันไว้เมื่อ ${esc(fmtTime(e.created_at))}) กรุณายืนยันใหม่`
    : `✔ ยืนยันแล้ว ${esc(fmtTime(e.created_at))} โดย ${esc(e.confirmed_by)} · <span class="export-path">${esc(where)}</span>`;
}

function resetConfirm() {
  prepared = null;
  $('confirm-result').hidden = true;
  $('pdf-pages').innerHTML = '';
  $('confirm-ack').checked = false;
  $('confirm-reason').value = '';
  confirmMsg('');
  renderConfirmState();
  $('confirm-folder').textContent = targetText();
}

// แถวว่างท้ายตาราง (ไว้เพิ่มรายการ) ที่กรอกค่าแล้วแต่ยังไม่ได้กดเพิ่ม
const pendingRow = (kind) => [...$(kind).querySelectorAll('tr[data-row=""] [name]')].some((el) => el.value.trim() !== '');

function goToField(field) {
  document.querySelectorAll('.check-focus').forEach((el) => el.classList.remove('check-focus'));
  const input = field === 'vitals' || field === 'medications' ? null : $('form').querySelector(`[name="${field}"]`);
  const target = input?.closest('.field') || $(field) || $('form');
  target.classList.add('check-focus');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input?.focus({ preventScroll: true });
}

const checkItem = (item) => `<li data-field="${esc(item.field)}"><small>${esc(item.section)}</small>${esc(item.message)}</li>`;
const fmtSize = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ไฟล์ทั้งสามที่จะบันทึก
const exportFiles = (p) => [
  { name: `${p.name}.pdf`, data: p.pdf },
  { name: `${p.name}.json`, data: new Blob([p.json], { type: 'application/json' }) },
  { name: `${p.name}_vitals.csv`, data: new Blob([p.csv], { type: 'text/csv' }) },
];

// ตรวจข้อมูล ถ้าไม่มีข้อผิดพลาดสร้างตัวอย่าง PDF จากข้อมูลที่จะบันทึกจริง
$('confirm-check').addEventListener('click', async () => {
  if (needUser('confirm-msg')) return;
  if (Object.keys(formChanges()).length) { confirmMsg('มีข้อมูลในแบบฟอร์มที่ยังไม่ได้บันทึก กด "บันทึกแบบฟอร์ม" ก่อน'); return; }
  if (pendingRow('vitals') || pendingRow('medications')) { confirmMsg('มีแถวใหม่ที่กรอกแล้วแต่ยังไม่ได้กด "เพิ่ม" กรุณาเพิ่มหรือลบค่าออกก่อน'); return; }
  prepared = null;
  confirmMsg('กำลังตรวจข้อมูลทั้งหมด…');
  await loadFolder();
  let check;
  try { check = await api(`/sessions/${current.id}/check`); } catch (err) { confirmMsg('ตรวจข้อมูลไม่สำเร็จ: ' + err.message); return; }
  const { errors, warnings } = check;
  $('confirm-result').hidden = false;
  $('confirm-errors').innerHTML = errors.map(checkItem).join('');
  $('confirm-warnings').innerHTML = warnings.map(checkItem).join('');
  $('confirm-summary').textContent = errors.length
    ? `❌ พบข้อมูลที่ต้องแก้ ${errors.length} รายการ${warnings.length ? ` และข้อควรตรวจ ${warnings.length} รายการ` : ''} กดที่รายการเพื่อไปที่ช่องนั้น`
    : warnings.length ? `⚠️ ไม่มีข้อผิดพลาด แต่มีข้อควรตรวจ ${warnings.length} รายการ ตรวจตัวอย่าง PDF ด้านล่างก่อนบันทึก` : '✔ ตรวจครบทุกส่วนแล้ว ไม่พบข้อผิดพลาด ตรวจตัวอย่าง PDF ด้านล่างก่อนบันทึก';
  $('confirm-go').hidden = true;
  $('confirm-ack-wrap').hidden = !warnings.length;
  $('confirm-ack').checked = false;
  if (errors.length) { confirmMsg(''); return; }

  confirmMsg('กำลังสร้างตัวอย่างไฟล์ PDF…');
  try {
    const p = await api(`/sessions/${current.id}/export/prepare`, { method: 'POST', body: '{}' });
    const { pages, pdf } = await buildPdf519(p.record, p.sha256);
    prepared = { ...p, pdf };
    $('pdf-pages').replaceChildren(...pages);
    $('pdf-info').textContent = `${pages.length} หน้า · ${fmtSize(pdf.size)}`;
    $('confirm-files').innerHTML = exportFiles(prepared).map((f) => `<li>${esc([...p.dir, f.name].join(' / '))}</li>`).join('');
    $('confirm-target').textContent = targetText();
    $('confirm-go').hidden = false;
    confirmMsg('');
  } catch (err) {
    confirmMsg('สร้างตัวอย่าง PDF ไม่สำเร็จ: ' + err.message);
  }
});

for (const id of ['confirm-errors', 'confirm-warnings']) {
  $(id).addEventListener('click', (e) => { const li = e.target.closest('li[data-field]'); if (li) goToField(li.dataset.field); });
}
$('confirm-cancel').addEventListener('click', resetConfirm);
$('confirm-change').addEventListener('click', () => {
  $('folder-panel').hidden = false;
  $('folder-panel').scrollIntoView({ behavior: 'smooth' });
  loadFolder();
});
$('pdf-open').addEventListener('click', () => {
  if (!prepared) return;
  const url = URL.createObjectURL(prepared.pdf);
  if (!window.open(url, '_blank')) confirmMsg('เบราว์เซอร์ไม่ให้เปิดแท็บใหม่ ดูตัวอย่างด้านล่างได้เลย');
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
});

// บันทึก: เขียนไฟล์ลงที่เก็บที่เลือก แล้วบันทึกการยืนยัน (มี audit log) ถ้ายืนยันไม่สำเร็จ ลบไฟล์ที่เพิ่งเขียนออก
$('confirm-save').addEventListener('click', async () => {
  if (needUser('confirm-msg') || !prepared) return;
  if (!$('confirm-ack-wrap').hidden && !$('confirm-ack').checked) { confirmMsg('กรุณาติ๊กว่าได้ตรวจข้อควรตรวจทุกข้อแล้ว'); return; }
  const mode = getSaveMode();
  if (mode === 'server' && !dataFolder) { confirmMsg('ยังไม่ได้ตั้งค่าโฟลเดอร์บนเครื่องเซิร์ฟเวอร์ กด "เปลี่ยนที่เก็บ"'); return; }
  const p = prepared;
  const q = { confirmed_at: p.confirmed_at, sha256: p.sha256, ack: $('confirm-ack').checked ? '1' : '' };
  const confirmUrl = (extra) => `/sessions/${current.id}/confirm?${new URLSearchParams({ ...q, ...extra })}`;
  $('confirm-save').disabled = true;
  confirmMsg('กำลังบันทึกลงโฟลเดอร์…');
  try {
    let row;
    let done;
    if (mode === 'server') {
      row = await apiUpload(confirmUrl({ target: 'server' }), new File([p.pdf], `${p.name}.pdf`, { type: 'application/pdf' }), 'confirm-reason');
      done = `บันทึกแล้วที่เครื่องเซิร์ฟเวอร์: ${row.pdf_path}`;
    } else if (localFolder || (canPickFolder() && (localFolder = await pickFolder().catch(() => null)))) {
      const undo = await writeToFolder(localFolder, p.dir, exportFiles(p));
      try {
        row = await api(confirmUrl({ target: 'local', folder: localFolder.name }), { method: 'POST' }, 'confirm-reason');
      } catch (err) {
        await undo();
        throw err;
      }
      done = `บันทึกแล้ว 3 ไฟล์ในโฟลเดอร์ ${[localFolder.name, ...p.dir].join(' / ')}`;
    } else {
      const zip = await makeZip(exportFiles(p).map((f) => ({ ...f, name: [...p.dir, f.name].join('/') })));
      await downloadFile(`${p.name}.zip`, zip);
      row = await api(confirmUrl({ target: 'download', folder: 'ดาวน์โหลด' }), { method: 'POST' }, 'confirm-reason');
      done = `ดาวน์โหลดไฟล์ ${p.name}.zip แล้ว (ข้างในมี PDF, JSON และ CSV)`;
    }
    await openSession(current.id);
    confirmMsg(row.simulated ? `${done} · หน้าตัวอย่าง: การยืนยันเก็บไว้ในเบราว์เซอร์นี้ชั่วคราว` : done);
  } catch (err) {
    if (err.body?.check) {
      $('confirm-errors').innerHTML = err.body.check.errors.map(checkItem).join('');
      $('confirm-warnings').innerHTML = err.body.check.warnings.map(checkItem).join('');
    }
    confirmMsg('บันทึกไม่สำเร็จ: ' + err.message);
  } finally {
    $('confirm-save').disabled = false;
  }
});

// ตั้งค่าที่เก็บไฟล์
$('folder-open').addEventListener('click', async () => {
  $('folder-panel').hidden = !$('folder-panel').hidden;
  if (!$('folder-panel').hidden) { await loadFolder(); $('folder-path').value = dataFolder || ''; $('folder-msg').textContent = ''; }
});
$('folder-close').addEventListener('click', () => { $('folder-panel').hidden = true; });
for (const r of document.querySelectorAll('input[name="save-mode"]')) {
  r.addEventListener('change', () => { setSaveMode(r.value); loadFolder(); });
}
$('folder-pick').addEventListener('click', async () => {
  try {
    const handle = await pickFolder();
    if (!handle) return;
    setSaveMode('local');
    await loadFolder();
    $('folder-msg').textContent = `เลือกโฟลเดอร์ "${handle.name}" แล้ว`;
  } catch (err) {
    $('folder-msg').textContent = err.message;
  }
});
$('folder-save').addEventListener('click', async () => {
  if (needUser('folder-msg')) return;
  $('folder-msg').textContent = 'กำลังตรวจโฟลเดอร์…';
  try {
    const { data_folder, simulated } = await api('/settings/data-folder', { method: 'PUT', body: JSON.stringify({ path: $('folder-path').value }) }, 'folder-reason');
    $('folder-reason').value = '';
    setSaveMode('server');
    await loadFolder();
    $('folder-path').value = data_folder;
    $('folder-msg').textContent = simulated ? 'บันทึกแล้ว (หน้าตัวอย่าง ไม่มีเครื่องเซิร์ฟเวอร์จริง)' : 'บันทึกแล้ว ทดลองเขียนไฟล์ลงโฟลเดอร์ได้';
  } catch (err) {
    $('folder-msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
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
loadFolder();
