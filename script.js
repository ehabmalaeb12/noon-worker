/*********************************************************
 * CONFIG
 *********************************************************/
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";

const MAX_SHARAF_PRODUCTS = 8;     // keep small for speed
const SHARAF_CONCURRENCY = 3;      // critical for AbortError fix
const SHARAF_TIMEOUT = 15000;      // 15s per product
const SHARAF_RETRIES = 2;

/*********************************************************
 * DOM
 *********************************************************/
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultsEl = document.getElementById("results");
const debugEl = document.getElementById("debug");

/*********************************************************
 * UTILS
 *********************************************************/
function logDebug(msg) {
  console.log(msg);
  debugEl.textContent += msg + "\n";
}

function clearUI() {
  resultsEl.innerHTML = "";
  debugEl.textContent = "";
}

function createCardSkeleton(store) {
  const div = document.createElement("div");
  div.className = "card skeleton";
  div.innerHTML = `
    <div class="img"></div>
    <div class="text">
      <div class="line"></div>
      <div class="line small"></div>
      <div class="badge">${store}</div>
    </div>
  `;
  return div;
}

function renderProduct(p) {
  const card = document.createElement("div");
  card.className = "card";

  card.innerHTML = `
    <img src="${p.image || ""}" loading="lazy">
    <h3>${p.title || "No title"}</h3>
    <p class="price">${p.price ? p.price + " " + p.currency : "Price N/A"}</p>
    <span class="badge ${p.store.toLowerCase()}">${p.store}</span>
    <a href="${p.link}" target="_blank">View</a>
  `;
  resultsEl.appendChild(card);
}

/*********************************************************
 * FETCH WITH TIMEOUT + RETRY (CRITICAL FIX)
 *********************************************************/
async function fetchWithRetry(url, timeoutMs, retries) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);

      if (!res.ok) {
        if (attempt === retries) return null;
        continue;
      }
      return res.json();
    } catch (err) {
      clearTimeout(t);
      if (attempt === retries) return null;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

/*********************************************************
 * SHARAF PRODUCT CONCURRENCY POOL
 *********************************************************/
async function fetchSharafProducts(links) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < links.length) {
      const i = index++;
      const url = links[i];

      logDebug(`Sharaf product fetch → ${url}`);

      const data = await fetchWithRetry(
        `${SHARAF_WORKER}/product?url=${encodeURIComponent(url)}`,
        SHARAF_TIMEOUT,
        SHARAF_RETRIES
      );

      if (data && data.price) {
        results.push(data);
        renderProduct(data);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < SHARAF_CONCURRENCY; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/*********************************************************
 * MAIN SEARCH
 *********************************************************/
async function startSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  clearUI();
  logDebug(`Start search: "${query}"`);

  /* --- Amazon Search --- */
  logDebug("Query Amazon worker…");
  let amazonResults = [];
  try {
    const amazonData = await fetch(`${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`).then(r => r.json());
    amazonResults = amazonData.results || [];
    logDebug(`Amazon results count ${amazonResults.length}`);
  } catch {
    logDebug("Amazon failed");
  }

  /* --- Render Amazon instantly --- */
  amazonResults.forEach(p => renderProduct(p));

  /* --- Sharaf Search (LINKS ONLY) --- */
  logDebug("Query Sharaf search…");
  let sharafLinks = [];
  try {
    const sharafSearch = await fetch(`${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`).then(r => r.json());
    sharafLinks = (sharafSearch.results || [])
      .map(r => r.link)
      .slice(0, MAX_SHARAF_PRODUCTS);

    logDebug(`Sharaf links count ${sharafLinks.length}`);
  } catch {
    logDebug("Sharaf search failed");
  }

  /* --- Skeletons for UX --- */
  sharafLinks.forEach(() => resultsEl.appendChild(createCardSkeleton("SharafDG")));

  /* --- Fetch Sharaf products (SAFE) --- */
  logDebug(`Fetching Sharaf product details (${sharafLinks.length})`);
  await fetchSharafProducts(sharafLinks);

  logDebug("Search finished");
}

/*********************************************************
 * EVENTS
 *********************************************************/
searchBtn.addEventListener("click", startSearch);
searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") startSearch();
});
