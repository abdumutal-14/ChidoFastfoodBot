# Chido Fastfood Bot v3 — Deploy Ready

Bu versiya Railway va Render kabi hostinglarga joylash uchun tayyorlangan.

## Asosiy imkoniyatlar

- Telegram bot
- Telegram Mini App
- Chido menyu va savatcha
- Buyurtma checkout
- Bepul yetkazib berish
- 2 ta filial
- Naqd / karta
- Admin web panel
- Telegram admin guruh
- Buyurtma statuslari
- `/health` endpoint
- Railway konfiguratsiyasi
- Render konfiguratsiyasi
- Dockerfile

---

## MUHIM: token va parollar

`.env` ichiga real tokenni yozib GitHub'ga push QILMANG.

Hostingda quyidagi environment variable'larni qo'ying:

- `BOT_TOKEN`
- `BOT_USERNAME=ChidoFastfoodbot`
- `SETUP_CODE`
- `ADMIN_PASSWORD`
- `WEBAPP_URL`
- `ADMIN_CHAT_ID` (ixtiyoriy)

`PORT` ni hostingning o'zi beradi.

---

# Railway

## 1. GitHub'ga loyiha yuklash

Loyiha papkasini GitHub repository'ga push qiling.

`.env` GitHub'ga chiqmaydi, chunki `.gitignore` ichida bor.

## 2. Railway

Railway'da:
- New Project
- Deploy from GitHub Repo
- Chido repository'ni tanlang

Railway `railway.json` ni ko'rib `npm start` bilan ishga tushiradi.

## 3. Variables

Railway -> Variables ichiga:

BOT_TOKEN=...
BOT_USERNAME=ChidoFastfoodbot
SETUP_CODE=CHIDO_SETUP_2026
ADMIN_PASSWORD=KUCHLI_PAROL
WEBAPP_URL=https://SIZNING-RAILWAY-DOMENINGIZ

`ADMIN_CHAT_ID` ni bo'sh qoldirish mumkin. Keyin Telegram guruhda `/setadmin ...` orqali ulaysiz.

## 4. Public domain

Railway -> Networking -> Generate Domain.

Masalan:
`https://chido-fastfood-production.up.railway.app`

Shu manzilni `WEBAPP_URL` ga yozing va deploy/restart qiling.

---

# Render

## 1. GitHub'ga loyiha yuklash

Repository yaratib loyiha fayllarini push qiling.

## 2. Render

Render'da:
- New
- Blueprint yoki Web Service
- GitHub repo'ni ulang

Repository ichidagi `render.yaml` orqali deploy qilish mumkin.

## 3. Environment Variables

Render'da quyidagilarni kiriting:

BOT_TOKEN=...
BOT_USERNAME=ChidoFastfoodbot
SETUP_CODE=CHIDO_SETUP_2026
ADMIN_PASSWORD=KUCHLI_PAROL
WEBAPP_URL=https://SIZNING-RENDER-DOMENINGIZ

## 4. Public URL

Render deploy qilgandan keyin public HTTPS URL beradi.

Shu URL'ni `WEBAPP_URL` qiymatiga qo'ying va service'ni restart qiling.

---

# Telegram Mini App

Public HTTPS URL tayyor bo'lgach botni qayta ishga tushiring.

Bot `/start` da:
`🍔 MENYU / BUYURTMA`

tugmasini chiqaradi va Mini App Telegram ichida ochiladi.

---

# Admin panel

Public manzil:

`https://SIZNING-DOMENINGIZ/admin`

Admin paroli `ADMIN_PASSWORD` variable'dan olinadi.

---

# Admin Telegram guruh

Botni admin guruhiga qo'shing.

Guruh ichida:

`/setadmin SIZNING_SETUP_CODE`

Masalan default setup code ishlatilsa:

`/setadmin CHIDO_SETUP_2026`

---

# Health check

`/health`

Masalan:

`https://SIZNING-DOMENINGIZ/health`

Bu Railway/Render service ishlayotganini tekshirish uchun.

---

# Muhim: buyurtmalarni saqlash

Hozir demo versiyada buyurtmalar `data/orders.json` fayliga yoziladi.

Cloud hostinglarda local disk doimiy database o'rnini bosa olmaydi:
deploy/restart bo'lganda ma'lumotlar yo'qolishi mumkin.

Real production uchun keyingi bosqich:
**Supabase database** ga o'tkazish.

Shunda:
- buyurtmalar yo'qolmaydi
- admin panel real DB bilan ishlaydi
- mahsulotlar DB'dan boshqariladi
- bir nechta server instance ishlasa ham muammo bo'lmaydi
