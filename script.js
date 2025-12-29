// script.js — Improved reliability: retries, longer timeouts for Sharaf, client-side cache, jittered requests
document.addEventListener("DOMContentLoaded", () => {
  // === CONFIG ===
  const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
  const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";

  const MAX_SHARAF_PRODUCTS = 6;    // safety
  const SHARAF_CONCURRENCY = 2;     // parallel fetches
  const FETCH_TIMEOUT_MS = 12000;   // general fetch timeout
  const PRODUCT_TIMEOUT_MS = 25000; // sharaf product timeout (longer)
  const RETRIES = 2;                // number of retries for important calls
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  // === DOM ===
  const searchBtn = document.getElementById("searchBtn");
  const searchInput = document.getElementById("searchInput");
  const resultsEl = document.getElementById("searchResults");
  const loadingEl = document.getElementById("loading");
  const debugPanel = document.getElementById("debugPanel");
  const toggleDebugBtn = document.getElementById("toggleDebug");

  if (!searchBtn || !searchInput || !resultsEl || !loadingEl || !debugPanel || !toggleDebugBtn) {
    console.error("Missing required DOM elements. Check index.html IDs.");
    return;
  }

  // === Debug logger (page + console) ===
  function dbg(...args) {
    try {
      const msg = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      console.log(msg);
      debugPanel.textContent += msg + "\n";
      debugPanel.scrollTop = debugPanel.scrollHeight;
    } catch (e) { console.log("dbg error", e); }
  }

  toggleDebugBtn.addEventListener("click", () => {
    const shown = debugPanel.style.display !== "block";
    debugPanel.style.display = shown ? "block" : "none";
  });

  // === UI helpers ===
  function clearUI() {
    resultsEl.innerHTML = "";
    debugPanel.textContent = "";
    loadingEl.style.display = "block";
  }
  function doneUI() { loadingEl.style.display = "none"; }
  function createCard(p) {
    const div = document.createElement("div");
    div.className = "card";
    const priceText = p.price ? (p.price + " " + (p.currency || "AED")) : "Price N/A";
    div.innerHTML = `
      <img src="${p.image || ""}" alt="${(p.title||'')}" loading="lazy" />
      <h3>${p.title || "No title"}</h3>
      <div class="store-row">
        <div><strong>${priceText}</strong></div>
        <div>
          <span class="badge">${p.store || "Store"}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
        <a href="${p.link}" target="_blank">View on store</a>
        <div></div>
      </div>
    `;
    if (p.price) div.dataset.price = String(p.price);
    resultsEl.appendChild(div);
    return div;
  }
  function markBestPriceBadge() {
    const cards = Array.from(resultsEl.querySelectorAll(".card"));
    let bestCard = null;
    let bestPrice = Infinity;
    for (const c of cards) {
      const p = parseFloat((c.dataset.price || "").replace(/[^0-9.]/g, ""));
      if (!isNaN(p) && p < bestPrice) {
        bestPrice = p;
        bestCard = c;
      }
    }
    resultsEl.querySelectorAll(".best-badge").forEach(n=>n.remove());
    if (bestCard) {
      const el = document.createElement("span");
      el.className = "best-badge";
      el.textContent = "Best price";
      const sr = bestCard.querySelector(".store-row");
      if (sr) sr.appendChild(el);
    }
  }

  // === Simple local cache (localStorage) ===
  function cacheKey(url) { return "ph_cache:" + url; }
  function getCached(url) {
    try {
      const raw = localStorage.getItem(cacheKey(url));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj.ts || Date.now() - obj.ts > (obj.ttl || CACHE_TTL_MS)) {
        localStorage.removeItem(cacheKey(url));
        return null;
      }
      return obj.data;
    } catch (e) { return null; }
  }
  function setCached(url, data, ttl = CACHE_TTL_MS) {
    try {
      localStorage.setItem(cacheKey(url), JSON.stringify({ ts: Date.now(), ttl, data }));
    } catch (e) { /* ignore storage errors */ }
  }

  // === fetch with timeout ===
  async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  }

  // === fetch with retries + backoff ===
  async function fetchWithRetries(url, opts = {}, retries = RETRIES, timeoutMs = FETCH_TIMEOUT_MS, backoffMs = 800) {
    let attempt = 0;
    while (attempt <= retries) {
      try {
        attempt++;
        if (attempt > 1) dbg(`Retry attempt ${attempt} -> ${url}`);
        const res = await fetchWithTimeout(url, opts, timeoutMs);
        return res;
      } catch (err) {
        dbg(`Fetch error (attempt ${attempt}) ${url} ${String(err)}`);
        if (attempt > retries) throw err;
        // backoff
        await new Promise(r => setTimeout(r, backoffMs * attempt));
      }
    }
  }

  /* ---------------- AMAZON ---------------- */
  async function fetchAmazon(query) {
    const url = `${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`;
    dbg(`Query Amazon worker -> ${url}`);
    try {
      // try with one retry
      const res = await fetchWithRetries(url, {}, 1, 12000, 700);
      const data = await res.json();
      const list = data.results || [];
      dbg(`Amazon results count ${list.length}`);
      return list;
    } catch (e) {
      dbg("Amazon fetch error", String(e));
      return [];
    }
  }

  /* ---------------- SHARAF SEARCH LINKS ---------------- */
  async function fetchSharafLinks(query) {
    const url = `${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`;
    dbg(`Query Sharaf search -> ${url}`);
    try {
      const res = await fetchWithRetries(url, {}, 1, 10000, 700);
      const data = await res.json();
      const links = (data.results || []).map(r => r.link).slice(0, MAX_SHARAF_PRODUCTS);
      dbg(`Sharaf links count ${links.length}`);
      return links;
    } catch (e) {
      dbg("Sharaf search failed", String(e));
      return [];
    }
  }

  /* ---------------- SHARAF PRODUCT DETAILS (POOL, CACHE, RETRIES) ---------------- */
  async function fetchSharafProducts(links) {
    let index = 0;
    let successCount = 0;

    async function worker(id) {
      while (true) {
        const i = index++;
        if (i >= links.length) return;
        const productUrl = links[i];
        try {
          // check client cache first
          const cached = getCached(productUrl);
          if (cached) {
            dbg(`Sharaf product cached -> ${productUrl}`);
            createCard(cached);
            successCount++;
            markBestPriceBadge();
            // small pause then continue
            await new Promise(r => setTimeout(r, 120));
            continue;
          }

          // jitter to reduce bursts
          await new Promise(r => setTimeout(r, 150 * id + Math.floor(Math.random()*200)));

          const fetchUrl = `${SHARAF_WORKER}/product?url=${encodeURIComponent(productUrl)}`;
          dbg(`Sharaf product fetch -> ${productUrl}`);

          // Use retries with longer timeout for product pages
          const res = await fetchWithRetries(fetchUrl, {}, RETRIES, PRODUCT_TIMEOUT_MS, 900);
          const data = await res.json();

          if (data && (data.price || data.title)) {
            createCard(data);
            setCached(productUrl, data); // cache successful product
            successCount++;
            markBestPriceBadge();
          } else {
            dbg(`Sharaf product returned empty or no price -> ${productUrl}`);
          }
        } catch (err) {
          dbg(`Sharaf product error ${productUrl} ${String(err)}`);
        }
      }
    }

    // start worker pool (indexed so each has different jitter)
    const workers = [];
    for (let i = 0; i < SHARAF_CONCURRENCY; i++) {
      workers.push(worker(i));
    }
    await Promise.all(workers);
    dbg(`Sharaf priced items: ${successCount}`);
  }

  /* ---------------- MAIN SEARCH FLOW ---------------- */
  let lastToken = 0;
  async function startSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    const token = ++lastToken;
    clearUI();
    dbg(`Start search: "${query}"`);

    // Amazon first for quick UX
    const amazonList = await fetchAmazon(query);
    if (token !== lastToken) { dbg("Search aborted (new request)"); return; }

    if (amazonList.length) {
      amazonList.forEach(item => {
        const p = {
          store: item.store || "Amazon",
          title: item.title || item.name || "",
          price: item.price || item.finalPrice || null,
          currency: item.currency || item.currency_code || "AED",
          image: item.image || item.thumbnail || item.img || "",
          link: item.link || item.url || item.product_link || ""
        };
        createCard(p);
      });
      markBestPriceBadge();
    } else {
      dbg("Amazon results count 0");
    }

    // Sharaf
    const sharafLinks = await fetchSharafLinks(query);
    if (token !== lastToken) { dbg("Search aborted (new request)"); return; }
    if (sharafLinks.length) {
      dbg(`Fetching Sharaf product details (${sharafLinks.length})`);
      await fetchSharafProducts(sharafLinks);
    } else {
      dbg("Sharaf links count 0");
    }

    markBestPriceBadge();
    doneUI();
    dbg("Search finished");
  }

  // === events ===
  searchBtn.addEventListener("click", startSearch);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startSearch(); });

});
