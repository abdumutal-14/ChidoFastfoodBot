# Chido Fastfood v5 — Admin Pro

v5 Railway PostgreSQL bilan ishlaydi va kuchli admin panel qo‘shadi.

## Yangi imkoniyatlar

- Dashboard
  - bugungi buyurtmalar
  - bugungi savdo
  - faol buyurtmalar
  - jami buyurtmalar
  - mijozlar soni
  - oxirgi 7 kun savdo grafigi
  - top mahsulotlar
- Buyurtmalar
  - qidiruv
  - status filter
  - filial filter
  - statusni darhol o‘zgartirish
- Mahsulotlar
  - qo‘shish
  - tahrirlash
  - narx o‘zgartirish
  - tavsif
  - emoji
  - rasm URL
  - mavjud / mavjud emas
  - o‘chirish
- Kategoriyalar
  - qo‘shish
  - tahrirlash
  - tartiblash
  - o‘chirish
- Filiallar
  - qo‘shish
  - tahrirlash
  - faol/o‘chiq
  - o‘chirish
- Aksiyalar
  - qo‘shish
  - boshlanish/tugash vaqti
  - faol/o‘chiq
  - Mini App va Telegram botda ko‘rinadi

## Muhim

v5 seed jarayoni admin paneldagi o‘zgartirishlarni deploy/restart vaqtida qayta yozib yubormaydi.

## Deploy

1. Ushbu papka ichidagi fayllarni GitHub repo rootiga yuklang.
2. `.env` ni GitHub'ga yuklamang.
3. Railway avtomatik redeploy qiladi.
4. `/health` da `version:"5.0.0"` va `database:true` chiqishini tekshiring.
5. `/admin` orqali yangi panelga kiring.

Yangi SQL jadvali: `promotions`.
`products` jadvaliga `image_url` ustuni avtomatik qo‘shiladi.
