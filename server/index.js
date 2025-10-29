import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";
import pinoHttp from "pino-http";
import { LRUCache } from "lru-cache";

const LRU = LRUCache;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3001;

// comma-separated keys in env
const RAW_KEYS =
  process.env.YOUTUBE_API_KEYS ||
  "AIzaSyD7EySVbSNQcR6NDHJCyVnRJ2nab7exWNU,AIzaSyCp7Ws9TEIXjVX8ehWITpUfPRTyS0miXMU,AIzaSyC3h6glOKinI3lR3ERDMKB-cvKmbQjH4K4";
const KEYS = RAW_KEYS.split(",").map((s) => s.trim()).filter(Boolean);
let keyIndex = 0;

const categories = JSON.parse(
  fs.readFileSync(path.join(__dirname, "categories.json"), "utf8")
);

const app = express();
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger: pino() }));

// 15 min cache for list results. 200 items max.
const cache = new LRU({ max: 200, ttl: 1000 * 60 * 15 });

const yt = async (url) => {
  // rotate key on quota or 403/429
  let tries = 0;
  while (tries < KEYS.length) {
    const key = KEYS[keyIndex % KEYS.length];
    const sep = url.includes("?") ? "&" : "?";
    const resp = await fetch(`${url}${sep}key=${key}`);
    if (resp.ok) return resp.json();

    // try next key on common quota errors
    if ([403, 429].includes(resp.status)) {
      keyIndex++;
      tries++;
      continue;
    }
    // non-retry error
    const text = await resp.text();
    throw new Error(`YouTube error ${resp.status}: ${text}`);
  }
  throw new Error("All API keys exhausted");
};

const searchYouTube = async ({
  q,
  maxResults = 20,
  pageToken = "",
  safeSearch = "strict"
}) => {
  const base =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=" +
    encodeURIComponent(maxResults) +
    "&q=" +
    encodeURIComponent(q) +
    (pageToken ? `&pageToken=${pageToken}` : "") +
    `&safeSearch=${safeSearch}`;
  return yt(base);
};

const videosByIds = async (ids) => {
  if (!ids.length) return { items: [] };
  const base =
    "https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=" +
    encodeURIComponent(ids.join(","));
  return yt(base);
};

// GET /videos?age=1-2&limit=100
app.get("/videos", async (req, res) => {
  try {
    const age = (req.query.age || "3-5").trim();
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 100);
    const cacheKey = `videos:${age}:${limit}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

    const queries = categories[age] || categories["3-5"];
    const picked = [];
    let token = "";

    // pull until limit
    while (picked.length < limit) {
      const q = queries[picked.length % queries.length];
      const r = await searchYouTube({
        q,
        maxResults: 25,
        pageToken: token
      });
      const ids = (r.items || []).map((i) => i.id.videoId).filter(Boolean);
      token = r.nextPageToken || "";

      // de-dup
      for (const id of ids) {
        if (!picked.includes(id)) picked.push(id);
        if (picked.length === limit) break;
      }
      if (!token && picked.length < limit) token = ""; // move on to next query
      if (!r.items?.length && !token) break;
    }

    const meta = await videosByIds(picked.slice(0, limit));
    const items =
      meta.items?.map((v) => ({
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        thumb:
          v.snippet.thumbnails?.medium?.url ||
          v.snippet.thumbnails?.default?.url ||
          "",
        duration: v.contentDetails?.duration || ""
      })) || [];

    const payload = { age, count: items.length, items };
    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "failed_to_fetch_videos" });
  }
});

// GET /search?q=bluey&limit=30
app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit || "30", 10), 50);
    if (!q) return res.json({ items: [] });

    const cacheKey = `search:${q}:${limit}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

    const r = await searchYouTube({ q, maxResults: limit });
    const ids = (r.items || []).map((i) => i.id.videoId).filter(Boolean);
    const meta = await videosByIds(ids);
    const items =
      meta.items?.map((v) => ({
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        thumb:
          v.snippet.thumbnails?.medium?.url ||
          v.snippet.thumbnails?.default?.url ||
          ""
      })) || [];
    const payload = { q, count: items.length, items };
    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "search_failed" });
  }
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`kidvid-server listening on ${PORT}`);
});
