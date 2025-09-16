// api/syncWeek.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'SurvivorSync/1.0', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}
const U = (s) => String(s || '').toUpperCase().trim();

function mapStatus(es) {
  const t = (es?.status?.type?.name || '').toUpperCase();
  if (t.includes('FINAL')) return 'final';
  if (t.includes('IN') || t.includes('LIVE')) return 'in_progress';
  if (t.includes('POST')) return 'final';
  return 'scheduled';
}

async function importWeek({ season, week }) {
  // Regular Season por year & week
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${season}&week=${week}`;
  const json = await fetchJSON(url);
  const events = json?.events || [];

  const rows = [];

  for (const ev of events) {
    const comp = ev?.competitions?.[0] || {};
    const comps = comp?.competitors || [];
    const home = comps.find(c => (c.homeAway || c.homeaway) === 'home');
    const away = comps.find(c => (c.homeAway || c.homeaway) === 'away');

    const gameId = Number(ev?.id || comp?.id);
    if (!gameId) continue;

    const startISO = comp?.date || ev?.date;

    // Solo columnas mínimas seguras
    rows.push({
      id: gameId,
      season,
      week,
      start_time: startISO,
      status: mapStatus(comp || ev),
      home_team: U(home?.team?.abbreviation),
      away_team: U(away?.team?.abbreviation),
      home_score: home?.score != null ? Number(home.score) : null,
      away_score: away?.score != null ? Number(away.score) : null,
      updated_at: new Date().toISOString(),
    });
  }

  if (!rows.length) return { inserted: 0, updated: 0, count: 0 };

  // Upsert por id (ajusta onConflict si usas otra unique key)
  let ok = 0;
  for (const r of rows) {
    const { error } = await sb.from('games').upsert(r, { onConflict: 'id' });
    if (error) throw error;
    ok++;
  }

  return { inserted_or_updated: ok, count: rows.length };
}

export default async function handler(req, res) {
  try {
    const { token, season, week } = req.query;
    if (!token || token !== CRON_TOKEN) {
      return res.status(401).json({ ok: false, error: 'bad token' });
    }
    const seasonNum = Number(season || '2025');
    const weekNum   = Number(week || '1');

    const r = await importWeek({ season: seasonNum, week: weekNum });
    return res.json({ ok: true, action: 'syncWeek', season: seasonNum, week: weekNum, ...r });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
