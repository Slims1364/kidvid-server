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

const PINNED_SHOWS = {
  "1-2": {
    "Cocomelon": 10,
    "Ms Rachel": 6,
    "Baby Einstein": 4,
    "Blippi": 4
  },
  "3-5": {
    "Bluey": 10,
    "Peppa Pig": 6,
    "Paw Patrol": 6,
    "Numberblocks": 2
  },
  "6-8": {
    "Wild Kratts": 6,
    "Ninjago": 6,
    "Magic School Bus": 6,
    "Oddbods": 6
  }
};

// --- rotation helpers ---
const daySeed = () => {
  const d = new Date();
  return Number(`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`);
};
const hash = (s) => [...s].reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0) >>> 0;
function seededShuffle(arr, seed) {
  let a = arr.slice(), r = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    r = (1664525 * r + 1013904223) >>> 0;
    const j = r % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
async function fetchBrandEpisodes(brand, count) {
  // pull up to ~50 candidates for the brand, then pick a daily-rotating subset
  let out = [];
  let token = "";
  for (let page = 0; page < 2 && out.length < 50; page++) {
    const r = await ytSearch({ q: `${brand} kids full episode`, maxResults: 25, pageToken: token });
    const ids = (r.items || []).map(i => i?.id?.videoId).filter(Boolean);
    out.push(...ids);
    token = r.nextPageToken || "";
    if (!token) break;
  }
  const s = Math.floor(Date.now() / 86400000) ^ hash(brand);
  const pick = seededShuffle(out, s).slice(0, count);
  return pick;
}

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

// 4) Cache: 24 hours, up to 200 entries
const cache = new LRUCache({
  max: 200,
  ttl: 1000 * 60 * 60 * 24, // 24 hours
});


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

// GET /videos?age=1-2&limit=48  (pinned brands + daily rotation, cached per day)
app.get("/videos", async (req, res) => {
  try {
    const age = String(req.query.age || "3-5").trim();
    const limit = Math.min(parseInt(String(req.query.limit || "48"), 10), 48);
    const day = Math.floor(Date.now() / 86400000);
    const cacheKey = `videos:${age}:${limit}:${day}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

    // 1) Build pinned set (same brands, different episodes daily)
    const pinnedSpec = PINNED_SHOWS[age] || {};
    const pinnedBrands = Object.keys(pinnedSpec);
    const pinnedIds = new Set();

    for (const brand of pinnedBrands) {
      const count = Math.max(0, pinnedSpec[brand] | 0);
      if (!count) continue;
      const ids = await fetchBrandEpisodes(brand, count);
      for (const id of ids) {
        if (pinnedIds.size >= limit) break;
        pinnedIds.add(id);
      }
      if (pinnedIds.size >= limit) break;
    }

    // 2) Rotation pool from categories.json excluding pinned brands
    const queries = (categories[age] || []).filter(q =>
      !pinnedBrands.some(b => q.toLowerCase().includes(b.toLowerCase()))
    );

    // deterministic daily shuffle of pool
    const pool = seededShuffle(queries, day ^ hash(age));

    // 3) Fill remaining slots with rotated pool, spaced to avoid burst limits
    const remaining = Math.max(0, limit - pinnedIds.size);
    const rotatedIds = new Set();
    for (const q of pool) {
      if (rotatedIds.size >= remaining) break;
      let token = "";
      let page = 0;
      while (rotatedIds.size < remaining && page < 2) { // up to ~50 candidates per query
        const r = await ytSearch({ q: `${q} kids full episode`, maxResults: 25, pageToken: token });
        const ids = (r.items || []).map(i => i?.id?.videoId).filter(Boolean);
        for (const id of ids) {
          if (rotatedIds.size >= remaining) break;
          if (!pinnedIds.has(id)) rotatedIds.add(id);
        }
        token = r.nextPageToken || "";
        page++;
        if (!token) break;
        await new Promise(r => setTimeout(r, 200)); // rate-space
      }
    }

    // 4) Merge, fetch metadata, respond
    const finalIds = Array.from(pinnedIds).concat(Array.from(rotatedIds)).slice(0, limit);
    const meta = await ytVideosById(finalIds);
    const items = (meta.items || []).map(v => ({
      id: v.id,
      title: v.snippet?.title || "",
      channel: v.snippet?.channelTitle || "",
      thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || "",
      duration: v.contentDetails?.duration || ""
    }));

    const payload = { age, count: items.length, items, pinnedBrands };
    if (items.length) cache.set(cacheKey, payload);
    console.log("✅ Cached videos for:", cacheKey);
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
