const API =
  "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";

async function search() {
  const q = document.getElementById("query").value.trim();
  if (!q) return;

  document.getElementById("status").innerText = "Searching...";
  document.getElementById("results").innerHTML = "";

  try {
    const res = await fetch(API + encodeURIComponent(q));
    const data = await res.json();

    document.getElementById("status").innerText =
      `${data.count} results found`;

    data.results.forEach(p => {
      document.getElementById("results").innerHTML += `
        <div class="card">
          <img src="${p.image}" />
          <h3>${p.title}</h3>
          <p class="price">${p.price} ${p.currency}</p>
          <span class="store">${p.store}</span>
        </div>
      `;
    });

  } catch (e) {
    document.getElementById("status").innerText = "Error loading results";
  }
}
