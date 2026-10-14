// POST /api/complete
// Receives the finished audit (score, area ratings, fixes) and forwards it to GHL.

import { cors, body, clean, isEmail, postToGhl } from '../lib/shared.js';

export default async function handler(req, res) {
  const originOk = cors(req, res);
  if (req.method === 'OPTIONS') return res.status(originOk ? 204 : 403).end();
  if (!originOk) return res.status(403).json({ error: 'origin_not_allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const b = body(req);
  const email = clean(b.email, 120).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: 'missing_fields' });

  const areas = Array.isArray(b.areas) ? b.areas.slice(0, 8) : [];
  const fixes = Array.isArray(b.fixes) ? b.fixes.slice(0, 3) : [];
  const score = Math.max(0, Math.min(100, Number(b.score) || 0));

  await postToGhl({
    event: 'audit_complete',
    email,
    first_name: clean(b.firstName, 60),
    practice_name: clean(b.practiceName, 100),
    audit_score: score,
    audit_breakdown: areas.map((a) => `${clean(a.name, 40)}: ${clean(a.rating, 20)}`).join('\n'),
    audit_top_fixes: fixes.map((f, i) => `${i + 1}. ${clean(f.area, 40)}: ${clean(f.tip, 300)}`).join('\n')
  });

  return res.status(200).json({ ok: true });
}
