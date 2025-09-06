// api/autopick.mjs
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const week = Number(url.searchParams.get('week') || '1');

    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // jugadores y quienes faltan
    const { data: players, error: e1 } = await supabase.from('standings').select('user_id');
    if (e1) throw e1;
    const ids = players.map(p=>p.user_id);

    const { data: existing } = await supabase.from('picks').select('user_id').eq('week', week);
    const already = new Set((existing||[]).map(x=>x.user_id));
    const pending = ids.filter(id=>!already.has(id));
    if (!pending.length) return res.json({ ok:true, msg:'Nada que hacer' });

    // juegos abiertos
    const nowISO = new Date().toISOString();
    const { data: games, error: e2 } = await supabase
      .from('games').select('*').eq('week', week).gt('start_time', nowISO).order('start_time');
    if (e2) throw e2;
    if (!games || !games.length) return res.json({ ok:true, msg:'No hay juegos abiertos' });

    // ranking favorito más fuerte
    const rank = (g) => (typeof g.favorite_strength === 'number' ? g.favorite_strength : 0);
    const sorted = games.slice().sort((a,b)=>rank(b)-rank(a));

    const usedByUser = async (user_id) => {
      const { data: pk } = await supabase.from('picks').select('team_id').eq('user_id', user_id);
      return new Set((pk||[]).map(x=>x.team_id));
    };

    const inserts = [];
    for (const user_id of pending) {
      const used = await usedByUser(user_id);
      let choice = null;

      for (const g of sorted) {
        const fav = g.favorite_team || g.home_team;
        const alt = fav === g.home_team ? g.away_team : g.home_team;
        for (const t of [fav, alt]) {
          if (!used.has(t)) { choice = { game_id: g.id, team_id: t }; break; }
        }
        if (choice) break;
      }

      if (choice) {
        inserts.push({ user_id, week, season: 2025, game_id: choice.game_id, team_id: choice.team_id, auto_pick: true });
      }
    }

    if (inserts.length) {
      const { error: e3 } = await supabase.from('picks').insert(inserts);
      if (e3) throw e3;
    }

    return res.json({ ok:true, inserted: inserts.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, error: err.message });
  }
}

