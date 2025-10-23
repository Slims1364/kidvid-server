
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors({ origin: "*"})); // or lock to your domain later
app.use(express.json());

const PORT = process.env.PORT || 5000;

// --- Load multiple keys ---
function loadKeys() {
  const fromList =
    (process.env.YT_API_KEYS || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

  const fromIndexed = [process.env.YT_API_KEY_1, process.env.YT_API_KEY_2, process.env.YT_API_KEY_3]
    .filter(Boolean);

  const single = process.env.YT_API_KEY ? [process.env.YT_API_KEY] : [];

  const all = [...fromList, ...fromIndexed, ...single]
    .map(k => k.trim())
    .filter(Boolean);

  if (all.length === 0) throw new Error("No YouTube API keys found in env.");
  return all;
}

const KEYS = loadKeys();
let keyIndex = 0;
const currentKey = () => KEYS[keyIndex % KEYS.length];
const nextKey = () => { keyIndex = (keyIndex + 1) % KEYS.length; };

async function ytSearch({ q, limit }, key) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(limit));
  url.searchParams.set("safeSearch", "strict");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("videoSyndicated", "true");
  url.searchParams.set("key", key);

  const r = await fetch(url);
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

// small health/root route so you can see JSON at the base URL
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "kidvid-server", endpoints: ["/api/search", "/search"] });
});

// handle BOTH /api/search and /search
["/api/search", "/search"].forEach((path) => {
  app.get(path, async (req, res) => {
    try {
      const q = (req.query.q || "").toString().trim();
      const limit = Math.min(parseInt(req.query.limit || "12", 10), 20);
      if (!q) return res.json({ items: [] });

      // rotate through keys until one gives embeddable items
      let attempts = 0, lastErr = null;
      while (attempts < KEYS.length) {
        const key = currentKey();
        const { ok, status, data } = await ytSearch({ q, limit }, key);

        if (ok && Array.isArray(data.items)) {
          const items = data.items
            .map(it => ({
              id: it?.id?.videoId,
              title: it?.snippet?.title,
              thumb: it?.snippet?.thumbnails?.medium?.url
            }))
            .filter(v => !!v.id);

          if (items.length > 0) return res.json({ items });
          lastErr = new Error("No embeddable items from this key");
        } else {
          lastErr = new Error(`YouTube API error ${status}`);
        }

        nextKey();
        attempts++;
      }

      return res.status(502).json({ error: lastErr?.message || "All keys exhausted" });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Search failed" });
    }
  });
});

// === DIAGNOSTICS: test each YouTube key quickly ===
app.get("/diag", async (_req, res) => {
  const results = [];
  const testQ = "numberblocks";

  // Figure out which keys are loaded (same logic your app already uses)
  const keysList =
    (process.env.YT_API_KEYS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const keysIndexed = [
    process.env.YT_API_KEY_1,
    process.env.YT_API_KEY_2,
    process.env.YT_API_KEY_3,
  ].filter(Boolean);

  const single = process.env.YT_API_KEY
    ? [process.env.YT_API_KEY]
    : [];

  const KEYS = [...keysList, ...keysIndexed, ...single].map((k) => k.trim());

  if (!KEYS.length) {
    return res.json({ ok: false, error: "No API keys found in env" });
  }

  // Try each key
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    try {
      const { ok, status, data } = await ytSearch({ q: testQ, limit: 3 }, key);
      const items = Array.isArray(data?.items)
        ? data.items
            .map((it) => ({
              id: it?.id?.videoId,
              title: it?.snippet?.title,
              embeddable: true, // we request videoEmbeddable=true in ytSearch()
            }))
            .filter((v) => !!v.id)
        : [];
      results.push({ keyIndex: i + 1, ok, status, count: items.length });
    } catch (e) {
      results.push({ keyIndex: i + 1, ok: false, status: 0, error: String(e) });
    }
  }

  res.json({ ok: true, test: testQ, results });
});

app.listen(PORT, () => {
  console.log(`kidvid-server running on :${PORT}, keys loaded: ${KEYS.length}`);
});
