// server/index.js — ESM + node-fetch v3 + caching
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ---------- Cache config ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, "cache");
const CACHE_TTL_MS =
  (Number(process.env.CACHE_TTL_SECONDS || 0) || 6 * 60 * 60) * 1000; // 6h
const AGE_KEYS = new Set(["1", "2", "3", "5", "6", "8", "r"]);

await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});

// ---------- API keys ----------
function loadKeys() {
  const raw =
    process.env.YT_API_KEYS ||
    process.env.YOUTUBE_API_KEYS ||
    process.env.YOUTUBE_API_KEY ||
    "";
  return String(raw).split(",").map(s => s.trim()).filter(Boolean);
}
function pickKey(keys) {
  if (!keys.length) return null;
  const idx = Math.floor(Date.now() / 1000) % keys.length;
  return keys[idx];
}

// ---------- Helpers ----------
function mapItem(it) {
  const id = it?.id?.videoId || "";
  const sn = it?.snippet || {};
  const thumb =
    sn?.thumbnails?.medium?.url ||
    sn?.thumbnails?.high?.url ||
    sn?.thumbnails?.default?.url ||
    "";
  return {
    id,
    title: sn?.title || "",
    thumbnail: thumb,
    src: `https://www.youtube.com/watch?v=${id}`,
    sourceUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
async function readJsonIfFresh(filePath, ttlMs) {
  try {
    const stat = await fs.stat(filePath);
    if (Date.now() - stat.mtimeMs > ttlMs) return null;
    const txt = await fs.readFile(filePath, "utf8");
    return JSON.parse(txt);
  } catch { return null; }
}
async function writeJson(filePath, data) {
  try { await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.error("Cache write failed:", e?.message); }
}

// ---------- Routes ----------
app.get("/", (_req, res) => res.type("text/plain").send("KidVid server OK"));

app.get("/videos", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    const age = (req.query.age || "").toString().trim();
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";

    let cacheFile = "all.json";
    if (!q && AGE_KEYS.has(age)) cacheFile = `${age}.json`;
    else if (q) cacheFile = `search-${slug(q)}.json`;
    const cachePath = path.join(CACHE_DIR, cacheFile);

    if (!refresh) {
      const cached = await readJsonIfFresh(cachePath, CACHE_TTL_MS);
      if (cached && Array.isArray(cached)) return res.json(cached);
    }

    const terms = [q, AGE_KEYS.has(age) ? `age ${age}` : age].filter(Boolean).join(" ").trim() || "cartoons for kids";
    const keys = loadKeys();
    const apiKey = pickKey(keys);
    if (!apiKey) {
      return res.status(500).json({ error: "No YouTube API key in ENV (set YT_API_KEYS or YOUTUBE_API_KEYS or YOUTUBE_API_KEY)" });
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "24");
    url.searchParams.set("q", terms);
    url.searchParams.set("safeSearch", "strict");
    url.searchParams.set("order", "relevance");
    url.searchParams.set("key", apiKey);

    const r = await fetch(url.toString());
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `YouTube API ${r.status}: ${text}` });
    }
    const j = await r.json();
    const items = Array.isArray(j?.items) ? j.items.map(mapItem).filter(x => x.id) : [];

    writeJson(cachePath, items).catch(() => {});
    return res.json(items);
  } catch (err) {
    console.error("ERROR /videos:", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
});

app.listen(PORT, () => console.log(`KidVid server listening on ${PORT}`));
