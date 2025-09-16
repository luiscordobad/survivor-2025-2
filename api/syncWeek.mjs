// api/syncWeek.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;

const FIXED_SEASON = 2025; // tu CHECK season
const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || process.env.VITE_THE_ODDS_API_KEY;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function fetchJSON(url, headers = {}) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'SurvivorSync/1.2',
      'Accept': 'application/json',
      ...headers,
    },
  });
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

// -------- helpers odds ----------
function parseOddsFromTheOddsAPI(game, oddsJson) {
  // Busca mercado NFL – spreads y moneyline entre sportsbooks populares
  // Este formato depende de tu proveedor. Ajusta si tu API devuelve diferente.
  const byGame = (oddsJson || []).find(
    (x) => (U(x?.home_team) === game.home_team && U(x?.away_team) === game.away_team)
  );
  if (!byGame) return null;

  // Elegimos la primera casa disponible (por simplicidad)
  const bk = byGame.bookmakers?.[0];
  if (!bk) return null;

  let spread_home = null,
    spread_away = null,
    ml_home = null,
    ml_away = null;

  for (const mkt of bk.markets || []) {
    const key = (mkt.key || '').toLowerCase();
    if (key === 'spreads') {
      for (const out of mkt.outcomes || []) {
        const team = U(out.name);
        if (team === game.home_team) spread_home = out.point ?? spread_home;
        if (team === game.away_team) spread_away = out.point ?? spread_away;
      }
    } else if (key === 'h2h') {
      for (const out of mkt.outcomes || []) {
        const team = U(out.name);
        if (team === game.home_team) ml_home = out.price ?? ml_home;
        if (team === game.away_team) ml_away = out.price ?? ml_away;
      }
    }
  }

  return { spread_home, spread_away, ml_home, ml_away };
}

// -------- weather (Open-Meteo simple) ----------
async function getWeatherFor(cityText, isoKickoff) {
  if (!cityText || !isoKickoff) return null;
  // Resolución geo muy simplificada (usa Nominatim “free” via open-meteo geocoding)
  try {
    const geo = await fetchJSON(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityText)}&count=1&language=en&format=json`
    );
    const g0 = geo?.results?.[0];
    if (!g0) return null;
    const lat = g0.latitude, lon = g0.longitude;

    // Busca condiciones alrededor de kickoff (hora exacta)
    const dt = new Date(isoKickoff);
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');

    const w = await fetchJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,precipitation,wind_speed_10m,weathercode&start_date=${yyyy}-${mm}-${dd}&end_date=${yyyy}-${mm}-${dd}`
    );

    // busca hora más cercana
    const hours = w?.hourly?.time || [];
    let bestIdx = -1, bestDiff = Infinity;
    for (let i = 0; i < hours.length; i++) {
      const diff = Math.abs(new Date(hours[i]).getTime() - dt.getTime());
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    if (bestIdx < 0) return null;

    return {
      temp_c: w.hourly.temperature_2m?.[bestIdx] ?? null,
      precip_mm: w.hourly.precipitation?.[bestIdx] ?? null,
      wind_kph: w.hourly.wind_speed_10m?.[bestIdx] != null ? Math.round(w.hourly.wind_speed_10m[bestIdx] * 1.60934) : null,
      condition: '', // podrías mapear weathercode si quieres
    };
  } catch {
    return null;
  }
}

// -------- ESPN summary (leaders + injuries + game info extra) ----------
async function fetchSummary(gameId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
    const j = await fetchJSON(url);
    return j;
  } catch {
    return null;
  }
}

function pickAbbrev(teamObj) {
  return U(teamObj?.abbreviation || teamObj?.team?.abbreviation || teamObj?.shortDisplayName || teamObj?.name);
}

function leadersFromSummary(summary, homeId, awayId) {
  const out = [];
  try {
    const cats = summary?.leaders || [];
    for (const cat of cats) {
      const statName = U(cat?.name || cat?.displayName || '');
      for (const teamBlock of cat?.leaders || []) {
        const sideTeamAbbr = pickAbbrev(teamBlock?.team);
        const side = sideTeamAbbr === homeId ? 'home' : sideTeamAbbr === awayId ? 'away' : null;
        if (!side) continue;

        const l0 = teamBlock?.leaders?.[0];
        if (!l0) continue;

        const player = l0?.athlete?.shortName || l0?.athlete?.displayName || l0?.athlete?.fullName || '—';
        const value = l0?.value != null ? String(l0.value) : (l0?.stats?.join(' ') || '—');

        out.push({ side, player, stat: statName || 'LEADER', value });
      }
    }
  } catch {}
  return out;
}

