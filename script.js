// script.js — safe optimized front-end (keeps existing workers untouched)

// CONFIG (use your existing worker URLs)
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";
const NOON_WORKER = "https://noon-worker.ehabmalaeb2.workers.dev"; // optional; will be used if responsive

// TUNABLE
const MAX_SHARAF_PRODUCTS = 5;
const SHARAF_CONCURRENCY = 3;
const FETCH_RETRIES = 2;
const FETCH_BASE_DELAY = 300;

// UI refs
const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");
const debugPanel = document.getElementById("debugPanel");
const toggleDebugBtn = document.getElementById("toggleDebug");

let renderedItems = []; // { el, price, store, link }
let activeSearchId = 0;
let isSearching = false;

// small helpers
function now() { return new Date().toISOString(); }
function appendDebug(...args) {
  const text = `[${now()}] ${Array.from(args).join(" ")}\n`;
  console.log(...args);
  if (debugPanel) {
    debugPanel.textContent += text;
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }
}
function clearUI() {
  resultsEl.innerHTML = "";
  renderedItems = [];
  if (debugPanel) debugPanel.textContent = "";
  showLoading(true);
}
function showLoading(on = true) {
  loadingEl.style.display = on ? "block" : "none";
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

// fetch with retries/backoff
async function fetchWithRetry(url, opts = {}, attempts = FETCH_RETRIES, baseDelay = FETCH_BASE_DELAY) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      appendDebug(`fetch failed (${i + 1}/${attempts}) ${url} — ${err.message || err}`);
      const wait = baseDelay * Math.pow(2, i);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/* ---------------- AMAZON (worker) ---------------- */
async function fetchAmazon(query, sid) {
  const url = `${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`;
  appendDebug(`Query Amazon -> ${url}`);
  try {
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
    const data = await res.json();
    appendDebug(`Amazon results count ${data.results?.length || 0}`);
    if (sid !== activeSearchId) { appendDebug("Amazon results ignored (old search)"); return []; }
    return data.results || [];
  } catch (e) {
    appendDebug("Amazon fetch failed:", e?.message || e);
    return [];
  }
}

/* ---------------- NOON (worker) — optional ---------------- */
async function fetchNoon(query, sid) {
  const url = `${NOON_WORKER}/search?q=${encodeURIComponent(query)}`;
  appendDebug(`Query Noon -> ${url}`);
  try {
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
    const data = await res.json();
    appendDebug(`Noon results count ${data.results?.length || 0}`);
    if (sid !== activeSearchId) { appendDebug("Noon results ignored (old search)"); return []; }
    return data.results || [];
  } catch (e) {
    appendDebug("Noon fetch failed:", e?.message || e);
    return [];
  }
}

/* ---------------- SHARAF (search -> links -> products) ---------------- */
async function fetchSharafLinks(query, sid) {
  const url = `${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`;
  appendDebug(`Query Sharaf -> ${url}`);
  try {
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
    const data = await res.json();
    appendDebug(`Sharaf links found ${ (data.results || []).length }`);
    if (sid !== activeSearchId) { appendDebug("Sharaf links ignored (old search)"); return []; }
    const links = (data.results || []).map(r => r.link).filter(Boolean).slice(0, MAX_SHARAF_PRODUCTS);
    appendDebug(`Sharaf links count ${links.length}`);
    return links;
  } catch (e) {
    appendDebug("Sharaf search failed:", e?.message || e);
    return [];
  }
}

async function fetchSharafProducts(links, sid) {
  appendDebug(`Fetching Sharaf product details (${links.length})`);
  const results = [];
  let idx = 0;
  let fetched = 0;

  async function worker() {
    while (true) {
      const pos = idx++;
      if (pos >= links.length) break;
      const productUrl = links[pos];
      appendDebug(`Sharaf product fetch -> ${productUrl}`);
      try {
        const url = `${SHARAF_WORKER}/product?url=${encodeURIComponent(productUrl)}`;
        const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 400);
        const data = await res.json();
        fetched++;
        appendDebug(`Sharaf product fetched (${fetched}/${links.length}) -> ${productUrl}`);
        if (sid !== activeSearchId) { appendDebug("Sharaf product ignored (old search)"); return; }
        if (data && (data.title || data.price || data.image)) {
          results.push(data);
          renderProduct(data);
        } else {
          appendDebug("Sharaf product returned no fields:", productUrl);
        }
      } catch (err) {
        fetched++;
        appendDebug(`Sharaf product error ${productUrl} — ${err?.message || err}`);
      }
    }
  }

  const pool = Array.from({ length: Math.max(1, SHARAF_CONCURRENCY) }, () => worker());
  await Promise.all(pool);
  appendDebug(`Sharaf product details fetch complete (${fetched}/${links.length})`);
  return results;
}

