// index.js
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// basic root check
app.get("/", (req, res) => {
  res.send("Noon worker up. Use /search?q=iphone");
});

/**
 * /search?q=...
 * Uses Noon frontend JSON endpoint `/ _svc/search_v2`
 */
app.get("/search", async (req, res) => {
  const query = (req.query.q || "").trim();
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter ?q=" });
  }

  const apiUrl =
    "https://www.noon.com/_svc/search_v2?category=&limit=24&page=1&q=" +
    encodeURIComponent(query) +
    "&sort%5Bby%5D=relevance&sort%5Border%5D=desc";

  try {
    const start = Date.now();
    const response = await fetch(apiUrl, {
      headers: {
        // use a realistic mobile browser UA + origin/referer to avoid trivial blocks
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1",
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.noon.com/",
        origin: "https://www.noon.com",
      },
      // no credentials
    });

    // if the endpoint returns a non-json body (blocked page) this will throw
    const data = await response.json().catch(() => null);

    // debug: if data is null or missing products -> return debug info
    if (!data || (!data.products && !data.items)) {
      return res.json({
        query,
        count: 0,
        results: [],
        debug: {
          msg: "No products key in response - site may have blocked this request",
          status: response.status,
          headers: Object.fromEntries(response.headers || []),
          fetched_ms: Date.now() - start,
        },
      });
    }

    // Noon sometimes nests products under data.products or data.items
    const products = data.products || data.items || [];

    // Normalize product info safely
    const results = products.map((p) => {
      // best-effort price extraction
      let price = null;
      if (p.price && typeof p.price === "object") {
        // many noon objects use keys like price.selling_price or price.value
        price =
          p.price.selling_price ||
          p.price.selling_price_in_cents ||
          p.price.value ||
          p.price.min ||
          null;
        // if price is in cents and large integer, convert:
        if (typeof price === "number" && price > 100000) {
          // guess cents -> convert
          price = price / 100;
        }
      } else if (typeof p.price === "number") {
        price = p.price;
      }

      // image extraction: prefer image_key as we used before
      let image = null;
      if (p.image_key) {
        image = `https://z.nooncdn.com/products/tr:n-t_240/${p.image_key}.jpg`;
      } else if (p.image && typeof p.image === "string") {
        image = p.image;
      } else if (p.images && Array.isArray(p.images) && p.images[0]) {
        image = p.images[0].url || p.images[0];
      }

      // url: p.url might be relative
      let url = null;
      if (p.url) {
        url = p.url.startsWith("http") ? p.url : `https://www.noon.com${p.url}`;
      } else if (p.product_url) {
        url = p.product_url.startsWith("http")
          ? p.product_url
          : `https://www.noon.com${p.product_url}`;
      } else if (p.secondary_url) {
        url = p.secondary_url;
      }

      return {
        store: "noon",
        id: p.id || p.sku || p.product_id || null,
        title: p.name || p.title || p.product_name || null,
        price: price === undefined ? null : price,
        currency: "AED",
        image,
        url,
        raw: p, // keep raw product object for debugging/inspection
      };
    });

    // optionally drop items without any useful info
    const filtered = results.filter((r) => r.title || r.price || r.url);

    res.json({
      query,
      count: filtered.length,
      results: filtered,
      debug: {
        targetUrl: apiUrl,
        fetched_ms: Date.now() - start,
        originalCount: products.length,
      },
    });
  } catch (err) {
    res.status(500).json({ query, count: 0, results: [], error: err.message });
  }
});

// listen
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Noon worker listening on port ${PORT}`);
});
