// api/syncWeek.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;

const FIXED_SEASON = 2025; // tu tabla tiene CHECK season = 2025

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

/* ===================== utils ===================== */
async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'SurvivorSync/1.1', 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}
const U    = (s) => String(s || '').toUpperCase().trim();
const num  = (x) => (x == null || x === '' ? null : Number(x));
const pct  = (x) => (x == null || x === '' ? null : Math.round(Number(x) * 100) / 100);

function mapStatus(src) {
  const t = (src?.status?.type?.name || '').toUpperCase();
  if (t.includes('FINAL')) return 'final';
  if (t.includes('IN') || t.includes('LIVE')) return 'in_progress';
  if (t.includes('POST')) return 'final';
  return 'scheduled';
}

async function fetchSummary(gameId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
  return fetchJSON(url);
}

/* ========== ESPN team stats (temporada regular) ========== */
async function fetchEspnTeamStats(year, espnTeamId) {
  // type=2: regular season
  const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/types/2/teams/${espnTeamId}/statistics`;
  const j = await fetchJSON(url);
  const flat = {};
  for (const cat of j?.splits?.categories || []) {
    for (const st of cat?.stats || []) {
      const k = (st?.name || '').toLowerCase();
      flat[k] = st?.value ?? null;
    }
  }
  // Mapea nombres de ESPN -> tus columnas
  return {
    ppg:        num(flat['pointspergame']),
    ypg:        num(flat['yardspergame']),
    pass_ypg:   num(flat['passingyardspergame']),
    rush_ypg:   num(flat['rushingyardspergame']),
    opp_ppg:    num(flat['opponentspointspergame']),
    opp_ypg:    num(flat['opponentsyardspergame']),
    third_down: pct(flat['thirddownconversionpercent'] ?? flat['thirddownconversionpct']),
    red_zone:   pct(flat['redzonescoringpercent'] ?? flat['redzonescorespct']),
    to_diff:    num(flat['turnovermarginpergame'] ?? flat['turnovermargin']),
    sacks:      num(flat['sacks']),
  };
}

/* ========== Líderes: boxscore (si hay) o teamLeaders (pregame) ========== */
function leadersFromSummaryFlexible(summary, homeAbbr, awayAbbr) {
  const out = [];

  // 1) Leaders del boxscore (en vivo / final)
  try {
    const cats = summary?.leaders || [];
    for (const cat of cats) {
      const statName = cat?.displayName || cat?.name || 'Leader';
      for (const b of cat?.leaders || []) {
        const abbr = U(b?.team?.abbreviation || b?.team?.shortDisplayName);
        const side = abbr === homeAbbr ? 'home' : (abbr === awayAbbr ? 'away' : null);
        if (!side) continue;
        const l0 = b?.leaders?.[0];
        if (!l0) continue;
        const player = l0?.athlete?.shortName || l0?.athlete?.displayName || '—';
        const value  = l0?.value != null ? String(l0.value) : (l0?.stats?.join(' ') || '—');
        out.push({ side, player, stat: statName, value });
      }
    }
    if (out.length) return out;
  } catch {}

  // 2) teamLeaders (temporada a la fecha) cuando no hay boxscore todavía
  try {
    for (const tl of summary?.teamLeaders || []) {
      const abbr = U(tl?.team?.abbreviation || tl?.team?.shortDisplayName);
      const side = abbr === homeAbbr ? 'home' : (abbr === awayAbbr ? 'away' : null);
      if (!side) continue;
      for (const grp of tl?.leaders || []) {
        const statName = grp?.name || grp?.displayName || 'Leader';
        const p0 = grp?.leaders?.[0];
        if (!p0) continue;
        const player = p0?.athlete?.shortName || p0?.athlete?.displayName || '—';
        const value  = p0?.displayValue || p0?.value || (p0?.statistics?.map(s => s.displayValue).join(' ') || '—');
        out.push({ side, player, stat: statName, value: String(value) });
      }
    }
  } catch {}

  return out;
}

/* ========== Lesiones desde summary (opcional) ========== */
function injuriesFromSummary(summary) {
  const rows = [];
  try {
    for (const grp of summary?.injuries || []) {
      const teamAbbr = U(grp?.team?.abbreviation || grp?.team?.shortDisplayName);
      for (const item of grp?.injuries || []) {
        rows.push({
          team_id: teamAbbr,
          player: item?.athlete?.shortName || item?.athlete?.displayName || '—',
          status: item?.status || item?.type || item?.details || '—',
          note: item?.details || ''
        });
      }
    }
  } catch {}
  return rows;
}

/* ========== Últimos 5 por equipo (a partir de tu tabla 'games') ========== */
async function recomputeRecent5ForTeams(teamIds) {
  const unique = [...new Set(teamIds.filter(Boolean))];
  for (const team of unique) {
    // Lee juegos de la temporada actual donde participa el equipo
    const { data: gs } = await sb
      .from('games')
      .select('id,start_time,home_team,away_team,home_score,away_score,status')
      .eq('season', FIXED_SEASON)
      .or(`home_team.eq.${team},away_team.eq.${team}`)
      .order('start_time', { ascending: false })
      .limit(20);

    const rows = [];
    for (const g of (gs || [])) {
      // Solo considerar si ya tiene score (para W/L) — si quieres incluir scheduled, cambia aquí
      const ended = String(g.status || '').toLowerCase() === 'final';
      const hs = num(g.home_score) ?? 0;
      const as = num(g.away_score) ?? 0;
      const isHome = g.home_team === team;
      const opp = isHome ? g.away_team : g.home_team;

      let result = '—';
      if (ended) {
        if (hs === as) result = 'T';
        else if ((isHome && hs > as) || (!isHome && as > hs)) result = 'W';
        else result = 'L';
      }

      const score = `${g.away_team} ${as ?? 0} - ${hs ?? 0} ${g.home_team}`;
      rows.push({
        team_id: team,
        date: g.start_time,
        opp,
        is_home: isHome,
        result,
        score
      });
      if (rows.length >= 5) break;
    }

    await sb.from('team_recent_games').delete().eq('team_id', team);
    if (rows.length) await sb.from('team_recent_games').insert(rows);
  }
}

/* ===================== handler ===================== */
export default async function handler(req, res) {
  try {
    const { token, week } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok: false, error: 'bad token' });

    const weekNum = Number(week || '1');

    // ESPN scoreboard por semana
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${FIXED_SEASON}&week=${weekNum}`;
    const json = await fetchJSON(url);
    const events = json?.events || [];

    let upsertsGames = 0;
    let upsertsLeaders = 0;
    let upsertsStats = 0;
    let upsertsInj = 0;

    // Acumularemos teams para recalcular "Últimos 5" al final
    const teamsTouched = [];

    for (const ev of events) {
      const comp  = ev?.competitions?.[0] || {};
      const comps = comp?.competitors || [];
      const home  = comps.find(c => (c.homeAway || c.homeaway) === 'home');
      const away  = comps.find(c => (c.homeAway || c.homeaway) === 'away');

      const gameId   = String(ev?.id || comp?.id || '');
      if (!gameId) continue;

      const home_id  = U(home?.team?.abbreviation);
      const away_id  = U(away?.team?.abbreviation);
      const home_num = home?.team?.id;
      const away_num = away?.team?.id;

      if (!home_id || !away_id) continue;

      teamsTouched.push(home_id, away_id);

      // ---- Upsert de games
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
      {
        const { error } = await sb.from('games').upsert(row, { onConflict: 'id' });
        if (error) throw error;
        upsertsGames++;
      }

      // ---- Stats de temporada por equipo (siempre disponibles)
      try {
        const [homeStats, awayStats] = await Promise.all([
          fetchEspnTeamStats(FIXED_SEASON, home_num),
          fetchEspnTeamStats(FIXED_SEASON, away_num),
        ]);
        if (homeStats) {
          await sb.from('season_team_stats').upsert(
            { team_id: home_id, season: FIXED_SEASON, ...homeStats, updated_at: new Date().toISOString() },
            { onConflict: 'team_id,season' }
          );
          upsertsStats++;
        }
        if (awayStats) {
          await sb.from('season_team_stats').upsert(
            { team_id: away_id, season: FIXED_SEASON, ...awayStats, updated_at: new Date().toISOString() },
            { onConflict: 'team_id,season' }
          );
          upsertsStats++;
        }
      } catch {}

      // ---- Summary: leaders (y lesiones opcional)
      try {
        const summary = await fetchSummary(gameId);
        if (summary) {
          const leaders = leadersFromSummaryFlexible(summary, home_id, away_id);
          await sb.from('game_leaders').delete().eq('game_id', gameId);
          if (leaders.length) {
            const rows = leaders.map(x => ({ game_id: gameId, ...x }));
            await sb.from('game_leaders').insert(rows);
            upsertsLeaders += rows.length;
          }

          // Lesiones (opcional)
          const injRows = injuriesFromSummary(summary);
          if (injRows.length) {
            // limpiamos sólo de esos equipos (para no borrar otros juegos)
            await sb.from('injuries')
              .delete()
              .in('team_id', [...new Set(injRows.map(r => r.team_id))]);
            await sb.from('injuries').insert(injRows);
            upsertsInj += injRows.length;
          }
        }
      } catch {}
    }

    // ---- Recalcula "Últimos 5" para todos los equipos tocados
    await recomputeRecent5ForTeams(teamsTouched);

    return res.json({
      ok: true,
      action: 'syncWeek',
      season: FIXED_SEASON,
      week: weekNum,
      upserts: {
        games: upsertsGames,
        team_stats_rows: upsertsStats,
        game_leaders_rows: upsertsLeaders,
        injuries_rows: upsertsInj
      }
    });
  } catch (e) {
    console.error('syncWeek error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
