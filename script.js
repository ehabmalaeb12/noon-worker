// script.js — combined, non-destructive, adds Noon + Sharaf re-querying

// ---------------- CONFIG (keep worker URLs exact) ----------------
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
const NOON_WORKER = "https://noon-worker.ehabmalaeb2.workers.dev";        // update if your noon worker URL differs
const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";

// ---------------- TUNABLE: speed / safety ----------------
const MAX_SHARAF_PRODUCTS = 5;    // how many sharaf product links to fetch
const SHARAF_CONCURRENCY = 2;     // how many sharaf product detail fetches in parallel
const FETCH_RETRIES = 3;          // fetch retry attempts
const FETCH_BASE_DELAY = 400;     // ms base backoff

// ---------------- UI refs ----------------
const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");
const debugPanel = document.getElementById("debugPanel");
const toggleDebugBtn = document.getElementById("toggleDebug");

// ---------------- State ----------------
let renderedItems = []; // { el, price, store, link, title }
let seenLinks = new Set();
let sharafRanOnce = false;
let sharafLastQuery = null;
let currentSearchId = 0;

// ---------------- Helpers ----------------
function logToPanel(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (debugPanel) {
    debugPanel.textContent += line + "\n";
    // keep scroll to bottom
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }
}
function showLoading(on = true) { loadingEl.style.display = on ? "block" : "none"; }
function clearUI() {
  resultsEl.innerHTML = "";
  renderedItems = [];
  seenLinks.clear();
  if (debugPanel) debugPanel.textContent = "";
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

// safe fetch with retries/backoff
async function fetchWithRetry(url, opts = {}, attempts = FETCH_RETRIES, baseDelay = FETCH_BASE_DELAY) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      const wait = baseDelay * Math.pow(2, i);
      logToPanel(`fetch failed (${i+1}/${attempts}) ${url} — ${err.message}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ---------------- AMAZON ----------------
async function fetchAmazon(query, sid) {
  const url = `${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`;
  const start = Date.now();
  try {
    logToPanel(`Amazon: start search "${query}" (sid=${sid})`);
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
    if (sid !== currentSearchId) {
      logToPanel(`Amazon: ignoring results (stale sid=${sid})`);
      return [];
    }
    const data = await res.json();
    logToPanel(`Amazon: got ${data.results?.length || 0} items (took ${Date.now()-start}ms)`);
    return data.results || [];
  } catch (e) {
    logToPanel(`Amazon fetch error: ${e.message || e}`);
    return [];
  }
}

// ---------------- NOON ----------------
async function fetchNoon(query, sid) {
  const url = `${NOON_WORKER}/search?q=${encodeURIComponent(query)}`;
  const start = Date.now();
  try {
    logToPanel(`Noon: start search "${query}" (sid=${sid})`);
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
    if (sid !== currentSearchId) {
      logToPanel(`Noon: ignoring results (stale sid=${sid})`);
      return [];
    }
    const data = await res.json();
    logToPanel(`Noon: got ${data.results?.length || 0} items (took ${Date.now()-start}ms)`);
    return data.results || [];
  } catch (e) {
    logToPanel(`Noon fetch error: ${e.message || e}`);
    return [];
  }
}

// ---------------- SHARAF (search for product links) ----------------
async function fetchSharafLinks(query, sid) {
  const url = `${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`;
  try {
    logToPanel(`Sharaf: start search "${query}" (sid=${sid})`);
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
    if (sid !== currentSearchId) {
      logToPanel(`Sharaf-search: ignoring (stale sid=${sid})`);
      return [];
    }
    const data = await res.json();
    const links = (data.results || []).map(r => r.link).filter(Boolean).slice(0, MAX_SHARAF_PRODUCTS);
    logToPanel(`Sharaf: links count ${links.length} (sid=${sid})`);
    return links;
  } catch (e) {
    logToPanel(`Sharaf search error: ${e.message || e}`);
    return [];
  }
}

// fetch product details from Sharaf product endpoint (concurrency-limited)
async function fetchSharafProducts(links, sid) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < links.length) {
      const current = links[idx++];
      if (sid !== currentSearchId) { logToPanel('Sharaf products worker: aborting (stale)'); return; }

      try {
        logToPanel(`Sharaf product fetch -> ${current}`);
        const url = `${SHARAF_WORKER}/product?url=${encodeURIComponent(current)}`;
        const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 400);
        if (sid !== currentSearchId) { logToPanel('Sharaf product: ignoring (stale)'); return; }
        const data = await res.json();
        if (data && (data.title || data.price || data.image)) {
          results.push(data);
          renderProduct(data);
        } else {
          logToPanel(`Sharaf product returned no useful fields -> ${current}`);
        }
      } catch (e) {
        logToPanel(`Sharaf product error ${current} — ${e.message || e}`);
      }
    }
  }

  const pool = Array.from({ length: Math.max(1, SHARAF_CONCURRENCY) }, () => worker());
  await Promise.all(pool);
  return results;
}

// ---------------- Rendering + Best price ----------------
function renderProduct(p) {
  // dedupe by link
  if (p.link && seenLinks.has(p.link)) return;
  if (p.link) seenLinks.add(p.link);

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
    badge.textContent = "Best price";
    const storeRow = it.el.querySelector(".store-row");
    if (storeRow) storeRow.appendChild(badge);
  });
}

// ---------------- Utility: get best Amazon title (prefer long descriptive titles) ----------------
function getBestAmazonTitle(results) {
  if (!results || !results.length) return null;
  return results
    .map(r => r.title)
    .filter(Boolean)
    .sort((a,b) => b.length - a.length)[0] || null;
}

// ---------------- Sharaf re-run helper ----------------
async function runSharafOnce(query, sid, reason = "initial") {
  if (!query) return;
  if (sharafLastQuery === query && sharafRanOnce) {
    logToPanel(`Sharaf: already ran for "${query}" — skip`);
    return;
  }
  sharafLastQuery = query;
  sharafRanOnce = true;
  logToPanel(`Sharaf: run (${reason}) with query="${query}" (sid=${sid})`);
  const links = await fetchSharafLinks(query, sid);
  if (links.length) {
    await fetchSharafProducts(links, sid);
  } else {
    logToPanel("Sharaf: no links found for query -> " + query);
  }
}

// ---------------- MAIN SEARCH FLOW ----------------
async function startSearch() {
  const q = (searchInput.value || "").trim();
  if (!q) return;

  // bump search id (used to drop stale results)
  const sid = ++currentSearchId;

  clearUI();
  logToPanel(`==== Start search "${q}" (sid=${sid}) ====`);
  showLoading(true);
  sharafRanOnce = false;
  sharafLastQuery = null;

  // Start Amazon + Noon in parallel (fast UX)
  logToPanel("Starting Amazon + Noon in parallel");
  const amazonP = fetchAmazon(q, sid);
  const noonP = fetchNoon(q, sid);

  // Start Sharaf fallback immediately (non-blocking) but limited:
  // We run an initial Sharaf search quickly using user query (fallback)
  runSharafOnce(q, sid, "fallback");

  // Wait for amazon + noon responses
  const [amazonResults, noonResults] = await Promise.all([amazonP, noonP]);

  // If search changed since - ignore
  if (sid !== currentSearchId) {
    logToPanel("Search changed — aborting render (stale)");
    return;
  }

  // Render Amazon items (fast)
  if (amazonResults && amazonResults.length) {
    logToPanel(`Rendering Amazon (${amazonResults.length})`);
    amazonResults.forEach(r => {
      renderProduct({
        store: r.store || "Amazon.ae",
        title: r.title || r.asin || "Amazon item",
        price: r.price || null,
        currency: r.currency || "AED",
        image: r.image || null,
        link: r.link || (r.asin ? `https://www.amazon.ae/dp/${r.asin}` : "#")
      });
    });
  } else {
    logToPanel("Amazon returned no results");
  }

  // Render Noon items (parallel)
  if (noonResults && noonResults.length) {
    logToPanel(`Rendering Noon (${noonResults.length})`);
    noonResults.forEach(r => {
      renderProduct({
        store: r.store || "Noon",
        title: r.title || r.name || "Noon item",
        price: r.price || null,
        currency: r.currency || "AED",
        image: r.image || null,
        link: r.link || r.url || "#"
      });
    });
  } else {
    logToPanel("Noon returned no results");
  }

  // After Amazon returns, if it provides a better title than the user query -> re-run sharaf once
  const bestAmazonTitle = getBestAmazonTitle(amazonResults);
  if (bestAmazonTitle && bestAmazonTitle.toLowerCase() !== q.toLowerCase()) {
    logToPanel(`Amazon provided refined title -> "${bestAmazonTitle}" ; triggering Sharaf refine`);
    await runSharafOnce(bestAmazonTitle, sid, "amazon-refine");
  } else {
    logToPanel("No Amazon-refine needed for Sharaf");
  }

  showLoading(false);
  logToPanel("Search finished");
}

// ---------------- Events ----------------
toggleDebugBtn?.addEventListener("click", () => {
  if (!debugPanel) return;
  debugPanel.style.display = debugPanel.style.display === "none" ? "block" : "none";
});

searchBtn.addEventListener("click", startSearch);
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startSearch(); });

// initial auto search (if input prefilled)
if (searchInput && searchInput.value && searchInput.value.trim() !== "") {
  setTimeout(() => startSearch(), 200);
}
