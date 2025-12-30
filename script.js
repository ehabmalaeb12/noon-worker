// script.js — safe update: parallel Amazon+Noon, robust Sharaf fetching, visible debug

// CONFIG (keep these exactly as your workers)
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";
const NOON_WORKER = "https://noon-worker.ehabmalaeb2.workers.dev";

// TUNABLE: speed / safety
const MAX_SHARAF_PRODUCTS = 5;    // how many sharaf product links to fetch
const SHARAF_CONCURRENCY = 2;     // parallel sharaf product detail fetches
const FETCH_RETRIES = 3;          // fetch retry attempts
const FETCH_BASE_DELAY = 400;     // ms base backoff
const REQUEST_TIMEOUT_MS = 12000; // default per-request timeout (ms)
const SHARAF_PRODUCT_TIMEOUT_MS = 11000; // per-sharaf-product timeout

// UI refs
const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");
const debugPanel = document.getElementById("debugPanel");
const toggleDebugBtn = document.getElementById("toggleDebug");

let renderedItems = []; // { el, price, store, id }
let debugState = { events: [] };

// ---------- UI helpers ----------
function log(...args) { console.log(...args); appendDebug(args.join(" ")); }
function appendDebug(msg) {
  debugState.events.push({ ts: new Date().toISOString(), msg: String(msg) });
  renderDebug();
}
function renderDebug() {
  if (!debugPanel) return;
  debugPanel.textContent = JSON.stringify(debugState, null, 2);
}
function showLoading(on = true) { loadingEl.style.display = on ? "block" : "none"; }
function clearUI() {
  resultsEl.innerHTML = "";
  renderedItems = [];
  showLoading(true);
  debugState = { events: [] };
  renderDebug();
}
toggleDebugBtn?.addEventListener("click", () => {
  if (!debugPanel) return;
  debugPanel.style.display = debugPanel.style.display === "block" ? "none" : "block";
});

// create product card (keeps previous markup)
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

// ---------- network helpers (timeout + retry) ----------
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  // uses AbortController so we actually cancel slow requests
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchJsonWithRetry(url, opts = {}, attempts = FETCH_RETRIES, baseDelay = FETCH_BASE_DELAY, timeoutMs = REQUEST_TIMEOUT_MS) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, opts, timeoutMs);
      const text = await res.text();
      // try parse JSON safely
      try {
        return { ok: true, status: res.status, json: JSON.parse(text), text };
      } catch (e) {
        // if response is JSON-like inside HTML, still keep text
        return { ok: true, status: res.status, json: null, text };
      }
    } catch (e) {
      lastErr = e;
      appendDebug(`fetch failed (${i+1}/${attempts}) ${url} — ${e?.message || e}`);
      const wait = baseDelay * Math.pow(2, i);
      await delay(wait);
    }
  }
  return { ok: false, error: lastErr };
}

// ---------- AMAZON (worker) ----------
async function fetchAmazon(query) {
  const started = Date.now();
  appendDebug(`Amazon: start search "${query}"`);
  try {
    const url = `${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`;
    const r = await fetchJsonWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300, REQUEST_TIMEOUT_MS);
    if (!r.ok) { appendDebug(`Amazon search failed: ${r.error}`); return []; }
    const arr = r.json?.results || [];
    appendDebug(`Amazon: got ${arr.length} items (took ${Date.now()-started}ms)`);
    return arr;
  } catch (e) {
    appendDebug(`Amazon: unexpected error ${e?.message || e}`);
    return [];
  }
}

// ---------- NOON (worker) ----------
async function fetchNoon(query) {
  const started = Date.now();
  appendDebug(`Noon: start search "${query}"`);
  try {
    const url = `${NOON_WORKER}/search?q=${encodeURIComponent(query)}`;
    const r = await fetchJsonWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300, REQUEST_TIMEOUT_MS);
    if (!r.ok) { appendDebug(`Noon search failed: ${r.error}`); return []; }
    const arr = r.json?.results || [];
    appendDebug(`Noon: got ${arr.length} items (took ${Date.now()-started}ms)`);
    // normalize minimal fields
    return (arr || []).map(it => ({
      store: it.store || "Noon",
      title: it.title || it.name || null,
      price: it.price || null,
      currency: it.currency || "AED",
      image: it.image || it.thumbnail || null,
      link: it.link || it.url || "#"
    }));
  } catch (e) {
    appendDebug(`Noon: unexpected error ${e?.message || e}`);
    return [];
  }
}

// ---------- SHARAF (worker) ----------
async function fetchSharafLinks(query) {
  appendDebug(`Sharaf: start search "${query}"`);
  try {
    const url = `${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`;
    const r = await fetchJsonWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300, REQUEST_TIMEOUT_MS);
    if (!r.ok) { appendDebug(`Sharaf search failed: ${r.error}`); return []; }
    const links = (r.json?.results || []).map(x => x.link).filter(Boolean).slice(0, MAX_SHARAF_PRODUCTS);
    appendDebug(`Sharaf: found ${links.length} links`);
    return links;
  } catch (e) {
    appendDebug(`Sharaf search unexpected: ${e?.message || e}`);
    return [];
  }
}

