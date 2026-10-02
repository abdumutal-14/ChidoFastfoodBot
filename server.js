require("dotenv").config();

const path=require("path");
const crypto=require("crypto");
const express=require("express");
const {Telegraf,Markup}=require("telegraf");
const multer=require("multer");
const db=require("./db");

const app=express();
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const PORT=Number(process.env.PORT||3000);
const BOT_TOKEN=process.env.BOT_TOKEN||"";
const WEBAPP_URL=(process.env.WEBAPP_URL||"").replace(/\/$/,"");
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"chido2026";

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:5*1024*1024},
  fileFilter:(req,file,cb)=>{
    const allowed=["image/jpeg","image/png","image/webp","image/gif"];
    if(!allowed.includes(file.mimetype)){
      return cb(new Error("Faqat JPG, PNG, WEBP yoki GIF rasm yuklash mumkin."));
    }
    cb(null,true);
  }
});


function verifyTelegramInitData(initData){
  if(!initData || !BOT_TOKEN) return null;
  try{
    const params=new URLSearchParams(initData);
    const receivedHash=params.get("hash");
    if(!receivedHash) return null;

    params.delete("hash");
    const dataCheckString=[...params.entries()]
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>`${k}=${v}`)
      .join("\n");

    const secretKey=crypto
      .createHmac("sha256","WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash=crypto
      .createHmac("sha256",secretKey)
      .update(dataCheckString)
      .digest("hex");

    const a=Buffer.from(calculatedHash,"hex");
    const b=Buffer.from(receivedHash,"hex");
    if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;

    const authDate=Number(params.get("auth_date")||0);
    if(!authDate || (Date.now()/1000-authDate)>86400) return null;

    const rawUser=params.get("user");
    if(!rawUser) return null;
    return JSON.parse(rawUser);
  }catch(e){
    console.error("Telegram initData verify error:",e.message);
    return null;
  }
}


