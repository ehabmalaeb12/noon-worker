const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------ HEALTH CHECK ------------------ */
app.get("/health", (_, res) => {
  res.json({ ok: true });
});

/* ------------------ SEARCH ------------------ */
app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Missing ?q=" });
  }

  const debug = { tried: [] };

  /* ---------- Attempt 1: Noon internal API ---------- */
  try {
    const apiUrl = `https://www.noon.com/_svc/search_v2?q=${encodeURIComponent(query)}&limit=10&page=1`;
    debug.tried.push({ method: "internal_api_attempt", url: apiUrl });

    const apiRes = await fetch(apiUrl, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "application/json"
      }
    });

    const json = await apiRes.json();

    const products =
      json?.products ||
      json?.data?.products ||
      json?.result?.products ||
      [];

    if (products.length) {
      return res.json({
        query,
        count: products.length,
        results: products,
        source: "internal_api",
        debug
      });
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
      args: ["--no-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto(
      `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    const products = await page.evaluate(() => {
      return [...document.querySelectorAll('[data-qa="product-item"]')]
        .map(el => ({
          title: el.querySelector("h2")?.innerText,
          price: el.querySelector('[data-qa="price"]')?.innerText
        }))
        .filter(p => p.title);
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

  return res.json({ query, count: 0, results: [], debug });
});

/* ------------------ START SERVER ------------------ */
app.listen(PORT, () => {
  console.log(`🚀 noon-worker running on port ${PORT}`);
});
