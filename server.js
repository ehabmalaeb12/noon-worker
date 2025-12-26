import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 SCRAPER API KEY (visible for now – later hidden)
const SCRAPER_API_KEY = "5710cb557dc48aa4262b8f90870fedff";

app.get("/search", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: "Missing ?q=" });
  }

  const targetUrl = `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(query)}`;

  const scraperUrl =
    `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}` +
    `&url=${encodeURIComponent(targetUrl)}` +
    `&render=true&country_code=ae`;

  try {
    const start = Date.now();
    const response = await fetch(scraperUrl);
    const html = await response.text();
    const fetchTime = Date.now() - start;

    // ---- PARSE PRODUCTS ----
    const productBlocks =
      html.match(/<div[^>]+data-qa="product-item"[\s\S]*?<\/div>\s*<\/div>/g) || [];

    const results = [];

    for (const block of productBlocks) {
      // TITLE
      const titleMatch = block.match(/title="([^"]+)"/);
      const title = titleMatch ? titleMatch[1].trim() : null;

      // PRICE
      const priceMatch = block.match(/data-qa="product-price">([\d,]+)/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1].replace(/,/g, ""));
      if (!price) continue;

      // IMAGE
      const imageMatch = block.match(/src="([^"]+nooncdn[^"]+)"/);
      const image = imageMatch ? imageMatch[1] : null;

      // LINK
      const linkMatch = block.match(/href="([^"]+)"/);
      const link = linkMatch
        ? `https://www.noon.com${linkMatch[1]}`
        : null;

      results.push({
        title,
        price,
        currency: "AED",
        image,
        link,
        store: "Noon UAE"
      });

      if (results.length >= 10) break; // limit for safety
    }

    res.json({
      query,
      count: results.length,
      results,
      debug: {
        targetUrl,
        scraperUrl,
        fetch_time_ms: fetchTime,
        htmlLength: html.length,
        productsFound: productBlocks.length
      }
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch Noon",
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Noon worker running on port ${PORT}`);
});
