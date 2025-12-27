// script.js — frontend logic to query Amazon worker + Sharaf worker
// *** EDIT these two if your worker subdomains differ ***
const AMAZON_WORKER = 'https://shopping-worker.ehabmalaeb2.workers.dev';
const SHARAF_WORKER = 'https://sharaf-worker.ehabmalaeb2.workers.dev';

// DOM
const qInput = document.getElementById('q');
const searchBtn = document.getElementById('searchBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const logsEl = document.getElementById('logs');
const basketEl = document.getElementById('basket');
const pointsEl = document.getElementById('points');

let points = 10;
pointsEl.textContent = points;

// small helper logger
function log(...args){
  console.log(...args);
  const txt = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  logsEl.textContent += '\n' + txt;
  // scroll
  logsEl.scrollTop = logsEl.scrollHeight;
}

function setStatus(s){ statusEl.textContent = s; }

searchBtn.addEventListener('click', doSearch);
qInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') doSearch(); });

async function doSearch(){
  const q = (qInput.value || '').trim();
  if(!q){ setStatus('Please enter a search term'); return; }
  resultsEl.innerHTML = '';
  logsEl.textContent = `Start search: "${q}"\n`;
  setStatus('Searching stores…');
  log('Start search:', q);

  // kick both in parallel: amazon search and sharaf search
  const amazonPromise = fetchWithTimeout(`${AMAZON_WORKER}/search?q=${encodeURIComponent(q)}`, 20000)
    .then(r => r.json())
    .catch(e => { log('Amazon search fetch error', String(e)); return { error: String(e) }; });

  const sharafSearchPromise = fetchWithTimeout(`${SHARAF_WORKER}/search?q=${encodeURIComponent(q)}`, 20000)
    .then(r => r.json())
    .catch(e => { log('Sharaf search fetch error', String(e)); return { error: String(e) }; });

  const [amazonRes, sharafSearchRes] = await Promise.all([amazonPromise, sharafSearchPromise]);

  const collected = [];

  // 1) Amazon worker results: expect results array with price and image
  if(amazonRes && !amazonRes.error && (Array.isArray(amazonRes.results) && amazonRes.results.length)){
    log('Amazon results count', amazonRes.results.length);
    for(const item of amazonRes.results){
      // Normalise: ensure {title,price,currency,image,link,store}
      if(!item.price) continue;
      collected.push({
        store: item.store || 'Amazon.ae',
        title: item.title || item.name || '--',
        price: Number(item.price),
        currency: item.currency || 'AED',
        image: item.image || item.thumbnail || null,
        link: item.link || item.url || null
      });
    }
  } else {
    log('Amazon search had no usable results', amazonRes && amazonRes.debug ? amazonRes.debug : amazonRes);
  }

  // 2) Sharaf: sharafSearchRes.results expected to be list of links (or objects with link)
  let sharafLinks = [];
  if(sharafSearchRes && !sharafSearchRes.error && Array.isArray(sharafSearchRes.results)){
    sharafLinks = sharafSearchRes.results.map(r => (typeof r === 'string' ? r : (r.link || r.url))).filter(Boolean);
    log('Sharaf search links', sharafLinks.length);
  } else {
    log('No sharaf links', sharafSearchRes && sharafSearchRes.debug ? sharafSearchRes.debug : sharafSearchRes);
  }

  // For each sharaf link call product endpoint to get price/title/image
  const sharafDetails = [];
  if(sharafLinks.length){
    // limit to first 12 for speed
    const limited = sharafLinks.slice(0, 12);
    const productPromises = limited.map(link => {
      const u = `${SHARAF_WORKER}/product?url=${encodeURIComponent(link)}`;
      return fetchWithTimeout(u, 20000)
        .then(r => r.json())
        .catch(e => { log('Sharaf product fetch error', link, String(e)); return { error: String(e), link }; });
    });

    const products = await Promise.all(productPromises);
    for(const p of products){
      if(p && !p.error && p.price != null){
        sharafDetails.push({
          store: 'SharafDG',
          title: p.title || p.name || null,
          price: Number(p.price),
          currency: p.currency || 'AED',
          image: p.image || null,
          link: p.link || p.url || null
        });
      } else {
        log('Sharaf product missing price', p && p.link ? p.link : p);
      }
    }
    log('Sharaf priced from worker:', sharafDetails.length);
  }

  // merge results
  collected.push(...sharafDetails);

  if(!collected.length){
    setStatus('No priced products found across selected stores.');
    resultsEl.innerHTML = `<div class="empty">No priced products found across selected stores.</div>`;
    return;
  }

  // dedupe by (store + link) and keep lowest price for identical title maybe
  // Basic dedupe by link
  const mapByLink = new Map();
  collected.forEach(it => {
    const key = (it.link || it.title || Math.random()).toString();
    // if duplicate key, keep lower price
    if(mapByLink.has(key)){
      const prev = mapByLink.get(key);
      if(it.price < prev.price) mapByLink.set(key, it);
    } else {
      mapByLink.set(key, it);
    }
  });
  const merged = Array.from(mapByLink.values());

  // compute best price
  let bestIndex = 0;
  let bestPrice = merged[0].price;
  for(let i=1;i<merged.length;i++){
    if(merged[i].price < bestPrice){
      bestPrice = merged[i].price;
      bestIndex = i;
    }
  }

  // render
  resultsEl.innerHTML = '';
  merged.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.alt = it.title || 'product';
    img.src = it.image || 'https://via.placeholder.com/320x240?text=No+image';
    thumb.appendChild(img);
    card.appendChild(thumb);

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = it.title || '(no title)';
    if(idx === bestIndex){
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'Best price';
      title.appendChild(b);
    }
    card.appendChild(title);

    const storeRow = document.createElement('div');
    storeRow.className = 'store-row';
    const storeName = document.createElement('div');
    storeName.className = 'store';
    storeName.textContent = it.store || '';
    storeRow.appendChild(storeName);

    const priceRow = document.createElement('div');
    priceRow.className = 'price-row';
    const priceEl = document.createElement('div');
    priceEl.className = 'price';
    priceEl.textContent = `${it.price} ${it.currency || 'AED'}`;
    priceRow.appendChild(priceEl);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const viewBtn = document.createElement('a');
    viewBtn.className = 'btn';
    viewBtn.href = it.link || '#';
    viewBtn.textContent = `View on ${it.store}`;
    viewBtn.target = '_blank';
    actions.appendChild(viewBtn);

    priceRow.appendChild(actions);

    card.appendChild(priceRow);

    resultsEl.appendChild(card);
  });

  setStatus(`Found ${merged.length} priced product(s). Best: ${bestPrice} ${merged[bestIndex].currency||'AED'}`);
  log('Search finished, merged count', merged.length);
}

// small fetch helper with timeout
function fetchWithTimeout(url, ms = 12000){
  const controller = new AbortController();
  const id = setTimeout(()=> controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(()=> clearTimeout(id));
}
