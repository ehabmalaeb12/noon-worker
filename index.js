// index.js (CommonJS)
const express = require('express');
const fetch = require('node-fetch');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

// helper to safe JSON parse
function safeJson(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

// deep search helper to find an array with product-like objects
function findProducts(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    // heuristics: array of objects with name/title and maybe price
    if (obj.length && typeof obj[0] === 'object') {
      const sample = obj[0];
      const hasName = 'name' in sample || 'title' in sample || 'productName' in sample;
      const hasPrice = 'price' in sample || 'sellingPrice' in sample || sample.price && typeof sample.price === 'object';
      if (hasName || hasPrice) return obj;
    }
    for (const item of obj) {
      const found = findProducts(item);
      if (found) return found;
    }
    return null;
  }
  for (const k of Object.keys(obj)) {
    try {
      const found = findProducts(obj[k]);
      if (found) return found;
    } catch (e) { continue; }
  }
  return null;
}

// normalize Noon-ish product objects into our result shape
function normalizeFromObj(p) {
  const title = p.name || p.title || p.productName || null;

  let price = null;
  if (p.price && typeof p.price === 'object') {
    price = p.price.displayPrice || p.price.value || p.price.amount || null;
  } else if (p.sellingPrice) {
    price = p.sellingPrice;
  } else if (p.price) {
    price = p.price;
  }

  const image = p.image_key
    ? `https://z.nooncdn.com/products/tr:n-t_240/${p.image_key}.jpg`
    : (p.image || p.thumbnail || null);

  const url = p.url
    ? `https://www.noon.com/uae-en/${p.url}`
    : (p.link || p.product_url || null);

  return {
    store: 'noon',
    title,
    price: price === undefined ? null : price,
    currency: 'AED',
    image,
    url
  };
}

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing query parameter ?q=' });

  const debug = { tried: [] };

  // 1) Try Noon internal API endpoint (fast if available)
  try {
    const apiUrl = `https://www.noon.com/_svc/search_v2?category=&limit=48&page=1&q=${encodeURIComponent(q)}&sort%5Bby%5D=relevance&sort%5Border%5D=desc`;
    debug.tried.push({ method: 'internal_api_attempt', url: apiUrl, ts: Date.now() });

    const r = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.noon.com/',
      },
      timeout: 20000
    });
    const text = await r.text();
    const json = safeJson(text);
    if (json && Array.isArray(json.products) && json.products.length) {
      debug.tried.push({ method: 'internal_api_success', status: r.status, products: json.products.length });
      const results = json.products.map(normalizeFromObj);
      return res.json({ query: q, count: results.length, results, debug });
    } else {
      debug.tried.push({ method: 'internal_api_no_products', status: r.status, sampleLength: text.length });
    }
  } catch (err) {
    debug.tried.push({ method: 'internal_api_error', message: err.message });
  }

  // 2) Try fetching the public search page HTML and extract __NEXT_DATA__ or window.__NEXT_DATA__
  try {
    const targetUrl = `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(q)}`;
    debug.tried.push({ method: 'fetch_html_attempt', url: targetUrl, ts: Date.now() });

    const r2 = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.noon.com/'
      },
      timeout: 30000
    });
    const html = await r2.text();
    debug.tried.push({ method: 'fetch_html_done', status: r2.status, length: html.length });

    // 2a. Look for <script id="__NEXT_DATA__">...</script>
    let nextData = null;
    const idMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (idMatch && idMatch[1]) {
      nextData = safeJson(idMatch[1]);
      debug.tried.push({ method: 'found_next_data_script', length: idMatch[1].length });
    } else {
      // 2b. Look for window.__NEXT_DATA__ = {...}
      const winMatch = html.match(/window\.__NEXT_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/i) || html.match(/window\.__NEXT_DATA__\s*=\s*({[\s\S]*?});/i);
      if (winMatch && winMatch[1]) {
        nextData = safeJson(winMatch[1]);
        debug.tried.push({ method: 'found_window_next_data', length: winMatch[1].length });
      } else {
        // 2c: Next may inline JSON in a <script> tag without id; try to find "__N_SSG" or "props:{" patterns
        debug.tried.push({ method: 'next_data_not_found_in_html' });
      }
    }

    if (nextData) {
      // deep search for products array
      const productsArray = findProducts(nextData);
      if (productsArray && productsArray.length) {
        debug.tried.push({ method: 'next_data_products_found', count: productsArray.length });
        const results = productsArray.map(normalizeFromObj);
        return res.json({ query: q, count: results.length, results, debug });
      } else {
        // Not found as top-level array; perhaps deeper (search for nested)
        debug.tried.push({ method: 'next_data_no_products_array', sampleKeys: Object.keys(nextData || {}).slice(0,8) });
      }
    }
  } catch (err) {
    debug.tried.push({ method: 'fetch_html_error', message: err.message });
  }

  // 3) Playwright fallback: render the page and scrape visible product cards
  let browser = null;
  try {
    debug.tried.push({ method: 'playwright_start', ts: Date.now() });
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      viewport: { width: 1200, height: 900 },
      locale: 'en-US'
    });
    const page = await context.newPage();

    const searchUrl = `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(q)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // try to auto-accept cookie / continue buttons
    try {
      await page.$$eval('button', (buttons) => {
        const texts = ['continue', 'accept', 'agree', 'ok', 'allow'];
        for (const b of buttons) {
          const t = (b.innerText || '').toLowerCase();
          if (texts.some(x => t.includes(x))) { b.click(); break; }
        }
      });
    } catch (e) {}

    // Wait for product nodes - try several common selectors
    const selectors = [
      'div[data-qa="product-card"]',
      'article',
      'div[data-testid*="product"]',
      'a[href*="/p/"]',
      'a[href*="/product/"]',
      '.productCard'
    ];
    let nodes = null;
    for (const sel of selectors) {
      try {
        nodes = await page.$$(sel);
        if (nodes && nodes.length) break;
      } catch (e) {}
    }

    // Scrape visible product cards (robust)
    const scraped = await page.$$eval('div[data-qa="product-card"], article, a[href*="/p/"], a[href*="/product/"]', (nodes) => {
      const out = [];
      for (const n of nodes.slice(0,80)) {
        try {
          const anchor = n.tagName === 'A' ? n : (n.querySelector('a') || n);
          const link = anchor && anchor.href ? anchor.href : null;
          const img = (n.querySelector('img') && (n.querySelector('img').src || n.querySelector('img').getAttribute('data-src'))) || null;
          const titleEl = n.querySelector('h3') || n.querySelector('h2') || n.querySelector('[data-qa="product-name"]') || n.querySelector('span');
          const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : null;
          // price heuristics
          let price = null;
          const priceEl = n.querySelector('[data-qa="selling-price"], [data-qa="product-price"], .price, .sellingPrice, .prc');
          if (priceEl && priceEl.innerText) {
            const t = priceEl.innerText.replace(/[^\d.,]/g,'').trim();
            if (t) price = parseFloat(t.replace(/,/g,''));
          } else {
            const txt = (n.innerText || '').match(/(\d{1,3}(?:[,\d]{0,})\.\d{1,2})/);
            if (txt) price = parseFloat(txt[1].replace(/,/g,''));
          }
          out.push({ title, price, image: img, link });
        } catch (e) { continue; }
      }
      return out;
    });

    // dedupe and normalize
    const seen = new Set();
    for (const p of scraped) {
      if (!p.link || seen.has(p.link)) continue;
      seen.add(p.link);
      if (!p.title && !p.price) continue;
      results.push({
        store: 'noon',
        title: p.title,
        price: p.price || null,
        currency: 'AED',
        image: p.image,
        url: p.link
      });
    }

    await context.close();
    await browser.close();
    debug.tried.push({ method: 'playwright_done', scraped: results.length });
    return res.json({ query: q, count: results.length, results, debug });
  } catch (err) {
    if (browser) { try { await browser.close(); } catch(e) {} }
    debug.tried.push({ method: 'playwright_error', message: err.message });
    return res.status(200).json({ query: q, count: 0, results: [], debug });
  }
});

app.listen(PORT, () => {
  console.log(`noon-worker listening on ${PORT}`);
});
