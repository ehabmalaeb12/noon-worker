// script.js — defensive, guaranteed init, debug + 3 stores (Amazon/Noon/Sharaf)

// ---------------- CONFIG (keep worker URLs exact) ----------------
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
const NOON_WORKER    = "https://noon-worker.ehabmalaeb2.workers.dev";
const SHARAF_WORKER  = "https://sharaf-worker.ehabmalaeb2.workers.dev";

// ---------------- TUNABLE: speed / safety ----------------
const MAX_SHARAF_PRODUCTS = 5;
const SHARAF_CONCURRENCY = 2;
const FETCH_RETRIES = 3;
const FETCH_BASE_DELAY = 400;

// ---------------- state ----------------
let currentSearchId = 0;
let renderedItems = [];
let seenLinks = new Set();
let sharafRanOnce = false;
let sharafLastQuery = null;

// ---------------- wait DOM ready ----------------
document.addEventListener("DOMContentLoaded", () => {
  try {
    initUI();
  } catch (e) {
    // last-ditch: show error in an alert and console
    console.error("init error:", e);
    alert("Initialization error — check console");
  }
});

function initUI() {
  // elements
  const searchBtn = document.getElementById("searchBtn");
  const searchInput = document.getElementById("searchInput");
  const toggleDebugBtn = document.getElementById("toggleDebug");
  const debugPanel = document.getElementById("debugPanel");
  const loadingEl = document.getElementById("loading");
  const resultsEl = document.getElementById("searchResults");

  // small helpers closing over these elements
  function logToPanel(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}`;
    console.log(line);
    if (debugPanel) {
      debugPanel.textContent += line + "\n";
      debugPanel.scrollTop = debugPanel.scrollHeight;
    }
  }
  function showLoading(on = true) { if (loadingEl) loadingEl.style.display = on ? "block" : "none"; }
  function clearUI() {
    if (resultsEl) resultsEl.innerHTML = "";
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

  async function fetchWithRetry(url, opts = {}, attempts = FETCH_RETRIES, baseDelay = FETCH_BASE_DELAY) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (err) {
        lastErr = err;
        logToPanel(`fetch failed (${i+1}/${attempts}) ${url} — ${err.message || err}`);
        const wait = baseDelay * Math.pow(2, i);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  // Fetch functions
  async function fetchAmazon(query, sid) {
    const url = `${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`;
    const start = Date.now();
    try {
      logToPanel(`Amazon: start search "${query}" (sid=${sid})`);
      const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
      if (sid !== currentSearchId) { logToPanel("Amazon: stale results ignored"); return []; }
      const data = await res.json();
      logToPanel(`Amazon: ${data.results?.length || 0} items (took ${Date.now()-start}ms)`);
      return data.results || [];
    } catch (e) {
      logToPanel(`Amazon fetch error: ${e.message || e}`);
      return [];
    }
  }

  async function fetchNoon(query, sid) {
    const url = `${NOON_WORKER}/search?q=${encodeURIComponent(query)}`;
    const start = Date.now();
    try {
      logToPanel(`Noon: start search "${query}" (sid=${sid})`);
      const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
      if (sid !== currentSearchId) { logToPanel("Noon: stale results ignored"); return []; }
      const data = await res.json();
      logToPanel(`Noon: ${data.results?.length || 0} items (took ${Date.now()-start}ms)`);
      return data.results || [];
    } catch (e) {
      logToPanel(`Noon fetch error: ${e.message || e}`);
      return [];
    }
  }

  async function fetchSharafLinks(query, sid) {
    const url = `${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`;
    try {
      logToPanel(`Sharaf: start search "${query}" (sid=${sid})`);
      const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 300);
      if (sid !== currentSearchId) { logToPanel("Sharaf search: stale ignored"); return []; }
      const data = await res.json();
      const links = (data.results || []).map(r => r.link).filter(Boolean).slice(0, MAX_SHARAF_PRODUCTS);
      logToPanel(`Sharaf: links count ${links.length}`);
      return links;
    } catch (e) {
      logToPanel(`Sharaf search error: ${e.message || e}`);
      return [];
    }
  }

  async function fetchSharafProducts(links, sid) {
    let idx = 0;
    const results = [];

    async function worker() {
      while (idx < links.length) {
        const urlLink = links[idx++];
        if (sid !== currentSearchId) { logToPanel("Sharaf products: stale abort"); return; }
        try {
          logToPanel(`Sharaf product fetch -> ${urlLink}`);
          const url = `${SHARAF_WORKER}/product?url=${encodeURIComponent(urlLink)}`;
          const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, 2, 400);
          if (sid !== currentSearchId) { logToPanel("Sharaf product: stale ignored"); return; }
          const data = await res.json();
          if (data && (data.title || data.price || data.image)) {
            results.push(data);
            renderProduct(data);
          } else {
            logToPanel(`Sharaf product returned no fields -> ${urlLink}`);
          }
        } catch (e) {
          logToPanel(`Sharaf product error ${urlLink} — ${e.message || e}`);
        }
      }
    }

    const pool = Array.from({ length: Math.max(1, SHARAF_CONCURRENCY) }, () => worker());
    await Promise.all(pool);
    return results;
  }

  // Rendering + dedupe
  function renderProduct(p) {
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

  function getBestAmazonTitle(results) {
    if (!results || !results.length) return null;
    return results.map(r => r.title).filter(Boolean).sort((a,b) => b.length - a.length)[0] || null;
  }

  async function runSharafOnce(query, sid, reason = "initial") {
    if (!query) return;
    if (sharafLastQuery === query && sharafRanOnce) {
      logToPanel(`Sharaf: already ran for "${query}" — skip`);
      return;
    }
    sharafRanOnce = true;
    sharafLastQuery = query;
    logToPanel(`Sharaf: run (${reason}) with query="${query}" (sid=${sid})`);
    const links = await fetchSharafLinks(query, sid);
    if (links.length) await fetchSharafProducts(links, sid);
    else logToPanel(`Sharaf: no links found for "${query}"`);
  }

  // Main search flow
  async function startSearchInternal() {
    const q = (searchInput.value || "").trim();
    if (!q) return;
    currentSearchId++;
    const sid = currentSearchId;

    clearUI();
    logToPanel(`==== Start search "${q}" (sid=${sid}) ====`);
    showLoading(true);
    sharafRanOnce = false;
    sharafLastQuery = null;

    // Start Amazon + Noon in parallel (fast)
    const amazonP = fetchAmazon(q, sid);
    const noonP   = fetchNoon(q, sid);

    // Start Sharaf fallback (non-blocking)
    runSharafOnce(q, sid, "fallback");

    const [amazonResults, noonResults] = await Promise.all([amazonP, noonP]);

    if (sid !== currentSearchId) {
      logToPanel("Search changed — aborting (stale)");
      showLoading(false);
      return;
    }

    // Render Amazon quickly
    if (amazonResults && amazonResults.length) {
      logToPanel(`Rendering Amazon (${amazonResults.length})`);
      amazonResults.forEach(r => renderProduct({
        store: r.store || "Amazon.ae",
        title: r.title || r.asin || "Amazon item",
        price: r.price || null,
        currency: r.currency || "AED",
        image: r.image || null,
        link: r.link || (r.asin ? `https://www.amazon.ae/dp/${r.asin}` : "#")
      }));
    } else {
      logToPanel("Amazon returned no results");
    }

    // Render Noon
    if (noonResults && noonResults.length) {
      logToPanel(`Rendering Noon (${noonResults.length})`);
      noonResults.forEach(r => renderProduct({
        store: r.store || "Noon",
        title: r.title || r.name || "Noon item",
        price: r.price || null,
        currency: r.currency || "AED",
        image: r.image || null,
        link: r.link || r.url || "#"
      }));
    } else {
      logToPanel("Noon returned no results");
    }

    // If Amazon provided a better title, re-run Sharaf once with that title
    const bestAmazonTitle = getBestAmazonTitle(amazonResults);
    if (bestAmazonTitle && bestAmazonTitle.toLowerCase() !== q.toLowerCase()) {
      logToPanel(`Amazon refined title -> "${bestAmazonTitle}" ; re-running Sharaf`);
      await runSharafOnce(bestAmazonTitle, sid, "amazon-refine");
    } else {
      logToPanel("No Amazon-refine needed for Sharaf");
    }

    showLoading(false);
    logToPanel("Search finished");
  }

  // Attach events
  searchBtn.addEventListener("click", startSearchInternal);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startSearchInternal(); });
  toggleDebugBtn.addEventListener("click", () => {
    if (!debugPanel) return;
    debugPanel.style.display = debugPanel.style.display === "block" ? "none" : "block";
  });

  // auto-run initial if input prefilled
  if (searchInput && searchInput.value && searchInput.value.trim() !== "") {
    setTimeout(() => startSearchInternal(), 200);
  }

  // expose debug logger globally for dev console
  window.__uph_log = (m) => logToPanel(String(m));
}
