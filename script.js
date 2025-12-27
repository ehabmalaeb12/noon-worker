// UAE Price Hunter — combined compare (Amazon + SharafDG)
// IMPORTANT: Replace the worker URLs below with your real worker endpoints
const AMAZON_WORKER = "https://uae-price-proxy.ehabmalaeb2.workers.dev/search"; // <-- your amazon worker
const SHARAF_WORKER = "https://sharaf-worker.ehabmalaeb2.workers.dev/search";   // <-- your sharaf worker

// ----------------- UI --------------------------------
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const loadingEl = document.getElementById('loading');
const resultsEl = document.getElementById('searchResults');

let appState = { basket: [], points: 0 };

function loadState(){
  try{ appState.basket = JSON.parse(localStorage.getItem('uae_basket')||'[]'); appState.points = parseInt(localStorage.getItem('uae_points')||'0')||0 }catch(e){appState={basket:[],points:0}}
  updateUI();
}
function saveState(){ localStorage.setItem('uae_basket', JSON.stringify(appState.basket)); localStorage.setItem('uae_points', String(appState.points)); }
function awardPoints(n){ appState.points += n; saveState(); updateUI(); }
function updateUI(){ document.getElementById('basketCount').textContent = appState.basket.length; document.getElementById('totalPoints').textContent = appState.points }

searchBtn.addEventListener('click', runSearch);
searchInput.addEventListener('keydown', e => { if(e.key==='Enter') runSearch(); });

// ----------------- Helpers ---------------------------
function safeFetch(url){ return fetch(url).then(r=>r.json()).catch(e=>({ error: e.message })); }
function normalizeTitle(t){ if(!t) return ''; return t.toLowerCase().replace(/[^a-z0-9 ]+/g,'').replace(/\s+/g,' ').trim().slice(0,80); }

// ----------------- Main search -----------------------
async function runSearch(){
  const q = (searchInput.value||'').trim();
  resultsEl.innerHTML = '';
  if(!q){ resultsEl.innerHTML = '<p class="note">Please enter a product name.</p>'; return; }

  loadingEl.style.display = 'block';

  // fetch both sources in parallel; we tolerate failures
  const amazonUrl = `${AMAZON_WORKER}?q=${encodeURIComponent(q)}`;
  const sharafUrl = `${SHARAF_WORKER}?q=${encodeURIComponent(q)}`;

  const [aRes, sRes] = await Promise.allSettled([ safeFetch(amazonUrl), safeFetch(sharafUrl) ]);

  const amazonResults = aRes.status==='fulfilled' && Array.isArray(aRes.value.results) ? aRes.value.results : [];
  const sharafResults = sRes.status==='fulfilled' && Array.isArray(sRes.value.results) ? sRes.value.results : [];

  // unify shape: {title, price, currency, image, link, store}
  const unified = [];
  (amazonResults||[]).forEach(p => {
    unified.push({
      title: p.title || p.name || p.asin || '',
      price: (typeof p.price==='number') ? p.price : (p.price ? Number(p.price) : null),
      currency: p.currency||'AED',
      image: p.image||p.thumbnail||null,
      link: p.link||p.url||p.product_url||`https://www.amazon.ae/dp/${p.asin||''}`,
      store: p.store||'Amazon.ae'
    });
  });
  (sharafResults||[]).forEach(p => {
    unified.push({
      title: p.title || p.name || '',
      price: (typeof p.price==='number') ? p.price : (p.price ? Number(p.price) : null),
      currency: p.currency||'AED',
      image: p.image||null,
      link: p.link||p.url||'',
      store: p.store||'SharafDG'
    });
  });

  // filter out results without any price (we keep but won't use for best price)
  const priced = unified.filter(u=>u.price && !isNaN(u.price));
  if(priced.length===0){ loadingEl.style.display='none'; resultsEl.innerHTML = '<p class="note">No priced products found across selected stores.</p>'; return; }

  // grouping by normalized title (simple heuristic)
  const groups = new Map();
  for(const p of unified){
    const key = normalizeTitle(p.title);
    if(!key) continue;
    if(!groups.has(key)){
      groups.set(key, { title: p.title, image: p.image, stores: [], bestPrice: Number.POSITIVE_INFINITY, bestStore: null });
    }
    const g = groups.get(key);
    // prefer longer title (more descriptive)
    if((p.title||'').length > (g.title||'').length) g.title = p.title;
    if(!g.image && p.image) g.image = p.image;
    g.stores.push({ store: p.store, price: p.price, currency: p.currency, image: p.image, link: p.link });
    if(p.price && !isNaN(p.price) && p.price < g.bestPrice){ g.bestPrice = p.price; g.bestStore = p.store; }
  }

  // convert to array and sort by bestPrice asc
  const groupsArr = Array.from(groups.values()).filter(g=>g.bestPrice!==Number.POSITIVE_INFINITY);
  groupsArr.sort((a,b)=>a.bestPrice - b.bestPrice);

  // render grouped cards
  renderGrouped(groupsArr);
  loadingEl.style.display = 'none';
}

function renderGrouped(groups){
  resultsEl.innerHTML = '';
  if(groups.length===0){ resultsEl.innerHTML = '<p class="note">No comparable products found.</p>'; return; }

  groups.forEach(g => {
    const card = document.createElement('article');
    card.className = 'card';

    const imgWrap = document.createElement('div'); imgWrap.className = 'img';
    const img = document.createElement('img'); img.src = g.image || 'https://images.unsplash.com/photo-1556656793-08538906a9f8?w=800';
    img.alt = g.title; imgWrap.appendChild(img);

    const body = document.createElement('div'); body.className = 'body';
    const titleEl = document.createElement('div'); titleEl.className = 'title';
    titleEl.textContent = g.title;

    const badge = document.createElement('span'); badge.className = 'best-badge';
    badge.textContent = `Best: ${g.bestPrice} AED — ${g.bestStore}`;
    titleEl.appendChild(badge);

    // stores list
    const ul = document.createElement('ul'); ul.className = 'store-list';
    g.stores.forEach(s=>{
      const li = document.createElement('li'); li.className='store-row';
      const left = document.createElement('div'); left.innerHTML = `<div class='store-name'>${s.store}</div><div class='note'>${s.currency||'AED'}</div>`;
      const right = document.createElement('div'); right.innerHTML = `<div class='price'>${s.price? (s.price + ' AED') : '—'}</div>`;

      const actions = document.createElement('div'); actions.className='actions';
      const addBtn = document.createElement('button'); addBtn.className='button'; addBtn.textContent='Add';
      addBtn.onclick = ()=>{ addToBasket({title:g.title, store:s.store, price:s.price, link:s.link}); awardPoints(50); };
      const buyBtn = document.createElement('a'); buyBtn.className='button primary'; buyBtn.textContent='Buy'; buyBtn.href = s.link; buyBtn.target='_blank';
      actions.appendChild(addBtn); actions.appendChild(buyBtn);

      li.appendChild(left); li.appendChild(right); li.appendChild(actions);
      ul.appendChild(li);
    });

    body.appendChild(titleEl);
    body.appendChild(ul);
    body.appendChild(Object.assign(document.createElement('div'),{className:'note',textContent:'Click Buy to open the store (you pay the store directly).'}));

    card.appendChild(imgWrap); card.appendChild(body);
    resultsEl.appendChild(card);
  });
}

function addToBasket(item){ appState.basket.push(item); saveState(); updateUI(); alert('Added to basket'); }

// init
loadState();
console.log('UAE Price Hunter scripts ready');
