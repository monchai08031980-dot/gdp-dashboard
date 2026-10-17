// หน้าเตรียมผู้ป่วย: ตารางนัดฟอกล่วงหน้าแบบวัน สัปดาห์ เดือน และดูข้อมูลผู้ป่วย
import { PATIENT_FIELDS, CHECKLISTS, ASSESSMENT_SECTIONS, ASSESSMENT_FIELDS } from './form519.js';
import { parseSpoken } from './voiceNote.js';
import { speechSupported, toggleDictation, stopDictation } from './speech.js';
import { $, api, apiList, apiUpload, blobUrl, esc, fmtDate, fmtTime, age, needUser, renderField, readField } from './common.js';

const NO_REASON = 's-no-reason'; // หน้านี้ไม่มีช่องเหตุผล
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.']; // เริ่มวันจันทร์
const state = { mode: 'week', anchor: null, shifts: [], entries: [], chosen: null, pd: null };

// ---------------------------------------------------------------------------
// วันที่ (ใช้เวลาท้องถิ่น รูปแบบ YYYY-MM-DD)
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const weekday = (s) => (parse(s).getDay() + 6) % 7; // 0 = จันทร์
const today = () => iso(new Date());
const monthLabel = (s) => parse(s).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
const weekdayName = (s, style = 'short') => parse(s).toLocaleDateString('th-TH', { weekday: style });
// หัวตาราง: "ศ. 16/10" ส่วนที่อื่นใช้วันที่เต็ม "ศ. 16/10/2569"
const dayLabel = (s) => `${weekdayName(s)} ${s.slice(8, 10)}/${s.slice(5, 7)}`;
const dayFull = (s, style = 'short') => `${weekdayName(s, style)} ${fmtDate(s)}`;

function range() {
  const a = state.anchor;
  if (state.mode === 'day') return [a, a];
  if (state.mode === 'week') { const from = addDays(a, -weekday(a)); return [from, addDays(from, 6)]; }
  const first = a.slice(0, 8) + '01';
  const last = iso(new Date(parse(first).getFullYear(), parse(first).getMonth() + 1, 0));
  return [addDays(first, -weekday(first)), addDays(last, 6 - weekday(last))];
}

const activeShifts = () => state.shifts.filter((s) => s.active && s.beds > 0);
const entriesOn = (date, shift) => state.entries.filter((e) => e.schedule_date === date && e.shift === shift)
  .sort((a, b) => (a.bed_no ?? 99) - (b.bed_no ?? 99));
const shortName = (e) => `${e.prefix || ''}${e.first_name} ${e.last_name}`;

// ---------------------------------------------------------------------------
// โหลดและวาดตาราง
// ---------------------------------------------------------------------------
async function load() {
  const [from, to] = range();
  [state.shifts, state.entries] = await Promise.all([api('/shifts'), api(`/schedule?from=${from}&to=${to}`)]);
  render();
}

function render() {
  for (const b of document.querySelectorAll('#view-schedule [data-mode]')) {
    b.classList.toggle('on', b.dataset.mode === state.mode);
    b.setAttribute('aria-pressed', b.dataset.mode === state.mode);
  }
  const [from, to] = range();
  $('s-range').textContent = state.mode === 'day' ? dayFull(from, 'long')
    : state.mode === 'week' ? `${fmtDate(from)} – ${fmtDate(to)}`
      : monthLabel(state.anchor);
  if (!activeShifts().length) {
    $('s-board').innerHTML = '<p class="msg">ยังไม่ได้เปิดรอบฟอก กด "ตั้งค่ารอบ" เพื่อเปิดรอบและกำหนดจำนวนเตียง</p>';
    return;
  }
  $('s-board').innerHTML = state.mode === 'day' ? renderDay(from) : state.mode === 'week' ? renderWeek(from) : renderMonth(from, to);
}

function renderDay(date) {
  return `<div class="day-grid">${activeShifts().map((s) => {
    const list = entriesOn(date, s.shift);
    const slots = Array.from({ length: s.beds }, (_, i) => {
      const e = list.find((x) => x.bed_no === i + 1);
      return e
        ? `<button type="button" class="slot" data-entry="${e.id}"><span class="bedno">${i + 1}</span><span class="name">${e.assessed ? '<span title="ซักประวัติแล้ว">🩺</span> ' : ''}${esc(shortName(e))}</span><span class="hn">${esc(e.hn)}</span></button>`
        : date < today()
          ? `<div class="slot empty"><span class="bedno">${i + 1}</span>ว่าง</div>`
          : `<button type="button" class="slot empty" data-add="${date}|${s.shift}|${i + 1}"><span class="bedno">${i + 1}</span>ว่าง กดเพื่อนัด</button>`;
    }).join('');
    return `<div class="shift-col"><h4>รอบ ${s.shift}${s.start_time ? ` · ${s.start_time.slice(0, 5)} น.` : ''}<span>${list.length}/${s.beds} คน</span></h4>${slots}</div>`;
  }).join('')}</div>`;
}

