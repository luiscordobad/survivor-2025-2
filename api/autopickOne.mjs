// /api/autopickOne.mjs
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const user_id = url.searchParams.get('user_id');
    const week = Number(url.searchParams.get('week') || '1');

    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ ok:false, error:'UNAUTHORIZED' });
    }
    if (!user_id) return res.status(400).json({ ok:false, error:'Missing user_id' });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // equipos ya usados por el usuario
    const { data: prev } = await supabase.from('picks')
      .select('team_id').eq('user_id', user_id);
    const used = new Set((prev||[]).map(x=>x.team_id));

    // juegos de la semana que no han empezado
    const now = new Date().toISOString();
    const { data: games } = await supabase.from('games')
      .select('id, week, home_team, away_team, start_time')
      .eq('week', week)
      .gt('start_time', now);

    if (!games?.length) return res.json({ ok:true, picked:null, reason:'NO_GAMES' });

    // últimas odds por juego
    const ids = games.map(g=>g.id);
    const { data: odds } = await supabase.from('odds')
      .select('game_id, spread_home, spread_away, ml_home, ml_away, fetched_at')
      .in('game_id', ids)
      .order('fetched_at', { ascending:false });

    const lastByGame = {};
    (odds||[]).forEach(o=>{ if(!lastByGame[o.game_id]) lastByGame[o.game_id]=o; });

    // ranking por "favorito más fuerte" (spread más negativo o moneyline más bajo)
    const candidates = [];
    for (const g of games) {
      const o = lastByGame[g.id] || {};
      // strength: priorizamos spread; si no hay, usamos moneyline
      const homeStrength = (o.spread_home != null) ? -o.spread_home : (o.ml_home != null ? Math.sign(o.ml_home)*-Math.abs(o.ml_home) : -Infinity);
      const awayStrength = (o.spread_away != null) ? -o.spread_away : (o.ml_away != null ? Math.sign(o.ml_away)*-Math.abs(o.ml_away) : -Infinity);
      if (!used.has(g.home_team)) candidates.push({ team:g.home_team, game:g, strength:homeStrength });
      if (!used.has(g.away_team)) candidates.push({ team:g.away_team, game:g, strength:awayStrength });
    }

    if (!candidates.length) return res.json({ ok:true, picked:null, reason:'NO_AVAILABLE_TEAMS' });

    candidates.sort((a,b)=>b.strength - a.strength);
    const best = candidates[0];

    // upsert pick
    const { data: existing } = await supabase.from('picks').select('id')
      .eq('user_id', user_id).eq('week', week).maybeSingle();

    if (existing?.id) {
      const { error } = await supabase.from('picks')
        .update({ team_id: best.team, game_id: best.game.id, auto_pick:true, updated_at:new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('picks').insert({
        user_id, week, season:2025, game_id: best.game.id, team_id: best.team, auto_pick:true
      });
      if (error) throw error;
    }

    return res.json({ ok:true, picked: { team: best.team, game_id: best.game.id } });
  } catch (e) {
    console.error(e); return res.status(500).json({ ok:false, error:e.message });
  }
}
