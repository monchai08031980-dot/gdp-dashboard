// เมนูหลัก ปรึกษาแพทย์: รายการปรึกษาของทุกเตียง (รอคำสั่ง / ได้รับคำสั่งแล้ว) และการปรึกษาใหม่
// รวบรวมภาวะอันตรายจาก Hemodialysis sheet และเรียบเรียงรายงาน SBAR (consult.js) พยาบาลแก้แล้วบันทึก มี audit log
import { $, api, esc, fmtTime, fmtDate, needUser } from './common.js';
import { consultFindings, buildSbar, CONSULT_TOPICS, CONSULT_REQUESTS, URGENCY } from './consult.js';

const say = (t) => { $('cs-msg').textContent = t; };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const topicText = (k) => CONSULT_TOPICS.find(([x]) => x === k)?.[1] || k;
const fullName = (r) => `${r.prefix || ''}${r.first_name || ''} ${r.last_name || ''}`.trim();
let target = null; // { session, patient, vitals }
let edited = false;

$('cs-date').value = todayIso();

// ---------------------------------------------------------------------------
// รายการปรึกษา
// ---------------------------------------------------------------------------
async function loadList() {
  const date = $('cs-date').value;
  const status = $('cs-status').value;
  const [rows, open] = await Promise.all([
    api(`/consults?status=${status}${date ? `&date=${date}` : ''}`),
    api('/consults?status=open'),
  ]);
  $('cs-badge').hidden = !open.length;
  $('cs-badge').textContent = open.length;
  const elsewhere = open.filter((c) => c.session_date !== date).length;
  $('cs-open-all').textContent = elsewhere ? `มีการปรึกษาที่รอคำสั่งแพทย์ของวันอื่นอีก ${elsewhere} รายการ (เลือก "รอคำสั่งแพทย์" และล้างวันที่เพื่อดูทั้งหมด)` : '';
  $('cs-list').innerHTML = rows.length ? rows.map((c) => `
    <div class="cs-item ${c.answered_at ? '' : 'open'}" data-id="${c.id}" data-session="${c.session_id}">
      <div class="cs-head">
        <b class="urg-${c.urgency}">${esc(URGENCY[c.urgency])}</b>
        <b>${esc(fullName(c))}</b><span>HN ${esc(c.hn)}</span><span>${esc(fmtDate(c.session_date))} รอบ ${c.shift ?? '-'} เตียง ${c.bed_no ?? '-'}</span>
        <span>${fmtTime(c.created_at)} · ${esc(c.reported_by)}</span>
        <span>${c.answered_at ? '✅ ได้รับคำสั่งแล้ว' : '⏳ รอคำสั่งแพทย์'}</span>
      </div>
      <div>เรื่อง: ${esc(c.topics.map(topicText).join(', '))}</div>
      <details><summary>ดูรายงาน</summary><pre>${esc(c.report)}</pre></details>
      ${c.answered_at ? `<div class="answered"><b>คำสั่งแพทย์</b> (${esc(c.doctor_name)} · ${fmtTime(c.answered_at)})<pre>${esc(c.doctor_order)}</pre></div>` : `
      <div class="cs-order"><input name="doctor_name" placeholder="ชื่อแพทย์"><textarea name="doctor_order" rows="2" placeholder="คำสั่งแพทย์ที่ได้รับ"></textarea>
      <button type="button" class="ghost" data-act="order">บันทึกคำสั่งแพทย์</button></div>`}
      <div class="actions"><button type="button" class="ghost" data-act="sheet">เปิด Hemodialysis sheet</button><span class="msg"></span></div>
    </div>`).join('') : '<p class="cap-hint">ไม่มีการปรึกษาตามเงื่อนไขที่เลือก</p>';
}

$('cs-date').addEventListener('change', () => { loadList().catch((err) => say(err.message)); if (!$('cs').hidden && !target) fillSessions(); });
$('cs-status').addEventListener('change', () => loadList().catch((err) => say(err.message)));
$('cs-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const item = btn.closest('.cs-item');
  const msg = item.querySelector('.msg');
  if (btn.dataset.act === 'sheet') { document.dispatchEvent(new CustomEvent('open-session', { detail: item.dataset.session })); return; }
  if (needUser('cs-msg')) { msg.textContent = 'กรุณาเลือกผู้บันทึกก่อน'; return; }
  const body = { doctor_name: item.querySelector('[name=doctor_name]').value, doctor_order: item.querySelector('[name=doctor_order]').value };
  if (!body.doctor_name.trim() || !body.doctor_order.trim()) { msg.textContent = 'กรุณากรอกชื่อแพทย์และคำสั่งแพทย์'; return; }
  try {
    await api(`/sessions/${item.dataset.session}/consults/${item.dataset.id}`, { method: 'PATCH', body: JSON.stringify(body) }, 'cs-no-reason');
    await loadList();
  } catch (err) { msg.textContent = 'บันทึกไม่สำเร็จ: ' + err.message; }
});

