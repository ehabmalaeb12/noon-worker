// script.js — optimized, safe, non-destructive (workers untouched)

// CONFIG (keep these exactly as your workers)
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";

// TUNABLE: speed / safety
const MAX_SHARAF_PRODUCTS = 5;    // how many sharaf product links to fetch
const SHARAF_CONCURRENCY = 2;     // how many sharaf product detail fetches in parallel
const FETCH_RETRIES = 3;          // fetch retry attempts
const FETCH_BASE_DELAY = 500;     // ms base backoff

// UI refs
const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");

let renderedItems = []; // { el, price, store, id }

// helpers
function log(...args) { console.log(...args); }
function showLoading(on = true) { loadingEl.style.display = on ? "block" : "none"; }
function clearUI() {
  resultsEl.innerHTML = "";
  renderedItems = [];
  showLoading(true);
}
function createCardElement(product) {
  const div = document.createElement("div");
  div.className = "card";
  div.dataset.link = product.link || "";
  div.innerHTML = `
    <img src="${product.image || ""}" loading="lazy" onerror="this.style.opacity=0.6;this.style.filter='grayscale(40%)'">
    <h3>${product.title || "No title"}</h3>
    <div class="store-row">
      <strong class="price-text">${product.price ? (product.price + " " + product.currency) : "Price N/A"}</strong>
      <span class="badge store-badge">${product.store || ""}</span>
    </div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <a class="view-link" href="${product.link || "#"}" target="_blank">View</a>
      <button class="save-btn" style="margin-left:auto">Save</button>
    </div>
  `;
  return div;
}

// safe fetch with retries/backoff (no AbortController)
async function fetchWithRetry(url, opts = {}, attempts = FETCH_RETRIES, baseDelay = FETCH_BASE_DELAY) {
  let err = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      err = e;
      const wait = baseDelay * Math.pow(2, i);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw err;
}

/* ---------------- AMAZON ---------------- */
async function fetchAmazon(query) {
  try {
    const url = `${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`;
    const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" } }, 2, 300);
    const data = await res.json();
    log(`Amazon results count ${data.results?.length || 0}`);
    return data.results || [];
  } catch (e) {
    log("Amazon fetch failed", e?.message || e);
    return [];
  }
}

/* ---------------- SHARAF ---------------- */
async function fetchSharafLinks(query) {
  try {
    const url = `${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`;
    const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" } }, 2, 300);
    const data = await res.json();
    const links = (data.results || []).map(r => r.link).filter(Boolean).slice(0, MAX_SHARAF_PRODUCTS);
    log(`Sharaf links count ${links.length}`);
    return links;
  } catch (e) {
    log("Sharaf search failed", e?.message || e);
    return [];
  }
}

// concurrency pool for Sharaf product fetches
async function fetchSharafProducts(links) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < links.length) {
      const current = links[idx++];
      try {
        log("Sharaf product fetch ->", current);
        const url = `${SHARAF_WORKER}/product?url=${encodeURIComponent(current)}`;
        const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" } }, 2, 400);
        const data = await res.json();
        if (data && (data.title || data.price || data.image)) {
          results.push(data);
          renderProduct(data);
        } else {
          log("Sharaf product returned no fields", current);
        }
      } catch (e) {
        log("Sharaf product error", current, e?.message || e);
      }
    }
  }

  // start pool
  const pool = Array.from({ length: Math.max(1, SHARAF_CONCURRENCY) }, () => worker());
  await Promise.all(pool);
  return results;
}

/* ---------------- Rendering + Best price badge ---------------- */
function renderProduct(p) {
  const el = createCardElement(p);
  resultsEl.appendChild(el);
  // store for best-price evaluation
  const numericPrice = (p.price && !isNaN(Number(p.price))) ? Number(p.price) : null;
  renderedItems.push({ el, price: numericPrice, store: p.store, link: p.link, title: p.title });
  // after adding, compute best
  highlightBestPrice();
}

function highlightBestPrice() {
  // remove old best badges
  document.querySelectorAll(".best-badge").forEach(b => b.remove());
  // find lowest numeric price
  const withPrice = renderedItems.filter(it => it.price != null);
  if (withPrice.length === 0) return;
  const min = Math.min(...withPrice.map(it => it.price));
  // mark all that equal min (usually one)
  withPrice.filter(it => it.price === min).forEach(it => {
    const badge = document.createElement("span");
    badge.className = "best-badge";
    badge.style.cssText = "display:inline-block;padding:4px 8px;border-radius:999px;background:#ffe9e6;color:#b90d0d;font-weight:700;margin-left:8px;font-size:12px";
    badge.textContent = "Best price";
    const storeRow = it.el.querySelector(".store-row");
    if (storeRow) storeRow.appendChild(badge);
  });
}

/* ---------------- MAIN SEARCH FLOW ---------------- */
async function startSearch() {
  const query = (searchInput.value || "").trim();
  if (!query) return;
  clearUI();
  log(`Start search: "${query}"`);

  // 1) Amazon fast path
  const amazonResults = await fetchAmazon(query);
  // normalize and render
  (amazonResults || []).forEach(r => {
    // expected r fields: { id/asin, title, price, currency, image, link, store }
    renderProduct({
      store: r.store || "Amazon.ae",
      title: r.title || r.asin || "Amazon item",
      price: r.price || null,
      currency: r.currency || "AED",
      image: r.image || null,
      link: r.link || (r.asin ? `https://www.amazon.ae/dp/${r.asin}` : "#")
    });
  });

  // 2) Sharaf links -> product details (safe, limited concurrency)
  const sharafLinks = await fetchSharafLinks(query);
  if (sharafLinks.length) {
    log(`Fetching Sharaf product details (${sharafLinks.length})`);
    await fetchSharafProducts(sharafLinks);
  }

  showLoading(false);
  log("Search finished");
}

/* ---------------- events ---------------- */
searchBtn.addEventListener("click", startSearch);
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startSearch(); });

// initial sample search if input has value
if (searchInput && searchInput.value && searchInput.value.trim() !== "") {
  // small delay so page finishes loading
  setTimeout(() => startSearch(), 200);
}