function renderWeek(from) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const t = today();
  return `<div class="table-scroll"><table class="week">
    <thead><tr><th style="width:80px">รอบ</th>${days.map((d) => `<th class="${d === t ? 'today' : ''}">${dayLabel(d)}</th>`).join('')}</tr></thead>
    <tbody>${activeShifts().map((s) => `<tr><th>รอบ ${s.shift}${s.start_time ? `<br><span class="msg">${s.start_time.slice(0, 5)} น.</span>` : ''}</th>
      ${days.map((d) => {
        const list = entriesOn(d, s.shift);
        return `<td><div class="count"><span>${list.length}/${s.beds}</span>${list.length < s.beds && d >= t
          ? `<button type="button" class="ghost add-mini" data-add="${d}|${s.shift}|" aria-label="นัดรอบ ${s.shift} วันที่ ${fmtDate(d)}">+</button>` : ''}</div>
          ${list.map((e) => `<button type="button" class="chip" data-entry="${e.id}" title="${esc(`${shortName(e)} · HN ${e.hn}${e.assessed ? ' · ซักประวัติแล้ว' : ''}`)}">${e.bed_no ? `${e.bed_no} · ` : ''}${e.assessed ? '🩺 ' : ''}${esc(shortName(e))}</button>`).join('')}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderMonth(from, to) {
  const month = state.anchor.slice(0, 7);
  const t = today();
  const weeks = [];
  for (let d = from; d <= to; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return `<div class="table-scroll"><table class="month">
    <thead><tr>${WEEKDAYS.map((w) => `<th>${w}</th>`).join('')}</tr></thead>
    <tbody>${weeks.map((w) => `<tr>${w.map((d) => `<td class="${d.slice(0, 7) !== month ? 'out' : ''} ${d === t ? 'today' : ''}">
      <button type="button" class="daybtn" data-day="${d}" aria-label="ดูวันที่ ${fmtDate(d)}">
        <span class="daynum">${parse(d).getDate()}</span>
        ${activeShifts().map((s) => { const n = entriesOn(d, s.shift).length; return `<span class="bar ${n >= s.beds ? 'full' : n ? '' : 'zero'}"><span>รอบ ${s.shift}</span><span>${n}/${s.beds}</span></span>`; }).join('')}
      </button></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// ตั้งค่ารอบ
// ---------------------------------------------------------------------------
const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']; // ตรงกับ WEEKDAYS

// การ์ดต่อรอบ: สถานะ เวลา จำนวนเตียง ผู้ป่วยประจำแยกวัน นัดวันนี้ และรายชื่อผู้ป่วยประจำ
function renderSettings() {
  $('s-shift-rows').innerHTML = state.shifts.map((s) => `
    <div class="shift-card" data-shift="${s.shift}">
      <div class="sc-head">
        <label class="sc-title"><input type="checkbox" id="s-on-${s.shift}" ${s.active ? 'checked' : ''}> รอบ ${s.shift}</label>
        <span class="sc-badge" id="s-badge-${s.shift}"></span>
      </div>
      <div class="sc-saved">ค่าที่บันทึกไว้: <b>${savedLabel(s)}</b>${s.updated_at ? `<span class="msg"> · บันทึกล่าสุด ${fmtTime(s.updated_at)}</span>` : ''}</div>
      <div class="sc-inputs">
        <label>เวลาเริ่ม <input id="s-time-${s.shift}" type="time" value="${(s.start_time || '').slice(0, 5)}"></label>
        <label>รับผู้ป่วย <input id="s-beds-${s.shift}" type="number" min="0" max="30" value="${s.beds}"> เตียง</label>
      </div>
      <div class="sc-stats" id="s-stats-${s.shift}"></div>
      <button type="button" class="link" data-act="list" ${s.regular_patients ? '' : 'disabled'}>ดูรายชื่อผู้ป่วยประจำ (${s.regular_patients ?? 0} ราย)</button>
      <div class="sc-list" id="s-list-${s.shift}" hidden></div>
    </div>`).join('');
  for (const s of state.shifts) renderShiftStats(s.shift);
}

const savedLabel = (s) => (s.active && s.beds > 0
  ? `เปิด · เริ่ม ${(s.start_time || '').slice(0, 5) || '-'} น. · ${s.beds} เตียง`
  : 'ปิด');

// สรุปของรอบตามค่าที่กรอกอยู่ ถ้าแก้แล้วยังไม่บันทึก จะขึ้นป้าย "ยังไม่บันทึก"
function renderShiftStats(shift) {
  const s = state.shifts.find((x) => x.shift === shift);
  const on = $(`s-on-${shift}`).checked;
  const beds = Math.max(0, Math.min(30, Number($(`s-beds-${shift}`).value) || 0));
  const open = on && beds > 0;
  const dirty = on !== s.active || beds !== s.beds || $(`s-time-${shift}`).value !== (s.start_time || '').slice(0, 5);
  const badge = $(`s-badge-${shift}`);
  badge.textContent = dirty ? 'ยังไม่บันทึก' : open ? 'เปิด' : 'ปิด';
  badge.className = 'sc-badge ' + (dirty ? 'dirty' : open ? 'on' : 'off');
  const card = $(`s-on-${shift}`).closest('.shift-card');
  card.classList.toggle('closed', !open);
  card.classList.toggle('dirty', dirty);
  const byDay = s.regular_by_day || {};
  const over = DAY_KEYS.filter((d) => (byDay[d] || 0) > beds);
  const booked = s.booked_today ?? 0;
  const warn = [];
  if (!open && s.regular_patients) warn.push(`รอบนี้ปิดอยู่ แต่ยังมีผู้ป่วยประจำ ${s.regular_patients} ราย ควรย้ายไปรอบอื่น`);
  if (open && over.length) warn.push(`ผู้ป่วยประจำเกินจำนวนเตียงในวัน ${over.map((d) => WEEKDAYS[DAY_KEYS.indexOf(d)]).join(' ')}`);
  if (open && booked > beds) warn.push(`วันนี้นัดไว้ ${booked} ราย มากกว่าจำนวนเตียง`);
  $(`s-stats-${shift}`).innerHTML = `
    <div class="sc-line">${open ? `เริ่ม ${$(`s-time-${shift}`).value || '-'} น. · ${beds} เตียง` : 'ไม่เปิดรอบนี้'}</div>
    <div class="sc-line">ผู้ป่วยประจำ <b>${s.regular_patients ?? 0}</b> ราย${open ? ` · วันนี้นัดแล้ว <b>${booked}/${beds}</b> เตียง (ว่าง ${Math.max(0, beds - booked)})` : ''}</div>
    <div class="sc-days" aria-label="ผู้ป่วยประจำแยกตามวัน">${DAY_KEYS.map((d, i) => {
      const n = byDay[d] || 0;
      const cls = !open ? 'zero' : n > beds ? 'over' : n === beds ? 'full' : n ? '' : 'zero';
      return `<span class="sc-day ${cls}"><span>${WEEKDAYS[i]}</span><b>${n}${open ? `/${beds}` : ''}</b></span>`;
    }).join('')}</div>
    ${warn.map((w) => `<div class="sc-warn">${esc(w)}</div>`).join('')}`;
}

$('s-shift-rows').addEventListener('input', (e) => {
  const card = e.target.closest('.shift-card');
  if (card) renderShiftStats(Number(card.dataset.shift));
});
$('s-shift-rows').addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-patient]');
  if (row) return document.dispatchEvent(new CustomEvent('open-patient', { detail: row.dataset.patient }));
  if (e.target.dataset.act !== 'list') return;
  const shift = Number(e.target.closest('.shift-card').dataset.shift);
  const box = $(`s-list-${shift}`);
  box.hidden = !box.hidden;
  if (box.hidden) return;
  const people = await api(`/patients?regular_shift=${shift}&limit=500`);
  box.innerHTML = `<table><thead><tr><th>HN</th><th>ชื่อ</th><th>วันที่มาฟอก</th></tr></thead><tbody>${people.map((p) => `
    <tr class="clickable" data-patient="${p.id}"><td>${esc(p.hn)}</td><td>${esc(`${p.prefix || ''}${p.first_name} ${p.last_name}`)}</td>
    <td>${DAY_KEYS.filter((d) => (p.regular_days || []).includes(d)).map((d) => WEEKDAYS[DAY_KEYS.indexOf(d)]).join(' ')}</td></tr>`).join('')}</tbody></table>`;
});

// หน้าผู้ป่วยทั้งหมดขอเปิดการตั้งค่ารอบ
document.addEventListener('open-shift-settings', async () => {
  if (!state.shifts.length) state.shifts = await api('/shifts');
  $('s-settings').hidden = false;
  renderSettings();
  $('s-settings').scrollIntoView({ behavior: 'smooth' });
});
$('s-settings-toggle').addEventListener('click', () => {
  $('s-settings').hidden = !$('s-settings').hidden;
  if (!$('s-settings').hidden) renderSettings();
});
$('s-settings-save').addEventListener('click', async () => {
  if (needUser('s-settings-msg')) return;
  const body = state.shifts.map((s) => ({
    shift: s.shift,
    active: $(`s-on-${s.shift}`).checked,
    beds: Math.max(0, Math.min(30, Number($(`s-beds-${s.shift}`).value) || 0)),
    start_time: $(`s-time-${s.shift}`).value || null,
  }));
  try {
    await api('/shifts', { method: 'PUT', body: JSON.stringify(body) }, NO_REASON);
      await load();
    renderSettings();
    $('s-settings-msg').textContent = 'บันทึกแล้ว ค่าที่แสดงคือค่าที่บันทึกไว้ หน้าผู้ป่วยทั้งหมดและผังเตียงใช้ค่านี้ด้วย';
    document.dispatchEvent(new CustomEvent('shifts-changed'));
  } catch (err) {
    $('s-settings-msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
  }
});

// ---------------------------------------------------------------------------
// ฟอร์มนัดผู้ป่วย
// ---------------------------------------------------------------------------
const DAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

function choose(p) {
  state.chosen = p;
  // ใช้รอบฟอกประจำของผู้ป่วยเป็นค่าตั้งต้น
  if (p?.regular_shift && [...$('s-shift').options].some((o) => o.value === String(p.regular_shift))) $('s-shift').value = String(p.regular_shift);
  if (p?.regular_days?.length && $('s-repeat').value === 'none' && !state.slotPicked) {
    $('s-repeat').value = 'weekly';
    $('s-repeat-box').hidden = false;
    for (const box of $('s-weekdays').querySelectorAll('input')) box.checked = p.regular_days.some((d) => DAY_INDEX[d] === Number(box.value));
    if (!$('s-until').value) $('s-until').value = addDays($('s-date').value, 27);
  }
  $('s-patient-results').innerHTML = '';
  $('s-patient-q').value = '';
  $('s-patient-chosen').innerHTML = p
    ? `<div class="chosen"><b>${esc(`${p.prefix || ''}${p.first_name} ${p.last_name}`)}</b><span>HN ${esc(p.hn)}</span>${p.regular_shift ? `<span>รอบประจำ ${p.regular_shift}</span>` : ''}
        <button type="button" class="ghost add-mini" id="s-unchoose">เปลี่ยน</button></div>` : '';
}

function openForm(date, shift, bed) {
  state.slotPicked = Boolean(shift); // กดจากช่องในตาราง: ใช้วันและรอบนั้น ไม่ตั้งนัดซ้ำให้อัตโนมัติ
  $('s-form').hidden = false;
  $('s-conflicts').innerHTML = '';
  $('s-msg').textContent = '';
  $('s-shift').innerHTML = activeShifts().map((s) => `<option value="${s.shift}">รอบ ${s.shift}${s.start_time ? ` (${s.start_time.slice(0, 5)} น.)` : ''}</option>`).join('');
  $('s-date').value = date || (state.anchor < today() ? today() : state.anchor);
  $('s-date').min = today();
  if (shift) $('s-shift').value = shift;
  $('s-bed').value = bed || '';
  $('s-repeat').value = 'none';
  $('s-repeat-box').hidden = true;
  $('s-weekdays').innerHTML = WEEKDAYS.map((w, i) => `<label class="check"><input type="checkbox" value="${i}">${w}</label>`).join('');
  $('s-until').value = '';
  choose(null);
  $('s-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('s-patient-q').focus({ preventScroll: true });
}

function datesToBook() {
  const start = $('s-date').value;
  if ($('s-repeat').value === 'none') return [start];
  const days = [...$('s-weekdays').querySelectorAll('input:checked')].map((x) => Number(x.value));
  const until = $('s-until').value;
  if (!days.length || !until || until < start) return [];
  const out = [];
  for (let d = start; d <= until && out.length < 400; d = addDays(d, 1)) if (days.includes(weekday(d))) out.push(d);
  return out;
}

let searchTimer;
$('s-patient-q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $('s-patient-q').value.trim();
    if (!q) { $('s-patient-results').innerHTML = ''; return; }
    const { rows } = await apiList(`/patients?limit=8&q=${encodeURIComponent(q)}`);
    $('s-patient-results').innerHTML = rows.map((p) => `<button type="button" data-pick="${p.id}">
      ${esc(p.hn)} · ${esc(`${p.prefix || ''}${p.first_name} ${p.last_name}`)}</button>`).join('') || '<span class="msg">ไม่พบผู้ป่วย</span>';
    state.picks = rows;
  }, 200);
});
$('s-patient-results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (b) choose(state.picks.find((p) => p.id === b.dataset.pick));
});
$('s-patient-chosen').addEventListener('click', (e) => { if (e.target.id === 's-unchoose') { choose(null); $('s-patient-q').focus(); } });
$('s-repeat').addEventListener('change', () => {
  const weekly = $('s-repeat').value === 'weekly';
  $('s-repeat-box').hidden = !weekly;
  if (weekly) {
    const box = $('s-weekdays').querySelector(`input[value="${weekday($('s-date').value)}"]`);
    if (box) box.checked = true;
    if (!$('s-until').value) $('s-until').value = addDays($('s-date').value, 27);
  }
});
$('s-cancel').addEventListener('click', () => { $('s-form').hidden = true; });
$('s-add').addEventListener('click', () => openForm(null, null, null));

