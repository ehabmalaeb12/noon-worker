// CONFIG - change if needed
const AMAZON_WORKER = 'https://shopping-worker.ehabmalaeb2.workers.dev';
const SHARAF_WORKER = 'https://sharaf-worker.ehabmalaeb2.workers.dev';

// DOM
const qInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const logsEl = document.getElementById('logs');

searchBtn.addEventListener('click', () => doSearch());
qInput.addEventListener('keydown', e => e.key === 'Enter' && doSearch());

function log(...args){
  logsEl.textContent += args.join(' ') + '\n';
}

function clearLog(){ logsEl.textContent = '' }
function setStatus(s){ statusEl.textContent = s }

// tiny fetch with timeout
async function fetchJson(url, opts = {}, t = 12000){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), t);
  try {
    const res = await fetch(url, {...opts, signal: ctrl.signal});
    clearTimeout(id);
    return await res.json();
  } catch(e){
    clearTimeout(id);
    throw e;
  }
}

// limit concurrency for product fetches
async function pmap(items, fn, concurrency = 4){
  const out = [];
  let i = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async ()=>{
    while(true){
      const idx = i++;
      if (idx >= items.length) break;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch(err){
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

async function doSearch(){
  const q = qInput.value.trim();
  if (!q) return;
  resultsEl.innerHTML = '';
  clearLog();
  setStatus('Searching Amazon & SharafDG...');
  log(`Start search: "${q}"`);

  // 1. get Amazon results
  let amazon = [];
  try {
    const url = `${AMAZON_WORKER}/search?q=${encodeURIComponent(q)}`;
    log('Query Amazon worker ->', url);
    const json = await fetchJson(url, {}, 15000);
    amazon = json.results || [];
    log('Amazon results count', amazon.length);
  } catch(e){
    log('Amazon fetch error', e.message || e);
  }

  // 2. get Sharaf links via sharaf-worker /search?q=
  let sharafLinks = [];
  try {
    const url = `${SHARAF_WORKER}/search?q=${encodeURIComponent(q)}`;
    log('Query Sharaf search worker ->', url);
    const json = await fetchJson(url, {}, 15000);
    sharafLinks = (json.results || []).map(r => r.link).filter(Boolean);
    log('Sharaf links count', sharafLinks.length);
  } catch(e){
    log('Sharaf search fetch error', e.message || e);
  }

  // 3. if sharafLinks empty, try a fallback: search using Amazon titles (take first N)
  if (!sharafLinks.length && amazon.length){
    log('No links from sharaf search — generating fallback queries from Amazon titles');
    // prepare candidate search URLs on sharaf site by title
    const candidates = amazon.slice(0,6).map(a => `https://uae.sharafdg.com/search?q=${encodeURIComponent(a.title)}`);
    // attempt calling sharaf /search for those queries via the worker (some workers may accept product search urls)
    for (const c of candidates){
      try {
        const res = await fetchJson(`${SHARAF_WORKER}/search?q=${encodeURIComponent(c.split('?q=')[1]||'')}`, {}, 12000);
        const links = (res.results||[]).map(r=>r.link).filter(Boolean);
        if (links.length) {
          sharafLinks.push(...links);
          log('Found sharaf links via fallback for', c, '=>', links.length);
          if (sharafLinks.length >= 6) break;
        }
      } catch(e){
        // ignore
      }
    }
    sharafLinks = Array.from(new Set(sharafLinks));
    log('Fallback sharaf links count', sharafLinks.length);
  }

  // 4. fetch product details for each sharaf link (concurrent)
  let sharafProducts = [];
  if (sharafLinks.length){
    log('Fetching sharaf product details (parallel)...');
    const details = await pmap(sharafLinks.slice(0,8), async (link) => {
      try {
        const url = `${SHARAF_WORKER}/product?url=${encodeURIComponent(link)}`;
        const j = await fetchJson(url, {}, 15000);
        // normalize
        if (j && (j.title || j.price)) {
          return {
            store: 'SharafDG',
            title: j.title || null,
            price: j.price || null,
            currency: j.currency || 'AED',
            image: j.image || null,
            link: j.link || link
          };
        }
        return null;
      } catch(e){
        log('Sharaf product fetch error for', link, e.message || e);
        return null;
      }
    }, 4);
    sharafProducts = (details || []).filter(Boolean);
    log('Sharaf priced from worker:', sharafProducts.length);
  }

  // 5. merge amazon + sharaf
  let combined = [];
  // Use Amazon items (with price) first
  combined.push(...(amazon || []).map(a=>({
    store: 'Amazon.ae',
    title: a.title,
    price: a.price,
    image: a.image,
    link: a.link
  })));
  // append sharaf
  combined.push(...sharafProducts);

  // dedupe & group: naive normalization
  const normalize = s => (s||'').toString().toLowerCase().replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();
  const grouped = {};
  combined.forEach(item => {
    const key = normalize(item.title).split(' ').slice(0,6).join(' ');
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });

  // prepare final display array: for each group choose items, mark best price
  const final = [];
  Object.keys(grouped).forEach(k => {
    const items = grouped[k];
    // filter only those with numeric price
    const priced = items.filter(i => typeof i.price === 'number' && !isNaN(i.price));
    const bestPrice = priced.length ? Math.min(...priced.map(p=>p.price)) : null;
    items.forEach(it=>{
      final.push({...it, bestPrice});
    });
  });

  // If nothing priced, still show Amazon items (maybe no price) and sharaf items too
  if (!final.length && combined.length){
    final.push(...combined);
  }

  render(final);
  setStatus(`Search finished, merged count ${final.length}`);
  log('Search finished, merged count', final.length);
}

function render(items){
  resultsEl.innerHTML = '';
  if (!items.length){
    resultsEl.innerHTML = `<div style="padding:16px;color:#6b7280">No priced products found across selected stores.</div>`;
    return;
  }

  // show cards
  items.forEach(it=>{
    const card = document.createElement('div');
    card.className = 'card';
    const img = it.image ? `<img src="${it.image}" alt="">` : `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#9aa3b2">No image</div>`;
    const best = (it.bestPrice && it.price === it.bestPrice) ? `<span class="badge">Best price</span>` : '';
    card.innerHTML = `
      <div class="thumb">${img}</div>
      <div class="title">${escapeHtml(it.title||'Untitled')}${best}</div>
      <div class="price-row">
        <div class="price">${it.price?it.price+' AED':'—'}</div>
        <a class="btn" href="${it.link||'#'}" target="_blank">View on ${it.store}</a>
      </div>
    `;
    resultsEl.appendChild(card);
  });
}

// small escape
function escapeHtml(s){ return (s||'').replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
