/* script.js — UAE Price Hunter
   Expects:
     <input id="searchInput">, <button id="searchBtn">,
     <div id="loading">, <div id="searchResults">
*/

const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_SEARCH = "https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_PRODUCT_BASE = "https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=";

const SHARAF_CONCURRENCY = 4;
const SHARAF_TIMEOUT_MS = 30000;
const SHARAF_MAX_RETRIES = 1;

const $ = id => document.getElementById(id);
const loadingEl = $("loading");
const resultsEl = $("searchResults");
const searchInput = $("searchInput");
const searchBtn = $("searchBtn");

function log(...args){ console.debug("[UAE-PH]", ...args); }
function showLoading(on){ if(!loadingEl) return; loadingEl.style.display = on ? "block" : "none"; }

searchBtn?.addEventListener("click", () => doSearch(searchInput.value.trim()));
searchInput?.addEventListener("keyup", e => { if(e.key === "Enter") doSearch(searchInput.value.trim()); });

// --- Utilities ---
function normalizeTitle(t){
  if(!t) return "";
  return t.toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function timeoutPromise(ms, controller){
  return new Promise((_, rej) => setTimeout(() => {
    controller.abort();
    rej(new Error("timeout"));
  }, ms));
}

// --- Sharaf product fetch (robust) ---
async function fetchProductFromSharaf(productPageUrl){
  const encoded = encodeURIComponent(productPageUrl);
  const url = SHARAF_PRODUCT_BASE + encoded;
  let attempt = 0;

  while(attempt <= SHARAF_MAX_RETRIES){
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHARAF_TIMEOUT_MS);
    try {
      log("Sharaf fetch start", { url, attempt });
      const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } });
      clearTimeout(timer);
      if(!res.ok){
        log("Sharaf non-ok", res.status, url);
        if(attempt <= SHARAF_MAX_RETRIES){ await new Promise(r => setTimeout(r, 500 * attempt)); continue; }
        return null;
      }
      const json = await res.json();
      // validate minimal fields
      const hasAny = json && (json.price != null || json.title || json.image);
      if(!hasAny){
        log("Sharaf empty product json", url, json && json.debug ? json.debug : "");
        if(attempt <= SHARAF_MAX_RETRIES){ await new Promise(r => setTimeout(r, 500 * attempt)); continue; }
        return null;
      }
      // normalize output shape
      return {
        id: json.link || json.title || productPageUrl,
        store: "SharafDG",
        title: json.title || null,
        price: json.price != null ? Number(json.price) : null,
        currency: json.currency || "AED",
        image: json.image || null,
        link: json.link || productPageUrl,
        debug: json.debug || null
      };
    } catch(err){
      clearTimeout(timer);
      const isAbort = err && (err.name === "AbortError" || String(err).toLowerCase().includes("abort"));
      log("Sharaf fetch error", { url, attempt, err: String(err), isAbort });
      if(attempt <= SHARAF_MAX_RETRIES){ await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
      return null;
    }
  }
  return null;
}

async function fetchSharafProducts(productLinks = []){
  const results = [];
  let idx = 0;
  const pool = Array(Math.min(SHARAF_CONCURRENCY, productLinks.length)).fill(0).map(async () => {
    while(true){
      const i = idx++;
      if(i >= productLinks.length) break;
      const link = productLinks[i];
      try {
        const p = await fetchProductFromSharaf(link);
        if(p) results.push(p);
        else log("Sharaf product failed", link);
      } catch(e){
        log("Sharaf worker unexpected", e);
      }
    }
  });
  await Promise.all(pool);
  return results;
}

// --- Amazon search (simple) ---
async function fetchAmazonResults(query){
  const url = AMAZON_WORKER + encodeURIComponent(query);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error("Amazon worker non-ok: " + res.status);
    const json = await res.json();
    // expected results array of objects like {id, asin, title, price, currency, image, link, store}
    return Array.isArray(json.results) ? json.results : json.results || json;
  } catch(err){
    log("Amazon fetch error", err);
    return [];
  }
}

// --- Sharaf search (get product links) ---
async function fetchSharafSearchLinks(query){
  const url = SHARAF_SEARCH + encodeURIComponent(query);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error("Sharaf search non-ok: " + res.status);
    const json = await res.json();
    // expect json.results: [{store, link}, ...]
    const links = (json.results || []).map(r => r.link).filter(Boolean);
    log("Sharaf search links", links.length);
    return links;
  } catch(err){
    log("Sharaf search error", err);
    return [];
  }
}