$('s-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('s-conflicts').innerHTML = '';
  if (needUser('s-msg')) return;
  if (!state.chosen) { $('s-msg').textContent = 'กรุณาเลือกผู้ป่วย'; return; }
  const dates = datesToBook();
  if (!dates.length) { $('s-msg').textContent = 'กรุณาเลือกวันในสัปดาห์และวันที่สิ้นสุด'; return; }
  try {
    const rows = await api('/schedule', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: state.chosen.id, shift: Number($('s-shift').value), bed_no: $('s-bed').value ? Number($('s-bed').value) : null,
        dates, note: $('s-note').value.trim() || null,
      }),
    }, NO_REASON);
    $('s-form').hidden = true;
    $('s-note').value = '';
    await load();
    $('s-range').textContent += ` · นัดแล้ว ${rows.length} วัน`;
  } catch (err) {
    $('s-msg').textContent = err.message;
    $('s-conflicts').innerHTML = (err.body?.conflicts || []).map((c) => `<li>${esc(dayFull(c.date))}: ${esc(c.problem)}</li>`).join('');
  }
});

// ---------------------------------------------------------------------------
// จัดนัดให้: ระบบเสนอนัดตามรอบและวันประจำ (public/autoPlan.js) พยาบาลตรวจแล้วบันทึกครั้งเดียว
// ---------------------------------------------------------------------------
const auto = { items: [] };

