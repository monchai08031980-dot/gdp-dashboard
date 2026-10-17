# Hemo Sync AI · backend (Node.js + PostgreSQL)

ระบบบันทึกฟอกเลือด ศูนย์ไตเทียมหนองบัวลำภู (30 เตียง) ตามแบบฟอร์ม 519

> ใช้ข้อมูลจำลองเท่านั้นใน dev/test ห้ามนำข้อมูลผู้ป่วยจริงเข้าระบบนี้

## เริ่มใช้งาน

```bash
cd server
npm install
cp .env.example .env            # แก้ DATABASE_URL ตามเครื่อง
createdb hemo_sync              # หรือสร้างผ่าน psql
DATABASE_URL=postgres://hemo:hemo@localhost:5432/hemo_sync npm run db:migrate
npm run db:seed                 # ผู้ป่วยจำลอง 190 ราย พร้อมรอบประจำ ประวัติการฟอก และนัด 4 สัปดาห์
npm start                       # http://localhost:3000
npm test                        # ต้องมีฐานข้อมูลที่ migrate แล้ว
```

ค่า `DATABASE_URL` ที่ไม่ได้ตั้งจะใช้ `postgres://hemo:hemo@localhost:5432/hemo_sync`

## โครงสร้าง

| ไฟล์ | หน้าที่ |
| --- | --- |
| `db/migrations/001_init.sql` | ตาราง `patients`, `dialysis_sessions` (Hemodialysis sheet แบบ 519), `intradialytic_vitals`, `session_medications`, `audit_log` และ trigger |
| `public/form519.js` | โครงสร้างแบบฟอร์ม 519 ใช้ร่วมกันทั้งหน้าเว็บและ API (เพิ่มฟิลด์ที่นี่และใน migration) |
| `db/seed.js` | ข้อมูลจำลอง (HN ขึ้นต้นด้วย `MOCK-`) |
| `src/db.js` | connection pool และ `withAudit()` สำหรับทุกการเขียน |
| `src/routes/` | REST API |
| `public/` | หน้าเว็บภาษาไทย ธีมสว่าง |

## Audit log

ทุก INSERT/UPDATE/DELETE บนตารางข้อมูลผู้ป่วยถูกบันทึกโดย trigger ในฐานข้อมูล ไม่ได้พึ่งโค้ดฝั่งแอป:

- เก็บข้อมูลก่อนและหลังแก้ (`old_data`, `new_data`) รายชื่อฟิลด์ที่เปลี่ยน ผู้แก้ และเหตุผล
- ถ้าไม่ได้ตั้ง `app.user_name` ใน transaction ฐานข้อมูลจะปฏิเสธการเขียน ใช้ `withAudit(user, reason, fn)` เสมอ
- ตาราง `audit_log` เป็นแบบเพิ่มได้อย่างเดียว แก้ไขหรือลบไม่ได้

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/patients?q=` | ค้นหาผู้ป่วย |
| POST / PATCH | `/api/patients`, `/api/patients/:id` | เพิ่ม / แก้ไขผู้ป่วย |
| GET | `/api/sessions?date=&patient_id=` | รายการรอบฟอก |
| GET | `/api/sessions/:id` | แบบ 519 พร้อมบันทึกระหว่างฟอกและยา |
| POST / PATCH | `/api/sessions`, `/api/sessions/:id` | เพิ่ม / แก้ไขรอบฟอก |
| POST / PATCH / DELETE | `/api/sessions/:id/vitals[/:rowId]` | บันทึกระหว่างฟอก |
| POST | `/api/sessions/:id/vitals/read-screen` | ส่งภาพหน้าจอเครื่องฟอก (JPG/PNG/WEBP) คืนค่าที่อ่านได้ ยังไม่บันทึก |
| POST / PATCH / DELETE | `/api/sessions/:id/medications[/:rowId]` | EPO / ยาระหว่างฟอก |
| GET | `/api/audit?session_id=` หรือ `?table=&record_id=` | ประวัติการแก้ไข |

การเขียนทุกครั้งต้องส่ง header `X-User-Name` (URL-encoded) และ `X-User-Role` เป็น `NURSE` (พยาบาล), `NURSE_AIDE` (ผู้ช่วยพยาบาล), `DOCTOR` (แพทย์), `CLERK` (เสมียน) หรือ `OTHER` (อื่นๆ) ส่วน `X-Edit-Reason` ส่งเมื่อมีเหตุผล ตำแหน่งถูกเก็บใน audit_log.changed_by_role
นี่เป็นการระบุตัวตนชั่วคราวจนกว่าจะมีระบบล็อกอิน

## อ่านค่าจากภาพหน้าจอเครื่องฟอก

ในบันทึกระหว่างฟอกมีปุ่ม "การถ่ายภาพจากหน้าจอ" ถ่ายหรือเลือกภาพหน้าจอเครื่อง แล้วระบบอ่านค่า Time, BP sys/dia, PR, RR, BFR, PV, TMP, Conduct มาเติมให้ พยาบาลต้องตรวจและแก้ก่อนกดบันทึกเสมอ แถวที่บันทึกผ่าน API เดิมจึงมี audit log ภาพไม่ถูกเก็บในระบบ

- ปิดอยู่โดยค่าเริ่มต้น ถ้าไม่เปิดยังถ่ายหรือเลือกภาพแล้วกรอกค่าตามภาพได้
- เปิดด้วย `SCREEN_READER=claude` และ `ANTHROPIC_API_KEY` ภาพจะถูกส่งไปให้ Claude (Anthropic API) อ่าน **ต้องได้รับอนุมัติจากโรงพยาบาลก่อนใช้กับผู้ป่วยจริง** และควรถ่ายเฉพาะหน้าจอเครื่องโดยไม่ให้เห็นชื่อผู้ป่วย
- ค่าที่อ่านไม่ได้หรือผิดช่วงปกติจะเว้นว่างและแจ้งเตือน ไม่เดาค่าให้

## เตือนค่าผิดปกติระหว่างฟอก

ตาราง vital signs ตรวจทุกแถวตามเกณฑ์ใน `public/hdAlerts.js` ช่องที่ผิดปกติเป็นสีส้มหรือแดง และมีรายการเตือนใต้ตาราง ปุ่ม "🔔 ตั้งค่าการเตือน" ตั้งได้ดังนี้ (เก็บใน app_settings มี audit log)

- เสียงเตือน: เปิดหรือปิด, ดังเมื่อทุกการเตือนหรือเฉพาะค่าอันตราย, แบบเสียง (บี๊บ กริ่ง ไซเรน), ความดัง และจำนวนครั้ง เสียงดังเมื่อบันทึกแถวที่มีค่าผิดปกติใหม่
- SMS: เปิดหรือปิด, ส่งเมื่อ, เบอร์มือถือไม่เกิน 10 เบอร์ ส่งจากเซิร์ฟเวอร์ทาง `SMS_WEBHOOK_URL` (POST JSON `{ to, message }` และ `Authorization: Bearer SMS_WEBHOOK_TOKEN` ถ้าตั้งไว้)
- ข้อความ SMS ไม่มีชื่อหรือ HN ผู้ป่วย มีเพียงเตียง รอบ เวลา และค่าที่ผิดปกติ ค่าเดิมของแถวเดิมส่งครั้งเดียว ทุกการส่งบันทึกใน `alert_notifications` (แก้หรือลบไม่ได้) การส่งไม่สำเร็จไม่ทำให้การบันทึกค่าล้มเหลว

## ยังไม่ได้ทำ

- ระบบล็อกอินและสิทธิ์ผู้ใช้
