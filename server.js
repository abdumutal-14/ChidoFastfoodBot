require("dotenv").config();

const path=require("path");
const express=require("express");
const {Telegraf,Markup}=require("telegraf");
const db=require("./db");

const app=express();
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const PORT=Number(process.env.PORT||3000);
const BOT_TOKEN=process.env.BOT_TOKEN||"";
const WEBAPP_URL=(process.env.WEBAPP_URL||"").replace(/\/$/,"");
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"chido2026";

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

  const mainKeyboard=()=>Markup.keyboard([
    ...(WEBAPP_URL?[[Markup.button.webApp("🍔 MENYU / BUYURTMA",`${WEBAPP_URL}/`)]]:[]),
    ["📦 Buyurtmalarim","🔥 Aksiyalar"],
    ["📍 Filiallar","☎️ Aloqa"]
  ]).resize();

  bot.start(ctx=>ctx.reply(
    `Assalomu alaykum, ${ctx.from.first_name||"mijoz"}! 👋\n\n`+
    `🍔 Chido Fastfood botiga xush kelibsiz.\n🚚 Yetkazib berish bepul.`,
    mainKeyboard()
  ));

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

    const order=await db.createOrder({
      id:orderId(),
      userId:b.userId||null,
      username:b.username||null,
      customerName:b.customerName||"Mijoz",
      phone:String(b.phone),
      branch:b.branch,
      type:b.type,
      address:b.address||"",
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
      version:"5.0.0"
    })
  }catch(e){
    res.status(500).json({
      ok:false,bot:!!bot,database:false,error:e.message,
      webappUrl:WEBAPP_URL||null,version:"5.0.0"
    })
  }
});

async function start(){
  await db.initDatabase();
  console.log("✅ PostgreSQL ulandi va v5 schema tayyor.");
  setupBot();
  app.listen(PORT,"0.0.0.0",()=>console.log(`✅ Chido v5 server port ${PORT}`));
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
