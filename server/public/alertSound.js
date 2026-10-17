// เสียงเตือนสร้างด้วย Web Audio ไม่ต้องใช้ไฟล์เสียง
let ctx = null;
let stopAt = 0;

// tone: beep | chime | siren, volume 0-100, repeat จำนวนครั้ง คืนเวลาที่เล่น (วินาที)
export function playAlert({ tone = 'beep', volume = 70, repeat = 3 } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || volume <= 0) return 0;
  ctx ??= new AC();
  if (ctx.state === 'suspended') ctx.resume();
  const gainMax = Math.min(1, volume / 100) * 0.6;
  let t = Math.max(ctx.currentTime + 0.02, stopAt);
  const note = (freq, start, dur, type = 'sine', toFreq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (toFreq) osc.frequency.linearRampToValueAtTime(toFreq, start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainMax, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  };
  const begin = t;
  for (let i = 0; i < repeat; i++) {
    if (tone === 'chime') { note(880, t, 0.35); note(660, t + 0.35, 0.5); t += 1.1; }
    else if (tone === 'siren') { note(600, t, 0.5, 'sawtooth', 1100); note(1100, t + 0.5, 0.5, 'sawtooth', 600); t += 1.1; }
    else { note(1000, t, 0.18, 'square'); note(1000, t + 0.28, 0.18, 'square'); t += 0.8; }
  }
  stopAt = t;
  return t - begin;
}
