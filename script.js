const AMAZON_WORKER = 'https://shopping-worker.ehabmalaeb2.workers.dev';
const SHARAF_WORKER = 'https://sharaf-worker.ehabmalaeb2.workers.dev';

const qInput = document.getElementById('q');
const searchBtn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const logsEl = document.getElementById('logs');

searchBtn.onclick = () => search();
qInput.onkeydown = e => e.key === 'Enter' && search();

function log(msg) {
  logsEl.textContent += msg + "\n";
}

async function search() {
  const q = qInput.value.trim();
  if (!q) return;

  resultsEl.innerHTML = '';
  logsEl.textContent = '';
  statusEl.textContent = 'Searching Amazon & SharafDG…';

  // 1️⃣ AMAZON SEARCH
  const amazonRes = await fetch(`${AMAZON_WORKER}/search?q=${encodeURIComponent(q)}`).then(r => r.json());
  log(`Amazon results count ${amazonRes.results?.length || 0}`);

  const products = [];

  for (const a of amazonRes.results.slice(0, 6)) {
    if (!a.price) continue;

    products.push({
      store: 'Amazon.ae',
      title: a.title,
      price: a.price,
      image: a.image,
      link: a.link
    });

    // 2️⃣ TRY SHARAF USING AMAZON TITLE
    try {
      const sharafSearchUrl =
        'https://uae.sharafdg.com/search?q=' + encodeURIComponent(a.title);

      const sharafProduct = await fetch(
        `${SHARAF_WORKER}/product?url=${encodeURIComponent(sharafSearchUrl)}`
      ).then(r => r.json());

      if (sharafProduct.price) {
        products.push({
          store: 'SharafDG',
          title: sharafProduct.title,
          price: sharafProduct.price,
          image: sharafProduct.image,
          link: sharafProduct.link
        });
      }
    } catch (e) {
      log('Sharaf fetch failed');
    }
  }

  render(products);
}

function render(items) {
  if (!items.length) {
    statusEl.textContent = 'No results found';
    return;
  }

  const best = Math.min(...items.map(i => i.price));

  for (const p of items) {
    const card = document.createElement('div');
    card.className = 'card';

    card.innerHTML = `
      <div class="thumb"><img src="${p.image || ''}"></div>
      <div class="title">
        ${p.title}
        ${p.price === best ? '<span class="badge">Best price</span>' : ''}
      </div>
      <div class="price-row">
        <div class="price">${p.price} AED</div>
        <a class="btn" href="${p.link}" target="_blank">View on ${p.store}</a>
      </div>
    `;

    resultsEl.appendChild(card);
  }

  statusEl.textContent = `Found ${items.length} results`;
}
