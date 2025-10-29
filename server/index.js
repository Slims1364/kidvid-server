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

// 1) Load .env from the /server folder (if present)
//    Render also injects env vars; this does not override them.
dotenv.config({ path: path.join(__dirname, ".env") });

// 2) Read YT keys from env.
//    Supports both plural and singular names.
const RAW_KEYS =
  process.env.YOUTUBE_API_KEYS ||
  process.env.YOUTUBE_API_KEY ||
  "";

const KEYS = RAW_KEYS.split(",").map(s => s.trim()).filter(Boolean);

if (KEYS.length === 0) {
  // Log clear message but keep server alive for health checks.
  console.error("[BOOT] No YouTube API keys found in env. Set YOUTUBE_API_KEYS.");
}

let keyIndex = 0;

// 3) App + logging
const app = express();
const log = pino({ level: process.env.LOG_LEVEL || "info" });
app.use(pinoHttp({ logger: log }));
app.use(cors());
app.use(express.json());

// 4) Cache: 15 minutes, up to 200 entries
const cache = new LRUCache({ max: 200, ttl: 1000 * 60 * 15 });

// 5) Categories
const categoriesPath = path.join(__dirname, "categories.json");
const categories = JSON.parse(fs.readFileSync(categoriesPath, "utf8"));

// 6) Helper: rotated YouTube fetch with key failover
async function ytJson(url) {
  if (KEYS.length === 0) {
    throw new Error("NO_KEYS_CONFIGURED");
  }
  const sep = url.includes("?") ? "&" : "?";

  // try each key once
  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const key = KEYS[keyIndex % KEYS.length];
    const full = `${url}${sep}key=${key}`;
    const resp = await fetch(full);

    if (resp.ok) return resp.json();

    const text = await resp.text();

    // rotate on quota/denied
    if (resp.status === 403 || resp.status === 429) {
      log.warn({ status: resp.status, attempt, msg: "YT quota/denied", keyHead: key.slice(0,8) });
      keyIndex++;
      continue;
    }

    // other HTTP errors: do not rotate further
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

// 7) Routes
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// GET /videos?age=1-2&limit=100
app.get("/videos", async (req, res) => {
  try {
    const age = String(req.query.age || "3-5").trim();
    const limit = Math.min(parseInt(String(req.query.limit || "100"), 10), 100);
    const cacheKey = `videos:${age}:${limit}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

    const queries = categories[age] || categories["3-5"];
    const picked = new Set();
    let token = "";
    let qi = 0;

    // collect until limit
    while (picked.size < limit && qi < queries.length * 6) {
      const q = queries[qi % queries.length];
      const r = await ytSearch({ q, maxResults: 25, pageToken: token });
      const ids = (r.items || []).map(i => i?.id?.videoId).filter(Boolean);
      for (const id of ids) {
        if (picked.size >= limit) break;
        picked.add(id);
      }
      token = r.nextPageToken || "";
      qi++;
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

// GET /search?q=bluey&limit=40
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

// 8) Minimal debug (safe: only shows counts and first 8 chars)
app.get("/debug/keys", (_req, res) => {
  const raw = RAW_KEYS;
  const list = KEYS;
  res.json({
    present: !!raw,
    count: list.length,
    heads: list.map(k => k.slice(0, 8))
  });
});

// 9) Start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  log.info({ port: PORT, keys: KEYS.length }, "kidvid-server listening");
});
