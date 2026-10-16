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
npm run db:seed                 # ผู้ป่วยจำลอง 10 ราย, การฟอก 30 รอบ
npm start                       # http://localhost:3000
npm test                        # ต้องมีฐานข้อมูลที่ migrate แล้ว
```

ค่า `DATABASE_URL` ที่ไม่ได้ตั้งจะใช้ `postgres://hemo:hemo@localhost:5432/hemo_sync`

## โครงสร้าง

| ไฟล์ | หน้าที่ |
| --- | --- |
| `db/migrations/001_init.sql` | ตาราง `patients`, `dialysis_sessions` (แบบ 519), `intradialytic_vitals`, `audit_log` และ trigger |
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
| GET | `/api/sessions/:id` | แบบ 519 พร้อมสัญญาณชีพระหว่างฟอก |
| POST / PATCH | `/api/sessions`, `/api/sessions/:id` | เพิ่ม / แก้ไขรอบฟอก |
| POST | `/api/sessions/:id/vitals` | บันทึกสัญญาณชีพระหว่างฟอก |
| GET | `/api/audit?table=&record_id=` | ประวัติการแก้ไข |

การเขียนทุกครั้งต้องส่ง header `X-User-Name` (และ `X-Edit-Reason` ถ้ามี) ค่าเป็น URL-encoded
นี่เป็นการระบุตัวตนชั่วคราวจนกว่าจะมีระบบล็อกอิน

## ยังไม่ได้ทำ

- ระบบล็อกอินและสิทธิ์ผู้ใช้
- ตรวจฟิลด์ให้ตรงกับแบบฟอร์ม 519 ฉบับจริง (ฟิลด์ปัจจุบันอิงจากบันทึกการฟอกเลือดมาตรฐาน)
