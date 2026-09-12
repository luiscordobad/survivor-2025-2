// api/control.mjs
// Endpoint de control del juego: autopick (favorito más fuerte disponible)
// y liquidación de semana (marcar win/loss/push y descontar vidas).
//
// El frontend (src/App.jsx) ya llama a estas acciones:
//   /api/control?action=settleWeek&week=N&token=...
//   /api/control?action=autopick&week=N&token=...
//   /api/control?action=autopickOne&week=N&user_id=...&token=...
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;
const SEASON       = Number(process.env.SEASON || '2026');

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Evalúa (win/loss/push) todos los picks pendientes de juegos ya finalizados en la semana. */
async function settleWeek(week) {
  const { data: finalGames, error: gErr } = await sb
    .from('games')
    .select('id')
    .eq('season', SEASON)
    .eq('week', week)
    .eq('status', 'final');
  if (gErr) throw gErr;

  const gameIds = (finalGames || []).map((g) => g.id);
  if (!gameIds.length) return { evaluated: 0 };

  const { data: pending, error: pErr } = await sb
    .from('picks')
    .select('id')
    .eq('season', SEASON)
    .eq('week', week)
    .in('game_id', gameIds)
    .eq('result', 'pending');
  if (pErr) throw pErr;

  let evaluated = 0;
  for (const p of pending || []) {
    const { error } = await sb.rpc('eval_pick', { _pick_id: p.id });
    if (!error) evaluated++;
  }
  return { evaluated };
}

/** Elige automáticamente el favorito más fuerte disponible (no usado, juego no iniciado). */
async function autopickForUser(userId, week) {
  const { data: existing, error: exErr } = await sb
    .from('picks')
    .select('id')
    .eq('user_id', userId)
    .eq('season', SEASON)
    .eq('week', week)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing) return { skipped: true, reason: 'already_has_pick' };

  const { data: prof, error: profErr } = await sb
    .from('profiles')
    .select('lives, season')
    .eq('id', userId)
    .maybeSingle();
  if (profErr) throw profErr;
  if (!prof || prof.season !== SEASON || (prof.lives ?? 0) <= 0) {
    return { skipped: true, reason: 'eliminated_or_no_profile' };
  }

  const { data: used, error: usedErr } = await sb
    .from('picks')
    .select('team_id')
    .eq('user_id', userId)
    .eq('season', SEASON);
  if (usedErr) throw usedErr;
  const usedTeams = new Set((used || []).map((u) => u.team_id));

  const nowIso = new Date().toISOString();
  const { data: games, error: gErr } = await sb
    .from('games')
    .select('id, home_team, away_team, start_time')
    .eq('season', SEASON)
    .eq('week', week)
    .gt('start_time', nowIso);
  if (gErr) throw gErr;
  if (!games?.length) return { skipped: true, reason: 'no_upcoming_games' };

  const gameIds = games.map((g) => g.id);
  const { data: odds, error: oErr } = await sb
    .from('odds')
    .select('game_id, spread_home, spread_away, fetched_at')
    .in('game_id', gameIds)
    .order('fetched_at', { ascending: false });
  if (oErr) throw oErr;
  const latestOdds = {};
  for (const o of odds || []) if (!latestOdds[o.game_id]) latestOdds[o.game_id] = o;

  // Candidatos: equipos no usados, ordenados por spread (más negativo = mayor favorito).
  const candidates = [];
  for (const g of games) {
    const o = latestOdds[g.id];
    if (g.home_team && !usedTeams.has(g.home_team)) {
      candidates.push({ team: g.home_team, game: g, spread: o?.spread_home ?? 0 });
    }
    if (g.away_team && !usedTeams.has(g.away_team)) {
      candidates.push({ team: g.away_team, game: g, spread: o?.spread_away ?? 0 });
    }
  }
  if (!candidates.length) return { skipped: true, reason: 'no_available_teams' };

  candidates.sort((a, b) => a.spread - b.spread);
  const choice = candidates[0];

  const { error: insErr } = await sb.from('picks').insert({
    user_id: userId,
    game_id: choice.game.id,
    team_id: choice.team,
    week,
    season: SEASON,
    auto_pick: true,
  });
  if (insErr) return { skipped: true, reason: insErr.message };

  return { picked: choice.team, game_id: choice.game.id };
}

export default async function handler(req, res) {
  try {
    const { token, action, week, user_id } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok: false, error: 'bad token' });

    const wk = Number(week || '1');

    if (action === 'settleWeek') {
      const r = await settleWeek(wk);
      return res.json({ ok: true, action, season: SEASON, week: wk, ...r });
    }

    if (action === 'autopickOne') {
      if (!user_id) return res.status(400).json({ ok: false, error: 'missing user_id' });
      const r = await autopickForUser(user_id, wk);
      return res.json({ ok: true, action, season: SEASON, week: wk, user_id, ...r });
    }

    if (action === 'autopick') {
      const { data: players, error } = await sb.from('profiles').select('id').eq('season', SEASON);
      if (error) throw error;
      const results = [];
      for (const p of players || []) {
        results.push({ user_id: p.id, ...(await autopickForUser(p.id, wk)) });
      }
      return res.json({ ok: true, action, season: SEASON, week: wk, results });
    }

    return res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (e) {
    console.error('control error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
