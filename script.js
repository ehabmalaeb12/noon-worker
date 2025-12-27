// script.js — fetches Amazon worker + Sharaf worker, merges and groups results
const AMAZON_WORKER = 'https://uae-price-proxy.ehabmalaeb2.workers.dev/search?q=';
const SHARAF_SEARCH = 'https://sharaf-worker.ehabmalaeb2.workers.dev/search?q=';
const SHARAF_PRODUCT = 'https://sharaf-worker.ehabmalaeb2.workers.dev/product?url=';

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const loadingEl = document.getElementById('loading');
const resultsEl = document.getElementById('searchResults');
const dealsSection = document.getElementById('bestDeals');
const dealsGrid = document.getElementById('dealsGrid');
const errorEl = document.getElementById('error');
const basketCountEl = document.getElementById('basketCount');
const totalPointsEl = document.getElementById('totalPoints');

let appState = { basket: [], points: 0 };
loadState();
updateUI();

searchBtn.addEventListener('click', () => runSearch());
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
  errorEl.style.display = 'none';
}

/* ------------ Main search flow ------------- */
async function runSearch() {
  const q = (searchInput.value || '').trim();
  if (!q) { error('Please enter a product name'); return; }

  resultsEl.innerHTML = '';
  dealsGrid.innerHTML = '';
  dealsSection.style.display = 'none';
  showLoading(true);

  try {
    // Fetch Amazon and Sharaf search concurrently
    const [amazonResp, sharafResp] = await Promise.allSettled([
      fetchJsonWithTimeout(AMAZON_WORKER + encodeURIComponent(q), 25000),
      fetchJsonWithTimeout(SHARAF_SEARCH + encodeURIComponent(q), 25000)
    ]);

    const amazonProducts = (amazonResp.status === 'fulfilled' && Array.isArray(amazonResp.value.results))
      ? amazonResp.value.results
      : [];

    const sharafSearchResults = (sharafResp.status === 'fulfilled' && Array.isArray(sharafResp.value.results))
      ? sharafResp.value.results
      : [];

    // From Sharaf search get product pages then call /product endpoint to get price/title/image
    const sharafProducts = await fetchSharafProductsFromSearch(sharafSearchResults, 10);

    // Normalize and merge
    const normalized = normalizeProducts(amazonProducts, sharafProducts);

    if (normalized.length === 0) {
      error('No priced products found.');
      showLoading(false);
      return;
    }

    // Group products by simple model key and render
    const groups = groupByModel(normalized);
    renderGroups(groups);

    // Show best deals (top 6 cheapest across all)
    renderBestDeals(normalized);

  } catch (err) {
    console.error(err);
    error('Search failed — see console for details');
  } finally {
    showLoading(false);
  }
}

/* ---------- Helpers: fetch with timeout ---------- */
async function fetchJsonWithTimeout(url, ms = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
    const json = await res.json();
    clearTimeout(id);
    return json;
  } finally { clearTimeout(id); }
}

/* ---------- Sharaf product fetch (limited concurrency) ---------- */
async function fetchSharafProductsFromSearch(searchResults, limit = 8) {
  if (!Array.isArray(searchResults) || searchResults.length === 0) return [];
  const urls = searchResults.map(r => r.link).filter(Boolean).slice(0, limit);

  // simple concurrency limiter (batch size 4)
  const batchSize = 4;
  const out = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize).map(u =>
      fetchJsonWithTimeout(SHARAF_PRODUCT + encodeURIComponent(u), 20000)
        .then(j => {
          if (j && j.price != null) return j;
          return null;
        })
        .catch(err => { console.warn('sharaf product fetch fail', err); return null; })
    );
    const res = await Promise.all(batch);
    res.forEach(r => { if (r) out.push(r); });
  }
  return out;
}

