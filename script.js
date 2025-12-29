const AMAZON_SEARCH =
  "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_SEARCH =
  "https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_PRODUCT =
  "https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=";

const resultsEl = document.getElementById("results");
const debugEl = document.getElementById("debug");

let debugEnabled = false;

document.getElementById("toggleDebug").onclick = () => {
  debugEnabled = !debugEnabled;
  debugEl.classList.toggle("hidden", !debugEnabled);
};

document.getElementById("searchBtn").onclick = search;

async function search() {
  const q = document.getElementById("query").value.trim();
  if (!q) return;

  resultsEl.innerHTML = "";
  log(`Start search: "${q}"`);

  const amazonPromise = fetchJson(AMAZON_SEARCH + encodeURIComponent(q));
  const sharafSearchPromise = fetchJson(
    SHARAF_SEARCH + encodeURIComponent(q)
  );

  const [amazon, sharafSearch] = await Promise.allSettled([
    amazonPromise,
    sharafSearchPromise
  ]);

  const amazonItems =
    amazon.status === "fulfilled" ? amazon.value.results || [] : [];
  const sharafLinks =
    sharafSearch.status === "fulfilled"
      ? sharafSearch.value.results || []
      : [];

  log(`Amazon results count ${amazonItems.length}`);
  log(`Sharaf links count ${sharafLinks.length}`);

  const sharafProducts = await fetchSharafProducts(sharafLinks);

  const merged = [...amazonItems, ...sharafProducts];
  log(`Search finished, merged count ${merged.length}`);

  render(merged);
}

async function fetchSharafProducts(links) {
  log(`Fetching Sharaf product details (${links.length})`);

  const results = [];
  for (const item of links) {
    try {
      const url = SHARAF_PRODUCT + encodeURIComponent(item.link);
      const data = await fetchJson(url);
      if (data && data.title) results.push(data);
    } catch (e) {
      log("Sharaf product error " + e);
    }
  }
  return results;
}

function render(items) {
  resultsEl.innerHTML = "";

  console.log("Rendering items:", items.length);

  if (!items || items.length === 0) {
    resultsEl.innerHTML = "<p>No products found.</p>";
    return;
  }

  for (const p of items) {
    const title =
      p.title || p.name || "No title";

    const image =
      p.image || p.thumbnail || "";

    const price =
      p.price !== undefined && p.price !== null
        ? `${p.price} ${p.currency || "AED"}`
        : "Price unavailable";

    const store = p.store || "Unknown";

    const card = document.createElement("div");
    card.className = "card";

    card.innerHTML = `
      <img src="${image}" alt="" />
      <h3>${title}</h3>
      <div class="store">${store}</div>
      <div class="price">${price}</div>
      <a class="link" href="${p.link}" target="_blank">Open product</a>
    `;

    resultsEl.appendChild(card);
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

function log(msg) {
  if (!debugEnabled) return;
  debugEl.textContent += msg + "\n";
}
