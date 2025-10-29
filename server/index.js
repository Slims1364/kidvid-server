// server/index.js

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import pino from "pino";
import pinoHttp from "pino-http";
import { LRUCache } from "lru-cache";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from /server if present
dotenv.config({ path: path.join(__dirname, ".env") });

// Keys (plural fallback to singular)
const RAW_KEYS =
  process.env.YOUTUBE_API_KEYS ||
  process.env.YOUTUBE_API_KEY ||
  "";

const KEYS = RAW_KEYS.split(",").map(s => s.trim()).filter(Boolean);
let keyIndex = 0;

const app = express();
const log = pino({ level: process.env.LOG_LEVEL || "info" });
app.use(pinoHttp({ logger: log }));
app.use(cors());
app.use(express.json());

// Cache 15 min
const cache = new LRUCache({ max: 200, ttl: 1000 * 60 * 15 });

// Categories
const categoriesPath = path.join(__dirname, "categories.json");
const categories = JSON.parse(fs.readFileSync(categoriesPath, "utf8"));

// YouTube helpers
async function ytJson(url) {
  if (!KEYS.length) throw new Error("NO_KEYS_CONFIGURED");
  const sep = url.includes("?") ? "&" : "?";
  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const key = KEYS[keyIndex % KEYS.length];
    const full = `${url}${sep}key=${key}`;
    const resp = await fetch(full);
    if (resp.ok) return resp.json();

    const text = await resp.text();
    if (resp.status === 403 || resp.status === 429) {
      log.warn({ status: resp.status, attempt, msg: "YT quota/denied", keyHead: key.slice(0,8) });
      keyIndex++;
      continue;
    }
    log.error({ status: resp.status, body: text, msg: "YT hard error" });
    throw new Error(`YOUTUBE_HTTP_${resp.status}`);
  }
  throw new Error("ALL_KEYS_EXHAUSTED");
}

async function ytSearch({ q, maxResults = 25, pageToken = "", safeSearch = "strict" }) {
  const base = new URL("https://www.googleapis.com/youtube/v3/search");
  base.searchParams.set("part", "snippet");
  base.searchParams.set("type", "video");
  base.searchParams.set("videoEmbeddable", "true");
  base.searchParams.set("maxResults", String(maxResults));
  base.searchParams.set("safeSearch", safeSearch);
  base.searchParams.set("q", q);
  if (pageToken) base.searchParams.set("pageToken", pageToken);
  return ytJson(base.toString());
}

async function ytVideosById(ids) {
  if (!ids.length) return { items: [] };
  const base = new URL("https://www.googleapis.com/youtube/v3/videos");
  base.searchParams.set("part", "snippet,contentDetails,statistics");
  base.searchParams.set("id", ids.join(","));
  return ytJson(base.toString());
}

// Routes
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// FIXED /videos: reset pageToken per query
app.get("/videos", async (req, res) => {
  try {
    const age = String(req.query.age || "3-5").trim();
    const limit = Math.min(parseInt(String(req.query.limit || "100"), 10), 100);
    const cacheKey = `videos:${age}:${limit}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

    const queries = categories[age] || categories["3-5"];
    const picked = new Set();

    for (const q of queries) {
      let token = ""; // reset for each query
      while (picked.size < limit) {
        const r = await ytSearch({ q, maxResults: 25, pageToken: token });
        const ids = (r.items || []).map(i => i?.id?.videoId).filter(Boolean);
        for (const id of ids) {
          if (picked.size >= limit) break;
          picked.add(id);
        }
        token = r.nextPageToken || "";
        if (!token) break;
      }
      if (picked.size >= limit) break;
    }

    const list = Array.from(picked).slice(0, limit);
    const meta = await ytVideosById(list);
    const items = (meta.items || []).map(v => ({
      id: v.id,
      title: v.snippet?.title || "",
      channel: v.snippet?.channelTitle || "",
      thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || "",
      duration: v.contentDetails?.duration || ""
    }));

    const payload = { age, count: items.length, items };
    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    req.log.error({ err: String(err) }, "failed_to_fetch_videos");
    res.status(500).json({ error: "failed_to_fetch_videos" });
  }
});

// Search route
app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(String(req.query.limit || "40"), 10), 50);
    if (!q) return res.json({ items: [] });

    const cacheKey = `search:${q}:${limit}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

    const r = await ytSearch({ q, maxResults: limit });
    const ids = (r.items || []).map(i => i?.id?.videoId).filter(Boolean);
    const meta = await ytVideosById(ids);
    const items = (meta.items || []).map(v => ({
      id: v.id,
      title: v.snippet?.title || "",
      channel: v.snippet?.channelTitle || "",
      thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || ""
    }));

    const payload = { q, count: items.length, items };
    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    req.log.error({ err: String(err) }, "search_failed");
    res.status(500).json({ error: "search_failed" });
  }
});

// Debug
app.get("/debug/keys", (_req, res) => {
  const list = KEYS;
  res.json({ present: !!RAW_KEYS, count: list.length, heads: list.map(k => k.slice(0,8)) });
});

// Start
const PORT = process.env.PORT || 3001;
app.get("/testyt", async (_req, res) => {
  try {
    const key = KEYS[0];
    const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=Bluey&key=${key}`);
    const txt = await resp.text();
    res.type("text").send(txt);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.listen(PORT, () => {
  log.info({ port: PORT, keys: KEYS.length }, "kidvid-server listening");
});
