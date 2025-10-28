// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ---------- CONFIG ---------- */
const PORT = process.env.PORT || 10000;

// Cache directory (server/cache)
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CACHE_DIR = path.resolve(__dirname, "cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// TTLs (milliseconds)
const TTL_AGE_FEED = 6 * 60 * 60 * 1000;    // 6 hours for age feeds
const TTL_SEARCH   = 1 * 60 * 60 * 1000;    // 1 hour for typed searches

// Your rotating API keys
const API_KEYS = [
  process.env.YOUTUBE_API_KEY_1,
  process.env.YOUTUBE_API_KEY_2,
  process.env.YOUTUBE_API_KEY_3,
].filter(Boolean);

let rr = 0;
function nextKey() {
  if (!API_KEYS.length) {
    throw new Error("No YouTube API keys configured in ENV (YOUTUBE_API_KEY_1..3).");
  }
  const key = API_KEYS[rr % API_KEYS.length];
  rr++;
  return key;
}

/* ---------- HELPERS ---------- */
function slug(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cachePathFor({ age = "all", q = "" }) {
  if (q && q.trim()) {
    return path.join(CACHE_DIR, `search-${slug(age)}-${slug(q)}.json`);
  }
  return path.join(CACHE_DIR, `${slug(age || "all")}.json`);
}

function isFresh(filePath, ttlMs) {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs < ttlMs;
  } catch {
    return false;
  }
}

function mapYouTube(items = []) {
  return items
    .map((it) => {
      const id = it.id?.videoId || it.id;
      const sn = it.snippet || {};
      const thumb =
        sn.thumbnails?.medium?.url ||
        sn.thumbnails?.high?.url ||
        sn.thumbnails?.default?.url ||
        "";
      return id && thumb
        ? {
            id,
            title: sn.title || "",
            thumbnail: thumb,
            sourceUrl: `https://www.youtube.com/watch?v=${id}`,
          }
        : null;
    })
    .filter(Boolean);
}

/* ---------- YOUTUBE FETCH ---------- */
async function fetchYouTube({ q, max = 24 }) {
  const key = nextKey();
  const params = new URLSearchParams({
    key,
    part: "snippet",
    maxResults: String(max),
    type: "video",
    safeSearch: "strict",
    q: q || "kids cartoons",
  });

  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return mapYouTube(json.items || []);
}

/* ---------- ROUTES ---------- */

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Main videos endpoint
// GET /videos?age=3-5&q=paw%20patrol
app.get("/videos", async (req, res) => {
  try {
    const age = String(req.query.age || "all");
    const q   = String(req.query.q || "");

    const cacheFile = cachePathFor({ age, q });
    const ttl = q.trim() ? TTL_SEARCH : TTL_AGE_FEED;

    // 1) Serve fresh cache first (NO API hit)
    if (isFresh(cacheFile, ttl)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      console.log("✅ Serving from cache:", path.basename(cacheFile));
      return res.json({ ok: true, cached: true, items: cached });
    }

    // 2) Build the effective query
    let effectiveQ = q.trim();
    if (!effectiveQ) {
      // seed per age if needed (light defaults—you can customize)
      if (age === "1-2") effectiveQ = "toddler learning colors cartoons";
      else if (age === "3-5") effectiveQ = "preschool cartoons full episodes";
      else if (age === "6-8") effectiveQ = "kids animated series";
      else effectiveQ = "kids cartoons";
    }

    // 3) Fetch from YouTube (API hit)
    const items = await fetchYouTube({ q: effectiveQ });

    // 4) Save/refresh cache (best effort)
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(items, null, 2));
      console.log("💾 Wrote cache:", path.basename(cacheFile));
    } catch (e) {
      console.warn("Cache write failed:", e?.message);
    }

    return res.json({ ok: true, cached: false, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`KidVid server listening on ${PORT}`);
  console.log(`Cache dir: ${CACHE_DIR}`);
});
