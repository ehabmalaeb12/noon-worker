// ---------------- CONFIG - update if your worker domains differ ----------------
const AMAZON_SEARCH = "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_SEARCH  = "https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_PRODUCT = "https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=";
// SerpApi key (fallback). You gave: 80742aa2857...
const SERPAPI_KEY = "80742aa2857d3cbb676946278ff2693d787d68fa9d0187dfcba8a96e0be36a70";
// ------------------------------------------------------------------------------

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");

// debug panel
const dbg = document.createElement("pre");
dbg.style.background = "#fff";
dbg.style.padding = "8px";
dbg.style.borderRadius = "8px";
dbg.style.marginTop = "12px";
dbg.style.fontSize = "12px";
dbg.style.maxHeight = "160px";
dbg.style.overflow = "auto";
resultsEl.parentNode.insertBefore(dbg, resultsEl.nextSibling);

searchBtn.addEventListener("click", runSearch);
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });

function logDebug(...a){ 
  console.log(...a);
  try { dbg.textContent += a.map(x => (typeof x === 'string' ? x : JSON.stringify(x,null,2))).join(" ") + "\n\n"; }
  catch(e){}
}

async function timeoutFetch(url, opts={}, ms=15000) {
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), ms);
  try {
    const res = await fetch(url, {...opts, signal: controller.signal});
    return res;
  } finally { clearTimeout(id); }
}

function normalizeTitle(s=""){
  return (s||"").toString().toLowerCase().replace(/\s+/g," ").replace(/[^a-z0-9 ]/g,"").trim();
}