// ---------------------------------------------------------------------------
// ปรึกษาใหม่: เลือกผู้ป่วยที่ฟอกวันที่เลือก หรือมาจากปุ่มใน Hemodialysis sheet
// ---------------------------------------------------------------------------
async function fillSessions(selectId = '') {
  const date = $('cs-date').value || todayIso();
  const sessions = await api(`/sessions?date=${date}&limit=200`);
  $('cs-session').innerHTML = `<option value="">— เลือกผู้ป่วย (${sessions.length} คน วันที่ ${esc(fmtDate(date))}) —</option>` + sessions
    .slice().sort((a, b) => (a.shift - b.shift) || (a.bed_no - b.bed_no))
    .map((s) => `<option value="${s.id}" ${s.id === selectId ? 'selected' : ''}>รอบ ${s.shift ?? '-'} เตียง ${s.bed_no ?? '-'} · ${esc(fullName(s))} · HN ${esc(s.hn)}</option>`).join('');
}

async function loadTarget(id, override = null) {
  const session = await api('/sessions/' + id);
  const patient = override?.patient || await api('/patients/' + session.patient_id);
  target = { session: { ...session, ...(override?.session || {}) }, patient, vitals: session.vitals };
  showForm();
}

const checks = (id, list, picked = [], cls = () => '') => {
  $(id).innerHTML = list.map(([k, l]) => `<label class="check ${cls(k)}"><input type="checkbox" value="${esc(k)}" ${picked.includes(k) ? 'checked' : ''}>${esc(l)}</label>`).join('');
};
const picked = (id) => [...$(id).querySelectorAll('input:checked')].map((el) => el.value);

function showForm() {
  const { session: s, patient: p, vitals } = target;
  const findings = consultFindings(s, vitals);
  $('cs-form').hidden = false;
  $('cs-patient').textContent = `${fullName(p)} · HN ${p.hn} · ${fmtDate(s.session_date)} รอบ ${s.shift ?? '-'} เตียง ${s.bed_no ?? '-'}`;
  const danger = findings.some((f) => f.level === 'danger');
  $('cs-urgency').innerHTML = Object.entries(URGENCY).map(([k, l]) => `<option value="${k}" ${k === (danger ? 'STAT' : 'URGENT') ? 'selected' : ''}>${l}</option>`).join('');
  checks('cs-findings', findings.map((f) => [f.key, `${f.level === 'danger' ? '⚠️ ' : ''}${f.text}`]), findings.filter((f) => f.level === 'danger').map((f) => f.key),
    (k) => (findings.find((f) => f.key === k)?.level === 'danger' ? 'danger' : ''));
  if (!findings.length) $('cs-findings').innerHTML = '<span class="cap-hint">ระบบไม่พบภาวะผิดปกติใน Hemodialysis sheet ใส่สิ่งที่พบจากการตรวจด้านล่างได้</span>';
  $('cs-findings').dataset.list = JSON.stringify(findings);
  checks('cs-topics', CONSULT_TOPICS, [...new Set(findings.filter((f) => f.level === 'danger' && f.topic).map((f) => f.topic))]);
  checks('cs-requests', CONSULT_REQUESTS, ['order']);
  for (const id of ['cs-extra', 'cs-other', 'cs-request-note']) $(id).value = '';
  $('cs-other').hidden = true;
  edited = false;
  makeReport();
  say('');
}

function pick() {
  const findings = JSON.parse($('cs-findings').dataset.list || '[]');
  const chosen = picked('cs-findings').map((k) => findings.find((f) => f.key === k)?.text).filter(Boolean);
  const extra = $('cs-extra').value.split('\n').map((t) => t.trim()).filter(Boolean);
  return {
    topics: picked('cs-topics'), other: $('cs-other').value.trim(), findings: [...chosen, ...extra],
    requests: picked('cs-requests'), request_note: $('cs-request-note').value.trim(), urgency: $('cs-urgency').value,
    reporter: $('user-role').selectedOptions?.[0]?.textContent?.trim() || '',
  };
}
const makeReport = () => { $('cs-report').value = buildSbar(target.session, target.vitals, target.patient, pick()); };

