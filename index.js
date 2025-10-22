// server/index.js  (copy–paste whole file)

import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import cron from 'node-cron';

dotenv.config({ path: '.env' }); // loads YOUTUBE_API_KEYS

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 4000;
// make the cache folder path explicit (no __dirname needed)
const CACHE_DIR = path.resolve('./cache');

// -------- Age-specific search queries --------
const RANGE_QUERIES = {
  '1-2': [
    'toddler nursery rhymes',
    'baby sensory videos',
    'cocomelon songs',
    'peekaboo songs for babies',
    'bedtime lullabies for toddlers',
    'abc song toddler',
    'learn colors for babies',
    'animal sounds for toddlers'
  ],
  '3-5': [
    'preschool phonics',
    'learn numbers 1-20 preschool',
    'learn shapes and colors preschool',
    'blippi educational for kids',
    'peppa pig educational',
    'alphabet sounds kindergarten',
    'sight words for kids',
    'story time for kids read aloud'
  ],
  '6-8': [
    'kids science experiments',
    'math grade 2',
    'reading comprehension kids',
    'national geographic kids animals',
    'geography for kids',
    'minecraft education for kids',
    'history for kids',
    'space facts for kids'
  ]
};

// -------- Keys --------
const RAW_KEYS = process.env.YOUTUBE_API_KEYS || '';
const API_KEYS = RAW_KEYS.split(',').map(k => k.trim()).filter(Boolean);

console.log(`🔑 Keys loaded: ${API_KEYS.length}`);

// ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ---------- helpers ----------
function cachePath(range) {
  return path.join(CACHE_DIR, `${range}.json`);
}

function searchUrl(range, key, pageToken = '') {
  const q = encodeURIComponent(`${range} kids cartoons`);
  const token = pageToken ? `&pageToken=${pageToken}` : '';
  return `https://www.googleapis.com/youtube/v3/search?key=${key}&q=${q}&type=video&videoEmbeddable=true&maxResults=50${token}`;
}

// pull up to {count} videos using all keys, then write cache
async function refreshRange(range, count = 100) {
  const file = cachePath(range);
  let all = [];
  let pageToken = '';

  try {
    for (const key of API_KEYS) {
      // keep calling until we hit the count or no more pages
      while (all.length < count) {
        const queryList = RANGE_QUERIES[range] || ['educational kids videos'];
        const q = queryList[Math.floor(Math.random() * queryList.length)];
        const url = `https://www.googleapis.com/youtube/v3/search?key=${key}&q=${encodeURIComponent(q)}&type=video&maxResults=50&safeSearch=strict&videoEmbeddable=true&part=snippet`;
        const r = await fetch(url);
        const j = await r.json();

        if (j.error) {
          console.error('YouTube error:', j.error);
          break; // try next key
        }

        if (Array.isArray(j.items)) {
          all = all.concat(j.items);
        }
        pageToken = j.nextPageToken || '';
        if (!pageToken) break; // no more pages from this key
      }
      if (all.length >= count) break;
    }

    if (all.length > count) all = all.slice(0, count);

    fs.writeFileSync(file, JSON.stringify(all, null, 2));
    return { ok: true, count: all.length };
  } catch (e) {
    console.error('⚠️ Error refreshing', range, e);
    return { ok: false, error: String(e) };
  }
}

// ---------- routes ----------
app.get('/health', (_req, res) => res.json({ ok: true }));

// refresh one range
app.get('/api/refresh/:range', async (req, res) => {
  const count = Number(req.query.count || 100);
  const range = req.params.range;
  const result = await refreshRange(range, count);
  return res.json(result);
});

// refresh all ranges (handy to test)
app.get('/api/refresh/all', async (req, res) => {
  const count = Number(req.query.count || 100);
  const ranges = ['1-2','3-5','6-8'];
  const out = {};
  for (const r of ranges) {
    out[r] = await refreshRange(r, count);
  }
  return res.json(out);
});

// serve cached videos
app.get('/api/videos/:range', (req, res) => {
  const file = cachePath(req.params.range);
  if (!fs.existsSync(file)) return res.json({ ok: false, videos: [] });
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return res.json({ ok: true, videos: data });
});

// ---------- cron (3:00 AM every day) ----------
cron.schedule('0 3 * * *', async () => {
  console.log('⏰ Cron: refreshing caches (3:00 AM)…');
  for (const r of ['1-2','3-5','6-8']) {
    const result = await refreshRange(r, 100);
    console.log(`   • ${r}:`, result);
  }
  console.log('✅ Cron: done.');
});

app.listen(PORT, () => {
  console.log(`✅ KidVid server running on http://localhost:${PORT}`);
  console.log('🗓️  Cron jobs scheduled for 03:00 daily.');
});