async function runSearch(){
  const q = (searchInput.value || "").trim();
  resultsEl.innerHTML = "";
  dbg.textContent = "";
  if(!q){ resultsEl.innerHTML = "<p class='muted'>Enter a product name</p>"; return; }
  loadingEl.hidden = false;
  logDebug(`Start search: "${q}"`);

  // 1) Start Amazon search + Sharaf search in parallel
  let amazonItems = [], sharafSearchItems = [];
  try {
    const [aRes, sRes] = await Promise.allSettled([
      timeoutFetch(AMAZON_SEARCH + encodeURIComponent(q), {headers:{'Accept':'application/json'}}, 15000),
      timeoutFetch(SHARAF_SEARCH  + encodeURIComponent(q), {headers:{'Accept':'application/json'}}, 15000)
    ]);

    if(aRes.status === 'fulfilled'){
      try {
        const j = await aRes.value.json();
        amazonItems = Array.isArray(j.results) ? j.results.filter(r => r && r.price) : [];
        logDebug("Amazon returned:", amazonItems.length);
      } catch(e){ logDebug("Amazon parse error", e.message); }
    } else logDebug("Amazon fetch error", aRes.reason && aRes.reason.message);

    if(sRes.status === 'fulfilled'){
      try {
        const j = await sRes.value.json();
        sharafSearchItems = Array.isArray(j.results) ? j.results : [];
        logDebug("Sharaf worker search returned count:", sharafSearchItems.length);
      } catch(e){ logDebug("Sharaf search parse error", e.message); }
    } else logDebug("Sharaf search fetch error", sRes.reason && sRes.reason.message);

  } catch(e){
    logDebug("Parallel fetch error", e.message);
  }

  // 2) If Sharaf search already contains priced items, use them
  let sharafPriced = sharafSearchItems.filter(i => i && typeof i.price === 'number');
  logDebug("Sharaf priced from worker:", sharafPriced.length);

  // 3) If no priced Sharaf items, attempt to get product links and hydrate via /product
  let hydratedSharaf = [];
  if(sharafPriced.length > 0){
    hydratedSharaf = sharafPriced;
  } else {
    // collect links from sharafSearchItems (if any)
    let links = (sharafSearchItems || []).map(i => i.link || i.url).filter(Boolean);
    links = [...new Set(links)];

    // fallback: use SerpApi to find sharaf product pages (if no links)
    if(links.length === 0){
      try {
        logDebug("No links from sharaf search worker — trying SerpApi fallback");
        const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q + " site:uae.sharafdg.com")}&location=United+Arab+Emirates&hl=en&gl=ae&api_key=${SERPAPI_KEY}`;
        const serpResp = await timeoutFetch(serpUrl, {}, 12000);
        const serpJson = await serpResp.json();
        const candidates = (serpJson.organic_results || []).concat(serpJson.shopping_results || []);
        for(const c of candidates){
          if(c.link && c.link.includes("sharafdg")) links.push(c.link);
          else if(c.source && c.source.includes("sharafdg") && c.link) links.push(c.link);
        }
        links = [...new Set(links)].slice(0, 10);
        logDebug("SerpApi found links:", links.length);
      } catch(err){
        logDebug("SerpApi fallback failed:", err && err.message);
      }
    } else {
      logDebug("Using links provided by sharaf-worker:", links.length);
    }

    // hydrate up to 8 links via your /product endpoint with concurrency limit
    if(links.length){
      const max = 8;
      const toHydrate = links.slice(0, max);
      logDebug("Hydrating Sharaf product pages count:", toHydrate.length);
      hydratedSharaf = await promisePool(toHydrate, async (u) => {
        try {
          const r = await timeoutFetch(SHARAF_PRODUCT + encodeURIComponent(u), {headers:{'Accept':'application/json'}}, 12000);
          return await r.json();
        } catch(err) {
          logDebug("Hydrate failed:", u, err && err.message);
          return null;
        }
      }, 4);
      hydratedSharaf = (hydratedSharaf || []).filter(Boolean).filter(i => i.price !== null && i.price !== undefined);
      logDebug("Hydrated sharaf items with price:", hydratedSharaf.length);
    } else {
      logDebug("No product links to hydrate for Sharaf");
    }
  }

  // 4) Combine and dedupe by normalized title (best-effort)
  const all = [];
  (amazonItems || []).forEach(it => { if(it && it.price) all.push({...it, store:"Amazon.ae"}); });
  (hydratedSharaf || []).forEach(it => { if(it && it.price) all.push({...it, store:"SharafDG"}); });

  if(all.length === 0){
    resultsEl.innerHTML = `<p class="muted">No priced products found across Amazon & Sharaf for "${q}".<br/>See debug below for details.</p>`;
    loadingEl.hidden = true;
    return;
  }

  renderGrouped(all);
  loadingEl.hidden = true;
}


// small concurrency pool
async function promisePool(items, mapper, concurrency = 3){
  const results = new Array(items.length);
  let idx = 0;
  const workers = new Array(concurrency).fill(0).map(async ()=>{
    while(true){
      const i = idx++;
      if(i >= items.length) break;
      try { results[i] = await mapper(items[i]); }
      catch(e){ results[i] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

function renderGrouped(items){
  resultsEl.innerHTML = "";
  // group by normalized title
  const groups = {};
  items.forEach(p => {
    const title = p.title || p.name || p.title || p.asin || (p.link || p.url) || "Unknown";
    const key = normalizeTitle(title);
    if(!groups[key]) groups[key] = { title: title, items: [] };
    groups[key].items.push(p);
  });

  Object.values(groups).forEach(g => {
    // find numeric priced items
    const priced = g.items.filter(x => typeof x.price === "number");
    if(!priced.length) return;
    const best = Math.min(...priced.map(p=>p.price));

    const card = document.createElement("div");
    card.className = "card";

    const h = document.createElement("h3"); h.textContent = g.title; card.appendChild(h);

    const thumb = g.items.find(i => i.image && i.image.startsWith("http"));
    if(thumb){
      const img = document.createElement("img"); img.src = thumb.image; img.alt = g.title; card.appendChild(img);
    }

    g.items.forEach(it => {
      const row = document.createElement("div"); row.className = "store-row";
      const left = document.createElement("div");
      left.innerHTML = `<strong>${it.store || "Store"}</strong> · AED ${ (typeof it.price === "number") ? it.price : "—" }`;
      if(typeof it.price === "number" && it.price === best){
        const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "Best Price";
        left.appendChild(document.createTextNode(" "));
        left.appendChild(badge);
      }
      const right = document.createElement("div");
      const a = document.createElement("a"); a.href = it.link || it.url || "#"; a.target = "_blank";
      const btn = document.createElement("button"); btn.className = "viewBtn"; btn.textContent = "Buy";
      a.appendChild(btn); right.appendChild(a);
      row.appendChild(left); row.appendChild(right);
      card.appendChild(row);
    });

    resultsEl.appendChild(card);
  });
}