$('s-auto').addEventListener('click', () => {
  $('s-auto-panel').hidden = !$('s-auto-panel').hidden;
  if ($('s-auto-panel').hidden) return;
  // ค่าเริ่มต้น: สัปดาห์ถัดไป (จันทร์ถึงอาทิตย์)
  const monday = addDays(today(), 7 - weekday(today()));
  $('s-auto-from').value = monday;
  $('s-auto-to').value = addDays(monday, 6);
  $('s-auto-result').hidden = true;
  $('s-auto-msg').textContent = '';
});
$('s-auto-close').addEventListener('click', () => { $('s-auto-panel').hidden = true; });

function renderAuto(plan) {
  auto.items = plan.items;
  const usual = plan.items.filter((i) => i.usual).length;
  $('s-auto-summary').textContent = plan.items.length
    ? `เสนอนัด ${plan.items.length} รายการ (ได้เตียงเดิม ${usual})${plan.already ? ` · มีนัดอยู่แล้ว ${plan.already} รายการ` : ''}${plan.problems.length ? ` · จัดไม่ได้ ${plan.problems.length} รายการ` : ''}`
    : `ไม่มีนัดที่ต้องจัดเพิ่ม${plan.already ? ` (มีนัดอยู่แล้ว ${plan.already} รายการ)` : ''}`;
  $('s-auto-problems').innerHTML = plan.problems.map((p) =>
    `<li><small>${esc(dayFull(p.date))} รอบ ${p.shift}</small>${esc(`HN ${p.hn} ${p.name}: ${p.problem}`)}</li>`).join('');
  $('s-auto-rows').innerHTML = plan.items.map((i, k) => `<tr>
    <td><input type="checkbox" data-k="${k}" checked aria-label="เลือก"></td>
    <td>${esc(dayFull(i.date))}</td><td>${i.shift}</td><td>${i.bed_no}${i.usual ? ' <span class="badge">เตียงเดิม</span>' : ''}</td>
    <td>${esc(i.hn)}</td><td>${esc(i.name)}</td></tr>`).join('') || '<tr><td colspan="6">ไม่มีรายการ</td></tr>';
  $('s-auto-all').checked = true;
  $('s-auto-save').disabled = !plan.items.length;
  $('s-auto-save').textContent = `บันทึกนัดที่เลือก (${plan.items.length})`;
  $('s-auto-save-msg').textContent = '';
  $('s-auto-result').hidden = false;
}

