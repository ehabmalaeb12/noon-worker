// script.js - combined frontend that queries Amazon worker + Sharaf worker
(() => {
  // workers (your deployed worker subdomains)
  const AMAZON_WORKER = "https://shopping-worker.ehabmalaeb2.workers.dev";
  const SHARAF_SEARCH = "https://sharaf-worker.ehabmalaeb2.workers.dev/search";
  const SHARAF_PRODUCT = "https://sharaf-worker.ehabmalaeb2.workers.dev/product";

  // DOM
  const $ = id => document.getElementById(id);
  const searchInput = $('searchInput');
  const searchBtn = $('searchBtn');
  const toggleDebug = $('toggleDebug');
  const loadingEl = $('loading');
  const resultsEl = $('searchResults');
  const debugPanel = $('debugPanel');

  // UI helpers
  function log(msg){ console.log(msg); if(debugPanel && debugPanel.style.display!=='none') debugPanel.textContent += (typeof msg==='string'?msg:JSON.stringify(msg)) + '\n'; }
  function setLoading(on, txt='Searching stores…'){ loadingEl.style.display = on ? 'block' : 'none'; loadingEl.textContent = txt; }
  function clear(){ resultsEl.innerHTML=''; if(debugPanel) debugPanel.textContent=''; }

  // fetch with abort/timeout
  function fetchWithTimeout(url, opts={}, timeout=12000){
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), timeout);
    opts.signal = ctrl.signal;
    return fetch(url, opts).finally(()=>clearTimeout(id));
  }

  // canonical title for grouping
  function canonicalTitle(s){
    if(!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9\s]+/g,' ').split(/\s+/).filter(w=>w.length>2).slice(0,7).join(' ').trim();
  }

  // concurrency helper
  async function runConcurrent(items, worker, concurrency=4){
    const out = new Array(items.length);
    let idx = 0;
    const runners = new Array(concurrency).fill(null).map(async ()=>{
      while(idx < items.length){
        const i = idx++;
        try{ out[i] = {ok:true, v: await worker(items[i], i)}; }
        catch(err){ out[i] = {ok:false, e:err && err.message ? err.message : String(err)}; }
      }
    });
    await Promise.all(runners);
    return out;
  }

  // render grouped offers
  function renderGroups(groups){
    resultsEl.innerHTML = '';
    if(!groups.length){ resultsEl.innerHTML = '<div class="no-results">No products with prices found.</div>'; return; }
    groups.forEach(g=>{
      const card = document.createElement('div'); card.className='card';
      const h = document.createElement('h2'); h.textContent = g.title; card.appendChild(h);
      const best = document.createElement('div'); best.innerHTML = `<span class="badge">${g.bestPrice? g.bestPrice + ' AED' : '—'}</span>`; card.appendChild(best);
      g.offers.forEach(o=>{
        if(o.price==null) return;
        const row = document.createElement('div'); row.className='store-row';
        const left = document.createElement('div'); left.className='store-left';
        const img = document.createElement('img'); img.src = o.image || 'https://via.placeholder.com/120x90?text=No+Image';
        const info = document.createElement('div'); info.className='store-info';
        const store = document.createElement('div'); store.className='store'; store.textContent = o.store || 'Store';
        const stitle = document.createElement('div'); stitle.className='stitle'; stitle.textContent = o.title || '';
        info.appendChild(store); info.appendChild(stitle);
        left.appendChild(img); left.appendChild(info);
        const right = document.createElement('div'); right.className='store-right';
        const price = document.createElement('div'); price.style.fontWeight='700'; price.style.color = (o.price === g.bestPrice) ? '#0b7a44' : '#111'; price.textContent = `${o.price} AED`;
        const anchor = document.createElement('a'); anchor.className='open-link'; anchor.target='_blank'; anchor.rel='noopener noreferrer'; anchor.href = o.link || '#'; anchor.textContent = `View on ${o.store || 'site'}`;
        right.appendChild(price); right.appendChild(anchor);
        row.appendChild(left); row.appendChild(right); card.appendChild(row);
      });
      resultsEl.appendChild(card);
    });
  }

  // group offers by canonical title
  function groupOffers(offers){
    const map = new Map();
    offers.forEach(o => {
      const key = canonicalTitle(o.title || o.link || o.store) || o.link;
      if(!map.has(key)) map.set(key, { title: o.title || '', offers: [] });
      map.get(key).offers.push(o);
    });
    const groups = Array.from(map.values()).map(g=>{
      const priced = g.offers.filter(x=>x.price!=null);
      const bestPrice = priced.length ? Math.min(...priced.map(x=>x.price)) : null;
      return { title: g.title || (g.offers[0] && g.offers[0].title) || 'Untitled', offers: g.offers, bestPrice };
    });
    groups.sort((a,b) => (a.bestPrice||1e9) - (b.bestPrice||1e9));
    return groups;
  }

  // main search routine
  async function doSearch(q){
    clear(); setLoading(true); log(`Start search: "${q}"`);
    const amazonUrl = `${AMAZON_WORKER}/search?q=${encodeURIComponent(q)}`;
    const sharafSearchUrl = `${SHARAF_SEARCH}?q=${encodeURIComponent(q)}`;
    log(`Query Amazon worker -> ${amazonUrl}`);
    log(`Query Sharaf search -> ${sharafSearchUrl}`);

    // parallel requests
    const [aP, sP] = await Promise.allSettled([
      fetchWithTimeout(amazonUrl, {}, 12000).catch(e=>{ throw new Error('Amazon search error: '+(e.message||e)); }),
      fetchWithTimeout(sharafSearchUrl, {}, 12000).catch(e=>{ throw new Error('Sharaf search error: '+(e.message||e)); })
    ]);

    let amazonItems = [], sharafLinks = [];

    if(aP.status === 'fulfilled'){
      try { const j = await aP.value.json(); amazonItems = j.results || []; log(`Amazon results count ${amazonItems.length}`); }
      catch(e){ log('Amazon parse error: '+e.message); }
    } else log('Amazon failed: '+(aP.reason && aP.reason.message));

    if(sP.status === 'fulfilled'){
      try { const j = await sP.value.json(); sharafLinks = (j.results||[]).map(r=>r.link).filter(Boolean); log(`Sharaf links count ${sharafLinks.length}`); }
      catch(e){ log('Sharaf parse error: '+e.message); }
    } else log('Sharaf search failed: '+(sP.reason && sP.reason.message));

    // fallback: if no sharaf links, query sharaf with top amazon titles
    if(sharafLinks.length === 0 && amazonItems.length){
      log('No links from sharaf search — trying fallback queries from Amazon titles');
      const topTitles = amazonItems.slice(0,5).map(x=>x.title).filter(Boolean);
      for(const t of topTitles){
        try{
          const u = `${SHARAF_SEARCH}?q=${encodeURIComponent(t)}`;
          log('Fallback searching: '+t);
          const r = await fetchWithTimeout(u, {}, 9000);
          const js = await r.json();
          const links = (js.results||[]).map(rr=>rr.link).filter(Boolean);
          log(` -> ${links.length} links`);
          sharafLinks.push(...links);
        }catch(e){ log('fallback error: '+(e && e.message)); }
      }
      sharafLinks = Array.from(new Set(sharafLinks));
      log(`Fallback sharaf links count ${sharafLinks.length}`);
    }

    // collect offers
    const offers = [];

    // add amazon offers
    amazonItems.forEach(it => {
      const price = (typeof it.price === 'number') ? it.price : (it.price ? parseFloat(String(it.price).replace(/[^\d.]/g,'')) : null);
      offers.push({ title: it.title||'', price: isFinite(price)?price:null, image: it.image||null, link: it.link||null, store: it.store||'Amazon.ae' });
    });

    // add sharaf product details (concurrent)
    if(sharafLinks.length){
      log(`Fetching Sharaf product details (${sharafLinks.length})`);
      const fetchOne = async (link) => {
        const url = `${SHARAF_PRODUCT}?url=${encodeURIComponent(link)}`;
        const r = await fetchWithTimeout(url, {}, 20000); // extra time
        const j = await r.json();
        return { title: j.title||'', price: (typeof j.price==='number')?j.price:(j.price?parseFloat(String(j.price).replace(/[^\d.]/g,'')):null), image: j.image||null, link: j.link||link, store: j.store||'SharafDG' };
      };
      const results = await runConcurrent(sharafLinks, fetchOne, 4);
      results.forEach((res, i)=>{
        if(res.ok && res.v) offers.push(res.v);
        else log('Sharaf product failed for '+sharafLinks[i]+' -> '+(res.e||'error'));
      });
    }

    // dedupe and finalize
    const seen = new Set();
    const finalOffers = offers.filter(o=>{
      const id = (o.store||'')+'|'+(o.link||'')+'|'+(o.title||'');
      if(seen.has(id)) return false; seen.add(id); return true;
    });

    log('Search finished, merged count '+finalOffers.length);
    setLoading(false);

    // render grouped offers
    const priced = finalOffers.filter(x => x.price!=null && !isNaN(x.price));
    if(!priced.length){ renderGroups([]); return; }
    const groups = groupOffers(finalOffers);
    renderGroups(groups);
  }

  // wire UI
  searchBtn.addEventListener('click', ()=>{ const q = (searchInput.value||'').trim(); if(!q) return; doSearch(q).catch(e=>{ log('Search error: '+e.message); setLoading(false); }); });
  toggleDebug.addEventListener('click', ()=>{ if(!debugPanel) return; debugPanel.style.display = debugPanel.style.display==='none'?'block':'none'; });

  // initial
  window.addEventListener('load', ()=>{ const v=(searchInput.value||'').trim(); if(v) setTimeout(()=>searchBtn.click(), 250); });
})();
