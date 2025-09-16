// api/syncWeek.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
const CRON_TOKEN   = process.env.CRON_TOKEN || process.env.VITE_CRON_TOKEN;

const FIXED_SEASON = 2025; // tu tabla tiene check season = 2025

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'SurvivorSync/1.0', 'Accept': 'application/json' } });
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

export default async function handler(req, res) {
  try {
    const { token, week } = req.query;
    if (!token || token !== CRON_TOKEN) return res.status(401).json({ ok:false, error:'bad token' });

    const weekNum = Number(week || '1');

    // ESPN por temporada/semana
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${FIXED_SEASON}&week=${weekNum}`;
    const json = await fetchJSON(url);
    const events = json?.events || [];

    let upserts = 0;

    for (const ev of events) {
      const comp = ev?.competitions?.[0] || {};
      const comps = comp?.competitors || [];
      const home = comps.find(c => (c.homeAway || c.homeaway) === 'home');
      const away = comps.find(c => (c.homeAway || c.homeaway) === 'away');

      // En tu tabla id=TEXT. Usamos el id de ESPN como string
      const gameId = String(ev?.id || comp?.id || '');
      if (!gameId) continue;

      // FK teams: usa abreviación (debe existir en public.teams.id)
      const home_id = U(home?.team?.abbreviation);
      const away_id = U(away?.team?.abbreviation);

      // Si por alguna razón no están en teams, puedes saltarlos (o insertarlos previamente)
      if (!home_id || !away_id) continue;

      const row = {
        id: gameId,
        week: weekNum,
        season: FIXED_SEASON, // respeta tu CHECK (season=2025)
        start_time: comp?.date || ev?.date,
        home_team: home_id,
        away_team: away_id,
        status: mapStatus(comp || ev),      // game_status enum
        home_score: home?.score != null ? Number(home.score) : null,
        away_score: away?.score != null ? Number(away.score) : null,
        // winner_team la dejamos nula; la calcula tu lógica cuando finaliza
        external_id: String(ev?.id || comp?.id || ''),
        updated_at: new Date().toISOString()
      };

      // No mandamos columnas que no estén en tu esquema (down, distance, etc.)
      const { error } = await sb.from('games').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      upserts++;
    }

    return res.json({ ok:true, action:'syncWeek', season: FIXED_SEASON, week: weekNum, upserts });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}