function openNew() {
  $('cs').hidden = false;
  $('cs').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('cs-new').addEventListener('click', async () => {
  target = null;
  $('cs-form').hidden = true;
  say('');
  openNew();
  await fillSessions();
  $('cs-session').focus();
});
$('cs-close').addEventListener('click', () => { $('cs').hidden = true; target = null; });
$('cs-session').addEventListener('change', async () => {
  if (!$('cs-session').value) { $('cs-form').hidden = true; target = null; return; }
  try { await loadTarget($('cs-session').value); } catch (err) { say(err.message); }
});

// เลือกหรือแก้ตัวเลือก รายงานสร้างใหม่ให้ ยกเว้นพยาบาลแก้ข้อความรายงานเองแล้ว
$('cs-form').addEventListener('input', (e) => {
  if (e.target.id === 'cs-report') { edited = true; return; }
  if (e.target.closest('#cs-topics')) $('cs-other').hidden = !picked('cs-topics').includes('other');
  if (!edited) makeReport();
  else say('แก้ข้อความรายงานเองแล้ว ตัวเลือกที่เปลี่ยนจะไม่ถูกใส่ให้ กด "สร้างรายงานใหม่จากแบบฟอร์ม" ถ้าต้องการ');
});
$('cs-reset').addEventListener('click', () => { edited = false; makeReport(); say(''); });
$('cs-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('cs-report').value); say('คัดลอกแล้ว นำไปวางในไลน์กลุ่มหรือระบบของโรงพยาบาลได้'); }
  catch { $('cs-report').select(); say('คัดลอกอัตโนมัติไม่ได้ เลือกข้อความไว้แล้ว กด Ctrl+C'); }
});
$('cs-print').addEventListener('click', () => {
  const w = window.open('', '_blank', 'width=700,height=800');
  if (!w) { say('เบราว์เซอร์บล็อกหน้าต่างพิมพ์'); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>รายงานแพทย์</title><body style="font-family:Sarabun,sans-serif;white-space:pre-wrap;font-size:16px;padding:24px">${esc($('cs-report').value)}</body>`);
  w.document.close();
  w.focus();
  w.print();
});
$('cs-save').addEventListener('click', async () => {
  if (!target || needUser('cs-msg')) return;
  const p = pick();
  if (!p.topics.length) { say('กรุณาเลือกเรื่องที่ปรึกษาอย่างน้อย 1 เรื่อง'); return; }
  if (p.topics.includes('other') && !p.other) { say('กรุณาระบุเรื่องอื่น ๆ'); $('cs-other').focus(); return; }
  $('cs-save').disabled = true;
  try {
    const id = target.session.id;
    await api(`/sessions/${id}/consults`, { method: 'POST', body: JSON.stringify({ ...p, report: $('cs-report').value }) }, 'cs-no-reason');
    document.dispatchEvent(new CustomEvent('consult-saved', { detail: id }));
    $('cs').hidden = true;
    target = null;
    $('cs-status').value = 'all';
    $('cs-date').value = $('cs-date').value || todayIso();
    await loadList();
    $('cs-open-all').textContent = 'บันทึกการปรึกษาแล้ว และติ๊ก Notified Doctor ใน Hemodialysis sheet ให้แล้ว เมื่อได้รับคำสั่งแพทย์ ให้บันทึกในรายการด้านล่าง';
  } catch (err) { say('บันทึกไม่สำเร็จ: ' + err.message); }
  finally { $('cs-save').disabled = false; }
});

// ปุ่มใน Hemodialysis sheet: เปิดเมนูนี้พร้อมผู้ป่วยรอบนั้น (รวมช่องที่แก้แต่ยังไม่บันทึก)
document.addEventListener('consult-session', async (e) => {
  document.querySelector('.view-tab[data-view="consult"]').click();
  const { session, patient } = e.detail;
  $('cs-date').value = session.session_date;
  openNew();
  try {
    await fillSessions(session.id);
    await loadTarget(session.id, { session, patient });
  } catch (err) { say(err.message); }
});
document.addEventListener('view-change', (e) => { if (e.detail === 'consult') loadList().catch((err) => say(err.message)); });
loadList().catch(() => {});
