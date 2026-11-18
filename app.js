import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0ZAXVuZ0R46HrZnuIYA7V3HgW91OOEj0",
  authDomain: "coins-app-e4978.firebaseapp.com",
  databaseURL: "https://coins-app-e4978-default-rtdb.firebaseio.com",
  projectId: "coins-app-e4978",
  storageBucket: "coins-app-e4978.firebasestorage.app",
  messagingSenderId: "957864203705",
  appId: "1:957864203705:web:bfffbaec3c1f5920be9268"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function generateCoinPackages() {
  const list = [
    { sku: "coins_50", type: "coins", price: 0.51, amount: 50, label: "50 Coins" }
  ];
  for (let i = 1; i <= 100; i++) {
    const amt = i * 100;
    list.push({
      sku: `coins_${amt}`,
      type: "coins",
      price: Number((i + 0.01).toFixed(2)),
      amount: amt,
      label: `${amt.toLocaleString()} Coins`
    });
  }
  return list;
}

function generateDiamondPackages() {
  const list = [];
  for (let i = 1; i <= 100; i++) {
    list.push({
      sku: `diamonds_${i}`,
      type: "diamonds",
      price: i,
      amount: i,
      label: `${i} ${i === 1 ? "Diamond" : "Diamonds"}`
    });
  }
  return list;
}

const coinPackages = generateCoinPackages();
const diamondPackages = generateDiamondPackages();
const allPackagesBySku = {};
[...coinPackages, ...diamondPackages].forEach((p) => {
  allPackagesBySku[p.sku] = p;
});

const PLAY_BILLING_METHOD = "https://play.google.com/billing";
let digitalGoodsService = null;
let isPlayBillingAvailable = false;

async function initGooglePlayBilling() {
  const banner = document.getElementById("billing-banner");
  if ("getDigitalGoodsService" in window) {
    try {
      digitalGoodsService = await window.getDigitalGoodsService(PLAY_BILLING_METHOD);
      if (digitalGoodsService) {
        isPlayBillingAvailable = true;
        banner.className = "billing-banner live";
        banner.innerHTML = "✅ <strong>Google Play Billing Active:</strong> রিয়েল Play Store পেমেন্ট সিস্টেম কানেক্ট হয়েছে।";
        banner.classList.remove("hidden");
        await recoverUnconsumedPurchases();
        return;
      }
    } catch (err) {
      console.info("Digital Goods Service unavailable outside Play Store TWA:", err.message);
    }
  }

  isPlayBillingAvailable = false;
  banner.className = "billing-banner test";
  banner.innerHTML = "ℹ️ <strong>Browser Preview Mode:</strong> সাধারণ ব্রাউজারে টেস্ট মোড চালু আছে। Play Store-এ TWA অ্যাপ হিসেবে আপলোড করলে আসল Google Play Billing চালু হবে।";
  banner.classList.remove("hidden");
}

async function recoverUnconsumedPurchases() {
  if (!digitalGoodsService || !currentUserUid) return;
  try {
    const purchases = await digitalGoodsService.listPurchases();
    for (const p of purchases) {
      const pkg = allPackagesBySku[p.itemId];
      if (pkg) {
        await creditPurchaseToFirestore(pkg, p.purchaseToken);
        await digitalGoodsService.consume(p.purchaseToken);
        showToast(`🔄 Recovered ${pkg.label}!`);
      }
    }
  } catch (err) {
    console.warn("Purchase recovery skipped:", err);
  }
}

async function executeGooglePlayPurchase(pkg) {
  if (!("PaymentRequest" in window)) {
    throw new Error("PaymentRequest API supported নয়");
  }

  let displayCurrency = "USD";
  let displayValue = pkg.price.toFixed(2);
  try {
    const skuDetails = await digitalGoodsService.getDetails([pkg.sku]);
    if (skuDetails && skuDetails.length > 0 && skuDetails[0].price) {
      displayCurrency = skuDetails[0].price.currency;
      displayValue = skuDetails[0].price.value;
    }
  } catch (e) {
    console.warn("Using fallback price.");
  }

  const request = new PaymentRequest(
    [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku: pkg.sku } }],
    { total: { label: pkg.label, amount: { currency: displayCurrency, value: String(displayValue) } } }
  );

  const paymentResponse = await request.show();
  const { purchaseToken } = paymentResponse.details || {};
  if (!purchaseToken) {
    await paymentResponse.complete("fail");
    throw new Error("Purchase token পাওয়া যায়নি");
  }

  await creditPurchaseToFirestore(pkg, purchaseToken);
  await digitalGoodsService.consume(purchaseToken);
  await paymentResponse.complete("success");
}