async function fetchSharafProduct(url) {
  // fetch product details endpoint (worker handles scraping)
  const apiUrl = `${SHARAF_WORKER}/product?url=${encodeURIComponent(url)}`;
  const r = await fetchJsonWithRetry(apiUrl, { headers: { Accept: "application/json" } }, 2, FETCH_BASE_DELAY, SHARAF_PRODUCT_TIMEOUT_MS);
  if (!r.ok) throw r.error || new Error("Sharaf product fetch failed");
  // r.json may include debug; return parsed json or fallback to text
  const data = r.json || (r.text ? { title: null, price: null, image: null, link: url } : null);
  return data;
}

// pool concurrency for product detail fetching
async function fetchSharafProducts(links) {
  appendDebug(`Sharaf: fetch details for ${links.length} links (concurrency ${SHARAF_CONCURRENCY})`);
  const results = [];
  let idx = 0;
  const errors = [];

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= links.length) break;
      const link = links[i];
      appendDebug(`Sharaf product fetch -> ${link}`);
      try {
        const data = await fetchSharafProduct(link);
        // ensure shape and store
        data.store = data.store || "SharafDG";
        data.link = data.link || link;
        results.push(data);
        renderProduct(data);
        appendDebug(`Sharaf product success -> ${link} price=${data.price}`);
      } catch (e) {
        errors.push({ link, err: String(e) });
        appendDebug(`Sharaf product error -> ${link} ${e?.message || e}`);
      }
    }
  }

  // start workers
  const pool = Array.from({ length: Math.max(1, SHARAF_CONCURRENCY) }, () => worker());
  await Promise.all(pool);
  appendDebug(`Sharaf: finished details. successes=${results.length} errors=${errors.length}`);
  return { results, errors };
}

// ---------- rendering & best badge (kept from your working logic) ----------
function renderProduct(p) {
  const el = createCardElement(p);
  resultsEl.appendChild(el);
  const numericPrice = (p.price && !isNaN(Number(p.price))) ? Number(p.price) : null;
  renderedItems.push({ el, price: numericPrice, store: p.store, link: p.link, title: p.title });
  highlightBestPrice();
}

function highlightBestPrice() {
  document.querySelectorAll(".best-badge").forEach(b => b.remove());
  const withPrice = renderedItems.filter(it => it.price != null);
  if (withPrice.length === 0) return;
  const min = Math.min(...withPrice.map(it => it.price));
  withPrice.filter(it => it.price === min).forEach(it => {
    const badge = document.createElement("span");
    badge.className = "best-badge";
    badge.style.cssText = "display:inline-block;padding:4px 8px;border-radius:999px;background:#ffe9e6;color:#b90d0d;font-weight:700;margin-left:8px;font-size:12px";
    badge.textContent = "Best price";
    const storeRow = it.el.querySelector(".store-row");
    if (storeRow) storeRow.appendChild(badge);
  });
}

// ---------- MAIN SEARCH FLOW (Amazon + Noon parallel, then Sharaf) ----------
async function startSearch() {
  const query = (searchInput.value || "").trim();
  if (!query) return;
  clearUI();
  appendDebug(`==== Start search "${query}" ====`);
  const t0 = Date.now();

  // start Amazon + Noon in parallel (fast sources)
  appendDebug("Starting Amazon + Noon in parallel");
  const [amazonRes, noonRes] = await Promise.allSettled([
    fetchAmazon(query),
    fetchNoon(query)
  ]);

  // Amazon result
  const amazonItems = (amazonRes.status === "fulfilled") ? amazonRes.value : [];
  if (amazonRes.status === "rejected") appendDebug(`Amazon promise rejected: ${amazonRes.reason}`);

  // Noon result
  const noonItems = (noonRes.status === "fulfilled") ? noonRes.value : [];
  if (noonRes.status === "rejected") appendDebug(`Noon promise rejected: ${noonRes.reason}`);

  // Render Amazon + Noon quickly
  appendDebug(`Rendering Amazon (${amazonItems.length}) + Noon (${noonItems.length})`);
  (amazonItems || []).forEach(r => {
    renderProduct({
      store: r.store || "Amazon.ae",
      title: r.title || r.asin || "Amazon item",
      price: r.price || null,
      currency: r.currency || "AED",
      image: r.image || null,
      link: r.link || (r.asin ? `https://www.amazon.ae/dp/${r.asin}` : "#")
    });
  });
  (noonItems || []).forEach(r => renderProduct(r));

  // Now Sharaf: get links first, then fetch product details concurrently
  const sharafLinks = await fetchSharafLinks(query);
  if (sharafLinks.length) {
    appendDebug(`Fetching Sharaf product details (${sharafLinks.length})`);
    await fetchSharafProducts(sharafLinks);
  } else {
    appendDebug("No Sharaf links to fetch");
  }

  showLoading(false);
  appendDebug(`Search finished in ${Date.now() - t0}ms`);
}

// ---------- events ----------
searchBtn.addEventListener("click", startSearch);
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startSearch(); });

// initial sample search if input has value
if (searchInput && searchInput.value && searchInput.value.trim() !== "") {
  setTimeout(() => startSearch(), 200);
}