function sleep(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

function isTelegramBlockedError(err){
  const code=err?.response?.error_code;
  const desc=String(err?.response?.description||err?.message||"").toLowerCase();
  return code===403 ||
    desc.includes("bot was blocked") ||
    desc.includes("user is deactivated") ||
    desc.includes("chat not found") ||
    desc.includes("forbidden");
}

function absoluteMediaUrl(url){
  if(!url) return "";
  if(/^https?:\/\//i.test(url)) return url;
  if(!WEBAPP_URL) return url;
  return `${WEBAPP_URL}${url.startsWith("/")?"":"/"}${url}`;
}

function money(v){return Number(v).toLocaleString("uz-UZ")+" so‘m"}
function orderId(){return Date.now().toString().slice(-7)+Math.floor(10+Math.random()*90)}
function statusLabel(s){
  return ({
    accepted:"🟡 Qabul qilindi",
    cooking:"👨‍🍳 Tayyorlanmoqda",
    courier:"🛵 Kuryerga berildi",
    ready:"✅ Olib ketishga tayyor",
    completed:"✅ Yakunlandi",
    cancelled:"❌ Bekor qilindi"
  })[s]||s
}
async function getAdminChatId(){
  if(process.env.ADMIN_CHAT_ID) return String(process.env.ADMIN_CHAT_ID);
  return await db.getSetting("admin_chat_id");
}
async function setAdminChat(id){
  await db.setSetting("admin_chat_id",String(id));
}
function adminStatusKeyboard(id,type){
  return Markup.inlineKeyboard([
    [Markup.button.callback("🟡 Qabul qilindi",`astatus_${id}_accepted`)],
    [Markup.button.callback("👨‍🍳 Tayyorlanmoqda",`astatus_${id}_cooking`)],
    [Markup.button.callback(
      type==="delivery"?"🛵 Kuryerga berildi":"✅ Olib ketishga tayyor",
      `astatus_${id}_${type==="delivery"?"courier":"ready"}`
    )],
    [
      Markup.button.callback("✅ Yakunlandi",`astatus_${id}_completed`),
      Markup.button.callback("❌ Bekor",`astatus_${id}_cancelled`)
    ]
  ]);
}

let bot=null;

function setupBot(){
  if(!BOT_TOKEN)return;

  bot=new Telegraf(BOT_TOKEN);

  bot.use(async(ctx,next)=>{
    try{
      if(ctx.from?.id) await db.upsertBotUser(ctx.from);
    }catch(e){
      console.error("bot_users upsert:",e.message);
    }
    return next();
  });


  const mainKeyboard=()=>Markup.keyboard([
    ["📦 Buyurtmalarim","🔥 Aksiyalar"],
    ["📍 Filiallar","☎️ Aloqa"]
  ]).resize();

  async function sendMiniAppButton(ctx){
    if(!WEBAPP_URL){
      return ctx.reply("Mini App URL sozlanmagan.");
    }
    return ctx.reply(
      "🍔 Buyurtma berish uchun quyidagi tugmani bosing:",
      Markup.inlineKeyboard([
        [Markup.button.webApp("🍔 MENYU / BUYURTMA",`${WEBAPP_URL}/`)]
      ])
    );
  }

  bot.start(async ctx=>{
    await ctx.reply(
      `Assalomu alaykum, ${ctx.from.first_name||"mijoz"}! 👋\n\n`+
      `🍔 Chido Fastfood botiga xush kelibsiz.\n🚚 Yetkazib berish bepul.`,
      mainKeyboard()
    );
    await sendMiniAppButton(ctx);
  });

  bot.command("menu",sendMiniAppButton);
  bot.hears("🍔 MENYU / BUYURTMA",sendMiniAppButton);

  bot.command("setadmin",async ctx=>{
    if(ctx.chat.type==="private")return ctx.reply("Bu komanda admin guruh ichida ishlatiladi.");
    const code=ctx.message.text.trim().split(/\s+/)[1];
    if(code!==process.env.SETUP_CODE)return ctx.reply("❌ Setup kod noto‘g‘ri.");
    await setAdminChat(ctx.chat.id);
    await ctx.reply("✅ Bu guruh Chido buyurtmalari uchun ADMIN GURUH sifatida ulandi.");
  });

  bot.hears("🔥 Aksiyalar",async ctx=>{
    try{
      const data=await db.getMenuData();
      if(!data.promotions.length)return ctx.reply("Hozircha faol aksiya yo‘q.");
      await ctx.reply(data.promotions.map(p=>`🔥 ${p.title}\n${p.description}`).join("\n\n"));
    }catch(e){await ctx.reply("Aksiyalarni yuklashda xatolik.");}
  });

  bot.hears("📍 Filiallar",async ctx=>{
    const data=await db.getMenuData();
    await ctx.reply(data.branches.map(x=>`📍 ${x}`).join("\n"));
  });

  bot.hears("☎️ Aloqa",ctx=>ctx.reply("☎️ Chido Fastfood\n🤖 @ChidoFastfoodbot"));

  bot.hears("📦 Buyurtmalarim",async ctx=>{
    const orders=await db.getUserOrders(ctx.from.id,8);
    if(!orders.length)return ctx.reply("Sizda hali buyurtmalar yo‘q.");
    await ctx.reply(orders.map(o=>
      `🧾 #${o.id}\n💰 ${money(o.total)}\n📌 ${statusLabel(o.status)}`
    ).join("\n\n"));
  });

  bot.action(/^astatus_(\d+)_(accepted|cooking|courier|ready|completed|cancelled)$/,async ctx=>{
    const adminChatId=await getAdminChatId();
    if(!adminChatId||String(ctx.chat.id)!==String(adminChatId)){
      return ctx.answerCbQuery("Bu tugma faqat admin guruhda ishlaydi.");
    }

    const order=await db.updateOrderStatus(ctx.match[1],ctx.match[2]);
    if(!order)return ctx.answerCbQuery("Buyurtma topilmadi.");

    await ctx.answerCbQuery("Status yangilandi ✅");

    if(order.userId){
      try{
        await bot.telegram.sendMessage(
          order.userId,
          `📦 Buyurtma #${order.id}\n\n${statusLabel(order.status)}`
        )
      }catch(e){}
    }

    await ctx.reply(`Buyurtma #${order.id}: ${statusLabel(order.status)}`);
  });

  bot.launch()
    .then(()=>console.log("✅ Telegram bot ishga tushdi"))
    .catch(e=>console.error("Bot:",e.message));
}

// ---------- PUBLIC ----------
app.get("/api/menu",async(req,res)=>{
  try{res.json(await db.getMenuData())}
  catch(e){console.error(e);res.status(500).json({error:"Menyu yuklanmadi."})}
});

app.post("/api/orders",async(req,res)=>{
  try{
    const b=req.body||{};
    const requested=Array.isArray(b.items)?b.items:[];

    if(!requested.length)return res.status(400).json({error:"Savatcha bo‘sh."});
    if(!b.phone||!b.branch||!b.type||!b.payment){
      return res.status(400).json({error:"Buyurtma ma’lumotlari to‘liq emas."});
    }

    if(b.type==="delivery"){
      const lat=Number(b.latitude);
      const lng=Number(b.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180){
        return res.status(400).json({error:"Yetkazib berish uchun lokatsiyani tanlang."});
      }
    }

    const ids=[...new Set(requested.map(x=>Number(x.id)).filter(Number.isInteger))];
    const products=await db.getProductsByIds(ids);

    const items=[];
    let total=0;

    for(const r of requested){
      const p=products.find(x=>x.id===Number(r.id));
      if(!p)continue;
      const qty=Math.max(1,Math.min(30,Number(r.qty||1)));
      items.push({id:p.id,name:p.name,price:p.price,qty});
      total+=p.price*qty;
    }

    if(!items.length)return res.status(400).json({error:"Mahsulot topilmadi."});

    const tgUser=verifyTelegramInitData(b.initData);
    if(tgUser){
      try{await db.upsertBotUser(tgUser)}catch(e){console.error("Mini App user save:",e.message)}
    }

    const order=await db.createOrder({
      id:orderId(),
      userId:tgUser?.id||null,
      username:tgUser?.username||null,
      customerName:tgUser
        ? ([tgUser.first_name,tgUser.last_name].filter(Boolean).join(" ")||"Mijoz")
        : (b.customerName||"Mijoz"),
      phone:String(b.phone),
      branch:b.branch,
      type:b.type,
      address:b.address||"",
      latitude:b.type==="delivery"?Number(b.latitude):null,
      longitude:b.type==="delivery"?Number(b.longitude):null,
      locationSource:b.type==="delivery"?(b.locationSource||"map"): "",
      payment:b.payment,
      comment:b.comment||"",
      total,
      deliveryFee:0,
      status:"accepted"
    },items);

    if(bot){
      const adminChatId=await getAdminChatId();

      if(adminChatId){
        let txt=
          `🆕 YANGI BUYURTMA #${order.id}\n\n`+
          `👤 ${order.customerName}\n`+
          `${order.username?`🔗 @${order.username}\n`:""}`+
          `${order.userId?`🆔 ${order.userId}\n`:""}`+
          `📱 ${order.phone}\n`+
          `🏪 ${order.branch}\n`+
          `🚚 ${order.type==="delivery"?"Yetkazib berish — BEPUL":"Olib ketish"}\n`+
          `💳 ${order.payment}\n`+
          `${order.address?`📍 ${order.address}\n`:""}`+
          `${order.latitude!==null&&order.longitude!==null
            ? `🗺 Lokatsiya: https://www.google.com/maps?q=${order.latitude},${order.longitude}\n`
            : ""}`+
          `${order.comment?`💬 ${order.comment}\n`:""}\n`;

        txt+=items.map((x,i)=>`${i+1}. ${x.name} — ${x.qty} × ${money(x.price)}`).join("\n");
        txt+=`\n\n💰 Jami: ${money(order.total)}`;

        try{
          await bot.telegram.sendMessage(
            adminChatId,txt,adminStatusKeyboard(order.id,order.type)
          )
        }catch(e){
          console.error("Admin send:",e.message)
        }
      }
    }

    res.json({ok:true,order});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Buyurtmani saqlashda xatolik."});
  }
});

// ---------- ADMIN AUTH ----------
function requireAdmin(req,res,next){
  if(req.headers["x-admin-password"]!==ADMIN_PASSWORD){
    return res.status(401).json({error:"Parol noto‘g‘ri."});
  }
  next();
}


// ---------- MEDIA ----------
app.get("/api/media/:id",async(req,res)=>{
  try{
    const file=await db.getMedia(Number(req.params.id));
    if(!file)return res.status(404).end();
    res.setHeader("Content-Type",file.mime_type);
    res.setHeader("Cache-Control","public, max-age=31536000, immutable");
    res.send(file.data);
  }catch(e){
    console.error(e);
    res.status(500).end();
  }
});

app.post("/api/admin/media",requireAdmin,upload.single("image"),async(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:"Rasm tanlanmagan."});
    const id=await db.saveMedia(req.file.originalname,req.file.mimetype,req.file.buffer);
    res.json({ok:true,id,url:`/api/media/${id}`});
  }catch(e){
    console.error(e);
    res.status(400).json({error:e.message||"Rasm yuklanmadi."});
  }
});

// ---------- ADMIN ORDERS ----------
app.get("/api/admin/orders",requireAdmin,async(req,res)=>{
  try{
    const [orders,stats]=await Promise.all([
      db.listOrders(300),
      db.getStats()
    ]);
    res.json({orders,stats});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Buyurtmalar yuklanmadi."});
  }
});

app.patch("/api/admin/orders/:id/status",requireAdmin,async(req,res)=>{
  try{
    const allowed=["accepted","cooking","courier","ready","completed","cancelled"];
    if(!allowed.includes(req.body.status)){
      return res.status(400).json({error:"Status noto‘g‘ri."});
    }

    const order=await db.updateOrderStatus(req.params.id,req.body.status);
    if(!order)return res.status(404).json({error:"Buyurtma topilmadi."});

    if(bot&&order.userId){
      try{
        await bot.telegram.sendMessage(
          order.userId,
          `📦 Buyurtma #${order.id}\n\n${statusLabel(order.status)}`
        )
      }catch(e){}
    }

    res.json({ok:true,order});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Status yangilanmadi."});
  }
});


