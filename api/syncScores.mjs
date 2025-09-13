// api/syncScores.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;
const SEASON       = Number(process.env.SEASON || '2025');

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'SurvivorSync/1.0', 'Accept':'application/json' }});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}
const U = (s) => String(s || '').toUpperCase().trim();

function asYMD(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
function mapStatus(es) {
  const t = (es?.status?.type?.name || '').toUpperCase();
  if (t.includes('FINAL')) return 'final';
  if (t.includes('IN') || t.includes('LIVE')) return 'in_progress';
  if (t.includes('POST')) return 'final';
  return 'scheduled';
}

async function updateFromScoreboard(ymd, games) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${ymd}`;
  const sbJson = await fetchJSON(url);
  const events = sbJson?.events || [];
  let updated = 0;

  for (const g of games) {
    const home = U(g.home_team), away = U(g.away_team);
    const start = new Date(g.start_time).getTime();

    const ev = events.find(ev => {
      const cmp = ev?.competitions?.[0];
      const comps = cmp?.competitors || [];
      const H = U((comps.find(c=> (c.homeAway||c.homeaway)==='home')?.team?.abbreviation));
      const A = U((comps.find(c=> (c.homeAway||c.homeaway)==='away')?.team?.abbreviation));
      const dt = new Date(cmp?.date || ev?.date || g.start_time).getTime();
      return H === home && A === away && Math.abs(dt - start) < 6*3600*1000;
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
    }
  }

  return updated;
}

async function syncScoresWeek(week) {
  // toma juegos de esa semana
  const { data: games } = await sb
    .from('games')
    .select('id, home_team, away_team, start_time, status')
    .eq('season', SEASON)
    .eq('week', week);

  if (!games?.length) return { updated: 0, weeks: [week] };

  // agrupa por día y actualiza por scoreboard por fecha
  const byDay = {};
  for (const g of games) {
    const ymd = asYMD(g.start_time);
    if (!byDay[ymd]) byDay[ymd] = [];
    byDay[ymd].push(g);
  }

  let total = 0;
  for (const [ymd, gs] of Object.entries(byDay)) {
    total += await updateFromScoreboard(ymd, gs);
  }
  return { updated: total, weeks: [week] };
}

export default async function handler(req, res) {
  try {
    const { token, week } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok:false, error:'bad token' });
    const wk = Number(week || '1');
    const r = await syncScoresWeek(wk);
    return res.json({ ok:true, action:'syncScores', ...r });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
