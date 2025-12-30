// script.js — SAFE VERSION (race-proof, no AbortController)

// CONFIG (unchanged)
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";
const NOON_WORKER   = "https://noon-worker.ehabmalaeb2.workers.dev";

// tuning
const MAX_SHARAF_PRODUCTS = 5;
const SHARAF_CONCURRENCY = 2;
const FETCH_RETRIES = 3;
const FETCH_BASE_DELAY = 500;

// UI
const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");
const debugPanel = document.getElementById("debugPanel");
const toggleDebugBtn = document.getElementById("toggleDebug");

let renderedItems = [];
let activeSearchId = 0; // 🔑 KEY FIX

/* ---------- helpers ---------- */
function log(msg) {
  console.log(msg);
  debugPanel.textContent += msg + "\n";
}
function clearUI() {
  resultsEl.innerHTML = "";
  renderedItems = [];
  debugPanel.textContent = "";
  loadingEl.style.display = "block";
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, attempts = FETCH_RETRIES) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    } catch (e) {
      last = e;
      await delay(FETCH_BASE_DELAY * (i + 1));
    }
  }
  throw last;
}

/* ---------- rendering ---------- */
function renderProduct(p, searchId) {
  if (searchId !== activeSearchId) return; // 🔒 ignore old searches

  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <img src="${p.image || ""}">
    <h3>${p.title || "No title"}</h3>
    <div class="store-row">
      <strong>${p.price ? p.price + " " + (p.currency || "AED") : "N/A"}</strong>
      <span class="badge">${p.store}</span>
    </div>
    <a href="${p.link}" target="_blank">View</a>
  `;
  resultsEl.appendChild(div);

  if (p.price) renderedItems.push({ el: div, price: +p.price });
}

/* ---------- stores ---------- */
async function fetchAmazon(q, sid) {
  log(`Amazon search "${q}"`);
  const data = await fetchWithRetry(`${AMAZON_WORKER}/search?q=${encodeURIComponent(q)}`);
  data.results.forEach(r => renderProduct({
    store: "Amazon",
    title: r.title || r.asin,
    price: r.price,
    currency: r.currency,
    image: r.image,
    link: r.link
  }, sid));
}

async function fetchNoon(q, sid) {
  log(`Noon search "${q}"`);
  const data = await fetchWithRetry(`${NOON_WORKER}/search?q=${encodeURIComponent(q)}`);
  data.results.forEach(r => renderProduct({
    store: "Noon",
    title: r.title,
    price: r.price,
    currency: r.currency,
    image: r.image,
    link: r.link
  }, sid));
}

async function fetchSharaf(q, sid) {
  log(`Sharaf search "${q}"`);
  const data = await fetchWithRetry(`${SHARAF_WORKER}/search?q=${encodeURIComponent(q)}`);
  const links = data.results.slice(0, MAX_SHARAF_PRODUCTS).map(x => x.link);

  for (const link of links) {
    try {
      const p = await fetchWithRetry(`${SHARAF_WORKER}/product?url=${encodeURIComponent(link)}`);
      renderProduct({ ...p, store: "SharafDG" }, sid);
    } catch (e) {
      log("Sharaf product failed");
    }
  }
}

/* ---------- main ---------- */
async function startSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  activeSearchId++;          // 🔑 invalidate old searches
  const sid = activeSearchId;

  clearUI();
  log(`==== SEARCH "${query}" ====`);

  // Amazon + Noon together
  await Promise.all([
    fetchAmazon(query, sid),
    fetchNoon(query, sid)
  ]);

  // Sharaf after
  await fetchSharaf(query, sid);

  if (sid === activeSearchId) {
    loadingEl.style.display = "none";
    log("Search finished");
  }
}

/* ---------- events ---------- */
searchBtn.onclick = startSearch;
searchInput.onkeydown = e => e.key === "Enter" && startSearch();
toggleDebugBtn.onclick = () =>
  debugPanel.style.display = debugPanel.style.display === "block" ? "none" : "block";
