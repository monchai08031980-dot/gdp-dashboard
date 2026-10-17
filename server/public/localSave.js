// บันทึกไฟล์ลงโฟลเดอร์ในเครื่องคอมพิวเตอร์ที่เปิดหน้าเว็บ
// ใช้การเลือกโฟลเดอร์ของเบราว์เซอร์ (Chrome / Edge บนคอมพิวเตอร์) จำโฟลเดอร์ไว้ใน IndexedDB ของเครื่องนี้
// เบราว์เซอร์ที่เลือกโฟลเดอร์ไม่ได้ จะดาวน์โหลดเป็นไฟล์ zip แทน (มีโครงโฟลเดอร์ ปี/วันที่ อยู่ข้างใน)

// ที่เก็บไฟล์ที่เลือกไว้ในเครื่องนี้: local = โฟลเดอร์ในเครื่องนี้, server = โฟลเดอร์บนเครื่องเซิร์ฟเวอร์
export function getSaveMode() {
  try { return localStorage.getItem('hemo.save-mode') || 'local'; } catch { return 'local'; }
}
export function setSaveMode(mode) {
  try { localStorage.setItem('hemo.save-mode', mode); } catch {}
}

export const canPickFolder = () => typeof window.showDirectoryPicker === 'function';

function idb() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open('hemo-sync', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((ok, fail) => {
    const tx = db.transaction('handles', mode);
    const req = fn(tx.objectStore('handles'));
    tx.oncomplete = () => ok(req.result);
    tx.onerror = () => fail(tx.error);
  });
}

// โฟลเดอร์ที่เลือกไว้ (หรือ null)
export async function savedFolder() {
  try { return (await idbDo('readonly', (s) => s.get('data-folder'))) || null; } catch { return null; }
}

// เปิดหน้าต่างเลือกโฟลเดอร์ของเครื่อง แล้วจำไว้
export async function pickFolder() {
  if (!canPickFolder()) throw new Error('เบราว์เซอร์นี้เลือกโฟลเดอร์ไม่ได้ (ใช้ Chrome หรือ Edge บนคอมพิวเตอร์) ระบบจะดาวน์โหลดเป็นไฟล์ zip แทน');
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'hemo-data', mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    if (err?.name === 'SecurityError') throw new Error('หน้านี้เปิดหน้าต่างเลือกโฟลเดอร์ไม่ได้ ระบบจะดาวน์โหลดเป็นไฟล์ zip แทน');
    throw err;
  }
  if (!(await allowed(handle))) throw new Error('ยังไม่ได้อนุญาตให้บันทึกลงโฟลเดอร์นี้');
  await idbDo('readwrite', (s) => s.put(handle, 'data-folder'));
  return handle;
}

// ขอสิทธิ์เขียน (เบราว์เซอร์จะถามอีกครั้งหลังปิดเปิดใหม่ ต้องเรียกจากการกดปุ่ม)
export async function allowed(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

// เขียนไฟล์ลง <โฟลเดอร์>/<ปี>/<วันที่>/ ไม่ทับไฟล์เดิม คืนฟังก์ชันลบไฟล์ที่เพิ่งเขียน (ใช้ถ้ายืนยันไม่สำเร็จ)
export async function writeToFolder(handle, dirParts, files) {
  if (!(await allowed(handle))) throw new Error('ยังไม่ได้อนุญาตให้บันทึกลงโฟลเดอร์ ' + handle.name);
  let dir = handle;
  for (const part of dirParts) dir = await dir.getDirectoryHandle(part, { create: true });
  for (const { name } of files) {
    const exists = await dir.getFileHandle(name).then(() => true, () => false);
    if (exists) throw new Error(`มีไฟล์ ${name} อยู่แล้ว`);
  }
  const written = [];
  const undo = async () => { for (const name of written) await dir.removeEntry(name).catch(() => {}); };
  try {
    for (const { name, data } of files) {
      const fh = await dir.getFileHandle(name, { create: true });
      written.push(name);
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
    }
  } catch (err) {
    await undo();
    throw err;
  }
  return undo;
}

// ไฟล์ zip แบบไม่บีบอัด (ชื่อไฟล์ภาษาไทยใช้ UTF-8)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export async function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, data } of files) {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
    const fname = enc.encode(name);
    const crc = crc32(bytes);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint16(10, time, true); head.setUint16(12, date, true);
    head.setUint32(14, crc, true); head.setUint32(18, bytes.length, true); head.setUint32(22, bytes.length, true);
    head.setUint16(26, fname.length, true);
    parts.push(new Uint8Array(head.buffer), fname, bytes);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(12, time, true); cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, bytes.length, true); cen.setUint32(24, bytes.length, true);
    cen.setUint16(28, fname.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), fname);
    offset += 30 + fname.length + bytes.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ดาวน์โหลดไฟล์ (หน้าตัวอย่างบน claude.ai ใช้การดาวน์โหลดของหน้า ถ้ามี)
export async function downloadFile(filename, blob) {
  const downloads = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (downloads) {
    await downloads.save({ filename, data: blob }).catch((err) => {
      throw new Error(err?.code === 'declined' ? 'ยกเลิกการดาวน์โหลด' : 'ดาวน์โหลดไม่สำเร็จ');
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
