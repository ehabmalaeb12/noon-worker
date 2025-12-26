const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

app.get("/", (req, res) => {
  res.send("Noon Worker is running");
});

app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.json({ error: "Missing query parameter" });
  }

  const targetUrl = `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(query)}`;

  const scraperUrl =
    `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}` +
    `&url=${encodeURIComponent(targetUrl)}` +
    `&render=true&country_code=ae`;

  try {
    const response = await fetch(scraperUrl);
    const html = await response.text();

    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );

    if (!match) {
      return res.json({ query, count: 0, results: [], error: "NEXT_DATA not found" });
    }

    const data = JSON.parse(match[1]);
    const products = data?.props?.pageProps?.searchResults?.hits || [];

    const results = products.slice(0, 20).map(p => ({
      store: "noon",
      title: p.name,
      price: p.price,
      currency: "AED",
      image: p.image_key
        ? `https://z.nooncdn.com/products/tr:n-t_240/${p.image_key}.jpg`
        : null,
      url: `https://www.noon.com/uae-en/${p.url}`
    }));

    res.json({
      query,
      count: results.length,
      results
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Noon worker running on port ${PORT}`);
});