const pickedAuto = () => [...$('s-auto-rows').querySelectorAll('input[data-k]:checked')].map((el) => auto.items[Number(el.dataset.k)]);
$('s-auto-rows').addEventListener('change', () => { $('s-auto-save').textContent = `บันทึกนัดที่เลือก (${pickedAuto().length})`; });
$('s-auto-all').addEventListener('change', () => {
  for (const el of $('s-auto-rows').querySelectorAll('input[data-k]')) el.checked = $('s-auto-all').checked;
  $('s-auto-save').textContent = `บันทึกนัดที่เลือก (${pickedAuto().length})`;
});

$('s-auto-run').addEventListener('click', async () => {
  const from = $('s-auto-from').value, to = $('s-auto-to').value;
  if (!from || !to) { $('s-auto-msg').textContent = 'กรุณาเลือกช่วงวันที่'; return; }
  if (to < today()) { $('s-auto-msg').textContent = 'นัดล่วงหน้าได้ตั้งแต่วันนี้เป็นต้นไป'; return; }
  $('s-auto-msg').textContent = 'กำลังจัดนัด…';
  try {
    renderAuto(await api(`/schedule/auto-plan?from=${from}&to=${to}`));
    $('s-auto-msg').textContent = from < today() ? 'วันที่ผ่านมาแล้วไม่ได้จัดให้' : '';
  } catch (err) {
    $('s-auto-msg').textContent = 'จัดนัดไม่สำเร็จ: ' + err.message;
  }
});

$('s-auto-save').addEventListener('click', async () => {
  if (needUser('s-auto-save-msg')) return;
  const items = pickedAuto().map(({ patient_id, date, shift, bed_no }) => ({ patient_id, date, shift, bed_no }));
  if (!items.length) { $('s-auto-save-msg').textContent = 'ยังไม่ได้เลือกนัด'; return; }
  $('s-auto-save').disabled = true;
  $('s-auto-save-msg').textContent = 'กำลังบันทึก…';
  try {
    const r = await api('/schedule/auto-book', { method: 'POST', body: JSON.stringify({ items }) }, NO_REASON);
    state.anchor = $('s-auto-from').value;
    await load();
    renderAuto(await api(`/schedule/auto-plan?from=${$('s-auto-from').value}&to=${$('s-auto-to').value}`));
    $('s-auto-save-msg').textContent = `บันทึกนัดแล้ว ${r.created} รายการ`;
  } catch (err) {
    const list = (err.body?.conflicts || []).slice(0, 5).map((c) => `${fmtDate(c.date)} HN ${c.hn || ''}: ${c.problem}`).join(' · ');
    $('s-auto-save-msg').textContent = `บันทึกไม่สำเร็จ: ${err.message}${list ? ` (${list})` : ''}`;
  } finally {
    $('s-auto-save').disabled = !auto.items.length;
  }
});

// ---------------------------------------------------------------------------
// ดูข้อมูลผู้ป่วย
// ---------------------------------------------------------------------------
function optionLabel(field, value) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return '-';
  if (field.type === 'checklist') return CHECKLISTS[field.name].filter(([k]) => value.includes(k)).map(([, l]) => l).join(' ');
  if (field.type === 'select' && typeof value === 'number') value = String(value);
  if (field.type === 'select') return (field.options.find(([k]) => k === value) || [value, value])[1];
  if (field.type === 'date') return fmtDate(value);
  return value;
}