function injuriesFromSummary(summary, homeId, awayId) {
  const rows = [];
  try {
    const inj = summary?.injuries || [];
    for (const block of inj) {
      const tAbbr = pickAbbrev(block?.team);
      const team_id = tAbbr === homeId ? homeId : tAbbr === awayId ? awayId : null;
      if (!team_id) continue;

      for (const it of block?.injuries || []) {
        const player = it?.athlete?.shortName || it?.athlete?.displayName || '—';
        const status = it?.type?.text || it?.status || it?.type?.name || '—';
        const note = it?.details || '';
        rows.push({ team_id, player, status, note });
      }
    }
  } catch {}
  return rows;
}

// -------- season simple team stats (PPG y Opp PPG) ----------
async function computeSeasonStatsForTeams(season, teamIds) {
  const ids = [...new Set(teamIds)];
  if (!ids.length) return [];

  const { data: games, error } = await sb
    .from('games')
    .select('home_team,away_team,home_score,away_score,status')
    .eq('season', season);
  if (error) throw error;

  const agg = new Map(); // team -> { pts:0, ga:0, gp:0 }
  const ensure = (t) => agg.get(t) || (agg.set(t, { pts: 0, ga: 0, gp: 0 }), agg.get(t));

  for (const g of games || []) {
    if (g.home_score == null || g.away_score == null) continue;
    // cuenta aunque no sea FINAL, para no complicarnos (o filtra g.status==='final')
    const h = ensure(g.home_team), a = ensure(g.away_team);
    h.pts += Number(g.home_score); h.ga += Number(g.away_score); h.gp += 1;
    a.pts += Number(g.away_score); a.ga += Number(g.home_score); a.gp += 1;
  }

  const rows = ids.map((t) => {
    const r = agg.get(t) || { pts: 0, ga: 0, gp: 0 };
    const ppg = r.gp ? +(r.pts / r.gp).toFixed(1) : null;
    const opp_ppg = r.gp ? +(r.ga / r.gp).toFixed(1) : null;
    return {
      team_id: t,
      ppg,
      opp_ppg,
      // las demás métricas no las podemos calcular sin yardas: déjalas null
      ypg: null,
      pass_ypg: null,
      rush_ypg: null,
      opp_ypg: null,
      third_down: null,
      red_zone: null,
      to_diff: null,
      sacks: null,
      season,
      updated_at: new Date().toISOString(),
    };
  });

  return rows;
}

// -------- team recent (últimos 5) ----------
async function computeRecentForTeams(season, teamIds) {
  const ids = [...new Set(teamIds)];
  if (!ids.length) return [];

  const { data: games, error } = await sb
    .from('games')
    .select('id,start_time,home_team,away_team,home_score,away_score,status')
    .eq('season', season);
  if (error) throw error;

  const byTeam = new Map();
  for (const t of ids) byTeam.set(t, []);

  for (const g of games || []) {
    for (const side of ['home', 'away']) {
      const team = side === 'home' ? g.home_team : g.away_team;
      if (!byTeam.has(team)) continue;
      const opp = side === 'home' ? g.away_team : g.home_team;
      const is_home = side === 'home';
      let result = '—', score = '—';
      if (g.home_score != null && g.away_score != null) {
        const my = is_home ? g.home_score : g.away_score;
        const op = is_home ? g.away_score : g.home_score;
        result = my === op ? 'T' : (my > op ? 'W' : 'L');
        score = `${my}-${op}`;
      }
      byTeam.get(team).push({
        team_id: team,
        date: g.start_time,
        opp,
        is_home,
        result,
        score,
        game_id: g.id,
      });
    }
  }

  const rows = [];
  for (const [team, arr] of byTeam.entries()) {
    const last5 = arr
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);
    rows.push(...last5);
  }
  return rows;
}

