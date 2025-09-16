// api/syncWeek.mjs
import { createClient } from '@supabase/supabase-js';

// === ENV ===
const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN     = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;
const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.VITE_ODDS_API_KEY || null;

const FIXED_SEASON = 2025; // respeta tu CHECK (season = 2025)

// === Supabase (service role porque escribimos varias tablas) ===
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// === Utils básicos ===
async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'SurvivorSync/1.1', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}
const U = (s) => String(s || '').toUpperCase().trim();

function mapStatus(src) {
  const t = (src?.status?.type?.name || '').toUpperCase();
  if (t.includes('FINAL')) return 'final';
  if (t.includes('IN') || t.includes('LIVE')) return 'in_progress';
  if (t.includes('POST')) return 'final';
  return 'scheduled';
}

// === City por equipo (para clima) + nombre oficial para odds ===
const TEAM_META = {
  ARI: { city: 'Glendale, AZ', oddsName: 'Arizona Cardinals' },
  ATL: { city: 'Atlanta, GA', oddsName: 'Atlanta Falcons' },
  BAL: { city: 'Baltimore, MD', oddsName: 'Baltimore Ravens' },
  BUF: { city: 'Orchard Park, NY', oddsName: 'Buffalo Bills' },
  CAR: { city: 'Charlotte, NC', oddsName: 'Carolina Panthers' },
  CHI: { city: 'Chicago, IL', oddsName: 'Chicago Bears' },
  CIN: { city: 'Cincinnati, OH', oddsName: 'Cincinnati Bengals' },
  CLE: { city: 'Cleveland, OH', oddsName: 'Cleveland Browns' },
  DAL: { city: 'Arlington, TX', oddsName: 'Dallas Cowboys' },
  DEN: { city: 'Denver, CO', oddsName: 'Denver Broncos' },
  DET: { city: 'Detroit, MI', oddsName: 'Detroit Lions' },
  GB:  { city: 'Green Bay, WI', oddsName: 'Green Bay Packers' },
  HOU: { city: 'Houston, TX', oddsName: 'Houston Texans' },
  IND: { city: 'Indianapolis, IN', oddsName: 'Indianapolis Colts' },
  JAX: { city: 'Jacksonville, FL', oddsName: 'Jacksonville Jaguars' },
  KC:  { city: 'Kansas City, MO', oddsName: 'Kansas City Chiefs' },
  LV:  { city: 'Las Vegas, NV', oddsName: 'Las Vegas Raiders' },
  LAC: { city: 'Inglewood, CA', oddsName: 'Los Angeles Chargers' },
  LAR: { city: 'Inglewood, CA', oddsName: 'Los Angeles Rams' },
  MIA: { city: 'Miami Gardens, FL', oddsName: 'Miami Dolphins' },
  MIN: { city: 'Minneapolis, MN', oddsName: 'Minnesota Vikings' },
  NE:  { city: 'Foxborough, MA', oddsName: 'New England Patriots' },
  NO:  { city: 'New Orleans, LA', oddsName: 'New Orleans Saints' },
  NYG: { city: 'East Rutherford, NJ', oddsName: 'New York Giants' },
  NYJ: { city: 'East Rutherford, NJ', oddsName: 'New York Jets' },
  PHI: { city: 'Philadelphia, PA', oddsName: 'Philadelphia Eagles' },
  PIT: { city: 'Pittsburgh, PA', oddsName: 'Pittsburgh Steelers' },
  SEA: { city: 'Seattle, WA', oddsName: 'Seattle Seahawks' },
  SF:  { city: 'Santa Clara, CA', oddsName: 'San Francisco 49ers' },
  TB:  { city: 'Tampa, FL', oddsName: 'Tampa Bay Buccaneers' },
  TEN: { city: 'Nashville, TN', oddsName: 'Tennessee Titans' },
  WAS: { city: 'Landover, MD', oddsName: 'Washington Commanders' }
};

// === CLIMA ===
function dayStr(iso) { return String(iso).slice(0,10); }

async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const j = await fetchJSON(url);
  const r = j?.results?.[0];
  return r ? { lat: r.latitude, lon: r.longitude } : null;
}

async function fetchWeatherAt(city, kickoffISO) {
  const geo = await geocodeCity(city);
  if (!geo) return null;
  const day = dayStr(kickoffISO);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&hourly=temperature_2m,precipitation,wind_speed_10m&temperature_unit=celsius&windspeed_unit=kmh&precipitation_unit=mm&timezone=UTC&start_date=${day}&end_date=${day}`;
  const j = await fetchJSON(url);
  const times = j?.hourly?.time || [];
  const t = j?.hourly?.temperature_2m || [];
  const p = j?.hourly?.precipitation || [];
  const w = j?.hourly?.wind_speed_10m || [];
  if (!times.length) return null;

  const targetMs = new Date(kickoffISO).getTime();
  let best = 0, diff = Infinity;
  times.forEach((ts,i) => {
    const d = Math.abs(new Date(ts).getTime() - targetMs);
    if (d < diff) { best = i; diff = d; }
  });

  return {
    temp_c: Math.round((t[best] ?? 0) * 10) / 10,
    precip_mm: Math.round((p[best] ?? 0) * 10) / 10,
    wind_kph: Math.round((w[best] ?? 0) * 10) / 10,
    condition: ''
  };
}

// === ODDS (opcional) ===
async function fetchOddsSnapshot() {
  if (!THE_ODDS_API_KEY) return null;
  const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?regions=us&markets=h2h,spreads&oddsFormat=american&apiKey=${THE_ODDS_API_KEY}`;
  try { return await fetchJSON(url); } catch { return null; }
}
function pickBookmaker(ev, preferred = ['pinnacle','draftkings','betonlineag','fanduel']) {
  const books = ev.bookmakers || [];
  for (const key of preferred) {
    const b = books.find(x => x.key === key);
    if (b) return b;
  }
  return books[0] || null;
}
function extractLines(ev, homeName, awayName) {
  const book = pickBookmaker(ev);
  if (!book) return null;
  let spread_home=null, spread_away=null, ml_home=null, ml_away=null;
  const spreads = (book.markets || []).find(m => m.key === 'spreads');
  if (spreads?.outcomes) {
    for (const o of spreads.outcomes) {
      if (o.name === homeName) spread_home = o.point;
      if (o.name === awayName) spread_away = o.point;
    }
  }
  const h2h = (book.markets || []).find(m => m.key === 'h2h');
  if (h2h?.outcomes) {
    for (const o of h2h.outcomes) {
      if (o.name === homeName) ml_home = o.price;
      if (o.name === awayName) ml_away = o.price;
    }
  }
  return { spread_home, spread_away, ml_home, ml_away };
}

