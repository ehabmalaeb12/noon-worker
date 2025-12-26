// ===============================
// CONFIG
// ===============================
const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";

// ===============================
// DOM ELEMENTS
// ===============================
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultsDiv = document.getElementById("results");

// ===============================
// EVENTS
// ===============================
searchBtn.addEventListener("click", () => {
  const query = searchInput.value.trim();
  if (!query) return;
  searchAmazon(query);
});

searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    searchBtn.click();
  }
});

// ===============================
// FUNCTIONS
// ===============================
async function searchAmazon(query) {
  resultsDiv.innerHTML = "<p>Loading offers...</p>";

  try {
    const response = await fetch(AMAZON_WORKER + encodeURIComponent(query));
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      resultsDiv.innerHTML = "<p>No offers found across stores.</p>";
      return;
    }

    renderResults(data.results);
  } catch (error) {
    console.error("Fetch error:", error);
    resultsDiv.innerHTML = "<p>Error loading offers.</p>";
  }
}

function renderResults(items) {
  resultsDiv.innerHTML = "";

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "product-card";

    card.innerHTML = `
      <img src="${item.image}" alt="${item.title}" />
      <h3>${item.title}</h3>
      <p><strong>${item.price} ${item.currency}</strong></p>
      <p>${item.store}</p>
      <a href="${item.link}" target="_blank">View on store</a>
    `;

    resultsDiv.appendChild(card);
  });
}
