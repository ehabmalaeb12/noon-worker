// ========== CONFIG - update if your worker domains differ ==========
const AMAZON_SEARCH = "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_SEARCH = "https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_PRODUCT = "https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=";

// SerpApi key (you provided earlier). Used only as a fallback to find Sharaf product pages.
const SERPAPI_KEY = "80742aa2857d3cbb676946278ff2693d787d68fa9d0187dfcba8a96e0be36a70";

// =====================================================================

const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");
document.getElementById("searchBtn").addEventListener("click", doSearch);
document.getElementById("searchInput").addEventListener("keydown", (e)=>{
  if(e.key === 'Enter') doSearch();
});

function timeoutFetch(url, opts = {}, ms = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, {...opts, signal: controller.signal}).finally(()=>clearTimeout(id));
}

async function doSearch(){
  const q = document.getElementById("searchInput").value.trim();
  if(!q) return;
  resultsEl.innerHTML = "";
  loadingEl.hidden = false;

  try {
    // Run Amazon + Sharaf search in parallel
    const [amazonRaw, sharafRaw] = await Promise.allSettled([
      timeoutFetch(AMAZON_SEARCH + encodeURIComponent(q), {headers:{'Accept':'application/json'}}, 14000),
      timeoutFetch(SHARAF_SEARCH + encodeURIComponent(q), {headers:{'Accept':'application/json'}}, 14000)
    ]);

    // Amazon results (may fail)
    let amazonItems = [];
    if(amazonRaw.status === 'fulfilled'){
      try { amazonItems = await amazonRaw.value.json().then(j=>j.results || []); } catch(e){ amazonItems = []; }
    }

    // Sharaf search results: may or may not include priced product objects
    let sharafSearchResults = [];
    if(sharafRaw.status === 'fulfilled'){
      try{ sharafSearchResults = await sharafRaw.value.json().then(j=>j.results || []); } catch(e){ sharafSearchResults = []; }
    }

    // If sharaf search already returned priced items -> use them
    const sharafPriced = (sharafSearchResults || []).filter(i => i && i.price);

    // If not enough priced products -> we must hydrate product pages
    let hydratedSharaf = [];
    if(sharafPriced.length >= 1){
      hydratedSharaf = sharafPriced;
    } else {
      // find product links inside sharaf search results (some endpoints give link fields)
      const possibleLinks = (sharafSearchResults || [])
        .map(r => r && (r.link || r.url))
        .filter(Boolean);

      // If we have no links from the worker, fallback to SerpApi to find product pages on ua e.sharafdg
      let productLinks = possibleLinks.slice(0, 10);

      if(productLinks.length === 0){
        // SerpApi fallback: search google_shopping (or google) restricted to site:uae.sharafdg.com
        try {
          const serpUrl = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(q + " site:uae.sharafdg.com")}&location=United+Arab+Emirates&hl=en&gl=ae&api_key=${SERPAPI_KEY}`;
          const serpResp = await timeoutFetch(serpUrl, {}, 12000);
          const serpJson = await serpResp.json();
          // serpapi shopping results vary; try multiple fields
          const shopping = serpJson.shopping_results || serpJson.shopping_results || serpJson?.shopping_results || [];
          shopping.forEach(it => {
            if(it.link) productLinks.push(it.link);
            else if(it.link && it.link.includes("sharafdg")) productLinks.push(it.link);
            else if(it.source && it.source.includes("sharafdg") && it.link) productLinks.push(it.link);
          });
          productLinks = [...new Set(productLinks)].slice(0, 10);
        } catch(err){
          console.warn("SerpApi fallback failed:", err);
        }
      }

      // Hydrate via SHARAF_PRODUCT endpoint with concurrency limit
      if(productLinks.length){
        hydratedSharaf = await promisePool(productLinks, async url => {
          try {
            const resp = await timeoutFetch(SHARAF_PRODUCT + encodeURIComponent(url), {headers:{'Accept':'application/json'}}, 12000);
            return await resp.json();
          } catch(err){
            console.warn("failed hydrate", url, err);
            return null;
          }
        }, 5);
        hydratedSharaf = hydratedSharaf.filter(Boolean);
      }
    }

    // Combine all items (amazon + sharaf hydrated)
    const all = [
      ...(Array.isArray(amazonItems) ? amazonItems.filter(p=>p && p.price) : []),
      ...(Array.isArray(hydratedSharaf) ? hydratedSharaf.filter(p=>p && p.price) : [])
    ];

    renderGrouped(all);
  } catch (err) {
    console.error(err);
    resultsEl.innerHTML = `<p class="muted">Error searching stores. See console.</p>`;
  } finally {
    loadingEl.hidden = true;
  }
}

// small pool to limit concurrent hydration calls
async function promisePool(items, mapper, concurrency = 4) {
  const ret = [];
  let i = 0;
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try { ret[idx] = await mapper(items[idx]); }
      catch(e){ ret[idx] = null; }
    }
  });
  await Promise.all(workers);
  return ret;
}

function normalize(title = "") {
  return (title || "")
    .replace(/[\u200B-\u200D\uFEFF]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\b(uae|dubai|edition|with|and|international|version)\b/g,"")
    .trim();
}

function renderGrouped(items){
  resultsEl.innerHTML = "";
  if(!items || items.length === 0){
    resultsEl.innerHTML = `<p class="muted">No priced products found across selected stores.</p>`;
    return;
  }

  // group by normalized title
  const groups = {};
  items.forEach(p=>{
    const key = normalize(p.title || p.name || "");
    const title = p.title || p.name || "Unknown";
    if(!groups[key]) groups[key] = { title, items: [] };
    groups[key].items.push(p);
  });

  Object.values(groups).forEach(group=>{
    // find best price
    const priced = group.items.filter(x => typeof x.price === 'number');
    if(priced.length === 0) return;
    const bestPrice = Math.min(...priced.map(p=>p.price));

    const card = document.createElement("div");
    card.className = "card";

    const h = document.createElement("h3");
    h.textContent = group.title;
    card.appendChild(h);

    // show thumbnail if available (first)
    const thumb = group.items.find(i=>i.image);
    if(thumb && thumb.image){
      const img = document.createElement("img");
      img.src = thumb.image;
      img.alt = group.title;
      card.appendChild(img);
    }

    // store rows
    group.items.forEach(item=>{
      const row = document.createElement("div");
      row.className = "store-row";

      const left = document.createElement("div");
      left.innerHTML = `<strong>${item.store || item.source || "Store"}</strong> · AED ${item.price === null||item.price===undefined? "—" : item.price}`;

      const right = document.createElement("div");
      if(item.price === bestPrice){
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Best Price";
        left.appendChild(document.createTextNode(" "));
        left.appendChild(badge);
      }

      const a = document.createElement("a");
      a.href = item.link || item.url || "#";
      a.target = "_blank";
      const btn = document.createElement("button");
      btn.className = "viewBtn";
      btn.textContent = "View";
      a.appendChild(btn);
      right.appendChild(a);

      row.appendChild(left);
      row.appendChild(right);
      card.appendChild(row);
    });

    resultsEl.appendChild(card);
  });
}
