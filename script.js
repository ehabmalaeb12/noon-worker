// verbose frontend search + fallbacks
const AMAZON_WORKER = 'https://shopping-worker.ehabmalaeb2.workers.dev';
const SHARAF_WORKER = 'https://sharaf-worker.ehabmalaeb2.workers.dev';
const SERPAPI_KEY = '80742aa2857d3cbb676946278ff2693d787d68fa9d0187dfcba8a96e0be36a70';
const SCRAPERAPI_KEY = '5710cb557dc48aa4262b8f90870fedff';

// DOM
const input = document.getElementById('searchInput') || document.querySelector('input');
const btn = document.getElementById('searchBtn') || document.querySelector('button');
const resultsEl = document.getElementById('results') || document.getElementById('searchResults') || document.createElement('div');
const logsEl = document.getElementById('logs') || (() => {
  const el = document.createElement('pre');
  el.id = 'logs'; document.body.appendChild(el);
  return el;
})();
const statusEl = document.getElementById('status') || (() => { const s = document.createElement('div'); document.body.insertBefore(s, document.body.firstChild); return s; })();

const log = (m) => { logsEl.textContent += m + '\n'; console.log(m); };
const clearLogs = () => logsEl.textContent = '';

btn.onclick = () => performSearch();
input.onkeydown = e => { if (e.key === 'Enter') performSearch(); };

function timeoutFetch(url, opts = {}, ms = 12000) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal })
    .finally(() => clearTimeout(id));
}

async function probeUrl(url, ms=10000) {
  log(`PROBE -> ${url}`);
  try {
    const r = await timeoutFetch(url, {}, ms);
    const status = r.status;
    let text = '';
    try { text = await r.text(); } catch(e) { text = `<error reading body: ${e.message}>`; }
    log(`PROBE STATUS ${status} - body snippet: ${text.slice(0,300).replace(/\n/g,' ')}`);
    return { ok: r.ok, status, text, url };
  } catch (err) {
    log(`PROBE ERROR ${url} -> ${err && err.message}`);
    return { ok:false, error: String(err), url };
  }
}

async function performSearch() {
  clearLogs();
  resultsEl.innerHTML = '';
  const q = input.value.trim();
  if (!q) { log('Empty query'); return; }
  statusEl.textContent = `Start search: "${q}"`;

  // ---------- 1) AMAZON worker ----------
  log(`Query Amazon worker -> ${AMAZON_WORKER}/search?q=${encodeURIComponent(q)}`);
  let amazonResults = [];
  try {
    const r = await timeoutFetch(`${AMAZON_WORKER}/search?q=${encodeURIComponent(q)}`, {}, 12000);
    const text = await r.text();
    log(`Amazon worker status ${r.status}`);
    try {
      const json = JSON.parse(text);
      amazonResults = json.results || [];
      log(`Amazon results count ${amazonResults.length}`);
    } catch (e) {
      log(`Amazon JSON parse failed: ${e.message} - body snippet: ${text.slice(0,300)}`);
    }
  } catch (err) {
    log(`Amazon fetch error ${err.message || err}`);
  }

  // ---------- 2) Sharaf product links via SerpApi ----------
  log(`Query Sharaf search via SerpApi -> serpapi.com (site:uae.sharafdg.com)`);
  let sharafLinks = [];
  try {
    const serpUrl = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(q + ' site:uae.sharafdg.com')}&gl=ae&hl=en&api_key=${SERPAPI_KEY}`;
    const r = await timeoutFetch(serpUrl, {}, 15000);
    const text = await r.text();
    log(`SerpApi status ${r.status} body snippet: ${text.slice(0,300)}`);
    const j = JSON.parse(text);
    const items = j.shopping_results || j.inline_shopping_results || [];
    sharafLinks = items.map(it => it.link || it.product_link).filter(x => x && x.includes('sharafdg.com/product')).slice(0,6);
    log(`Sharaf links from SerpApi: ${sharafLinks.length}`);
  } catch (err) {
    log(`SerpApi failed: ${err.message || err}`);
  }

  // ---------- 2b) fallback: ScraperAPI fetch of Sharaf search page and regex parse ----------
  if (!sharafLinks.length) {
    log('No links from SerpApi — trying ScraperAPI fetch of Sharaf search page as fallback');
    try {
      const scrUrl = `https://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent('https://uae.sharafdg.com/catalogsearch/result/?q=' + encodeURIComponent(q))}&render=true&country_code=ae`;
      const r = await timeoutFetch(scrUrl, {}, 20000);
      const txt = await r.text();
      log(`ScraperAPI status ${r.status} length ${txt.length}`);
      const re = /https?:\/\/uae\.sharafdg\.com\/product\/[a-z0-9\-_%]+/ig;
      const matches = [...new Set((txt.match(re) || []))];
      sharafLinks = matches.slice(0,6);
      log(`Sharaf links from ScraperAPI fallback: ${sharafLinks.length}`);
    } catch (err) {
      log(`ScraperAPI fallback failed: ${err.message || err}`);
    }
  }

  // ---------- 3) fetch Sharaf product details in parallel (limit 4) ----------
  log(`Sharaf links count ${sharafLinks.length}`);
  const sharafProducts = [];
  const concurrency = 4;
  for (let i=0; i<sharafLinks.length; i += concurrency) {
    const chunk = sharafLinks.slice(i, i + concurrency);
    await Promise.all(chunk.map(async link => {
      try {
        const url = `${SHARAF_WORKER}/product?url=${encodeURIComponent(link)}`;
        log(`Query Sharaf product worker -> ${url}`);
        const r = await timeoutFetch(url, {}, 15000);
        const txt = await r.text();
        log(`Sharaf product status ${r.status} snippet: ${txt.slice(0,300)}`);
        try {
          const j = JSON.parse(txt);
          if (j && j.title) sharafProducts.push(j);
        } catch (e) {
          log(`Sharaf product JSON parse err: ${e.message}`);
        }
      } catch (err) {
        log(`Sharaf product fetch err: ${err.message || err}`);
      }
    }));
  }
  log(`Sharaf priced from worker: ${sharafProducts.length}`);

  // ---------- 4) Merge & Render ----------
  const merged = [
    ...amazonResults.map(a => ({...a, store:'Amazon.ae'})),
    ...sharafProducts.map(s => ({...s, store:'SharafDG'}))
  ];
  log(`Search finished, merged count ${merged.length}`);
  renderResults(merged);
  statusEl.textContent = `Search finished, merged ${merged.length}`;
}

function renderResults(items) {
  if (!resultsEl) return;
  if (!items.length) {
    resultsEl.innerHTML = '<p>No priced products found across selected stores.</p>';
    return;
  }
  resultsEl.innerHTML = items.map(p => {
    const img = p.image ? `<img src="${p.image}" alt="">` : `<div style="height:160px;background:#f2f2f2"></div>`;
    return `
      <div class="card">
        ${img}
        <h3>${p.title || 'No title'}</h3>
        <div class="price">${p.price? p.price + ' AED' : 'No price'}</div>
        <div><a href="${p.link}" target="_blank">View on ${p.store}</a></div>
      </div>
    `;
  }).join('');
}
