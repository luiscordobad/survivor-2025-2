// api/syncScores.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;
const SEASON       = Number(process.env.SEASON || '2025');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn('[syncScores] Falta SUPABASE_URL o SERVICE_KEY en env.');
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'SurvivorSync/1.1', 'Accept': 'application/json' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

const U = (s) => String(s || '').toUpperCase().trim();

function formatYMD(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// A partir de un ISO, devuelve YYYYMMDD (UTC)
function asYMD(iso) {
  const d = new Date(iso);
  return formatYMD(d);
}

// Dado un YMD (YYYYMMDD), devuelve YMD desplazado delta días en UTC
function ymdShift(ymd, delta) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return formatYMD(date);
}

function mapStatus(es) {
  const t = (es?.status?.type?.name || '').toUpperCase();
  if (t.includes('FINAL')) return 'final';
  if (t.includes('IN') || t.includes('LIVE')) return 'in_progress';
  if (t.includes('POST')) return 'final';
  return 'scheduled';
}

async function fetchScoreboard(ymd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${ymd}`;
  return fetchJSON(url);
}

/**
 * Descarga scoreboards de varios días (p. ej. [D-1, D, D+1]) y busca los juegos por
 * (home, away, fecha cercana). Actualiza status y marcadores en la tabla `games`.
 */
async function updateFromScoreboards(ymds, games) {
  const boards = await Promise.all(ymds.map(fetchScoreboard));
  const allEvents = boards.flatMap(b => b?.events || []);
  let updated = 0;

  for (const g of games) {
    const home = U(g.home_team);
    const away = U(g.away_team);
    const start = new Date(g.start_time).getTime();

    const ev = allEvents.find(ev => {
      const cmp = ev?.competitions?.[0];
      const comps = cmp?.competitors || [];
      const H = U((comps.find(c => (c.homeAway || c.homeaway) === 'home')?.team?.abbreviation));
      const A = U((comps.find(c => (c.homeAway || c.homeaway) === 'away')?.team?.abbreviation));
      const dt = new Date(cmp?.date || ev?.date || g.start_time).getTime();
      // Coincidencia por equipos y que el kickoff esté dentro de ±6h
      return H === home && A === away && Math.abs(dt - start) < 6 * 3600 * 1000;
    });

    if (!ev) continue;

    const cmp = ev?.competitions?.[0];
    const comps = cmp?.competitors || [];
    const homeC = comps.find(c => (c.homeAway || c.homeaway) === 'home');
    const awayC = comps.find(c => (c.homeAway || c.homeaway) === 'away');

    const status = mapStatus(cmp || ev);
    const homeScore = homeC?.score != null ? Number(homeC.score) : null;
    const awayScore = awayC?.score != null ? Number(awayC.score) : null;

    const patch = {};
    if (status && status !== g.status) patch.status = status;
    if (homeScore != null) patch.home_score = homeScore;
    if (awayScore != null) patch.away_score = awayScore;

    if (Object.keys(patch).length) {
      const { error } = await sb.from('games').update(patch).eq('id', g.id);
      if (!error) updated++;
      else console.warn('[syncScores] Update error for game', g.id, error.message);
    }
  }

  return updated;
}

async function syncScoresWeek(week) {
  const { data: games, error } = await sb
    .from('games')
    .select('id, home_team, away_team, start_time, status, season, week')
    .eq('season', SEASON)
    .eq('week', week);

  if (error) throw new Error(`Supabase select games: ${error.message}`);
  if (!games?.length) return { updated: 0, weeks: [week] };

  // Agrupamos por YMD base y consultamos tríos [D-1, D, D+1] para cubrir desfases UTC
  const byDay = {};
  for (const g of games) {
    const base = asYMD(g.start_time);
    if (!byDay[base]) byDay[base] = [];
    byDay[base].push(g);
  }

  let total = 0;
  for (const [ymd, gs] of Object.entries(byDay)) {
    const neighbors = [ymdShift(ymd, -1), ymd, ymdShift(ymd, 1)];
    total += await updateFromScoreboards(neighbors, gs);
  }
  return { updated: total, weeks: [week] };
}

export default async function handler(req, res) {
  try {
    const { token, week } = req.query || {};
    if (!token || token !== CRON_TOKEN) {
      return res.status(401).json({ ok: false, error: 'bad token' });
    }

    const wk = Number(week || '1');
    const r = await syncScoresWeek(wk);

    return res.status(200).json({ ok: true, action: 'syncScores', ...r });
  } catch (e) {
    console.error('[syncScores] ERROR:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
