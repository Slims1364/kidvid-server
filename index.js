// index.js (server)
// Clean server with refresh + videos + health, Render-safe cache in /tmp

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

// ------------------ CONFIG ------------------
const PORT = process.env.PORT || 4000;

// Comma-separated YouTube API keys in env, e.g. "KEY1,KEY2,KEY3"
const RAW_KEYS =
  process.env.YT_API_KEYS ||
  process.env.YOUTUBE_API_KEYS ||
  process.env.YOUTUBE_API_KEY ||
  "";
const KEYS = RAW_KEYS.split(",").map(s => s.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const CACHE_DIR = "/tmp/kidvid-cache"; // Render-safe writable dir
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Age-group default queries (safe + animated)
const RANGE_QUERIES = {
  "1-2": [
    "toddler songs animated",
    "nursery rhymes animation super simple songs",
    "cocomelon wheels on the bus",
    "baby shark official animated"
  ],
  "3-5": [
    "peppa pig full episodes official",
    "bluey full episodes official",
    "paw patrol official compilation",
    "learning songs preschool animated"
  ],
  "6-8": [
    "octonauts official",
    "wild kratts full episodes",
    "teeny titans cartoon network",
    "lego city adventures full episode"
  ]
};

// ------------------ HELPERS ------------------
const jsonPath = (range) => path.join(CACHE_DIR, `${range}.json`);

function writeCache(range, payload) {
  fs.writeFileSync(jsonPath(range), JSON.stringify(payload, null, 2), "utf-8");
}

function readCache(range) {
  const p = jsonPath(range);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function asItem(yt) {
  // Normalize a YouTube search item to {id, snippet}
  const id = yt.id?.videoId || yt.id;
  return {
    id: { videoId: id },
    snippet: {
      title: yt.snippet?.title,
      thumbnails: yt.snippet?.thumbnails || {}
    }
  };
}

async function ytSearch(q, key, pageToken) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("safeSearch", "strict");
  url.searchParams.set("q", q);
  url.searchParams.set("key", key);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const r = await fetch(url, { method: "GET" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`YouTube ${r.status}: ${t}`);
  }
  return r.json();
}

async function refreshRange(range, count = 100) {
  if (!RANGE_QUERIES[range]) throw new Error(`Unknown range ${range}`);
  if (!KEYS.length) throw new Error("No YouTube API keys in env");

  const desired = Math.max(1, Math.min(200, Number(count) || 100));
  const out = [];
  const seen = new Set();

  // Loop queries and keys to collect enough unique videos
  for (const q of RANGE_QUERIES[range]) {
    for (const key of KEYS) {
      let token = undefined;
      for (let page = 0; page < 3 && out.length < desired; page++) {
        try {
          const data = await ytSearch(q, key, token);
          token = data.nextPageToken;
          const items = Array.isArray(data.items) ? data.items : [];
          for (const it of items) {
            const vid = it.id?.videoId || it.id;
            if (vid && !seen.has(vid)) {
              seen.add(vid);
              out.push(asItem(it));
              if (out.length >= desired) break;
            }
          }
          if (!token) break; // no more pages
        } catch (e) {
          // move to next key or query on error
          break;
        }
      }
      if (out.length >= desired) break;
    }
    if (out.length >= desired) break;
  }

  // Save cache
  const payload = { ok: true, range, count: out.length, videos: out };
  writeCache(range, payload);
  return payload;
}

// ------------------ ROUTES ------------------

// Health: shows key count & cached ranges
app.get("/api/health", (req, res) => {
  const cached = Object.keys(RANGE_QUERIES).map(r => ({
    range: r,
    hasCache: !!readCache(r)
  }));
  res.json({ ok: true, path: "/api/health", keys: KEYS.length, cached });
});

// Read cached videos for a range
app.get("/api/videos/:range", (req, res) => {
  const range = req.params.range;
  const data = readCache(range);
  if (data?.ok && Array.isArray(data.videos)) {
    return res.json(data);
  }
  // no cache yet
  res.json({ ok: true, range, count: 0, videos: [] });
});

// Refresh cache for a range from YouTube
app.get("/api/refresh/:range", async (req, res) => {
  try {
    const range = req.params.range;
    const count = Number(req.query.count) || 100;
    const payload = await refreshRange(range, count);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`KidVid server running on port ${PORT}`);
  console.log(`Keys loaded: ${KEYS.length}`);
});