/* ---------- Normalize Amazon & Sharaf product formats ---------- */
function normalizeProducts(amazonArr = [], sharafArr = []) {
  const norm = [];

  // Amazon format: {asin, title, price, image, link, store}
  for (const a of amazonArr) {
    const price = numeric(a.price);
    if (!isFinite(price)) continue; // skip null/na
    norm.push({
      id: a.asin || a.id || a.link,
      title: a.title || a.name || a.asin || '',
      price,
      image: a.image || a.img || null,
      link: a.link || a.url || null,
      store: a.store || 'Amazon.ae',
      raw: a
    });
  }

  // Sharaf format: {title, price, image, link, store}
  for (const s of sharafArr) {
    const price = numeric(s.price);
    if (!isFinite(price)) continue;
    norm.push({
      id: s.link,
      title: s.title || s.name || '',
      price,
      image: s.image || null,
      link: s.link || null,
      store: s.store || 'SharafDG',
      raw: s
    });
  }

  return norm;
}

/* ---------- Group by model (naive normalization) ---------- */
function modelKeyForTitle(title) {
  if (!title) return '';
  // lowercase, remove non-alphanum (except spaces), collapse spaces, take first 6 words
  const cleaned = title.toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean);
  return words.slice(0, 6).join(' ');
}

function groupByModel(products) {
  const map = new Map();
  for (const p of products) {
    const key = modelKeyForTitle(p.title) || (p.id || '').slice(0, 24);
    if (!map.has(key)) map.set(key, { key, titleCandidates: [], items: [] });
    const g = map.get(key);
    g.items.push(p);
    if (p.title) g.titleCandidates.push(p.title);
  }

  // create ordered array, sort groups by cheapest price inside
  const groups = Array.from(map.values()).map(g => {
    g.items.sort((a,b) => a.price - b.price);
    // choose representative title (shortest non-empty)
    g.title = g.titleCandidates.sort((a,b) => a.length - b.length)[0] || g.items[0]?.title || 'Product';
    g.best = g.items[0];
    g.minPrice = g.best.price;
    return g;
  });

  groups.sort((a,b) => a.minPrice - b.minPrice);
  return groups;
}

/* ---------- RENDERING ---------- */
function renderGroups(groups) {
  resultsEl.innerHTML = '';
  for (const g of groups) {
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'row';
    const h = document.createElement('h3');
    h.textContent = g.title;
    header.appendChild(h);

    const bestBadge = document.createElement('span');
    bestBadge.className = 'best';
    bestBadge.textContent = `Best ${g.best.price} AED — ${g.best.store}`;
    header.appendChild(bestBadge);

    card.appendChild(header);

    // show main image (from best)
    const row = document.createElement('div');
    row.className = 'row';
    const img = document.createElement('img');
    img.src = g.best.image || placeholder();
    img.alt = g.title;
    row.appendChild(img);

    const info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = `<div class="small-muted">From ${g.items.length} stores</div>
                      <div style="margin-top:6px"><strong>${g.best.price} AED</strong></div>`;
    row.appendChild(info);
    card.appendChild(row);

    // list stores
    for (const item of g.items) {
      const sr = document.createElement('div');
      sr.className = 'store-row';

      const left = document.createElement('div');
      left.className = 'store-left';
      const sImg = document.createElement('img');
      sImg.src = item.image || placeholder();
      left.appendChild(sImg);
      const sTitle = document.createElement('div');
      sTitle.innerHTML = `<div style="font-weight:700">${item.store}</div><div class="small-muted">${truncate(item.title,80)}</div>`;
      left.appendChild(sTitle);

      const right = document.createElement('div');
      right.style.textAlign = 'right';
      right.innerHTML = `<div class="price">${item.price} AED</div>
                         <div class="actions" style="margin-top:6px">
                           <a href="${item.link}" target="_blank" rel="noopener">Buy</a>
                           <button onclick='addToBasketFromUI(${JSON.stringify(item).replace(/"/g,'&quot;')})'>Add</button>
                         </div>`;

      sr.appendChild(left);
      sr.appendChild(right);
      card.appendChild(sr);
    }

    resultsEl.appendChild(card);
  }
}

