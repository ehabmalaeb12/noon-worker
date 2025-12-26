// script.js - UAE Price Hunter frontend -> calls your Cloudflare Worker
// Replace workerUrl if you want to test another endpoint.

const workerUrl = "https://shopping-worker.ehabmalaeb2.workers.dev/search";

const $ = sel => document.querySelector(sel);

function createCard(item) {
  const div = document.createElement("div");
  div.className = "card";

  const img = document.createElement("img");
  img.src = item.image || "";
  img.alt = item.title || "product";
  div.appendChild(img);

  const title = document.createElement("div");
  title.textContent = item.title || "No title";
  title.style.marginTop = "8px";
  title.style.fontSize = "14px";
  div.appendChild(title);

  const price = document.createElement("div");
  price.className = "price";
  price.textContent = item.price ? `${item.price} ${item.currency || ""}` : "Price N/A";
  div.appendChild(price);

  const btn = document.createElement("a");
  btn.href = item.link || "#";
  btn.target = "_blank";
  btn.rel = "noopener";
  btn.textContent = `View on ${item.store || "Store"}`;
  div.appendChild(btn);

  return div;
}

function showMessage(text, isError=false) {
  const results = $("#results");
  results.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = text;
  p.style.color = isError ? "crimson" : "#333";
  p.style.fontSize = "18px";
  p.style.padding = "12px";
  results.appendChild(p);
}

async function fetchWithTimeout(url, opts = {}, timeout = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function doSearch(q) {
  const resultsNode = $("#results");
  resultsNode.innerHTML = "";
  showMessage("Searching…");

  // Build worker URL
  const url = `${workerUrl}?q=${encodeURIComponent(q)}`;

  console.log("[frontend] fetching worker:", url);

  try {
    // NOTE: use mode:'cors' - worker must allow CORS (Access-Control-Allow-Origin: *)
    const res = await fetchWithTimeout(url, { method: "GET", mode: "cors" }, 25000);

    console.log("[frontend] response status:", res.status, res.statusText);

    // not ok -> show details
    if (!res.ok) {
      let bodyText = "";
      try { bodyText = await res.text(); } catch(e){ bodyText = "(couldn't read body)"; }
      console.error("[frontend] Non-OK response:", res.status, bodyText);
      showMessage(`Error loading offers. Server returned ${res.status}. See console for details.`, true);
      return;
    }

    const json = await res.json().catch(e=>{
      console.error("[frontend] Failed to parse JSON:", e);
      throw new Error("Invalid JSON from worker");
    });

    console.log("[frontend] payload:", json);

    const items = Array.isArray(json.results) ? json.results : (json.results || []);

    if (!items || items.length === 0) {
      // show debug if present
      if (json.debug) {
        console.log("[frontend] debug object from worker:", json.debug);
        showMessage("No offers found across stores. (check console for debug info)");
      } else {
        showMessage("No offers found across stores.");
      }
      return;
    }

    // Render cards
    resultsNode.innerHTML = "";
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill,minmax(220px,1fr))";
    grid.style.gap = "16px";

    items.forEach(it => {
      grid.appendChild(createCard(it));
    });

    resultsNode.appendChild(grid);

  } catch (err) {
    console.error("[frontend] fetch error:", err);
    const errMsg = err.name === "AbortError" ? "Request timed out." : err.message || String(err);
    showMessage(`Error loading offers. ${errMsg} (see console)`, true);
  }
}

/* ---------- wire UI ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const input = $("#searchInput");
  const btn = $("#searchBtn");

  function start() {
    const q = input.value.trim();
    if (!q) { showMessage("Type a query to search (eg. iphone)."); return; }
    doSearch(q);
  }

  btn.addEventListener("click", start);
  input.addEventListener("keydown", e => { if (e.key === "Enter") start(); });

  // Quick auto-search from URL ?q=
  const params = new URLSearchParams(location.search);
  const qParam = params.get("q");
  if (qParam) {
    input.value = qParam;
    doSearch(qParam);
  }
});
