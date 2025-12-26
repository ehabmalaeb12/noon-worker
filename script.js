// script.js — aggregator frontend (copy to repo root)
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
// Replace above with your actual Amazon worker URL if different.
//
// Placeholder endpoints (set up later):
const NOON_ENDPOINT = "https://noon-worker.onrender.com/search?q=";     // replace when Noon worker ready
const SHARAF_ENDPOINT = "https://sharaf-worker.example.com/search?q="; // replace when Sharaf worker ready

const input = document.getElementById("searchInput");
const btn = document.getElementById("searchBtn");
const loading = document.getElementById("loading");
const resultsEl = document.getElementById("searchResults");

btn.addEventListener("click", run);
input.addEventListener("keydown", e => { if (e.key === "Enter") run(); });

async function run() {
  const q = input.value.trim();
  resultsEl.innerHTML = "";
  if (!q) return alert("Type a product name");

  loading.style.display = "block";
  const timeStart = Date.now();

  // Query the stores in parallel.
  const calls = [
    fetchSafe(AMAZON_WORKER + encodeURIComponent(q)).then(r => ({ store: "amazon", data: r })).catch(e => ({ store: "amazon", error:e.message })),
    // these will likely be empty until we deploy the workers/services:
    fetchSafe(NOON_ENDPOINT + encodeURIComponent(q)).then(r => ({ store: "noon", data: r })).catch(e => ({ store: "noon", error:e.message })),
    fetchSafe(SHARAF_ENDPOINT + encodeURIComponent(q)).then(r => ({ store: "sharaf", data: r })).catch(e => ({ store: "sharaf", error:e.message })),
  ];

  const responses = await Promise.all(calls);
  loading.style.display = "none";

  // Aggregate: build a flat list of product offers
  const offers = [];

  for (const res of responses) {
    if (res.error) {
      console.warn("Store error", res.store, res.error);
      continue;
    }
    const payload = res.data;
    if (!payload) continue;
    const list = Array.isArray(payload.results) ? payload.results : payload.results || payload;
    // Standardize shape
    list.forEach(item => {
      // Many sources use different field names. Normalize:
      const normalized = {
        id: item.id || item.asin || item.sku || item.url || (item.link||"").split("/dp/")[1] || Math.random().toString(36).slice(2,9),
        title: item.title || item.name || item.title || null,
        price: item.price ? Number(item.price) : (item.price_raw ? Number(item.price_raw) : null),
        currency: item.currency || "AED",
        image: item.image || item.image_link || item.image_url || null,
        link: item.link || item.url || item.product_url || null,
        store: (item.store || res.store || "unknown").toString(),
      };
      if (normalized.price) offers.push(normalized);
    });
  }

  if (offers.length === 0) {
    resultsEl.innerHTML = "<p>No offers found across stores.</p>";
    return;
  }

  // Group by normalized title (simple approach: lowercased title trimmed)
  const groups = {};
  offers.forEach(o => {
    const key = (o.title || "").toLowerCase().replace(/\s+/g,' ').slice(0,120) || o.id;
    groups[key] = groups[key] || [];
    groups[key].push(o);
  });

  // Render groups, showing best price badge
  resultsEl.innerHTML = "";
  Object.keys(groups).forEach(k => {
    const list = groups[k];
    // find best price
    const best = list.reduce((a,b) => (b.price < a.price ? b : a), list[0]);

    const groupDiv = document.createElement("div");
    groupDiv.className = "group";

    const title = document.createElement("h3");
    title.textContent = best.title || "Product";
    groupDiv.appendChild(title);

    list.forEach(o => {
      const card = document.createElement("div");
      card.className = "product-card";

      const img = document.createElement("img");
      img.src = o.image || "https://images.unsplash.com/photo-1556656793-08538906a9f8?w=400";
      img.onerror = () => img.src = "https://images.unsplash.com/photo-1556656793-08538906a9f8?w=400";
      card.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = `<div class="store">${o.store}</div>
                        <div>${o.title ? o.title.slice(0,120) : ""}</div>
                        <div class="price">${o.price ? o.price+" AED" : "—"}</div>
                        <div style="margin-top:8px;"> <a href="${o.link}" target="_blank">Buy on ${o.store}</a> </div>`;

      if (o.id === best.id && o.price === best.price) {
        const bestBadge = document.createElement("div");
        bestBadge.className = "best";
        bestBadge.textContent = "Best";
        meta.appendChild(bestBadge);
      }

      card.appendChild(meta);
      groupDiv.appendChild(card);
    });

    resultsEl.appendChild(groupDiv);
  });

  const took = Math.round((Date.now()-timeStart)/10)/100;
  const footer = document.createElement("div");
  footer.style.fontSize="13px";
  footer.style.color="#666";
  footer.style.marginTop="6px";
  footer.textContent = `Aggregated ${offers.length} offers across ${responses.length} stores • ${took}s`;
  resultsEl.appendChild(footer);
}

async function fetchSafe(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text().catch(()=>null);
    throw new Error(`HTTP ${res.status} ${res.statusText} ${txt? (" - "+txt.slice(0,200)) : ""}`);
  }
  return res.json();
}
