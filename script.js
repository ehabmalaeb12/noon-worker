// script.js — client for Amazon + Sharaf workers
(() => {
  const SEARCH_AMAZON = "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
  const SEARCH_SHARAF = "https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=";
  const SHARAF_PRODUCT = "https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=";

  const qEl = document.getElementById("q");
  const btn = document.getElementById("searchBtn");
  const resultsEl = document.getElementById("results");
  const statusEl = document.getElementById("status");
  const debugPanel = document.getElementById("debugPanel");
  const dbg = document.getElementById("dbg");
  const toggleDebug = document.getElementById("toggleDebug");

  let running = false;

  function logDebug(...args) {
    console.log(...args);
    dbg.textContent += args.map(a => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ") + "\n";
    debugPanel.classList.remove("hidden");
  }

  toggleDebug.addEventListener("click", () => {
    debugPanel.classList.toggle("hidden");
  });

  // Prevent duplicate searches
  btn.addEventListener("click", startSearch);
  qEl.addEventListener("keydown", e => {
    if (e.key === "Enter") startSearch();
  });

  async function startSearch(){
    if (running) {
      console.log("Search already running — ignoring duplicate trigger.");
      return;
    }
    const query = (qEl.value || "").trim();
    if (!query) {
      statusEl.textContent = "Type a query first.";
      return;
    }
    running = true;
    btn.disabled = true;
    resultsEl.innerHTML = "";
    dbg.textContent = "";
    statusEl.textContent = `Start search: "${query}"`;
    logDebug(`Start search: "${query}"`);

    try {
      // Kick off both workers in parallel
      const amazonPromise = fetchJson(SEARCH_AMAZON + encodeURIComponent(query), 25000).catch(e => ({ error: e.message }));
      const sharafSearchPromise = fetchJson(SEARCH_SHARAF + encodeURIComponent(query), 25000).catch(e => ({ error: e.message }));

      const [amazonResp, sharafResp] = await Promise.all([amazonPromise, sharafSearchPromise]);

      // handle Amazon
      const amazonItems = (amazonResp && Array.isArray(amazonResp.results)) ? amazonResp.results : (amazonResp && amazonResp.results) || [];
      logDebug("Amazon results count", amazonItems.length);
      statusEl.textContent = `Amazon results count ${amazonItems.length}`;

      // handle Sharaf: response is list of product links
      let sharafLinks = [];
      if (sharafResp && Array.isArray(sharafResp.results)) {
        sharafLinks = sharafResp.results.map(r => r.link).filter(Boolean);
      } else if (sharafResp && sharafResp.results && sharafResp.results.length) {
        sharafLinks = sharafResp.results.map(r => r.link).filter(Boolean);
      } else if (sharafResp && sharafResp.error) {
        logDebug("Sharaf search error", sharafResp.error);
      }
      logDebug("Sharaf links count", sharafLinks.length);
      statusEl.textContent = `Sharaf links count ${sharafLinks.length}`;

      // Fetch Sharaf product details (limit to 10 to keep it fast)
      const maxSharaf = 10;
      const linksToFetch = sharafLinks.slice(0, maxSharaf);
      const sharafProducts = [];

      if (linksToFetch.length) {
        logDebug(`Fetching Sharaf product details (${linksToFetch.length})`);
        statusEl.textContent = `Fetching Sharaf product details (${linksToFetch.length})`;

        // Fetch sequentially or with small concurrency to avoid aborts
        const concurrency = 4;
        const batches = [];
        for (let i = 0; i < linksToFetch.length; i += concurrency) {
          batches.push(linksToFetch.slice(i, i + concurrency));
        }

        for (const batch of batches) {
          const tasks = batch.map(link => {
            const u = SHARAF_PRODUCT + encodeURIComponent(link);
            // sharaf product may take a while — give a longer timeout
            return fetchJson(u, 45000).catch(e => ({ error: e.message }));
          });
          const results = await Promise.all(tasks);
          results.forEach(r => {
            if (r && !r.error) sharafProducts.push(r);
            else logDebug("Sharaf product error", r && r.error);
          });
        }
      }

      logDebug("Sharaf priced items:", sharafProducts.length);

      // Normalize both lists into unified items array
      const unified = [];

      // Amazon normalization (flexible)
      for (const a of amazonItems) {
        unified.push({
          id: a.asin || a.id || a.link || (`amazon:${Math.random().toString(36).slice(2,9)}`),
          title: a.title || a.name || a.titleRaw || "",
          price: numeric(a.price || a.price_raw || a.amount || a.display_price || null),
          currency: a.currency || a.currency_code || "AED",
          image: a.image || a.thumbnail || a.img || null,
          link: a.link || a.url || a.product_url || null,
          store: a.store || "Amazon.ae",
        });
      }

      // Sharaf normalization
      for (const s of sharafProducts) {
        unified.push({
          id: s.id || s.link || (`sharaf:${Math.random().toString(36).slice(2,9)}`),
          title: s.title || s.name || "",
          price: numeric(s.price || null),
          currency: s.currency || "AED",
          image: s.image || null,
          link: s.link || null,
          store: s.store || "SharafDG",
        });
      }

      logDebug("Merged count", unified.length);
      statusEl.textContent = `Search finished, merged count ${unified.length}`;

      // Group similar products by normalized title key (simple approach)
      const groups = groupByTitle(unified);

      // Determine best price per group
      for (const g of groups) {
        const prices = g.items.filter(it => it.price !== null && !isNaN(it.price)).map(it => it.price);
        g.bestPrice = prices.length ? Math.min(...prices) : null;
      }

      // Render all groups
      renderGroups(groups);

    } catch (err) {
      console.error(err);
      logDebug("Fatal error", err && err.message);
      statusEl.textContent = "Search failed: " + (err && err.message);
    } finally {
      running = false;
      btn.disabled = false;
    }
  }

  // --- helpers ---

  // basic numeric parser
  function numeric(v) {
    if (v == null) return null;
    const s = String(v).replace(/[^\d.,]/g, "").replace(/,/g, "");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // fetch with timeout, returns parsed json or throws
  async function fetchJson(url, timeout = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch (e) {
        // some worker return pretty printed JSON, attempt parse anyway
        return JSON.parse(txt);
      }
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  // naive title normalization for grouping
  function normalizeTitle(t) {
    if (!t) return "";
    return t
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function groupByTitle(items) {
    const map = new Map();
    for (const it of items) {
      const key = normalizeTitle(it.title).split(" ").slice(0,6).join(" ") || it.id;
      if (!map.has(key)) map.set(key, { key, items: [] });
      map.get(key).items.push(it);
    }
    return Array.from(map.values());
  }

  // render groups as cards, showing group title, best price badge and store cards inside
  function renderGroups(groups) {
    resultsEl.innerHTML = "";
    if (!groups || groups.length === 0) {
      resultsEl.innerHTML = "<p>No products with prices found.</p>";
      return;
    }

    // for better UX, sort groups with at least one price first, then by bestPrice ascending
    groups.sort((a,b) => {
      const aHas = a.bestPrice !== null;
      const bHas = b.bestPrice !== null;
      if (aHas && bHas) return a.bestPrice - b.bestPrice;
      if (aHas) return -1;
      if (bHas) return 1;
      return 0;
    });

    for (const g of groups) {
      // group container element
      const groupEl = document.createElement("div");
      groupEl.className = "card";
      const mainTitle = g.items.find(i => i.title)?.title || g.key || "Untitled product";

      // Best price badge
      let badgeHTML = "";
      if (g.bestPrice !== null) {
        badgeHTML = `<span class="badge">Best price ${g.bestPrice} ${g.items[0].currency || "AED"}</span>`;
      } else {
        badgeHTML = `<span style="color:#888;font-size:13px;margin-left:8px">Price unavailable</span>`;
      }

      // assemble per-store rows inside group
      const storesHTML = g.items.map(it => {
        const img = it.image ? `<img src="${it.image}" loading="lazy" alt="" />` : `<div style="height:140px;background:#fafafa;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#aaa">No image</div>`;
        const priceText = (it.price !== null && it.price !== undefined && !isNaN(it.price)) ? `${it.price} ${it.currency || "AED"}` : `Price unavailable`;
        return `
          <div style="display:flex;gap:12px;align-items:center;margin-top:8px">
            <div style="width:78px;flex:0 0 78px">${img}</div>
            <div style="flex:1">
              <div style="font-weight:600">${it.title || "No title"}</div>
              <div style="margin-top:6px"><strong style="color:var(--accent)">${priceText}</strong> <span style="color:#666">• ${it.store}</span></div>
              <div style="margin-top:8px"><a href="${it.link}" target="_blank" style="text-decoration:none;color:var(--accent)">View on ${it.store}</a></div>
            </div>
          </div>
        `;
      }).join("");

      groupEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px">
          <div style="flex:1">
            <div class="title">${escapeHtml(mainTitle)}</div>
          </div>
          <div>${badgeHTML}</div>
        </div>
        <div>${storesHTML}</div>
      `;

      resultsEl.appendChild(groupEl);
    }
  }

  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

})();