async function openPd(patientId, entry) {
  const t = today();
  const [p, upcoming, recent, files] = await Promise.all([
    api('/patients/' + patientId),
    api(`/schedule?patient_id=${patientId}&from=${t}`),
    api(`/sessions?patient_id=${patientId}&limit=5`),
    api(`/patients/${patientId}/files`),
  ]);
  state.pd = { patient: p, entry };
  $('pd').hidden = false;
  $('pa').hidden = true;
  $('pd-title').textContent = `${p.prefix || ''}${p.first_name} ${p.last_name} · HN ${p.hn}`;
  $('pd-photo').textContent = (p.first_name || '?').slice(0, 1);
  if (p.photo_file_id) {
    blobUrl(`/patients/${p.id}/files/${p.photo_file_id}`).then((url) => { $('pd-photo').innerHTML = `<img src="${url}" alt="รูปผู้ป่วย">`; }).catch(() => {});
  }
  $('pd-facts').innerHTML = [
    ...PATIENT_FIELDS.map((f) => [f.label, optionLabel(f, p[f.name])]),
    ['อายุ', p.birth_date ? `${age(p.birth_date, t)} ปี` : '-'],
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('pd-entry').innerHTML = entry ? `<div class="chosen">
      <b>นัด ${esc(dayFull(entry.schedule_date, 'long'))}</b>
      <span>รอบ ${entry.shift}${entry.bed_no ? ` · เตียง ${entry.bed_no}` : ''}</span>${entry.note ? `<span>${esc(entry.note)}</span>` : ''}
      <button type="button" class="ghost danger add-mini" id="pd-cancel-entry">ยกเลิกนัดนี้</button><span class="msg" id="pd-msg"></span></div>` : '';
  $('pd-upcoming').innerHTML = upcoming.slice(0, 10).map((e) => `<li><span>${esc(dayFull(e.schedule_date))}</span><span>รอบ ${e.shift}${e.bed_no ? ` · เตียง ${e.bed_no}` : ''}</span></li>`).join('') || '<li>ไม่มีนัด</li>';
  $('pd-recent').innerHTML = recent.map((s) => `<li><span>${esc(fmtDate(s.session_date))}</span><span>${s.total_uf_ml != null ? `UF ${s.total_uf_ml} ml` : esc(s.status)}</span></li>`).join('') || '<li>ยังไม่เคยฟอก</li>';
  $('pd-files').innerHTML = files.filter((f) => f.kind === 'DOCUMENT').map((f) => `<li><span>${esc(f.file_name)}</span><span>${f.mime_type === 'application/pdf' ? 'PDF' : 'JPG'}</span></li>`).join('') || '<li>ไม่มีไฟล์</li>';
  // เลือกผู้ป่วยจากนัดแล้ว ฟอร์มซักประวัติเปิดรอเลย พร้อมพิมพ์ Pre weight
  if (entry) await openAssessment().catch((err) => { $('pd-msg').textContent = err.message; });
  else $('pd').scrollIntoView({ behavior: 'smooth' });
}

$('pd').addEventListener('click', async (e) => {
  if (e.target.id !== 'pd-cancel-entry') return;
  if (needUser('pd-msg')) return;
  if (e.target.dataset.confirm !== 'yes') { e.target.dataset.confirm = 'yes'; e.target.textContent = 'ยืนยันยกเลิกนัด'; return; }
  try {
    await api('/schedule/' + state.pd.entry.id, { method: 'DELETE' }, NO_REASON);
    await load();
    await openPd(state.pd.patient.id, null);
  } catch (err) {
    $('pd-msg').textContent = err.message;
  }
});
// ---------------------------------------------------------------------------
// ซักประวัติเบื้องต้นของนัด: เก็บลงแบบฟอร์ม 519 ของนัดนี้ (ค่าเดียวกับ Hemodialysis sheet)
// ---------------------------------------------------------------------------
async function openAssessment() {
  const entry = state.pd.entry;
  const a = await api(`/schedule/${entry.id}/assessment`);
  state.pd.sessionId = a.session_id;
  $('pa-fields').innerHTML = ASSESSMENT_SECTIONS.map((s) => `
    <fieldset><legend>${esc(s.title)}</legend>${s.fields.map((f) => renderField(f, a.values)).join('')}</fieldset>`).join('');
  $('pa-state').textContent = a.session_id ? 'ซักประวัติแล้ว แก้ไขได้' : `ยังไม่ได้ซักประวัติ · ${dayFull(entry.schedule_date)} รอบ ${entry.shift}${entry.bed_no ? ` เตียง ${entry.bed_no}` : ''}`;
  $('pa-sheet').hidden = !a.session_id;
  $('pa-msg').textContent = '';
  $('pa-reason').value = '';
  // ช่องน้ำหนักพิมพ์ตัวเลขจากคีย์บอร์ดได้เลย (ไม่มีปุ่มเพิ่ม-ลด) Enter ไปช่องถัดไป ช่องสุดท้ายกด Enter เพื่อบันทึก
  for (const input of weightInputs()) {
    Object.assign(input, { type: 'text', inputMode: 'decimal', autocomplete: 'off', spellcheck: false });
    input.setAttribute('enterkeyhint', 'next');
  }
  weightInputs().at(-1).setAttribute('enterkeyhint', 'done');
  stopMic();
  $('pa-voice-text').value = '';
  voiceMsg(VOICE_HINT);
  scaleMsg(SCALE_HINT);
  $('pa-scale').hidden = !(await scaleReaderOn());
  $('pa').hidden = false;
  $('pa').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('pa').elements.pre_weight_kg.focus({ preventScroll: true });
  $('pa').elements.pre_weight_kg.select();
}

const weightInputs = () => [...$('pa').querySelectorAll('input')].filter((el) => ASSESSMENT_FIELDS.some((f) => f.type === 'number' && f.name === el.name));
const toKg = (v) => (v.trim() === '' ? null : Number(v.trim().replace(',', '.')));

$('pa').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const list = weightInputs();
  const i = list.indexOf(e.target);
  if (i < 0) return;
  e.preventDefault();
  if (i < list.length - 1) { list[i + 1].focus(); list[i + 1].select(); } else $('pa').requestSubmit();
});

