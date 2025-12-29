// script.js
// Optimized search + progressive rendering for Amazon (shopping-worker) + SharafDG (sharaf-worker)
// Key speed features:
// - Sharaf product fetch limit (5) to reduce time and cost
// - Concurrency limit for Sharaf (3)
// - Per-product timeout (15s)
// - In-memory cache for Sharaf product details
// - Progressive append rendering and live "best price" badge updates

(() => {
  // -------- CONFIG ----------
  const SHOPPING_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
  const SHARAF_SEARCH_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";
  const SHARAF_PRODUCT_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=";

  const SHARAF_MAX_PRODUCTS = 5;       // reduce to 5 for speed (change if needed)
  const SHARAF_CONCURRENCY = 3;        // concurrency (don't exceed 3)
  const SHARAF_TIMEOUT_MS = 15000;     // per-product timeout (ms)

  // UI element selectors (fallback handles if not present)
  const $ = (id) => document.getElementById(id);
  const inputEl = $("searchInput") || document.querySelector("input") || null;
  const btnEl = $("searchBtn") || document.querySelector("button[type='submit']") || null;
  const resultsEl = $("searchResults") || (() => {
    const d = document.createElement("div");
    d.id = "searchResults";
    document.body.appendChild(d);
    return d;
  })();
  const debugBox = $("debugBox") || (() => {
    const pre = document.createElement("pre");
    pre.id = "debugBox";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.background = "#000";
    pre.style.color = "#0f0";
    pre.style.padding = "12px";
    pre.style.borderRadius = "8px";
    pre.style.display = "none"; // hidden by default
    document.body.appendChild(pre);
    return pre;
  })();
  const toggleDebugBtn = (() => {
    const b = $("toggleDebug") || null;
    if (b) return b;
    const btn = document.createElement("button");
    btn.id = "toggleDebug";
    btn.innerText = "Toggle Debug";
    btn.style.margin = "8px";
    btn.addEventListener("click", () => {
      debugBox.style.display = debugBox.style.display === "none" ? "block" : "none";
    });
    // try to insert near top (header area)
    const header = document.querySelector("header") || document.body;
    header.appendChild(btn);
    return btn;
  })();

  // -------- State & Cache ----------
  const sharafCache = new Map(); // url -> product (cached during session)
  let lastQuery = "";
  let activeSearchId = 0;

  // group map: groupKey -> {items:[], bestPrice}
  const groups = new Map();

  // -------- Utils ----------
  function logDebug(...args) {
    const s = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    console.log(...args);
    debugBox.textContent += s + "\n";
  }

  function clearDebug() {
    debugBox.textContent = "";
  }

  function normalizeKey(title = "") {
    return String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")   // keep arabic unicode + ascii letters/numbers
      .trim()
      .replace(/\s+/g, " ");
  }

  function formatPrice(p) {
    if (p == null || isNaN(Number(p))) return "";
    return Number(p).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function withTimeoutFetch(url, opts = {}, ms = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);
    const finalOpts = Object.assign({}, opts, { signal: controller.signal });
    return fetch(url, finalOpts)
      .finally(() => clearTimeout(timeoutId));
  }

  async function fetchJsonWithTimeout(url, ms = 15000) {
    const res = await withTimeoutFetch(url, { headers: { "Accept": "application/json" } }, ms);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
  }

  // concurrency runner for array of tasks (promises returning function)
  async function runWithConcurrency(tasks = [], concurrency = 3) {
    const results = [];
    let i = 0;
    const active = new Set();

    async function runTask(idx) {
      if (idx >= tasks.length) return;
      const task = tasks[idx];
      const p = task().then(r => {
        active.delete(p);
        return r;
      }).catch(err => {
        active.delete(p);
        return { __error: String(err) };
      });
      active.add(p);
      results[idx] = p;
      // start next if any
      if (i < tasks.length) {
        const next = i++;
        await runTask(next);
      }
    }

    // start initial batch
    const starters = [];
    while (i < tasks.length && starters.length < concurrency) {
      starters.push(runTask(i++));
    }
    await Promise.all(starters);
    // wait for all to finish
    return Promise.all(results);
  }

  // -------- Rendering ----------
  function makeCard(item) {
    const card = document.createElement("div");
    card.className = "card";
    card.style.padding = "12px";
    card.style.borderRadius = "10px";
    card.style.boxShadow = "0 6px 16px rgba(10,10,10,0.04)";
    card.style.background = "#fff";
    card.style.margin = "8px";
    card.style.maxWidth = "360px";
    card.style.flex = "1 1 300px";
    // contents
    const img = document.createElement("img");
    img.src = item.image || "";
    img.alt = item.title || "";
    img.style.width = "100%";
    img.style.height = "160px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "6px";

    const title = document.createElement("div");
    title.innerText = item.title || "(no title)";
    title.style.marginTop = "8px";
    title.style.fontWeight = "600";

    const priceRow = document.createElement("div");
    priceRow.style.display = "flex";
    priceRow.style.justifyContent = "space-between";
    priceRow.style.alignItems = "center";
    priceRow.style.marginTop = "8px";

    const priceSpan = document.createElement("div");
    priceSpan.innerText = item.price ? `${formatPrice(item.price)} AED` : "—";
    priceSpan.style.fontWeight = "700";
    priceSpan.style.color = "#0b69ff";

    const storeBtn = document.createElement("a");
    storeBtn.href = item.link || "#";
    storeBtn.target = "_blank";
    storeBtn.rel = "noopener noreferrer";
    storeBtn.innerText = item.store ? `View on ${item.store}` : "View";
    storeBtn.style.background = "#0b69ff";
    storeBtn.style.color = "#fff";
    storeBtn.style.padding = "8px 12px";
    storeBtn.style.borderRadius = "8px";
    storeBtn.style.textDecoration = "none";
    storeBtn.style.fontSize = "14px";

    const badge = document.createElement("span");
    badge.className = "best-badge";
    badge.style.display = item.isBest ? "inline-block" : "none";
    badge.style.background = "#0ec17a";
    badge.style.color = "#fff";
    badge.style.padding = "4px 8px";
    badge.style.borderRadius = "999px";
    badge.style.marginLeft = "8px";
    badge.innerText = "Best price";

    priceRow.appendChild(priceSpan);
    priceRow.appendChild(badge);

    const bottomRow = document.createElement("div");
    bottomRow.style.display = "flex";
    bottomRow.style.justifyContent = "space-between";
    bottomRow.style.alignItems = "center";
    bottomRow.style.marginTop = "8px";

    bottomRow.appendChild(storeBtn);

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(priceRow);
    card.appendChild(bottomRow);

    // attach dataset
    if (item._id) card.dataset.itemId = item._id;
    return card;
  }

  // Group rendering: each group gets a container; we update best price badge when item is added
  function ensureGroupContainer(key, displayTitle) {
    let g = groups.get(key);
    if (g && g.container) return g;
    const container = document.createElement("div");
    container.className = "group";
    container.style.borderRadius = "10px";
    container.style.background = "#fff";
    container.style.padding = "12px";
    container.style.margin = "12px 0";
    // header
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    const h = document.createElement("h3");
    h.innerText = displayTitle || key;
    h.style.margin = "0";
    const meta = document.createElement("div");
    meta.style.fontSize = "13px";
    meta.style.color = "#666";
    meta.innerText = ""; // will show counts
    header.appendChild(h);
    header.appendChild(meta);
    // grid for cards
    const grid = document.createElement("div");
    grid.style.display = "flex";
    grid.style.flexWrap = "wrap";
    grid.style.gap = "12px";
    grid.style.marginTop = "12px";

    container.appendChild(header);
    container.appendChild(grid);

    resultsEl.appendChild(container);

    if (!g) {
      g = { items: [], best: null, container, headerEl: h, metaEl: meta, gridEl: grid };
      groups.set(key, g);
    } else {
      g.container = container;
      g.headerEl = h;
      g.metaEl = meta;
      g.gridEl = grid;
    }
    return g;
  }

  function updateGroupDisplay(key) {
    const g = groups.get(key);
    if (!g) return;
    g.metaEl.innerText = `${g.items.length} offers`;
    // update badges in DOM
    for (const [idx, it] of g.items.entries()) {
      const id = it._id || `${key}-${idx}`;
      const card = g.gridEl.querySelector(`[data-item-id="${id}"]`);
      if (card) {
        const badge = card.querySelector(".best-badge");
        if (badge) badge.style.display = (g.best && it.price === g.best.price) ? "inline-block" : "none";
      }
    }
  }

  function addItemToGroup(item) {
    const key = normalizeKey(item.title || item.link || item.store || "unknown");
    const displayTitle = item.title || key;
    const g = ensureGroupContainer(key, displayTitle);

    // unique id for DOM
    item._id = (item._id || ("id_" + Math.random().toString(36).slice(2,9)));
    g.items.push(item);

    // update best price
    if (item.price != null) {
      if (!g.best || item.price < g.best.price) {
        g.best = item;
      }
    }

    // render card
    const card = makeCard(item);
    card.dataset.itemId = item._id;
    // append to group's grid
    g.gridEl.appendChild(card);

    // update badges / meta
    updateGroupDisplay(key);
  }

  // -------- Search logic ----------
  function clearResults() {
    resultsEl.innerHTML = "";
    groups.clear();
  }

  async function searchAmazon(query) {
    const url = `${SHOPPING_WORKER}/search?q=${encodeURIComponent(query)}`;
    const start = Date.now();
    try {
      const json = await fetchJsonWithTimeout(url, 15000);
      logDebug(`Amazon results count ${json.count || (json.results && json.results.length) || 0}`);
      return json.results || [];
    } catch (err) {
      logDebug("Amazon fetch error", String(err));
      return [];
    } finally {
      // nothing
    }
  }

  async function searchSharaf(query) {
    const url = `${SHARAF_SEARCH_WORKER}/search?q=${encodeURIComponent(query)}`;
    try {
      const json = await fetchJsonWithTimeout(url, 15000);
      const links = (json.results || []).map(r => r.link).filter(Boolean);
      logDebug(`Sharaf links count ${links.length}`);
      return links;
    } catch (err) {
      logDebug("Sharaf search failed", String(err));
      // fallback: return []
      return [];
    }
  }

  // fetch product details from sharaf product worker with timeout + caching
  async function fetchSharafProduct(link) {
    // canonicalize link
    const encoded = encodeURIComponent(link);
    const url = SHARAF_PRODUCT_WORKER + encoded;

    if (sharafCache.has(link)) {
      return sharafCache.get(link);
    }

    try {
      // use timeout
      const json = await fetchJsonWithTimeout(url, SHARAF_TIMEOUT_MS);
      // ensure normalized fields
      const product = {
        store: json.store || "SharafDG",
        title: json.title || null,
        price: (json.price !== undefined && json.price !== null) ? Number(json.price) : null,
        currency: json.currency || "AED",
        image: json.image || null,
        link: json.link || link,
      };
      sharafCache.set(link, product);
      return product;
    } catch (err) {
      logDebug("Sharaf product error", link, String(err));
      return null;
    }
  }

  // orchestrate combined search
  async function runSearch(query) {
    activeSearchId++;
    const thisSearchId = activeSearchId;
    lastQuery = query;
    clearDebug();
    clearResults();
    debugBox.style.display = "none";

    logDebug(`Start search: "${query}"`);

    // 1) kick off Amazon & Sharaf search in parallel
    const [amazonRes, sharafLinks] = await Promise.all([
      searchAmazon(query),
      searchSharaf(query),
    ]);

    // if another search started meanwhile, abort rendering this one
    if (thisSearchId !== activeSearchId) {
      logDebug("Search aborted due to new request");
      return;
    }

    // Render Amazon results immediately
    if (Array.isArray(amazonRes) && amazonRes.length) {
      for (const a of amazonRes) {
        // a: {id, asin, title, price, image, link, store}
        const it = {
          ...a,
          price: a.price != null ? Number(a.price) : null,
          store: a.store || "Amazon.ae",
        };
        addItemToGroup(it);
      }
    } else {
      logDebug("Amazon results count 0");
    }

    // If no Sharaf links, nothing more (but we still show Amazon)
    if (!Array.isArray(sharafLinks) || sharafLinks.length === 0) {
      logDebug("No sharaf links found");
      return;
    }

    // Trim Sharaf links to limit for speed
    const trimmed = sharafLinks.slice(0, SHARAF_MAX_PRODUCTS);
    logDebug(`Fetching Sharaf product details (${trimmed.length})`);

    // Build tasks for concurrency runner
    const tasks = trimmed.map(link => async () => {
      // if another search started: short-circuit
      if (thisSearchId !== activeSearchId) return null;
      const p = await fetchSharafProduct(link);
      if (!p) return null;
      // append to UI progressively
      addItemToGroup({
        ...p,
        store: "SharafDG",
      });
      return p;
    });

    // run tasks with concurrency and timeout per task handled inside fetchSharafProduct
    await runWithConcurrency(tasks, SHARAF_CONCURRENCY);

    logDebug("Search finished");
  }

  // -------- Bind UI ----------
  function attachHandlers() {
    if (btnEl) {
      btnEl.addEventListener("click", (e) => {
        e.preventDefault();
        const q = inputEl ? inputEl.value.trim() : "";
        if (!q) return;
        runSearch(q);
      });
    } else {
      // try to bind enter key on input
      if (inputEl) {
        inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const q = inputEl.value.trim();
            if (!q) return;
            runSearch(q);
          }
        });
      }
    }

    if (toggleDebugBtn) {
      toggleDebugBtn.addEventListener("click", () => {
        debugBox.style.display = debugBox.style.display === "none" ? "block" : "none";
      });
    }
  }

  // -------- Init ----------
  function init() {
    // minimal styling for resultsEl
    resultsEl.style.padding = "16px";
    resultsEl.style.display = "flex";
    resultsEl.style.flexDirection = "column";

    attachHandlers();

    // if input has an initial value, run search once
    const initial = (inputEl && inputEl.value && inputEl.value.trim()) || null;
    if (initial) {
      // delay a tick so UI mounts
      setTimeout(() => runSearch(initial), 300);
    }
  }

  // expose for debugging in console
  window.__uaePriceHunter = {
    runSearch,
    sharafCache,
    config: {
      SHARAF_MAX_PRODUCTS,
      SHARAF_CONCURRENCY,
      SHARAF_TIMEOUT_MS
    }
  };

  // start
  init();
})();
