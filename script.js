const AMAZON_SEARCH =
  "https://shopping-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_SEARCH =
  "https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=";
const SHARAF_PRODUCT =
  "https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=";

const resultsEl = document.getElementById("searchResults");
const loadingEl = document.getElementById("loading");

document.getElementById("searchBtn").onclick = search;

async function search() {
  const q = document.getElementById("searchInput").value.trim();
  if (!q) return;

  loadingEl.style.display = "block";
  resultsEl.innerHTML = "";

  try {
    const [amazonRes, sharafRes] = await Promise.all([
      fetch(AMAZON_SEARCH + encodeURIComponent(q)).then(r => r.json()),
      fetch(SHARAF_SEARCH + encodeURIComponent(q)).then(r => r.json())
    ]);

    const amazonItems = (amazonRes.results || []).filter(p => p.price);

    // 🔥 IMPORTANT PART: hydrate Sharaf prices
    const sharafLinks = (sharafRes.results || [])
      .filter(r => r.link && r.link.includes("/product/"))
      .slice(0, 5); // limit for speed

    const sharafItems = await Promise.all(
      sharafLinks.map(async r => {
        try {
          const res = await fetch(
            SHARAF_PRODUCT + encodeURIComponent(r.link)
          );
          return await res.json();
        } catch {
          return null;
        }
      })
    );

    const all = [...amazonItems, ...sharafItems.filter(Boolean)];
    renderGrouped(all);
  } catch (e) {
    resultsEl.innerHTML = "<p>Error loading results.</p>";
    console.error(e);
  } finally {
    loadingEl.style.display = "none";
  }
}

function normalize(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(uae|dubai|version|with|and)\b/g, "")
    .trim();
}

function renderGrouped(items) {
  if (!items.length) {
    resultsEl.innerHTML = "<p>No priced products found.</p>";
    return;
  }

  const groups = {};
  items.forEach(p => {
    const key = normalize(p.title);
    groups[key] = groups[key] || [];
    groups[key].push(p);
  });

  Object.values(groups).forEach(group => {
    const best = Math.min(...group.map(p => p.price));

    const card = document.createElement("div");
    card.className = "card";

    card.innerHTML = `
      <h3>${group[0].title}</h3>
      ${group[0].image ? `<img src="${group[0].image}">` : ""}
      ${group
        .map(
          p => `
        <div class="store-row">
          <div>
            <strong>${p.store}</strong> – AED ${p.price}
            ${
              p.price === best
                ? `<span class="badge">Best Price</span>`
                : ""
            }
          </div>
          <a href="${p.link}" target="_blank">
            <button>View</button>
          </a>
        </div>
      `
        )
        .join("")}
    `;

    resultsEl.appendChild(card);
  });
}
