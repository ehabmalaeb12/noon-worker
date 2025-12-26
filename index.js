// index.js
const express = require("express");
const fetch = require("node-fetch");
const { chromium } = require("playwright"); // uses playwright in Docker image
const app = express();

const PORT = process.env.PORT || 8080;
const CACHE_TTL = process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL) : 60; // seconds
const USE_HEADLESS_PROXY = process.env.USE_HEADLESS_PROXY === "1"; // optional

// simple in-memory cache
const cache = new Map();
function setCache(key, value) {
  cache.set(key, { value, ts: Date.now() });
}
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if ((Date.now() - entry.ts) / 1000 > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Try Noon internal JSON endpoint (fast). If it returns a products array -> parse and return.
 * If not, fallback to headless Playwright render.
 */
app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "Missing query parameter ?q=" });
  }

  const cacheKey = `noon:${q.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) {
    cached.debug.cached = true;
    return res.json(cached);
  }

  const debug = { tried: [], timestamp: new Date().toISOString() };

  // 1) Try noon internal API (may be blocked or return HTML)
  try {
    const apiUrl =
      "https://www.noon.com/_svc/search_v2?category=&limit=48&page=1&q=" +
      encodeURIComponent(q) +
      "&sort%5Bby%5D=relevance&sort%5Border%5D=desc";

    debug.tried.push({ method: "internal_api", url: apiUrl, ts: Date.now() });

    const apiResp = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-AE,en;q=0.9",
        Referer: "https://www.noon.com/",
        Origin: "https://www.noon.com",
      },
      // 8s timeout
      timeout: 8000,
    });

    const contentType = apiResp.headers.get("content-type") || "";
    const text = await apiResp.text();

    // some endpoints respond with JSON string or HTML; try to parse
    let jsonBody = null;
    if (contentType.includes("application/json")) {
      try { jsonBody = JSON.parse(text); } catch(e){ jsonBody = null; }
    } else {
      // try parse JSON inside text if exists
      try {
        jsonBody = JSON.parse(text);
      } catch (e) {
        jsonBody = null;
      }
    }

    if (jsonBody && (jsonBody.products || jsonBody.data?.products)) {
      const productList = jsonBody.products || jsonBody.data?.products || [];
      const results = productList.map(p => {
        // noon's product shape varies; attempt safe mappings
        const priceObj = p.price || p.sale_price || p.regular_price || {};
        const price = priceObj.value || p.price_including_tax || p.price_value || null;
        const currency = priceObj.currency || "AED";
        const imageKey = p.image_key || p.image || null;
        const image = imageKey
          ? (`https://z.nooncdn.com/products/tr:n-t_240/${imageKey}.jpg`)
          : (p.images && p.images[0]) || null;
        const url = p.url ? `https://www.noon.com/uae-en/${p.url}` : (p.productUrl || null);

        return {
          store: "Noon",
          id: p.sku || p.product_id || p.id || (p.slug ? p.slug : null),
          title: p.name || p.title || null,
          price: price ? Number(price) : null,
          currency,
          image,
          link: url,
          raw: p
        };
      }).filter(r => r.title && (r.price || r.price === 0)); // remove items without title or price if you choose

      const out = {
        query: q,
        count: results.length,
        results,
        debug: { ...debug, source: "internal_api" }
      };
      setCache(cacheKey, out);
      return res.json(out);
    } else {
      debug.tried.push({ method: "internal_api_no_products", htmlLength: text.length });
    }
  } catch (err) {
    debug.tried.push({ method: "internal_api_error", message: err.message });
  }

  // 2) FALLBACK: Playwright headless render (reliable)
  // Note: Playwright launch is somewhat heavy; keep this as fallback only.
  try {
    debug.tried.push({ method: "playwright_start", ts: Date.now() });

    const launchOptions = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    };

    // optional: if you have a proxy for headless, set env PROXY_URL and USE_HEADLESS_PROXY=1
    if (USE_HEADLESS_PROXY && process.env.PROXY_URL) {
      launchOptions.proxy = { server: process.env.PROXY_URL }; // e.g. http://username:pass@proxy:port
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      viewport: { width: 1200, height: 900 },
      locale: "en-AE"
    });
    const page = await context.newPage();

    const targetUrl = `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(q)}`;
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Wait for a product container; try multiple selectors to be robust
    const selectors = [
      '[data-qa="product-list-item"]',
      '[data-qa="product-item"]',
      '.productCard',
      'div[itemprop="itemListElement"]',
      '.sc-',
      'a[href*="/p/"]'
    ];

    let productElements = [];
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 4000 });
        productElements = await page.$$eval(sel, nodes => nodes.map(n => n.outerHTML));
        if (productElements && productElements.length > 0) break;
      } catch (e) {
        // try next selector
      }
    }

    // If still empty, grab generic product anchors
    if (productElements.length === 0) {
      productElements = await page.$$eval('a[href*="/p/"]', nodes => nodes.slice(0, 48).map(n => n.closest('div') ? n.closest('div').outerHTML : n.outerHTML));
    }

    // Extract product items by querying DOM directly for each visible product box
    const products = await page.$$eval(
      'a[href*="/p/"], [data-qa="product-list-item"], [data-qa="product-item"], .productCard',
      anchors => {
        const seen = new Set();
        const out = [];
        anchors.slice(0, 48).forEach(a => {
          // get root element container
          const box = a.closest('a') || a;
          // title
          const titleEl = box.querySelector('h3, h4, .productTitle, .sc-') || box.querySelector('[data-qa="product-name"]') || box.querySelector('img[alt]');
          const title = titleEl ? (titleEl.innerText || titleEl.getAttribute('alt') || "").trim() : null;
          // price
          let price = null;
          const pw = box.querySelector('.price, .salePrice, [data-qa="product-price"], .amount, .priceValue, .priceSpan');
          if (pw) {
            price = pw.innerText.replace(/[^\d.,]/g, '').replace(',', '.').trim();
          } else {
            // try find numbers in text
            const txt = box.innerText || "";
            const m = txt.match(/([\d{1,3},]*\d+(\.\d+)?)/);
            price = m ? m[1].replace(',', '') : null;
          }
          // image
          const img = box.querySelector('img') ? (box.querySelector('img').getAttribute('src') || box.querySelector('img').getAttribute('data-src')) : null;
          // link
          const link = (box.querySelector('a') && box.querySelector('a').href) || (box.href || null);

          // an id candidate
          const id = box.getAttribute('data-sku') || box.getAttribute('data-id') || (link ? link.split('/p/').pop() : null);

          if (!title) return;
          const numericPrice = price ? Number(price.toString().replace(/,/g, '').replace(/[^0-9.]/g, '')) : null;
          const key = title + (numericPrice || '');
          if (seen.has(key)) return;
          seen.add(key);

          out.push({
            store: "Noon",
            id,
            title: title,
            price: numericPrice,
            currency: "AED",
            image: img,
            link
          });
        });
        return out;
      }
    );

    await browser.close();

    // Filter & normalize
    const results = products.filter(p => p.title && (p.price || p.price === 0)).slice(0, 48);

    const out = {
      query: q,
      count: results.length,
      results,
      debug: { ...debug, source: "playwright", targetUrl, found: results.length }
    };

    setCache(cacheKey, out);
    return res.json(out);
  } catch (err) {
    debug.tried.push({ method: "playwright_error", message: err.message });
    return res.status(500).json({ query: q, count: 0, results: [], debug });
  }
});

app.get("/", (req, res) => res.send("Noon Scraper service - GET /search?q=<term>"));

app.listen(PORT, () => {
  console.log(`Noon scraper listening on ${PORT}`);
});
