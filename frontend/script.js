const API_BASE =
  "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";

async function search() {
  const query = document.getElementById("searchInput").value.trim();
  const resultsDiv = document.getElementById("results");
  const statusDiv = document.getElementById("status");

  if (!query) {
    alert("Please enter a search term");
    return;
  }

  resultsDiv.innerHTML = "";
  statusDiv.textContent = "🔍 Searching...";

  try {
    const response = await fetch(API_BASE + encodeURIComponent(query));
    const data = await response.json();

    if (!data || data.length === 0) {
      statusDiv.textContent = "❌ No results found";
      return;
    }

    statusDiv.textContent = `✅ Found ${data.length} products`;

    data.forEach(item => {
      const card = document.createElement("div");
      card.className = "card";

      card.innerHTML = `
        <img src="${item.image}" alt="">
        <h3>${item.title}</h3>
        <div class="price">${item.price}</div>
        <a href="${item.link}" target="_blank">View on ${item.store}</a>
      `;

      resultsDiv.appendChild(card);
    });

  } catch (error) {
    console.error(error);
    statusDiv.textContent = "⚠️ Error fetching data";
  }
}
