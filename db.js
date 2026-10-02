const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL topilmadi.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const MENU_FILE = path.join(__dirname, "data", "menu.json");

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      category_slug TEXT NOT NULL REFERENCES categories(slug),
      name TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price >= 0),
      description TEXT DEFAULT '',
      emoji TEXT DEFAULT '🍽️',
      image_url TEXT DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';

    CREATE TABLE IF NOT EXISTS branches (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      badge TEXT DEFAULT 'AKSIYA',
      image_url TEXT DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS media_files (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL DEFAULT 'image',
      mime_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );


    CREATE TABLE IF NOT EXISTS bot_users (
      telegram_user_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      language_code TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      blocked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS promotion_broadcasts (
      id BIGSERIAL PRIMARY KEY,
      promotion_id BIGINT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
      telegram_user_id BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      error_message TEXT DEFAULT '',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(promotion_id, telegram_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bot_users_active
      ON bot_users(is_active, last_seen_at DESC);

    CREATE INDEX IF NOT EXISTS idx_promotion_broadcasts_promo
      ON promotion_broadcasts(promotion_id, status);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      telegram_user_id BIGINT,
      username TEXT,
      customer_name TEXT NOT NULL DEFAULT 'Mijoz',
      phone TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      order_type TEXT NOT NULL CHECK(order_type IN ('delivery','pickup')),
      address TEXT DEFAULT '',
      payment TEXT NOT NULL,
      comment TEXT DEFAULT '',
      total INTEGER NOT NULL CHECK(total >= 0),
      delivery_fee INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'accepted'
        CHECK(status IN ('accepted','cooking','courier','ready','completed','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_source TEXT DEFAULT '';

    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      qty INTEGER NOT NULL CHECK(qty > 0)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_slug);
  `);

  await seedInitialData();
}

async function seedInitialData() {
  const meta = {
    lavash:["Lavash","🌯",1],
    burger:["Burger","🍔",2],
    pizza:["Pizza","🍕",3],
    hotdog:["Hot-dog","🌭",4],
    set:["Setlar","🍱",5],
    drink:["Ichimliklar","🥤",6]
  };

  const menu = JSON.parse(fs.readFileSync(MENU_FILE, "utf8"));

  // IMPORTANT: DO NOTHING on conflict so admin edits are never overwritten on restart/deploy.
  for (const [slug, items] of Object.entries(menu)) {
    const [name, emoji, order] = meta[slug] || [slug,"🍽️",99];

    await pool.query(
      `INSERT INTO categories(slug,name,emoji,sort_order)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(slug) DO NOTHING`,
      [slug,name,emoji,order]
    );

    for (let i=0;i<items.length;i++) {
      const p = items[i];
      await pool.query(
        `INSERT INTO products(
          id,category_slug,name,price,description,emoji,image_url,is_active,sort_order
        ) VALUES($1,$2,$3,$4,$5,$6,'',TRUE,$7)
        ON CONFLICT(id) DO NOTHING`,
        [p.id,slug,p.name,p.price,p.desc||"",p.emoji||"🍽️",i+1]
      );
    }
  }

  for (const b of ["Fresh City 3-qavat","Guliston Fresh 2-qavat"]) {
    await pool.query(
      `INSERT INTO branches(name) VALUES($1) ON CONFLICT(name) DO NOTHING`,
      [b]
    );
  }
}

async function getMenuData() {
  const categories = (await pool.query(
    `SELECT slug,name,emoji,sort_order FROM categories ORDER BY sort_order,slug`
  )).rows;

  const products = (await pool.query(
    `SELECT id,category_slug,name,price,description,emoji,image_url
     FROM products
     WHERE is_active=TRUE
     ORDER BY category_slug,sort_order,id`
  )).rows;

  const branches = (await pool.query(
    `SELECT id,name FROM branches WHERE is_active=TRUE ORDER BY id`
  )).rows;

  const promotions = (await pool.query(
    `SELECT id,title,description,badge,image_url
     FROM promotions
     WHERE is_active=TRUE
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
     ORDER BY id DESC`
  )).rows;

  const menu = {};
  for (const c of categories) menu[c.slug] = [];
  for (const p of products) {
    if (!menu[p.category_slug]) menu[p.category_slug] = [];
    menu[p.category_slug].push({
      id:Number(p.id),
      name:p.name,
      price:Number(p.price),
      desc:p.description||"",
      emoji:p.emoji||"🍽️",
      imageUrl:p.image_url||""
    });
  }

  return {
    brand:"Chido Fastfood",
    deliveryFee:0,
    branches:branches.map(x=>x.name),
    categories:categories.map(c=>({
      slug:c.slug,name:c.name,emoji:c.emoji||"🍽️",sortOrder:Number(c.sort_order)
    })),
    promotions:promotions.map(p=>({
      id:Number(p.id),title:p.title,description:p.description||"",
      badge:p.badge||"AKSIYA",imageUrl:p.image_url||""
    })),
    menu
  };
}

async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const rows = (await pool.query(
    `SELECT id,name,price FROM products
     WHERE is_active=TRUE AND id = ANY($1::int[])`,
    [ids]
  )).rows;
  return rows.map(r=>({...r,id:Number(r.id),price:Number(r.price)}));
}

function mapOrder(row, items=[]) {
  return {
    id:row.id,
    userId:row.telegram_user_id ? Number(row.telegram_user_id) : null,
    username:row.username,
    customerName:row.customer_name,
    phone:row.phone,
    branch:row.branch_name,
    type:row.order_type,
    address:row.address||"",
    latitude:row.latitude===null||row.latitude===undefined?null:Number(row.latitude),
    longitude:row.longitude===null||row.longitude===undefined?null:Number(row.longitude),
    locationSource:row.location_source||"",
    payment:row.payment,
    comment:row.comment||"",
    items:items.map(i=>({
      id:i.id?Number(i.id):null,
      name:i.name,
      price:Number(i.price),
      qty:Number(i.qty)
    })),
    total:Number(row.total),
    deliveryFee:Number(row.delivery_fee),
    status:row.status,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

async function getOrderById(id) {
  const row = (await pool.query(`SELECT * FROM orders WHERE id=$1`,[id])).rows[0];
  if (!row) return null;

  const items = (await pool.query(
    `SELECT product_id AS id,product_name AS name,price,qty
     FROM order_items WHERE order_id=$1 ORDER BY id`,
    [id]
  )).rows;

  return mapOrder(row,items);
}

async function createOrder(order, items) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    await c.query(
      `INSERT INTO orders(
       id,telegram_user_id,username,customer_name,phone,branch_name,order_type,
       address,latitude,longitude,location_source,payment,comment,total,delivery_fee,status
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        order.id,order.userId||null,order.username||null,order.customerName||"Mijoz",
        order.phone,order.branch,order.type,order.address||"",
        order.latitude??null,order.longitude??null,order.locationSource||"",
        order.payment,order.comment||"",order.total,order.deliveryFee||0,order.status||"accepted"
      ]
    );

    for (const i of items) {
      await c.query(
        `INSERT INTO order_items(order_id,product_id,product_name,price,qty)
         VALUES($1,$2,$3,$4,$5)`,
        [order.id,i.id,i.name,i.price,i.qty]
      );
    }

    await c.query("COMMIT");
    return await getOrderById(order.id);
  } catch(e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function listOrders(limit=300) {
  const rows = (await pool.query(
    `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )).rows;

  return Promise.all(rows.map(async r=>{
    const items=(await pool.query(
      `SELECT product_id AS id,product_name AS name,price,qty
       FROM order_items WHERE order_id=$1 ORDER BY id`,
      [r.id]
    )).rows;
    return mapOrder(r,items);
  }));
}

async function getUserOrders(userId,limit=10) {
  const rows=(await pool.query(
    `SELECT * FROM orders
     WHERE telegram_user_id=$1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId,limit]
  )).rows;

  return Promise.all(rows.map(async r=>{
    const items=(await pool.query(
      `SELECT product_id AS id,product_name AS name,price,qty
       FROM order_items WHERE order_id=$1 ORDER BY id`,
      [r.id]
    )).rows;
    return mapOrder(r,items);
  }));
}

async function updateOrderStatus(id,status) {
  const row=(await pool.query(
    `UPDATE orders SET status=$2,updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id,status]
  )).rows[0];

  if(!row) return null;

  const items=(await pool.query(
    `SELECT product_id AS id,product_name AS name,price,qty
     FROM order_items WHERE order_id=$1 ORDER BY id`,
    [id]
  )).rows;

  return mapOrder(row,items);
}

async function getStats() {
  const r=(await pool.query(`
    SELECT
      COUNT(*)::int AS total_orders,
      COUNT(DISTINCT telegram_user_id) FILTER(WHERE telegram_user_id IS NOT NULL)::int AS customers,
      COUNT(*) FILTER(WHERE created_at::date=CURRENT_DATE)::int AS today_orders,
      COALESCE(SUM(total) FILTER(
        WHERE created_at::date=CURRENT_DATE AND status<>'cancelled'
      ),0)::bigint AS today_revenue,
      COUNT(*) FILTER(
        WHERE status IN ('accepted','cooking','courier','ready')
      )::int AS active_orders
    FROM orders
  `)).rows[0];

  const days=(await pool.query(`
    SELECT
      d::date AS day,
      COUNT(o.id)::int AS orders,
      COALESCE(SUM(o.total) FILTER(WHERE o.status<>'cancelled'),0)::bigint AS revenue
    FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') d
    LEFT JOIN orders o ON o.created_at::date=d::date
    GROUP BY d
    ORDER BY d
  `)).rows;

  const top=(await pool.query(`
    SELECT product_name AS name, SUM(qty)::int AS qty, SUM(price*qty)::bigint AS revenue
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    WHERE o.status<>'cancelled'
    GROUP BY product_name
    ORDER BY qty DESC, revenue DESC
    LIMIT 5
  `)).rows;

  return {
    totalOrders:Number(r.total_orders),
    customers:Number(r.customers),
    todayOrders:Number(r.today_orders),
    todayRevenue:Number(r.today_revenue),
    activeOrders:Number(r.active_orders),
    last7Days:days.map(x=>({
      day:x.day,orders:Number(x.orders),revenue:Number(x.revenue)
    })),
    topProducts:top.map(x=>({
      name:x.name,qty:Number(x.qty),revenue:Number(x.revenue)
    }))
  };
}

// ---------- Admin product/category/branch/promotion CRUD ----------
async function adminCatalog() {
  const categories=(await pool.query(
    `SELECT slug,name,emoji,sort_order FROM categories ORDER BY sort_order,slug`
  )).rows;

  const products=(await pool.query(
    `SELECT id,category_slug,name,price,description,emoji,image_url,is_active,sort_order
     FROM products ORDER BY category_slug,sort_order,id`
  )).rows;

  const branches=(await pool.query(
    `SELECT id,name,is_active FROM branches ORDER BY id`
  )).rows;

  const promotions=(await pool.query(
    `SELECT id,title,description,badge,image_url,is_active,starts_at,ends_at
     FROM promotions ORDER BY id DESC`
  )).rows;

  return {
    categories:categories.map(c=>({...c,sort_order:Number(c.sort_order)})),
    products:products.map(p=>({
      ...p,id:Number(p.id),price:Number(p.price),
      sort_order:Number(p.sort_order)
    })),
    branches:branches.map(b=>({...b,id:Number(b.id)})),
    promotions:promotions.map(p=>({...p,id:Number(p.id)}))
  };
}

async function createProduct(p) {
  const max=(await pool.query(`SELECT COALESCE(MAX(id),0)+1 AS id FROM products`)).rows[0];
  const id=Number(p.id||max.id);

  const row=(await pool.query(
    `INSERT INTO products(
      id,category_slug,name,price,description,emoji,image_url,is_active,sort_order
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *`,
    [
      id,p.category_slug,p.name,Number(p.price),p.description||"",
      p.emoji||"🍽️",p.image_url||"",p.is_active!==false,Number(p.sort_order||0)
    ]
  )).rows[0];

  return row;
}

async function updateProduct(id,p) {
  return (await pool.query(
    `UPDATE products SET
      category_slug=$2,name=$3,price=$4,description=$5,emoji=$6,image_url=$7,
      is_active=$8,sort_order=$9,updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [
      id,p.category_slug,p.name,Number(p.price),p.description||"",
      p.emoji||"🍽️",p.image_url||"",p.is_active!==false,Number(p.sort_order||0)
    ]
  )).rows[0]||null;
}

async function deleteProduct(id) {
  const used=(await pool.query(
    `SELECT COUNT(*)::int AS n FROM order_items WHERE product_id=$1`,
    [id]
  )).rows[0].n;

  if(used>0) {
    await pool.query(`UPDATE products SET is_active=FALSE,updated_at=NOW() WHERE id=$1`,[id]);
    return {softDeleted:true};
  }

  await pool.query(`DELETE FROM products WHERE id=$1`,[id]);
  return {deleted:true};
}

async function createCategory(c) {
  const slug=String(c.slug||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-");
  if(!slug) throw new Error("Kategoriya slug kerak.");

  return (await pool.query(
    `INSERT INTO categories(slug,name,emoji,sort_order)
     VALUES($1,$2,$3,$4)
     RETURNING *`,
    [slug,c.name,c.emoji||"🍽️",Number(c.sort_order||0)]
  )).rows[0];
}

async function updateCategory(slug,c) {
  return (await pool.query(
    `UPDATE categories SET name=$2,emoji=$3,sort_order=$4
     WHERE slug=$1 RETURNING *`,
    [slug,c.name,c.emoji||"🍽️",Number(c.sort_order||0)]
  )).rows[0]||null;
}

async function deleteCategory(slug) {
  const used=(await pool.query(
    `SELECT COUNT(*)::int AS n FROM products WHERE category_slug=$1`,
    [slug]
  )).rows[0].n;

  if(used>0) {
    const err=new Error("Bu kategoriyada mahsulotlar bor.");
    err.code="CATEGORY_NOT_EMPTY";
    throw err;
  }

  await pool.query(`DELETE FROM categories WHERE slug=$1`,[slug]);
}

async function createBranch(b) {
  return (await pool.query(
    `INSERT INTO branches(name,is_active) VALUES($1,$2) RETURNING *`,
    [b.name,b.is_active!==false]
  )).rows[0];
}

async function updateBranch(id,b) {
  return (await pool.query(
    `UPDATE branches SET name=$2,is_active=$3 WHERE id=$1 RETURNING *`,
    [id,b.name,b.is_active!==false]
  )).rows[0]||null;
}

async function deleteBranch(id) {
  await pool.query(`DELETE FROM branches WHERE id=$1`,[id]);
}

async function createPromotion(p) {
  return (await pool.query(
    `INSERT INTO promotions(
      title,description,badge,image_url,is_active,starts_at,ends_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      p.title,p.description||"",p.badge||"AKSIYA",p.image_url||"",
      p.is_active!==false,p.starts_at||null,p.ends_at||null
    ]
  )).rows[0];
}

async function updatePromotion(id,p) {
  return (await pool.query(
    `UPDATE promotions SET
      title=$2,description=$3,badge=$4,image_url=$5,is_active=$6,
      starts_at=$7,ends_at=$8,updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [
      id,p.title,p.description||"",p.badge||"AKSIYA",p.image_url||"",
      p.is_active!==false,p.starts_at||null,p.ends_at||null
    ]
  )).rows[0]||null;
}

async function deletePromotion(id) {
  await pool.query(`DELETE FROM promotions WHERE id=$1`,[id]);
}


async function saveMedia(filename,mimeType,buffer) {
  const row=(await pool.query(
    `INSERT INTO media_files(filename,mime_type,data)
     VALUES($1,$2,$3)
     RETURNING id`,
    [filename||"image",mimeType,buffer]
  )).rows[0];
  return Number(row.id);
}

async function getMedia(id) {
  return (await pool.query(
    `SELECT id,filename,mime_type,data,created_at
     FROM media_files WHERE id=$1`,
    [id]
  )).rows[0]||null;
}


async function upsertBotUser(user) {
  if(!user?.id) return;
  await pool.query(
    `INSERT INTO bot_users(
      telegram_user_id,username,first_name,last_name,language_code,
      is_active,blocked_at,created_at,updated_at,last_seen_at
    ) VALUES($1,$2,$3,$4,$5,TRUE,NULL,NOW(),NOW(),NOW())
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      username=EXCLUDED.username,
      first_name=EXCLUDED.first_name,
      last_name=EXCLUDED.last_name,
      language_code=EXCLUDED.language_code,
      is_active=TRUE,
      blocked_at=NULL,
      updated_at=NOW(),
      last_seen_at=NOW()`,
    [
      user.id,
      user.username||null,
      user.first_name||null,
      user.last_name||null,
      user.language_code||null
    ]
  );
}

async function markBotUserBlocked(userId) {
  await pool.query(
    `UPDATE bot_users
     SET is_active=FALSE, blocked_at=NOW(), updated_at=NOW()
     WHERE telegram_user_id=$1`,
    [userId]
  );
}

async function listActiveBotUsers(limit=50000) {
  const rows=(await pool.query(
    `SELECT telegram_user_id,username,first_name,last_name,language_code
     FROM bot_users
     WHERE is_active=TRUE
     ORDER BY last_seen_at DESC
     LIMIT $1`,
    [limit]
  )).rows;

  return rows.map(r=>({
    userId:Number(r.telegram_user_id),
    username:r.username,
    firstName:r.first_name,
    lastName:r.last_name,
    languageCode:r.language_code
  }));
}

async function getBotUserStats() {
  const row=(await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE is_active=TRUE)::int AS active,
      COUNT(*) FILTER(WHERE is_active=FALSE)::int AS inactive
    FROM bot_users
  `)).rows[0];

  return {
    total:Number(row.total),
    active:Number(row.active),
    inactive:Number(row.inactive)
  };
}

async function getPromotionById(id) {
  return (await pool.query(
    `SELECT id,title,description,badge,image_url,is_active,starts_at,ends_at
     FROM promotions WHERE id=$1`,
    [id]
  )).rows[0]||null;
}

async function wasPromotionSentToUser(promotionId,userId) {
  const row=(await pool.query(
    `SELECT 1 FROM promotion_broadcasts
     WHERE promotion_id=$1 AND telegram_user_id=$2 AND status='sent'
     LIMIT 1`,
    [promotionId,userId]
  )).rows[0];
  return !!row;
}

async function recordPromotionBroadcast(promotionId,userId,status,errorMessage="") {
  await pool.query(
    `INSERT INTO promotion_broadcasts(
      promotion_id,telegram_user_id,status,error_message,sent_at
    ) VALUES($1,$2,$3,$4,NOW())
    ON CONFLICT(promotion_id,telegram_user_id) DO UPDATE SET
      status=EXCLUDED.status,
      error_message=EXCLUDED.error_message,
      sent_at=NOW()`,
    [promotionId,userId,status,errorMessage||""]
  );
}

async function getPromotionBroadcastStats(promotionId) {
  const row=(await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE status='sent')::int AS sent,
      COUNT(*) FILTER(WHERE status='failed')::int AS failed,
      COUNT(*) FILTER(WHERE status='skipped')::int AS skipped
    FROM promotion_broadcasts
    WHERE promotion_id=$1
  `,[promotionId])).rows[0];

  return {
    total:Number(row.total),
    sent:Number(row.sent),
    failed:Number(row.failed),
    skipped:Number(row.skipped)
  };
}

async function getSetting(key) {
  const row=(await pool.query(
    `SELECT value FROM app_settings WHERE key=$1`,
    [key]
  )).rows[0];
  return row ? row.value : null;
}

async function setSetting(key,value) {
  await pool.query(
    `INSERT INTO app_settings(key,value,updated_at)
     VALUES($1,$2,NOW())
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
    [key,String(value)]
  );
}

async function health(){
  return (await pool.query(`SELECT NOW() AS now`)).rows[0];
}

module.exports={
  pool,initDatabase,getMenuData,getProductsByIds,createOrder,listOrders,getUserOrders,
  updateOrderStatus,getStats,adminCatalog,createProduct,updateProduct,deleteProduct,
  createCategory,updateCategory,deleteCategory,createBranch,updateBranch,deleteBranch,
  createPromotion,updatePromotion,deletePromotion,saveMedia,getMedia,upsertBotUser,markBotUserBlocked,listActiveBotUsers,getBotUserStats,getPromotionById,wasPromotionSentToUser,recordPromotionBroadcast,getPromotionBroadcastStats,getSetting,setSetting,health
};
