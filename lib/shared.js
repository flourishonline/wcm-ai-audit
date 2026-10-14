// Shared helpers for the Well Connected AI Visibility Audit backend.

const allowed = () =>
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

// Sets CORS headers. Returns false if the origin is not allowed.
export function cors(req, res) {
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  const list = allowed();
  const ok = list.length === 0 ? false : list.includes(origin);
  if (ok) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  return ok;
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export function clean(v, max = 120) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// ---- Best-effort rate limiting (per warm server instance) ----
// For bullet-proof limits, also set a monthly spend limit in the Claude Console.
const ipHits = new Map();
let dayKey = '';
let dayCount = 0;

export function rateLimit(req) {
  const perIp = Number(process.env.MAX_CHECKS_PER_IP_PER_HOUR || 3);
  const perDay = Number(process.env.MAX_CHECKS_PER_DAY || 60);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();

  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCount = 0; }
  if (dayCount >= perDay) return { ok: false, reason: 'daily' };

  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (hits.length >= perIp) return { ok: false, reason: 'ip' };

  hits.push(now);
  ipHits.set(ip, hits);
  dayCount += 1;
  return { ok: true };
}

export async function postToGhl(payload) {
  const url = process.env.GHL_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) {
    console.error('GHL webhook failed:', e?.message || e);
  }
}