export default async function handler(req, res) {
  try {
    const { token, week } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok: false, error: 'bad token' });

    const weekNum = Number(week || '1');

    // 1) ESPN scoreboard (partidos base)
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${FIXED_SEASON}&week=${weekNum}`;
    const json = await fetchJSON(url);
    const events = json?.events || [];

    let upsertsGames = 0, upsertsMeta = 0, upsertsWeather = 0, upsertsOdds = 0, upsertsOddsHist = 0, upsertsLeaders = 0, upsertsInj = 0;

    const teamsInWeek = new Set();
    const gamesOfWeek = [];

    for (const ev of events) {
      const comp = ev?.competitions?.[0] || {};
      const comps = comp?.competitors || [];
      const home = comps.find(c => (c.homeAway || c.homeaway) === 'home');
      const away = comps.find(c => (c.homeAway || c.homeaway) === 'away');

      const gameId = String(ev?.id || comp?.id || '');
      if (!gameId) continue;

      const home_id = U(home?.team?.abbreviation);
      const away_id = U(away?.team?.abbreviation);
      if (!home_id || !away_id) continue;

      teamsInWeek.add(home_id); teamsInWeek.add(away_id);

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
        updated_at: new Date().toISOString(),
      };

      const gUp = await sb.from('games').upsert(row, { onConflict: 'id' });
      if (gUp.error) throw gUp.error;
      upsertsGames++;
      gamesOfWeek.push({ id: gameId, ...row });

      // 1b) meta (city) – usa venue de ESPN si está disponible
      const city = comp?.venue?.address?.city || comp?.venue?.fullName || '';
      if (city) {
        const mUp = await sb.from('game_meta').upsert(
          { game_id: gameId, city: city, stadium: comp?.venue?.fullName || null, tv: null },
          { onConflict: 'game_id' }
        );
        if (!mUp.error) upsertsMeta++;
      }

      // 1c) clima para la ciudad
      const wx = await getWeatherFor(city, row.start_time);
      if (wx) {
        const wUp = await sb.from('weather').upsert(
          { game_id: gameId, ...wx, updated_at: new Date().toISOString() },
          { onConflict: 'game_id' }
        );
        if (!wUp.error) upsertsWeather++;
      }

      // 1d) odds (si tienes API key)
      if (THE_ODDS_API_KEY) {
        try {
          const odds = await fetchJSON(
            `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?regions=us&markets=h2h,spreads&oddsFormat=american&apiKey=${THE_ODDS_API_KEY}`
          );
          const parsed = parseOddsFromTheOddsAPI(row, odds);
          if (parsed) {
            const payload = {
              game_id: gameId,
              spread_home: parsed.spread_home,
              spread_away: parsed.spread_away,
              ml_home: parsed.ml_home,
              ml_away: parsed.ml_away,
              fetched_at: new Date().toISOString(),
            };
            const o1 = await sb.from('odds').upsert(payload, { onConflict: 'game_id' });
            const o2 = await sb.from('odds_history').insert(payload);
            if (!o1.error) upsertsOdds++;
            if (!o2.error) upsertsOddsHist++;
          }
        } catch { /* no odds */ }
      }

      // 1e) leaders + injuries desde summary
      const summary = await fetchSummary(gameId);
      if (summary) {
        // leaders
        const leaders = leadersFromSummary(summary, home_id, away_id);
        if (leaders.length) {
          // borra previos de ese juego para evitar duplicados
          await sb.from('game_leaders').delete().eq('game_id', gameId);
          const rows = leaders.map((x) => ({ game_id: gameId, ...x }));
          const ins = await sb.from('game_leaders').insert(rows);
          if (!ins.error) upsertsLeaders += rows.length;
        }
        // injuries
        const inj = injuriesFromSummary(summary, home_id, away_id);
        if (inj.length) {
          await sb.from('injuries').delete().in('team_id', [home_id, away_id]); // mantén últimas del día
          const rows = inj.map((x) => x);
          const ins = await sb.from('injuries').insert(rows);
          if (!ins.error) upsertsInj += rows.length;
        }
      }
    }

    // 2) Season stats simples (PPG / Opp PPG) para equipos de la semana
    const teamsList = Array.from(teamsInWeek);
    const statsRows = await computeSeasonStatsForTeams(FIXED_SEASON, teamsList);
    if (statsRows.length) {
      for (const r of statsRows) {
        await sb.from('season_team_stats').upsert(
          r,
          { onConflict: 'team_id' } // si tu PK es (team_id) por temporada; si es (team_id,season) usa onConflict:'team_id,season'
        );
      }
    }

    // 3) Últimos 5 de cada equipo
    const recentRows = await computeRecentForTeams(FIXED_SEASON, teamsList);
    if (recentRows.length) {
      // Borra y reescribe solo de los equipos de esta semana (más seguro y simple)
      await sb.from('team_recent_games').delete().in('team_id', teamsList);
      await sb.from('team_recent_games').insert(recentRows);
    }

    return res.json({
      ok: true,
      action: 'syncWeek+extras',
      season: FIXED_SEASON,
      week: weekNum,
      upserts: {
        games: upsertsGames,
        game_meta: upsertsMeta,
        weather: upsertsWeather,
        odds: upsertsOdds,
        odds_history: upsertsOddsHist,
        game_leaders: upsertsLeaders,
        injuries: upsertsInj,
        season_team_stats: statsRows.length,
        team_recent_games: recentRows.length,
      },
      teams_in_week: teamsList.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
