// api/syncScores.mjs
// Refresca marcadores/estado de partidos ya conocidos usando el endpoint
// /scores de The Odds API (barato en cuota: sin markets, 1 crédito por
// llamada), pensado para correr con más frecuencia que syncGames.mjs
// (que sí paga el costo de /odds). Reemplaza a ESPN por el mismo motivo que
// syncGames.mjs: ESPN bloquea por IP a los servidores de Vercel/AWS.
import { createClient } from '@supabase/supabase-js';
import { fetchOddsApiJSON } from './_theoddsapi.mjs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;
const SEASON       = Number(process.env.SEASON || '2026');

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function scoreFor(scores, teamName) {
  const row = (scores || []).find((s) => s.name === teamName);
  return row?.score != null ? Number(row.score) : null;
}

// Cuánto antes/después de un posible juego en vivo vale la pena gastar una
// llamada a The Odds API. Deja correr el cron cada 15-30 min todo el día sin
// preocuparse por la cuota gratuita: fuera de ventana de juego no pega a la
// API en absoluto.
const LIVE_WINDOW_BEFORE_HOURS = 5;
const LIVE_WINDOW_AFTER_MINUTES = 30;

async function syncScores() {
  const { data: pending, error: pErr } = await sb
    .from('games')
    .select('id, start_time')
    .eq('season', SEASON)
    .neq('status', 'final');
  if (pErr) throw pErr;

  const pendingIds = new Set((pending || []).map((g) => g.id));
  if (!pendingIds.size) return { updated: 0, checked: 0 };

  const now = Date.now();
  const windowStart = now - LIVE_WINDOW_BEFORE_HOURS * 3_600_000;
  const windowEnd = now + LIVE_WINDOW_AFTER_MINUTES * 60_000;
  const anyLiveish = (pending || []).some((g) => {
    const t = new Date(g.start_time).getTime();
    return t >= windowStart && t <= windowEnd;
  });
  if (!anyLiveish) return { updated: 0, checked: pendingIds.size, skipped: 'no_games_in_live_window' };

  const recent = await fetchOddsApiJSON('scores', { daysFrom: '3', dateFormat: 'iso' });

  let updated = 0;
  for (const ev of recent || []) {
    if (!pendingIds.has(ev.id)) continue;

    const home_score = scoreFor(ev.scores, ev.home_team);
    const away_score = scoreFor(ev.scores, ev.away_team);
    const status = ev.completed ? 'final' : (ev.scores ? 'in_progress' : 'scheduled');

    const patch = { status, updated_at: new Date().toISOString() };
    if (home_score != null) patch.home_score = home_score;
    if (away_score != null) patch.away_score = away_score;

    const { error } = await sb.from('games').update(patch).eq('id', ev.id);
    if (!error) updated++;
  }
  return { updated, checked: pendingIds.size };
}

export default async function handler(req, res) {
  try {
    const { token } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok: false, error: 'bad token' });

    const r = await syncScores();
    return res.json({ ok: true, action: 'syncScores', season: SEASON, ...r });
  } catch (e) {
    console.error('syncScores error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
