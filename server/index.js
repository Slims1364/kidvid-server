import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import LRU from "lru-cache";
import pino from "pino";
import pinoHttp from "pino-http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const log = pino();
app.use(pinoHttp({ logger: log }));
app.use(cors());
app.use(express.json());

const KEYS = (process.env.YOUTUBE_API_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
let keyIdx = 0;

const categories = JSON.parse(fs.readFileSync(path.join(__dirname, "categories.json"), "utf8"));

const cache = new LRU({ max: 400, ttl: 1000 * 60 * 15 });

const todayKey = () => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

async function yt(url) {
  let tries = 0;
  while (tries < KEYS.length) {
    const key = KEYS[keyIdx % KEYS.length];
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(`${url}${sep}key=${key}`);
    if (r.ok) return r.json();
    if (r.status === 403 || r.status === 429) { keyIdx++; tries++; continue; }
    throw new Error(`YouTube ${r.status}`);
  }
  throw new Error("All API keys exhausted");
}

async function search(q, maxResults = 25, pageToken = "") {
  const base = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=strict&maxResults=${maxResults}&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ""}`;
  return yt(base);
}

async function videosByIds(ids) {
  if (!ids.length) return { items: [] };
  const base = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${ids.join(",")}`;
  return yt(base);
}

// GET /videos?age=1-2&limit=50  daily cache
app.get("/videos", async (req, res) => {
  try {
    const age = String(req.query.age || "3-5");
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 50);
    const ckey = `v:${todayKey()}:${age}:${limit}`;
    if (cache.has(ckey)) return res.json(cache.get(ckey));

    const terms = categories[age] || categories["3-5"];
    const picked = [];
    let termIdx = 0;
    let token = "";

    while (picked.length < limit && termIdx < terms.length + 6) {
      const q = terms[termIdx % terms.length];
      const r = await search(q, 25, token);
      const ids = (r.items || []).map(i => i.id.videoId).filter(Boolean);
      for (const id of ids) {
        if (!picked.includes(id)) picked.push(id);
        if (picked.length === limit) break;
      }
      token = r.nextPageToken || "";
      if (!token) termIdx++;
    }

    const meta = await videosByIds(picked);
    const items = (meta.items || []).map(v => ({
      id: v.id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || ""
    }));
    const payload = { age, count: items.length, items };
    cache.set(ckey, payload);
    res.json(payload);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "fetch_failed" });
  }
});

// GET /search?q=bluey&limit=40  cached 15 min
app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit || "40", 10), 50);
    if (!q) return res.json({ items: [] });
    const ckey = `s:${q}:${limit}`;
    if (cache.has(ckey)) return res.json(cache.get(ckey));
    const r = await search(q, limit);
    const ids = (r.items || []).map(i => i.id.videoId).filter(Boolean);
    const meta = await videosByIds(ids);
    const items = (meta.items || []).map(v => ({
      id: v.id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || ""
    }));
    const payload = { q, count: items.length, items };
    cache.set(ckey, payload);
    res.json(payload);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "search_failed" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => log.info({ msg: "server up", port: PORT }));
