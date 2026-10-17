// พูดแทนพิมพ์: เปลี่ยนเสียงเป็นข้อความด้วยระบบรู้จำเสียงของเบราว์เซอร์ (ภาษาไทย)
// เบราว์เซอร์ที่ไม่มี ใช้ไมค์บนคีย์บอร์ดมือถือพูดลงช่องข้อความ หรือพิมพ์เองแทน
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = () => Boolean(Recognition);
const running = new WeakMap();

// กดครั้งแรกเริ่มฟัง กดอีกครั้งหยุด ข้อความต่อท้ายช่อง box เมื่อหยุดและได้ยินเสียงจะเรียก onDone()
export function toggleDictation({ button, box, say, onDone, label = '🎤 พูด' }) {
  const mic = running.get(button);
  if (mic) { mic.stop(); return; }
  const start = box.value.trim();
  const rec = new Recognition();
  Object.assign(rec, { lang: 'th-TH', continuous: true, interimResults: true });
  let heard = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) heard += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    box.value = [start, heard + interim].filter(Boolean).join(' ').trim();
  };
  rec.onerror = (e) => {
    say(e.error === 'not-allowed' || e.error === 'service-not-allowed'
      ? 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน (หน้านี้หรือเบราว์เซอร์บล็อกไว้) กรุณาอนุญาตไมโครโฟน หรือพิมพ์ในช่องแทน'
      : e.error === 'no-speech' ? 'ไม่ได้ยินเสียง กรุณากดพูดอีกครั้ง' : 'รับเสียงไม่สำเร็จ กรุณาลองใหม่หรือพิมพ์แทน', true);
  };
  rec.onend = () => {
    running.delete(button);
    button.classList.remove('listening');
    button.textContent = label;
    if (heard.trim()) onDone();
  };
  running.set(button, rec);
  rec.start();
  button.classList.add('listening');
  button.textContent = '⏹ หยุดพูด';
  say('กำลังฟัง... พูดจบแล้วกดหยุดพูด');
}
export function stopDictation(button) { running.get(button)?.stop(); }
