const API =
  "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";

async function search() {
  const q = document.getElementById("query").value.trim();
  if (!q) return;

  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "Loading...";

  try {
    const res = await fetch(API + encodeURIComponent(q));
    const data = await res.json();

    if (!data.results.length) {
      resultsDiv.innerHTML = "No results found.";
      return;
    }

    resultsDiv.innerHTML = data.results.map(p => `
      <div class="card">
        <img src="${p.image}" />
        <h3>${p.title}</h3>
        <p class="price">${p.price} ${p.currency}</p>
        <span class="store">${p.store}</span>
      </div>
    `).join("");

  } catch (e) {
    resultsDiv.innerHTML = "Error loading results.";
  }
}
