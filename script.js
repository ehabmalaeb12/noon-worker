// script.js - merge Amazon + SharafDG, mark best price
const amazonWorker = "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
const sharafSearch = "https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=";
const sharafProduct = "https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=";

const resultsEl = document.getElementById("results");
const debugEl = document.getElementById("debug");
const qInput = document.getElementById("q");
document.getElementById("searchBtn").addEventListener("click", runSearch);

function log(...args){ debugEl.textContent += args.join(" ") + "\n"; }

async function runSearch(){
  const q = (qInput.value||"").trim();
  if(!q) return;
  resultsEl.innerHTML = "";
  debugEl.textContent = "";
  log(`Start search: "${q}"`);
  try {
    // parallel: ask Amazon and Sharaf search
    log(`Query Amazon worker -> ${amazonWorker}${encodeURIComponent(q)}`);
    log(`Query Sharaf search -> ${sharafSearch}${encodeURIComponent(q)}`);
    const [aRes, sRes] = await Promise.allSettled([
      fetch(amazonWorker + encodeURIComponent(q), {cache:"no-store"}),
      fetch(sharafSearch + encodeURIComponent(q), {cache:"no-store"})
    ]);

    let amazonJson = { results: [], count: 0 };
    let sharafJson = { results: [], count: 0 };

    if(aRes.status === "fulfilled" && aRes.value.ok){
      try{ amazonJson = await aRes.value.json(); log("Amazon results count", amazonJson.count); } catch(e){ log("Amazon parse error", e); }
    } else { log("Amazon failed", aRes.status === "rejected" ? String(aRes.reason) : aRes.value && aRes.value.status); }

    if(sRes.status === "fulfilled" && sRes.value.ok){
      try{ sharafJson = await sRes.value.json(); log("Sharaf links count", sharafJson.count); } catch(e){ log("Sharaf parse error", e); }
    } else { log("Sharaf failed", sRes.status === "rejected" ? String(sRes.reason) : sRes.value && sRes.value.status); }

    // Build Amazon items (they come priced)
    const amazonItems = (amazonJson.results||[]).map(it => ({
      id: it.asin || it.id || it.link || Math.random().toString(36).slice(2,8),
      title: (it.title||"").trim(),
      price: it.price || null,
      store: it.store || "Amazon.ae",
      image: it.image || null,
      link: it.link || null
    }));

    // For Sharaf: we have links -> fetch product details (but limit concurrency)
    const sharafLinks = (sharafJson.results||[]).map(r=>r.link).filter(Boolean);
    const sharafItems = [];
    const concurrency = 6;
    for (let i=0;i<sharafLinks.length;i+=concurrency){
      const batch = sharafLinks.slice(i,i+concurrency).map(link => fetchProductFromSharaf(link));
      const settled = await Promise.allSettled(batch);
      for(const s of settled){
        if(s.status === "fulfilled" && s.value) sharafItems.push(s.value);
        else if(s.status === "rejected") log("Sharaf product error", s.reason);
      }
    }

    log(`Sharaf priced items: ${sharafItems.length}`);

    // Merge lists and group by title similarity
    const all = [...amazonItems, ...sharafItems];
    const groups = groupByTitle(all);

    // From each group, pick items with price, choose best price and produce cards
    const cards = [];
    for(const g of groups){
      const priced = g.items.filter(x=>x.price!=null);
      if(priced.length===0) continue;
      const best = priced.reduce((a,b)=> a.price<=b.price?a:b);
      for(const it of g.items) cards.push({...it, best: it.link===best.link});
    }

    if(cards.length===0){
      resultsEl.innerHTML = `<div class="muted">No products with prices found.</div>`;
    } else {
      resultsEl.innerHTML = cards.map(c=>`
        <div class="card">
          <div>
            ${c.image?`<img src="${c.image}" alt="">`:`<div style="height:160px;background:#f3f6fb;border-radius:8px"></div>`}
            <div style="margin-top:8px;font-weight:700">${escapeHtml(c.title||"No title")}</div>
            <div class="store">${escapeHtml(c.store)}</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
            <div>
              <div class="price">${c.price!=null?c.price+" AED":"—"}</div>
              ${c.best?`<span class="badge">Best price</span>`:""}
            </div>
            <div>
              <a class="btn" href="${c.link}" target="_blank" rel="noopener">View on ${escapeHtml(c.store.split('.')[0]||c.store)}</a>
            </div>
          </div>
        </div>`).join("");
    }

    log(`Search finished, merged count ${cards.length}`);
  } catch(err){
    log("Fatal error: " + String(err));
  }
}

// fetch product /product?url=... with timeout
async function fetchProductFromSharaf(link){
  const url = sharafProduct + encodeURIComponent(link);
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 20000); // 20s
  try {
    const res = await fetch(url, {signal: controller.signal, cache:"no-store"});
    clearTimeout(timeout);
    if(!res.ok) { throw new Error("HTTP " + res.status); }
    const j = await res.json();
    return {
      id: j.link || j.title || link,
      title: (j.title||"").trim(),
      price: j.price != null ? j.price : null,
      store: "SharafDG",
      image: j.image || null,
      link: j.link || link
    };
  } finally { clearTimeout(timeout); }
}

function groupByTitle(items){
  const out = [];
  const normalize = s => (s||"").toLowerCase().replace(/[^a-z0-9 ]+/g,"").replace(/\s+/g," ").trim();
  for(const it of items){
    const n = normalize(it.title);
    if(!n) continue;
    let found = null;
    for(const g of out){
      if(g.norm.includes(n) || n.includes(g.norm)) { found = g; break; }
      if(g.norm.slice(0,8) === n.slice(0,8) && n.length>6) { found = g; break; }
    }
    if(found) found.items.push(it); else out.push({norm:n, items:[it]});
  }
  return out;
}

function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
