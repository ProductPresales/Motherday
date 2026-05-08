const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = '0.0.0.0';
const IS_PROD = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
const ENV_NAME = IS_PROD ? 'prod' : 'dev';
const TABLE = `analytics_events_${ENV_NAME}`;

const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const ALLOWED_EVENTS = new Set(['visit', 'download', 'share_whatsapp']);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });
} else {
  console.warn('DATABASE_URL not set — analytics will not be persisted.');
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id BIGSERIAL PRIMARY KEY,
      event TEXT NOT NULL,
      session_id TEXT,
      user_agent TEXT,
      referrer TEXT,
      ip TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${TABLE}_event_idx ON ${TABLE} (event)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${TABLE}_created_idx ON ${TABLE} (created_at)`);
  console.log(`Analytics table ready: ${TABLE} (env=${ENV_NAME})`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) { req.destroy(); reject(new Error('payload too large')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function isLocal(req) {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function checkAdminAuth(req, res) {
  // If no password set: only allow localhost (dev convenience)
  if (!ADMIN_PASSWORD) {
    if (isLocal(req)) return true;
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Admin password not configured. Set ADMIN_PASSWORD secret to enable remote access.');
    return false;
  }
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (user === ADMIN_USER && pass === ADMIN_PASSWORD) return true;
    } catch (_) { /* fallthrough */ }
  }
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Mom\'s Bill Analytics", charset="UTF-8"',
    'Content-Type': 'text/plain',
  });
  res.end('Authentication required');
  return false;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function handleTrack(req, res) {
  try {
    const raw = await readBody(req);
    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); }
      catch (_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }
    }
    const event = String(data.event || '').toLowerCase();
    if (!ALLOWED_EVENTS.has(event)) return sendJson(res, 400, { ok: false, error: 'invalid_event' });
    const sessionId = data.sessionId ? String(data.sessionId).slice(0, 64) : null;
    const meta = data.meta && typeof data.meta === 'object' ? data.meta : null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    const referrer = String(req.headers['referer'] || '').slice(0, 500);
    const ip = clientIp(req).slice(0, 64);

    if (pool) {
      await pool.query(
        `INSERT INTO ${TABLE} (event, session_id, user_agent, referrer, ip, meta) VALUES ($1,$2,$3,$4,$5,$6)`,
        [event, sessionId, ua, referrer, ip, meta]
      );
    }
    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('track error:', err.message);
    sendJson(res, 500, { ok: false, error: 'server_error' });
  }
}

async function handleStats(req, res) {
  if (!pool) return sendJson(res, 200, { env: ENV_NAME, table: TABLE, totals: {}, unique_visitors: 0, last_24h: {} });
  try {
    const totals = await pool.query(
      `SELECT event, COUNT(*)::int AS count FROM ${TABLE} GROUP BY event`
    );
    const unique = await pool.query(
      `SELECT COUNT(DISTINCT session_id)::int AS count FROM ${TABLE} WHERE event='visit' AND session_id IS NOT NULL`
    );
    const last24 = await pool.query(
      `SELECT event, COUNT(*)::int AS count FROM ${TABLE}
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY event`
    );
    const totalsObj = {};
    for (const r of totals.rows) totalsObj[r.event] = r.count;
    const last24Obj = {};
    for (const r of last24.rows) last24Obj[r.event] = r.count;
    sendJson(res, 200, {
      env: ENV_NAME,
      table: TABLE,
      totals: totalsObj,
      unique_visitors: unique.rows[0]?.count || 0,
      last_24h: last24Obj,
    });
  } catch (err) {
    console.error('stats error:', err.message);
    sendJson(res, 500, { ok: false, error: 'server_error' });
  }
}

function serveStatic(req, res, urlPath) {
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': IS_PROD ? 'public, max-age=300' : 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (urlPath === '/api/track' && req.method === 'POST') return handleTrack(req, res);
  if (urlPath === '/dashboard-stats/data' && req.method === 'GET') {
    if (!checkAdminAuth(req, res)) return;
    return handleStats(req, res);
  }
  if (urlPath === '/dashboard-stats' || urlPath === '/dashboard-stats/') {
    if (!checkAdminAuth(req, res)) return;
    return serveStatic(req, res, '/dashboard-stats.html');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method not allowed'); return;
  }
  serveStatic(req, res, urlPath);
});

initDb()
  .catch((err) => console.error('DB init failed:', err.message))
  .finally(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Serving on http://${HOST}:${PORT} (env=${ENV_NAME})`);
    });
  });
