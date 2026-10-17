// ตั้งค่าการเตือนระหว่างฟอก: เสียงเตือนบนหน้าจอ และ SMS ไปยังเบอร์มือถือที่ตั้งไว้ ใช้ร่วมกันทั้งเซิร์ฟเวอร์และหน้าเว็บ
export const TONES = { beep: 'บี๊บ', chime: 'กริ่ง', siren: 'ไซเรน' };
export const LEVELS = { warn: 'ทุกการเตือน', danger: 'เฉพาะค่าอันตราย (สีแดง)' };

export const DEFAULT_ALERT_SETTINGS = {
  sound: { enabled: true, level: 'warn', tone: 'beep', volume: 70, repeat: 3 },
  sms: { enabled: false, level: 'danger', phones: [] },
};

// เบอร์มือถือไทย 10 หลัก ขึ้นต้น 06 08 09 (รับ +66 และขีด/ช่องว่างได้) คืน null ถ้าไม่ถูกต้อง
export function normalizePhone(text) {
  let d = String(text ?? '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+66')) d = '0' + d.slice(3);
  else if (/^66\d{9}$/.test(d)) d = '0' + d.slice(2);
  return /^0[689]\d{8}$/.test(d) ? d : null;
}
export const maskPhone = (p) => `${p.slice(0, 3)}-xxx-${p.slice(-4)}`;
export const meets = (level, min) => min === 'warn' || level === 'danger';

// ตรวจและจัดรูปค่าตั้ง คืน { value, errors }
export function normalizeAlertSettings(input = {}) {
  const errors = [];
  const d = DEFAULT_ALERT_SETTINGS;
  const s = input.sound || {};
  const m = input.sms || {};
  const int = (v, min, max, def) => (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : def);
  const sound = {
    enabled: s.enabled === undefined ? d.sound.enabled : Boolean(s.enabled),
    level: LEVELS[s.level] ? s.level : d.sound.level,
    tone: TONES[s.tone] ? s.tone : d.sound.tone,
    volume: int(s.volume, 0, 100, d.sound.volume),
    repeat: int(s.repeat, 1, 10, d.sound.repeat),
  };
  const raw = Array.isArray(m.phones) ? m.phones : String(m.phones ?? '').split(/[\n,;]+/);
  const phones = [];
  for (const p of raw.map((x) => String(x).trim()).filter(Boolean)) {
    const n = normalizePhone(p);
    if (!n) errors.push(`เบอร์ ${p} ไม่ถูกต้อง (ต้องเป็นเบอร์มือถือ 10 หลัก เช่น 0812345678)`);
    else if (!phones.includes(n)) phones.push(n);
  }
  if (phones.length > 10) errors.push('ใส่เบอร์ได้ไม่เกิน 10 เบอร์');
  const sms = { enabled: Boolean(m.enabled), level: LEVELS[m.level] ? m.level : d.sms.level, phones };
  if (sms.enabled && !phones.length) errors.push('เปิดส่ง SMS แล้ว กรุณาใส่เบอร์มือถืออย่างน้อย 1 เบอร์');
  return { value: { sound, sms }, errors };
}

// ข้อความ SMS ไม่ใส่ชื่อหรือ HN ผู้ป่วย บอกเพียงเตียง รอบ เวลา และค่าที่ผิดปกติ
export function smsMessage(session, time, alerts) {
  const where = [session.bed_no ? `เตียง ${session.bed_no}` : '', session.shift ? `รอบ ${session.shift}` : ''].filter(Boolean).join(' ');
  return `[Hemo Sync] ${where || 'ห้องไตเทียม'}${time ? ` เวลา ${String(time).slice(0, 5)}` : ''}: ${alerts.map((a) => a.text).join('; ')}`.slice(0, 300);
}
