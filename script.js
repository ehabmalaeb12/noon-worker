// === CONFIG ===
// Put your worker/proxy URL here (no trailing path).
// Example worker endpoints you used earlier:
// https://shopping-worker.ehabmalaeb2.workers.dev
// https://uae-price-proxy.ehabmalaeb2.workers.dev
const WORKER_BASE = "https://shopping-worker.ehabmalaeb2.workers.dev";

// === UI refs ===
const input = document.getElementById("searchInput");
const btn = document.getElementById("searchBtn");
const status = document.getElementById("status");
const results = document.getElementById("results");

btn.onclick = search;
input.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

async function search() {
  const q = (input.value || "").trim();
  results.innerHTML = "";
  status.textContent = "";

  if (!q) {
    status.textContent = "Please enter a search term.";
    return;
  }

  status.textContent = "Searching…";
  try {
    const url = `${WORKER_BASE}/search?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { mode: "cors" });

    if (!res.ok) {
      const txt = await res.text().catch(()=>"");
      status.textContent = `API error ${res.status}: ${txt || res.statusText}`;
      return;
    }

    const json = await res.json().catch(() => null);
    if (!json) {
      status.textContent = "Invalid JSON from API.";
      return;
    }

    // Accept both shapes:
    // 1) array: [ {title, price, image, link, store}, ... ]
    // 2) object: { query, count, results: [...] }
    let items = [];
    if (Array.isArray(json)) items = json;
    else if (Array.isArray(json.results)) items = json.results;
    else if (Array.isArray(json.data)) items = json.data;
    else {
      // fallback: try to find the first array inside the object
      for (const v of Object.values(json)) if (Array.isArray(v)) { items = v; break; }
    }

    if (!items || items.length === 0) {
      status.textContent = "No results found.";
      return;
    }

    status.textContent = `Found ${items.length} products.`;

    items.forEach(i => {
      const title = i.title || i.name || i.title_en || "";
      const price = i.price === undefined ? (i.final_price || i.price_value || "") : i.price;
      const image = (i.image && i.image.startsWith("http")) ? i.image : (i.image ? i.image : "");
      const link = i.link || i.url || i.product_link || "#";
      const store = i.store || i.vendor || "store";

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <img src="${image || 'https://via.placeholder.com/320x200?text=No+Image'}" alt="">
        <h3>${escapeHtml(title)}</h3>
        <div class="price">${price ? price + " AED" : ""}</div>
        <a href="${link}" target="_blank" rel="noopener noreferrer">View on ${escapeHtml(store)}</a>
      `;
      results.appendChild(card);
    });

  } catch (err) {
    console.error(err);
    // Common cause: CORS blocked the request
    status.textContent = "Error fetching API. Check console. If you see a CORS error, add CORS headers to the worker.";
  }
}

function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
