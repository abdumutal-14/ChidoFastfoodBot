require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP_URL = (process.env.WEBAPP_URL || "").replace(/\/$/, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "chido2026";

const DATA_DIR = path.join(__dirname, "data");
const MENU_FILE = path.join(DATA_DIR, "menu.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

const BRANCHES = ["Fresh City 3-qavat", "Guliston Fresh 2-qavat"];

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("JSON read error:", file, e.message);
    return fallback;
  }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}
function money(v) {
  return Number(v).toLocaleString("uz-UZ") + " so‘m";
}
function createOrderId() {
  return Date.now().toString().slice(-7) + Math.floor(10 + Math.random()*90);
}
function getConfig() {
  const cfg = readJson(CONFIG_FILE, { adminChatId: null });
  if (!cfg.adminChatId && process.env.ADMIN_CHAT_ID) cfg.adminChatId = process.env.ADMIN_CHAT_ID;
  return cfg;
}
function setAdminChat(id) {
  writeJson(CONFIG_FILE, { adminChatId: String(id) });
}
function statusLabel(status) {
  const map = {
    accepted: "🟡 Qabul qilindi",
    cooking: "👨‍🍳 Tayyorlanmoqda",
    courier: "🛵 Kuryerga berildi",
    ready: "✅ Olib ketishga tayyor",
    completed: "✅ Yakunlandi",
    cancelled: "❌ Bekor qilindi"
  };
  return map[status] || status;
}
function saveOrder(order) {
  const orders = readJson(ORDERS_FILE, []);
  orders.push(order);
  writeJson(ORDERS_FILE, orders);
}
function updateOrderStatus(orderId, status) {
  const orders = readJson(ORDERS_FILE, []);
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) return null;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  writeJson(ORDERS_FILE, orders);
  return order;
}
function adminStatusKeyboard(orderId, type) {
  const rows = [
    [Markup.button.callback("🟡 Qabul qilindi", `astatus_${orderId}_accepted`)],
    [Markup.button.callback("👨‍🍳 Tayyorlanmoqda", `astatus_${orderId}_cooking`)]
  ];
  rows.push([Markup.button.callback(
    type === "delivery" ? "🛵 Kuryerga berildi" : "✅ Olib ketishga tayyor",
    `astatus_${orderId}_${type === "delivery" ? "courier" : "ready"}`
  )]);
  rows.push([
    Markup.button.callback("✅ Yakunlandi", `astatus_${orderId}_completed`),
    Markup.button.callback("❌ Bekor", `astatus_${orderId}_cancelled`)
  ]);
  return Markup.inlineKeyboard(rows);
}

let bot = null;
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);

  function mainKeyboard() {
    const rows = [];
    if (WEBAPP_URL) {
      rows.push([Markup.button.webApp("🍔 MENYU / BUYURTMA", `${WEBAPP_URL}/`)]);
    } else {
      rows.push(["🍔 Menyu", "🛒 Savatcha"]);
    }
    rows.push(["📦 Buyurtmalarim", "🔥 Aksiyalar"]);
    rows.push(["📍 Filiallar", "☎️ Aloqa"]);
    return Markup.keyboard(rows).resize();
  }

  bot.start(async ctx => {
    await ctx.reply(
      `Assalomu alaykum, ${ctx.from.first_name || "mijoz"}! 👋\n\n` +
      `🍔 Chido Fastfood botiga xush kelibsiz.\n` +
      `🚚 Yetkazib berish bepul.`,
      mainKeyboard()
    );
    if (!WEBAPP_URL) {
      await ctx.reply("ℹ️ Mini App hali public HTTPS manzilga ulanmagan. Hozircha botning oddiy menyusi ishlaydi.");
    }
  });

  bot.command("setadmin", async ctx => {
    if (ctx.chat.type === "private") return ctx.reply("Bu komanda admin guruh ichida ishlatiladi.");
    const code = ctx.message.text.trim().split(/\s+/)[1];
    if (code !== process.env.SETUP_CODE) return ctx.reply("❌ Setup kod noto‘g‘ri.");
    setAdminChat(ctx.chat.id);
    await ctx.reply("✅ Bu guruh Chido buyurtmalari uchun ADMIN GURUH sifatida ulandi.");
  });

  bot.hears("🍔 Menyu", async ctx => {
    if (WEBAPP_URL) return ctx.reply("Chido menyusini oching:", Markup.inlineKeyboard([
      [Markup.button.webApp("🍔 Mini Appni ochish", `${WEBAPP_URL}/`)]
    ]));
    return ctx.reply("Mini App public serverga ulanmaguncha oddiy bot menyusidan foydalaning.");
  });

  bot.hears("🛒 Savatcha", ctx => ctx.reply("Savatcha endi Mini App ichida boshqariladi."));
  bot.hears("🔥 Aksiyalar", ctx => ctx.reply("🔥 Aksiyalar bo‘limi tayyor. Keyin admin paneldan boshqariladi."));
  bot.hears("📍 Filiallar", ctx => ctx.reply("📍 Fresh City 3-qavat\n📍 Guliston Fresh 2-qavat"));
  bot.hears("☎️ Aloqa", ctx => ctx.reply("☎️ Chido Fastfood\n🤖 @ChidoFastfoodbot"));
  bot.hears("📦 Buyurtmalarim", ctx => {
    const orders = readJson(ORDERS_FILE, [])
      .filter(o => String(o.userId) === String(ctx.from.id))
      .slice(-8).reverse();
    if (!orders.length) return ctx.reply("Sizda hali buyurtmalar yo‘q.");
    const txt = orders.map(o => `🧾 #${o.id}\n💰 ${money(o.total)}\n📌 ${statusLabel(o.status)}`).join("\n\n");
    ctx.reply(txt);
  });

  bot.action(/^astatus_(\d+)_(accepted|cooking|courier|ready|completed|cancelled)$/, async ctx => {
    const cfg = getConfig();
    if (!cfg.adminChatId || String(ctx.chat.id) !== String(cfg.adminChatId)) {
      return ctx.answerCbQuery("Bu tugma faqat admin guruhda ishlaydi.");
    }
    const order = updateOrderStatus(ctx.match[1], ctx.match[2]);
    if (!order) return ctx.answerCbQuery("Buyurtma topilmadi.");
    await ctx.answerCbQuery("Status yangilandi ✅");
    try {
      await bot.telegram.sendMessage(order.userId, `📦 Buyurtma #${order.id}\n\n${statusLabel(order.status)}`);
    } catch (e) {}
    await ctx.reply(`Buyurtma #${order.id}: ${statusLabel(order.status)}`);
  });

  bot.launch()
    .then(() => console.log("✅ Telegram bot ishga tushdi"))
    .catch(err => console.error("❌ Telegram bot error:", err.message));
}