// ---------- ADMIN PROMOTION BROADCAST ----------
app.post("/api/admin/promotions/:id/broadcast",requireAdmin,async(req,res)=>{
  try{
    if(!bot){
      return res.status(503).json({error:"Telegram bot ishlamayapti."});
    }

    const promotionId=Number(req.params.id);
    const promotion=await db.getPromotionById(promotionId);
    if(!promotion){
      return res.status(404).json({error:"Aksiya topilmadi."});
    }

    const users=await db.listActiveBotUsers();
    const force=req.body?.force===true;

    let sent=0,failed=0,skipped=0,blocked=0;

    for(const user of users){
      try{
        if(!force && await db.wasPromotionSentToUser(promotionId,user.userId)){
          skipped++;
          continue;
        }

        const title=`🔥 ${promotion.badge||"AKSIYA"}\n\n${promotion.title}`;
        const text=[
          title,
          promotion.description||"",
          promotion.ends_at
            ? `\n⏳ Tugash: ${new Date(promotion.ends_at).toLocaleString("uz-UZ")}`
            : ""
        ].filter(Boolean).join("\n");

        const keyboard=WEBAPP_URL
          ? Markup.inlineKeyboard([
              [Markup.button.webApp("🍔 Buyurtma berish",`${WEBAPP_URL}/`)]
            ])
          : undefined;

        const imageUrl=absoluteMediaUrl(promotion.image_url);

        if(imageUrl){
          await bot.telegram.sendPhoto(
            user.userId,
            imageUrl,
            {
              caption:text.slice(0,1024),
              ...(keyboard?keyboard:{})
            }
          );
        }else{
          await bot.telegram.sendMessage(
            user.userId,
            text.slice(0,4096),
            keyboard||{}
          );
        }

        await db.recordPromotionBroadcast(promotionId,user.userId,"sent","");
        sent++;

        // Stay safely below Telegram's broad broadcast rate limits.
        await sleep(45);
      }catch(e){
        failed++;
        const msg=String(e?.response?.description||e?.message||"Broadcast error");

        if(isTelegramBlockedError(e)){
          blocked++;
          try{await db.markBotUserBlocked(user.userId)}catch(_){}
        }

        try{
          await db.recordPromotionBroadcast(
            promotionId,user.userId,"failed",msg.slice(0,500)
          );
        }catch(_){}

        await sleep(60);
      }
    }

    const stats=await db.getPromotionBroadcastStats(promotionId);
    res.json({
      ok:true,
      promotionId,
      audience:users.length,
      sent,
      failed,
      skipped,
      blocked,
      stats
    });
  }catch(e){
    console.error("Promotion broadcast:",e);
    res.status(500).json({error:e.message||"Aksiyani yuborishda xatolik."});
  }
});

