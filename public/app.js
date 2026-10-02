const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const state = {
  data: null,
  currentCategory: null,
  cart: {},
  deliveryLocation: null,
  mapCandidate: null
};

const $ = s => document.querySelector(s);
const money = n => Number(n).toLocaleString("uz-UZ") + " so‘m";

async function load() {
  const res = await fetch("/api/menu");
  state.data = await res.json();
  state.currentCategory = Object.keys(state.data.menu)[0];
  renderPromotions();
  renderCategories();
  renderProducts();
  fillBranches();
}
function catTitle(k) {
  const c = state.data?.categories?.find(x => x.slug === k);
  return c ? `${c.emoji || "🍽️"} ${c.name}` : k;
}
function renderPromotions() {
  const box = $("#promotions");
  const promos = state.data?.promotions || [];
  if (!promos.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = promos.map(p => `
    <div style="background:linear-gradient(135deg,#ed0033,#ff526e);color:white;border-radius:18px;padding:14px;margin-bottom:14px">
      <b style="font-size:12px;opacity:.85">${escapeHtml(p.badge || "AKSIYA")}</b>
      <div style="font-size:18px;font-weight:900;margin-top:4px">${escapeHtml(p.title)}</div>
      <div style="font-size:13px;margin-top:4px;opacity:.94">${escapeHtml(p.description || "")}</div>
    </div>
  `).join("");
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
      <div class="product-art">${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}">` : (p.emoji || "🍽️")}</div>
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

let locationMap = null;
let locationMarker = null;

function formatCoords(lat,lng) {
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

function setDeliveryLocation(lat,lng,source="map") {
  state.deliveryLocation = {
    latitude:Number(lat),
    longitude:Number(lng),
    source
  };

  $("#locationStatus").innerHTML =
    `✅ Lokatsiya tanlandi<br><b>${formatCoords(lat,lng)}</b>`;

  const link = $("#locationMapLink");
  link.href = `https://www.google.com/maps?q=${lat},${lng}`;
  link.classList.remove("hidden");
  tg?.HapticFeedback?.notificationOccurred?.("success");
}

function clearDeliveryLocation() {
  state.deliveryLocation = null;
  state.mapCandidate = null;
  $("#locationStatus").textContent = "Lokatsiya hali tanlanmagan";
  $("#locationMapLink").classList.add("hidden");
}

function requestCurrentLocation() {
  const btn = $("#useMyLocation");
  if (!navigator.geolocation) {
    $("#checkoutError").textContent = "Qurilmangiz lokatsiya funksiyasini qo‘llamaydi. Xaritadan tanlang.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "📍 Aniqlanmoqda...";
  $("#checkoutError").textContent = "";

  navigator.geolocation.getCurrentPosition(
    pos => {
      setDeliveryLocation(
        pos.coords.latitude,
        pos.coords.longitude,
        "current"
      );
      btn.disabled = false;
      btn.textContent = "📍 Hozirgi lokatsiyam";
    },
    err => {
      const msg =
        err.code===1
          ? "Lokatsiya ruxsati berilmadi. Xaritadan tanlashingiz mumkin."
          : "Lokatsiyani aniqlab bo‘lmadi. Xaritadan tanlang.";
      $("#checkoutError").textContent = msg;
      btn.disabled = false;
      btn.textContent = "📍 Hozirgi lokatsiyam";
    },
    {enableHighAccuracy:true,timeout:12000,maximumAge:60000}
  );
}

function initLocationMap() {
  if (!window.L) {
    $("#mapCoordinates").textContent = "Xarita yuklanmadi. Internetni tekshiring.";
    return;
  }

  if (!locationMap) {
    const defaultCenter = state.deliveryLocation
      ? [state.deliveryLocation.latitude,state.deliveryLocation.longitude]
      : [41.0167,70.1436]; // Angren default center

    locationMap = L.map("locationMap").setView(defaultCenter,14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,
      attribution:"© OpenStreetMap"
    }).addTo(locationMap);

    locationMap.on("click", e => {
      state.mapCandidate = {
        latitude:e.latlng.lat,
        longitude:e.latlng.lng
      };

      if (!locationMarker) {
        locationMarker = L.marker(e.latlng).addTo(locationMap);
      } else {
        locationMarker.setLatLng(e.latlng);
      }

      $("#mapCoordinates").textContent =
        `Tanlangan joy: ${formatCoords(e.latlng.lat,e.latlng.lng)}`;
      $("#confirmMapLocation").disabled = false;
    });
  }

  if (state.deliveryLocation) {
    const point=[state.deliveryLocation.latitude,state.deliveryLocation.longitude];
    locationMap.setView(point,16);
    if (!locationMarker) locationMarker=L.marker(point).addTo(locationMap);
    else locationMarker.setLatLng(point);
    state.mapCandidate={
      latitude:state.deliveryLocation.latitude,
      longitude:state.deliveryLocation.longitude
    };
    $("#mapCoordinates").textContent =
      `Tanlangan joy: ${formatCoords(point[0],point[1])}`;
    $("#confirmMapLocation").disabled=false;
  } else {
    $("#mapCoordinates").textContent="Xaritadan kerakli joyni bosing";
    $("#confirmMapLocation").disabled=true;
  }

  setTimeout(()=>locationMap.invalidateSize(),120);
}

function openLocationMap() {
  $("#mapSheet").classList.remove("hidden");
  initLocationMap();

  // If user allows current location, use it only to center the map.
  if (!state.deliveryLocation && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!locationMap) return;
        locationMap.setView([pos.coords.latitude,pos.coords.longitude],16);
      },
      ()=>{},
      {enableHighAccuracy:false,timeout:5000,maximumAge:120000}
    );
  }
}


