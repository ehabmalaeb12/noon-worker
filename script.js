const API_BASE =
  "https://shopping-worker.ehabmalaeb2.workers.dev/search";

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultsDiv = document.getElementById("results");

searchBtn.addEventListener("click", search);
searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") search();
});

async function search() {
  const query = searchInput.value.trim();
  if (!query) return;

  resultsDiv.innerHTML = `<p>🔎 Searching for <b>${query}</b>...</p>`;

  try {
    const res = await fetch(`${API_BASE}?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      resultsDiv.innerHTML = `<p>❌ No results found.</p>`;
      return;
    }

    renderResults(data.results);
  } catch (err) {
    resultsDiv.innerHTML = `<p>⚠️ Error loading results</p>`;
    console.error(err);
  }
}

function renderResults(items) {
  resultsDiv.innerHTML = "";

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "product-card";

    card.innerHTML = `
      <img src="${item.image || ""}" alt="${item.title || "product"}" />
      <h3>${item.title || "Unknown product"}</h3>
      <p class="price">
        ${item.price ? item.price + " " + item.currency : "Price unavailable"}
      </p>
      <p class="store">${item.store}</p>
      <a href="${item.link}" target="_blank">View product</a>
    `;

    resultsDiv.appendChild(card);
  });
}
