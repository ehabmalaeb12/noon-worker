document.addEventListener("DOMContentLoaded", () => {

  const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
  const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev";

  const MAX_SHARAF_PRODUCTS = 5;   // speed safety
  const SHARAF_CONCURRENCY = 2;    // safe concurrency

  const searchBtn = document.getElementById("searchBtn");
  const searchInput = document.getElementById("searchInput");
  const resultsEl = document.getElementById("searchResults");
  const loadingEl = document.getElementById("loading");

  if (!searchBtn || !searchInput || !resultsEl || !loadingEl) {
    console.error("Missing required DOM elements");
    return;
  }

  function log(msg) {
    console.log(msg);
  }

  function clearUI() {
    resultsEl.innerHTML = "";
    loadingEl.style.display = "block";
  }

  function renderCard(p) {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <img src="${p.image || ""}" loading="lazy">
      <h3>${p.title || "No title"}</h3>
      <div class="store-row">
        <strong>${p.price ? p.price + " " + p.currency : "Price N/A"}</strong>
        <span class="badge">${p.store}</span>
      </div>
      <a href="${p.link}" target="_blank">View</a>
    `;

    resultsEl.appendChild(div);
  }

  /* ---------------- AMAZON ---------------- */

  async function fetchAmazon(query) {
    try {
      const res = await fetch(`${AMAZON_WORKER}/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      log(`Amazon results count ${data.results?.length || 0}`);
      return data.results || [];
    } catch (e) {
      log("Amazon fetch failed");
      return [];
    }
  }

  /* ---------------- SHARAF SEARCH ---------------- */

  async function fetchSharafLinks(query) {
    try {
      const res = await fetch(`${SHARAF_WORKER}/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      const links = (data.results || [])
        .map(r => r.link)
        .slice(0, MAX_SHARAF_PRODUCTS);

      log(`Sharaf links count ${links.length}`);
      return links;
    } catch {
      log("Sharaf search failed");
      return [];
    }
  }

  /* ---------------- SHARAF PRODUCTS (SAFE POOL) ---------------- */

  async function fetchSharafProducts(links) {
    let index = 0;

    async function worker() {
      while (index < links.length) {
        const url = links[index++];
        try {
          const res = await fetch(
            `${SHARAF_WORKER}/product?url=${encodeURIComponent(url)}`
          );
          const data = await res.json();

          if (data && data.price) {
            renderCard(data);
          }
        } catch {
          log(`Sharaf product failed ${url}`);
        }
      }
    }

    const workers = [];
    for (let i = 0; i < SHARAF_CONCURRENCY; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }

  /* ---------------- MAIN SEARCH ---------------- */

  async function startSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    clearUI();
    log(`Start search: "${query}"`);

    // Amazon first (fast UX)
    const amazonResults = await fetchAmazon(query);
    amazonResults.forEach(renderCard);

    // Sharaf
    const sharafLinks = await fetchSharafLinks(query);
    if (sharafLinks.length) {
      log(`Fetching Sharaf product details (${sharafLinks.length})`);
      await fetchSharafProducts(sharafLinks);
    }

    loadingEl.style.display = "none";
    log("Search finished");
  }

  /* ---------------- EVENTS ---------------- */

  searchBtn.addEventListener("click", startSearch);
  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") startSearch();
  });

});
