-- ที่เก็บไฟล์ของการยืนยัน: server = โฟลเดอร์บนเครื่องเซิร์ฟเวอร์, local = โฟลเดอร์ที่เลือกในเครื่องผู้ใช้, download = ดาวน์โหลดเป็น zip
-- และเก็บไฟล์ PDF ที่ผู้ยืนยันดูก่อนบันทึก
ALTER TABLE session_exports
  ADD COLUMN target text NOT NULL DEFAULT 'server' CHECK (target IN ('server', 'local', 'download')),
  ADD COLUMN pdf_path text;
