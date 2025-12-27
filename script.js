const AMAZON_WORKER =
  "https://uae-price-proxy.ehabmalaeb2.workers.dev/search";

const SHARAF_WORKER =
  "https://sharaf-worker.ehabmalaeb2.workers.dev/search";

const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const loading = document.getElementById("loading");
const resultsDiv = document.getElementById("results");

searchBtn.addEventListener("click", search);

async function search() {
  const q = searchInput.value.trim();
  if (!q) return;

  resultsDiv.innerHTML = "";
  loading.style.display = "block";

  try {
    const [amazonRes, sharafRes] = await Promise.all([
      fetch(`${AMAZON_WORKER}?q=${encodeURIComponent(q)}`).then(r => r.json()),
      fetch(`${SHARAF_WORKER}?q=${encodeURIComponent(q)}`).then(r => r.json())
    ]);

    const allResults = [
      ...(amazonRes.results || []),
      ...(sharafRes.results || [])
    ];

    if (allResults.length === 0) {
      resultsDiv.innerHTML = "<p>No results found.</p>";
    }

    allResults.forEach(renderCard);

  } catch (e) {
    resultsDiv.innerHTML = "<p>Error loading offers.</p>";
    console.error(e);
  }

  loading.style.display = "none";
}

function renderCard(item) {
  const card = document.createElement("div");
  card.className = "card";

  card.innerHTML = `
    <img src="${item.image || ""}">
    <div class="title">${item.title}</div>
    <div class="price">${item.price ? item.price + " AED" : "Check price"}</div>
    <div class="store">${item.store}</div>
    <a href="${item.link}" target="_blank">View on store</a>
  `;

  resultsDiv.appendChild(card);
}