app.get("/api/admin/users/stats",requireAdmin,async(req,res)=>{
  try{
    res.json({ok:true,stats:await db.getBotUserStats()});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

// ---------- ADMIN CATALOG ----------
app.get("/api/admin/catalog",requireAdmin,async(req,res)=>{
  try{res.json(await db.adminCatalog())}
  catch(e){console.error(e);res.status(500).json({error:"Katalog yuklanmadi."})}
});

app.post("/api/admin/products",requireAdmin,async(req,res)=>{
  try{
    if(!req.body.name||!req.body.category_slug||req.body.price===undefined){
      return res.status(400).json({error:"Nom, kategoriya va narx majburiy."});
    }
    res.json({ok:true,product:await db.createProduct(req.body)});
  }catch(e){console.error(e);res.status(400).json({error:e.message})}
});

app.put("/api/admin/products/:id",requireAdmin,async(req,res)=>{
  try{
    const p=await db.updateProduct(Number(req.params.id),req.body);
    if(!p)return res.status(404).json({error:"Mahsulot topilmadi."});
    res.json({ok:true,product:p});
  }catch(e){console.error(e);res.status(400).json({error:e.message})}
});

app.delete("/api/admin/products/:id",requireAdmin,async(req,res)=>{
  try{res.json({ok:true,...await db.deleteProduct(Number(req.params.id))})}
  catch(e){console.error(e);res.status(400).json({error:e.message})}
});

app.post("/api/admin/categories",requireAdmin,async(req,res)=>{
  try{res.json({ok:true,category:await db.createCategory(req.body)})}
  catch(e){console.error(e);res.status(400).json({error:e.message})}
});

app.put("/api/admin/categories/:slug",requireAdmin,async(req,res)=>{
  try{
    const c=await db.updateCategory(req.params.slug,req.body);
    if(!c)return res.status(404).json({error:"Kategoriya topilmadi."});
    res.json({ok:true,category:c});
  }catch(e){console.error(e);res.status(400).json({error:e.message})}
});

app.delete("/api/admin/categories/:slug",requireAdmin,async(req,res)=>{
  try{
    await db.deleteCategory(req.params.slug);
    res.json({ok:true});
  }catch(e){
    res.status(400).json({error:e.code==="CATEGORY_NOT_EMPTY"?"Avval kategoriyadagi mahsulotlarni ko‘chiring yoki o‘chiring.":e.message});
  }
});

app.post("/api/admin/branches",requireAdmin,async(req,res)=>{
  try{res.json({ok:true,branch:await db.createBranch(req.body)})}
  catch(e){res.status(400).json({error:e.message})}
});

app.put("/api/admin/branches/:id",requireAdmin,async(req,res)=>{
  try{
    const b=await db.updateBranch(Number(req.params.id),req.body);
    if(!b)return res.status(404).json({error:"Filial topilmadi."});
    res.json({ok:true,branch:b});
  }catch(e){res.status(400).json({error:e.message})}
});

app.delete("/api/admin/branches/:id",requireAdmin,async(req,res)=>{
  try{
    await db.deleteBranch(Number(req.params.id));
    res.json({ok:true});
  }catch(e){res.status(400).json({error:e.message})}
});

app.post("/api/admin/promotions",requireAdmin,async(req,res)=>{
  try{res.json({ok:true,promotion:await db.createPromotion(req.body)})}
  catch(e){res.status(400).json({error:e.message})}
});

app.put("/api/admin/promotions/:id",requireAdmin,async(req,res)=>{
  try{
    const p=await db.updatePromotion(Number(req.params.id),req.body);
    if(!p)return res.status(404).json({error:"Aksiya topilmadi."});
    res.json({ok:true,promotion:p});
  }catch(e){res.status(400).json({error:e.message})}
});

app.delete("/api/admin/promotions/:id",requireAdmin,async(req,res)=>{
  try{
    await db.deletePromotion(Number(req.params.id));
    res.json({ok:true});
  }catch(e){res.status(400).json({error:e.message})}
});

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));

app.get("/health",async(req,res)=>{
  try{
    const h=await db.health();
    res.json({
      ok:true,
      bot:!!bot,
      database:true,
      databaseTime:h.now,
      webappUrl:WEBAPP_URL||null,
      version:"5.7.0",deliveryLocation:true,promoGalleryUpload:true,promoLivePreview:true,productGalleryUpload:true,productLivePreview:true,promotionBroadcast:true,
      telegramOrderHistoryFix:true,miniAppLaunchMode:"inline"
    })
  }catch(e){
    res.status(500).json({
      ok:false,bot:!!bot,database:false,error:e.message,
      webappUrl:WEBAPP_URL||null,version:"5.7.0",deliveryLocation:true,promoGalleryUpload:true,promoLivePreview:true,productGalleryUpload:true,productLivePreview:true,promotionBroadcast:true
    })
  }
});

async function start(){
  await db.initDatabase();
  console.log("✅ PostgreSQL ulandi. Chido v5.2.0 Inline Mini App identity fix faol.");
  setupBot();
  app.listen(PORT,"0.0.0.0",()=>console.log(`✅ Chido v5.2.0 server port ${PORT}`));
}

start().catch(e=>{
  console.error("❌ Startup error:",e);
  process.exit(1);
});

process.once("SIGINT",async()=>{
  if(bot)bot.stop("SIGINT");
  await db.pool.end();
  process.exit(0)
});

process.once("SIGTERM",async()=>{
  if(bot)bot.stop("SIGTERM");
  await db.pool.end();
  process.exit(0)
});
