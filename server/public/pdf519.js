// สร้างไฟล์ PDF ของแบบฟอร์ม 519 จากข้อมูลที่จะบันทึก (record จาก /export/prepare) ในเบราว์เซอร์ ไม่ต้องใช้ไลบรารีภายนอก
// วาดแต่ละหน้าบน canvas (ภาษาไทยแสดงถูกต้องตามฟอนต์ของเบราว์เซอร์) แล้วรวมเป็น PDF ขนาด A4 หน้าละหนึ่งภาพ
import { SECTIONS, VITAL_FIELDS, MEDICATION_FIELDS, CHECKLISTS } from './form519.js';
import { isoToDmy, hhmm, fmtTime } from './common.js';

const W = 1240; // A4 ที่ 150 dpi
const H = 1754;
const M = 70;
const FONT = "'Sarabun', 'Noto Sans Thai', 'Leelawadee UI', Tahoma, sans-serif";
const font = (px, bold) => `${bold ? '600 ' : ''}${px}px ${FONT}`;
const ROLE_TH = { NURSE: 'พยาบาล', NURSE_AIDE: 'ผู้ช่วยพยาบาล', DOCTOR: 'แพทย์', CLERK: 'เสมียน', OTHER: 'อื่นๆ' };

// ค่าของช่องเป็นข้อความที่อ่านได้ (ใช้ชื่อตัวเลือกแทนรหัส)
function display(field, v) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '-';
  if (field.type === 'checklist') {
    const labels = Object.fromEntries(CHECKLISTS[field.name] || []);
    return v.map((k) => labels[k] || k).join(', ');
  }
  if (field.type === 'select' || field.type === 'bool') return Object.fromEntries(field.options)[String(v)] ?? String(v);
  if (field.type === 'date') return isoToDmy(v);
  if (field.type === 'time') return hhmm(v);
  return String(v);
}

// ตัดคำภาษาไทยด้วย Intl.Segmenter (ถ้าไม่มีตัดทีละตัวอักษร)
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
function wrap(ctx, text, width) {
  const pieces = segmenter ? [...segmenter.segment(String(text))].map((s) => s.segment) : [...String(text)];
  const lines = [];
  let line = '';
  for (const p of pieces) {
    if (p === '\n') { lines.push(line); line = ''; continue; }
    if (line && ctx.measureText(line + p).width > width) { lines.push(line.trimEnd()); line = p.trimStart(); } else line += p;
  }
  lines.push(line);
  return lines;
}

function pageWriter() {
  const pages = [];
  let ctx;
  let y;
  const bottom = H - M - 40;
  const newPage = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    pages.push(c);
    y = M;
  };
  newPage();
  return {
    pages,
    get ctx() { return ctx; },
    get y() { return y; },
    set y(v) { y = v; },
    need(h) { if (y + h > bottom) newPage(); },
  };
}

