// script.js — SAFE extension (Amazon + Sharaf preserved, Noon added)

// CONFIG (keep existing workers)
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
const SHARAF_WORKER  = "https://sharaf-worker.ehabmalaeb2.workers.dev";
const NOON_WORKER    = "https://noon-worker.ehabmalaeb2.workers.dev"; // NEW

// TUNABLE
const MAX_SHARAF_PRODUCTS = 5;
const SHARAF_CONCURRENCY = 2;
const FETCH_RETRIES = 3;
const FETCH_BASE_DELAY = 500;

// UI refs
const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");

let renderedItems = [];

// helpers
function log(...args) { console.log(...args); }
function showLoading(on = true) { loadingEl.style.display = on ? "block" : "none"; }
function clearUI() {
  resultsEl.innerHTML = "";
  renderedItems = [];
  showLoading(true);
}

// ---------- rendering ----------
function createCardElement(product) {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <img src="${product.image || ""}" loading="lazy">
    <h3>${product.title || "No title"}</h3>
    <div class="store-row">
      <strong>${product.price ? product.price + " " + product.currency : "Price N/A"}</strong>
      <span class="badge">${product.store}</span>
    </div>
    <a href="${product.link}" target="_blank">View</a>
  `;
  return div;
}

function renderProduct(p) {
  const el = createCardElement(p);
  resultsEl.appendChild(el);

  const numericPrice = !isNaN(Number(p.price)) ? Number(p.price) : null;
  renderedItems.push({ el, price: numericPrice });

  highlightBestPrice();
}

function highlightBestPrice() {
  document.querySelectorAll(".best-badge").forEach(b => b.remove());
  const priced = renderedItems.filter(i => i.price !== null);
  if (!priced.length) return;

  const min = Math.min(...priced.map(i => i.price));
  priced.filter(i => i.price === min).forEach(i => {
    const badge = document.createElement("span");
    badge.className = "best-badge";
    badge.textContent = "Best price";
    i.el.querySelector(".store-row")?.appendChild(badge);
  });
}

// ---------- safe fetch ----------
async function fetchWithRetry(url, attempts = FETCH_RETRIES) {
  let err;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      return r;
    } catch (e) {
      err = e;
      await new Promise(r => setTimeout(r, FETCH_BASE_DELAY * (i + 1)));
    }
  }
  throw err;
}

// ---------- AMAZON ----------
async function fetchAmazon(query) {
  try {
    const r = await fetchWithRetry(`${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`, 2);
    const d = await r.json();
    log("Amazon results", d.results?.length || 0);
    return d.results || [];
  } catch {
    return [];
  }
}

// ---------- SHARAF ----------
async function fetchSharafLinks(query) {
  try {
    const r = await fetchWithRetry(`${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`, 2);
    const d = await r.json();
    return (d.results || []).map(x => x.link).slice(0, MAX_SHARAF_PRODUCTS);
  } catch {
    return [];
  }
}

async function fetchSharafProducts(links) {
  let i = 0;
  async function worker() {
    while (i < links.length) {
      const link = links[i++];
      try {
        const r = await fetchWithRetry(`${SHARAF_WORKER}/product?url=${encodeURIComponent(link)}`, 2);
        const d = await r.json();
        renderProduct(d);
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: SHARAF_CONCURRENCY }, worker));
}

// ---------- NOON (NEW, SAFE) ----------
async function fetchNoon(query) {
  try {
    const r = await fetchWithRetry(`${NOON_WORKER}/search?q=${encodeURIComponent(query)}`, 2);
    const d = await r.json();
    log("Noon results", d.results?.length || 0);
    return d.results || [];
  } catch {
    return [];
  }
}

// ---------- MAIN ----------
async function startSearch() {
  const q = searchInput.value.trim();
  if (!q) return;

  clearUI();
  log(`Start search: "${q}"`);

  // Amazon
  (await fetchAmazon(q)).forEach(p =>
    renderProduct({ ...p, store: "Amazon.ae", currency: "AED" })
  );

  // Sharaf
  const sharafLinks = await fetchSharafLinks(q);
  if (sharafLinks.length) await fetchSharafProducts(sharafLinks);

  // Noon (LAST, SAFE)
  (await fetchNoon(q)).forEach(p =>
    renderProduct({ ...p, store: "Noon", currency: "AED" })
  );

  showLoading(false);
}

// events
searchBtn.onclick = startSearch;
searchInput.onkeydown = e => e.key === "Enter" && startSearch();
