// index.js (CommonJS)
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/search", async (req, res) => {
  const query = (req.query.q || "").trim();
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter ?q=" });
  }

  // Primary attempt: Noon internal JSON endpoint (fast when accessible)
  const noonApi =
    "https://www.noon.com/_svc/search_v2?category=&limit=48&page=1&q=" +
    encodeURIComponent(query) +
    "&sort%5Bby%5D=relevance&sort%5Border%5D=desc";

  const debug = { tried: [], timestamp: new Date().toISOString() };

  try {
    debug.tried.push({ method: "fetch_internal_api", url: noonApi, ts: Date.now() });
    // Node (18+) in Playwright image provides global fetch — we use it
    const r = await fetch(noonApi, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1",
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.noon.com/",
        origin: "https://www.noon.com",
      },
      // timeout behavior will be bound by platform; we catch slow responses below
    });

    const contentType = r.headers.get("content-type") || "";
    debug.internal_status = r.status;
    debug.internal_content_type = contentType;

    // If noon returns JSON with a products key, parse
    if (contentType.includes("application/json")) {
      const data = await r.json();
      debug.internal_json_keys = Object.keys(data || {});
      const products = data?.products || data?.results || null;

      if (Array.isArray(products) && products.length > 0) {
        const results = products.map((p) => {
          const title = p.name || p.title || null;
          const price = (() => {
            if (p.price && typeof p.price === "number") return p.price;
            if (p.price && p.price.value) return Number(p.price.value) || null;
            if (p.final_price) return Number(p.final_price) || null;
            return null;
          })();
          const image = p.image_key
            ? `https://z.nooncdn.com/products/tr:n-t_240/${p.image_key}.jpg`
            : p.image || null;
          const url = p.url ? `https://www.noon.com/uae-en/${p.url}` : null;
          return {
            store: "noon",
            title,
            price,
            currency: "AED",
            image,
            url,
            raw: p,
          };
        });

        // Remove items without price if you want (the worker previously dropped them)
        const filtered = results.filter((r) => r.price !== null && r.price !== undefined);

        return res.json({
          query,
          count: filtered.length,
          results: filtered,
          debug,
        });
      } else {
        debug.msg = "No products key / empty products array in JSON response";
      }
    } else {
      // content-type was not JSON (likely HTML or blocked)
      debug.msg = "internal API did not return JSON";
      debug.sampleHtmlLength = (await r.text()).length;
    }
  } catch (err) {
    debug.internal_error = err && (err.message || String(err));
  }

  // Secondary attempt (playwright scraping) - only run when internal API fails
  debug.tried.push({ method: "playwright_attempt_start", ts: Date.now() });

  try {
    // require playwright lazily (playwright is installed in Docker image)
    const playwright = require("playwright");
    const browser = await playwright.chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" });

    const searchUrl = `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(query)}`;
    debug.playwright_url = searchUrl;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for product grid or a reasonable timeout
    await page.waitForTimeout(2000); // short sleep; adjust as needed

    // Basic product selector — we'll extract titles/prices/images/links
    const items = await page.$$eval("[data-qa='product-card'], .productContainer, [data-testid='product-card']", (nodes) =>
      nodes.map((n) => {
        // pick common fields
        const titleEl = n.querySelector("h3, .productTitle, .title, [data-qa='product-name']");
        const priceEl = n.querySelector(".price, .final-price, [data-qa='product-price']");
        const imgEl = n.querySelector("img");
        const linkEl = n.querySelector("a");

        return {
          title: titleEl ? titleEl.innerText.trim() : null,
          priceText: priceEl ? priceEl.innerText.trim() : null,
          image: imgEl ? imgEl.src : null,
          url: linkEl ? linkEl.href : null,
        };
      })
    );

    await browser.close();

    // Try to parse prices (simple digits filter)
    const parsed = items
      .map((it) => {
        if (!it.title) return null;
        const priceMatch = (it.priceText || "").replace(/[,ٰ،]/g, "").match(/(\d+(\.\d+)?)/);
        const price = priceMatch ? Number(priceMatch[0]) : null;
        return {
          store: "noon",
          title: it.title,
          price,
          currency: price ? "AED" : null,
          image: it.image,
          url: it.url,
        };
      })
      .filter(Boolean)
      .filter((r) => r.price !== null);

    debug.playwright_found = parsed.length;
    return res.json({
      query,
      count: parsed.length,
      results: parsed,
      debug,
    });
  } catch (err) {
    debug.playwright_error = (err && (err.message || String(err))) || "playwright failed";
  }

  // If both attempts failed, return the debug details so we can iterate
  return res.json({
    query,
    count: 0,
    results: [],
    debug,
  });
});

app.listen(PORT, () => {
  console.log(`noon-worker listening on ${PORT}`);
});
