// pages/api/sync-week.js
import { createClient } from '@supabase/supabase-js';

const SEASON = process.env.SEASON || 2025;
const SYNC_TOKEN = process.env.SYNC_TOKEN;
const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || null;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

// Cliente con Service Role (para poder escribir sin enredarte con RLS)
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
});

// ====== Mapeo súper simple por equipo (ciudad para clima + nombre para odds) ======
const TEAM_META = {
  ARI: { city: 'Glendale, AZ', oddsName: 'Arizona Cardinals' },
  ATL: { city: 'Atlanta, GA',  oddsName: 'Atlanta Falcons' },
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

// ============ Helpers de clima (Open-Meteo, gratis) ============
async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const r = j?.results?.[0];
  if (!r) return null;
  return { lat: r.latitude, lon: r.longitude };
}

function toISODate(iso) {
  return iso.slice(0, 10);
}

async function fetchWeatherAt(city, kickoffISO) {
  const geo = await geocodeCity(city);
  if (!geo) return null;

  const day = toISODate(kickoffISO); // pedimos solo el día del partido
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&hourly=temperature_2m,precipitation,wind_speed_10m&temperature_unit=celsius&windspeed_unit=kmh&precipitation_unit=mm&timezone=UTC&start_date=${day}&end_date=${day}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();

  const times = j?.hourly?.time || [];
  const temps = j?.hourly?.temperature_2m || [];
  const precs = j?.hourly?.precipitation || [];
  const winds = j?.hourly?.wind_speed_10m || [];

  if (!times.length) return null;

  // Buscamos la hora más cercana al kickoff (en UTC)
  const target = new Date(kickoffISO).toISOString().slice(0, 13); // yyyy-mm-ddThh
  let idx = times.findIndex(t => t.startsWith(target));
  if (idx === -1) {
    // fallback: el índice cuya hora esté más cerca
    const targetMs = new Date(kickoffISO).getTime();
    let best = 0, bestDiff = Infinity;
    times.forEach((t, i) => {
      const diff = Math.abs(new Date(t).getTime() - targetMs);
      if (diff < bestDiff) { best = i; bestDiff = diff; }
    });
    idx = best;
  }

  return {
    temp_c: Math.round((temps[idx] ?? null) * 10) / 10,
    precip_mm: Math.round((precs[idx] ?? null) * 10) / 10,
    wind_kph: Math.round((winds[idx] ?? null) * 10) / 10,
    condition: '' // Open-Meteo en hourly no da “texto”, lo dejamos vacío
  };
}

// ============ Helpers de odds (The Odds API - opcional) ============
async function fetchOddsSnapshot() {
  if (!THE_ODDS_API_KEY) return null;
  // Traemos odds actuales para TODOS los partidos NFL
  const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?regions=us&markets=h2h,spreads&oddsFormat=american&apiKey=${THE_ODDS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data; // array de eventos
}

function pickBookmaker(ev, preferred = ['pinnacle', 'draftkings', 'betonlineag', 'fanduel']) {
  const books = ev.bookmakers || [];
  for (const p of preferred) {
    const b = books.find(x => x.key === p);
    if (b) return b;
  }
  return books[0] || null;
}

function extractLines(ev, homeName, awayName) {
  // ev: evento de The Odds API; buscamos spreads y moneyline del book elegido
  const book = pickBookmaker(ev);
  if (!book) return null;

  let spread_home = null, spread_away = null, ml_home = null, ml_away = null;

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

// ============ API handler ============
export default async function handler(req, res) {
  try {
    // Seguridad básica
    const { token, week: weekStr } = req.query;
    if (!SYNC_TOKEN || token !== SYNC_TOKEN) {
      return res.status(401).json({ ok: false, error: 'bad token' });
    }
    const WEEK = Number(weekStr || 3);

    // 1) Juegos de la semana
    const { data: games, error: gErr } = await sb
      .from('games')
      .select('*')
      .eq('season', SEASON)
      .eq('week', WEEK)
      .order('start_time');

    if (gErr) throw gErr;
    if (!games?.length) return res.json({ ok: true, message: 'No hay juegos para esa semana.' });

    // 2) (Opcional) Traer snapshot de odds de una vez
    const oddsAll = await fetchOddsSnapshot();

    let updated = 0;
    for (const g of games) {
      const game_id = g.id;
      const home = g.home_team;
      const away = g.away_team;

      // --- META (ciudad/estadio básico)
      const homeCity = TEAM_META[home]?.city || null;
      const awayCity = TEAM_META[away]?.city || null;
      // Guardamos solo city y tv vacía (tv la puedes completar luego si quieres)
      await sb.from('game_meta').upsert({
        game_id,
        stadium: null,
        city: homeCity || awayCity || null,
        tv: null
      });

      // --- CLIMA
      const cityForWeather = homeCity || awayCity;
      if (cityForWeather) {
        const w = await fetchWeatherAt(cityForWeather, g.start_time);
        if (w) {
          await sb.from('weather').upsert({
            game_id,
            ...w,
            updated_at: new Date().toISOString()
          });
        }
      }

      // --- ODDS (si hay API key)
      if (oddsAll && TEAM_META[home]?.oddsName && TEAM_META[away]?.oddsName) {
        const homeName = TEAM_META[home].oddsName;
        const awayName = TEAM_META[away].oddsName;

        // buscamos evento por nombres de equipos
        const ev = oddsAll.find(e =>
          (e.home_team === homeName && e.away_team === awayName) ||
          (e.home_team === awayName && e.away_team === homeName)
        );

        if (ev) {
          const lines = extractLines(ev, homeName, awayName);
          if (lines) {
            const fetched_at = new Date().toISOString();
            // upsert "odds" (último snapshot)
            await sb.from('odds').upsert({
              game_id,
              ...lines,
              fetched_at
            });
            // insert "odds_history"
            await sb.from('odds_history').insert({
              game_id,
              ...lines,
              fetched_at
            });
          }
        }
      }

      updated++;
    }

    return res.json({ ok: true, updated, week: Number(weekStr || 3) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
