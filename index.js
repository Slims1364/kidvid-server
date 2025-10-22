// KidVid server — Render-ready
// Exposes: /health, /api/health, /api/videos/:range (1-2, 3-5, 6-8)

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// --- Port for Render/Node
const PORT = process.env.PORT || 4000;

// --- Load YouTube API keys from env (comma-separated)
const KEY_POOL = (process.env.YOUTUBE_API_KEYS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let keyIndex = 0;
function nextKey() {
  if (!KEY_POOL.length) return '';
  const k = KEY_POOL[keyIndex % KEY_POOL.length];
  keyIndex++;
  return k;
}

// ---- Simple in-memory cache
// cache[range] = { ts, items }
const cache = Object.create(null);
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

// ---- Queries per age range (kid-safe themes)
const RANGE_QUERIES = {
  '1-2': [
    'Cocomelon nursery rhymes',
    'BabyBus songs',
    'Super Simple Songs kids',
    'Little Baby Bum',
    'Baby Einstein',
    'Pinkfong Baby Shark',
    'Hey Bear Sensory'
  ],
  '3-5': [
    'Peppa Pig full episodes',
    'Bluey official channel episodes',
    'Paw Patrol compilation',
    'Numberblocks episodes',
    'Blippi educational videos',
    'Octonauts full episodes',
    'Masha and the Bear'
  ],
  '6-8': [
    'Sonic Boom cartoon',
    'Teen Titans Go full episodes',
    'LEGO Ninjago episodes',
    'Pokemon kids cartoon episodes',
    'The Amazing World of Gumball',
    'Wild Kratts full episodes',
    'Phineas and Ferb'
  ],
};

// ---- YouTube search helper (uses global fetch on Node 18+)
async function ytSearch(query, maxResults = 25) {
  const key = nextKey();
  if (!key) return [];

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('safeSearch', 'strict');
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('maxResults', Math.min(maxResults, 50));
  url.searchParams.set('q', query);
  url.searchParams.set('key', key);

  const res = await fetch(url.toString());
  if (!res.ok) {
    // rotate key on error
    return [];
  }
  const data = await res.json();
  const items = (data.items || []).map(it => ({
    id: it.id && it.id.videoId ? it.id.videoId : null,
    title: it.snippet?.title || '',
    channel: it.snippet?.channelTitle || '',
    thumb: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || '',
  })).filter(v => v.id);

  return items;
}

async function fetchRange(range, targetCount = 100) {
  const queries = RANGE_QUERIES[range] || [];
  let all = [];
  for (const q of queries) {
    const items = await ytSearch(q, 25);
    // de-dupe by id
    const seen = new Set(all.map(v => v.id));
    for (const it of items) {
      if (!seen.has(it.id)) {
        all.push(it);
        seen.add(it.id);
      }
      if (all.length >= targetCount) break;
    }
    if (all.length >= targetCount) break;
  }
  return all.slice(0, targetCount);
}

// --- HEALTH (two paths, to be safe)
app.get('/health', (req, res) => {
  res.json({ ok: true, path: '/health', keys: KEY_POOL.length });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, path: '/api/health', keys: KEY_POOL.length });
});

// --- VIDEOS: /api/videos/:range  (range: 1-2, 3-5, 6-8)
// optional query: ?refresh=1 to bypass cache
app.get('/api/videos/:range', async (req, res) => {
  try {
    const { range } = req.params;
    const refresh = req.query.refresh === '1';
    const now = Date.now();

    if (!RANGE_QUERIES[range]) {
      return res.status(400).json({ ok: false, error: 'invalid_range' });
    }

    if (!refresh && cache[range] && now - cache[range].ts < CACHE_MS) {
      return res.json({ ok: true, count: cache[range].items.length, items: cache[range].items, cached: true });
    }

    const items = await fetchRange(range, 100);
    cache[range] = { ts: now, items };
    res.json({ ok: true, count: items.length, items, cached: false });
  } catch (e) {
    console.error('videos error', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// --- Start server (Render needs 0.0.0.0)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ KidVid server running on http://localhost:${PORT}`);
  console.log(`🔑 Keys loaded: ${KEY_POOL.length}`);
});