/* ---------- Best deals carousel ---------- */
function renderBestDeals(allProducts) {
  if (!Array.isArray(allProducts) || allProducts.length === 0) { dealsSection.style.display='none'; return; }
  const top = allProducts.slice().sort((a,b)=>a.price-b.price).slice(0,6);
  dealsGrid.innerHTML = '';
  for (const p of top) {
    const c = document.createElement('div');
    c.className = 'card deal-badge';
    c.innerHTML = `<div style="display:flex;gap:10px;align-items:center">
      <img src="${p.image||placeholder()}" style="width:90px;height:70px;object-fit:cover;border-radius:8px">
      <div style="flex:1">
        <div style="font-weight:700">${truncate(p.title,80)}</div>
        <div class="small-muted">${p.store}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:800">${p.price} AED</div>
        <div style="margin-top:8px">
          <a href="${p.link}" target="_blank" rel="noopener" class="actions">Buy</a>
        </div>
      </div>
    </div>`;
    dealsGrid.appendChild(c);
  }
  dealsSection.style.display = 'block';
}

/* ---------- Small utilities ---------- */
function numeric(v){ if (v==null) return NaN; const n = Number(String(v).toString().replace(/[^0-9.]/g,'')); return isFinite(n)?n:NaN }
function truncate(s,len=60){ if(!s) return ''; return s.length>len? s.slice(0,len-1)+'…':s }
function placeholder(){ return 'https://images.unsplash.com/photo-1526178613751-0b5a5f1f6f5d?w=800&auto=format&fit=crop&q=60' }

/* ---------- Sharaf product helper ---------- */

/* (not exposed) */

function error(msg){
  errorEl.style.display='block';
  errorEl.textContent = msg;
}

async function addToBasketFromUI(item){
  addToBasket(item);
  updateUI();
}

/* ---------- Basket + localStorage ---------- */
function loadState(){
  try{
    appState.basket = JSON.parse(localStorage.getItem('uae_price_hunter_basket')||'[]');
    appState.points = parseInt(localStorage.getItem('user_points')||'0')||0;
  }catch(e){ appState = {basket:[],points:0} }
}
function saveState(){
  try{
    localStorage.setItem('uae_price_hunter_basket', JSON.stringify(appState.basket));
    localStorage.setItem('user_points', String(appState.points||0));
  }catch(e){}
}
function addToBasket(p){
  appState.basket.push({...p, qty:1});
  appState.points = (appState.points||0) + 50;
  saveState();
}
function updateUI(){
  basketCountEl.textContent = appState.basket.length;
  totalPointsEl.textContent = appState.points||0;
}

/* ---------- grouping runner helpers ---------- */
function groupKeyFromTitle(t){ return modelKeyForTitle(t); }

/* ---------- load sharaf products given search results ---------- */
/* small wrapper re-implemented with concurrency control */
async function fetchSharafProductsFromSearch(searchResults, limit=8){
  if (!Array.isArray(searchResults) || searchResults.length === 0) return [];
  const urls = searchResults.map(r=>r.link).filter(Boolean).slice(0, limit);
  const batchSize = 4;
  const out = [];
  for (let i=0;i<urls.length;i+=batchSize){
    const batch = urls.slice(i,i+batchSize).map(u =>
      fetchJsonWithTimeout(SHARAF_PRODUCT + encodeURIComponent(u), 20000)
        .then(j=> j && j.price!=null ? {
          title: j.title||j.name||u,
          price: numeric(j.price),
          image: j.image||null,
          link: j.link||u,
          store: j.store||'SharafDG',
        } : null)
        .catch(()=>null)
    );
    const res = await Promise.all(batch);
    res.forEach(r=> { if (r && isFinite(r.price)) out.push(r); });
  }
  return out;
}

/* ---------- initial quick search if value present ---------- */
window.performSearch = runSearch;
window.addToBasket = addToBasket;
if (searchInput.value && searchInput.value.trim()) {
  // do one initial search (useful for immediate testing)
  runSearch();
}