// Weight gain = Pre weight − Last BW (คำนวณให้เมื่อกรอกน้ำหนัก แก้เองได้)
$('pa').addEventListener('input', (e) => {
  if (!['pre_weight_kg', 'last_bw_kg'].includes(e.target.name)) return;
  const f = $('pa');
  const pre = toKg(f.elements.pre_weight_kg.value) ?? NaN;
  const last = toKg(f.elements.last_bw_kg.value) ?? NaN;
  if (Number.isFinite(pre) && Number.isFinite(last)) f.elements.weight_gain_kg.value = (pre - last).toFixed(1);
});

// ถ่ายรูปตาชั่ง: ระบบอ่านน้ำหนักสองรอบ เติม Pre weight เฉพาะเมื่อตรงกัน (ช่องสีฟ้า) พยาบาลตรวจกับตาชั่งก่อนกดบันทึก ภาพไม่ถูกเก็บ
const SCALE_HINT = $('pa-scale-msg').textContent;
let scaleReader = null;
const scaleReaderOn = async () => (scaleReader ??= fetch('/api/health').then((r) => r.json()).then((h) => Boolean(h.scale_reader)).catch(() => false));
const scaleMsg = (text, warn = false) => { $('pa-scale-msg').textContent = text; $('pa-scale-msg').classList.toggle('warn', warn); };

async function scaleJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return new File([blob], 'scale.jpg', { type: 'image/jpeg' });
}

$('pa-scale-btn').addEventListener('click', () => { if (!needUser('pa-msg')) $('pa-scale-file').click(); });
$('pa-scale-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const input = $('pa').elements.pre_weight_kg;
  $('pa-scale-btn').disabled = true;
  scaleMsg('กำลังอ่านน้ำหนักจากรูป (อ่านสองรอบเพื่อตรวจซ้ำ)...');
  try {
    if (!file.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์ภาพ');
    const image = await scaleJpeg(file).catch(() => { throw new Error('เปิดภาพนี้ไม่ได้ กรุณาถ่ายใหม่'); });
    const { weight_kg, warnings, notes } = await apiUpload('/scale/read', image);
    const extra = [...warnings, ...(notes ? [notes] : [])].join(' · ');
    if (weight_kg == null) {
      scaleMsg(extra || 'อ่านน้ำหนักไม่ได้ กรุณาพิมพ์เอง', true);
    } else {
      input.value = weight_kg.toFixed(1);
      input.classList.add('from-photo');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      scaleMsg(`อ่านได้ ${weight_kg.toFixed(1)} kg ช่องสีฟ้าคือค่าจากรูป กรุณาตรวจกับตาชั่งก่อนกดบันทึก${extra ? ' · ' + extra : ''}`, Boolean(warnings.length));
    }
  } catch (err) {
    scaleMsg('อ่านน้ำหนักไม่สำเร็จ: ' + err.message + ' กรุณาพิมพ์เอง', true);
  } finally {
    $('pa-scale-btn').disabled = false;
    input.focus();
    input.select();
  }
});
// พยาบาลแก้ค่าเองแล้ว ไม่ใช่ค่าจากรูปอีกต่อไป
$('pa').addEventListener('input', (e) => { if (e.isTrusted && e.target.name === 'pre_weight_kg') e.target.classList.remove('from-photo'); });

// พูดแทนพิมพ์ (speech.js) แล้วแปลเป็นอาการและน้ำหนักในเครื่อง (voiceNote.js) หรือพิมพ์เองแล้วกด "ใส่ลงฟอร์ม"
const VOICE_HINT = $('pa-voice-msg').textContent;
const voiceMsg = (text, warn = false) => { $('pa-voice-msg').textContent = text; $('pa-voice-msg').classList.toggle('warn', warn); };
if (!speechSupported()) $('pa-mic').hidden = true;
function stopMic() { stopDictation($('pa-mic')); }
$('pa-mic').addEventListener('click', () => toggleDictation({ button: $('pa-mic'), box: $('pa-voice-text'), say: voiceMsg, onDone: applyVoice }));

