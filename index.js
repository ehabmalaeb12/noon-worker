const express = require("express");
const fetch = require("node-fetch");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------ HEALTH CHECK ------------------ */
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

/* ------------------ SEARCH ------------------ */
app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter ?q=" });
  }

  const debug = { tried: [] };

  /* ---------- Attempt 1: Noon internal API ---------- */
  try {
    const apiUrl =
      `https://www.noon.com/_svc/search_v2?q=${encodeURIComponent(query)}&limit=10&page=1`;

    debug.tried.push({ method: "internal_api_attempt", url: apiUrl });

    const apiRes = await fetch(apiUrl, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "application/json"
      },
      timeout: 10000
    });

    const text = await apiRes.text();

    if (text.startsWith("{")) {
      const json = JSON.parse(text);
      if (json?.products?.length) {
        return res.json({
          query,
          count: json.products.length,
          results: json.products,
          source: "internal_api",
          debug
        });
      }
    }

    debug.tried.push({ method: "internal_api_no_products" });
  } catch (e) {
    debug.tried.push({ method: "internal_api_error", message: e.message });
  }

  /* ---------- Attempt 2: Playwright ---------- */
  let browser;
  try {
    debug.tried.push({ method: "playwright_start" });

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto(
      `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    const products = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('[data-qa="product-item"]').forEach(el => {
        const title = el.querySelector("h2")?.innerText;
        const price = el.querySelector('[data-qa="price"]')?.innerText;
        if (title) items.push({ title, price });
      });
      return items;
    });

    await browser.close();

    return res.json({
      query,
      count: products.length,
      results: products,
      source: "playwright",
      debug
    });

  } catch (e) {
    if (browser) await browser.close();
    debug.tried.push({ method: "playwright_error", message: e.message });
  }

  return res.json({
    query,
    count: 0,
    results: [],
    debug
  });
});

/* ------------------ START SERVER ------------------ */
app.listen(PORT, () => {
  console.log(`🚀 noon-worker running on port ${PORT}`);
});
