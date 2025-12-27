// script.js
// Frontend logic to query Amazon worker + Sharaf worker, group products and show best price.

const AMAZON_SEARCH = "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_SEARCH = "https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=";

// Basic helpers
const $ = id => document.getElementById(id);
const timeout = (ms, promise) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(res => { clearTimeout(t); resolve(res); }).catch(err => { clearTimeout(t); reject(err); });
  });

function normalizeTitle(title){
  if(!title) return "";
  // lowercase, remove punctuation, normalize spaces, remove some stopwords
  const stop = new Set(["the","and","with","for","in","uae","gb","gb","5g"]);
  let s = title.toLowerCase();
  s = s.replace(/[\u2018\u2019\u201c\u201d‚“”'":,\/()\-&]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter(w => w && !stop.has(w));
  // take up to first 6 words
  return words.slice(0,6).join(" ");
}

// group by normalized title first, fallback coarse hashing
function groupProducts(allProducts){
  const map = new Map();

  function add(product){
    const key = normalizeTitle(product.title) || (product.asin || product.link || product.title || Math.random());
    // choose key: try exact match, else fuzzy by substring match
    if(map.has(key)){
      map.get(key).offers.push(product);
      return;
    }
    // try to find an existing key that includes significant overlap
    for(const [k,v] of map.entries()){
      if(!k) continue;
      // share at least 2 words
      const kWords = new Set(k.split(" "));
      const pWords = new Set((normalizeTitle(product.title)||"").split(" "));
      let shared = 0;
      for(const w of pWords) if(kWords.has(w)) shared++;
      if(shared >= 2){
        v.offers.push(product);
        return;
      }
    }
    // otherwise create new group
    map.set(key, {
      title: product.title,
      image: product.image,
      offers: [product]
    });
  }

  for(const p of allProducts) add(p);
  return Array.from(map.values());
}

function findBestPrice(offers){
  let best = null;
  for(const o of offers){
    if(o.price === null || o.price === undefined) continue;
    const numeric = Number(o.price);
    if(Number.isNaN(numeric)) continue;
    if(!best || numeric < best.price){
      best = { price: numeric, store: o.store, offer: o };
    }
  }
  return best;
}

function makeStoreLabel(store) {
  if(!store) return "Store";
  return store.replace(/\.(ae|com)$/i,"");
}

/* ---------- Render UI ---------- */
function renderGroups(groups){
  const root = $("results");
  root.innerHTML = "";
  if(!groups.length){
    $("message").textContent = "No priced products found across selected stores.";
    return;
  }
  $("message").textContent = `${groups.length} product(s) found. Showing grouped comparisons across stores.`;

  for(const g of groups){
    const best = findBestPrice(g.offers);
    const card = document.createElement("div");
    card.className = "card";

    const top = document.createElement("div"); top.className = "cardTop";
    const img = document.createElement("img");
    img.alt = g.title || "product";
    img.src = g.image || (g.offers.find(o=>o.image)?.image) || "https://via.placeholder.com/400x300?text=No+image";
    top.appendChild(img);

    const hwrap = document.createElement("div");
    const h = document.createElement("h3");
    h.textContent = g.title || g.offers?.[0]?.title || "Product";
    const badge = document.createElement("span");
    if(best){
      badge.className = "bestBadge";
      badge.textContent = "Best Price";
    }
    const topLine = document.createElement("div");
    topLine.style.display = "flex"; topLine.style.alignItems="center";
    topLine.appendChild(h);
    if(best) topLine.appendChild(badge);

    hwrap.appendChild(topLine);

    // show best price summary
    const summary = document.createElement("div");
    summary.style.marginTop = "6px";
    if(best){
      const p = document.createElement("div");
      p.innerHTML = `<div class="small">Lowest: <span class="price">${best.price} AED</span> • ${makeStoreLabel(best.store)}</div>`;
      hwrap.appendChild(p);
    } else {
      const p = document.createElement("div");
      p.className = "small";
      p.textContent = "No price available yet from stores.";
      hwrap.appendChild(p);
    }

    top.appendChild(hwrap);
    card.appendChild(top);

    const main = document.createElement("div"); main.className = "cardMain";
    const offersWrap = document.createElement("div"); offersWrap.className = "offers";

    // sort offers: priced first (ascending), then unpriced
    const sorted = g.offers.slice().sort((a,b)=>{
      const pa = (a.price===null||a.price===undefined)?Infinity:Number(a.price);
      const pb = (b.price===null||b.price===undefined)?Infinity:Number(b.price);
      return pa - pb;
    });

    for(const ofr of sorted){
      const row = document.createElement("div"); row.className = "offerRow";
      const left = document.createElement("div"); left.className = "offerLeft";
      const storeBadge = document.createElement("div"); storeBadge.className = "storeBadge";
      storeBadge.textContent = makeStoreLabel(ofr.store || "Store");
      left.appendChild(storeBadge);
      const titleSmall = document.createElement("div"); titleSmall.className = "small";
      titleSmall.style.marginLeft = "8px";
      titleSmall.textContent = ofr.title && ofr.title.length>60 ? ofr.title.slice(0,60)+"…" : (ofr.title||"");
      left.appendChild(titleSmall);

      const right = document.createElement("div"); right.className = "offerActions";
      const priceEl = document.createElement("div");
      if(ofr.price===null || ofr.price===undefined || ofr.price===""){
        priceEl.className = "price na";
        priceEl.textContent = "N/A";
      } else {
        priceEl.className = "price";
        priceEl.textContent = Number(ofr.price);
      }
      right.appendChild(priceEl);

      const view = document.createElement("a");
      view.className = "btnLink";
      view.textContent = "View";
      view.href = ofr.link || "#";
      view.target = "_blank";
      right.appendChild(view);

      row.appendChild(left);
      row.appendChild(right);
      offersWrap.appendChild(row);
    }

    main.appendChild(offersWrap);
    card.appendChild(main);
    root.appendChild(card);
  }
}

/* ---------- Fetching ---------- */
async function fetchWorker(url){
  try{
    const res = await timeout(15000, fetch(url));
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }catch(err){
    // return object explaining failure
    return { _error: err.message || String(err) };
  }
}

async function searchAll(query){
  const useA = $("useAmazon").checked;
  const useS = $("useSharaf").checked;

  const tried = [];
  const all = [];

  // Amazon worker
  if(useA){
    tried.push({ store: "Amazon", url: AMAZON_SEARCH + encodeURIComponent(query) });
    const a = await fetchWorker(AMAZON_SEARCH + encodeURIComponent(query));
    if(a && !a._error && Array.isArray(a.results)){
      for(const r of a.results) all.push({ store: "Amazon.ae", title: r.title||r.title, price: r.price==null?null:r.price, currency: r.currency||"AED", image: r.image||null, link: r.link||r.url||`https://www.amazon.ae/dp/${r.asin||r.id||""}` });
    } else {
      tried.push({ store: "Amazon", error: a._error||"no results" });
    }
  }

  // Sharaf worker
  if(useS){
    tried.push({ store: "SharafDG", url: SHARAF_SEARCH + encodeURIComponent(query) });
    const s = await fetchWorker(SHARAF_SEARCH + encodeURIComponent(query));
    if(s && !s._error && Array.isArray(s.results)){
      for(const r of s.results) all.push({ store: "SharafDG", title: r.title, price: r.price==null?null:r.price, currency: r.currency||"AED", image: r.image||null, link: r.link||r.url });
    } else {
      // If the worker response is a single product (product endpoint), accept it
      if(s && !s._error && s.title && (s.price || s.price === 0)){
        all.push({ store: "SharafDG", title: s.title, price: s.price, currency: s.currency||"AED", image: s.image||null, link: s.link||null });
      } else {
        tried.push({ store: "SharafDG", error: s._error||"no results" });
      }
    }
  }

  return { all, tried };
}

/* ---------- UI wiring ---------- */
async function doSearch(){
  const q = ($("searchInput").value || "").trim();
  if(!q) return;
  $("loading").hidden = false;
  $("message").textContent = "";
  $("results").innerHTML = "";
  try{
    const { all, tried } = await searchAll(q);
    // group
    const groups = groupProducts(all);
    // filter out groups where no offer has a price? We'll show groups even if only one store priced.
    const filtered = groups.filter(g => {
      // keep if at least one priced offer OR user wants to show unpriced? Keep only if at least one priced OR (both stores unchecked?).
      return g.offers.some(o => o.price !== null && o.price !== undefined && !isNaN(Number(o.price)));
    });
    // If there are no priced results but raw groups exist, show raw groups (so user can see unpriced links)
    if(filtered.length === 0 && groups.length > 0){
      // optionally choose to show groups even without prices — for now show message + empty
      $("message").textContent = "No priced products found across selected stores.";
      // still show groups but labelled N/A
      renderGroups(groups);
    } else {
      renderGroups(filtered);
    }

    // If nothing at all
    if(all.length === 0){
      $("message").textContent = "No offers found across stores.";
    }

  }catch(err){
    $("message").textContent = "Error searching stores: " + (err.message||err);
  }finally{
    $("loading").hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", ()=>{
  $("searchBtn").addEventListener("click", doSearch);
  $("searchInput").addEventListener("keydown", e => { if(e.key === "Enter") doSearch(); });
  // initial search
  doSearch();
});
