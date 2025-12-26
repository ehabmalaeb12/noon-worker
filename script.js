const API =
  "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";

async function search() {
  const q = document.getElementById("searchInput").value.trim();
  if (!q) return;

  document.getElementById("results").innerHTML = "Loading…";

  const res = await fetch(API + encodeURIComponent(q));
  const data = await res.json();

  if (!data.results || !data.results.length) {
    document.getElementById("results").innerHTML =
      "<p>No results found</p>";
    return;
  }

  const grouped = {};
  for (const item of data.results) {
    if (!grouped[item.store]) grouped[item.store] = [];
    grouped[item.store].push(item);
  }

  let html = "";

  for (const store in grouped) {
    html += `<h2>${store}</h2><div class="store">`;

    for (const p of grouped[store]) {
      html += `
        <div class="card">
          <img src="${p.image}" />
          <h3>${p.title}</h3>
          <p class="price">${p.price} AED</p>
          <a href="${p.link}" target="_blank">Buy</a>
        </div>
      `;
    }

    html += "</div>";
  }

  document.getElementById("results").innerHTML = html;
}
