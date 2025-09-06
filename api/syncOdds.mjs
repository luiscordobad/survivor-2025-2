// /api/syncOdds.mjs
// Obtiene spreads / moneyline / total desde The Odds API y los inserta en la tabla 'odds'.
// Empata juegos por alias: abreviatura (DAL) -> nombre proveedor ("Dallas Cowboys").

import { createClient } from '@supabase/supabase-js';

const TEAM_ALIAS = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB:  "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC:  "Kansas City Chiefs",
  LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  LV:  "Las Vegas Raiders",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE:  "New England Patriots",
  NO:  "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks",
  SF:  "San Francisco 49ers",
  TB:  "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders"
};

// devuelve primer market que exista
function pickMarket(markets, key) {
  return markets.find(m => m.key === key);
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const week = Number(url.searchParams.get('week') || '1');
    const debug = url.searchParams.get('debug') === '1';

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

    // 1) Juegos de la semana
    const { data: games } = await supabase
      .from('games')
      .select('id, week, home_team, away_team, start_time')
      .eq('week', week);

    if (!games?.length) {
      return res.json({ ok:true, inserted:0, msg:'No games for this week' });
    }

    // 2) Llamada a The Odds API
    // Doc: https://the-odds-api.com/
    const apiKey = process.env.ODDS_API_KEY;
    const markets = 'spreads,h2h,totals';
    const regions = 'us';
    const oddsUrl =
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?regions=${regions}&markets=${markets}&oddsFormat=american&dateFormat=iso&apiKey=${apiKey}`;
    const oddsResp = await fetch(oddsUrl);
    if (!oddsResp.ok) {
      const text = await oddsResp.text();
      return res.status(502).json({ ok:false, error:'Odds provider error', detail:text });
    }
    const oddsData = await oddsResp.json(); // array de eventos

    // 3) Indexar por equipos proveedor
    // Cada item: { home_team, away_team, bookmakers: [{title, markets:[{key,outcomes:[...]}, ...]}] }
    // Haremos una estructura por "home x away".
    const providerEvents = {};
    for (const ev of oddsData || []) {
      const key = `${ev.away_team}__${ev.home_team}`;
      providerEvents[key] = ev;
    }

    // 4) Match por alias y preparacion de inserts
    const toInsert = [];
    const notMatched = [];
    const matched = [];

    for (const g of games) {
      const awayName = TEAM_ALIAS[g.away_team] || g.away_team;
      const homeName = TEAM_ALIAS[g.home_team] || g.home_team;

      const ev = providerEvents[`${awayName}__${homeName}`]
              || providerEvents[`${homeName}__${awayName}`]; // por si acaso invertido

      if (!ev) {
        notMatched.push({ game_id: g.id, away: g.away_team, home: g.home_team });
        continue;
      }
      matched.push({ game_id: g.id, away: awayName, home: homeName });

      // Usamos el primer bookmaker con markets disponibles
      const bk = (ev.bookmakers || [])[0];
      if (!bk) continue;

      const spreads = pickMarket(bk.markets || [], 'spreads');
      const moneyline = pickMarket(bk.markets || [], 'h2h');
      const totals = pickMarket(bk.markets || [], 'totals');

      // Outcomes: cada uno tiene name = team name; point = spread/total; price = ML
      let ml_home = null, ml_away = null, spread_home = null, spread_away = null, total = null;

      if (moneyline?.outcomes) {
        for (const o of moneyline.outcomes) {
          if (o.name === homeName) ml_home = o.price ?? null;
          if (o.name === awayName) ml_away = o.price ?? null;
        }
      }

      if (spreads?.outcomes) {
        for (const o of spreads.outcomes) {
          if (o.name === homeName) spread_home = o.point ?? null;
          if (o.name === awayName) spread_away = o.point ?? null;
        }
      }

      if (totals?.outcomes) {
        // totals suele tener "Over" y "Under" con el mismo point
        const first = totals.outcomes[0];
        total = first?.point ?? null;
      }

      toInsert.push({
        game_id: g.id,
        spread_home,
        spread_away,
        ml_home,
        ml_away,
        total,
        book: bk.title || 'book',
        fetched_at: new Date().toISOString()
      });
    }

    // 5) Insertar
    let inserted = 0;
    for (const row of toInsert) {
      const { error } = await supabase.from('odds').insert(row);
      if (!error) inserted++;
    }

    if (debug) {
      return res.json({
        ok: true,
        inserted,
        matchedCount: matched.length,
        notMatchedCount: notMatched.length,
        matchedSample: matched.slice(0,5),
        notMatchedSample: notMatched.slice(0,5)
      });
    }

    return res.json({ ok:true, inserted });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:e.message });
  }
}
