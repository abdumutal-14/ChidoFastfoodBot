const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const state = {
  data: null,
  currentCategory: null,
  cart: {}
};

const $ = s => document.querySelector(s);
const money = n => Number(n).toLocaleString("uz-UZ") + " so‘m";

async function load() {
  const res = await fetch("/api/menu");
  state.data = await res.json();
  state.currentCategory = Object.keys(state.data.menu)[0];
  renderCategories();
  renderProducts();
  fillBranches();
}
function catTitle(k) {
  return {
    lavash:"🌯 Lavash", burger:"🍔 Burger", pizza:"🍕 Pizza",
    hotdog:"🌭 Hot-dog", set:"🍱 Setlar", drink:"🥤 Ichimliklar"
  }[k] || k;
}
function renderCategories() {
  $("#categories").innerHTML = Object.keys(state.data.menu).map(k =>
    `<button class="category-btn ${k===state.currentCategory?"active":""}" data-cat="${k}">${catTitle(k)}</button>`
  ).join("");
  document.querySelectorAll(".category-btn").forEach(btn => {
    btn.onclick = () => {
      state.currentCategory = btn.dataset.cat;
      renderCategories();
      renderProducts();
    };
  });
}
function renderProducts() {
  const products = state.data.menu[state.currentCategory] || [];
  $("#products").innerHTML = products.map(p => `
    <article class="product">
      <div class="product-art">${p.emoji || "🍽️"}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <p>${escapeHtml(p.desc || "")}</p>
      <div class="price">${money(p.price)}</div>
      <button class="add" data-add="${p.id}">+ Savatchaga</button>
    </article>
  `).join("");
  document.querySelectorAll("[data-add]").forEach(btn => btn.onclick = () => add(Number(btn.dataset.add)));
}
function catalog() {
  return Object.values(state.data.menu).flat();
}
function add(id) {
  state.cart[id] = (state.cart[id] || 0) + 1;
  updateCartCount();
  tg?.HapticFeedback?.impactOccurred("light");
}
function updateCartCount() {
  const count = Object.values(state.cart).reduce((a,b)=>a+b,0);
  $("#cartCount").textContent = count;
}
function showCart() {
  renderCart();
  $("#cartSheet").classList.remove("hidden");
}
function renderCart() {
  const items = catalog().filter(p => state.cart[p.id]).map(p => ({...p, qty: state.cart[p.id]}));
  if (!items.length) {
    $("#cartItems").innerHTML = `<p>Savatcha hozircha bo‘sh.</p>`;
    $("#cartTotal").textContent = money(0);
    $("#checkoutBtn").disabled = true;
    return;
  }
  $("#checkoutBtn").disabled = false;
  $("#cartItems").innerHTML = items.map(p => `
    <div class="cart-line">
      <div>
        <h4>${escapeHtml(p.name)}</h4>
        <small>${money(p.price)} × ${p.qty}</small>
      </div>
      <div class="qty">
        <button data-dec="${p.id}">−</button>
        <b>${p.qty}</b>
        <button data-inc="${p.id}">+</button>
      </div>
    </div>
  `).join("");
  const total = items.reduce((s,p)=>s+p.price*p.qty,0);
  $("#cartTotal").textContent = money(total);

  document.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => {
    state.cart[b.dataset.inc]++; renderCart(); updateCartCount();
  });
  document.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => {
    const id = b.dataset.dec;
    state.cart[id]--;
    if (state.cart[id] <= 0) delete state.cart[id];
    renderCart(); updateCartCount();
  });
}
function fillBranches() {
  $("#branch").innerHTML = state.data.branches.map(x => `<option>${escapeHtml(x)}</option>`).join("");
}
function buildItems() {
  return Object.entries(state.cart).map(([id,qty]) => ({id:Number(id), qty}));
}
async function submitOrder() {
  $("#checkoutError").textContent = "";
  const user = tg?.initDataUnsafe?.user;
  const payload = {
    userId: user?.id || null,
    username: user?.username || null,
    customerName: [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Mijoz",
    phone: $("#phone").value.trim(),
    branch: $("#branch").value,
    type: $("#orderType").value,
    address: $("#orderType").value === "delivery" ? $("#address").value.trim() : "",
    payment: $("#payment").value,
    comment: $("#comment").value.trim(),
    items: buildItems()
  };
  if (!payload.phone) {
    $("#checkoutError").textContent = "Telefon raqamni kiriting.";
    return;
  }
  if (payload.type === "delivery" && !payload.address) {
    $("#checkoutError").textContent = "Yetkazib berish manzilini kiriting.";
    return;
  }
  if (!payload.items.length) {
    $("#checkoutError").textContent = "Savatcha bo‘sh.";
    return;
  }

  $("#submitOrder").disabled = true;
  $("#submitOrder").textContent = "Yuborilmoqda...";
  try {
    const res = await fetch("/api/orders", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Xatolik");

    state.cart = {};
    updateCartCount();
    $("#checkoutSheet").classList.add("hidden");
    $("#successText").textContent = `Buyurtma #${data.order.id} • ${money(data.order.total)}`;
    $("#successSheet").classList.remove("hidden");
    tg?.HapticFeedback?.notificationOccurred("success");
  } catch (e) {
    $("#checkoutError").textContent = e.message;
  } finally {
    $("#submitOrder").disabled = false;
    $("#submitOrder").textContent = "✅ Buyurtmani tasdiqlash";
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

$("#cartBtn").onclick = showCart;
$("#closeCart").onclick = () => $("#cartSheet").classList.add("hidden");
$("#checkoutBtn").onclick = () => {
  if (!Object.keys(state.cart).length) return;
  $("#cartSheet").classList.add("hidden");
  $("#checkoutSheet").classList.remove("hidden");
};
$("#closeCheckout").onclick = () => $("#checkoutSheet").classList.add("hidden");
$("#submitOrder").onclick = submitOrder;
$("#successClose").onclick = () => {
  $("#successSheet").classList.add("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
};
$("#orderType").onchange = () => {
  const delivery = $("#orderType").value === "delivery";
  $("#address").style.display = delivery ? "" : "none";
  $("#addressLabel").style.display = delivery ? "" : "none";
};

load();
