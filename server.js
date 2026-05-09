const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
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

function readBinaryBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) { req.destroy(); reject(new Error('payload too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleMuxAudio(req, res) {
  const tmpDir = os.tmpdir();
  const tag = crypto.randomBytes(8).toString('hex');
  const inPath = path.join(tmpDir, `mux_${tag}_in.mp4`);
  const outPath = path.join(tmpDir, `mux_${tag}_out.mp4`);
  const bgmPath = path.join(ROOT, 'audio', 'bgm.mp3');
  const debug = (req.url || '').includes('debug=1');
  const debugLog = [];
  try {
    const buf = await readBinaryBody(req, 50 * 1024 * 1024); // 50MB cap
    if (buf.length < 1000) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('empty video');
      return;
    }
    await fs.promises.writeFile(inPath, buf);

    // Primary: re-encode to a universally-compatible MP4
    // (baseline H.264 + yuv420p + stereo AAC 44.1 kHz, faststart, non-fragmented).
    // This is what WhatsApp/iPhone reliably plays with audio — the iOS Safari
    // MediaRecorder output (fragmented MP4, occasionally yuv444p) is the reason
    // shared videos previously played silently on iPhone.
    //
    // Fallback: if libx264 isn't available on the host, fall back to stream-copy
    // video (still re-encodes audio + remuxes to non-fragmented MP4), so the
    // user always gets a video with audio.
    // Notes on the flag choices (all driven by iPhone WhatsApp behaviour):
    //   -fflags +genpts         regenerate timestamps from scratch — MediaRecorder
    //                           output sometimes has gaps/non-zero starts that
    //                           break WhatsApp's re-transcode (silent audio).
    //   -vf fps=30 / -r 30      force constant frame rate. canvas.captureStream
    //                           is VFR; iPhone WhatsApp drops audio on VFR mp4s.
    //   -vsync cfr              same intent at the muxer level.
    //   -async 1                resample/pad audio so it stays in sync with the
    //                           regenerated video timestamps.
    //   -ar 48000               iOS prefers 48 kHz AAC; 44.1 kHz sometimes
    //                           survives Safari but fails WhatsApp's reencode.
    //   -profile:a aac_low      explicit AAC-LC; some iOS pipelines reject
    //                           anything that smells like HE-AAC.
    //   baseline H.264 + yuv420p + faststart + non-fragmented → universal play.
    function buildArgs(videoCodecArgs, useVf) {
      return [
        '-y',
        '-fflags', '+genpts',
        '-i', inPath,
        '-stream_loop', '-1', '-i', bgmPath, // loop bgm to cover any video length
        '-map', '0:v:0',
        '-map', '1:a:0',
        ...videoCodecArgs,
        ...(useVf ? ['-vf', 'fps=30,format=yuv420p'] : []),
        '-r', '30',
        '-vsync', 'cfr',
        '-c:a', 'aac',
        '-profile:a', 'aac_low',
        '-b:a', '160k',
        '-ar', '48000',
        '-ac', '2',
        '-async', '1',
        '-shortest',
        '-movflags', '+faststart',
        '-max_muxing_queue_size', '1024',
        '-f', 'mp4',
        outPath,
      ];
    }

    function runFfmpeg(args) {
      return new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let errOut = '';
        ff.stderr.on('data', (d) => { errOut += d.toString(); });
        ff.on('error', reject);
        ff.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error('ffmpeg exit ' + code + ': ' + errOut.slice(-800)));
        });
      });
    }

    try {
      await runFfmpeg(buildArgs([
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'baseline',
        '-level', '3.1',
      ], true));
      debugLog.push('encode: ok');
    } catch (encodeErr) {
      console.warn('libx264 encode failed, falling back to copy:', encodeErr.message);
      debugLog.push('encode: FAIL ' + encodeErr.message);
      // copy path can't apply -vf; rely on muxer-level cfr/async only
      try {
        await runFfmpeg(buildArgs(['-c:v', 'copy'], false));
        debugLog.push('copy: ok');
      } catch (copyErr) {
        debugLog.push('copy: FAIL ' + copyErr.message);
        throw copyErr;
      }
    }

    const out = await fs.promises.readFile(outPath);

    // Stash most-recent iPhone request for offline diagnosis (input + output
    // + UA). Overwrites every call. Inspect via /api/debug-last-input?key=...
    try {
      const stashDir = path.join(tmpDir, 'mux_last');
      await fs.promises.mkdir(stashDir, { recursive: true });
      await fs.promises.writeFile(path.join(stashDir, 'in.mp4'), buf);
      await fs.promises.writeFile(path.join(stashDir, 'out.mp4'), out);
      await fs.promises.writeFile(path.join(stashDir, 'meta.json'), JSON.stringify({
        ua: String(req.headers['user-agent'] || ''),
        inSize: buf.length,
        outSize: out.length,
        log: debugLog,
        ts: new Date().toISOString(),
      }, null, 2));
    } catch (_) { /* best-effort */ }

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': out.length,
      'Cache-Control': 'no-store',
    });
    res.end(out);
  } catch (err) {
    console.error('mux error:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    if (debug) {
      res.end('mux failed\n' + err.message + '\n---\n' + debugLog.join('\n'));
    } else {
      res.end('mux failed');
    }
  } finally {
    fs.promises.unlink(inPath).catch(() => {});
    fs.promises.unlink(outPath).catch(() => {});
  }
}

async function handleDebugLast(req, res, urlPath) {
  const file = urlPath.replace('/api/debug-last/', '');
  if (!['in.mp4', 'out.mp4', 'meta.json'].includes(file)) {
    res.writeHead(404); res.end('not found'); return;
  }
  const fp = path.join(os.tmpdir(), 'mux_last', file);
  fs.stat(fp, (err) => {
    if (err) { res.writeHead(404); res.end('no stash yet'); return; }
    const ct = file.endsWith('.json') ? 'application/json' : 'video/mp4';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    fs.createReadStream(fp).pipe(res);
  });
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
    const totalsObj = {};
    for (const r of totals.rows) totalsObj[r.event] = r.count;
    sendJson(res, 200, {
      env: ENV_NAME,
      table: TABLE,
      totals: totalsObj,
      unique_visitors: unique.rows[0]?.count || 0,
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
  if (urlPath === '/api/mux-audio' && req.method === 'POST') return handleMuxAudio(req, res);
  if (urlPath.startsWith('/api/debug-last/') && req.method === 'GET') return handleDebugLast(req, res, urlPath);
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
