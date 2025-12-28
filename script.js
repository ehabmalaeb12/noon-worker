const AMAZON_WORKER = 'https://shopping-worker.ehabmalaeb2.workers.dev';
const SHARAF_WORKER = 'https://sharaf-worker.ehabmalaeb2.workers.dev';
const SERPAPI_KEY = '80742aa2857d3cbb676946278ff2693d787d68fa9d0187dfcba8a96e0be36a70';

const input = document.getElementById('searchInput');
const btn = document.getElementById('searchBtn');
const results = document.getElementById('results');
const logs = document.getElementById('logs');
const status = document.getElementById('status');

btn.onclick = () => search();
input.onkeydown = e => e.key === 'Enter' && search();

const log = m => logs.textContent += m + '\n';
const clearLog = () => logs.textContent = '';

async function fetchJSON(url, timeout = 12000) {
  const c = new AbortController();
  setTimeout(() => c.abort(), timeout);
  const r = await fetch(url, { signal: c.signal });
  return r.json();
}

async function search() {
  const q = input.value.trim();
  if (!q) return;

  clearLog();
  results.innerHTML = '';
  status.textContent = 'Searching Amazon & SharafDG…';

  /* ---------- AMAZON ---------- */
  log(`Amazon search: ${q}`);
  let amazon = [];
  try {
    const a = await fetchJSON(`${AMAZON_WORKER}/search?q=${encodeURIComponent(q)}`);
    amazon = a.results || [];
    log(`Amazon results: ${amazon.length}`);
  } catch {
    log('Amazon failed');
  }

  /* ---------- SERPAPI (Sharaf search) ---------- */
  log('Searching Sharaf via SerpApi…');
  let sharafLinks = [];
  try {
    const serp = await fetchJSON(
      `https://serpapi.com/search.json?engine=google_shopping&q=` +
      encodeURIComponent(`site:uae.sharafdg.com ${q}`) +
      `&gl=ae&hl=en&api_key=${SERPAPI_KEY}`,
      15000
    );

    const items = serp.shopping_results || [];
    sharafLinks = items
      .map(i => i.link || i.product_link)
      .filter(l => l && l.includes('sharafdg.com/product'))
      .slice(0, 5);

    log(`Sharaf links from SerpApi: ${sharafLinks.length}`);
  } catch {
    log('SerpApi failed');
  }

  /* ---------- SHARAF PRODUCT FETCH ---------- */
  let sharaf = [];
  await Promise.all(
    sharafLinks.map(async link => {
      try {
        const p = await fetchJSON(
          `${SHARAF_WORKER}/product?url=${encodeURIComponent(link)}`,
          12000
        );
        sharaf.push(p);
      } catch {
        log(`Sharaf failed: ${link}`);
      }
    })
  );

  log(`Sharaf products loaded: ${sharaf.length}`);

  /* ---------- MERGE ---------- */
  const all = [
    ...amazon.map(a => ({ ...a, store: 'Amazon.ae' })),
    ...sharaf.map(s => ({ ...s, store: 'SharafDG' }))
  ];

  render(all);
  status.textContent = `Results: ${all.length}`;
}

function render(items) {
  if (!items.length) {
    results.innerHTML = '<p>No results.</p>';
    return;
  }

  results.innerHTML = items.map(p => `
    <div class="card">
      <img src="${p.image || ''}">
      <h3>${p.title}</h3>
      <div class="price">${p.price} AED</div>
      <a href="${p.link}" target="_blank">View on ${p.store}</a>
    </div>
  `).join('');
}