function generateRandomName() {
  const adjectives = ["Cosmic", "Shadow", "Golden", "Neon", "Royal", "Mystic", "Turbo", "Hyper", "Crystal", "Apex"];
  const nouns = ["Tiger", "Falcon", "Knight", "Viper", "Phoenix", "Titan", "Wolf", "Wizard", "Dragon", "Ranger"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${adj}${noun}${num}`;
}

let currentUserUid = null;
let userData = null;
let activeShopTab = "coins";
let activeRangeFilter = "all";
let activeLbSort = "leaderboardScore";
let pendingPackage = null;
let unsubscribeUser = null;
let unsubscribePurchases = null;
let unsubscribeLeaderboard = null;

const welcomeScreen = document.getElementById("welcome-screen");
const mainApp = document.getElementById("main-app");
const enterAppBtn = document.getElementById("enter-app-btn");
const authStatusText = document.getElementById("auth-status-text");
const shopGrid = document.getElementById("shop-grid");
const modal = document.getElementById("purchase-modal");
const toastEl = document.getElementById("toast");

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3200);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

enterAppBtn.addEventListener("click", async () => {
  enterAppBtn.disabled = true;
  authStatusText.textContent = "Connecting to VaultGem Cloud...";

  try {
    await initFirebaseAuth();
    await initGooglePlayBilling();

    welcomeScreen.classList.add("fade-out");
    setTimeout(() => {
      welcomeScreen.classList.add("hidden");
      mainApp.classList.remove("hidden");
      renderShop();
      syncFirestoreUserAndData(currentUserUid);
    }, 350);
  } catch (err) {
    console.error("Auth Error:", err);
    enterAppBtn.disabled = false;
    authStatusText.textContent = `Error: ${err.code || err.message} (Firebase-এ Anonymous Auth চালু করুন)`;
    showToast("❌ Firebase Auth কানেক্ট হয়নি!");
  }
});

function initFirebaseAuth() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Connection timeout. ইন্টারনেট বা Firebase সেটিংস চেক করুন।"));
    }, 12000);

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        clearTimeout(timeout);
        unsubAuth();
        currentUserUid = user.uid;
        resolve(user);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (e) {
          clearTimeout(timeout);
          unsubAuth();
          reject(e);
        }
      }
    });
  });
}

async function syncFirestoreUserAndData(uid) {
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      const initialProfile = {
        uid,
        displayName: generateRandomName(),
        coinsBalance: 0,
        diamondsBalance: 0,
        totalCoinsPurchased: 0,
        totalDiamondsPurchased: 0,
        leaderboardScore: 0,
        createdAt: serverTimestamp()
      };
      await setDoc(userRef, initialProfile);
      userData = { ...initialProfile, coinsBalance: 0, diamondsBalance: 0, totalCoinsPurchased: 0, totalDiamondsPurchased: 0 };
      updateProfileUI();
    } else {
      userData = snap.data();
      updateProfileUI();
    }

    listenToCurrentUser(uid);
    listenToRecentPurchases(uid);
    listenToLeaderboard();
  } catch (err) {
    console.error("Firestore Error:", err);
    showToast("⚠️ Firestore Database বা Rules সেট করা হয়নি!");
    const banner = document.getElementById("billing-banner");
    banner.className = "billing-banner test";
    banner.innerHTML = `⚠️ <strong>Database Warning:</strong> ${escapeHtml(err.message)} — Firebase Console-এ Firestore Database বানিয়ে Rules Publish করুন।`;
    banner.classList.remove("hidden");
  }
}

function listenToCurrentUser(uid) {
  if (unsubscribeUser) unsubscribeUser();
  unsubscribeUser = onSnapshot(doc(db, "users", uid), (snap) => {
    if (snap.exists()) {
      userData = snap.data();
      updateProfileUI();
    }
  });
}

function listenToRecentPurchases(uid) {
  if (unsubscribePurchases) unsubscribePurchases();
  const q = query(collection(db, "users", uid, "purchases"), orderBy("createdAt", "desc"), limit(10));
  unsubscribePurchases = onSnapshot(q, (snapshot) => {
    const items = [];
    snapshot.forEach((docItem) => items.push(docItem.data()));
    renderRecentPurchases(items);
  });
}

function listenToLeaderboard() {
  if (unsubscribeLeaderboard) unsubscribeLeaderboard();
  const q = query(collection(db, "users"), orderBy(activeLbSort, "desc"), limit(30));
  unsubscribeLeaderboard = onSnapshot(q, (snapshot) => {
    const users = [];
    snapshot.forEach((docItem) => users.push(docItem.data()));
    renderLeaderboard(users);
  });
}

async function creditPurchaseToFirestore(pkg, purchaseToken = "browser_test") {
  const scoreAdd = pkg.type === "coins" ? pkg.amount : pkg.amount * 100;
  const userRef = doc(db, "users", currentUserUid);

  if (pkg.type === "coins") {
    await updateDoc(userRef, {
      coinsBalance: increment(pkg.amount),
      totalCoinsPurchased: increment(pkg.amount),
      leaderboardScore: increment(scoreAdd)
    });
  } else {
    await updateDoc(userRef, {
      diamondsBalance: increment(pkg.amount),
      totalDiamondsPurchased: increment(pkg.amount),
      leaderboardScore: increment(scoreAdd)
    });
  }

  await addDoc(collection(db, "users", currentUserUid, "purchases"), {
    sku: pkg.sku,
    type: pkg.type,
    amount: pkg.amount,
    price: pkg.price,
    paymentProvider: purchaseToken === "browser_test" ? "browser_preview" : "google_play_billing",
    purchaseToken,
    createdAt: serverTimestamp()
  });
}

function updateProfileUI() {
  if (!userData) return;
  const name = userData.displayName || "Player";
  document.getElementById("header-username").textContent = name;
  document.getElementById("header-coins").textContent = (userData.coinsBalance || 0).toLocaleString();
  document.getElementById("header-diamonds").textContent = (userData.diamondsBalance || 0).toLocaleString();
  document.getElementById("profile-avatar").textContent = name.slice(0, 2).toUpperCase();
  document.getElementById("profile-display-name").textContent = name;
  document.getElementById("profile-uid").textContent = `ID: ${currentUserUid.slice(0, 12)}...`;
  document.getElementById("edit-name-input").value = name;
  document.getElementById("stat-cur-coins").textContent = (userData.coinsBalance || 0).toLocaleString();
  document.getElementById("stat-cur-diamonds").textContent = (userData.diamondsBalance || 0).toLocaleString();
  document.getElementById("stat-total-coins").textContent = (userData.totalCoinsPurchased || 0).toLocaleString();
  document.getElementById("stat-total-diamonds").textContent = (userData.totalDiamondsPurchased || 0).toLocaleString();
}

function renderRecentPurchases(items) {
  const container = document.getElementById("recent-purchases");
  if (!items.length) {
    container.innerHTML = `<p class="empty-note">No purchases yet. Visit the Shop!</p>`;
    return;
  }
  container.innerHTML = items.map((p) => {
    const icon = p.type === "coins" ? "🪙" : "💎";
    const unit = p.type === "coins" ? "Coins" : (p.amount === 1 ? "Diamond" : "Diamonds");
    return `<div class="recent-item"><span>${icon} <strong>+${p.amount.toLocaleString()} ${unit}</strong></span><span style="color:#94a3b8;">$${Number(p.price).toFixed(2)}</span></div>`;
  }).join("");
}

function renderShop() {
  const source = activeShopTab === "coins" ? coinPackages : diamondPackages;
  const filtered = source.filter((pkg) => {
    if (activeRangeFilter === "starter") return pkg.price <= 10.99;
    if (activeRangeFilter === "pro") return pkg.price > 10.99 && pkg.price <= 50.99;
    if (activeRangeFilter === "whale") return pkg.price > 50.99;
    return true;
  });

  shopGrid.innerHTML = filtered.map((pkg) => {
    const isCoin = pkg.type === "coins";
    const cardClass = isCoin ? "coin-card" : "diamond-card";
    const icon = isCoin ? "🪙" : "💎";
    const priceStr = isCoin ? `$${pkg.price.toFixed(2)}` : `$${pkg.price}`;
    const badge = pkg.price >= 50 ? `<span class="pkg-badge">VIP</span>` : (pkg.price === 0.51 || pkg.price === 1 ? `<span class="pkg-badge">HOT</span>` : "");

    return `
      <div class="package-card ${cardClass}">
        ${badge}
        <div class="pkg-icon">${icon}</div>
        <div class="pkg-amount">${pkg.label}</div>
        <div class="pkg-sub">SKU: ${pkg.sku}</div>
        <button class="pkg-buy-btn" data-sku="${pkg.sku}">Buy ${priceStr}</button>
      </div>
    `;
  }).join("");
}

function renderLeaderboard(users) {
  const podiumEl = document.getElementById("lb-podium");
  const listEl = document.getElementById("lb-list");

  if (!users.length) {
    podiumEl.innerHTML = "";
    listEl.innerHTML = `<div class="empty-note">No collectors found yet.</div>`;
    return;
  }

  const top3 = users.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]];
  const rankLabels = ["🥈 #2", "👑 #1", "🥉 #3"];

  podiumEl.innerHTML = podiumOrder.map((u, idx) => {
    if (!u) return `<div></div>`;
    return `
      <div class="podium-card ${idx === 1 ? "rank-1" : ""}">
        <div class="podium-crown">${rankLabels[idx]}</div>
        <div class="podium-name">${escapeHtml(u.displayName || "Player")}</div>
        <div class="podium-stats">
          <span class="lb-c">🪙 ${(u.totalCoinsPurchased || 0).toLocaleString()}</span>
          <span class="lb-d">💎 ${(u.totalDiamondsPurchased || 0).toLocaleString()}</span>
        </div>
      </div>
    `;
  }).join("");

  const rest = users.slice(3);
  if (!rest.length && users.length <= 3) {
    listEl.innerHTML = "";
    return;
  }

  listEl.innerHTML = rest.map((u, i) => {
    const isMe = u.uid === currentUserUid;
    return `
      <div class="lb-row ${isMe ? "is-me" : ""}">
        <div class="lb-left">
          <span class="lb-rank">#${i + 4}</span>
          <span class="lb-name">${escapeHtml(u.displayName || "Player")}${isMe ? `<span class="you-tag">YOU</span>` : ""}</span>
        </div>
        <div class="lb-right">
          <span class="lb-c">🪙 ${(u.totalCoinsPurchased || 0).toLocaleString()}</span>
          <span class="lb-d">💎 ${(u.totalDiamondsPurchased || 0).toLocaleString()}</span>
        </div>
      </div>
    `;
  }).join("");
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const targetId = btn.dataset.target;
    document.querySelectorAll(".app-view").forEach((v) => v.classList.remove("active"));
    document.getElementById(targetId).classList.add("active");
  });
});

document.querySelectorAll(".shop-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".shop-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeShopTab = tab.dataset.shop;
    renderShop();
  });
});

document.querySelectorAll(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    activeRangeFilter = chip.dataset.range;
    renderShop();
  });
});

document.querySelectorAll(".lb-sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lb-sort-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeLbSort = btn.dataset.sort;
    listenToLeaderboard();
  });
});

shopGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".pkg-buy-btn");
  if (!btn) return;
  const pkg = allPackagesBySku[btn.dataset.sku];
  if (!pkg) return;
  pendingPackage = pkg;

  const isCoin = pkg.type === "coins";
  document.getElementById("modal-icon").textContent = isCoin ? "🪙" : "💎";
  document.getElementById("modal-title").textContent = `Buy ${pkg.label}`;
  document.getElementById("modal-desc").textContent = `SKU: ${pkg.sku} — Add directly to your VaultGem wallet.`;
  document.getElementById("modal-mode-tag").textContent = isPlayBillingAvailable
    ? "🛡️ Google Play Billing"
    : "🧪 Browser Test Mode (Preview)";
  document.getElementById("modal-price").textContent = isCoin ? `$${pkg.price.toFixed(2)}` : `$${pkg.price}`;
  modal.classList.remove("hidden");
});

document.getElementById("modal-cancel").addEventListener("click", () => {
  modal.classList.add("hidden");
  pendingPackage = null;
});

modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    modal.classList.add("hidden");
    pendingPackage = null;
  }
});

document.getElementById("modal-confirm").addEventListener("click", async () => {
  if (!pendingPackage || !currentUserUid) return;
  const confirmBtn = document.getElementById("modal-confirm");
  confirmBtn.disabled = true;
  confirmBtn.textContent = isPlayBillingAvailable ? "Opening Play Store..." : "Processing...";
  const pkg = pendingPackage;

  try {
    if (isPlayBillingAvailable) {
      await executeGooglePlayPurchase(pkg);
      showToast(`✅ Google Play-এর মাধ্যমে ${pkg.label} কেনা সফল!`);
    } else {
      await creditPurchaseToFirestore(pkg, "browser_test");
      showToast(`🧪 Test Mode: +${pkg.label} যোগ হয়েছে!`);
    }
    modal.classList.add("hidden");
  } catch (err) {
    console.error(err);
    showToast(err.name === "AbortError" ? "পেমেন্ট বাতিল করা হয়েছে" : "❌ পেমেন্ট সম্পন্ন হয়নি! Firestore Rules চেক করুন।");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Proceed to Pay";
    pendingPackage = null;
  }
});

document.getElementById("save-name-btn").addEventListener("click", async () => {
  const newName = document.getElementById("edit-name-input").value.trim();
  if (newName.length < 2) {
    showToast("⚠️ নাম কমপক্ষে ২ অক্ষরের হতে হবে");
    return;
  }
  try {
    await updateDoc(doc(db, "users", currentUserUid), { displayName: newName });
    showToast("✨ প্রোফাইল নাম আপডেট হয়েছে!");
  } catch (err) {
    console.error(err);
    showToast("❌ নাম আপডেট করা যায়নি");
  }
});
