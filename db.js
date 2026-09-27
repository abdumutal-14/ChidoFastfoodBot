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
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS branches (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    );

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
  `);

  await seed();
}

async function seed() {
  const meta = {
    lavash:["Lavash","🌯",1], burger:["Burger","🍔",2], pizza:["Pizza","🍕",3],
    hotdog:["Hot-dog","🌭",4], set:["Setlar","🍱",5], drink:["Ichimliklar","🥤",6]
  };
  const menu = JSON.parse(fs.readFileSync(MENU_FILE, "utf8"));

  for (const [slug, items] of Object.entries(menu)) {
    const [name, emoji, order] = meta[slug] || [slug,"🍽️",99];
    await pool.query(
      `INSERT INTO categories(slug,name,emoji,sort_order)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(slug) DO UPDATE SET name=$2,emoji=$3,sort_order=$4`,
      [slug,name,emoji,order]
    );

    for (let i=0;i<items.length;i++) {
      const p = items[i];
      await pool.query(
        `INSERT INTO products(id,category_slug,name,price,description,emoji,is_active,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,TRUE,$7)
         ON CONFLICT(id) DO UPDATE SET
           category_slug=$2,name=$3,price=$4,description=$5,emoji=$6,updated_at=NOW()`,
        [p.id,slug,p.name,p.price,p.desc||"",p.emoji||"🍽️",i+1]
      );
    }
  }

  for (const b of ["Fresh City 3-qavat","Guliston Fresh 2-qavat"]) {
    await pool.query(`INSERT INTO branches(name) VALUES($1) ON CONFLICT(name) DO NOTHING`,[b]);
  }
}

async function getMenuData() {
  const cats = (await pool.query(`SELECT * FROM categories ORDER BY sort_order,slug`)).rows;
  const products = (await pool.query(
    `SELECT id,category_slug,name,price,description,emoji
     FROM products WHERE is_active=TRUE ORDER BY category_slug,sort_order,id`
  )).rows;
  const branches = (await pool.query(`SELECT name FROM branches WHERE is_active=TRUE ORDER BY id`)).rows;

  const menu = {};
  for (const c of cats) menu[c.slug] = [];
  for (const p of products) {
    if (!menu[p.category_slug]) menu[p.category_slug] = [];
    menu[p.category_slug].push({
      id:Number(p.id), name:p.name, price:Number(p.price),
      desc:p.description||"", emoji:p.emoji||"🍽️"
    });
  }
  return {brand:"Chido Fastfood",deliveryFee:0,branches:branches.map(x=>x.name),menu};
}

async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const rows = (await pool.query(
    `SELECT id,name,price FROM products WHERE is_active=TRUE AND id = ANY($1::int[])`,[ids]
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
    payment:row.payment,
    comment:row.comment||"",
    items:items.map(i=>({id:i.id?Number(i.id):null,name:i.name,price:Number(i.price),qty:Number(i.qty)})),
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
    `SELECT product_id AS id,product_name AS name,price,qty FROM order_items WHERE order_id=$1 ORDER BY id`,[id]
  )).rows;
  return mapOrder(row,items);
}

async function createOrder(order, items) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO orders(
       id,telegram_user_id,username,customer_name,phone,branch_name,order_type,address,payment,
       comment,total,delivery_fee,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [order.id,order.userId||null,order.username||null,order.customerName||"Mijoz",order.phone,
       order.branch,order.type,order.address||"",order.payment,order.comment||"",order.total,
       order.deliveryFee||0,order.status||"accepted"]
    );
    for (const i of items) {
      await c.query(
        `INSERT INTO order_items(order_id,product_id,product_name,price,qty) VALUES($1,$2,$3,$4,$5)`,
        [order.id,i.id,i.name,i.price,i.qty]
      );
    }
    await c.query("COMMIT");
    return await getOrderById(order.id);
  } catch(e) {
    await c.query("ROLLBACK");
    throw e;
  } finally { c.release(); }
}

async function listOrders(limit=200) {
  const rows = (await pool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT $1`,[limit])).rows;
  return Promise.all(rows.map(async r=>{
    const items=(await pool.query(
      `SELECT product_id AS id,product_name AS name,price,qty FROM order_items WHERE order_id=$1 ORDER BY id`,[r.id]
    )).rows;
    return mapOrder(r,items);
  }));
}

async function getUserOrders(userId,limit=10) {
  const rows=(await pool.query(
    `SELECT * FROM orders WHERE telegram_user_id=$1 ORDER BY created_at DESC LIMIT $2`,[userId,limit]
  )).rows;
  return Promise.all(rows.map(async r=>{
    const items=(await pool.query(
      `SELECT product_id AS id,product_name AS name,price,qty FROM order_items WHERE order_id=$1 ORDER BY id`,[r.id]
    )).rows;
    return mapOrder(r,items);
  }));
}

async function updateOrderStatus(id,status) {
  const row=(await pool.query(
    `UPDATE orders SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,status]
  )).rows[0];
  if(!row) return null;
  const items=(await pool.query(
    `SELECT product_id AS id,product_name AS name,price,qty FROM order_items WHERE order_id=$1 ORDER BY id`,[id]
  )).rows;
  return mapOrder(row,items);
}

async function getStats() {
  const r=(await pool.query(`
    SELECT COUNT(*)::int AS total_orders,
      COUNT(*) FILTER(WHERE created_at::date=CURRENT_DATE)::int AS today_orders,
      COALESCE(SUM(total) FILTER(WHERE created_at::date=CURRENT_DATE AND status<>'cancelled'),0)::bigint AS today_revenue,
      COUNT(*) FILTER(WHERE status IN ('accepted','cooking','courier','ready'))::int AS active_orders
    FROM orders
  `)).rows[0];
  return {
    totalOrders:Number(r.total_orders),
    todayOrders:Number(r.today_orders),
    todayRevenue:Number(r.today_revenue),
    activeOrders:Number(r.active_orders)
  };
}

async function getSetting(key) {
  const row=(await pool.query(`SELECT value FROM app_settings WHERE key=$1`,[key])).rows[0];
  return row ? row.value : null;
}

async function setSetting(key,value) {
  await pool.query(
    `INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,NOW())
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
    [key,String(value)]
  );
}

async function health(){ return (await pool.query(`SELECT NOW() AS now`)).rows[0]; }

module.exports={pool,initDatabase,getMenuData,getProductsByIds,createOrder,listOrders,getUserOrders,updateOrderStatus,getStats,getSetting,setSetting,health};