/* ---------------- Rendering + Best price badge ---------------- */
function renderProduct(p) {
  const el = createCardElement(p);
  resultsEl.appendChild(el);
  const numericPrice = (p.price != null && !isNaN(Number(p.price))) ? Number(p.price) : null;
  renderedItems.push({ el, price: numericPrice, store: p.store, link: p.link, title: p.title });
  highlightBestPrice();
}

function highlightBestPrice() {
  document.querySelectorAll(".best-badge").forEach(b => b.remove());
  const withPrice = renderedItems.filter(it => it.price != null);
  if (!withPrice.length) return;
  const min = Math.min(...withPrice.map(it => it.price));
  withPrice.filter(it => it.price === min).forEach(it => {
    const badge = document.createElement("span");
    badge.className = "best-badge";
    badge.textContent = "Best price";
    const storeRow = it.el.querySelector(".store-row");
    if (storeRow) storeRow.appendChild(badge);
  });
}

/* ---------------- Main flow — parallelized safely ---------------- */
async function startSearch() {
  const query = (searchInput.value || "").trim();
  if (!query) return;
  if (isSearching) {
    appendDebug("Search blocked — another search is running");
    return;
  }

  // guard UI
  isSearching = true;
  searchBtn.disabled = true;
  searchInput.disabled = true;
  clearUI();

  activeSearchId++;
  const sid = activeSearchId;
  appendDebug(`==== Start search "${query}" (sid=${sid}) ====`);

  // start Amazon + Noon search in parallel (fast UX)
  const amazonP = fetchAmazon(query, sid);
  const noonP = fetchNoon(query, sid).catch(e => { appendDebug("Noon promise fail", e?.message||e); return []; });

  // start Sharaf links fetch in parallel so server can run while we render Amazon/Noon
  const sharafLinksP = fetchSharafLinks(query, sid);

  // await Amazon & Noon results and render as they arrive
  const [amazonResults, noonResults] = await Promise.all([amazonP, noonP]);

  // render Amazon (fast)
  if (sid === activeSearchId) {
    (amazonResults || []).forEach(r => {
      renderProduct({
        store: r.store || "Amazon.ae",
        title: r.title || r.asin || "Amazon item",
        price: r.price || null,
        currency: r.currency || "AED",
        image: r.image || null,
        link: r.link || (r.asin ? `https://www.amazon.ae/dp/${r.asin}` : "#")
      });
    });
  } else appendDebug("Amazon render skipped (old search)");

  // render Noon (if any)
  if (sid === activeSearchId && Array.isArray(noonResults) && noonResults.length) {
    noonResults.forEach(n => {
      renderProduct({
        store: n.store || "Noon",
        title: n.title || n.name || "Noon item",
        price: n.price || null,
        currency: n.currency || "AED",
        image: n.image || null,
        link: n.link || n.url || "#"
      });
    });
  } else appendDebug("Noon render skipped or none");

  // now wait for Sharaf links, then fetch product details
  const sharafLinks = await sharafLinksP;
  if (sid === activeSearchId && sharafLinks.length) {
    await fetchSharafProducts(sharafLinks, sid);
  } else appendDebug("No Sharaf links or search changed");

  // done
  if (sid === activeSearchId) {
    showLoading(false);
    appendDebug("Search finished");
  } else {
    appendDebug("Search finished but ignored (old sid)");
  }

  // reset UI
  isSearching = false;
  searchBtn.disabled = false;
  searchInput.disabled = false;
}

/* ---------------- events ---------------- */
searchBtn.addEventListener("click", startSearch);
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startSearch(); });
toggleDebugBtn.addEventListener("click", () => {
  if (!debugPanel) return;
  debugPanel.style.display = debugPanel.style.display === "block" ? "none" : "block";
});