async function submitOrder() {
  $("#checkoutError").textContent = "";
  const user = tg?.initDataUnsafe?.user;

  if (!tg?.initData || !user?.id) {
    $("#checkoutError").textContent =
      "Telegram foydalanuvchisi aniqlanmadi. Mini Appni yoping, botga /start yuboring va xabardagi yangi “🍔 MENYU / BUYURTMA” tugmasidan qayta oching.";
    return;
  }
  const payload = {
    userId: user?.id || null,
    username: user?.username || null,
    customerName: [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Mijoz",
    initData: tg?.initData || "",
    phone: $("#phone").value.trim(),
    branch: $("#branch").value,
    type: $("#orderType").value,
    address: "",
    latitude: $("#orderType").value === "delivery" ? state.deliveryLocation?.latitude ?? null : null,
    longitude: $("#orderType").value === "delivery" ? state.deliveryLocation?.longitude ?? null : null,
    locationSource: $("#orderType").value === "delivery" ? state.deliveryLocation?.source ?? "" : "",
    payment: $("#payment").value,
    comment: $("#comment").value.trim(),
    items: buildItems()
  };
  if (!payload.phone) {
    $("#checkoutError").textContent = "Telefon raqamni kiriting.";
    return;
  }
  if (payload.type === "delivery" && (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude))) {
    $("#checkoutError").textContent = "Yetkazib berish uchun lokatsiyani tanlang.";
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
    clearDeliveryLocation();
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
  $("#locationSection").style.display = delivery ? "" : "none";
  if (!delivery) clearDeliveryLocation();
};

$("#useMyLocation").onclick = requestCurrentLocation;
$("#openMapPicker").onclick = openLocationMap;
$("#closeMapPicker").onclick = () => $("#mapSheet").classList.add("hidden");
$("#confirmMapLocation").onclick = () => {
  if (!state.mapCandidate) return;
  setDeliveryLocation(
    state.mapCandidate.latitude,
    state.mapCandidate.longitude,
    "map"
  );
  $("#mapSheet").classList.add("hidden");
};

load();
