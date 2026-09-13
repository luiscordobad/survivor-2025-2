// api/control.mjs
// Endpoint de control del juego: autopick (favorito más fuerte disponible)
// y liquidación de semana (marcar win/loss/push y descontar vidas).
//
// El frontend (src/App.jsx) llama a estas acciones:
//   /api/control?action=settleWeek&week=N                         (con sesión de usuario)
//   /api/control?action=autopickOne&week=N&user_id=<yo>            (con sesión de usuario)
//   /api/control?action=autopick&week=N&token=CRON_TOKEN           (solo cron/admin)
//
// Autorización: el CRON_TOKEN nunca debe viajar al navegador (Vite lo
// embebería en el bundle público), así que solo el cron server-to-server
// lo usa. Las llamadas desde el navegador se autentican con el JWT de
// Supabase del propio usuario (header Authorization: Bearer ...).
import { createClient } from '@supabase/supabase-js';
import { currentWeek } from './_theoddsapi.mjs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;
const SEASON       = Number(process.env.SEASON || '2026');

// Qué tan cerca del kickoff hay que estar para que el autopick "de emergencia"
// pueda tomar un juego. Evita que el cron le asigne a alguien el equipo del
// juego del jueves con días de anticipación, cuando todavía puede elegir a mano
// cualquier otro juego de la semana (domingo/lunes).
const AUTOPICK_WINDOW_MINUTES = Number(process.env.AUTOPICK_WINDOW_MINUTES || '90');

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Resuelve el uid del usuario autenticado a partir del JWT de Supabase, si viene. */
async function getAuthedUserId(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header?.startsWith('Bearer ')) return null;
  const jwt = header.slice(7);
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user.id;
}

/**
 * Evalúa (win/loss/push) todos los picks pendientes de juegos ya finalizados.
 * Si `week` es null, lo hace para toda la temporada (uso normal del cron: no
 * necesita saber qué semana va, y es idempotente/barato de sobra correrlo
 * seguido -- solo toca picks en result='pending' de juegos ya en 'final').
 */
async function settleWeek(week) {
  let gamesQuery = sb.from('games').select('id').eq('season', SEASON).eq('status', 'final');
  if (week != null) gamesQuery = gamesQuery.eq('week', week);
  const { data: finalGames, error: gErr } = await gamesQuery;
  if (gErr) throw gErr;

  const gameIds = (finalGames || []).map((g) => g.id);
  if (!gameIds.length) return { evaluated: 0 };

  let picksQuery = sb.from('picks').select('id').eq('season', SEASON).in('game_id', gameIds).eq('result', 'pending');
  if (week != null) picksQuery = picksQuery.eq('week', week);
  const { data: pending, error: pErr } = await picksQuery;
  if (pErr) throw pErr;

  let evaluated = 0;
  for (const p of pending || []) {
    const { error } = await sb.rpc('eval_pick', { _pick_id: p.id });
    if (!error) evaluated++;
  }
  return { evaluated };
}

/**
 * Autopick "de emergencia": solo actúa sobre juegos que están a punto de
 * cerrar (dentro de AUTOPICK_WINDOW_MINUTES). Si todavía quedan juegos más
 * tarde en la semana, el usuario conserva la libertad de elegir a mano y no
 * se le fuerza un pick con días de anticipación.
 */
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

  const now = new Date();
  const cutoff = new Date(now.getTime() + AUTOPICK_WINDOW_MINUTES * 60_000);
  const { data: games, error: gErr } = await sb
    .from('games')
    .select('id, home_team, away_team, start_time')
    .eq('season', SEASON)
    .eq('week', week)
    .gt('start_time', now.toISOString())
    .lte('start_time', cutoff.toISOString());
  if (gErr) throw gErr;
  if (!games?.length) return { skipped: true, reason: 'no_games_locking_soon' };

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

/**
 * Ajustes de admin sobre otro jugador (vidas / eliminado). Necesita
 * service role porque profiles solo permite UPDATE de auth.uid() = id vía
 * RLS -- un admin no puede tocar la fila de otro jugador desde el cliente.
 */
async function adminUpdatePlayer(targetUserId, { lives, eliminated, paid }) {
  const patch = {};
  if (lives != null) patch.lives = Math.max(0, Math.trunc(Number(lives)));
  if (eliminated != null) patch.eliminated_at = eliminated ? new Date().toISOString() : null;
  if (paid != null) patch.paid = !!paid;
  if (!Object.keys(patch).length) return { updated: false };

  const { error } = await sb.from('profiles').update(patch).eq('id', targetUserId);
  if (error) throw error;
  return { updated: true, ...patch };
}

/** Bote de la liga: solo admin/cron puede fijar la cuota de entrada. */
async function adminSetConfig(key, value) {
  const { error } = await sb.from('app_config').upsert({ key, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
  return { key, value: String(value) };
}

export default async function handler(req, res) {
  try {
    const params = { ...req.query, ...(req.body || {}) };
    const { token, action, week, user_id } = params;
    const isCron = !!CRON_TOKEN && token === CRON_TOKEN;
    const authedUserId = isCron ? null : await getAuthedUserId(req);
    if (!isCron && !authedUserId) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    if (action === 'adminUpdatePlayer') {
      if (!isCron) {
        const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', authedUserId).maybeSingle();
        if (!prof?.is_admin) return res.status(403).json({ ok: false, error: 'forbidden: solo admin' });
      }
      const targetUser = user_id;
      if (!targetUser) return res.status(400).json({ ok: false, error: 'missing user_id' });
      const lives = params.lives != null ? Number(params.lives) : null;
      const eliminated = params.eliminated != null ? params.eliminated === 'true' || params.eliminated === true : null;
      const paid = params.paid != null ? params.paid === 'true' || params.paid === true : null;
      const r = await adminUpdatePlayer(targetUser, { lives, eliminated, paid });
      return res.json({ ok: true, action, user_id: targetUser, ...r });
    }

    if (action === 'adminSetConfig') {
      if (!isCron) {
        const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', authedUserId).maybeSingle();
        if (!prof?.is_admin) return res.status(403).json({ ok: false, error: 'forbidden: solo admin' });
      }
      const key = params.key;
      if (!key || params.value == null) return res.status(400).json({ ok: false, error: 'missing key/value' });
      const r = await adminSetConfig(key, params.value);
      return res.json({ ok: true, action, ...r });
    }

    if (action === 'settleWeek') {
      // Seguro para cualquier caller autenticado: no apunta a nadie en
      // particular y solo confirma resultados ya decididos por los marcadores.
      // Sin `week` explícito, liquida toda la temporada (ideal para el cron).
      const wk = week != null ? Number(week) : null;
      const r = await settleWeek(wk);
      return res.json({ ok: true, action, season: SEASON, week: wk, ...r });
    }

    const wk = Number(week || currentWeek(SEASON));

    if (action === 'autopickOne') {
      const targetUser = user_id || authedUserId;
      if (!targetUser) return res.status(400).json({ ok: false, error: 'missing user_id' });
      if (!isCron && targetUser !== authedUserId) {
        return res.status(403).json({ ok: false, error: 'forbidden: solo puedes autopickear tu propio usuario' });
      }
      const r = await autopickForUser(targetUser, wk);
      return res.json({ ok: true, action, season: SEASON, week: wk, user_id: targetUser, ...r });
    }

    if (action === 'autopick') {
      if (!isCron) {
        const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', authedUserId).maybeSingle();
        if (!prof?.is_admin) return res.status(403).json({ ok: false, error: 'forbidden: solo admin o cron' });
      }
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
