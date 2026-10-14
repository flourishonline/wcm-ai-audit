// POST /api/ai-check
// Runs three realistic client questions through Claude with live web search,
// works out whether the practice was recommended, and returns a plain summary.

import { cors, body, clean, isEmail, rateLimit, postToGhl } from '../lib/shared.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const TIMEZONES = {
  QLD: 'Australia/Brisbane', NSW: 'Australia/Sydney', ACT: 'Australia/Sydney',
  VIC: 'Australia/Melbourne', TAS: 'Australia/Hobart', SA: 'Australia/Adelaide',
  WA: 'Australia/Perth', NT: 'Australia/Darwin'
};

const PROFESSIONS = {
  'physio': 'physio',
  'psychologist': 'psychologist',
  'counsellor': 'counsellor',
  'occupational therapist': 'occupational therapist',
  'speech pathologist': 'speech pathologist',
  'dietitian': 'dietitian',
  'allied health clinic': 'allied health clinic'
};

function buildQuestions({ profession, suburb, service }) {
  const qs = [
    `Who is the best ${profession} in ${suburb}?`,
    `Can you recommend a ${profession} near ${suburb} with good reviews?`
  ];
  qs.push(service
    ? `I need help with ${service}. Who should I see near ${suburb}?`
    : `I'm looking for a ${profession} in ${suburb} who is taking new clients. Who would you suggest?`);
  return qs;
}

async function claude(payload, timeoutMs) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Claude API ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

// Pull the answer text and the sources Claude cited out of a Messages API result.
function readAnswer(resp) {
  let text = '';
  const cited = [];
  const searched = [];
  for (const block of resp.content || []) {
    if (block.type === 'text') {
      text += block.text || '';
      for (const c of block.citations || []) {
        if (c.url) cited.push({ title: c.title || c.url, url: c.url });
      }
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r.type === 'web_search_result' && r.url) searched.push({ title: r.title || r.url, url: r.url });
      }
    }
  }
  const seen = new Set();
  const unique = (cited.length ? cited : searched).filter((s) => {
    let key = s.url;
    try { key = new URL(s.url).hostname.replace(/^www\./, ''); } catch {}
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { text: text.trim(), sources: unique.slice(0, 6) };
}

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

function parseJson(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : raw);
}

// Ask a fast model to list the providers that were recommended, in order.
async function extractProviders(answer, practiceName) {
  const model = process.env.CLAUDE_EXTRACT_MODEL || 'claude-haiku-5-5';
  const resp = await claude({
    model,
    max_tokens: 600,
    messages: [{
      role: 'user',
      content:
        'Below is an AI assistant\'s answer to someone looking for a local health practitioner. ' +
        'List every specific practice or practitioner it recommends, in the order they appear (maximum 8). ' +
        `Then say whether "${practiceName}" is one of them (allow for small spelling or wording differences) and its position (1 = first). ` +
        'Only use what is in the answer. Reply with JSON only, no other text, in exactly this shape: ' +
        '{"providers": ["..."], "practiceMentioned": true, "practicePosition": 1}  (use null for practicePosition if not mentioned).' +
        '\n\nANSWER:\n' + answer.slice(0, 6000)
    }]
  }, 25000);
  return parseJson(readAnswer(resp).text);
}

async function runQuestion(question, ctx) {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  const resp = await claude({
    model,
    max_tokens: 1500,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: Number(process.env.MAX_SEARCHES_PER_QUESTION || 3),
      user_location: {
        type: 'approximate',
        city: ctx.suburb,
        region: ctx.state,
        country: 'AU',
        timezone: TIMEZONES[ctx.state] || 'Australia/Sydney'
      }
    }],
    messages: [{ role: 'user', content: question }]
  }, 50000);

  const { text, sources } = readAnswer(resp);
  let providers = [];
  let mentioned = false;
  let position = null;
  try {
    const ex = await extractProviders(text, ctx.practiceName);
    providers = (ex.providers || []).map((p) => clean(p, 90)).filter(Boolean).slice(0, 8);
    mentioned = !!ex.practiceMentioned;
    position = Number.isInteger(ex.practicePosition) ? ex.practicePosition : null;
  } catch (e) {
    console.error('extract failed', e?.message || e);
  }
  // Safety net: plain text match on the practice name.
  if (!mentioned && norm(ctx.practiceName).length > 3 && norm(text).includes(norm(ctx.practiceName))) {
    mentioned = true;
  }
  if (mentioned && position === null) {
    const target = norm(ctx.practiceName);
    const idx = providers.findIndex((p) => norm(p).includes(target) || target.includes(norm(p)));
    if (idx >= 0) position = idx + 1;
  }
  return {
    question,
    mentioned,
    position,
    providers,
    excerpt: clean(text, 700),
    sources
  };
}

export default async function handler(req, res) {
  const originOk = cors(req, res);
  if (req.method === 'OPTIONS') return res.status(originOk ? 204 : 403).end();
  if (!originOk) return res.status(403).json({ error: 'origin_not_allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'not_configured' });

  const b = body(req);
  if (b.company_website) return res.status(200).json({ queries: [], summary: { mentionedCount: 0, total: 0, aiAreaScore: 0 } }); // honeypot

  const ctx = {
    firstName: clean(b.firstName, 60),
    email: clean(b.email, 120).toLowerCase(),
    practiceName: clean(b.practiceName, 100),
    profession: PROFESSIONS[clean(b.profession, 40)] || 'allied health clinic',
    suburb: clean(b.suburb, 60),
    state: clean(b.state, 3).toUpperCase(),
    service: clean(b.service, 80),
    website: clean(b.website, 200)
  };
  if (!ctx.firstName || !isEmail(ctx.email) || !ctx.practiceName || !ctx.suburb) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const limit = rateLimit(req);
  if (!limit.ok) return res.status(429).json({ error: 'rate_limited', reason: limit.reason });

  const questions = buildQuestions(ctx);
  const settled = await Promise.allSettled(questions.map((q) => runQuestion(q, ctx)));
  const queries = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);

  if (queries.length === 0) {
    console.error('all questions failed', settled.map((s) => s.reason?.message));
    return res.status(502).json({ error: 'ai_unavailable' });
  }

  // Score: first three = 2 points, mentioned further down = 1, not mentioned = 0. Scaled to 0–4.
  let pts = 0;
  for (const q of queries) pts += q.mentioned ? ((q.position && q.position <= 3) || !q.position ? 2 : 1) : 0;
  const aiAreaScore = Math.round((pts / (queries.length * 2)) * 4);
  const mentionedCount = queries.filter((q) => q.mentioned).length;

  const summary = { mentionedCount, total: queries.length, aiAreaScore, checkedAt: new Date().toISOString() };

  await postToGhl({
    event: 'ai_check',
    first_name: ctx.firstName,
    email: ctx.email,
    practice_name: ctx.practiceName,
    profession: ctx.profession,
    suburb: ctx.suburb,
    state: ctx.state,
    website: ctx.website,
    top_service: ctx.service,
    ai_mentioned_count: mentionedCount,
    ai_questions_asked: queries.length,
    ai_summary: queries.map((q) => `${q.question} → ${q.mentioned ? 'MENTIONED' + (q.position ? ' #' + q.position : '') : 'not mentioned'} | AI recommended: ${q.providers.slice(0, 3).join(', ') || 'n/a'}`).join('\n')
  });

  return res.status(200).json({ queries, summary });
}