// --- Merge / group products ---
function groupProducts(allProducts){
  // Group by ASIN if present, else normalized title
  const map = new Map();
  for(const p of allProducts){
    const key = (p.asin ? `asin:${p.asin}` : `t:${normalizeTitle(p.title)}`);
    if(!map.has(key)) map.set(key, { key, items: [], title: p.title || null });
    map.get(key).items.push(p);
    if(!map.get(key).title && p.title) map.get(key).title = p.title;
  }
  // compute best price per group
  const groups = [];
  for(const [k,v] of map.entries()){
    const items = v.items;
    let best = null;
    for(const it of items){
      if(it.price != null){
        if(best == null || it.price < best.price) best = it;
      }
    }
    groups.push({ key: k, title: v.title, items, bestPrice: best ? best.price : null, bestStore: best ? best.store : null });
  }
  // sort groups by bestPrice asc or by presence of price then title
  groups.sort((a,b) => {
    if(a.bestPrice != null && b.bestPrice != null) return a.bestPrice - b.bestPrice;
    if(a.bestPrice != null) return -1;
    if(b.bestPrice != null) return 1;
    return (a.title || "").localeCompare(b.title || "");
  });
  return groups;
}

// --- Render ---
function currencyFormat(v){ return v == null ? "-" : `${v.toFixed ? v.toFixed(2) : v} AED`; }

function createStoreRow(item, isBest){
  const div = document.createElement("div");
  div.className = "store-row";
  div.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center">
      ${item.image ? `<img src="${item.image}" style="width:56px;height:56px;object-fit:cover;border-radius:6px">` : `<div style="width:56px;height:56px;background:#f0f0f0;border-radius:6px"></div>`}
      <div style="min-width:0">
        <div style="font-weight:600">${item.store || "Store"}</div>
        <div style="font-size:13px;color:#666">${item.title || ""}</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:700">${item.price!=null?currencyFormat(Number(item.price)): "-"}</div>
      <div style="margin-top:6px"><a href="${item.link}" target="_blank" rel="noopener" style="text-decoration:none;color:#0b69ff">Open</a></div>
    </div>
  `;
  if(isBest){
    const badge = document.createElement("span");
    badge.className = "badge best-badge";
    badge.textContent = "BEST PRICE";
    badge.style.marginLeft = "8px";
    badge.title = "Lowest price among stores";
    div.querySelector("div")?.appendChild(badge);
  }
  return div;
}

function renderGroups(groups){
  resultsEl.innerHTML = "";
  if(!groups.length){
    resultsEl.innerHTML = `<div style="color:#666">No products found</div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "grid";
  for(const g of groups){
    const card = document.createElement("div");
    card.className = "card";
    const title = g.title || (g.items[0] && g.items[0].title) || "Product";
    const bestPriceText = g.bestPrice != null ? currencyFormat(g.bestPrice) : "—";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:700;min-width:0">${title}</div>
        <div style="font-size:13px;color:#333">Best: <strong>${bestPriceText}</strong></div>
      </div>
      <div style="margin-top:8px" id="storeList-${g.key}"></div>
    `;
    const holder = card.querySelector(`#storeList-${g.key}`);
    // add store rows
    for(const it of g.items){
      const isBest = (g.bestPrice != null && it.price != null && Number(it.price) === Number(g.bestPrice));
      const row = createStoreRow(it, isBest);
      holder.appendChild(row);
    }
    grid.appendChild(card);
  }
  resultsEl.appendChild(grid);
}

// --- Orchestration: run search, get both stores, merge ---
async function doSearch(query){
  if(!query) return;
  showLoading(true);
  resultsEl.innerHTML = "";
  log("Start search:", query);

  // 1) kick off Amazon and Sharaf search
  const [amazonRes, sharafLinks] = await Promise.all([
    fetchAmazonResults(query).catch(e => { log("amazon error", e); return []; }),
    fetchSharafSearchLinks(query).catch(e => { log("sharaf search error", e); return []; })
  ]);

  log("Search counts", { amazon: amazonRes.length, sharafLinks: sharafLinks.length });

  // 2) For Sharaf, fetch detailed products (pages) with pool
  const sharafProducts = sharafLinks.length ? await fetchSharafProducts(sharafLinks) : [];

  log("Sharaf priced items", sharafProducts.length);

  // 3) Normalize Amazon items (some already have fields)
  const normalizedAmazon = (amazonRes || []).map(a => ({
    id: a.asin || a.id || a.link || a.title,
    store: a.store || "Amazon.ae",
    title: a.title || null,
    price: a.price != null ? Number(a.price) : null,
    currency: a.currency || "AED",
    image: a.image || null,
    link: a.link || (a.asin ? `https://www.amazon.ae/dp/${a.asin}` : null)
  }));

  // 4) Combine, group and render
  const all = [...normalizedAmazon, ...sharafProducts];
  const groups = groupProducts(all);
  renderGroups(groups);

  showLoading(false);
  log("Search finished, merged count", groups.length, { amazon: normalizedAmazon.length, sharaf: sharafProducts.length });
}

// if page loads with default value, run a search
if(searchInput && searchInput.value) {
  // small delay to let page render
  setTimeout(()=> doSearch(searchInput.value.trim()), 250);
}
