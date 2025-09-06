// /api/syncOdds.mjs
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const week = Number(url.searchParams.get('week') || '1');

    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ ok:false, error:'UNAUTHORIZED' });
    }
    if (!process.env.ODDS_API_KEY) {
      return res.status(400).json({ ok:false, error:'Missing ODDS_API_KEY' });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    const { data: games } = await supabase
      .from('games')
      .select('id, home_team, away_team, start_time')
      .eq('week', week)
      .order('start_time');

    if (!games?.length) return res.json({ ok:true, inserted: 0, msg: 'No games' });

    const sport = 'americanfootball_nfl';
    const regions = 'us';
    const markets = 'h2h,spreads,totals';

    const resp = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sport}/odds/?regions=${regions}&markets=${markets}&oddsFormat=american&apiKey=${process.env.ODDS_API_KEY}`
    );
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ ok:false, error:`Odds API ${resp.status}: ${text}` });
    }
    const oddsData = await resp.json();

    const normalizeTeam = (s='') => s.trim().toUpperCase();
    const gameByTeams = new Map();
    for (const g of games) {
      const k1 = `${normalizeTeam(g.away_team)}@${normalizeTeam(g.home_team)}`;
      const k2 = `${normalizeTeam(g.home_team)}@${normalizeTeam(g.away_team)}`;
      gameByTeams.set(k1, g);
      gameByTeams.set(k2, g);
    }

    const rows = [];
    for (const ev of oddsData) {
      const key = `${normalizeTeam(ev.away_team)}@${normalizeTeam(ev.home_team)}`;
      const g = gameByTeams.get(key);
      if (!g) continue;

      for (const bm of (ev.bookmakers || [])) {
        const book = bm.title?.toLowerCase() || 'book';
        let spread_home = null, spread_away = null, ml_home = null, ml_away = null, total = null;

        for (const mk of (bm.markets || [])) {
          if (mk.key === 'spreads') {
            const oHome = mk.outcomes.find(o => normalizeTeam(o.name) === normalizeTeam(ev.home_team));
            const oAway = mk.outcomes.find(o => normalizeTeam(o.name) === normalizeTeam(ev.away_team));
            spread_home = oHome?.point ?? spread_home;
            spread_away = oAway?.point ?? spread_away;
          }
          if (mk.key === 'h2h') {
            const oHome = mk.outcomes.find(o => normalizeTeam(o.name) === normalizeTeam(ev.home_team));
            const oAway = mk.outcomes.find(o => normalizeTeam(o.name) === normalizeTeam(ev.away_team));
            ml_home = oHome?.price ?? ml_home;
            ml_away = oAway?.price ?? ml_away;
          }
          if (mk.key === 'totals') {
            const oOver = mk.outcomes.find(o => (o.name || '').toLowerCase().includes('over'));
            total = oOver?.point ?? total;
          }
        }

        rows.push({
          game_id: g.id, // TEXT en tu DB
          book, spread_home, spread_away, ml_home, ml_away, total
        });
      }
    }

    if (!rows.length) return res.json({ ok:true, inserted: 0 });

    const { error: eIns } = await supabase.from('odds').insert(rows);
    if (eIns) throw eIns;

    return res.json({ ok:true, inserted: rows.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, error: err.message });
  }
}