// === HANDLER ===
export default async function handler(req, res) {
  try {
    const { token, week } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok:false, error:'bad token' });

    const weekNum = Number(week || '1');

    // 1) ESPN — juegos por semana
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${FIXED_SEASON}&week=${weekNum}`;
    const json = await fetchJSON(url);
    const events = json?.events || [];

    // 2) Odds (si hay API key)
    const oddsAll = await fetchOddsSnapshot();

    let upsertsGames = 0;
    let upsertsMeta = 0;
    let upsertsWeather = 0;
    let upsertsOdds = 0;
    let insertsOddsHist = 0;

    for (const ev of events) {
      try {
        const comp  = ev?.competitions?.[0] || {};
        const comps = comp?.competitors || [];
        const home  = comps.find(c => (c.homeAway || c.homeaway) === 'home');
        const away  = comps.find(c => (c.homeAway || c.homeaway) === 'away');

        // ID del juego
        const gameId = String(ev?.id || comp?.id || '');
        if (!gameId) continue;

        // Teams abreviación (deben existir en public.teams.id)
        const home_id = U(home?.team?.abbreviation);
        const away_id = U(away?.team?.abbreviation);
        if (!home_id || !away_id) continue;

        // 2.1 Upsert GAMES
        const row = {
          id: gameId,
          week: weekNum,
          season: FIXED_SEASON,
          start_time: comp?.date || ev?.date,
          home_team: home_id,
          away_team: away_id,
          status: mapStatus(comp || ev),
          home_score: home?.score != null ? Number(home.score) : null,
          away_score: away?.score != null ? Number(away.score) : null,
          external_id: String(ev?.id || comp?.id || ''),
          updated_at: new Date().toISOString()
        };
        const { error: gErr } = await sb.from('games').upsert(row, { onConflict: 'id' });
        if (gErr) throw gErr;
        upsertsGames++;

        // 2.2 Upsert GAME_META (al menos city)
        const homeCity = TEAM_META[home_id]?.city || null;
        const awayCity = TEAM_META[away_id]?.city || null;
        if (homeCity || awayCity) {
          const { error: mErr } = await sb.from('game_meta').upsert({
            game_id: gameId,
            stadium: null,
            city: homeCity || awayCity || null,
            tv: null
          }, { onConflict: 'game_id' });
          if (mErr) throw mErr;
          upsertsMeta++;
        }

        // 2.3 WEATHER
        const kickoffISO = row.start_time;
        const city = homeCity || awayCity;
        if (city && kickoffISO) {
          const w = await fetchWeatherAt(city, kickoffISO);
          if (w) {
            const { error: wErr } = await sb.from('weather').upsert({
              game_id: gameId,
              ...w,
              updated_at: new Date().toISOString()
            }, { onConflict: 'game_id' });
            if (wErr) throw wErr;
            upsertsWeather++;
          }
        }

        // 2.4 ODDS (si tenemos snapshot y nombres)
        if (oddsAll && TEAM_META[home_id]?.oddsName && TEAM_META[away_id]?.oddsName) {
          const homeName = TEAM_META[home_id].oddsName;
          const awayName = TEAM_META[away_id].oddsName;
          const evOdds = oddsAll.find(e =>
            (e.home_team === homeName && e.away_team === awayName) ||
            (e.home_team === awayName && e.away_team === homeName)
          );
          if (evOdds) {
            const lines = extractLines(evOdds, homeName, awayName);
            if (lines) {
              const fetched_at = new Date().toISOString();
              const { error: oErr } = await sb.from('odds').upsert({ game_id: gameId, ...lines, fetched_at }, { onConflict: 'game_id' });
              if (oErr) throw oErr;
              upsertsOdds++;

              // historial
              const { error: ohErr } = await sb.from('odds_history').insert({ game_id: gameId, ...lines, fetched_at });
              if (ohErr) throw ohErr;
              insertsOddsHist++;
            }
          }
        }

      } catch (perGameErr) {
        // No reventar todo; loguea y sigue con el siguiente juego
        console.error('syncWeek per-game error:', perGameErr.message);
      }
    }

    return res.json({
      ok: true,
      action: 'syncWeek',
      season: FIXED_SEASON,
      week: weekNum,
      games_upserted: upsertsGames,
      meta_upserted: upsertsMeta,
      weather_upserted: upsertsWeather,
      odds_upserted: upsertsOdds,
      odds_history_inserted: insertsOddsHist
    });

  } catch (e) {
    console.error('syncWeek error:', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}
