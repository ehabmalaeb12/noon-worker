// script.js — robust UI, on-page debug, timeouts, safe concurrency
document.addEventListener("DOMContentLoaded", () => {
  // === CONFIG ===
  const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
  const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";

  const MAX_SHARAF_PRODUCTS = 5;    // speed safety
  const SHARAF_CONCURRENCY = 2;     // safe parallelism
  const FETCH_TIMEOUT_MS = 12000;   // generic fetch timeout

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

  function doneUI() {
    loadingEl.style.display = "none";
  }

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
        <div id="best-${Math.random().toString(36).slice(2,8)}"></div>
      </div>
    `;
    // attach price as data for later best-price calc
    if (p.price) div.dataset.price = String(p.price);
    resultsEl.appendChild(div);
    return div;
  }

  // mark best price across all cards (lowest numeric)
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
    // remove previous badges
    resultsEl.querySelectorAll(".best-badge").forEach(n=>n.remove());
    if (bestCard) {
      const el = document.createElement("span");
      el.className = "best-badge";
      el.textContent = "Best price";
      // append beside store badge
      const sr = bestCard.querySelector(".store-row");
      if (sr) sr.appendChild(el);
    }
  }

  // fetch with timeout
  async function timeoutFetch(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  }

  /* ---------------- AMAZON ---------------- */
  async function fetchAmazon(query) {
    try {
      const url = `${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`;
      dbg(`Query Amazon worker -> ${url}`);
      const res = await timeoutFetch(url, {}, 10000);
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
    try {
      const url = `${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`;
      dbg(`Query Sharaf search -> ${url}`);
      const res = await timeoutFetch(url, {}, 10000);
      const data = await res.json();
      const links = (data.results || []).map(r => r.link).slice(0, MAX_SHARAF_PRODUCTS);
      dbg(`Sharaf links count ${links.length}`);
      return links;
    } catch (e) {
      dbg("Sharaf search failed", String(e));
      return [];
    }
  }

  /* ---------------- SHARAF PRODUCT DETAILS (CONCURRENT POOL) ---------------- */
  async function fetchSharafProducts(links) {
    let idx = 0;
    let successCount = 0;

    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= links.length) return;
        const url = links[i];
        try {
          dbg(`Sharaf product fetch -> ${url}`);
          const fetchUrl = `${SHARAF_WORKER}/product?url=${encodeURIComponent(url)}`;
          const res = await timeoutFetch(fetchUrl, {}, 15000);
          const data = await res.json();
          if (data && (data.price || data.title)) {
            createCard(data);
            successCount++;
            // update best price after each new product for responsive UX
            markBestPriceBadge();
          } else {
            dbg(`Sharaf product returned no price: ${url}`);
          }
        } catch (err) {
          dbg(`Sharaf product error ${url} ${String(err)}`);
        }
      }
    }

    const workers = Array.from({length: SHARAF_CONCURRENCY}, ()=>worker());
    await Promise.all(workers);
    dbg(`Sharaf priced items: ${successCount}`);
  }

  /* ---------------- MAIN SEARCH FLOW ---------------- */
  let lastSearchToken = 0;
  async function startSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    const searchToken = ++lastSearchToken; // cancel older runs
    clearUI();
    dbg(`Start search: "${query}"`);

    // Amazon first for quick UX
    const amazonList = await fetchAmazon(query);
    if (searchToken !== lastSearchToken) { dbg("Search aborted due to new request"); return; }

    if (amazonList.length) {
      amazonList.forEach(item => {
        // Normalize minimal fields to match sharaf shape
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
      // mark best price among amazon first
      markBestPriceBadge();
    } else {
      dbg("Amazon results count 0");
    }

    // Sharaf links & product details
    const sharafLinks = await fetchSharafLinks(query);
    if (searchToken !== lastSearchToken) { dbg("Search aborted due to new request"); return; }

    if (sharafLinks.length) {
      dbg(`Fetching Sharaf product details (${sharafLinks.length})`);
      await fetchSharafProducts(sharafLinks);
    } else {
      dbg("Sharaf links count 0");
    }

    // final best price highlight (recompute)
    markBestPriceBadge();

    doneUI();
    dbg("Search finished");
  }

  // === events ===
  searchBtn.addEventListener("click", startSearch);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startSearch(); });

});