function drawTable(pw, title, fields, rows) {
  const width = W - 2 * M;
  const weights = fields.map((f) => (f.name === 'note' || f.name === 'drug_name' ? 2.2 : f.type === 'text' ? 1.4 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const cols = weights.map((w) => (w / total) * width);
  const rowH = 34;
  section(pw, title);
  const header = () => {
    pw.need(rowH * 2);
    const c = pw.ctx;
    c.fillStyle = '#eef3f5'; c.fillRect(M, pw.y, width, rowH); c.fillStyle = '#000';
    c.font = font(18, true);
    let x = M;
    fields.forEach((f, i) => { c.fillText(f.label, x + 6, pw.y + 7, cols[i] - 10); x += cols[i]; });
    c.strokeStyle = '#9aa7ad'; c.strokeRect(M, pw.y, width, rowH);
    pw.y += rowH;
  };
  header();
  if (!rows.length) { pw.ctx.font = font(18); pw.ctx.fillText('ไม่มีรายการ', M + 6, pw.y + 7); pw.y += rowH; return; }
  for (const r of rows) {
    if (pw.y + rowH > H - M - 40) { pw.need(H); header(); }
    const c = pw.ctx;
    c.font = font(18);
    let x = M;
    fields.forEach((f, i) => { c.fillText(display(f, r[f.name]), x + 6, pw.y + 7, cols[i] - 10); x += cols[i]; });
    c.strokeStyle = '#c9d2d6'; c.strokeRect(M, pw.y, width, rowH);
    pw.y += rowH;
  }
  pw.y += 10;
}

function section(pw, title) {
  pw.need(80);
  const c = pw.ctx;
  pw.y += 8;
  c.fillStyle = '#0e7490'; c.fillRect(M, pw.y, W - 2 * M, 34);
  c.fillStyle = '#ffffff'; c.font = font(20, true); c.fillText(title, M + 10, pw.y + 6);
  c.fillStyle = '#000000';
  pw.y += 42;
}

// วาดช่องของแต่ละหัวข้อ: ช่องสั้น 3 คอลัมน์ ช่องยาว (checklist / textarea) เต็มบรรทัด
function drawFields(pw, fields, record) {
  const width = W - 2 * M;
  const colW = width / 3;
  const lineH = 28;
  let col = 0;
  const flush = () => { if (col) { pw.y += lineH + 4; col = 0; } };
  for (const f of fields) {
    const value = display(f, record[f.name]);
    const wide = f.type === 'checklist' || f.type === 'textarea';
    if (wide) {
      flush();
      pw.ctx.font = font(18);
      const lines = wrap(pw.ctx, value, width - 240);
      pw.need(lines.length * lineH + 4);
      const c = pw.ctx;
      c.font = font(18, true); c.fillStyle = '#374151'; c.fillText(f.label, M, pw.y, 230); c.fillStyle = '#000';
      c.font = font(18);
      lines.forEach((l, i) => c.fillText(l, M + 240, pw.y + i * lineH));
      pw.y += lines.length * lineH + 4;
      continue;
    }
    if (col === 0) pw.need(lineH + 4);
    const c = pw.ctx;
    const x = M + col * colW;
    c.font = font(18, true); c.fillStyle = '#374151';
    const label = `${f.label}:`;
    c.fillText(label, x, pw.y, colW * 0.55);
    const lw = Math.min(c.measureText(label).width, colW * 0.55) + 8;
    c.fillStyle = '#000'; c.font = font(18);
    c.fillText(value, x + lw, pw.y, colW - lw - 12);
    col = (col + 1) % 3;
    if (!col) pw.y += lineH + 4;
  }
  flush();
}

// วาดทุกหน้า คืนรายการ canvas
export async function renderPages(record, sha256) {
  try { await document.fonts?.load(font(20)); await document.fonts?.load(font(20, true)); } catch {}
  const s = record.session;
  const p = record.patient;
  const pw = pageWriter();
  const c = pw.ctx;
  c.font = font(30, true);
  c.fillText('Hemodialysis sheet (แบบฟอร์ม 519)', M, pw.y);
  c.font = font(18);
  c.fillStyle = '#374151';
  c.fillText('ศูนย์ไตเทียมหนองบัวลำภู · Hemo Sync AI', M, pw.y + 42);
  c.textAlign = 'right';
  c.fillText(`วันที่ฟอก ${isoToDmy(s.session_date)}  รอบ ${s.shift ?? '-'}  เตียง ${s.bed_no ?? '-'}`, W - M, pw.y + 8);
  c.textAlign = 'left';
  c.fillStyle = '#000';
  pw.y += 80;
  c.strokeStyle = '#0e7490'; c.lineWidth = 2; c.strokeRect(M, pw.y, W - 2 * M, 46); c.lineWidth = 1;
  c.font = font(20, true);
  c.fillText(`ชื่อ ${p.prefix || ''}${p.first_name} ${p.last_name}`, M + 12, pw.y + 10, 560);
  c.fillText(`HN ${p.hn}`, M + 620, pw.y + 10, 300);
  pw.y += 60;

  for (const sec of SECTIONS) {
    section(pw, sec.title);
    drawFields(pw, sec.fields, s);
  }
  drawTable(pw, 'บันทึกระหว่างฟอก', VITAL_FIELDS, record.vitals);
  drawTable(pw, 'EPO / Medication during HD', MEDICATION_FIELDS, record.medications);

  const warnings = record.check?.warnings || [];
  if (warnings.length) {
    section(pw, `ข้อควรตรวจที่ผู้ยืนยันรับทราบแล้ว (${warnings.length})`);
    for (const w of warnings) {
      pw.ctx.font = font(18);
      const lines = wrap(pw.ctx, `• ${w.section}: ${w.message}`, W - 2 * M);
      pw.need(lines.length * 28);
      lines.forEach((l, i) => pw.ctx.fillText(l, M, pw.y + i * 28));
      pw.y += lines.length * 28 + 2;
    }
  }

  // ท้ายหน้า: ผู้ยืนยัน เวลา รหัสตรวจสอบไฟล์ และเลขหน้า
  const by = ROLE_TH[record.confirmed_by_role] || record.confirmed_by;
  pw.pages.forEach((page, i) => {
    const x = page.getContext('2d');
    x.strokeStyle = '#9aa7ad'; x.beginPath(); x.moveTo(M, H - M - 24); x.lineTo(W - M, H - M - 24); x.stroke();
    x.font = font(15); x.fillStyle = '#4b5563'; x.textBaseline = 'top';
    x.fillText(`ยืนยันโดย ${by} เมื่อ ${fmtTime(record.confirmed_at)} · SHA-256 ข้อมูล ${sha256 ? sha256.slice(0, 16) + '…' : '-'}`, M, H - M - 14);
    x.textAlign = 'right';
    x.fillText(`หน้า ${i + 1}/${pw.pages.length}`, W - M, H - M - 14);
    x.textAlign = 'left';
  });
  return pw.pages;
}

// รวมภาพ JPEG เป็นไฟล์ PDF (หน้าละภาพ เต็มหน้า A4)
const enc = new TextEncoder();
export async function pagesToPdf(pages) {
  const jpegs = await Promise.all(pages.map((c) => new Promise((ok, fail) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => ok(new Uint8Array(a)), fail) : fail(new Error('สร้างภาพไม่ได้'))), 'image/jpeg', 0.88))));
  const parts = [];
  const offsets = [];
  let size = 0;
  const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const PW = 595.28, PH = 841.89;
  const n = pages.length;
  // 1 catalog, 2 pages, แล้วต่อหน้า: page, image, content
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[\u0080-ÿ]/g, ''));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`));
  pages.forEach((c, i) => {
    const page = 3 + i * 3, img = page + 1, content = page + 2;
    obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`));
    obj(img, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegs[i].length} >>\nstream\n`);
      push(jpegs[i]);
      push('\nendstream');
    });
    const draw = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    obj(content, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  });
  const total = 3 + n * 3;
  const xref = size;
  push(`xref\n0 ${total}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

export async function buildPdf519(record, sha256) {
  const pages = await renderPages(record, sha256);
  return { pages, pdf: await pagesToPdf(pages) };
}
