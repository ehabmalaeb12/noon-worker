// script.js — frontend that merges Amazon worker + SharafDG worker

const AMAZON_WORKER = "https://uae-price-proxy.ehabmalaeb2.workers.dev/search"; // locked
const SHARAF_SEARCH = "https://sharaf-worker.ehabmalaeb2.workers.dev/search"; // locked
const SHARAF_PRODUCT = "https://sharaf-worker.ehabmalaeb2.workers.dev/product"; // locked

const $ = id => document.getElementById(id);
const searchInput = $('searchInput');
const searchBtn = $('searchBtn');
const loadingEl = $('loading');
const resultsEl = $('searchResults');

searchBtn.addEventListener('click', runSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });

function setLoading(text){ loadingEl.style.display = 'block'; loadingEl.textContent = text; }
function clearLoading(){ loadingEl.style.display = 'none'; }

async function runSearch(){
  const q = searchInput.value.trim();
  resultsEl.innerHTML = '';
  if(!q){ loadingEl.textContent = 'Please enter a product name.'; return; }

  setLoading('Searching Amazon + SharafDG — combining results...');

  try {
    // Start both searches in parallel
    const amazonPromise = fetchAmazon(q);
    const sharafSearchPromise = fetchSharafSearch(q);

    const [amazonProducts, sharafProductLinks] = await Promise.all([amazonPromise, sharafSearchPromise]);

    // For Sharaf: fetch product details for top N links (throttle to 6)
    const sharafTop = (sharafProductLinks || []).slice(0, 6);
    const sharafDetails = await fetchSharafProducts(sharafTop);

    // Merge lists (drop items without price)
    const amazonClean = (amazonProducts || []).filter(p => p && p.price != null);
    const sharafClean = (sharafDetails || []).filter(p => p && p.price != null);

    const all = [...amazonClean.map(p => ({...p, store: p.store || 'Amazon.ae'})), ...sharafClean.map(p => ({...p, store: 'SharafDG'}))];

    if(all.length === 0){ resultsEl.innerHTML = '<div class="note">No products with prices found.</div>'; clearLoading(); return; }

    const groups = groupSimilar(all);
    renderGroups(groups);

  } catch(err){
    resultsEl.innerHTML = `<div class="note">Search failed: ${err.message}</div>`;
    console.error(err);
  } finally {
    clearLoading();
  }
}

// ---------- Amazon worker call ----------
async function fetchAmazon(q){
  try{
    const url = `${AMAZON_WORKER}?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { mode: 'cors' });
    if(!res.ok) throw new Error('Amazon worker error');
    const json = await res.json();
    return (json.results || []).map(r => ({
      title: r.title || r.name || null,
      price: r.price == null ? null : Number(r.price),
      image: r.image || r.thumbnail || null,
      link: r.link || r.url || null,
      store: r.store || 'Amazon.ae'
    }));
  }catch(e){ console.warn('Amazon fetch failed', e); return []; }
}

// ---------- Sharaf search (returns product URLs) ----------
async function fetchSharafSearch(q){
  try{
    const url = `${SHARAF_SEARCH}?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { mode: 'cors' });
    if(!res.ok) throw new Error('Sharaf search failed');
    const json = await res.json();
    // json.results is an array of {link}
    return (json.results || []).map(r => r.link).filter(Boolean);
  }catch(e){ console.warn('Sharaf search failed', e); return []; }
}

// ---------- For each Sharaf product link call /product?url=... ----------
async function fetchSharafProducts(links){
  if(!links || links.length===0) return [];
  const jobs = links.map(link => (async ()=>{
    try{
      const url = `${SHARAF_PRODUCT}?url=${encodeURIComponent(link)}`;
      const res = await fetch(url, { mode: 'cors' });
      if(!res.ok) throw new Error('Sharaf product fetch failed');
      const json = await res.json();
      return {
        title: json.title || null,
        price: json.price == null ? null : Number(json.price),
        image: json.image || null,
        link: json.link || link,
        store: 'SharafDG'
      };
    }catch(e){ console.warn('Sharaf product error', link, e); return null; }
  })());

  const settled = await Promise.allSettled(jobs);
  return settled.filter(s => s.status==='fulfilled').map(s=>s.value).filter(Boolean);
}

// ---------- Group similar products by normalized title ----------
function normalizeTitle(t){
  if(!t) return '';
  return t.toString().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function groupSimilar(items){
  const map = new Map();
  for(const it of items){
    const key = normalizeTitle(it.title || it.link || '') || (it.asin || it.id || Math.random().toString(36).slice(2));
    const k = key.slice(0,80); // shorten
    if(!map.has(k)) map.set(k, {name: it.title || 'Product', stores: []});
    map.get(k).stores.push({store: it.store, price: it.price, image: it.image, link: it.link});
  }

  // compute best price
  const out = [];
  for(const [k,v] of map.entries()){
    const stores = v.stores.filter(s=>s.price!=null);
    stores.sort((a,b)=>a.price - b.price);
    const best = stores.length ? stores[0].price : null;
    const image = stores.find(s=>s.image)?.image || v.stores.find(s=>s.image)?.image || null;
    out.push({key:k,name:v.name,stores, bestPrice:best, image});
  }
  // sort by bestPrice ascending
  out.sort((a,b)=> (a.bestPrice || 1e9) - (b.bestPrice || 1e9));
  return out;
}

// ---------- Render ----------
function renderGroups(groups){
  resultsEl.innerHTML = '';
  for(const g of groups){
    const card = document.createElement('div');
    card.className = 'card';

    const topRow = document.createElement('div'); topRow.className='top-row';

    const img = document.createElement('img');
    img.src = g.image || 'https://via.placeholder.com/320x240?text=No+image';
    img.alt = g.name;

    const content = document.createElement('div');
    content.style.flex = '1';

    const title = document.createElement('h3');
    title.textContent = g.name;

    const meta = document.createElement('div');
    meta.style.marginTop='6px';
    meta.innerHTML = `Best: <strong class="price">${g.bestPrice ? g.bestPrice + ' AED' : 'N/A'}</strong>`;
    if(g.bestPrice) {
      const badge = document.createElement('span'); badge.className='best-badge'; badge.textContent='Best price';
      meta.appendChild(badge);
    }

    content.appendChild(title); content.appendChild(meta);

    topRow.appendChild(img); topRow.appendChild(content);
    card.appendChild(topRow);

    // stores
    const list = document.createElement('div'); list.className='store-list';
    if(g.stores.length===0) list.innerHTML = '<div class="note">No store data</div>';
    g.stores.forEach(s => {
      const row = document.createElement('div'); row.className='store-row';
      const info = document.createElement('div'); info.className='info';
      const storeName = document.createElement('div'); storeName.className='store-name'; storeName.textContent = s.store;
      const price = document.createElement('div'); price.className='price'; price.textContent = s.price ? (s.price + ' AED') : '—';
      info.appendChild(storeName);
      row.appendChild(info);

      const actions = document.createElement('div'); actions.className='actions';
      if(s.link){
        const btn = document.createElement('button'); btn.className='buy-btn'; btn.textContent='Buy';
        btn.onclick = ()=> window.open(s.link, '_blank');
        actions.appendChild(price); actions.appendChild(btn);
      } else {
        actions.appendChild(price);
      }
      row.appendChild(actions);
      list.appendChild(row);
    });

    card.appendChild(list);
    resultsEl.appendChild(card);
  }
}

// Initially run search once
runSearch();
