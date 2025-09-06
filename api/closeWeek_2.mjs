// api/closeWeek.mjs
import 'node-fetch';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const { token, week } = req.query || {};
    if (!token || token !== process.env.CRON_TOKEN) {
      return res.status(401).json({ ok:false, error:'Bad token' });
    }
    const W = Number(week);
    if (!W) return res.status(400).json({ ok:false, error:'Missing week' });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    // 1) Juegos finales de la semana
    const { data: games, error: e1 } = await supabase
      .from('games')
      .select('id, home_team, away_team, home_score, away_score, status')
      .eq('week', W)
      .eq('status', 'final');
    if (e1) return res.status(500).json({ ok:false, error:e1.message });

    const winners = new Map();
    games.forEach(g => {
      const hs = g.home_score ?? 0, as = g.away_score ?? 0;
      if (hs === as) winners.set(g.id, 'push');
      else winners.set(g.id, hs > as ? g.home_team : g.away_team);
    });

    // 2) Picks de la semana
    const { data: picks, error: e2 } = await supabase
      .from('picks')
      .select('id, user_id, game_id, team_id, result')
      .eq('week', W);
    if (e2) return res.status(500).json({ ok:false, error:e2.message });

    // 3) Calificar picks
    const updates = [];
    const userDelta = {}; // user_id -> {wins, losses, pushes, livesDelta}
    for (const p of picks || []) {
      if (!winners.has(p.game_id)) continue; // juego no final
      const win = winners.get(p.game_id);
      let result = 'pending';
      if (win === 'push') result = 'push';
      else if (win === p.team_id) result = 'win';
      else result = 'loss';
      if (p.result !== result) {
        updates.push({ id: p.id, result });
      }
      if (!userDelta[p.user_id]) userDelta[p.user_id] = { wins:0, losses:0, pushes:0, livesDelta:0 };
      if (result === 'win') userDelta[p.user_id].wins++;
      if (result === 'loss') { userDelta[p.user_id].losses++; userDelta[p.user_id].livesDelta -= 1; }
      if (result === 'push') userDelta[p.user_id].pushes++;
    }
    if (updates.length) {
      const { error: eU } = await supabase.from('picks').upsert(updates);
      if (eU) return res.status(500).json({ ok:false, error:eU.message });
    }

    // 4) Actualizar standings
    const patches = [];
    for (const [uid, d] of Object.entries(userDelta)) {
      patches.push({
        user_id: uid,
        wins: d.wins,
        losses: d.losses,
        pushes: d.pushes,
        lives: d.livesDelta, // lo sumamos con RPC
      });
    }

    // aplicamos con SQL simple: sumas
    for (const p of patches) {
      // lives: decrementa si es negativo
      if (p.lives) {
        await supabase.rpc('increment_lives', { u_user_id: p.user_id, delta: p.lives });
      }
      if (p.wins || p.losses || p.pushes) {
        await supabase.rpc('add_results', { u_user_id: p.user_id, w: p.wins||0, l: p.losses||0, pu: p.pushes||0 });
      }
    }

    return res.json({ ok:true, graded: updates.length, users: Object.keys(userDelta).length });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