// ---------- Public API ----------
app.get("/api/menu", (req, res) => {
  res.json({
    brand: "Chido Fastfood",
    deliveryFee: 0,
    branches: BRANCHES,
    menu: readJson(MENU_FILE, {})
  });
});

app.post("/api/orders", async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: "Savatcha bo‘sh." });
  if (!body.phone || !body.branch || !body.type || !body.payment) {
    return res.status(400).json({ error: "Buyurtma ma’lumotlari to‘liq emas." });
  }

  const catalog = Object.values(readJson(MENU_FILE, {})).flat();
  const safeItems = [];
  let total = 0;

  for (const row of items) {
    const p = catalog.find(x => Number(x.id) === Number(row.id));
    if (!p) continue;
    const qty = Math.max(1, Math.min(30, Number(row.qty || 1)));
    safeItems.push({ id: p.id, name: p.name, price: p.price, qty });
    total += p.price * qty;
  }
  if (!safeItems.length) return res.status(400).json({ error: "Mahsulot topilmadi." });

  const order = {
    id: createOrderId(),
    userId: body.userId || null,
    username: body.username || null,
    customerName: body.customerName || "Mijoz",
    phone: String(body.phone),
    branch: body.branch,
    type: body.type,
    address: body.address || "",
    payment: body.payment,
    comment: body.comment || "",
    items: safeItems,
    total,
    deliveryFee: 0,
    status: "accepted",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  saveOrder(order);

  if (bot) {
    const cfg = getConfig();
    if (cfg.adminChatId) {
      const lines = safeItems.map((x,i) => `${i+1}. ${x.name} — ${x.qty} × ${money(x.price)}`).join("\n");
      let adminText =
        `🆕 YANGI BUYURTMA #${order.id}\n\n` +
        `👤 ${order.customerName}\n` +
        `${order.username ? `🔗 @${order.username}\n` : ""}` +
        `${order.userId ? `🆔 ${order.userId}\n` : ""}` +
        `📱 ${order.phone}\n` +
        `🏪 ${order.branch}\n` +
        `🚚 ${order.type === "delivery" ? "Yetkazib berish — BEPUL" : "Olib ketish"}\n` +
        `💳 ${order.payment}\n` +
        `${order.address ? `📍 ${order.address}\n` : ""}` +
        `${order.comment ? `💬 ${order.comment}\n` : ""}\n` +
        `${lines}\n\n💰 Jami: ${money(order.total)}`;
      try {
        await bot.telegram.sendMessage(cfg.adminChatId, adminText, adminStatusKeyboard(order.id, order.type));
      } catch (e) {
        console.error("Admin send error:", e.message);
      }
    }
  }

  res.json({ ok: true, order });
});

// ---------- Admin API ----------
function requireAdmin(req, res, next) {
  const password = req.headers["x-admin-password"];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Parol noto‘g‘ri." });
  next();
}

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const orders = readJson(ORDERS_FILE, []).slice().reverse();
  res.json({ orders });
});

app.patch("/api/admin/orders/:id/status", requireAdmin, async (req, res) => {
  const allowed = ["accepted","cooking","courier","ready","completed","cancelled"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "Status noto‘g‘ri." });
  const order = updateOrderStatus(req.params.id, req.body.status);
  if (!order) return res.status(404).json({ error: "Buyurtma topilmadi." });

  if (bot && order.userId) {
    try {
      await bot.telegram.sendMessage(order.userId, `📦 Buyurtma #${order.id}\n\n${statusLabel(order.status)}`);
    } catch (e) {}
  }
  res.json({ ok: true, order });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/health", (req, res) => res.json({ ok: true, bot: !!bot, webappUrl: WEBAPP_URL || null }));

app.listen(PORT, () => {
  console.log(`✅ Chido server: http://localhost:${PORT}`);
  console.log(`🛍 Mini App: http://localhost:${PORT}/`);
  console.log(`🧑‍💼 Admin: http://localhost:${PORT}/admin`);
  if (!WEBAPP_URL) console.log("ℹ️ WEBAPP_URL bo‘sh. Telegram Mini App tugmasi hostingdan keyin yoqiladi.");
});

process.once("SIGINT", () => {
  if (bot) bot.stop("SIGINT");
  process.exit(0);
});
process.once("SIGTERM", () => {
  if (bot) bot.stop("SIGTERM");
  process.exit(0);
});