function applyVoice() {
  const text = $('pa-voice-text').value.trim();
  if (!text) { voiceMsg('ยังไม่มีข้อความ กรุณาพูดหรือพิมพ์ก่อน', true); return; }
  const f = $('pa');
  const { yes, no, weights, note } = parseSpoken(text);
  f.querySelectorAll('label.from-voice, label.voice-off').forEach((el) => el.classList.remove('from-voice', 'voice-off'));
  const box = (key) => f.querySelector(`[name=pre_symptoms][value="${key}"]`);
  const label = (key) => CHECKLISTS.pre_symptoms.find(([k]) => k === key)?.[1] || key;
  const ticked = [];
  const unticked = [];
  for (const key of yes) { const el = box(key); if (!el) continue; el.checked = true; el.closest('label')?.classList.add('from-voice'); ticked.push(label(key)); }
  for (const key of no) { const el = box(key); if (!el?.checked) continue; el.checked = false; el.closest('label')?.classList.add('voice-off'); unticked.push(label(key)); }
  const filled = [];
  for (const [name, kg] of Object.entries(weights)) {
    const input = f.elements[name];
    if (!input) continue;
    input.value = kg.toFixed(1);
    input.classList.add('from-photo');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    filled.push(`${ASSESSMENT_FIELDS.find((x) => x.name === name)?.label || name} ${kg.toFixed(1)}`);
  }
  if (note) {
    const n = f.elements.pre_nurse_note;
    if (!n.value.includes(note)) n.value = [n.value.trim(), note].filter(Boolean).join('\n');
  }
  const parts = [
    ticked.length && `ติ๊ก ${ticked.join(', ')}`,
    unticked.length && `เอาออก ${unticked.join(', ')}`,
    filled.length && filled.join(', '),
    note && 'ใส่ข้อความใน Nurse note แล้ว',
  ].filter(Boolean);
  voiceMsg(parts.length ? `${parts.join(' · ')} กรุณาตรวจช่องสีฟ้าก่อนกดบันทึก` : 'ไม่พบอาการหรือน้ำหนักในข้อความ', !parts.length);
  $('pa-voice-text').value = '';
}
$('pa-voice-apply').addEventListener('click', applyVoice);
$('pa-voice-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); applyVoice(); } });
$('pa').addEventListener('change', (e) => { if (e.target.name === 'pre_symptoms') e.target.closest('label')?.classList.remove('from-voice', 'voice-off'); });

$('pa').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (needUser('pa-msg')) return;
  const data = Object.fromEntries(ASSESSMENT_FIELDS.map((f) => [f.name, f.type === 'number' ? toKg($('pa').elements[f.name].value) : readField($('pa'), f)]));
  const bad = ASSESSMENT_FIELDS.find((f) => f.type === 'number' && Number.isNaN(data[f.name]));
  if (bad) { $('pa-msg').textContent = `${bad.label} ต้องเป็นตัวเลข เช่น 62.5`; $('pa').elements[bad.name].focus(); return; }
  if (data.pre_weight_kg === null) { $('pa-msg').textContent = 'กรุณากรอก Pre weight'; $('pa').elements.pre_weight_kg.focus(); return; }
  $('pa-save').disabled = true;
  try {
    const session = await api(`/schedule/${state.pd.entry.id}/assessment`, { method: 'PUT', body: JSON.stringify(data) }, 'pa-reason');
    state.pd.sessionId = session.id;
    state.pd.entry = { ...state.pd.entry, session_id: session.id, assessed: true };
    await load();
    $('pa-state').textContent = 'ซักประวัติแล้ว แก้ไขได้';
    $('pa-sheet').hidden = false;
    $('pa-reason').value = '';
    $('pa-msg').textContent = 'บันทึกแล้ว ค่าเหล่านี้แสดงใน Hemodialysis sheet ของนัดนี้';
  } catch (err) {
    $('pa-msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
  } finally {
    $('pa-save').disabled = false;
  }
});
$('pa-sheet').addEventListener('click', () => document.dispatchEvent(new CustomEvent('open-session', { detail: state.pd.sessionId })));

$('pd-close').addEventListener('click', () => { $('pd').hidden = true; });
$('pd-open').addEventListener('click', () => document.dispatchEvent(new CustomEvent('open-patient', { detail: state.pd.patient.id })));

// ---------------------------------------------------------------------------
// ปุ่มบนตาราง
// ---------------------------------------------------------------------------
$('s-board').addEventListener('click', (e) => {
  const entry = e.target.closest('[data-entry]');
  if (entry) return openPd(state.entries.find((x) => x.id === entry.dataset.entry).patient_id, state.entries.find((x) => x.id === entry.dataset.entry));
  const add = e.target.closest('[data-add]');
  if (add) { const [d, s, b] = add.dataset.add.split('|'); return openForm(d, s, b); }
  const day = e.target.closest('[data-day]');
  if (day) { state.mode = 'day'; state.anchor = day.dataset.day; load(); }
});
for (const b of document.querySelectorAll('#view-schedule [data-mode]')) {
  b.addEventListener('click', () => { state.mode = b.dataset.mode; load(); });
}
const step = (dir) => {
  if (state.mode === 'day') state.anchor = addDays(state.anchor, dir);
  else if (state.mode === 'week') state.anchor = addDays(state.anchor, 7 * dir);
  else { const d = parse(state.anchor); state.anchor = iso(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
  load();
};
$('s-prev').addEventListener('click', () => step(-1));
$('s-next').addEventListener('click', () => step(1));
$('s-today').addEventListener('click', () => { state.anchor = today(); load(); });

state.anchor = today();
document.addEventListener('view-change', (e) => { if (e.detail === 'schedule') load(); });
