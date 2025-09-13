// /api/syncScores.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  // Service Role para poder actualizar filas sin RLS del cliente
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SEASON = parseInt(process.env.SEASON || '2025', 10);

function hasGameEnded(g) {
  const s = String(g?.status || '').toLowerCase();
  if (['final','completed','complete','closed','postgame','ended','finished'].includes(s)) return true;
  const periodOk = (g?.period ?? 0) >= 4;
  const clockStr = String(g?.clock || '').trim();
  const clockDone = clockStr === '0:00' || clockStr === '00:00' || clockStr === '' || clockStr === 'Final';
  if (periodOk && clockDone && !['in_progress','inprogress','live','ongoing','playing','active'].includes(s)) return true;
  return false;
}

function computeResult(game, teamId) {
  if (!hasGameEnded(game)) return 'pending';
  const hs = Number(game.home_score ?? 0);
  const as = Number(game.away_score ?? 0);
  if (hs === as) return 'push';
  const winner = hs > as ? game.home_team : game.away_team;
  return winner === teamId ? 'win' : 'loss';
}

export default async function handler(req, res) {
  try {
    // 1) Seguridad simple por token
    const q = req.method === 'POST' ? req.body : req.query;
    const token = q.token || '';
    if (!process.env.CRON_TOKEN || token !== process.env.CRON_TOKEN) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }

    // 2) Parámetros
    const week = q.week ? parseInt(q.week, 10) : null;

    // 3) Traer juegos (de la semana si viene, si no todos los de la temporada)
    let gq = supabase.from('games').select('*').eq('season', SEASON).order('start_time');
    if (week) gq = gq.eq('week', week);
    const { data: games, error: gErr } = await gq;
    if (gErr) throw gErr;

    // 4) Crear Mapa de juegos finalizados
    const finals = {};
    for (const g of games || []) {
      if (hasGameEnded(g)) finals[g.id] = g;
    }
    const finalIds = Object.keys(finals);
    if (finalIds.length === 0) {
      return res.json({ ok: true, updated: 0, message: 'No hay juegos FINAL para asentar' });
    }

    // 5) Cargar picks pendientes que correspondan a esos juegos
    let pq = supabase
      .from('picks')
      .select('id, user_id, game_id, team_id, week, season, result')
      .in('game_id', finalIds)
      .eq('season', SEASON);

    if (week) pq = pq.eq('week', week);

    const { data: picks, error: pErr } = await pq;
    if (pErr) throw pErr;

    // 6) Calcular nuevos resultados y aplicar UPDATE solo donde cambie
    const updates = [];
    for (const p of picks || []) {
      const game = finals[p.game_id];
      if (!game) continue;
      const newRes = computeResult(game, p.team_id); // 'win' | 'loss' | 'push' | 'pending'
      if (!p.result || p.result === 'pending') {
        if (newRes !== 'pending') {
          updates.push({ id: p.id, result: newRes });
        }
      }
    }

    let updated = 0;
    for (const u of updates) {
      const { error: uErr } = await supabase
        .from('picks')
        .update({ result: u.result, updated_at: new Date().toISOString() })
        .eq('id', u.id);
      if (!uErr) updated += 1;
    }

    return res.json({ ok: true, updated, finals: finalIds.length });
  } catch (e) {
    console.error('syncScores error', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
